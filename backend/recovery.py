"""Gap recovery, flash campaigns, consent, and cancellation-fee settings.

Offers are prepared in the app. External promotional sending stays off.
A cancellation fee is stored so it can be configured, and collection stays off.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, HTTPException, Request
from pymongo import ReturnDocument

from pricing import money

EXCLUSIVE_MINUTES = 20
HOLD_MINUTES = 3
MAX_EXCLUSIVE = 5
BROADCAST_LIMIT = 25
OUTBOUND_PROMOTIONS = False
OUTBOUND_RECOVERY = False
FEE_TEXT = (
    "We understand that plans can change. If you need to cancel or reschedule your massage appointment, "
    "please contact Nabitouch as soon as possible. We currently do not charge an automatic cancellation fee."
)


def now():
    return datetime.now(timezone.utc)


def stamp(value):
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").replace("Z", "+00:00")
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def before(left, right):
    a, b = stamp(left), stamp(right)
    return bool(a and b and a <= b)


def iso(value):
    return value.astimezone(timezone.utc).isoformat()


def recovery_rules(settings):
    raw = (settings or {}).get("recovery") or {}
    return {
        "exclusiveMinutes": int(raw.get("exclusiveMinutes") or EXCLUSIVE_MINUTES),
        "holdMinutes": int(raw.get("holdMinutes") or HOLD_MINUTES),
        "maxExclusiveAttempts": int(raw.get("maxExclusiveAttempts") or MAX_EXCLUSIVE),
        "broadcastLimit": int(raw.get("broadcastLimit") or BROADCAST_LIMIT),
    }


def launch_fee():
    return {
        "enabled": False,
        "noShowEnabled": False,
        "automaticCollection": False,
        "noticeHours": None,
        "fixedFee": None,
        "percentFee": None,
        "noShowFee": None,
        "maxFee": None,
        "waiverRequiresOwner": True,
        "effectiveOn": None,
        "published": False,
        "text": FEE_TEXT,
    }


def fee_amount(settings, appointment, kind="cancel"):
    """Disabled fees, missing settings, and appointments booked before an effective date are zero."""
    fee = (settings or {}).get("cancellationFee") or {}
    if fee.get("enabled") is not True or fee.get("automaticCollection") is True:
        return 0
    if kind == "no_show" and fee.get("noShowEnabled") is not True:
        return 0
    effective = fee.get("effectiveOn")
    created = str((appointment or {}).get("createdAt") or "")
    if not effective or not created or created < str(effective):
        return 0
    raw = fee.get("noShowFee") if kind == "no_show" else fee.get("fixedFee")
    amount = float(raw or 0)
    if fee.get("percentFee") and kind != "no_show":
        amount += float((appointment.get("pricing") or {}).get("total") or 0) * float(fee["percentFee"]) / 100
    cap = fee.get("maxFee")
    if cap is not None:
        amount = min(amount, float(cap))
    return money(amount) if amount else 0


def validate_fee(fee):
    fee = {**launch_fee(), **(fee or {})}
    if fee.get("enabled") or fee.get("noShowEnabled") or fee.get("automaticCollection"):
        raise ValueError("Cancellation fees stay off until a separate authorization")
    if fee.get("published"):
        raise ValueError("The cancellation wording is not published")
    fee["enabled"] = False
    fee["noShowEnabled"] = False
    fee["automaticCollection"] = False
    fee["published"] = False
    return fee


def rank_exclusive(cancelled, later_visits, drives):
    """Later bookings for the same practitioner and service, closest time first, then shorter extra drive."""
    ranked = []
    origin = (cancelled.get("address") or {})
    for visit in later_visits or []:
        if visit.get("id") == cancelled.get("id"):
            continue
        if visit.get("practitionerId") != cancelled.get("practitionerId"):
            continue
        if visit.get("serviceSlug") != cancelled.get("serviceSlug"):
            continue
        if (visit.get("date"), visit.get("time")) <= (cancelled.get("date"), cancelled.get("time")):
            continue
        if visit.get("status") in ("cancelled", "no_show"):
            continue
        drive, provider = drives(origin if origin.get("lat") is not None else None, visit.get("address"))
        ranked.append({
            "clientId": visit.get("clientId"),
            "appointmentId": visit.get("id"),
            "ref": visit.get("ref"),
            "date": visit.get("date"),
            "time": visit.get("time"),
            "travelMin": drive,
            "provider": provider,
        })
    ranked.sort(key=lambda row: (row["date"], row["time"], row["travelMin"]))
    return ranked


def active_exclusive(offers, at):
    for offer in offers or []:
        if offer.get("kind") == "exclusive" and offer.get("status") == "pending" and stamp(offer.get("expiresAt")) and stamp(offer.get("expiresAt")) > stamp(at):
            return offer
    return None


def next_candidate(ranked, offers, limit, at=None):
    at = at or now()
    if active_exclusive(offers, at):
        return None
    used = [offer for offer in offers or [] if offer.get("kind") == "exclusive"]
    if len(used) >= limit:
        return None
    seen = {offer.get("clientId") for offer in used}
    return next((row for row in ranked if row["clientId"] not in seen), None)


def decline_then_next(ranked, offers, limit, at=None):
    """After a decline, the following candidate can be offered. Nobody is contacted while one is pending."""
    at = at or now()
    if active_exclusive(offers, at):
        return None
    return next_candidate(ranked, offers, limit, at)


def broadcast_ready(offers, at):
    return active_exclusive(offers, at) is None


def rank_broadcast(watches, drives, origin, limit):
    ranked = []
    for watch in watches or []:
        if watch.get("optIn") is not True:
            continue
        drive, provider = drives(origin if origin and origin.get("lat") is not None else None, watch.get("point"))
        if provider == "infeasible":
            continue
        ranked.append({"clientId": watch["clientId"], "watchId": watch["id"], "travelMin": drive, "provider": provider})
    ranked.sort(key=lambda row: row["travelMin"])
    return ranked[:limit]


def take_claim(case, client_id, at, hold_minutes=HOLD_MINUTES):
    """Opening a link does not claim. A hold lasts hold_minutes and only one client can hold the slot."""
    if not case or case.get("filledAppointmentId") or case.get("status") in ("filled", "expired", "unfilled", "stopped"):
        return "taken"
    hold_until = case.get("holdUntil")
    holder = case.get("holdClientId")
    if holder and holder != client_id and hold_until and stamp(hold_until) and stamp(hold_until) > stamp(at):
        return "held"
    return {"status": "held", "holdClientId": client_id, "holdUntil": iso(at + timedelta(minutes=hold_minutes))}


def fill_case(case, client_id):
    if case.get("holdClientId") != client_id or case.get("status") == "filled":
        return "rejected"
    return {**case, "status": "filled", "filledByClientId": client_id, "holdClientId": None}


def campaign_live(campaign, at):
    if not campaign or campaign.get("status") != "live":
        return False
    if not stamp(campaign.get("expiresAt")) or stamp(campaign.get("expiresAt")) <= stamp(at):
        return False
    if stamp(campaign.get("publishAt")) and stamp(campaign.get("publishAt")) > stamp(at):
        return False
    return True


def campaign_fits(campaign, day, start, duration, service_slug=None):
    if day < campaign.get("bookingStart") or day > campaign.get("bookingEnd"):
        return False
    if start < campaign.get("windowStart") or start >= campaign.get("windowEnd"):
        return False
    if int(duration) < int(campaign.get("minDuration") or 0):
        return False
    slug = campaign.get("serviceSlug") or "all"
    if service_slug and slug not in ("all", service_slug):
        return False
    return True


def audience_ok(campaign, client):
    mode = campaign.get("audience") or "all"
    visits = int((client or {}).get("onlineBookings") or 0)
    if mode == "new":
        return visits <= 0
    if mode == "returning":
        return visits > 0
    return True


def reserve_decision(campaign, client, at, already):
    if not campaign_live(campaign, at):
        return "expired" if campaign and stamp(campaign.get("expiresAt")) and stamp(campaign.get("expiresAt")) <= stamp(at) else "closed"
    if int(campaign.get("redemptions") or 0) >= int(campaign.get("maxRedemptions") or 0):
        return "sold_out"
    if int(already or 0) >= int(campaign.get("perClientLimit") or 1):
        return "limit"
    return "reserved"


def apply_campaign_price(quoted, percent, gst, stackable=False):
    base = float(quoted.get("base") or 0)
    extra = money(base * float(percent) / 100)
    existing = float(quoted.get("discount") or 0)
    discount = min(base, existing + extra) if stackable else min(base, extra)
    subtotal = base - discount + float(quoted.get("addons") or 0) + float(quoted.get("travel") or 0)
    tax = money(subtotal * float(gst if gst is not None else 0.05))
    total = money(subtotal + tax)
    return {**quoted, "discount": discount, "promoName": quoted.get("campaignTitle") or "Flash booking", "tax": tax, "total": total, "treatmentAfterDiscount": money(base - discount)}


def release_count(redemptions):
    return max(0, int(redemptions) - 1)


def consent_state(events, purpose):
    rows = [row for row in events or [] if row.get("purpose") == purpose]
    if not rows:
        return False
    latest = sorted(rows, key=lambda row: row.get("at") or "")[-1]
    return bool(latest.get("granted")) and not latest.get("withdrawnAt")


def record_consent(events, purpose, granted, source, at):
    row = {"id": "con-" + uuid.uuid4().hex[:8], "purpose": purpose, "granted": bool(granted), "source": source, "at": iso(at), "withdrawnAt": None if granted else iso(at)}
    return (events or []) + [row]


def unsubscribe(events, purpose, at):
    return record_consent(events, purpose, False, "unsubscribe", at)


def sending_allowed(purpose, events):
    if purpose == "promotional" and not OUTBOUND_PROMOTIONS:
        return False
    if purpose == "recovery" and not OUTBOUND_RECOVERY:
        return False
    if purpose == "promotional" and not consent_state(events, "promotional"):
        return False
    return purpose == "operational" or consent_state(events, purpose)


def public_campaign(campaign, at):
    if not campaign or not campaign.get("public") or not campaign_live(campaign, at):
        return None
    remaining = max(0, int(campaign.get("maxRedemptions") or 0) - int(campaign.get("redemptions") or 0))
    return {
        "id": campaign["id"],
        "title": campaign.get("title") or "",
        "description": campaign.get("description") or "",
        "discountPercent": campaign.get("discountPercent"),
        "expiresAt": campaign.get("expiresAt"),
        "bookingStart": campaign.get("bookingStart"),
        "bookingEnd": campaign.get("bookingEnd"),
        "windowStart": campaign.get("windowStart"),
        "windowEnd": campaign.get("windowEnd"),
        "remaining": remaining,
        "serviceSlug": campaign.get("serviceSlug") or "",
        "minDuration": campaign.get("minDuration") or 0,
        "soldOut": remaining == 0,
    }


def analytics(cases, campaigns):
    offered = [case for case in cases or [] if case.get("offers")]
    filled = [case for case in cases or [] if case.get("status") == "filled"]
    times = [case.get("minutesToFill") for case in filled if case.get("minutesToFill") is not None]
    gross = sum(float(item.get("gross") or 0) for item in campaigns or [])
    discount = sum(float(item.get("discountCost") or 0) for item in campaigns or [])
    return {
        "recovered": len(filled),
        "offered": len(offered),
        "conversion": round(len(filled) / len(offered), 2) if offered else 0,
        "averageMinutesToFill": round(sum(times) / len(times), 1) if times else None,
        "travelMinutesSaved": sum(int(case.get("travelSaved") or 0) for case in filled),
        "campaignBookings": sum(int(item.get("bookings") or 0) for item in campaigns or []),
        "redemptions": sum(int(item.get("redemptions") or 0) for item in campaigns or []),
        "grossRevenue": money(gross),
        "discountCost": money(discount),
        "estimatedIncrementalRevenue": None,
        "incrementalNote": "Promotional bookings are not assumed to be additional revenue.",
    }


def can_manage_campaign(role):
    return role == "owner"


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_token():
    token = secrets.token_urlsafe(24)
    return token, token_hash(token)


async def open_case(db, appt):
    """Record released capacity. Do not contact anyone."""
    if not appt or not appt.get("practitionerId"):
        return None
    existing = await db.nt_recovery_cases.find_one({"appointmentId": appt.get("id"), "status": {"$nin": ["filled", "stopped"]}}, {"_id": 0})
    if existing:
        return existing
    case = {
        "id": "rec-" + uuid.uuid4().hex[:10],
        "appointmentId": appt.get("id"),
        "ref": appt.get("ref"),
        "practitionerId": appt.get("practitionerId"),
        "serviceSlug": appt.get("serviceSlug"),
        "date": appt.get("date"),
        "time": appt.get("time"),
        "duration": int(appt.get("duration") or 0),
        "zoneName": (appt.get("address") or {}).get("zoneName") or "",
        "status": "review",
        "offers": [],
        "notify": False,
        "createdAt": iso(now()),
    }
    await db.nt_recovery_cases.insert_one(dict(case))
    case.pop("_id", None)
    return case


def build_recovery_router(db, coll, add_audit, require, user_from, ensure_slot, is_production):
    router = APIRouter(prefix="/api")

    async def staff_case(request, case_id):
        user = await require(request, "owner", "practitioner", "desk")
        case = await db.nt_recovery_cases.find_one({"id": case_id}, {"_id": 0})
        if not case:
            raise HTTPException(404, "Recovery case not found")
        if user["role"] == "practitioner" and case.get("practitionerId") != user.get("subject"):
            raise HTTPException(403, "Not permitted")
        return user, case

    @router.get("/recovery")
    async def list_cases(request: Request, practitionerId: str = ""):
        user = await require(request, "owner", "practitioner")
        query = {}
        if user["role"] == "practitioner":
            query["practitionerId"] = user.get("subject")
        elif practitionerId:
            query["practitionerId"] = practitionerId
        rows = await db.nt_recovery_cases.find(query, {"_id": 0}).sort("createdAt", -1).to_list(50)
        return {"cases": rows, "notices": {"recovery": OUTBOUND_RECOVERY, "promotional": OUTBOUND_PROMOTIONS}}

    @router.get("/recovery/{case_id}/candidates")
    async def candidates(case_id: str, request: Request):
        _user, case = await staff_case(request, case_id)
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        visits = await coll("appointments").find({"practitionerId": case["practitionerId"], "serviceSlug": case["serviceSlug"], "status": {"$nin": ["cancelled", "no_show"]}}, {"_id": 0, "address.line": 0, "address.notes": 0}).to_list(200)
        from availability import conservative_drive
        ranked = rank_exclusive({"id": case["appointmentId"], "practitionerId": case["practitionerId"], "serviceSlug": case["serviceSlug"], "date": case["date"], "time": case["time"], "address": {}}, visits, lambda _a, b: conservative_drive(None, b))
        watches = await db.nt_opening_watches.count_documents({"optIn": True, "serviceSlug": case.get("serviceSlug")})
        rules = recovery_rules(settings)
        return {
            "suggested": [{key: row[key] for key in ("ref", "date", "time", "travelMin", "provider", "clientId")} for row in ranked],
            "next": next_candidate(ranked, case.get("offers"), rules["maxExclusiveAttempts"]),
            "exclusiveActive": active_exclusive(case.get("offers"), now()) is not None,
            "optedIn": watches,
            "rules": rules,
        }

    @router.post("/recovery/{case_id}/exclusive")
    async def exclusive(case_id: str, request: Request, payload: dict = Body(default={})):
        user, case = await staff_case(request, case_id)
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        rules = recovery_rules(settings)
        if active_exclusive(case.get("offers"), now()):
            raise HTTPException(409, "An exclusive offer is already active")
        visits = await coll("appointments").find({"practitionerId": case["practitionerId"], "serviceSlug": case["serviceSlug"], "status": {"$nin": ["cancelled", "no_show"]}}, {"_id": 0}).to_list(200)
        from availability import conservative_drive
        ranked = rank_exclusive({"id": case["appointmentId"], "practitionerId": case["practitionerId"], "serviceSlug": case["serviceSlug"], "date": case["date"], "time": case["time"], "address": {}}, visits, lambda _a, b: conservative_drive(None, b))
        choice = next((row for row in ranked if row["clientId"] == payload.get("clientId")), None) if payload.get("clientId") else next_candidate(ranked, case.get("offers"), rules["maxExclusiveAttempts"])
        if not choice:
            raise HTTPException(409, "No further exclusive candidate")
        offer = {**choice, "id": "rof-" + uuid.uuid4().hex[:8], "kind": "exclusive", "status": "pending", "expiresAt": iso(now() + timedelta(minutes=rules["exclusiveMinutes"])), "sent": False}
        case.setdefault("offers", []).append(offer)
        case["status"] = "exclusive"
        await db.nt_recovery_cases.replace_one({"id": case_id}, case)
        await add_audit(user["name"], f"Exclusive earlier-time offer prepared for {case.get('ref')}", case.get("appointmentId"))
        return {"offer": offer, "sent": False, "reason": "External recovery messages stay off. The client can respond in the app."}

    @router.post("/recovery/{case_id}/skip")
    async def skip(case_id: str, request: Request, payload: dict = Body(...)):
        user, case = await staff_case(request, case_id)
        for offer in case.get("offers") or []:
            if offer.get("clientId") == payload.get("clientId") and offer.get("status") == "pending":
                offer["status"] = "skipped"
        case["status"] = "review"
        await db.nt_recovery_cases.replace_one({"id": case_id}, case)
        await add_audit(user["name"], f"Recovery candidate skipped for {case.get('ref')}", case.get("appointmentId"))
        return {"case": case}

    @router.post("/recovery/{case_id}/broadcast")
    async def broadcast(case_id: str, request: Request):
        user, case = await staff_case(request, case_id)
        if not broadcast_ready(case.get("offers"), now()):
            raise HTTPException(409, "Wait until the exclusive offer ends")
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        watches = await db.nt_opening_watches.find({"optIn": True, "serviceSlug": case.get("serviceSlug")}, {"_id": 0}).to_list(200)
        from availability import conservative_drive
        ranked = rank_broadcast(watches, lambda _a, b: conservative_drive(None, b), None, recovery_rules(settings)["broadcastLimit"])
        created = []
        for row in ranked:
            token, digest = new_token()
            offer = {**row, "id": "rof-" + uuid.uuid4().hex[:8], "kind": "broadcast", "status": "pending", "tokenHash": digest, "sent": False}
            case.setdefault("offers", []).append({key: value for key, value in offer.items() if key != "token"})
            created.append({"offerId": offer["id"], "clientId": row["clientId"]})
            del token
        case["status"] = "broadcast"
        await db.nt_recovery_cases.replace_one({"id": case_id}, case)
        await add_audit(user["name"], f"Nearby opening prepared for {case.get('ref')} without sending", case.get("appointmentId"))
        return {"prepared": len(created), "sent": False, "offers": created}

    @router.get("/recovery/mine")
    async def mine(request: Request):
        user = await require(request, "client")
        rows = await db.nt_recovery_cases.find({"offers.clientId": user["subject"]}, {"_id": 0, "zoneName": 0}).to_list(20)
        visible = []
        for case in rows:
            offer = next((item for item in case.get("offers") or [] if item.get("clientId") == user["subject"] and item.get("status") == "pending"), None)
            if offer:
                visible.append({"caseId": case["id"], "date": case["date"], "time": case["time"], "duration": case["duration"], "kind": offer["kind"], "expiresAt": offer.get("expiresAt"), "status": case["status"]})
        return {"offers": visible}

    @router.post("/recovery/{case_id}/respond")
    async def respond(case_id: str, request: Request, payload: dict = Body(...)):
        user = await require(request, "client")
        decision = payload.get("decision")
        case = await db.nt_recovery_cases.find_one({"id": case_id}, {"_id": 0})
        if not case:
            raise HTTPException(404, "Offer not found")
        offer = next((item for item in case.get("offers") or [] if item.get("clientId") == user["subject"] and item.get("status") == "pending"), None)
        if not offer:
            raise HTTPException(409, "That offer is no longer available")
        if decision == "decline":
            offer["status"] = "declined"
            if offer.get("kind") == "exclusive":
                case["status"] = "review"
            await db.nt_recovery_cases.replace_one({"id": case_id}, case)
            return {"status": "declined"}
        if decision != "accept":
            raise HTTPException(400, "Accept or decline the offer")
        if offer.get("kind") == "exclusive" and offer.get("expiresAt") and offer["expiresAt"] <= iso(now()):
            offer["status"] = "expired"
            case["status"] = "review"
            await db.nt_recovery_cases.replace_one({"id": case_id}, case)
            raise HTTPException(409, "That offer has expired")
        held = await db.nt_recovery_cases.find_one_and_update(
            {"id": case_id, "filledAppointmentId": None, "$or": [{"holdClientId": None}, {"holdClientId": user["subject"]}, {"holdUntil": {"$lte": iso(now())}}]},
            {"$set": {"holdClientId": user["subject"], "holdUntil": iso(now() + timedelta(minutes=HOLD_MINUTES)), "status": "held"}},
            return_document=ReturnDocument.AFTER,
        )
        if not held:
            raise HTTPException(409, "No longer available")
        if offer.get("kind") == "exclusive" and offer.get("appointmentId"):
            existing = await coll("appointments").find_one({"id": offer["appointmentId"], "clientId": user["subject"]}, {"_id": 0})
            if not existing:
                raise HTTPException(409, "That appointment is no longer yours to move")
            settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
            service = await coll("services").find_one({"slug": case["serviceSlug"]}, {"_id": 0}) or {"slug": case["serviceSlug"], "duration": case["duration"]}
            from availability import assert_public_slot
            try:
                await assert_public_slot(
                    db, coll, settings=settings, production=is_production(), practitioner_id=case["practitionerId"],
                    day=case["date"], time=case["time"], duration=case["duration"], address=existing.get("address"),
                    location_type=existing.get("locationType") or "home", service=service, exclude_id=existing["id"],
                )
                await ensure_slot(case["practitionerId"], case["date"], case["time"], case["duration"], existing["id"])
            except HTTPException:
                await db.nt_recovery_cases.update_one({"id": case_id}, {"$set": {"holdClientId": None, "status": "review"}})
                raise HTTPException(409, "That time is no longer feasible") from None
            await coll("appointments").update_one({"id": offer["appointmentId"], "clientId": user["subject"]}, {"$set": {"date": case["date"], "time": case["time"]}})
            offers = []
            for item in (held.get("offers") or case.get("offers") or []):
                if item.get("clientId") == user["subject"] and item.get("status") == "pending":
                    item = {**item, "status": "accepted"}
                elif item.get("status") == "pending":
                    item = {**item, "status": "superseded"}
                offers.append(item)
            await db.nt_recovery_cases.update_one({"id": case_id}, {"$set": {"status": "filled", "filledAppointmentId": offer["appointmentId"], "filledByClientId": user["subject"], "holdClientId": None, "offers": offers}})
            await add_audit(user["name"], f"Earlier time accepted for {case.get('ref')}", offer["appointmentId"])
            return {"status": "filled", "booked": True}
        return {"status": "held", "booked": False, "detail": "Complete booking to confirm this opening. Opening the offer does not reserve it."}

    @router.get("/campaigns")
    async def list_campaigns(request: Request):
        await require(request, "owner")
        rows = await db.nt_campaigns.find({}, {"_id": 0}).to_list(50)
        return {"campaigns": rows, "promotionalSending": OUTBOUND_PROMOTIONS}

    @router.post("/campaigns")
    async def create_campaign(request: Request, payload: dict = Body(...)):
        user = await require(request, "owner")
        if not can_manage_campaign(user.get("role")):
            raise HTTPException(403, "Only the owner can change campaigns")
        if payload.get("sendNow"):
            raise HTTPException(403, "Promotional sending is off")
        percent = float(payload.get("discountPercent") or 0)
        if percent <= 0 or percent > 80:
            raise HTTPException(400, "Discount percent must be between 1 and 80")
        expiry = stamp(payload.get("expiresAt"))
        opening = stamp(payload.get("publishAt") or now())
        if not expiry or not opening or not payload.get("bookingStart") or not payload.get("windowStart"):
            raise HTTPException(400, "A campaign needs an expiry, a booking date, and a time window")
        row = {
            "id": "cmp-" + uuid.uuid4().hex[:8],
            "title": str(payload.get("title") or "Flash booking")[:120],
            "description": str(payload.get("description") or "")[:500],
            "status": "draft",
            "serviceSlug": payload.get("serviceSlug") or "all",
            "bookingStart": payload["bookingStart"],
            "bookingEnd": payload.get("bookingEnd") or payload["bookingStart"],
            "windowStart": payload["windowStart"],
            "windowEnd": payload.get("windowEnd") or payload["windowStart"],
            "publishAt": iso(opening),
            "expiresAt": iso(expiry),
            "discountPercent": percent,
            "maxRedemptions": int(payload.get("maxRedemptions") or 1),
            "redemptions": 0,
            "perClientLimit": int(payload.get("perClientLimit") or 1),
            "audience": payload.get("audience") if payload.get("audience") in ("new", "returning", "all") else "all",
            "minDuration": int(payload.get("minDuration") or 0),
            "public": bool(payload.get("public")),
            "stackable": bool(payload.get("stackable")),
            "code": str(payload.get("code") or "")[:40],
            "sendingEnabled": False,
            "createdAt": iso(now()),
        }
        await db.nt_campaigns.insert_one(dict(row))
        row.pop("_id", None)
        await add_audit(user["name"], f"Flash campaign drafted: {row['title']}", None)
        return row

    @router.put("/campaigns/{campaign_id}")
    async def update_campaign(campaign_id: str, request: Request, payload: dict = Body(...)):
        user = await require(request, "owner")
        if not can_manage_campaign(user.get("role")):
            raise HTTPException(403, "Only the owner can change campaigns")
        current = await db.nt_campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not current:
            raise HTTPException(404, "Campaign not found")
        if current.get("status") == "live":
            raise HTTPException(409, "Pause the campaign before editing it")
        percent = float(payload.get("discountPercent") or 0)
        if percent <= 0 or percent > 80:
            raise HTTPException(400, "Discount percent must be between 1 and 80")
        expiry = stamp(payload.get("expiresAt"))
        if not expiry or not payload.get("bookingStart") or not payload.get("windowStart"):
            raise HTTPException(400, "A campaign needs an expiry, a booking date, and a time window")
        changes = {
            "title": str(payload.get("title") or current.get("title") or "Flash booking")[:120],
            "description": str(payload.get("description") or "")[:500],
            "serviceSlug": payload.get("serviceSlug") or "all",
            "bookingStart": payload["bookingStart"],
            "bookingEnd": payload.get("bookingEnd") or payload["bookingStart"],
            "windowStart": payload["windowStart"],
            "windowEnd": payload.get("windowEnd") or payload["windowStart"],
            "expiresAt": iso(expiry),
            "discountPercent": percent,
            "maxRedemptions": int(payload.get("maxRedemptions") or 1),
            "perClientLimit": int(payload.get("perClientLimit") or 1),
            "audience": payload.get("audience") if payload.get("audience") in ("new", "returning", "all") else "all",
            "minDuration": int(payload.get("minDuration") or 0),
            "public": bool(payload.get("public", True)),
            "stackable": bool(payload.get("stackable")),
            "code": str(payload.get("code") or "")[:40],
            "sendingEnabled": False,
        }
        saved = await db.nt_campaigns.find_one_and_update({"id": campaign_id}, {"$set": changes}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        await add_audit(user["name"], f"Flash campaign updated: {saved['title']}", None)
        return saved

    @router.post("/campaigns/{campaign_id}/duplicate")
    async def duplicate_campaign(campaign_id: str, request: Request):
        user = await require(request, "owner")
        current = await db.nt_campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not current:
            raise HTTPException(404, "Campaign not found")
        copy = {key: value for key, value in current.items() if key not in ("_id", "id", "redemptions", "gross", "discountCost", "bookings")}
        copy.update({"id": "cmp-" + uuid.uuid4().hex[:8], "title": f"{current.get('title') or 'Flash booking'} copy"[:120], "status": "draft", "redemptions": 0, "sendingEnabled": False, "createdAt": iso(now())})
        await db.nt_campaigns.insert_one(dict(copy))
        copy.pop("_id", None)
        await add_audit(user["name"], f"Flash campaign duplicated: {copy['title']}", None)
        return copy

    @router.post("/campaigns/{campaign_id}/status")
    async def campaign_status(campaign_id: str, request: Request, payload: dict = Body(...)):
        user = await require(request, "owner")
        status = payload.get("status")
        if status not in ("live", "paused", "cancelled", "draft", "archived"):
            raise HTTPException(400, "Unknown campaign status")
        saved = await db.nt_campaigns.find_one_and_update({"id": campaign_id}, {"$set": {"status": status, "sendingEnabled": False}}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if not saved:
            raise HTTPException(404, "Campaign not found")
        await add_audit(user["name"], f"Campaign {campaign_id} {status}", None)
        return saved

    @router.get("/campaigns/public")
    async def public_campaigns(request: Request):
        await user_from(request)
        rows = await db.nt_campaigns.find({"public": True, "status": "live"}, {"_id": 0}).to_list(20)
        stamp = now()
        return {"campaigns": [item for item in (public_campaign(row, stamp) for row in rows) if item], "serverTime": iso(stamp)}

    @router.post("/consent")
    async def consent(request: Request, payload: dict = Body(...)):
        user = await require(request, "client")
        purpose = payload.get("purpose")
        if purpose not in ("operational", "promotional", "recovery"):
            raise HTTPException(400, "Unknown consent purpose")
        if purpose == "promotional" and payload.get("granted") is True:
            pass
        row = {"id": "cns-" + uuid.uuid4().hex[:10], "clientId": user["subject"], "purpose": purpose, "granted": bool(payload.get("granted")), "source": "profile", "at": iso(now()), "withdrawnAt": None if payload.get("granted") else iso(now())}
        await db.nt_consent.insert_one(dict(row))
        row.pop("_id", None)
        return {"consent": row, "promotionalSending": OUTBOUND_PROMOTIONS}

    @router.post("/consent/unsubscribe")
    async def withdraw(request: Request, payload: dict = Body(...)):
        user = await require(request, "client")
        purpose = payload.get("purpose") or "promotional"
        row = {"id": "cns-" + uuid.uuid4().hex[:10], "clientId": user["subject"], "purpose": purpose, "granted": False, "source": "unsubscribe", "at": iso(now()), "withdrawnAt": iso(now())}
        await db.nt_consent.insert_one(dict(row))
        return {"unsubscribed": purpose, "sending": False}

    @router.get("/marketing/analytics")
    async def marketing_analytics(request: Request):
        await require(request, "owner")
        cases = await db.nt_recovery_cases.find({}, {"_id": 0, "status": 1, "offers": 1, "minutesToFill": 1, "travelSaved": 1}).to_list(500)
        campaigns = await db.nt_campaigns.find({}, {"_id": 0, "redemptions": 1, "gross": 1, "discountCost": 1, "bookings": 1}).to_list(100)
        return analytics(cases, campaigns)

    return router


async def campaign_quote(db, campaign_id, client, day, start, duration, service_slug):
    """Read-only price preview. It does not reserve or increment a redemption."""
    if not campaign_id:
        return None
    campaign = await db.nt_campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign or not campaign_fits(campaign, day, start, duration, service_slug):
        return None
    if campaign.get("serviceSlug") not in (None, "", "all", service_slug):
        return None
    if not audience_ok(campaign, client):
        return None
    already = await db.nt_campaign_redemptions.count_documents({"campaignId": campaign_id, "clientId": (client or {}).get("id"), "status": {"$in": ["reserved", "awarded"]}})
    if reserve_decision(campaign, client, now(), already) != "reserved":
        return None
    return {"percent": campaign.get("discountPercent"), "stackable": bool(campaign.get("stackable")), "title": campaign.get("title")}


async def reserve_campaign(db, campaign_id, client, idempotency, day, start, duration, service_slug):
    if not campaign_id:
        return None
    existing = await db.nt_campaign_redemptions.find_one({"idempotencyKey": idempotency}, {"_id": 0}) if idempotency else None
    if existing:
        return existing
    campaign = await db.nt_campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign or not campaign_fits(campaign, day, start, duration, service_slug):
        raise HTTPException(409, "That promotion does not apply to this visit")
    if campaign.get("serviceSlug") not in (None, "", "all", service_slug):
        raise HTTPException(409, "That promotion does not apply to this service")
    if not audience_ok(campaign, client):
        raise HTTPException(409, "That promotion is not available for this client")
    already = await db.nt_campaign_redemptions.count_documents({"campaignId": campaign_id, "clientId": (client or {}).get("id"), "status": {"$in": ["reserved", "awarded"]}})
    if reserve_decision(campaign, client, now(), already) != "reserved":
        raise HTTPException(409, "That promotion is no longer available")
    saved = await db.nt_campaigns.find_one_and_update(
        {"id": campaign_id, "status": "live", "expiresAt": {"$gt": iso(now())}, "$expr": {"$lt": ["$redemptions", "$maxRedemptions"]}},
        {"$inc": {"redemptions": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not saved:
        raise HTTPException(409, "That promotion is no longer available")
    row = {"id": "rdm-" + uuid.uuid4().hex[:10], "campaignId": campaign_id, "clientId": (client or {}).get("id"), "status": "reserved", "idempotencyKey": idempotency, "percent": saved.get("discountPercent"), "stackable": bool(saved.get("stackable")), "title": saved.get("title"), "at": iso(now())}
    try:
        await db.nt_campaign_redemptions.insert_one(dict(row))
    except Exception:
        await db.nt_campaigns.update_one({"id": campaign_id}, {"$inc": {"redemptions": -1}})
        raise
    row.pop("_id", None)
    return row


async def release_campaign(db, reservation):
    if not reservation or reservation.get("status") != "reserved":
        return
    result = await db.nt_campaign_redemptions.update_one({"id": reservation["id"], "status": "reserved"}, {"$set": {"status": "released"}})
    if result.modified_count:
        await db.nt_campaigns.update_one({"id": reservation["campaignId"], "redemptions": {"$gt": 0}}, {"$inc": {"redemptions": -1}})


async def award_campaign(db, reservation, appointment_id, gross, discount):
    if not reservation:
        return
    await db.nt_campaign_redemptions.update_one({"id": reservation["id"], "status": "reserved"}, {"$set": {"status": "awarded", "appointmentId": appointment_id}})
    await db.nt_campaigns.update_one({"id": reservation["campaignId"]}, {"$inc": {"bookings": 1, "gross": float(gross), "discountCost": float(discount)}})


async def consume_recovery_hold(db, case_id, client_id, appointment_id):
    if not case_id:
        return
    saved = await db.nt_recovery_cases.find_one_and_update(
        {"id": case_id, "holdClientId": client_id, "filledAppointmentId": None, "holdUntil": {"$gt": iso(now())}},
        {"$set": {"status": "filled", "filledAppointmentId": appointment_id, "filledByClientId": client_id, "holdClientId": None}},
    )
    if not saved:
        raise HTTPException(409, "No longer available")
    offers = []
    for offer in saved.get("offers") or []:
        if offer.get("status") != "pending":
            offers.append(offer)
        elif offer.get("clientId") == client_id:
            offers.append({**offer, "status": "accepted"})
        else:
            offers.append({**offer, "status": "superseded"})
    await db.nt_recovery_cases.update_one({"id": case_id}, {"$set": {"offers": offers}})
