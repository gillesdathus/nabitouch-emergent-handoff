"""Durable booking-email outbox.

MongoDB is the source of truth. Redis is not used. A row is queued when it is
inserted, sent when the provider accepts it, and never marked delivered from
that acceptance alone. If the process dies after the provider accepts and
before this row is updated, a later retry can send a second copy. Resend accepts
an Idempotency-Key for that window. The mock and Emergent providers do not.
A verified Resend webhook is the only writer of deliveredAt.
"""
import os
import uuid
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
        "updatedAt": row.get("updatedAt"),
    }


async def notification_summary(db):
    counts = {}
    for status in (PENDING, PROCESSING, SENT, RETRYABLE, PERMANENT, CANCELLED):
        counts[status] = await db.nt_notifications.count_documents({"status": status})
    rows = await db.nt_notifications.find({"status": {"$in": list(ATTENTION)}}, {"_id": 0}).sort("updatedAt", -1).to_list(40)
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


OPERATIONAL_KINDS = {"cancellation", "reschedule", "assignment"}


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


def _due(now_s):
    return {"$or": [
        {"status": {"$in": [PENDING, RETRYABLE]}, "nextAttemptAt": {"$lte": now_s}},
        {"status": PROCESSING, "leaseUntil": {"$lte": now_s}},
    ]}


async def claim_one(db, worker_id, *, now=None, lease_for=None):
    moment = now or _now()
    now_s = _iso(moment)
    lease = _iso(moment + timedelta(seconds=lease_for if lease_for is not None else lease_seconds()))
    claimed = await db.nt_notifications.find_one_and_update(
        _due(now_s),
        {"$set": {"status": PROCESSING, "leaseOwner": worker_id, "leaseUntil": lease, "claimedAt": now_s, "updatedAt": now_s},
         "$inc": {"attempts": 1}},
        sort=[("nextAttemptAt", 1), ("createdAt", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        return None
    claimed.pop("_id", None)
    return claimed


async def _owned_update(db, claimed, worker_id, fields):
    fields = {**fields, "leaseOwner": None, "leaseUntil": None, "updatedAt": _iso()}
    result = await db.nt_notifications.update_one(
        {"id": claimed["id"], "status": PROCESSING, "leaseOwner": worker_id},
        {"$set": fields},
    )
    return result.modified_count == 1


async def process_available(db, deliver, worker_id, audit, *, lease_for=None, retry_base=None):
    """Claim one due row and finish it. Returns True when a row was claimed."""
    claimed = await claim_one(db, worker_id, lease_for=lease_for)
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
            "deliveredAt": None, "lastError": None,
        })
        if saved:
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


async def apply_delivery_receipt(db, event):
    """Record a verified provider receipt. Acceptance alone never calls this."""
    kind = str((event or {}).get("type") or "")
    data = (event or {}).get("data") or {}
    provider_id = str(data.get("email_id") or "")
    if not provider_id or kind not in ("email.delivered", "email.bounced", "email.complained"):
        return False
    if kind == "email.delivered":
        result = await db.nt_notifications.update_one(
            {"providerId": provider_id, "deliveredAt": None},
            {"$set": {"deliveredAt": _iso(), "deliveryStatus": "delivered", "updatedAt": _iso()}},
        )
        return result.modified_count == 1
    status = "bounced" if kind == "email.bounced" else "complained"
    result = await db.nt_notifications.update_one(
        {"providerId": provider_id},
        {"$set": {"deliveryStatus": status, "lastError": kind, "updatedAt": _iso()}},
    )
    return result.modified_count == 1
