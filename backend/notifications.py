"""Durable booking-email outbox.

MongoDB is the source of truth. Redis is not used. A row is queued when it is
inserted, sent when the provider accepts it, and never marked delivered from
that acceptance alone. If the process dies after the provider accepts and
before this row is updated, Resend's stable Idempotency-Key protects retries.
Changed payloads and retries beyond 23 hours require operator review rather than
outliving the provider's 24-hour key retention. Mock/Emergent do not guarantee this.
A verified Resend webhook is the only writer of deliveredAt.
"""
import os
import uuid
import hashlib
import json
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

PENDING = "pending"
PROCESSING = "processing"
SENT = "sent"
RETRYABLE = "retryable-failed"
PERMANENT = "permanently-failed"
CANCELLED = "cancelled"
ATTENTION = (RETRYABLE, PERMANENT, PROCESSING)


class TransientDelivery(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class PermanentDelivery(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class CancelDelivery(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _now():
    return datetime.now(timezone.utc)


def _iso(moment=None):
    return (moment or _now()).isoformat()


def _int_env(name, default):
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def lease_seconds():
    return max(5, _int_env("NOTIFY_LEASE_SECONDS", 30))


def retry_base_seconds():
    try:
        return max(0.0, float(os.environ.get("NOTIFY_RETRY_BASE_SECONDS", "") or 2))
    except ValueError:
        return 2.0


def max_attempts():
    return max(1, _int_env("NOTIFY_MAX_ATTEMPTS", 5))


def retry_delay(attempts, base):
    return min(900.0, float(base) * (2 ** max(0, int(attempts) - 1)))


async def ensure_notifications(db):
    await db.nt_notifications.create_index("id", unique=True)
    await db.nt_notifications.create_index("dedupeKey", unique=True)
    await db.nt_notifications.create_index([("status", 1), ("nextAttemptAt", 1)])
    await db.nt_notifications.create_index("providerId", sparse=True)
    await db.nt_email_events.create_index("id", unique=True)
    await db.nt_email_events.create_index("expiresAt", expireAfterSeconds=0)


async def clear_notifications(db):
    await db.nt_notifications.delete_many({})


def _public(row):
    return {
        "id": row.get("id"),
        "kind": row.get("kind"),
        "ref": row.get("ref"),
        "appointmentId": row.get("appointmentId"),
        "status": row.get("status"),
        "attempts": row.get("attempts") or 0,
        "maxAttempts": row.get("maxAttempts"),
        "nextAttemptAt": row.get("nextAttemptAt"),
        "lastError": row.get("lastError"),
        "providerId": row.get("providerId"),
        "providerAcceptedAt": row.get("providerAcceptedAt"),
        "deliveredAt": row.get("deliveredAt"),
        "deliveryStatus": row.get("deliveryStatus"),
        "updatedAt": row.get("updatedAt"),
    }


async def notification_summary(db):
    counts = {}
    for status in (PENDING, PROCESSING, SENT, RETRYABLE, PERMANENT, CANCELLED):
        counts[status] = await db.nt_notifications.count_documents({"status": status})
    rows = await db.nt_notifications.find({"status": {"$in": list(ATTENTION)}}, {"_id": 0}).sort("updatedAt", -1).to_list(40)
    failures = await db.nt_notifications.find({"deliveryStatus": {"$in": ["bounced", "complained", "failed", "suppressed"]}}, {"_id": 0}).sort("updatedAt", -1).to_list(40)
    rows = list({row["id"]: row for row in [*rows, *failures]}.values())[:40]
    return {"counts": counts, "attention": [_public(row) for row in rows],
            "meanings": {
                "queued": "The booking row exists and a worker has not finished it.",
                "providerAccepted": "The provider API accepted the message. This is status 'sent'.",
                "delivered": "A delivery receipt was stored. Provider acceptance does not set this.",
                "failed": "The row is retryable-failed or permanently-failed.",
            }}


async def enqueue_booking_confirmation(db, appt, client_id):
    """Insert the intent. A duplicate appointment id returns the existing row."""
    now = _iso()
    doc = {
        "id": "ntf-" + uuid.uuid4().hex[:16],
        "dedupeKey": f"booking_confirmation:{appt['id']}",
        "kind": "booking_confirmation",
        "appointmentId": appt["id"],
        "ref": appt.get("ref"),
        "clientId": client_id,
        "status": PENDING,
        "attempts": 0,
        "maxAttempts": max_attempts(),
        "nextAttemptAt": now,
        "leaseUntil": None,
        "leaseOwner": None,
        "providerId": None,
        "providerAcceptedAt": None,
        "deliveredAt": None,
        "lastError": None,
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        await db.nt_notifications.insert_one(dict(doc))
    except DuplicateKeyError:
        found = await db.nt_notifications.find_one({"dedupeKey": doc["dedupeKey"]}, {"_id": 0})
        return found, False
    doc.pop("_id", None)
    return doc, True


OPERATIONAL_KINDS = {"cancellation", "reschedule", "assignment", "reminder_24h", "reminder_2h", "review_invite"}
PRACTITIONER_KINDS = {
    "practitioner_booking",
    "practitioner_cancellation",
    "practitioner_reschedule",
    "practitioner_reassignment",
}
BILLING_KINDS = {"invoice", "receipt", "payment_link", "billing_update"}


async def resolve_practitioner_account(db, practitioner_id):
    """Login email for the assigned practitioner. Supports dual Owner+Practitioner accounts."""
    if not practitioner_id:
        return None
    account = await db.nt_users.find_one(
        {
            "subject": practitioner_id,
            "$or": [
                {"role": {"$in": ["practitioner", "owner"]}},
                {"roles": {"$in": ["practitioner", "owner"]}},
            ],
            "status": {"$ne": "disabled"},
        },
        {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1, "roles": 1, "subject": 1},
    )
    if not account:
        return None
    email = str(account.get("email") or "").strip().lower()
    if not email or email.endswith("@example.com"):
        return None
    return account


async def enqueue_practitioner_notice(db, appt, kind):
    """Queue one practitioner operational email. Deduped per visit stamp + kind."""
    if kind not in PRACTITIONER_KINDS:
        raise ValueError("Unknown practitioner email")
    practitioner_id = appt.get("practitionerId")
    if not practitioner_id:
        return None, False
    now = _iso()
    stamp = f"{appt.get('date')}:{appt.get('time')}:{practitioner_id}:{appt.get('status')}"
    doc = {
        "id": "ntf-" + uuid.uuid4().hex[:16],
        "dedupeKey": f"{kind}:{appt['id']}:{stamp}",
        "kind": kind,
        "appointmentId": appt["id"],
        "ref": appt.get("ref"),
        "clientId": appt.get("clientId"),
        "practitionerId": practitioner_id,
        "recipientRole": "practitioner",
        "status": PENDING,
        "attempts": 0,
        "maxAttempts": max_attempts(),
        "nextAttemptAt": now,
        "leaseUntil": None,
        "leaseOwner": None,
        "providerId": None,
        "providerAcceptedAt": None,
        "deliveredAt": None,
        "lastError": None,
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        await db.nt_notifications.insert_one(dict(doc))
    except DuplicateKeyError:
        found = await db.nt_notifications.find_one({"dedupeKey": doc["dedupeKey"]}, {"_id": 0})
        return found, False
    doc.pop("_id", None)
    return doc, True


async def enqueue_billing(db, invoice, kind, key):
    """Queue one invoice, receipt, or payment-link email. Callers must keep this behind INVOICE_EMAIL_ENABLED."""
    if kind not in BILLING_KINDS:
        raise ValueError("Unknown billing email")
    now = _iso()
    doc = {"id": "ntf-" + uuid.uuid4().hex[:16], "dedupeKey": f"{kind}:{invoice['id']}:{key}"[:200], "kind": kind, "invoiceId": invoice["id"],
           "appointmentId": invoice.get("appointmentId"), "ref": invoice.get("number"), "clientId": invoice.get("clientId"), "status": PENDING,
           "attempts": 0, "maxAttempts": max_attempts(), "nextAttemptAt": now, "leaseUntil": None, "leaseOwner": None, "providerId": None,
           "providerAcceptedAt": None, "deliveredAt": None, "lastError": None, "createdAt": now, "updatedAt": now}
    try:
        await db.nt_notifications.insert_one(dict(doc))
    except DuplicateKeyError:
        return await db.nt_notifications.find_one({"dedupeKey": doc["dedupeKey"]}, {"_id": 0}), False
    doc.pop("_id", None)
    return doc, True


async def enqueue_operational(db, appt, client_id, kind):
    """Queue one lifecycle email. Callers must keep this behind EMAIL_LIFECYCLE_ENABLED."""
    if kind not in OPERATIONAL_KINDS:
        raise ValueError("Unknown operational email")
    now = _iso()
    stamp = f"{appt.get('date')}:{appt.get('time')}:{appt.get('practitionerId') or ''}:{appt.get('status')}"
    doc = {
        "id": "ntf-" + uuid.uuid4().hex[:16],
        "dedupeKey": f"{kind}:{appt['id']}:{stamp}",
        "kind": kind,
        "appointmentId": appt["id"],
        "ref": appt.get("ref"),
        "clientId": client_id,
        "status": PENDING,
        "attempts": 0,
        "maxAttempts": max_attempts(),
        "nextAttemptAt": now,
        "leaseUntil": None,
        "leaseOwner": None,
        "providerId": None,
        "providerAcceptedAt": None,
        "deliveredAt": None,
        "lastError": None,
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        await db.nt_notifications.insert_one(dict(doc))
    except DuplicateKeyError:
        found = await db.nt_notifications.find_one({"dedupeKey": doc["dedupeKey"]}, {"_id": 0})
        return found, False
    doc.pop("_id", None)
    return doc, True


async def enqueue_email_test(db, recipient, key):
    now = _iso()
    doc = {"id": "ntf-" + uuid.uuid4().hex[:16], "kind": "email_test", "dedupeKey": "email_test:" + hashlib.sha256(key.encode()).hexdigest(),
           "testRecipient": recipient, "status": PENDING, "attempts": 0, "maxAttempts": max_attempts(),
           "nextAttemptAt": now, "createdAt": now, "updatedAt": now, "deliveredAt": None}
    try:
        await db.nt_notifications.insert_one(dict(doc))
    except DuplicateKeyError:
        row = await db.nt_notifications.find_one({"dedupeKey": doc["dedupeKey"]}, {"_id": 0})
        if row.get("testRecipient") != recipient:
            raise PermanentDelivery("test_recipient_changed")
        return row, False
    return doc, True


async def freeze_delivery(db, note, envelope):
    """Do not retry changed content or outlive Resend's 24-hour key retention."""
    stamp = note.get("firstAttemptAt") or note.get("claimedAt") or _iso()
    if _now() - datetime.fromisoformat(stamp) >= timedelta(hours=23):
        raise PermanentDelivery("idempotency_window_requires_review")
    digest = hashlib.sha256(json.dumps(envelope, sort_keys=True).encode()).hexdigest()
    await db.nt_notifications.update_one({"id": note["id"], "deliveryFingerprint": {"$exists": False}}, {"$set": {"deliveryFingerprint": digest}})
    row = await db.nt_notifications.find_one({"id": note["id"]}, {"deliveryFingerprint": 1})
    if not row or row.get("deliveryFingerprint") != digest:
        raise PermanentDelivery("message_changed_requires_review")


async def enqueue_due_email_reminders(db, coll, now=None):
    if os.environ.get("EMAIL_REMINDERS_ENABLED", "false").lower() != "true":
        return 0
    from zoneinfo import ZoneInfo
    zone = ZoneInfo("America/Edmonton")
    moment = now or datetime.now(zone)
    days = [(moment + timedelta(days=d)).date().isoformat() for d in (0, 1, 2)]
    rows = await coll("appointments").find({"date": {"$in": days}, "status": {"$in": ["confirmed", "assigned", "preparing"]}}, {"_id": 0}).to_list(2000)
    queued = 0
    for row in rows:
        try:
            ahead = datetime.fromisoformat(f"{row['date']}T{row['time']}").replace(tzinfo=zone) - moment
        except (KeyError, ValueError):
            continue
        kind = "reminder_24h" if timedelta(hours=22) < ahead <= timedelta(hours=24) else "reminder_2h" if timedelta(hours=1) < ahead <= timedelta(hours=2) else None
        if kind and row.get("clientId"):
            _, created = await enqueue_operational(db, row, row["clientId"], kind)
            queued += int(created)
    return queued


def _due(now_s):
    return {"$or": [
        {"status": {"$in": [PENDING, RETRYABLE]}, "nextAttemptAt": {"$lte": now_s}},
        {"status": PROCESSING, "leaseUntil": {"$lte": now_s}},
    ]}


async def claim_one(db, worker_id, *, now=None, lease_for=None, notification_id=None):
    moment = now or _now()
    now_s = _iso(moment)
    lease = _iso(moment + timedelta(seconds=lease_for if lease_for is not None else lease_seconds()))
    claimed = await db.nt_notifications.find_one_and_update(
        {**_due(now_s), **({"id": notification_id} if notification_id else {})},
        {"$set": {"status": PROCESSING, "leaseOwner": worker_id, "leaseUntil": lease, "claimedAt": now_s, "updatedAt": now_s},
         "$inc": {"attempts": 1}},
        sort=[("nextAttemptAt", 1), ("createdAt", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        return None
    claimed.pop("_id", None)
    if not claimed.get("firstAttemptAt"):
        # Pre-upgrade uncertain retries cannot acquire a fresh provider window.
        first = claimed.get("createdAt", now_s) if claimed["attempts"] > 1 else now_s
        await db.nt_notifications.update_one({"id": claimed["id"], "firstAttemptAt": {"$exists": False}}, {"$set": {"firstAttemptAt": first}})
        claimed["firstAttemptAt"] = first
    return claimed


async def _owned_update(db, claimed, worker_id, fields):
    fields = {**fields, "leaseOwner": None, "leaseUntil": None, "updatedAt": _iso()}
    result = await db.nt_notifications.update_one(
        {"id": claimed["id"], "status": PROCESSING, "leaseOwner": worker_id},
        {"$set": fields},
    )
    return result.modified_count == 1


async def process_available(db, deliver, worker_id, audit, *, lease_for=None, retry_base=None, notification_id=None):
    """Claim one due row and finish it. Returns True when a row was claimed."""
    claimed = await claim_one(db, worker_id, lease_for=lease_for, notification_id=notification_id)
    if not claimed:
        return False
    try:
        provider_id = await deliver(claimed)
    except CancelDelivery as exc:
        await _owned_update(db, claimed, worker_id, {"status": CANCELLED, "lastError": exc.code, "deliveredAt": None})
        return True
    except PermanentDelivery as exc:
        if await _owned_update(db, claimed, worker_id, {"status": PERMANENT, "lastError": exc.code, "deliveredAt": None}):
            await audit(claimed, "failed")
        return True
    except TransientDelivery as exc:
        await _retry_or_exhaust(db, claimed, worker_id, exc.code, audit, retry_base)
        return True
    except Exception:
        await _retry_or_exhaust(db, claimed, worker_id, "unexpected", audit, retry_base)
        return True
    if provider_id:
        saved = await _owned_update(db, claimed, worker_id, {
            "status": SENT, "providerId": str(provider_id), "providerAcceptedAt": _iso(),
            "lastError": None,
        })
        if saved:
            await reconcile_email_receipts(db, str(provider_id))
            if claimed.get("kind") == "review_invite":
                await db.nt_review_invites.update_one({"appointmentId": claimed.get("appointmentId")}, {"$set": {"status": "sent", "providerId": str(provider_id), "sentAt": _iso()}})
            await audit(claimed, "sent")
    else:
        if await _owned_update(db, claimed, worker_id, {"status": PERMANENT, "lastError": "provider_disabled", "deliveredAt": None}):
            await audit(claimed, "failed")
    return True


async def _retry_or_exhaust(db, claimed, worker_id, code, audit, retry_base):
    limit = int(claimed.get("maxAttempts") or max_attempts())
    if int(claimed.get("attempts") or 0) >= limit:
        if await _owned_update(db, claimed, worker_id, {"status": PERMANENT, "lastError": code, "deliveredAt": None}):
            await audit(claimed, "failed")
        return
    delay = retry_delay(claimed.get("attempts") or 1, retry_base if retry_base is not None else retry_base_seconds())
    await _owned_update(db, claimed, worker_id, {
        "status": RETRYABLE, "lastError": code, "deliveredAt": None,
        "nextAttemptAt": _iso(_now() + timedelta(seconds=delay)),
    })


async def apply_delivery_receipt(db, event, event_id=None):
    """Record a verified provider receipt. Acceptance alone never calls this."""
    kind = str((event or {}).get("type") or "")
    data = (event or {}).get("data") or {}
    if not isinstance(data, dict):
        return False
    provider_id = str(data.get("email_id") or "")
    if not provider_id or kind not in ("email.delivered", "email.bounced", "email.complained", "email.delivery_delayed", "email.failed", "email.suppressed"):
        return False
    identity = event_id or hashlib.sha256(f"{provider_id}:{kind}:{event.get('created_at', '')}".encode()).hexdigest()
    await db.nt_email_events.update_one({"id": identity},
        {"$setOnInsert": {"providerId": provider_id, "kind": kind, "status": "awaiting_notification", "at": _iso(), "expiresAt": _now() + timedelta(days=90)}, "$inc": {"deliveries": 1}}, upsert=True)
    saved = await db.nt_email_events.find_one({"id": identity}, {"providerId": 1, "kind": 1})
    if saved["providerId"] != provider_id or saved["kind"] != kind:
        from fastapi import HTTPException
        raise HTTPException(409, "Conflicting email event identity")
    return await reconcile_email_receipts(db, provider_id)


async def reconcile_email_receipts(db, provider_id):
    """Durable early-event reconciliation; failure cannot be undone by late delivery."""
    terminal = ["bounced", "complained", "failed", "suppressed"]
    updated = False
    if not await db.nt_notifications.find_one({"providerId": provider_id}, {"id": 1}):
        return False
    rows = await db.nt_email_events.find({"providerId": provider_id, "status": "awaiting_notification"}, {"_id": 0}).sort("at", 1).to_list(1000)
    for row in rows:
        status = row["kind"].split(".", 1)[1]
        query = {"providerId": provider_id, "deliveryStatus": {"$ne": status}}
        fields = {"deliveryStatus": status, "updatedAt": _iso()}
        if status == "delivered":
            query.update(deliveredAt=None, deliveryStatus={"$nin": terminal})
            fields["deliveredAt"] = _iso()
        elif status == "delivery_delayed":
            query["deliveryStatus"] = {"$nin": [*terminal, "delivered", "delivery_delayed"]}
        else:
            fields["lastError"] = row["kind"]
        result = await db.nt_notifications.update_one(query, {"$set": fields})
        updated = bool(result.modified_count) or updated
        await db.nt_email_events.update_one({"id": row["id"]}, {"$set": {"status": "processed"}})
    return updated


async def reconcile_pending_email_receipts(db):
    """Repair a receipt after a worker/database failure without another send."""
    rows = await db.nt_email_events.aggregate([
        {"$match": {"status": "awaiting_notification"}},
        {"$lookup": {"from": "nt_notifications", "localField": "providerId", "foreignField": "providerId", "as": "notification"}},
        {"$match": {"notification.0": {"$exists": True}}},
        {"$limit": 100}, {"$project": {"providerId": 1}},
    ]).to_list(100)
    for provider_id in {row["providerId"] for row in rows}:
        await reconcile_email_receipts(db, provider_id)
