from fastapi import FastAPI, APIRouter, HTTPException, Body
from dotenv import load_dotenv
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pymongo.errors import BulkWriteError, DuplicateKeyError
import os
import json
from contextlib import asynccontextmanager, suppress
from fieldcrypto import open_insurance, open_tree, seal_insurance, seal_tree
import re
import uuid
import secrets
import logging
import hmac
import jwt
from pathlib import Path
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, EmailStr, Field
from typing import Optional

from reports import new_report, period_bounds, snapshot_lines, text_pdf
from catalog import (
    archive_service, booking_block_reason, catalogue_public, create_service, delete_service,
    draft_service, ensure_service_indexes, list_services, preview_service, publish_service, read_service, restore_service, update_service,
)
from media import build_media_router, ensure_media_indexes
from profiles import ensure_profile_indexes, present_practitioner, read_profile, update_profile, visible_profile
from seed import build_launch_seed, build_seed
from auth import ALG, build_auth
from fastapi import Request
from payments import build_router, with_settle, claim_eligible
from billing import build_billing_router, clear_billing, ensure_billing
from clinical import build_clinical_router, clear_clinical, ensure_clinical
from history_import import build_import_router, clear_imports, ensure_imports
from legacy import build_legacy_router, clear_legacy, ensure_legacy
from tracking import build_tracking_router, clear_runtime, end_tracking, issue_guest_capability, on_transition
from emailer import send_email
from html import escape
import asyncio
from math import radians, sin, cos, asin, sqrt
from config import (
    cors_origins, demo_mode, document_uploads_enabled, email_lifecycle_enabled, email_provider,
    is_production, practitioner_booking_email_enabled, profile_photos_enabled, stripe_card_checkout_enabled, validate_env,
)
from redact import AccessPathRedact, RedactLogFilter
from availability import (
    assert_public_slot, build_schedule_router, clinic_is_bookable, clinic_visit_address, draft_schedule, gps_origin, merge_clinic, note_cancellation, public_cancellation, public_clinic, point_of, validate_clinic, visit_navigation_point,
    validate_policy, validate_scheduling, visible_to,
)
from payment_policy import due_for_booking, resolve_payment_policy
from recovery import (
    apply_campaign_price, award_campaign, build_recovery_router, campaign_quote, consume_recovery_hold,
    release_campaign, release_campaign_for_appointment, reserve_campaign, validate_fee,
)
from pricing import (
    BLOCKING_STATUSES, client_matches_person, ensure_welcome_offer, haversine_km, identity_keys, minutes, money, overlaps, quote, zone_for, zone_travel,
)
from rewards import build_rewards_router, release_redemption, reserve_redemption, settle_appointment_points, validate_rewards
from geo import GEO, GeocodeError, ProviderError, RateLimit, CHECK_LIMIT, allow
from addresses import classify, parse_civic, postal_code
from notifications import (
    CancelDelivery, PermanentDelivery, TransientDelivery, apply_delivery_receipt, clear_notifications,
    enqueue_booking_confirmation, enqueue_operational, enqueue_practitioner_notice, ensure_notifications,
    notification_summary, process_available, resolve_practitioner_account,
    enqueue_email_test, freeze_delivery, enqueue_due_email_reminders, reconcile_pending_email_receipts,
)
from messaging import build_messaging_router, ensure_messaging, record_trip_notice
from giftcards import build_giftcard_router, ensure_giftcards
from trial import (
    TRIAL_DURATION_MIN, TRIAL_LOCATION_TYPES, TRIAL_SERVICE_SLUG, ensure_trial_campaign_locations, ensure_trial_service, is_trial_appointment, is_trial_offer, is_trial_service,
    trial_duration_ok,
)
from plans import available_credit, build_plans_router, consume_credit, credit_quote, ensure_plans, release_credit, reserve_credit
from safety import build_safety_router, ensure_safety
from devices import build_devices_router, ensure_devices, notify as push_notify
from winback import build_winback_router, ensure_winback, reserve_invite, settle_invite, valid_invite, winback_quote
from followup_coupons import (
    build_followup_router, ensure_followup, followup_quote, issue_on_complete,
    reserve_followup, settle_followup, valid_followup,
)
from finance import build_finance_router
from readiness import build_readiness_router
from email_templates import invoice_email, payment_link_email, receipt_email, statement_email, email_test_message, review_invitation_email, billing_update_email
from config import giftcards_enabled, invoice_email_enabled
from sms import build_sms_router, due_reminders, ensure_sms, queue_sms, readiness as sms_readiness
from session_care import assert_session_ready, build_session_care_router, clear_session_care, consent_snapshot, ensure_session_care
from reviews import build_reviews_router, clear_reviews, ensure_reviews, prepare_review_invite
from turnaround import assert_no_active_session, build_turnaround_router, session_end_update, session_start_update

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Nabitouch")
api = APIRouter(prefix="/api")

COLLS = ["services", "practitioners", "clients", "appointments", "soap", "plans",
         "promotions", "zones", "giftcards", "audit", "templates", "settings"]
PREFIX = "nt_"
NO_ID = {"_id": 0}

# Allowed lifecycle transitions (mirrors frontend/src/lib/domain.js)
TRANSITIONS = {
    "requested": ["confirmed", "assigned", "cancelled"],
    "confirmed": ["assigned", "preparing", "en_route", "cancelled", "no_show"],
    "assigned": ["preparing", "en_route", "cancelled", "no_show"],
    "preparing": ["en_route", "cancelled", "no_show"],
    "en_route": ["arrived", "interrupted", "cancelled", "safety_hold"],
    "arrived": ["in_session", "interrupted", "no_show", "safety_hold"],
    "in_session": ["session_ended", "interrupted", "safety_hold"],
    "session_ended": ["soap_pending"],
    "soap_pending": ["soap_completed", "leaving"],
    "soap_completed": ["leaving"],
    "leaving": ["completed"],
    "completed": ["processing"],
    "processing": ["closed"],
    "interrupted": ["in_session", "leaving", "cancelled", "safety_hold"],
    "safety_hold": ["arrived", "in_session", "leaving", "cancelled"],
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def coll(name):
    if name not in COLLS:
        raise HTTPException(404, "Unknown collection")
    return db[PREFIX + name]


async def add_audit(actor, action, appt_id=None, *, actor_id=None):
    """Audit readers use actor, action, at, and appointmentId. actor_id is the signed-in account."""
    doc = {"id": str(uuid.uuid4()), "at": now_iso(), "actor": actor, "action": action, "appointmentId": appt_id}
    if actor_id:
        doc["actorId"] = actor_id
    await coll("audit").insert_one(doc)


auth_router, user_from, require, seed_users = build_auth(db, coll, add_audit)


async def reset_data():
    seed = build_seed() if demo_mode() else build_launch_seed()
    for name in COLLS:
        await coll(name).delete_many({})
        docs = seed.get(name, [])
        if docs:
            await coll(name).insert_many([dict(d) for d in docs])
    await db.nt_schedules.delete_many({})
    await db.nt_opening_offers.delete_many({})
    await db.nt_opening_watches.delete_many({})
    await db.nt_recovery_cases.delete_many({})
    await db.nt_campaigns.delete_many({})
    await db.nt_campaign_redemptions.delete_many({})
    await db.nt_consent.delete_many({})
    await db.nt_points_ledger.delete_many({})
    schedules = seed.get("schedules") or []
    if schedules:
        await db.nt_schedules.insert_many([dict(row) for row in schedules])
    await db.nt_slot_locks.delete_many({})


async def _audit_mail(note, outcome):
    ref = note.get("ref") or note.get("id")
    if outcome == "sent":
        await add_audit("system", f"{ref} confirmation email sent", note.get("appointmentId"))
    elif outcome == "failed":
        await add_audit("system", f"{ref} confirmation email failed", note.get("appointmentId"))


async def _training_cleanup():
    while True:
        try:
            from training import assert_training_database, purge_expired, training_database_name
            await purge_expired(assert_training_database(client[training_database_name()]))
        except Exception:
            logging.getLogger(__name__).info("Training cleanup skipped")
        await asyncio.sleep(3600)


async def _notification_worker():
    """Poll the Mongo outbox. The row is already durable before this runs."""
    worker_id = "mail-" + uuid.uuid4().hex[:8]
    last_reminders = 0
    while True:
        try:
            if os.environ.get("NOTIFICATION_WORKER_ENABLED", "true").lower() == "false":
                await asyncio.sleep(1)
                continue
            if asyncio.get_running_loop().time() - last_reminders > 60:
                await reconcile_pending_email_receipts(db)
                await enqueue_due_email_reminders(db, coll)
                last_reminders = asyncio.get_running_loop().time()
            worked = await process_available(db, _deliver_booking, worker_id, _audit_mail)
        except Exception:
            logging.getLogger(__name__).error("Notification worker iteration failed")
            worked = False
        await asyncio.sleep(0.05 if worked else 0.4)


@asynccontextmanager
async def lifespan(_app):
    validate_env()
    await db.nt_slot_locks.create_index("lockId", unique=True)
    await db.nt_slot_locks.create_index("appointmentId")
    await db.nt_appointments.create_index("idempotencyKey", unique=True, sparse=True)
    await db.nt_schedules.create_index("practitionerId", unique=True)
    await db.nt_opening_offers.create_index("id", unique=True)
    await db.nt_opening_watches.create_index("clientId")
    await db.nt_recovery_cases.create_index("appointmentId")
    await db.nt_campaigns.create_index("id", unique=True)
    await db.nt_campaign_redemptions.create_index("idempotencyKey", unique=True, sparse=True)
    await db.nt_consent.create_index([("clientId", 1), ("purpose", 1)])
    await db.nt_points_ledger.create_index("idempotencyKey", unique=True)
    await db.nt_points_ledger.create_index("clientId")
    await db.nt_clients.create_index("referralCode", unique=True, sparse=True)
    await db.nt_welcome_claims.create_index("key", unique=True)
    await ensure_service_indexes(db)
    await ensure_media_indexes(db)
    await ensure_profile_indexes(db)
    await ensure_billing(db)
    await ensure_imports(db)
    await ensure_clinical(db)
    await ensure_session_care(db)
    await ensure_reviews(db)
    try:
        await coll("appointments").create_index("practitionerId", name="one_active_session", unique=True,
                                                partialFilterExpression={"status": "in_session"})
    except Exception:
        logging.getLogger(__name__).warning("one_active_session index not created: existing overlapping sessions")
    await db.nt_ops_alerts.create_index("dedupeKey", unique=True)
    await ensure_legacy(db)
    await ensure_notifications(db)
    await ensure_messaging(db)
    await ensure_giftcards(db)
    await ensure_trial_service(db)
    await ensure_trial_campaign_locations(db)
    await ensure_welcome_offer(db)
    await ensure_plans(db)
    await ensure_safety(db)
    await ensure_devices(db)
    await ensure_winback(db)
    await ensure_followup(db)
    await ensure_sms(db)
    await db.nt_cron_runs.create_index("id", unique=True)
    await db.nt_statement_locks.create_index("id", unique=True)
    await db.nt_statement_locks.create_index("at", expireAfterSeconds=120)
    if await coll("services").count_documents({}) == 0:
        await reset_data()
    if not is_production():
        await coll("promotions").update_many(
            {"approval": {"$exists": False}, "enabled": True},
            {"$set": {"approval": "approved"}},
        )
    if is_production():
        await coll("appointments").update_many(
            {"trip.sharing": True, "trip.sharingSource": {"$ne": "practitioner"}},
            {"$set": {"trip.sharing": False}},
        )
    await seed_users()
    worker = asyncio.create_task(_notification_worker())
    training_worker = asyncio.create_task(_training_cleanup())
    try:
        yield
    finally:
        worker.cancel()
        training_worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
        with suppress(asyncio.CancelledError):
            await training_worker
        client.close()


app.router.lifespan_context = lifespan


@api.get("/")
async def root():
    return {"message": "Nabitouch"}


async def redis_state():
    url = os.environ.get("REDIS_URL") or ""
    if not url:
        return "unconfigured"
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(url, socket_connect_timeout=1)
        try:
            await client.ping()
        finally:
            await client.aclose()
        return "ok"
    except Exception:
        return "unavailable"


@api.get("/health")
async def health():
    mongo = "ok"
    try:
        await db.command("ping")
    except Exception:
        mongo = "unavailable"
    return {
        "status": "ok" if mongo == "ok" else "unavailable",
        "mongo": mongo,
        "redis": await redis_state(),
        "documentUploads": document_uploads_enabled(),
        "cardCheckout": stripe_card_checkout_enabled(),
    }


@api.post("/notifications/resend")
async def resend_receipt(request: Request):
    """Delivery receipts only. Provider acceptance does not call this route."""
    from emailer import resend_webhook_authentic
    raw = await request.body()
    secret = (os.environ.get("RESEND_WEBHOOK_SECRET") or "").strip()
    if not secret:
        raise HTTPException(503, "Email receipt verification is not configured")
    if not resend_webhook_authentic(raw, request.headers, secret):
        raise HTTPException(400, "Invalid signature")
    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid event")
    if not isinstance(event, dict):
        raise HTTPException(400, "Invalid event")
    updated = await apply_delivery_receipt(db, event, request.headers.get("svix-id"))
    return {"accepted": True, "updated": updated}


def _email_status():
    from config import email_provider, invoice_email_enabled, statement_email_enabled
    key = (os.environ.get("RESEND_API_KEY") or "").strip()
    sender = (os.environ.get("EMAIL_FROM") or "").strip()
    return {"provider": email_provider(), "resendKey": bool(key), "sender": sender or None, "replyTo": (os.environ.get("EMAIL_REPLY_TO") or "").strip() or None,
            "webhookSecret": bool((os.environ.get("RESEND_WEBHOOK_SECRET") or "").strip()), "testRecipient": (os.environ.get("EMAIL_TEST_RECIPIENT") or "").strip() or None,
            "types": {
                "lifecycle": email_lifecycle_enabled(),
                "invoices": invoice_email_enabled(),
                "statements": statement_email_enabled(),
                "practitionerBooking": practitioner_booking_email_enabled(),
            }}


@api.get("/ops/email/status")
async def email_status(request: Request):
    await require(request, "owner")
    return _email_status()


@api.post("/ops/email/test")
async def email_test(request: Request):
    """One fixed message to EMAIL_TEST_RECIPIENT only. No caller-supplied recipient, subject or body."""
    user = await require(request, "owner")
    from emailer import acceptance_guard, acceptance_message_guard
    target = (os.environ.get("EMAIL_TEST_RECIPIENT") or "").strip()
    if not target:
        raise HTTPException(409, "Set EMAIL_TEST_RECIPIENT first")
    acceptance_guard(target)
    acceptance_message_guard(*email_test_message())
    key = request.headers.get("Idempotency-Key") or ""
    if not key and os.environ.get("EMAIL_ACCEPTANCE_MODE", "false").lower() == "true":
        raise HTTPException(409, "A stable test-message Idempotency-Key is required")
    if len(key) > 200:
        raise HTTPException(400, "Invalid test-message key")
    note, _created = await enqueue_email_test(db, target, key or uuid.uuid4().hex)
    await process_available(db, _deliver_booking, "owner-email-test", _audit_mail, notification_id=note["id"])
    saved = await db.nt_notifications.find_one({"id": note["id"]}, NO_ID)
    return {"sent": saved.get("status") == "sent", "id": saved.get("providerId"), "notificationId": note["id"], "status": saved.get("status"), "provider": _email_status()["provider"]}


@api.get("/notifications/channels")
async def notification_channels(request: Request):
    """Channel truth for the signed-in user. No provider secrets are included."""
    await require(request)
    mail = email_provider()
    return {
        "inApp": "available",
        "email": mail if mail in ("resend", "mock", "disabled", "emergent") else "unconfigured",
        "emailLifecycle": False if not email_lifecycle_enabled() else True,
        "sms": sms_readiness(),
    }


@api.get("/ops/status")
async def ops_status(request: Request):
    await require(request, "owner")
    hello = await db.command("hello")
    return {
        "mongo": "ok",
        "redis": await redis_state(),
        "replicaSet": bool(hello.get("setName")),
        "transactionMode": "replica-set" if hello.get("setName") else "standalone-journal",
        "pendingFinancialOperations": await db.nt_ops.count_documents({"status": "pending"}),
    }


PUBLIC_SETTINGS = ("id", "gst", "cashEnabled", "clinic", "addons", "center", "whatsapp")
CLIENT_SETTINGS = PUBLIC_SETTINGS + ("liveGpsPractitionerId",)
DESK_SETTINGS = CLIENT_SETTINGS + ("receptionPerms",)
PRACTITIONER_HIDDEN = {"base", "licenseExpiry", "insuranceExpiry"}


def busy_slot(appt):
    """A public busy block. An incomplete stored row is not a booked time."""
    if not appt.get("date") or not appt.get("time") or appt.get("duration") in (None, ""):
        return None
    return {"id": appt.get("id"), "date": appt["date"], "time": appt["time"], "duration": appt["duration"],
            "practitionerId": appt.get("practitionerId"), "status": appt.get("status")}


def present_trip(appt):
    """A sample trip is not a recorded drive. It keeps its destination and drops any invented origin."""
    trip = dict((appt or {}).get("trip") or {})
    if not trip or not trip.get("simulated") or trip.get("sharingSource") == "practitioner":
        return appt
    for key in ("from", "km", "driveMin", "demoSec"):
        trip.pop(key, None)
    trip["sharing"] = False
    trip["location"] = "sample"
    return {**appt, "trip": trip}


def hide_practitioner_home(appt):
    """Clients and the desk see the visit, not the practitioner's exact start. A missing GPS fix is left missing."""
    trip = appt.get("trip") or {}
    dest = trip.get("to") or {}
    if dest.get("lat") is None or not trip.get("from"):
        return appt
    public = {"lat": round(float(dest["lat"]) - 0.015, 5), "lng": float(dest["lng"])}
    return {**appt, "trip": {**trip, "from": public}}


def full_name(client):
    return f"{(client or {}).get('firstName', '')} {(client or {}).get('lastName', '')}".strip()


def shape_settings(docs, role):
    shaped = []
    for doc in docs:
        if role == "owner":
            view = doc
        else:
            keys = DESK_SETTINGS if role == "desk" else CLIENT_SETTINGS if role else PUBLIC_SETTINGS
            view = {key: doc.get(key) for key in keys}
            view["clinic"] = public_clinic(doc.get("clinic"))
            policy = public_cancellation(doc.get("cancellationPolicy"), role)
            if policy:
                view["cancellationPolicy"] = policy
        view = {
            **view,
            "paymentPolicy": resolve_payment_policy(
                doc.get("paymentPolicy"), production=is_production(), explicit=isinstance(doc.get("paymentPolicy"), dict) and bool(doc.get("paymentPolicy")),
            ),
        }
        shaped.append(view)
    flags = {
        "documentUploadsEnabled": document_uploads_enabled(),
        "profilePhotosEnabled": profile_photos_enabled(),
        "cardCheckoutEnabled": stripe_card_checkout_enabled(),
        "invoiceEmailEnabled": invoice_email_enabled(),
        "giftCardsEnabled": giftcards_enabled(),
    }
    return [{**doc, **flags} for doc in shaped]


def shape_practitioners(docs, role):
    if role == "owner":
        return docs
    return [{key: value for key, value in person.items() if key not in PRACTITIONER_HIDDEN} for person in docs]


def without_keys(doc, keys):
    return {key: value for key, value in doc.items() if key not in keys}


async def reception_perms():
    settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
    return settings.get("receptionPerms") or {}


@api.get("/clients/search")
async def search_clients(request: Request, q: str = "", limit: int = 20):
    """Staff patient lookup by name, email, or phone. Does not return clinical notes."""
    from rbac import has_role
    user = await require(request, "owner", "desk")
    needle = str(q or "").strip().lower()
    if len(needle) < 2:
        return {"clients": [], "duplicates": []}
    limit = max(1, min(int(limit or 20), 50))
    rows = await coll("clients").find({}, {"_id": 0, "id": 1, "firstName": 1, "lastName": 1, "email": 1, "phone": 1, "preferredName": 1}).to_list(2000)
    hits = []
    for row in rows:
        blob = " ".join(str(row.get(k) or "") for k in ("firstName", "lastName", "preferredName", "email", "phone")).lower()
        digits = "".join(ch for ch in str(row.get("phone") or "") if ch.isdigit())
        q_digits = "".join(ch for ch in needle if ch.isdigit())
        if needle in blob or (q_digits and q_digits in digits):
            hits.append(row)
        if len(hits) >= limit:
            break
    duplicates = []
    for row in hits[:10]:
        email = str(row.get("email") or "").lower()
        phone = "".join(ch for ch in str(row.get("phone") or "") if ch.isdigit())[-10:]
        same = [other for other in rows if other["id"] != row["id"] and (
            (email and str(other.get("email") or "").lower() == email) or
            (len(phone) >= 10 and "".join(ch for ch in str(other.get("phone") or "") if ch.isdigit())[-10:] == phone)
        )]
        if same:
            duplicates.append({"clientId": row["id"], "matches": [m["id"] for m in same[:5]]})
    await add_audit(user.get("name") or "staff", f"Patient search ({len(hits)} hits)")
    return {"clients": hits, "duplicates": duplicates}


@api.post("/clients")
async def create_client(request: Request, body: dict = Body(...)):
    """Staff patient registration. Does not merge duplicates automatically."""
    from rbac import has_role
    user = await require(request, "owner", "desk")
    if has_role(user, "desk") and not has_role(user, "owner") and not (await reception_perms()).get("createBooking"):
        raise HTTPException(403, "Not permitted")
    first = str(body.get("firstName") or "").strip()
    last = str(body.get("lastName") or "").strip()
    email = str(body.get("email") or "").strip().lower()
    phone = str(body.get("phone") or "").strip()
    if not first or not last:
        raise HTTPException(400, "First and last name are required")
    if email and await coll("clients").find_one({"email": email}, {"_id": 1}):
        raise HTTPException(409, "A patient with that email already exists")
    client = {
        "id": "c-" + uuid.uuid4().hex[:10], "firstName": first, "lastName": last, "preferredName": str(body.get("preferredName") or "").strip(),
        "email": email, "phone": phone, "dob": str(body.get("dob") or "").strip(), "language": body.get("language") or "English",
        "contactMethod": body.get("contactMethod") or "Text", "marketingConsent": bool(body.get("marketingConsent")),
        "smsConsent": bool(body.get("smsConsent")), "addresses": [], "insurance": [], "favorites": [], "preferredPractitioners": [],
        "loyaltyPoints": 0, "onlineBookings": 0, "createdAt": now_iso(), "createdBy": user.get("id"),
    }
    await coll("clients").insert_one(dict(client))
    await add_audit(user.get("name") or "staff", f"Patient created {first} {last}")
    return client


@api.get("/clients/{client_id}/workspace")
async def client_workspace(client_id: str, request: Request):
    """Staff client record. Reception sees only what its permissions allow. Clinical notes are never included."""
    from rbac import has_role
    user = await require(request, "owner", "desk")
    desk_only = has_role(user, "desk") and not has_role(user, "owner")
    perms = await reception_perms() if desk_only else {}
    client = await coll("clients").find_one({"id": client_id}, NO_ID)
    if not client:
        raise HTTPException(404, "Client not found")
    if "insurance" in client:
        client = {**client, "insurance": open_insurance(client.get("insurance"))}
    appts = await coll("appointments").find({"clientId": client_id}, NO_ID).sort([("date", -1), ("time", -1)]).to_list(300)
    appts = [present_trip(a) for a in appts]
    if desk_only:
        appts = [hide_practitioner_home(a) for a in appts]
        if not perms.get("viewAddresses"):
            appts = [without_keys(a, {"address"}) for a in appts]
            client = without_keys(client, {"addresses"})
        if not perms.get("viewInsuranceStatus"):
            client = without_keys(client, {"insurance"})
    consents = await db.nt_consents.find({"clientId": client_id}, NO_ID).sort("at", -1).to_list(100)
    consent_view = [{k: c.get(k) for k in ("id", "kind", "purpose", "version", "at", "withdrawnAt", "status")} for c in consents]
    can_read_threads = has_role(user, "owner") or bool(perms.get("viewHistory") or perms.get("createBooking"))
    threads = []
    if can_read_threads:
        for a in appts:
            count = await db.nt_messages.count_documents({"appointmentId": a["id"]})
            notices = await db.nt_trip_notices.count_documents({"appointmentId": a["id"]})
            if not count and not notices:
                continue
            last = await db.nt_messages.find({"appointmentId": a["id"]}, NO_ID).sort("createdAt", -1).to_list(1)
            threads.append({"appointmentId": a["id"], "ref": a.get("ref"), "date": a.get("date"), "time": a.get("time"), "messages": count, "notices": notices,
                            "last": {k: last[0].get(k) for k in ("body", "authorRole", "authorLabel", "createdAt")} if last else None})
    plans = await coll("plans").find({"clientId": client_id}, NO_ID).to_list(50) if has_role(user, "owner") else []
    invoices = []
    if has_role(user, "owner") or bool(perms.get("managePayments") or perms.get("viewInsuranceStatus")):
        invoices = await db.nt_invoices.find({"clientId": client_id}, {"_id": 0, "id": 1, "number": 1, "state": 1, "totalCents": 1, "serviceDate": 1, "origin": 1}).sort("serviceDate", -1).to_list(50)
    await add_audit(user.get("name") or "staff", f"Opened client record {client.get('firstName', '')} {client.get('lastName', '')}".strip())
    return {"client": client, "appointments": appts, "consents": consent_view, "threads": threads, "plans": plans, "invoices": invoices,
            "access": {"role": user["role"], "threads": can_read_threads, "plans": has_role(user, "owner"), "clinical": False,
                       "invoices": has_role(user, "owner") or bool(perms.get("managePayments") or perms.get("viewInsuranceStatus")),
                       "insurance": has_role(user, "owner") or bool(perms.get("viewInsuranceStatus"))}}


@api.get("/state")
async def get_state(request: Request):
    """Role-scoped snapshot. Public visitors get catalogue + anonymised availability only."""
    u = await user_from(request)
    role, sub = (u["role"], u.get("subject")) if u else (None, None)
    perms = await reception_perms() if role == "desk" else {}
    out = {}
    for name in COLLS:
        q = coll(name).find({}, NO_ID)
        if name == "audit":
            q = q.sort("at", -1).limit(80)
        out[name] = await q.to_list(1000)
    out["clients"] = [{**client, "insurance": open_insurance(client.get("insurance"))} if "insurance" in client else client for client in out["clients"]]
    out["appointments"] = [present_trip(appt) for appt in out["appointments"]]
    out["soap"] = [open_tree(note) for note in out["soap"]]
    out["settings"] = shape_settings(out["settings"], role)
    out["practitioners"] = [present_practitioner(person, role) for person in out["practitioners"] if visible_profile(person, role, sub)]
    if role != "owner":
        out["services"] = [row for row in out["services"] if catalogue_public(row)]
    if role == "owner":
        out["inquiries"] = await db.nt_inquiries.find({}, NO_ID).sort("at", -1).to_list(20)
        out["mailOps"] = await notification_summary(db)
    elif role == "desk":
        out["soap"] = []
        out["plans"] = []
        out["giftcards"] = []
        out["appointments"] = [hide_practitioner_home(appt) for appt in out["appointments"]]
        if not perms.get("viewAddresses"):
            out["appointments"] = [without_keys(a, {"address"}) for a in out["appointments"]]
            out["clients"] = [without_keys(c, {"addresses"}) for c in out["clients"]]
        if not perms.get("viewInsuranceStatus"):
            out["clients"] = [without_keys(c, {"insurance"}) for c in out["clients"]]
        if not perms.get("viewHistory"):
            out["audit"] = []
    else:
        appts = out["appointments"]
        mine = [a for a in appts if (role == "client" and a.get("clientId") == sub) or (role == "practitioner" and a.get("practitionerId") == sub)]
        if role == "client":
            mine = [hide_practitioner_home(appt) for appt in mine]
        ids = {a["clientId"] for a in mine}
        busy = [slot for slot in (busy_slot(a) for a in appts if a not in mine) if slot]
        out["appointments"] = (mine if role == "practitioner" else mine + busy) if role else busy
        if role == "practitioner":
            out["clients"] = [without_keys(c, {"insurance"}) for c in out["clients"] if c["id"] in ids]
            out["soap"] = [s for s in out["soap"] if s.get("practitionerId") == sub]
            out["plans"] = [p for p in out["plans"] if p.get("practitionerId") == sub]
            out["audit"] = [x for x in out["audit"] if x.get("appointmentId") in {a["id"] for a in mine}]
            out["giftcards"] = []
        elif role == "client":
            me = next((c for c in out["clients"] if c["id"] == sub), None)
            out["clients"] = [me] if me else []
            out["soap"] = []
            out["plans"] = [p for p in out["plans"] if p.get("clientId") == sub and p.get("visibleToClient", True)]
            out["audit"] = []
            name = full_name(me)
            out["giftcards"] = [g for g in out["giftcards"] if me and (g.get("clientId") == sub or (name and name in (g.get("recipient"), g.get("purchaser"))))]
        else:
            out["clients"] = []
            out["soap"] = []
            out["plans"] = []
            out["audit"] = []
            out["giftcards"] = []
        if role not in ("owner", "desk"):
            out["templates"] = []
    out["serverTime"] = now_iso()
    return out


async def drop_detached_client_accounts():
    """Demo reset removes client profiles. Accounts that still point at those profiles cannot book or receive confirmation mail."""
    live = set()
    async for row in coll("clients").find({}, {"id": 1, "_id": 0}):
        if row.get("id"):
            live.add(row["id"])
    stale = []
    async for user in db.nt_users.find({"role": "client"}, {"_id": 0, "id": 1, "subject": 1}):
        if user.get("subject") not in live:
            stale.append(user["id"])
    if not stale:
        return
    await db.nt_users.delete_many({"id": {"$in": stale}})
    await db.nt_sessions.delete_many({"userId": {"$in": stale}})
    await db.nt_password_resets.delete_many({"userId": {"$in": stale}})
    await db.nt_mfa.delete_many({"userId": {"$in": stale}})


async def reopen_client_profile(user):
    """Keep a signed-in booking on the account's own id and email.

    A missing profile used to create a second client with a blank address, so the
    confirmation mail returned before writing an audit.
    """
    subject = user.get("subject")
    if not subject:
        raise HTTPException(409, "This account has no client profile")
    name = str(user.get("name") or "").strip().split(" ", 1)
    client = {"id": subject, "firstName": name[0] if name and name[0] else "Client",
              "lastName": name[1] if len(name) > 1 else "", "email": str(user.get("email") or "").strip().lower(),
              "phone": "", "dob": "", "marketingConsent": False, "addresses": [], "insurance": [], "favorites": [],
              "preferredPractitioners": [], "loyaltyPoints": 0, "onlineBookings": 0, "hasProfile": False,
              "createdAt": now_iso()}
    try:
        await coll("clients").insert_one(dict(client))
    except DuplicateKeyError:
        found = await coll("clients").find_one({"id": subject}, NO_ID)
        if found:
            return found
        raise
    client.pop("_id", None)
    return client


@api.post("/demo/reset")
async def demo_reset(request: Request):
    if not demo_mode():
        raise HTTPException(404, "Not available")
    await require(request)
    await reset_data()
    await drop_detached_client_accounts()
    await clear_billing(db)
    await clear_clinical(db)
    await clear_session_care(db)
    await clear_reviews(db)
    await db.nt_ops_alerts.delete_many({})
    await clear_imports(db)
    await clear_legacy(db)
    await clear_notifications(db)
    await clear_runtime()
    return {"ok": True}


@api.get("/notifications/operations")
async def notification_operations(request: Request):
    await require(request, "owner")
    return await notification_summary(db)


class TransitionIn(BaseModel):
    to: str
    actor: str = "system"
    note: Optional[str] = None
    opId: Optional[str] = None
    location: Optional[dict] = None


async def apply_transition(appt, to, actor, note=None, op_id=None, location=None):
    cur = appt["status"]
    if to not in TRANSITIONS.get(cur, []):
        raise HTTPException(409, f"Cannot move from {cur} to {to}")
    if to == "in_session":
        await assert_session_ready(db, appt)
        await assert_no_active_session(coll, appt)
    ts = now_iso()
    events = appt.get("events", []) + [{"status": to, "at": ts, "actor": actor, "note": note}]
    timestamps = {**appt.get("timestamps", {}), to: ts}
    upd = {"status": to, "events": events, "timestamps": timestamps}
    if to in ("interrupted", "safety_hold") and cur == "in_session":
        upd["timer"] = {**appt.get("timer", {}), "pausedAt": ts}
    if to == "in_session" and cur in ("interrupted", "safety_hold") and appt.get("timer", {}).get("pausedAt"):
        t = appt["timer"]
        gap = (datetime.fromisoformat(ts) - datetime.fromisoformat(t["pausedAt"])).total_seconds() * 1000
        upd["timer"] = {"pausedMs": t.get("pausedMs", 0) + gap, "pausedAt": None}
        timestamps["in_session"] = appt["timestamps"]["in_session"]
    if to == "in_session" and cur == "arrived":
        upd.update(await session_start_update(appt, ts))
    session = appt.get("session") or {}
    if to == "session_ended" or (to == "leaving" and cur == "interrupted" and session.get("startedAt") and not session.get("endedAt")):
        upd.update(await session_end_update(coll, {**appt, "timer": upd.get("timer", appt.get("timer"))}, ts))
    if to == "en_route":
        upd["trip"] = await start_trip(appt, ts, location)
    elif appt.get("trip", {}).get("sharing"):
        upd["trip"] = {**appt["trip"], "sharing": False, "endedAt": ts}  # stop client-visible tracking
    guard = {"id": appt["id"], "status": cur}
    change = {"$set": upd}
    if op_id:
        guard["opIds"] = {"$ne": op_id}
        change["$push"] = {"opIds": {"$each": [op_id], "$slice": -40}}
    try:
        done = await coll("appointments").update_one(guard, change)
    except DuplicateKeyError as exc:
        raise HTTPException(409, "Another session is already in progress for this practitioner. End it before starting another.") from exc
    if not done.matched_count:
        raise HTTPException(409, "This visit was just updated on another device. Refresh and try again.")
    if op_id:
        upd["opIds"] = (appt.get("opIds") or [])[-39:] + [op_id]
    if to in ("cancelled", "no_show"):
        await db.nt_slot_locks.delete_many({"appointmentId": appt["id"]})
    await add_audit(actor, f"{appt['ref']} → {to.replace('_', ' ')}", appt["id"])
    await on_transition(appt, to)
    saved = {**appt, **upd}
    if to in ("en_route", "arrived", "completed"):
        await record_trip_notice(db, saved, to)
    if to == "cancelled":
        await _maybe_lifecycle_mail(saved, "cancellation")
        await _queue_practitioner_mail(saved, "practitioner_cancellation")
    if to == "assigned" and saved.get("practitionerId"):
        await _maybe_lifecycle_mail(saved, "assignment")
        await _queue_practitioner_mail(saved, "practitioner_booking")
    if to in ("completed", "processing", "closed"):
        await settle_appointment_points(db, coll, saved)
    if to == "completed":
        try:
            await prepare_review_invite(db, coll, saved)
        except Exception:
            logging.getLogger(__name__).exception("Review invitation not prepared")
    if to in ("completed", "no_show"):
        await consume_credit(db, appt["id"], actor)
    if to == "cancelled":
        await release_credit(db, appt["id"], actor, "Visit cancelled")
        await release_campaign_for_appointment(db, appt["id"])
    if to in ("completed", "cancelled", "no_show"):
        await settle_invite(db, appt["id"], to)
        await settle_followup(db, appt["id"], to)
    if to == "completed":
        try:
            await issue_on_complete(db, saved, add_audit)
        except Exception:
            logging.getLogger(__name__).exception("Follow-up coupon not issued")
    if to == "cancelled":
        await push_notify(db, "visit_cancelled", appt["id"], appt)
    if to == "en_route":
        await queue_sms(db, coll, "on_the_way", appt, appt["id"])
    if to in ("confirmed", "assigned"):
        await queue_sms(db, coll, "booking_confirmed", appt, appt["id"])
    if to == "assigned" and appt.get("practitionerId"):
        await push_notify(db, "visit_assigned", f"{appt['id']}:{appt['practitionerId']}", appt)
    if to in ("completed", "cancelled", "no_show", "closed"):
        await db.nt_safety_events.update_many({"appointmentId": appt["id"], "alert": True, "status": {"$ne": "resolved"}},
                                              {"$set": {"status": "resolved", "resolvedAt": ts, "resolvedBy": "system", "resolution": f"Visit {to.replace('_', ' ')}"}})
    if to in ("cancelled", "no_show"):
        await release_redemption(db, coll, saved.get("clientId"), saved.get("id"), (saved.get("pricing") or {}).get("loyaltyPoints"))
    return saved


def _where_line(address):
    unit = (address.get("unit") or "").strip()
    line = address.get("line") or ""
    return f"Unit {unit}, {line}" if unit else line


def client_key(request: Request):
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def remember_confirmed_address(client_id, stored, saved_id=None):
    """After the server re-verified an address for a booking, mark the matching saved address as confirmed. Never adds new addresses."""
    if not client_id or not stored or stored.get("clientConfirmed") is not True or stored.get("confidence") != "address":
        return
    person = await coll("clients").find_one({"id": client_id}, {"_id": 0, "addresses": 1}) or {}
    changed = False
    rows = []
    for a in person.get("addresses") or []:
        # Match the saved address the client picked, or one within ~60 m of the verified point. Street text differs between geocoder and input.
        near = a.get("lat") is not None and a.get("lng") is not None and haversine_km({"lat": a["lat"], "lng": a["lng"]}, {"lat": stored["lat"], "lng": stored["lng"]}) <= 0.06
        if not changed and ((saved_id and a.get("id") == saved_id) or (not saved_id and near)):
            a = {**a, "line": stored["line"], "lat": stored["lat"], "lng": stored["lng"], "zoneId": stored["zoneId"], "mapboxId": stored.get("mapboxId") or "",
                 "civic": stored.get("civic"), "confidence": "address", "clientConfirmed": True, "confirmedAt": now_iso()}
            changed = True
        rows.append(a)
    if changed:
        await coll("clients").update_one({"id": client_id}, {"$set": {"addresses": rows}})


async def locate_visit(address, zones, settings):
    """Resolve a mobile address on the server. Client lat/lng and travel fees are not the source of the quote."""
    line = " ".join(str(address.get("line") or "").split())
    unit = str(address.get("unit") or "").strip()[:40]
    place_id = str(address.get("mapboxId") or "")
    try:
        if not line and not place_id and address.get("lat") is not None:
            hit = await GEO.reverse(address.get("lat"), address.get("lng"), persist=True)
        else:
            hit = await GEO.resolve(line=line, mapbox_id=place_id, point=address if address.get("lat") is not None else None, persist=True)
    except GeocodeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(503, str(exc)) from exc
    assessed = classify(hit, line or hit.get("line") or "", address.get("postal") or "", address.get("arrival"))
    zone, km = zone_for({"lat": hit["lat"], "lng": hit["lng"]}, zones, settings.get("center"))
    if not zone:
        if (settings.get("clinic") or {}).get("enabled"):
            raise HTTPException(400, "That address is outside the mobile service area. In-clinic visits are still available.")
        raise HTTPException(400, "That address is outside the mobile service area.")
    if address.get("clientConfirmed") is not True:
        raise HTTPException(400, "Confirm the service address before a mobile visit can be booked.")
    if assessed["confidence"] != "address" or assessed["arrivalDiscrepancy"]:
        raise HTTPException(400, "This address needs review before a mobile visit can be booked.")
    stored = {
        "line": hit["line"], "unit": unit, "lat": hit["lat"], "lng": hit["lng"], "zoneId": zone["id"],
        "notes": str(address.get("notes") or "")[:240],
        "civic": assessed["civic"], "confidence": assessed["confidence"], "clientConfirmed": True,
        "postalStatus": assessed["postalStatus"], "mapboxId": hit.get("id") or "",
        "arrival": address.get("arrival") or {"lat": hit["lat"], "lng": hit["lng"]},
        "version": 1,
    }
    return stored, zone, km


def _verdict(hit, zones, settings):
    zone, km = zone_for({"lat": hit["lat"], "lng": hit["lng"]}, zones, settings.get("center"))
    travel = money(zone_travel(zone, km, "home")) if zone else 0
    return {
        "eligible": bool(zone),
        "line": hit["line"],
        "area": hit.get("area") or "",
        "lat": hit["lat"],
        "lng": hit["lng"],
        "mapboxId": hit.get("id") or "",
        "zone": {"id": zone["id"], "name": zone["name"], "fee": zone.get("fee") or 0, "perKm": zone.get("perKm") or 0} if zone else None,
        "travel": travel,
        "km": round(km, 2),
        "provider": hit.get("provider") or "",
        "civic": parse_civic(hit.get("line") or ""),
        "confirmedArrival": False,
        "message": (
            f"We come to you in {zone['name']}. Travel fee ${travel:.2f}. "
            "The fee is calculated by Nabitouch, and arrival time is estimated only once your practitioner is on the way."
            if zone else
            "That address is outside the mobile service area. You can still book an in-clinic visit."
        ),
    }


@api.post("/geo/clinic-confirm")
async def geo_clinic_confirm(request: Request, body: dict = Body(...)):
    """Confirm a selected clinic suggestion. Free text is not geocoded, and the service-area center is not a pin."""
    await require(request, "owner")
    if not allow(GEO.bucket, f"check:{client_key(request)}", CHECK_LIMIT):
        raise HTTPException(429, "Too many address lookups. Wait a moment and try again.")
    if not str(body.get("mapboxId") or "").strip():
        raise HTTPException(400, "Choose an address suggestion before confirming the clinic.")
    try:
        hit = await GEO.resolve(line=body.get("line") or "", mapbox_id=body.get("mapboxId") or "", point=None, persist=True)
    except GeocodeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(503, str(exc)) from exc
    assessed = classify(hit, body.get("line") or "", body.get("postal") or "", None)
    accepted = body.get("clientConfirmed") is True and assessed["confidence"] == "address" and not assessed["arrivalDiscrepancy"]
    result = {"accepted": accepted, "line": hit.get("line") or "", "mapboxId": hit.get("id") or "", "confidence": assessed["confidence"], "navigation": "ready" if accepted else "unavailable"}
    if accepted:
        result["lat"] = hit["lat"]
        result["lng"] = hit["lng"]
    return result


@api.post("/geo/confirm")
async def geo_confirm(request: Request, body: dict = Body(...)):
    """Classify a civic address for storage. Requires permanent geocoding when Mapbox is configured."""
    if not allow(GEO.bucket, f"check:{client_key(request)}", CHECK_LIMIT):
        raise HTTPException(429, "Too many address lookups. Wait a moment and try again.")
    settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
    zones = await coll("zones").find({}, NO_ID).to_list(20)
    try:
        hit = await GEO.resolve(line=body.get("line") or "", mapbox_id=body.get("mapboxId") or "", point=None, persist=True)
    except GeocodeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(503, str(exc)) from exc
    zone, km = zone_for({"lat": hit["lat"], "lng": hit["lng"]}, zones, settings.get("center"))
    assessed = classify(hit, body.get("line") or "", body.get("postal") or "", body.get("arrival"))
    if not zone:
        assessed["confidence"] = "unresolved"
    assessed["eligible"] = bool(zone)
    assessed["lat"] = hit["lat"]
    assessed["lng"] = hit["lng"]
    assessed["line"] = hit["line"]
    assessed["mapboxId"] = hit.get("id") or ""
    assessed["zone"] = {"id": zone["id"], "name": zone["name"]} if zone else None
    assessed["travel"] = money(zone_travel(zone, km, "home")) if zone else 0
    assessed["clientConfirmed"] = body.get("clientConfirmed") is True
    assessed["accepted"] = assessed["clientConfirmed"] and assessed["confidence"] == "address" and not assessed["arrivalDiscrepancy"] and bool(zone)
    assessed["postalNormalized"] = postal_code(body.get("postal") or "")
    return assessed


@api.get("/geo/suggest")
async def geo_suggest(request: Request, q: str = ""):
    try:
        suggestions = await GEO.suggest(q, client_key(request))
    except RateLimit as exc:
        raise HTTPException(429, "Too many address lookups. Wait a moment and try again.")
    except ProviderError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"suggestions": [{"id": item["id"], "label": item["line"], "area": item.get("area") or ""} for item in suggestions]}


@api.post("/geo/check")
async def geo_check(request: Request, body: dict = Body(...)):
    """Ephemeral service-area check. Uses temporary geocoding; does not require storage permission."""
    if not allow(GEO.bucket, f"check:{client_key(request)}", CHECK_LIMIT):
        raise HTTPException(429, "Too many address lookups. Wait a moment and try again.")
    settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
    zones = await coll("zones").find({}, NO_ID).to_list(20)
    try:
        if body.get("lat") is not None and body.get("lng") is not None and not (body.get("line") or body.get("mapboxId")):
            hit = await GEO.reverse(body.get("lat"), body.get("lng"), persist=False)
        else:
            hit = await GEO.resolve(
                line=body.get("line") or "",
                mapbox_id=body.get("mapboxId") or "",
                point=body if body.get("lat") is not None else None,
                persist=False,
            )
    except GeocodeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(503, str(exc)) from exc
    return _verdict(hit, zones, settings)


class ContactIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    message: str = Field(min_length=8, max_length=1000)


CONTACT_HITS = {}


@api.post("/contact")
async def contact(request: Request, body: ContactIn):
    if not allow(CONTACT_HITS, client_key(request), 5):
        raise HTTPException(429, "Too many messages. Please try again in a minute.")
    await db.nt_inquiries.insert_one({
        "id": str(uuid.uuid4()),
        "at": now_iso(),
        "name": " ".join(body.name.split()),
        "email": str(body.email).lower(),
        "message": " ".join(body.message.split()),
    })
    return {"ok": True}


def km_between(a, b):
    la1, lo1, la2, lo2 = map(radians, [a["lat"], a["lng"], b["lat"], b["lng"]])
    return 2 * 6371 * asin(sqrt(sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2))


async def start_trip(appt, ts, location=None):
    """Record a trip from the practitioner's current GPS. A missing fix is not replaced with a base, clinic, or city center."""
    dest = visit_navigation_point((appt or {}).get("address"), (appt or {}).get("locationType"))
    if not dest:
        raise HTTPException(409, "This visit has no map coordinates yet.")
    origin = gps_origin(location)
    trip = {"to": dest, "startedAt": ts, "sharing": False, "simulated": False, "location": "gps" if origin else "unavailable"}
    if not origin:
        return trip
    km = round(km_between(origin, dest) * 1.3 + 0.8, 1)
    trip.update({"from": origin, "km": km, "driveMin": round(6 + km * 1.9)})
    return trip


async def authorize_transition(user, appt, to):
    if user["role"] == "owner":
        return
    if user["role"] == "practitioner" and appt.get("practitionerId") == user.get("subject") and to in {
        "preparing", "en_route", "arrived", "in_session", "session_ended", "leaving", "completed", "interrupted", "cancelled", "no_show",
    }:
        return
    if user["role"] == "desk":
        perms = await reception_perms()
        if to in ("cancelled", "no_show", "confirmed") and perms.get("createBooking"):
            return
        if to == "assigned" and perms.get("assign"):
            return
    raise HTTPException(403, "Not permitted for this appointment")


def event_allowed(user, appt, kind, perms):
    if user["role"] == "owner":
        return True
    if user["role"] == "practitioner" and appt.get("practitionerId") == user.get("subject"):
        return kind in ("delay", "delayed", "message")
    if user["role"] == "desk":
        if kind in ("message", "payment_reminder") and (perms.get("createBooking") or perms.get("managePayments")):
            return True
        if kind == "rescheduled" and perms.get("createBooking"):
            return True
        if kind == "reassigned" and perms.get("assign"):
            return True
    return False


@api.post("/appointments/{appt_id}/event")
async def appt_event(appt_id: str, request: Request, body: dict = Body(...)):
    """Named operational events. Financial and lifecycle fields are not writable here."""
    appt = await coll("appointments").find_one({"id": appt_id}, NO_ID)
    if not appt:
        raise HTTPException(404, "Appointment not found")
    user = await require(request)
    kind = body.get("kind")
    if kind not in ("delay", "delayed", "rescheduled", "reassigned", "message", "payment_reminder"):
        raise HTTPException(400, "Unknown event")
    if not event_allowed(user, appt, kind, await reception_perms()):
        raise HTTPException(403, "Not permitted for this appointment")
    extra = body.get("set") or {}
    upd = {}
    if kind in ("delay", "delayed"):
        if set(extra) - {"delayMin"}:
            raise HTTPException(400, "Fields not permitted")
        if "delayMin" in extra:
            delay = int(extra["delayMin"])
            if delay < 1 or delay > 180:
                raise HTTPException(400, "Delay must be between 1 and 180 minutes")
            upd["delayMin"] = delay
    elif kind == "rescheduled":
        if set(extra) != {"date", "time"}:
            raise HTTPException(400, "Reschedule requires a date and time")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(extra["date"])) or not re.fullmatch(r"\d{2}:\d{2}", str(extra["time"])):
            raise HTTPException(400, "Use a calendar date and a 24-hour time")
        if appt.get("practitionerId"):
            service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, NO_ID)
            settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
            await assert_public_slot(
                db, coll, settings=settings, production=is_production(), practitioner_id=appt["practitionerId"],
                day=extra["date"], time=extra["time"], duration=int(appt["duration"]), address=appt.get("address") or {},
                location_type=appt.get("locationType") or "home", service=service, exclude_id=appt_id,
            )
            await ensure_slot(appt["practitionerId"], extra["date"], extra["time"], appt["duration"], appt_id)
        upd["date"], upd["time"] = extra["date"], extra["time"]
    elif kind == "reassigned":
        if set(extra) != {"practitionerId"}:
            raise HTTPException(400, "Reassign requires a practitioner")
        person = await coll("practitioners").find_one({"id": extra["practitionerId"]}, NO_ID)
        if not person or person.get("available") is False:
            raise HTTPException(409, "That practitioner is not available")
        from onboarding import assignment_credential_problem
        credentials = await db.nt_credentials.find({"practitionerId": extra["practitionerId"]}, {"_id": 0}).to_list(20)
        problem = assignment_credential_problem(person, credentials)
        if problem:
            raise HTTPException(409, problem)
        service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, NO_ID)
        settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
        await assert_public_slot(
            db, coll, settings=settings, production=is_production(), practitioner_id=extra["practitionerId"],
            day=appt["date"], time=appt["time"], duration=int(appt["duration"]), address=appt.get("address") or {},
            location_type=appt.get("locationType") or "home", service=service, exclude_id=appt_id,
        )
        await ensure_slot(extra["practitionerId"], appt["date"], appt["time"], appt["duration"], appt_id)
        upd["practitionerId"] = extra["practitionerId"]
        if appt.get("trip"):
            upd["trip"] = {**appt["trip"], "sharing": False, "endedAt": now_iso()}
        await end_tracking(appt_id)
    elif extra:
        raise HTTPException(400, "Fields not permitted")
    ev = {"status": kind, "at": now_iso(), "actor": user["name"], "note": body.get("note")}
    upd["events"] = appt.get("events", []) + [ev]
    await coll("appointments").update_one({"id": appt_id}, {"$set": upd})
    await add_audit(user["name"], f"{appt['ref']} → {kind}{' · ' + body['note'] if body.get('note') else ''}", appt_id)
    saved = {**appt, **upd}
    if kind == "delayed":
        await on_transition(appt, "delayed", {"delayMin": upd.get("delayMin")})
        await record_trip_notice(db, saved, "delayed", upd.get("delayMin"), body.get("note") or "")
        if upd.get("delayMin"):
            await queue_sms(db, coll, "running_late", saved, f"{appt_id}:{upd['delayMin']}", minutes=upd["delayMin"])
    if kind == "rescheduled":
        await _maybe_lifecycle_mail(saved, "reschedule")
        await _queue_practitioner_mail(saved, "practitioner_reschedule")
        await push_notify(db, "visit_rescheduled", f"{appt_id}:{saved['date']}:{saved['time']}", saved)
        await queue_sms(db, coll, "booking_changed", saved, f"{appt_id}:{saved['date']}:{saved['time']}")
    if kind == "reassigned":
        await _maybe_lifecycle_mail(saved, "assignment")
        await _queue_practitioner_mail(saved, "practitioner_reassignment")
        await push_notify(db, "visit_assigned", f"{appt_id}:{saved['practitionerId']}", saved)
    return saved


@api.post("/appointments/{appt_id}/transition")
async def transition(appt_id: str, body: TransitionIn, request: Request):
    appt = await coll("appointments").find_one({"id": appt_id}, NO_ID)
    if not appt:
        raise HTTPException(404, "Appointment not found")
    u = await require(request)
    await authorize_transition(u, appt, body.to)
    if body.opId and body.opId in (appt.get("opIds") or []):
        return appt
    if body.to in ("assigned", "confirmed") and not appt.get("practitionerId"):
        raise HTTPException(409, "Choose a practitioner before confirming this request")
    if body.to == "assigned" and appt.get("status") == "requested":
        await prepare_assignment(appt, appt["practitionerId"])
    body.actor = u["name"]
    op_id = body.opId[:64] if body.opId else None
    try:
        appt = await apply_transition(appt, body.to, body.actor, body.note, op_id, body.location)
    except HTTPException:
        latest = await coll("appointments").find_one({"id": appt_id}, {"_id": 0})
        if op_id and latest and op_id in (latest.get("opIds") or []):
            return latest
        raise
    if body.to == "session_ended":
        appt = await apply_transition(appt, "soap_pending", "system")
    if body.to == "completed":
        appt = await apply_transition(appt, "processing", "system")
    if body.to == "cancelled":
        try:
            await note_cancellation(db, coll, appt)
        except Exception:
            logging.getLogger(__name__).error("Opening match failed")
    return appt


@api.put("/soap/{appt_id}")
async def save_soap(appt_id: str, request: Request, doc: dict = Body(...)):
    clinician = await clinical_user(request, appt_id)
    existing = await coll("soap").find_one({"appointmentId": appt_id}, NO_ID)
    if existing and existing.get("status") == "signed":
        raise HTTPException(409, "Signed notes require an amendment workflow (production)")
    appt = await coll("appointments").find_one({"id": appt_id}, NO_ID)
    doc.pop("status", None)
    doc = {**doc, "appointmentId": appt_id, "clientId": appt["clientId"] if appt else doc.get("clientId"),
           "practitionerId": (appt or {}).get("practitionerId"), "status": "draft", "updatedAt": now_iso()}
    if appt:
        doc["consentRef"] = await consent_snapshot(db, appt)
    doc.setdefault("id", existing["id"] if existing else str(uuid.uuid4()))
    await coll("soap").update_one({"appointmentId": appt_id}, {"$set": seal_tree(doc)}, upsert=True)
    await coll("appointments").update_one({"id": appt_id, "soapStatus": {"$ne": "signed"}},
                                          {"$set": {"soapStatus": "draft"}})
    await db.nt_clinical_access.insert_one({"id": "acc-" + uuid.uuid4().hex[:12], "at": now_iso(), "actorId": clinician.get("id"), "action": "soap_draft", "subjectId": appt_id})
    return doc


@api.post("/soap/{appt_id}/sign")
async def sign_soap(appt_id: str, request: Request, body: dict = Body(...)):
    body["by"] = (await clinical_user(request, appt_id))["name"]
    note = await coll("soap").find_one({"appointmentId": appt_id}, NO_ID)
    if not note:
        raise HTTPException(404, "No draft to sign")
    by = body.get("by", "practitioner")
    await coll("soap").update_one({"appointmentId": appt_id},
                                  {"$set": {"status": "signed", "signedAt": now_iso(), "signedBy": by}})
    appt = await coll("appointments").find_one({"id": appt_id}, NO_ID)
    await coll("appointments").update_one({"id": appt_id}, {"$set": {"soapStatus": "signed"}})
    if appt and appt["status"] == "soap_pending":
        await apply_transition({**appt, "soapStatus": "signed"}, "soap_completed", by)
    return {"ok": True}


async def clinical_user(request, appt_id):
    u = await require(request, "owner", "practitioner")
    appt = await coll("appointments").find_one({"id": appt_id}, NO_ID)
    if not appt or (u["role"] == "practitioner" and appt.get("practitionerId") != u["subject"]):
        raise HTTPException(403, "Clinical notes restricted to the treating practitioner")
    return u


async def prepare_assignment(appt, practitioner_id):
    """Reserve a requested visit only when the practitioner, credentials, and route still fit."""
    from availability import practitioner_bookable, qualified
    from onboarding import assignment_credential_problem
    person = await coll("practitioners").find_one({"id": practitioner_id}, NO_ID)
    if not person or person.get("available") is False:
        raise HTTPException(409, "That practitioner is not available")
    service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, NO_ID)
    if not qualified(person, service or {}):
        raise HTTPException(409, "That practitioner is not offered for this service")
    credentials = await db.nt_credentials.find({"practitionerId": practitioner_id}, {"_id": 0}).to_list(20)
    problem = assignment_credential_problem(person, credentials)
    if problem:
        raise HTTPException(409, problem)
    schedule = await db.nt_schedules.find_one({"practitionerId": practitioner_id}, {"_id": 0})
    if not practitioner_bookable(person, schedule):
        raise HTTPException(409, "That practitioner is not available")
    settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
    await assert_public_slot(
        db, coll, settings=settings, production=is_production(), practitioner_id=practitioner_id,
        day=appt["date"], time=appt["time"], duration=int(appt["duration"]), address=appt.get("address") or {},
        location_type=appt.get("locationType") or "home", service=service, exclude_id=appt.get("id"),
    )
    claimed = False
    if appt.get("status") == "requested" and not appt.get("practitionerId"):
        claimed_row = await coll("appointments").update_one(
            {"id": appt["id"], "status": "requested", "practitionerId": None},
            {"$set": {"practitionerId": practitioner_id}},
        )
        if claimed_row.modified_count != 1:
            raise HTTPException(409, "This request was just assigned")
        claimed = True
    try:
        await ensure_slot(practitioner_id, appt["date"], appt["time"], appt["duration"], appt["id"])
    except Exception:
        if claimed:
            await coll("appointments").update_one(
                {"id": appt["id"], "status": "requested", "practitionerId": practitioner_id},
                {"$set": {"practitionerId": None}},
            )
            await db.nt_slot_locks.delete_many({"appointmentId": appt["id"]})
        raise
    return person


async def ensure_slot(practitioner_id, date, time, duration, appt_id):
    start = minutes(time)
    if await slot_taken(practitioner_id, date, start, int(duration), appt_id):
        raise HTTPException(409, "That time was just booked")
    await replace_locks(practitioner_id, date, start, int(duration), appt_id)


async def slot_taken(practitioner_id, date, start, duration, exclude_id=None):
    rows = await coll("appointments").find(
        {"practitionerId": practitioner_id, "date": date, "status": {"$in": list(BLOCKING_STATUSES)}}, NO_ID).to_list(500)
    return any(row["id"] != exclude_id and overlaps(start, duration, minutes(row["time"]), int(row["duration"])) for row in rows)


async def replace_locks(practitioner_id, date, start, duration, appt_id):
    old = await db.nt_slot_locks.find({"appointmentId": appt_id}, {"_id": 0}).to_list(500)
    await db.nt_slot_locks.delete_many({"appointmentId": appt_id})
    end = start + int(duration) + 30
    stamp = datetime.now(timezone.utc).isoformat()
    docs = [{"lockId": f"{practitioner_id}|{date}|{mark}", "appointmentId": appt_id, "practitionerId": practitioner_id,
             "date": date, "createdAt": stamp}
            for mark in range(int(start), int(end))]
    try:
        if docs:
            await db.nt_slot_locks.insert_many(docs, ordered=True)
    except (DuplicateKeyError, BulkWriteError):
        await _reclaim_stale_locks(docs, appt_id, old)


async def _reclaim_stale_locks(docs, appt_id, old):
    """A lock whose appointment is not saved yet still belongs to that booking."""
    held = await db.nt_slot_locks.find({"lockId": {"$in": [d["lockId"] for d in docs]}}, {"_id": 0}).to_list(500)
    foreign = [row for row in held if row.get("appointmentId") != appt_id]
    live_ids = {row["id"] for row in await coll("appointments").find(
        {"id": {"$in": list({row["appointmentId"] for row in foreign})}}, {"_id": 0, "id": 1}).to_list(100)}
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
    stale = [row["appointmentId"] for row in foreign
             if row["appointmentId"] not in live_ids and (row.get("createdAt") or "") <= cutoff]
    fresh = [row for row in foreign if row["appointmentId"] not in set(stale)]
    if not fresh and stale:
        await db.nt_slot_locks.delete_many({"appointmentId": {"$in": list(set(stale))}})
        try:
            if docs:
                await db.nt_slot_locks.insert_many(docs, ordered=True)
            return
        except (DuplicateKeyError, BulkWriteError):
            pass
    await db.nt_slot_locks.delete_many({"appointmentId": appt_id})
    if old:
        await db.nt_slot_locks.insert_many(old)
    raise HTTPException(409, "That time was just booked")


async def claim_promotions(applied):
    claimed = []
    for promo in applied:
        query = {"id": promo["id"]}
        limit = promo.get("redemptionLimit")
        if limit:
            query["redemptions"] = {"$lt": int(limit)}
        result = await coll("promotions").update_one(query, {"$inc": {"redemptions": 1}})
        if result.modified_count:
            claimed.append(promo["id"])
        else:
            return claimed, promo["id"]
    return claimed, None


async def release_promotions(ids):
    if ids:
        await coll("promotions").update_many({"id": {"$in": ids}}, {"$inc": {"redemptions": -1}})


def promotion_rows(promotions, ids):
    return [promo for promo in promotions if promo.get("id") in ids]


@api.post("/appointments/{appt_id}/address")
async def update_service_address(appt_id: str, request: Request, body: dict = Body(...)):
    user = await user_from(request)
    if not user:
        raise HTTPException(401, "Not authenticated")
    appt = await coll("appointments").find_one({"id": appt_id})
    if not appt:
        raise HTTPException(404, "Appointment not found")
    if appt.get("locationType") == "clinic":
        raise HTTPException(400, "Clinic visits do not use a mobile service address")
    if user["role"] == "practitioner":
        raise HTTPException(403, "Ask the client or reception to update the service address")
    if user["role"] == "client" and user.get("subject") != appt.get("clientId"):
        raise HTTPException(403, "Not permitted")
    if user["role"] not in ("client", "owner", "desk"):
        raise HTTPException(403, "Not permitted")
    current = appt.get("address") or {}
    if int(body.get("version") or 0) != int(current.get("version") or 1):
        raise HTTPException(409, "This address was updated. Review the latest version.")
    settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
    zones = await coll("zones").find({}, NO_ID).to_list(20)
    stored, zone, km = await locate_visit(body.get("address") or {}, zones, settings)
    old_travel = float((appt.get("pricing") or {}).get("travel") or 0)
    new_travel = float(money(zone_travel(zone, km, "home")))
    if round(new_travel, 2) != round(old_travel, 2) and body.get("approveFee") is not True:
        raise HTTPException(409, "The travel fee changes with this address. Approve the new fee before it is saved.")
    stored["version"] = int(current.get("version") or 1) + 1
    stored["history"] = (list(current.get("history") or []) + [{"version": current.get("version") or 1, "line": current.get("line"), "at": now_iso()}])[-10:]
    pricing = dict(appt.get("pricing") or {})
    pricing["travel"] = new_travel
    pricing["total"] = round(float(pricing.get("total") or 0) - old_travel + new_travel, 2)
    result = await coll("appointments").update_one(
        {"id": appt_id, "address.version": int(current.get("version") or 1)},
        {"$set": {"address": stored, "pricing": pricing},
         "$push": {"events": {"status": appt.get("status"), "at": now_iso(), "actor": user["name"], "note": "Service address updated"}}},
    )
    if not result.modified_count:
        raise HTTPException(409, "This address was updated. Review the latest version.")
    saved = await coll("appointments").find_one({"id": appt_id}, NO_ID)
    return {"appointment": saved}


async def load_welcome_history(person):
    """Appointments for this client id, email, or phone. A new profile does not hide an earlier visit."""
    matched = []
    async for row in coll("clients").find({}, {"_id": 0, "id": 1, "email": 1, "phone": 1}):
        if client_matches_person(row, person):
            matched.append(row["id"])
    if person.get("id") and person["id"] not in matched:
        matched.append(person["id"])
    if not matched:
        return []
    return await coll("appointments").find(
        {"clientId": {"$in": matched}},
        {"_id": 0, "status": 1, "paymentStatus": 1, "pricing.promoId": 1, "pricing.promoCode": 1, "pricing.welcomeOffer": 1},
    ).to_list(500)


async def claim_welcome(keys, token):
    """One claim per identity key. A second concurrent request loses the benefit instead of both succeeding."""
    inserted = []
    for key in keys:
        try:
            await db.nt_welcome_claims.insert_one({"key": key, "token": token, "at": now_iso()})
            inserted.append(key)
        except DuplicateKeyError:
            if inserted:
                await db.nt_welcome_claims.delete_many({"key": {"$in": inserted}, "token": token})
            return False
    return True


async def release_welcome(token):
    if token:
        await db.nt_welcome_claims.delete_many({"token": token})


def booking_person(client, incoming):
    source_client = client or {}
    return {
        "id": source_client.get("id"),
        "email": str(incoming.get("email") or source_client.get("email") or "").strip().lower(),
        "phone": incoming.get("phone") or source_client.get("phone") or "",
        "dob": source_client.get("dob") or incoming.get("dob") or "",
        "marketingConsent": source_client.get("marketingConsent") if client else bool(incoming.get("marketingConsent")),
        "smsConsent": source_client.get("smsConsent") if client else bool(incoming.get("smsConsent")),
        "onlineBookings": source_client.get("onlineBookings") or 0,
        "_profileComplete": profile_complete(client),
    }


def profile_complete(client):
    """Welcome offer gate: an existing app profile with contact details, a service address and an insurance answer."""
    if not client:
        return False
    address = (client.get("addresses") or [{}])[0] or {}
    has_contact = all(str(client.get(k) or "").strip() for k in ("firstName", "lastName", "email", "phone"))
    insurance_answered = bool(client.get("insurance")) or client.get("noInsurance") is True
    return has_contact and bool(str(address.get("line") or "").strip()) and insurance_answered


async def price_welcome(*, service, duration, addons, zone, client, incoming, promotions, settings, location, km, source):
    person = booking_person(client, incoming)
    offers = list(promotions)
    if source != "online":
        offers = [promo for promo in offers if promo.get("eligibility") != "first_online"]
        person["_welcomeHistory"] = []
    else:
        person["_welcomeHistory"] = await load_welcome_history(person)
    quoted = quote(
        service=service, duration=duration, addons=addons, zone=zone, client=person,
        promotions=offers, settings=settings, location_type=location, km=km,
    )
    return person, offers, quoted


async def bind_trial_campaign(payload):
    """Force standalone trial fields from the campaign. Never invent prices or flip practitioner availability."""
    campaign_id = payload.get("campaignId")
    if not campaign_id:
        return payload, None
    campaign = await db.nt_campaigns.find_one({"id": campaign_id}, NO_ID)
    if not campaign or not is_trial_offer(campaign):
        return payload, campaign
    appointment = dict(payload.get("appointment") or {})
    appointment["serviceSlug"] = campaign.get("serviceSlug") or TRIAL_SERVICE_SLUG
    appointment["duration"] = int(campaign.get("durationMinutes") or campaign.get("complimentaryMinutes") or TRIAL_DURATION_MIN)
    locations = campaign.get("locationTypes") or list(TRIAL_LOCATION_TYPES)
    if appointment.get("locationType") not in locations:
        # Prefer home for mobile Nabitouch trials; do not silently force clinic.
        appointment["locationType"] = "home" if "home" in locations else locations[0]
    appointment["addonIds"] = []
    bound = {**payload, "appointment": appointment, "useCredit": False, "redeemPoints": None, "winbackCode": None, "followupCode": None}
    if campaign.get("practitionerId"):
        bound["practitionerId"] = campaign["practitionerId"]
    return bound, campaign


async def resolve_booking(payload, user):
    """Read the catalogue and appointment history and return a server quote. This does not reserve the offer."""
    incoming = payload.get("client") or {}
    from rbac import normalize_booking_source, has_role
    source = normalize_booking_source(payload.get("source"), default="online")
    if user and has_role(user, "practitioner") and not has_role(user, "owner", "desk", "manager"):
        raise HTTPException(403, "Not permitted")
    if user and has_role(user, "desk") and not has_role(user, "owner", "manager") and not (await reception_perms()).get("createBooking"):
        raise HTTPException(403, "Not permitted")
    if user and user["role"] == "client" and not has_role(user, "owner", "manager", "desk"):
        incoming = {"id": user["subject"]}
    elif (not user) and incoming.get("id"):
        raise HTTPException(403, "Sign in to book for an existing profile")
    payload, trial_campaign = await bind_trial_campaign(payload)
    fields = payload.get("appointment") or {}
    service = await coll("services").find_one({"slug": fields.get("serviceSlug")}, NO_ID)
    duration = fields.get("duration")
    location = fields.get("locationType") or "home"
    reason = booking_block_reason(service, duration, location)
    if reason:
        raise HTTPException(400, reason)
    trial_visit = bool(trial_campaign) or is_trial_service(service)
    if trial_visit and not trial_duration_ok(duration):
        raise HTTPException(400, "The trial visit is exactly 10 minutes")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(fields.get("date") or "")) or not re.fullmatch(r"\d{2}:\d{2}", str(fields.get("time") or "")):
        raise HTTPException(400, "Choose a date and time")
    settings = await coll("settings").find_one({"id": "app"}, NO_ID) or {}
    zones = await coll("zones").find({}, NO_ID).to_list(20)
    address = fields.get("address") or {}
    zone, km = None, 0
    if location == "clinic":
        clinic = settings.get("clinic") or {}
        try:
            address = clinic_visit_address(clinic, address.get("notes"), trial=trial_visit)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    else:
        address, zone, km = await locate_visit(address, zones, settings)
    if (settings.get("clinic") or {}).get("mobileEnabled") is False and location != "clinic":
        raise HTTPException(400, "Mobile booking is not available")
    practitioner_id = payload.get("practitionerId")
    if practitioner_id:
        from profiles import person_booking_block
        practitioner = await coll("practitioners").find_one({"id": practitioner_id}, NO_ID)
        credentials = await db.nt_credentials.find({"practitionerId": practitioner_id}, {"_id": 0}).to_list(20)
        blocked = person_booking_block(practitioner, service, credentials)
        if blocked:
            raise HTTPException(409, blocked)
    await assert_public_slot(
        db, coll, settings=settings, production=is_production(), practitioner_id=practitioner_id or "",
        day=fields["date"], time=fields["time"], duration=int(duration), address=address,
        location_type=location, service=service, trial=trial_visit,
    )
    clients = coll("clients")
    client = await clients.find_one({"id": incoming.get("id")}, NO_ID) if incoming.get("id") else None
    if incoming.get("id") and not client and user and user["role"] in ("owner", "desk"):
        raise HTTPException(404, "Client not found")
    if user and user["role"] == "client" and not client:
        client = await reopen_client_profile(user)
    promotions = await coll("promotions").find({}, NO_ID).to_list(100)
    use_credit = bool(payload.get("useCredit"))
    credit = None
    invite = None
    followup = None
    if trial_visit:
        if use_credit or payload.get("winbackCode") or payload.get("followupCode") or payload.get("redeemPoints"):
            raise HTTPException(409, "The free trial does not combine with credits, rewards, or other offers")
        promotions = []
    if payload.get("winbackCode") and payload.get("followupCode"):
        raise HTTPException(409, "Welcome-back and follow-up codes do not combine")
    if payload.get("winbackCode"):
        if use_credit:
            raise HTTPException(409, "A welcome-back code does not combine with a package credit")
        if not client:
            raise HTTPException(400, "Sign in to use a welcome-back code")
        invite = await valid_invite(db, payload["winbackCode"], client["id"])
        promotions = []
    if payload.get("followupCode"):
        if use_credit:
            raise HTTPException(409, "A follow-up code does not combine with a package credit")
        if not client:
            raise HTTPException(400, "Sign in to use a follow-up code")
        followup = await valid_followup(db, payload["followupCode"], client["id"])
        promotions = []
    if use_credit:
        if not client:
            raise HTTPException(400, "Sign in to use a package credit")
        if is_trial_service(service):
            raise HTTPException(409, "Package credits do not apply to the free trial")
        credit = await available_credit(db, client["id"], service["slug"], duration)
        if not credit:
            raise HTTPException(409, "No package credit is available for this treatment")
        promotions = []
    person, promotions, quoted = await price_welcome(
        service=service, duration=duration, addons=fields.get("addonIds") or [], zone=zone, client=client,
        incoming=incoming, promotions=promotions, settings=settings, location=location, km=km, source=source,
    )
    if trial_visit:
        quoted = {
            **quoted,
            "discount": 0,
            "appliedPromoIds": [],
            "promoId": None,
            "promoName": None,
            "promoCode": None,
            "welcomeOffer": False,
            "addons": 0,
            "addonList": [],
            "travel": 0,
            "tax": 0,
            "total": 0,
            "base": 0,
            "treatmentAfterDiscount": 0,
            "campaignOfferKind": "trial",
            "complimentaryMinutes": TRIAL_DURATION_MIN,
            "campaignTitle": (trial_campaign or {}).get("title") or "10 Minutes. On Us.",
        }
    if invite:
        quoted = winback_quote(quoted, float(invite["percent"]), float(settings.get("gst") if settings.get("gst") is not None else 0.05), service)
    if followup:
        quoted = followup_quote(quoted, float(followup["percent"]), float(settings.get("gst") if settings.get("gst") is not None else 0.05), service)
    if credit:
        quoted = credit_quote(quoted, credit["unitCents"], float(settings.get("gst") if settings.get("gst") is not None else 0.05), service)
    payment_policy = resolve_payment_policy(
        settings.get("paymentPolicy"), production=is_production(), explicit=isinstance(settings.get("paymentPolicy"), dict) and bool(settings.get("paymentPolicy")),
    )
    try:
        due = due_for_booking(quoted["total"], payment_policy, fields)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "incoming": incoming, "source": source, "fields": fields, "service": service, "duration": duration,
        "location": location, "address": address, "zone": zone, "km": km, "settings": settings,
        "practitioner_id": practitioner_id, "client": client, "person": person, "promotions": promotions, "quoted": quoted,
        "settlement": due, "paymentPolicy": payment_policy, "useCredit": bool(credit),
        "winbackCode": invite["code"] if invite else None,
        "followupCode": followup["code"] if followup else None,
        "trialVisit": trial_visit,
        "trialCampaign": trial_campaign,
    }


@api.post("/bookings/quote")
async def preview_booking_quote(request: Request, payload: dict = Body(...)):
    """Provisional server price. It does not reserve the welcome benefit or create a visit."""
    ctx = await resolve_booking(payload, await user_from(request))
    pricing = dict(ctx["quoted"])
    if payload.get("campaignId") and not ctx["useCredit"] and not ctx["winbackCode"] and not ctx.get("followupCode") and not pricing.get("welcomeOffer"):
        offer = await campaign_quote(
            db, payload["campaignId"], ctx["person"] or ctx["client"], ctx["fields"]["date"], ctx["fields"]["time"], ctx["duration"], ctx["service"]["slug"], ctx["location"],
        )
        if offer:
            pricing["campaignTitle"] = offer["title"]
            pricing["campaignId"] = payload["campaignId"]
            if offer.get("complimentaryMinutes"):
                pricing["complimentaryMinutes"] = offer["complimentaryMinutes"]
            pricing = apply_campaign_price(pricing, offer, ctx["settings"].get("gst", 0.05), offer.get("stackable"))
    if ctx.get("trialVisit"):
        pricing = {
            **pricing,
            "total": 0, "tax": 0, "travel": 0, "addons": 0, "base": 0, "discount": 0,
            "welcomeOffer": False, "campaignOfferKind": "trial", "complimentaryMinutes": TRIAL_DURATION_MIN,
            "campaignTitle": pricing.get("campaignTitle") or "10 Minutes. On Us.",
            "campaignId": payload.get("campaignId"),
        }
    try:
        due = due_for_booking(pricing["total"], ctx["paymentPolicy"], ctx["fields"]) if float(pricing.get("total") or 0) > 0 else None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "pricing": pricing, "provisional": True, "welcomeOffer": bool(pricing.get("welcomeOffer")), "packageCredit": bool(pricing.get("packageCredit")),
        "settlement": due, "paymentPolicy": ctx.get("paymentPolicy"), "trialVisit": bool(ctx.get("trialVisit")),
        "paymentRequired": False if ctx.get("trialVisit") else bool(due and due.get("dueNowCents")),
    }


@api.post("/bookings")
async def create_booking(request: Request, payload: dict = Body(...)):
    user = await user_from(request)
    early = payload.get("client") or {}
    if user and user["role"] == "client":
        early = {"id": user["subject"]}
    if payload.get("idempotencyKey") and early.get("id"):
        existing = await coll("appointments").find_one({"idempotencyKey": f"{early['id']}:{payload['idempotencyKey']}"}, NO_ID)
        if existing:
            await _queue_booking_mail(existing, existing["clientId"])
            return {"appointment": existing, "clientId": existing["clientId"]}
    ctx = await resolve_booking(payload, user)
    incoming = ctx["incoming"]
    source = ctx["source"]
    fields = ctx["fields"]
    service = ctx["service"]
    duration = ctx["duration"]
    location = ctx["location"]
    address = ctx["address"]
    zone = ctx["zone"]
    km = ctx["km"]
    settings = ctx["settings"]
    practitioner_id = ctx["practitioner_id"]
    clients = coll("clients")
    client = ctx["client"]
    person = ctx["person"]
    promotions = ctx["promotions"]
    quoted = ctx["quoted"]
    trial_visit = bool(ctx.get("trialVisit"))
    claimed_ids = []
    counted_online = False
    welcome_token = None
    if quoted.get("welcomeOffer") and not trial_visit:
        keys = identity_keys(person)
        token = uuid.uuid4().hex if keys else None
        if not keys or not await claim_welcome(keys, token):
            welcome_token = None
            promotions = [promo for promo in promotions if promo.get("eligibility") != "first_online"]
            person, promotions, quoted = await price_welcome(
                service=service, duration=duration, addons=fields.get("addonIds") or [], zone=zone, client=client,
                incoming=incoming, promotions=promotions, settings=settings, location=location, km=km, source=source,
            )
        else:
            welcome_token = token
    if source == "online" and client and not trial_visit:
        await clients.update_one({"id": client["id"]}, {"$inc": {"onlineBookings": 1}})
        counted_online = True
    applied = promotion_rows(promotions, quoted["appliedPromoIds"])
    claimed_ids, failed = await claim_promotions(applied)
    if failed:
        await release_promotions(claimed_ids)
        if welcome_token and any(promo.get("id") == failed and promo.get("eligibility") == "first_online" for promo in promotions):
            await release_welcome(welcome_token)
            welcome_token = None
        promotions = [promo for promo in promotions if promo.get("id") != failed]
        person, promotions, quoted = await price_welcome(
            service=service, duration=duration, addons=fields.get("addonIds") or [], zone=zone, client=client,
            incoming=incoming, promotions=promotions, settings=settings, location=location, km=km, source=source,
        )
        claimed_ids, failed = await claim_promotions(promotion_rows(promotions, quoted["appliedPromoIds"]))
        if failed:
            await release_promotions(claimed_ids)
            await release_welcome(welcome_token)
            welcome_token = None
            raise HTTPException(409, "That promotion is no longer available")
    if not client:
        client_id = f"c-{uuid.uuid4().hex[:8]}"
        client = {"id": client_id, "firstName": incoming.get("firstName") or "Guest", "lastName": incoming.get("lastName") or "",
                  "email": str(incoming.get("email") or "").lower(), "phone": incoming.get("phone") or "", "dob": incoming.get("dob") or "",
                  "marketingConsent": bool(incoming.get("marketingConsent")), "smsConsent": bool(incoming.get("smsConsent")), "addresses": [], "insurance": [], "favorites": [],
                  "preferredPractitioners": [], "loyaltyPoints": 0, "onlineBookings": 0 if trial_visit else (1 if source == "online" else 0),
                  "hasProfile": False, "createdAt": now_iso()}
        await clients.insert_one(dict(client))
    else:
        client_id = client["id"]
    campaign_reservation = None
    if payload.get("campaignId"):
        if ctx.get("followupCode") or ctx.get("winbackCode") or ctx.get("useCredit"):
            await release_promotions(claimed_ids)
            await release_welcome(welcome_token)
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise HTTPException(409, "Campaigns do not combine with package credits, welcome-back, or follow-up codes")
        try:
            audience_client = {**(client or {}), "_welcomeHistory": (person or {}).get("_welcomeHistory")}
            campaign_reservation = await reserve_campaign(
                db, payload["campaignId"], audience_client, payload.get("idempotencyKey"), fields["date"], fields["time"], int(duration), service["slug"], location,
            )
        except HTTPException:
            await release_promotions(claimed_ids)
            await release_welcome(welcome_token)
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise
        if campaign_reservation and quoted.get("welcomeOffer") and not trial_visit:
            # Flash discounts yield to the first-booking welcome offer.
            await release_campaign(db, campaign_reservation)
            campaign_reservation = None
        elif campaign_reservation:
            if not campaign_reservation.get("stackable"):
                await release_promotions(claimed_ids)
                claimed_ids = []
                quoted = {**quoted, "discount": 0, "appliedPromoIds": [], "promoId": None, "promoName": None, "promoCode": None, "welcomeOffer": False}
            quoted["campaignTitle"] = campaign_reservation.get("title")
            quoted["campaignId"] = payload["campaignId"]
            if campaign_reservation.get("complimentaryMinutes"):
                quoted["complimentaryMinutes"] = campaign_reservation["complimentaryMinutes"]
            quoted = apply_campaign_price(quoted, campaign_reservation, settings.get("gst", 0.05), campaign_reservation.get("stackable"))
            if trial_visit or is_trial_offer(campaign_reservation):
                quoted = {
                    **quoted, "total": 0, "tax": 0, "travel": 0, "addons": 0, "base": 0,
                    "welcomeOffer": False, "campaignOfferKind": "trial", "complimentaryMinutes": TRIAL_DURATION_MIN,
                }
    appt_id = f"a-{uuid.uuid4().hex[:8]}"
    loyalty_points = 0
    if (ctx.get("useCredit") or ctx.get("winbackCode") or ctx.get("followupCode")) and (payload.get("redeemPoints") or campaign_reservation):
        await release_campaign(db, campaign_reservation)
        if counted_online:
            await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
        raise HTTPException(409, "Package credits, welcome-back, and follow-up codes do not combine with campaigns or rewards")
    if payload.get("redeemPoints") and quoted.get("welcomeOffer"):
        await release_promotions(claimed_ids)
        await release_campaign(db, campaign_reservation)
        await release_welcome(welcome_token)
        if counted_online:
            await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
        raise HTTPException(409, "The first-booking welcome offer does not combine with rewards")
    if payload.get("redeemPoints"):
        try:
            quoted, loyalty_points = await reserve_redemption(db, coll, settings, quoted, payload.get("redeemPoints"), client_id, appt_id)
        except HTTPException:
            await release_promotions(claimed_ids)
            await release_campaign(db, campaign_reservation)
            await release_welcome(welcome_token)
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise
    if practitioner_id:
        try:
            await ensure_slot(practitioner_id, fields["date"], fields["time"], duration, appt_id)
        except HTTPException:
            await release_promotions(claimed_ids)
            await release_campaign(db, campaign_reservation)
            await release_redemption(db, coll, client_id, appt_id, loyalty_points)
            await release_welcome(welcome_token)
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise
    seq = await db.nt_counters.find_one_and_update({"id": "booking"}, {"$inc": {"n": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    ts = now_iso()
    status = "assigned" if practitioner_id else "requested"
    idem = payload.get("idempotencyKey")
    preferences = fields.get("preferences") if isinstance(fields.get("preferences"), dict) else {}
    quoted.setdefault("loyaltyPoints", 0)
    quoted.setdefault("loyaltyService", 0)
    quoted.setdefault("loyaltyTravel", 0)
    quoted.setdefault("welcomeOffer", False)
    appt = {"id": appt_id, "ref": f"NT-{1100 + int(seq['n'])}", "clientId": client_id, "serviceSlug": service["slug"],
            "duration": int(duration), "date": fields["date"], "time": fields["time"], "practitionerId": practitioner_id,
            "status": status, "locationType": location, "address": address, "pricing": {k: quoted[k] for k in
            ("base", "addons", "addonList", "discount", "promoId", "promoName", "promoCode", "welcomeOffer", "travel", "tax", "total", "treatmentAfterDiscount", "loyaltyPoints", "loyaltyService", "loyaltyTravel", "packageCredit", "creditUnit", "winback", "followUp", "campaignId", "campaignOfferKind", "complimentaryMinutes", "campaignTitle") if k in quoted},
            "paymentMethod": "insurance" if fields.get("paymentMethod") == "insurance" else "self",
            "insuranceId": fields.get("insuranceId"), "selfMethod": fields.get("selfMethod"), "preferences": preferences,
            "checkedIn": False, "feedback": None, "events": [{"status": "requested", "at": ts, "actor": user["name"] if user else "client"}] +
            ([{"status": "assigned", "at": ts, "actor": "system"}] if status == "assigned" else []),
            "timestamps": {"requested": ts, **({"assigned": ts} if status == "assigned" else {})},
            "soapStatus": "none", "timer": {"pausedMs": 0}, "source": source, "createdAt": ts, "payments": []}
    if trial_visit:
        appt["appointmentKind"] = "trial"
        appt["treatmentScope"] = (service or {}).get("treatmentScope") or "neck_shoulders"
        appt["countsAsRevenue"] = False
        appt["paymentStatus"] = "waived"
        quoted["total"] = 0
        quoted["tax"] = 0
        appt["pricing"] = {**appt["pricing"], "total": 0, "tax": 0, "travel": 0, "addons": 0, "base": 0,
                           "welcomeOffer": False, "campaignOfferKind": "trial", "complimentaryMinutes": TRIAL_DURATION_MIN}
    if idem:
        appt["idempotencyKey"] = f"{client_id}:{idem}"
    is_ins = appt["paymentMethod"] == "insurance" and not trial_visit
    if trial_visit:
        appt["paymentMethod"] = "self"
        appt["selfMethod"] = None
        appt["payNow"] = None
    appt["claim"] = {"status": "verification_pending" if is_ins else "none",
                     "eligible": claim_eligible(appt["pricing"], settings.get("gst", 0.05)) if is_ins else 0,
                     "approved": 0, "insurerPayment": "none", "insurerPaid": 0, "history": []}
    try:
        due = None if trial_visit or float(quoted.get("total") or 0) <= 0 else due_for_booking(quoted["total"], ctx["paymentPolicy"], fields)
    except ValueError as exc:
        await release_promotions(claimed_ids)
        await release_campaign(db, campaign_reservation)
        await release_redemption(db, coll, client_id, appt_id, loyalty_points)
        await release_welcome(welcome_token)
        await db.nt_slot_locks.delete_many({"appointmentId": appt_id})
        if counted_online:
            await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
        raise HTTPException(400, str(exc)) from exc
    if due:
        appt["payNow"] = due["choice"]
        appt["paymentDue"] = {
            "totalCents": due["totalCents"], "dueNowCents": due["dueNowCents"], "remainingCents": due["remainingCents"],
            "paidCents": 0, "refundedCents": 0, "status": due["status"], "prepaid": False,
        }
        if due["choice"] == "cash":
            appt["selfMethod"] = "cash"
    appt = with_settle(appt)
    try:
        await coll("appointments").insert_one(dict(appt))
    except (DuplicateKeyError, BulkWriteError):
        await release_promotions(claimed_ids)
        await release_campaign(db, campaign_reservation)
        await release_redemption(db, coll, client_id, appt_id, loyalty_points)
        await release_welcome(welcome_token)
        await db.nt_slot_locks.delete_many({"appointmentId": appt_id})
        if counted_online:
            await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
        existing = await coll("appointments").find_one({"idempotencyKey": appt.get("idempotencyKey")}, NO_ID)
        if existing:
            await _queue_booking_mail(existing, client_id)
            return {"appointment": existing, "clientId": client_id}
        raise HTTPException(409, "Booking could not be saved")
    appt.pop("_id", None)
    await remember_confirmed_address(client_id, appt.get("address"), (fields.get("address") or {}).get("id"))
    if ctx.get("winbackCode"):
        try:
            await reserve_invite(db, ctx["winbackCode"], client_id, appt["id"])
        except HTTPException:
            await coll("appointments").delete_one({"id": appt["id"]})
            await db.nt_slot_locks.delete_many({"appointmentId": appt["id"]})
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise
    if ctx.get("followupCode"):
        try:
            await reserve_followup(db, ctx["followupCode"], client_id, appt["id"])
        except HTTPException:
            await coll("appointments").delete_one({"id": appt["id"]})
            await db.nt_slot_locks.delete_many({"appointmentId": appt["id"]})
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise
    if ctx.get("useCredit"):
        try:
            reserved = await reserve_credit(db, client_id, service["slug"], duration, appt["id"], user["name"] if user else "client")
            await coll("appointments").update_one({"id": appt["id"]}, {"$set": {"creditId": reserved["id"]}})
            appt["creditId"] = reserved["id"]
        except HTTPException:
            await coll("appointments").delete_one({"id": appt["id"]})
            await db.nt_slot_locks.delete_many({"appointmentId": appt["id"]})
            await release_promotions(claimed_ids)
            await release_welcome(welcome_token)
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise
    if payload.get("recoveryCaseId"):
        try:
            await consume_recovery_hold(db, payload["recoveryCaseId"], client_id, appt["id"])
        except HTTPException:
            await coll("appointments").delete_one({"id": appt["id"]})
            await db.nt_slot_locks.delete_many({"appointmentId": appt["id"]})
            await release_promotions(claimed_ids)
            await release_campaign(db, campaign_reservation)
            await release_redemption(db, coll, client_id, appt_id, loyalty_points)
            await release_welcome(welcome_token)
            if counted_online:
                await clients.update_one({"id": client_id}, {"$inc": {"onlineBookings": -1}})
            raise
    if campaign_reservation:
        await award_campaign(db, campaign_reservation, appt["id"], quoted.get("total") or 0, quoted.get("discount") or 0)
    await add_audit(user["name"] if user else (incoming.get("firstName") or "client"), f"{appt['ref']} booked ({appt['source']})", appt["id"])
    await _queue_booking_mail(appt, client_id)
    if practitioner_id:
        await _queue_practitioner_mail(appt, "practitioner_booking")
        await push_notify(db, "visit_assigned", f"{appt['id']}:{practitioner_id}:create", appt)
    tracking = await issue_guest_capability(appt_id) if not user else None
    body = {"appointment": appt, "clientId": client_id}
    if tracking:
        body["trackingCapability"] = tracking
    return body


async def _queue_booking_mail(appt, client_id):
    _note, created = await enqueue_booking_confirmation(db, appt, client_id)
    if created:
        await add_audit("system", f"{appt['ref']} confirmation email queued", appt["id"])


async def _queue_practitioner_mail(appt, kind):
    """Queue practitioner operational email when the feature flag is on."""
    if not practitioner_booking_email_enabled() or not appt.get("practitionerId"):
        return
    _note, created = await enqueue_practitioner_notice(db, appt, kind)
    if created:
        await add_audit("system", f"{appt.get('ref')} {kind} email queued", appt["id"])


async def _maybe_lifecycle_mail(appt, kind):
    """Queue cancellation, reschedule, or assignment mail only when that flag is on."""
    if not email_lifecycle_enabled() or not appt.get("clientId"):
        return
    _note, created = await enqueue_operational(db, appt, appt["clientId"], kind)
    if created:
        await add_audit("system", f"{appt.get('ref')} {kind} email queued", appt["id"])


async def _deliver_practitioner_notice(note):
    """Practitioner operational email. No clinical notes or health details."""
    appt = await coll("appointments").find_one({"id": note.get("appointmentId")}, NO_ID)
    if not appt:
        raise PermanentDelivery("appointment_missing")
    account = await resolve_practitioner_account(db, note.get("practitionerId") or appt.get("practitionerId"))
    if not account:
        raise CancelDelivery("no_recipient")
    service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, NO_ID) or {}
    when = datetime.strptime(f"{appt['date']} {appt['time']}", "%Y-%m-%d %H:%M")
    pretty = when.strftime("%A, %B %d, %Y at %I:%M %p")
    brand = escape(os.environ["EMAIL_FROM_NAME"])
    link = f"{os.environ['APP_URL'].rstrip('/')}/pro/visit/{appt['id']}"
    location = "In clinic" if appt.get("locationType") == "clinic" else "Mobile / at client"
    titles = {
        "practitioner_booking": "New booking assigned to you",
        "practitioner_cancellation": "A visit was cancelled",
        "practitioner_reschedule": "A visit was rescheduled",
        "practitioner_reassignment": "A visit was assigned to you",
    }
    title = titles.get(note.get("kind"), "Visit update")
    rows = [
        ("Service", f"{service.get('name') or appt.get('serviceSlug')} · {appt.get('duration')} min"),
        ("When", pretty),
        ("Where", location),
        ("Booking ref", appt.get("ref") or ""),
        ("Status", str(appt.get("status") or "").replace("_", " ")),
    ]
    table = "".join(
        f'<tr><td style="padding:6px 12px 6px 0;color:#6B8296;font-size:13px">{escape(k)}</td>'
        f'<td style="padding:6px 0;font-size:14px;font-weight:bold">{escape(str(v))}</td></tr>'
        for k, v in rows
    )
    html = (
        f'<table role="presentation" width="100%" style="background:#F4F9FC"><tr><td style="padding:32px 24px;font-family:Arial,sans-serif;color:#0F2A3D">'
        f'<p style="font-size:20px;font-weight:bold;margin:0">{brand}</p>'
        f'<p>Hi {escape(account.get("name") or "there")},</p>'
        f'<p>{escape(title)}.</p>'
        f'<table role="presentation" style="margin:12px 0 20px">{table}</table>'
        f'<p style="margin:24px 0"><a href="{escape(link)}" style="background:#1565F0;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Open visit</a></p>'
        f'<p style="font-size:12px;color:#6B8296;margin-top:24px">Times are America/Edmonton. Clinical notes are not included in this email.</p></td></tr></table>'
    )
    return await _send_note(note, to=account["email"], subject=f"{title} — {os.environ['EMAIL_FROM_NAME']}", html=html)


async def _send_note(note, *, to, subject, html, idempotency_key=None):
    await freeze_delivery(db, note, {"to": to, "subject": subject, "html": html,
        "from": os.environ.get("EMAIL_FROM"), "reply": os.environ.get("EMAIL_REPLY_TO"),
        "redirect": os.environ.get("EMAIL_TEST_RECIPIENT"), "app": os.environ.get("APP_URL")})
    try:
        return await send_email(to=to, subject=subject, html=html, idempotency_key=note["id"])
    except HTTPException as exc:
        if exc.status_code in (408, 429, 500, 503):
            raise TransientDelivery("provider_unavailable") from None
        raise PermanentDelivery("provider_rejected") from None


async def _deliver_billing(note):
    """Invoice, receipt, and payment-link mail. Amounts come from the invoice ledger view."""
    from billing import public_invoice
    invoice = await db.nt_invoices.find_one({"id": note.get("invoiceId")}, NO_ID)
    if not invoice:
        raise PermanentDelivery("invoice_missing")
    client = await coll("clients").find_one({"id": invoice.get("clientId")}, NO_ID) or {}
    to = (client.get("email") or "").strip().lower()
    if not to or to.endswith("@example.com"):
        raise CancelDelivery("no_recipient")
    ledger = await db.nt_ledger.find({"invoiceId": invoice["id"]}, NO_ID).sort("at", 1).to_list(500)
    view = public_invoice(invoice, ledger)
    link = f"{os.environ['APP_URL'].rstrip('/')}/me/billing"
    build = {"invoice": invoice_email, "receipt": receipt_email, "payment_link": payment_link_email, "billing_update": billing_update_email}[note["kind"]]
    subject, html = build(os.environ["EMAIL_FROM_NAME"], client.get("preferredName") or client.get("firstName") or "there", view, link)
    try:
        return await _send_note(note, to=to, subject=subject, html=html)
    except HTTPException as exc:
        if exc.status_code in (408, 429, 500, 503):
            raise TransientDelivery("provider_unavailable") from exc
        raise PermanentDelivery("provider_rejected") from exc


async def _deliver_booking(note):
    """Build a booking email from the appointment and client rows. Clinical fields stay out of the message."""
    if note.get("kind") == "email_test":
        subject, html = email_test_message()
        return await _send_note(note, to=note["testRecipient"], subject=subject, html=html)
    if note.get("kind") in ("invoice", "receipt", "payment_link", "billing_update"):
        return await _deliver_billing(note)
    if note.get("kind") == "statement":
        row = await db.nt_pay_statements.find_one({"id": note.get("statementId")}, NO_ID)
        account = await resolve_practitioner_account(db, (row or {}).get("practitionerId")) if row else None
        if not row or not account:
            raise CancelDelivery("no_recipient")
        subject, html = statement_email(os.environ["EMAIL_FROM_NAME"], account.get("name") or "there", f"{row['start']} to {row['end']}", row["kpis"][0][1],
                                        f"{os.environ['APP_URL'].rstrip('/')}/pro/earnings")
        try:
            return await _send_note(note, to=account["email"], subject=subject, html=html)
        except HTTPException as exc:
            raise (TransientDelivery("provider_unavailable") if exc.status_code in (408, 429, 500, 503) else PermanentDelivery("provider_rejected")) from exc
    if note.get("kind") in ("practitioner_booking", "practitioner_cancellation", "practitioner_reschedule", "practitioner_reassignment"):
        return await _deliver_practitioner_notice(note)
    appt = await coll("appointments").find_one({"id": note.get("appointmentId")}, NO_ID)
    if not appt:
        raise PermanentDelivery("appointment_missing")
    client = await coll("clients").find_one({"id": note.get("clientId")}, NO_ID) or {}
    to = (client.get("email") or "").strip().lower()
    if not to or to.endswith("@example.com"):
        raise CancelDelivery("no_recipient")
    service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, NO_ID) or {}
    practitioner = await coll("practitioners").find_one({"id": appt.get("practitionerId")}, NO_ID) if appt.get("practitionerId") else None
    when = datetime.strptime(f"{appt['date']} {appt['time']}", "%Y-%m-%d %H:%M")
    pretty = when.strftime("%A, %B %d, %Y at %I:%M %p")
    short = when.strftime("%a %b %d, %I:%M %p")
    brand = escape(os.environ["EMAIL_FROM_NAME"])
    link = f"{os.environ['APP_URL'].rstrip('/')}/me"
    kind = note.get("kind") or "booking_confirmation"
    if kind == "review_invite":
        subject, html = review_invitation_email(os.environ["EMAIL_FROM_NAME"], client.get("firstName") or "there", f"{os.environ['APP_URL'].rstrip('/')}/me/reviews?appt={appt['id']}")
        return await _send_note(note, to=to, subject=subject, html=html)
    if kind != "booking_confirmation":
        titles = {
            "cancellation": "Your visit was cancelled",
            "reschedule": "Your visit was rescheduled",
            "assignment": "A therapist is assigned to your visit",
            "reminder_24h": "Your visit is tomorrow",
            "reminder_2h": "Your visit starts soon",
        }
        title = titles.get(kind, "Your visit was updated")
        html = (f'<table role="presentation" width="100%" style="background:#F4F9FC"><tr><td style="padding:32px 24px;font-family:Arial,sans-serif;color:#0F2A3D">'
                f'<p style="font-size:20px;font-weight:bold;margin:0">{brand}</p>'
                f'<p>Hi {escape(client.get("preferredName") or client.get("firstName") or "there")},</p>'
                f'<p>{escape(title)}. Booking {escape(appt.get("ref") or "")} is now {escape(str(appt.get("status") or "").replace("_", " "))} '
                f'on {escape(str(appt.get("date") or ""))} at {escape(str(appt.get("time") or ""))}.</p>'
                f'<p style="margin:24px 0"><a href="{escape(link)}" style="background:#1565F0;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">View your visit</a></p>'
                f'<p style="font-size:12px;color:#6B8296;margin-top:24px">Sent by {brand}. We never ask for your password or card details by email.</p></td></tr></table>')
        try:
            return await _send_note(note,
                to=to, subject=f"{title} — {os.environ['EMAIL_FROM_NAME']}", html=html, idempotency_key=note.get("id"),
            )
        except HTTPException as exc:
            if exc.status_code in (408, 429, 500, 503):
                raise TransientDelivery("provider_unavailable") from exc
            raise PermanentDelivery("provider_rejected") from exc
    pricing = appt.get("pricing") or {}
    rows = [("Service", f"{service.get('name', appt.get('serviceSlug'))} · {appt.get('duration')} min"),
            ("When", pretty),
            ("Therapist", practitioner["name"] if practitioner else "We'll confirm your therapist shortly"),
            ("Where", _where_line(appt.get("address") or {})), ("Booking ref", appt["ref"])]
    if float(pricing.get("discount") or 0) > 0:
        label = "First-booking welcome offer" if pricing.get("welcomeOffer") else (pricing.get("promoName") or "Discount")
        rows.append((label, f"-{float(pricing['discount']):.2f}"))
    if pricing.get("total") is not None:
        rows.append(("Total", f"{float(pricing['total']):.2f} CAD"))
    table = "".join(f'<tr><td style="padding:6px 12px 6px 0;color:#6B8296;font-size:13px">{k}</td><td style="padding:6px 0;font-size:14px;font-weight:bold">{escape(str(v))}</td></tr>' for k, v in rows)
    html = (f'<table role="presentation" width="100%" style="background:#F4F9FC"><tr><td style="padding:32px 24px;font-family:Arial,sans-serif;color:#0F2A3D">'
            f'<p style="font-size:20px;font-weight:bold;margin:0">{brand}</p><p style="margin:4px 0 20px;color:#0E9E9A;font-size:13px">Breathe. Feel. Heal. Anywhere.</p>'
            f'<p>Hi {escape(client.get("preferredName") or client.get("firstName") or "there")},</p><p>Your massage is booked. Here are the details:</p>'
            f'<table role="presentation" style="margin:12px 0 20px">{table}</table>'
            f'<p>On the day, you can follow your therapist live on the map once they start travelling to you.</p>'
            f'<p style="margin:24px 0"><a href="{escape(link)}" style="background:#18A8F5;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Track your therapist</a></p>'
            f'<p style="font-size:13px;color:#6B8296">Need to change something? Sign in to your account to view or manage this booking.</p>'
            f'<p style="font-size:12px;color:#6B8296;margin-top:24px">Sent by {brand}. We never ask for your password or card details by email.</p></td></tr></table>')
    try:
        return await _send_note(note,
            to=to, subject=f"Your {os.environ['EMAIL_FROM_NAME']} massage is booked — {short}", html=html,
            idempotency_key=note.get("id"),
        )
    except HTTPException as exc:
        if exc.status_code in (408, 429, 500, 503):
            raise TransientDelivery("provider_unavailable") from exc
        raise PermanentDelivery("provider_rejected") from exc


CLIENT_FIELDS = {"firstName", "lastName", "preferredName", "email", "phone", "dob", "language", "contactMethod", "noInsurance", "preferredNavApp",
                 "emergencyContact", "marketingConsent", "smsConsent", "photo", "addresses", "paymentPreference", "insurance",
                 "favorites", "preferredPractitioners"}
PROMO_FIELDS = {"enabled", "name", "type", "value", "maxDiscount", "eligibility", "start", "end", "services",
                "stackable", "redemptionLimit", "appliesTo", "requiresMarketingConsent", "code", "approval",
                "placements", "bannerHeadline", "bannerBody"}
ZONE_FIELDS = {"enabled", "radiusKm", "fee", "perKm", "name", "color"}
SETTINGS_FIELDS = {"gst", "cashEnabled", "clinic", "addons", "receptionPerms", "liveGpsPractitionerId", "center", "credentialReminderDays", "requireMfaForPrivileged", "mfaEnforcePrivileged", "cancellationPolicy", "cancellationFee", "scheduling", "recovery", "rewards", "paymentPolicy", "whatsapp"}
PLAN_FIELDS = {"title", "sessionsTotal", "sessionsDone", "homeCare", "nextReview", "visibleToClient", "frequency", "goals", "followUpDays"}


def lock_client_insurance(existing, incoming):
    previous = {item.get("id"): item for item in (existing or []) if isinstance(item, dict)}
    locked = []
    for item in incoming or []:
        if not isinstance(item, dict):
            continue
        prior = previous.get(item.get("id"))
        item = {**item, "status": prior.get("status") if prior else "ready_for_verification"}
        item.pop("cardImage", None)
        locked.append(item)
    return locked


@api.get("/services")
async def services_catalogue(request: Request):
    return await list_services(db, await user_from(request))


@api.get("/services/{service_id}")
async def service_detail(service_id: str, request: Request):
    return await read_service(db, await user_from(request), service_id)


@api.post("/services")
async def service_create(request: Request, payload: dict = Body(...)):
    return await create_service(db, await require(request), payload)


@api.post("/services/{service_id}/archive")
async def service_archive(service_id: str, request: Request):
    return await archive_service(db, await require(request), service_id)


@api.post("/services/{service_id}/restore")
async def service_restore(service_id: str, request: Request):
    return await restore_service(db, await require(request), service_id)


@api.delete("/services/{service_id}")
async def service_delete(service_id: str, request: Request):
    return await delete_service(db, await require(request), service_id)


@api.post("/services/{service_id}/draft")
async def service_draft(service_id: str, request: Request):
    return await draft_service(db, await require(request), service_id)


@api.post("/services/{service_id}/preview")
async def service_preview(service_id: str, request: Request):
    return await preview_service(db, await require(request), service_id)


@api.post("/services/{service_id}/publish")
async def service_publish(service_id: str, request: Request):
    return await publish_service(db, await require(request), service_id)


@api.get("/practitioners/{key}")
async def practitioner_profile(key: str, request: Request):
    return await read_profile(db, await user_from(request), key)


@api.put("/practitioners/{practitioner_id}/profile")
async def practitioner_profile_update(practitioner_id: str, request: Request, payload: dict = Body(...)):
    return await update_profile(db, await require(request), practitioner_id, payload)


def only_fields(doc, allowed, owned=()):
    unknown = set(doc) - set(allowed) - set(owned)
    if unknown:
        raise HTTPException(400, "Fields not permitted: " + ", ".join(sorted(unknown)))
    kept = {key: value for key, value in doc.items() if key in allowed}
    if not kept:
        raise HTTPException(400, "No permitted fields")
    return kept


@api.post("/promotions")
async def promotion_create(request: Request, doc: dict = Body(...)):
    user = await require(request)
    if user["role"] != "owner":
        raise HTTPException(403, "Not permitted")
    name = " ".join(str(doc.get("name") or "").split())
    code = " ".join(str(doc.get("code") or "").split()).upper()
    kind = doc.get("type")
    if len(name) < 2 or len(code) < 3 or kind not in ("percent", "fixed"):
        raise HTTPException(400, "A promotion needs a name, code, and a percent or fixed discount")
    if await coll("promotions").find_one({"code": code}):
        raise HTTPException(409, "That promotion code already exists")
    eligibility = doc.get("eligibility") or "referral"
    if eligibility == "first_online":
        raise HTTPException(409, "The first-booking welcome offer already exists")
    start, end = str(doc.get("start") or ""), str(doc.get("end") or "")
    if start and end and end < start:
        raise HTTPException(400, "The end date must be on or after the start date")
    try:
        value = float(doc.get("value") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "The discount must be a number")
    if value <= 0 or (kind == "percent" and value > 100):
        raise HTTPException(400, "Enter a discount greater than zero, up to 100 percent")
    placements = doc.get("placements") if isinstance(doc.get("placements"), list) else ["home", "account"]
    placements = [str(p) for p in placements if isinstance(p, str)][:12] or ["home", "account"]
    stored = {
        "id": f"promo-{uuid.uuid4().hex[:8]}", "name": name, "code": code, "type": kind, "value": value,
        "maxDiscount": doc.get("maxDiscount"), "eligibility": eligibility, "start": start, "end": end,
        "services": doc.get("services") if doc.get("services") not in (None, "") else "all",
        "stackable": False, "redemptionLimit": doc.get("redemptionLimit"),
        "enabled": False, "approval": "pending", "redemptions": 0,
        "placements": placements,
        "bannerHeadline": (str(doc.get("bannerHeadline") or "")[:120] or None),
        "bannerBody": (str(doc.get("bannerBody") or "")[:300] or None),
    }
    await coll("promotions").insert_one(dict(stored))
    stored.pop("_id", None)
    await add_audit(user.get("name") or "Owner", f"Promotion created: {code}")
    return stored


@api.post("/reports")
async def report_create(request: Request, doc: dict = Body(...)):
    user = await require(request)
    if user["role"] != "owner":
        raise HTTPException(403, "Not permitted")
    try:
        if doc.get("start") and doc.get("end"):
            start, end = str(doc["start"]), str(doc["end"])
            if end < start:
                raise ValueError("The end date must be on or after the start date")
        else:
            start, end = period_bounds(doc.get("year"), doc.get("month"), doc.get("half") or 1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    practitioner_id = str(doc.get("practitionerId") or "")
    appointments = await coll("appointments").find({}, NO_ID).to_list(2000)
    report = new_report(snapshot_lines(appointments, start, end, practitioner_id), practitioner_id, user.get("name") or "Owner")
    await db.nt_reports.insert_one(dict(report))
    return report


async def _report_or_404(report_id):
    row = await db.nt_reports.find_one({"id": report_id}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Report not found")
    return row


@api.post("/reports/{report_id}/approve")
async def report_approve(report_id: str, request: Request):
    user = await require(request)
    if user["role"] != "owner":
        raise HTTPException(403, "Not permitted")
    row = await _report_or_404(report_id)
    if row.get("status") != "draft":
        raise HTTPException(409, "Only a draft report can be approved")
    await db.nt_reports.update_one({"id": report_id, "status": "draft"}, {"$set": {"status": "approved", "approvedBy": user.get("name") or "Owner"}})
    return await _report_or_404(report_id)


@api.post("/reports/{report_id}/publish")
async def report_publish(report_id: str, request: Request):
    user = await require(request)
    if user["role"] != "owner":
        raise HTTPException(403, "Not permitted")
    row = await _report_or_404(report_id)
    if row.get("status") != "approved":
        raise HTTPException(409, "Approve the report before publishing it")
    await db.nt_reports.update_one({"id": report_id}, {"$set": {"status": "published", "publishedAt": datetime.now(timezone.utc).isoformat()}})
    return await _report_or_404(report_id)


@api.get("/reports/{report_id}/pdf")
async def report_pdf(report_id: str, request: Request):
    user = await require(request)
    row = await _report_or_404(report_id)
    owner = user["role"] == "owner"
    own = user["role"] == "practitioner" and row.get("status") == "published" and row.get("practitionerId") == user.get("subject")
    if not owner and not own:
        raise HTTPException(403, "Not permitted")
    snap = row.get("snapshot") or {}
    from pdfbrand import report_pdf as branded_report
    kpis = [("Invoiced", snap.get("invoiced")), ("Visits", snap.get("count", 0)), ("Gross treatment", snap.get("grossTreatment")), ("Discounts", snap.get("discounts")),
            ("Travel", snap.get("travel")), ("GST", snap.get("gst")), ("Collected", snap.get("collected")), ("Insurance received", snap.get("insuranceReceived")),
            ("Insurance pending", snap.get("insurancePending")), ("Outstanding", snap.get("outstanding")), ("Status", str(row.get("status") or "").title())]
    money = lambda v: f"${float(v or 0):,.2f}"
    names = {s.get("slug"): s.get("name") for s in await coll("services").find({}, {"_id": 0, "slug": 1, "name": 1}).to_list(200)}
    detail = [[str(x.get("date") or ""), str(x.get("ref") or ""), str(names.get(x.get("serviceSlug")) or x.get("serviceSlug") or ""), money(x.get("invoiced")), money(x.get("collected")), money(x.get("outstanding"))] for x in (snap.get("rows") or [])[:1000] if isinstance(x, dict)]
    sections = [("Visits in this period", ["Date", "Reference", "Service", "Invoiced", "Collected", "Outstanding"], detail, [2, 2, 3, 2, 2, 2])]
    title = "Period report" + (f" · {row.get('practitionerName')}" if row.get("practitionerName") else "")
    shown = [(k, v if k in ("Visits", "Status") else money(v)) for k, v in kpis]
    pdf = branded_report(title, f"{snap.get('start')} to {snap.get('end')}", [(k, str(v)) for k, v in shown], sections, await coll("settings").find_one({"id": "app"}, NO_ID))
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="nabitouch-report-{snap.get("start")}-{snap.get("end")}.pdf"'})
    lines = [
        f"{snap.get('start')} to {snap.get('end')}",
        snap.get("basis") or "",
        f"Visits {snap.get('count', 0)}",
        f"Gross treatment {snap.get('grossTreatment')}",
        f"Discounts {snap.get('discounts')}",
        f"Travel {snap.get('travel')}",
        f"GST {snap.get('gst')}",
        f"Invoiced {snap.get('invoiced')}",
        f"Collected {snap.get('collected')}",
        f"Insurance received {snap.get('insuranceReceived')}",
        f"Insurance pending {snap.get('insurancePending')}",
        f"Outstanding {snap.get('outstanding')}",
        f"Status {row.get('status')}",
        "This report is not a payroll or tax filing.",
    ]
    return Response(content=text_pdf("Nabitouch report", lines), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{report_id}.pdf"'})


@api.post("/{name}")
async def create_doc(name: str, request: Request, doc: dict = Body(...)):
    user = await require(request)
    if name in ("soap", "audit", "appointments", "settings", "clients", "services", "zones", "promotions", "practitioners", "templates"):
        raise HTTPException(403, "Not permitted")
    if name == "giftcards":
        raise HTTPException(410, "Gift cards use the audited /api/giftcards endpoints")
        amount = float(doc.get("amount") or 0)
        if amount <= 0 or amount > 5000:
            raise HTTPException(400, "Gift card amount must be between 0 and 5000")
        doc = {"id": doc.get("id") or f"gc-{uuid.uuid4().hex[:8]}", "code": doc.get("code") or f"NABI-GIFT-{uuid.uuid4().hex[:4].upper()}",
               "amount": amount, "balance": amount, "purchaser": doc.get("purchaser") or user["name"],
               "recipient": doc.get("recipient") or "", "status": "active", "issued": doc.get("issued") or now_iso()[:10]}
    elif name == "plans":
        if user["role"] not in ("owner", "practitioner"):
            raise HTTPException(403, "Not permitted")
        if user["role"] == "practitioner":
            doc["practitionerId"] = user["subject"]
        if not doc.get("practitionerId") or not doc.get("clientId"):
            raise HTTPException(400, "A plan needs a client and a practitioner")
        doc = {key: doc.get(key) for key in ("clientId", "practitionerId", "title", "frequency", "sessionsTotal", "homeCare", "nextReview", "visibleToClient", "goals")}
        doc.update({"id": f"pl-{uuid.uuid4().hex[:8]}", "sessionsDone": 0, "visibleToClient": bool(doc.get("visibleToClient", True))})
    else:
        raise HTTPException(403, "Not permitted")
    await coll(name).insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api.patch("/{name}/{doc_id}")
async def patch_doc(name: str, doc_id: str, request: Request, doc: dict = Body(...)):
    user = await require(request)
    role, sub = user["role"], user.get("subject")
    if name in ("soap", "audit", "templates"):
        raise HTTPException(403, "Not permitted")
    target = await coll(name).find_one({"id": doc_id}, NO_ID)
    if not target:
        raise HTTPException(404, "Not found")
    doc.pop("_actor", None)
    audit_msg = doc.pop("_audit", None)
    doc.pop("id", None)
    perms = await reception_perms() if role == "desk" else {}
    if name == "appointments":
        if role == "owner":
            allowed = {"checkedIn", "practitionerId"}
        elif role == "desk":
            allowed = set()
            if perms.get("createBooking"):
                allowed.add("checkedIn")
            if perms.get("assign"):
                allowed.add("practitionerId")
        elif role == "practitioner" and target.get("practitionerId") == sub:
            allowed = {"timer"}
        elif role == "client" and target.get("clientId") == sub:
            allowed = {"feedback"}
        else:
            raise HTTPException(403, "Not permitted")
        doc = only_fields(doc, allowed)
        if "practitionerId" in doc and target.get("status") != "requested":
            raise HTTPException(409, "Reassign through the appointment event")
        if "practitionerId" in doc:
            person = await coll("practitioners").find_one({"id": doc["practitionerId"]}, NO_ID)
            if not person:
                raise HTTPException(400, "Unknown practitioner")
            if target.get("status") == "requested":
                await prepare_assignment(target, doc["practitionerId"])
    elif name == "clients":
        if role == "client" and doc_id == sub:
            doc = {key: value for key, value in doc.items() if key in CLIENT_FIELDS}
            if not doc:
                raise HTTPException(400, "No permitted fields")
            if "insurance" in doc:
                doc["insurance"] = seal_insurance(lock_client_insurance(open_insurance(target.get("insurance")), doc["insurance"]))
            # Profile avatars are separate from clinical document uploads.
            if "photo" in doc and not profile_photos_enabled():
                doc.pop("photo", None)
            elif "photo" in doc and isinstance(doc.get("photo"), str) and len(doc["photo"]) > 200000:
                raise HTTPException(400, "Photo is too large")
        elif role == "desk" and perms.get("viewInsuranceStatus"):
            doc = only_fields(doc, {"insurance"})
            if "insurance" in doc:
                doc["insurance"] = seal_insurance(lock_client_insurance(open_insurance(target.get("insurance")), doc["insurance"]))
        elif role == "owner":
            doc = only_fields(doc, CLIENT_FIELDS | {"insurance"}, {"loyaltyPoints", "onlineBookings", "hasProfile", "createdAt"})
            if "insurance" in doc:
                doc["insurance"] = seal_insurance(lock_client_insurance(open_insurance(target.get("insurance")), doc["insurance"]))
        else:
            raise HTTPException(403, "Not permitted")
    elif name == "promotions":
        if role != "owner":
            raise HTTPException(403, "Not permitted")
        doc = only_fields(doc, PROMO_FIELDS, {"redemptions"})
        if "approval" in doc and doc["approval"] not in ("pending", "approved"):
            raise HTTPException(400, "An offer is pending or approved")
        merged_approval = doc.get("approval", target.get("approval"))
        merged_enabled = doc["enabled"] if "enabled" in doc else target.get("enabled")
        if merged_enabled is True and merged_approval != "approved":
            raise HTTPException(409, "Approve this offer before it can be turned on")
        if (target.get("eligibility") == "first_online" or doc.get("eligibility") == "first_online") and doc.get("stackable") is True:
            raise HTTPException(409, "The first-booking welcome offer cannot be combined with other discounts")
        if "placements" in doc:
            places = doc["placements"] if isinstance(doc["placements"], list) else []
            doc["placements"] = [str(p) for p in places if isinstance(p, str)][:12] or ["home", "account"]
        if "bannerHeadline" in doc and doc["bannerHeadline"] is not None:
            doc["bannerHeadline"] = str(doc["bannerHeadline"])[:120] or None
        if "bannerBody" in doc and doc["bannerBody"] is not None:
            doc["bannerBody"] = str(doc["bannerBody"])[:300] or None
        parts = []
        for key in sorted(doc):
            value = doc[key]
            if isinstance(value, (str, int, float, bool)) or value is None:
                parts.append(f"{key}={value}")
            else:
                parts.append(key)
        audit_msg = f"Promotion {target.get('code') or doc_id} settings changed ({', '.join(parts)})"
    elif name == "zones":
        if role != "owner":
            raise HTTPException(403, "Not permitted")
        doc = only_fields(doc, ZONE_FIELDS)
    elif name == "services":
        if role != "owner":
            raise HTTPException(403, "Not permitted")
        return await update_service(db, user, doc_id, doc)
    elif name == "settings":
        if role != "owner" or doc_id != "app":
            raise HTTPException(403, "Not permitted")
        doc = only_fields(doc, SETTINGS_FIELDS, {"revenueTrend"})
        if "mfaEnforcePrivileged" in doc and (doc.get("mfaEnforcePrivileged") or target.get("mfaEnforcePrivileged")):
            session = await db.nt_sessions.find_one({"sid": user.get("sid"), "revoked": False})
            if not session or not session.get("mfaAt"):
                raise HTTPException(403, "Confirm your authenticator before changing staff sign-in requirements")
        if "whatsapp" in doc:
            wa = doc["whatsapp"] if isinstance(doc["whatsapp"], dict) else {}
            pages = [str(x)[:60] for x in (wa.get("pages") or []) if isinstance(x, str) and x.startswith("/")][:20]
            phone = "".join(ch for ch in str(wa.get("phone") or "") if ch.isdigit() or ch == "+")[:16]
            doc["whatsapp"] = {"pages": pages, "phone": phone or "+17802356508"}
        if "clinic" in doc:
            incoming = doc["clinic"] if isinstance(doc["clinic"], dict) else {}
            confirmation = incoming.get("confirmation") if isinstance(incoming.get("confirmation"), dict) else {}
            resolved = None
            provider_down = False
            if confirmation.get("clientConfirmed") is True and confirmation.get("mapboxId"):
                try:
                    hit = await GEO.resolve(line=confirmation.get("line") or incoming.get("address") or "", mapbox_id=confirmation.get("mapboxId"), point=None, persist=True)
                except GeocodeError as exc:
                    raise HTTPException(400, str(exc)) from exc
                except ProviderError:
                    provider_down = True
                else:
                    assessed = classify(hit, confirmation.get("line") or "", confirmation.get("postal") or "", None)
                    resolved = {"line": hit.get("line") or "", "lat": hit.get("lat"), "lng": hit.get("lng"), "mapboxId": hit.get("id") or "", "confidence": assessed["confidence"]}
            try:
                doc["clinic"] = validate_clinic(merge_clinic(target.get("clinic"), incoming, resolved, provider_down))
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        if "paymentPolicy" in doc:
            try:
                doc["paymentPolicy"] = resolve_payment_policy(doc["paymentPolicy"], production=is_production(), explicit=True)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        if "scheduling" in doc:
            try:
                doc["scheduling"] = {**(target.get("scheduling") or {}), **validate_scheduling(doc["scheduling"])}
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, str(exc)) from exc
        if "cancellationPolicy" in doc:
            try:
                doc["cancellationPolicy"] = validate_policy(doc["cancellationPolicy"])
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        if "cancellationFee" in doc:
            try:
                doc["cancellationFee"] = validate_fee(doc["cancellationFee"])
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        if "rewards" in doc:
            try:
                doc["rewards"] = validate_rewards(doc["rewards"])
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
    elif name == "practitioners":
        if role not in ("owner", "practitioner") or (role == "practitioner" and doc_id != sub):
            raise HTTPException(403, "Not permitted")
        doc = only_fields(doc, {"available", "preferredNavApp"})
        if "preferredNavApp" in doc and doc["preferredNavApp"] not in ("google", "apple", "waze"):
            raise HTTPException(400, "Choose Google Maps, Apple Maps or Waze")
        if doc.get("available") is True and target.get("onboardingStatus") not in (None, "approved"):
            raise HTTPException(409, "This practitioner profile is not active")
        if doc.get("available") is True:
            schedule = await db.nt_schedules.find_one({"practitionerId": doc_id}, {"_id": 0, "status": 1})
            if schedule and schedule.get("status") != "approved":
                raise HTTPException(409, "Approve the schedule before accepting bookings")
    elif name == "plans":
        if role == "owner" or (role == "practitioner" and target.get("practitionerId") == sub):
            doc = only_fields(doc, PLAN_FIELDS)
        else:
            raise HTTPException(403, "Not permitted")
    elif name == "giftcards":
        raise HTTPException(410, "Gift cards use the audited /api/giftcards endpoints")
        doc = only_fields(doc, {"status", "balance", "recipient"}, {"code", "amount"})
    else:
        raise HTTPException(403, "Not permitted")
    res = await coll(name).find_one_and_update({"id": doc_id}, {"$set": doc}, projection=NO_ID, return_document=True)
    if name == "clients" and res and "insurance" in res:
        res = {**res, "insurance": open_insurance(res.get("insurance"))}
    if not res:
        raise HTTPException(404, "Not found")
    if audit_msg:
        await add_audit(user.get("name") or "staff", audit_msg, doc_id if name == "appointments" else None, actor_id=user.get("id"))
    return res


class CSRFMiddleware(BaseHTTPMiddleware):
    EXEMPT = {"/api/auth/login", "/api/auth/register", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/demo-login", "/api/auth/invite/accept",
              "/api/auth/native/login", "/api/auth/native/mfa/verify", "/api/auth/native/refresh", "/api/auth/native/logout"}

    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/"):
            has_session = request.cookies.get("access_token") or request.cookies.get("refresh_token")
            challenge_authenticated = False
            challenge_types = {"/api/auth/mfa/enroll": "mfa-enroll", "/api/auth/mfa/confirm": "mfa-enroll", "/api/auth/mfa/verify": "mfa"}
            if request.url.path in challenge_types:
                try:
                    body = await request.json()
                    claim = jwt.decode(str(body.get("challenge") or ""), os.environ["JWT_SECRET"], algorithms=[ALG])
                    challenge_authenticated = claim.get("type") == challenge_types[request.url.path] and bool(claim.get("sub"))
                except (ValueError, AttributeError, jwt.InvalidTokenError):
                    pass
            # A signed, short-lived login challenge authenticates this request independently
            # of any stale browser cookie. Cookie-authenticated enrollment still needs CSRF.
            if has_session and not challenge_authenticated and not request.headers.get("authorization", "").lower().startswith("bearer ") and request.url.path not in self.EXEMPT:
                header = request.headers.get("x-csrf-token")
                cookie = request.cookies.get("csrf_token")
                if not header or not cookie or not _same(header, cookie):
                    return JSONResponse({"detail": "CSRF token missing or invalid"}, status_code=403)
                payload = None
                for candidate in (request.cookies.get("access_token"), request.cookies.get("refresh_token")):
                    if not candidate:
                        continue
                    try:
                        payload = jwt.decode(candidate, os.environ["JWT_SECRET"], algorithms=[ALG])
                        break
                    except jwt.ExpiredSignatureError:
                        continue
                    except jwt.InvalidTokenError:
                        payload = None
                        break
                if not payload:
                    return JSONResponse({"detail": "CSRF token missing or invalid"}, status_code=403)
                row = await db.nt_sessions.find_one({"sid": payload.get("sid"), "revoked": False}, {"_id": 0, "csrf": 1})
                if not row or not _same(row.get("csrf"), header):
                    return JSONResponse({"detail": "CSRF token missing or invalid"}, status_code=403)
        return await call_next(request)


def _same(left, right):
    if not left or not right or len(left) != len(right):
        return False
    return secrets.compare_digest(left, right)


class TrackingPrivacy:
    """no-store and no-referrer on tracking responses, including streams."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not scope.get("path", "").startswith("/api/tracking"):
            await self.app(scope, receive, send)
            return

        async def send_private(message):
            if message["type"] == "http.response.start":
                headers = [(key, value) for key, value in message.get("headers", []) if key.lower() not in (b"cache-control", b"referrer-policy", b"pragma")]
                headers.extend(((b"cache-control", b"no-store"), (b"referrer-policy", b"no-referrer"), (b"pragma", b"no-cache")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_private)


logging.getLogger().addFilter(RedactLogFilter())
for _provider_logger in ("httpx", "httpcore", "geo", "tracking"):
    logging.getLogger(_provider_logger).addFilter(RedactLogFilter())
logging.getLogger("uvicorn.access").addFilter(AccessPathRedact())
app.include_router(auth_router)
app.include_router(build_router(coll, add_audit, user_from))
app.include_router(build_tracking_router(coll, add_audit, user_from))
app.include_router(build_billing_router(db, coll, add_audit, user_from))
app.include_router(build_import_router(db, coll, add_audit, user_from))
app.include_router(build_clinical_router(db, coll, add_audit, user_from))
app.include_router(build_legacy_router(db, coll, add_audit, user_from))
app.include_router(build_schedule_router(db, coll, add_audit, require, user_from, locate_visit, reception_perms, is_production))
app.include_router(build_recovery_router(db, coll, add_audit, require, user_from, ensure_slot, is_production))
from training import build_training_router
app.include_router(build_training_router(client, require))
app.include_router(build_rewards_router(db, coll, add_audit, require, user_from))
app.include_router(build_messaging_router(db, coll, user_from, add_audit, reception_perms))
app.include_router(build_media_router(db, user_from))
app.include_router(build_giftcard_router(db, coll, add_audit, user_from, reception_perms))
app.include_router(build_readiness_router(db, coll, user_from, add_audit))
app.include_router(build_plans_router(db, coll, add_audit, user_from))
app.include_router(build_safety_router(db, coll, add_audit, user_from, apply_transition))
app.include_router(build_session_care_router(db, coll, add_audit, user_from, apply_transition))
app.include_router(build_reviews_router(db, coll, add_audit, user_from))
app.include_router(build_turnaround_router(db, coll, add_audit, user_from, reception_perms))
app.include_router(build_devices_router(db, user_from))
app.include_router(build_winback_router(db, coll, add_audit, user_from))
app.include_router(build_followup_router(db, coll, add_audit, user_from))
app.include_router(build_sms_router(db, coll, add_audit, user_from))


@app.post("/api/cron/sms-reminders")
async def cron_sms_reminders(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    secret = os.environ.get("WEBHOOK_CRON_SECRET") or ""
    auth = request.headers.get("authorization") or ""
    if not secret or not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], secret):
        raise HTTPException(401, "Unauthorized")
    run_id = request.headers.get("x-webhook-id") or ""
    try:
        envelope = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid body")
    run_id = run_id or (envelope or {}).get("run_id") or ""
    if run_id:
        try:
            await db.nt_cron_runs.insert_one({"id": f"sms-reminders:{run_id}", "at": now_iso()})
        except DuplicateKeyError:
            return {"accepted": True, "duplicate": True}

    async def work():
        try:
            await due_reminders(db, coll)
        except Exception:
            logging.getLogger(__name__).error("SMS reminder run failed")
    asyncio.get_running_loop().create_task(work())
    return {"accepted": True}
app.include_router(build_finance_router(db, user_from, lambda: coll("settings").find_one({"id": "app"}, NO_ID)))
app.include_router(api)
app.add_middleware(CSRFMiddleware)
app.add_middleware(TrackingPrivacy)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    expose_headers=["X-Statements-Skipped"],
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)
logging.basicConfig(level=logging.INFO)
