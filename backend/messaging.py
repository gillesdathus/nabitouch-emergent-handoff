"""Appointment-scoped in-app messages and trip status notices.

Chat rows and trip notices are different records. Neither is an SMS or an email.
Redis, when configured, only wakes listeners with a message id. The body stays in Mongo.
"""
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

WRITE_BLOCKED = {"cancelled", "no_show", "closed"}
DELAYS = {5, 10, 15, 20, 30}
MAX_BODY = 500
WINDOW = timedelta(minutes=10)
LIMIT = 30

PRACTITIONER_PRESETS = [
    {"id": "on_my_way", "role": "practitioner", "body": "I'm on my way."},
    {"id": "started", "role": "practitioner", "body": "I've started my trip."},
    {"id": "late", "role": "practitioner", "label": "Running late", "body": "I'm running {minutes} minutes late.", "minutes": True},
    {"id": "arrived", "role": "practitioner", "body": "I've arrived."},
    {"id": "finding", "role": "practitioner", "body": "I'm having trouble finding the address."},
    {"id": "entrance", "role": "practitioner", "body": "Could you please confirm the entrance?"},
    {"id": "ready", "role": "practitioner", "body": "I'm ready when you are."},
    {"id": "access", "role": "practitioner", "label": "Building access", "body": "I'm at the building. Could you let me in or share the buzzer or door code?"},
    {"id": "area", "role": "practitioner", "label": "Set-up area", "body": "Where would you like me to set up? I need a clear area about 2 m by 3 m around the table."},
    {"id": "assist", "role": "practitioner", "label": "Meet me at the door", "body": "Could you meet me at the door? I need a hand with access before I bring in the table."},
]
CLIENT_PRESETS = [
    {"id": "ready", "role": "client", "body": "I'm ready. The space is set up."},
    {"id": "parking", "role": "client", "label": "Parking info", "body": "Parking: there's visitor parking out front. Details are in my access notes."},
    {"id": "client_late", "role": "client", "body": "I'm running {minutes} minutes late.", "minutes": True},
    {"id": "door_code", "role": "client", "label": "Door code", "body": "The door code is in my access notes. Message me here if it doesn't work."},
    {"id": "side", "role": "client", "body": "Please use the side entrance."},
    {"id": "meet", "role": "client", "body": "I'll meet you at the entrance."},
    {"id": "minutes", "role": "client", "body": "Could you give me a few minutes?"},
    {"id": "help", "role": "client", "body": "I need help with my appointment."},
]
PRESETS = {(item["role"], item["id"]): item for item in PRACTITIONER_PRESETS + CLIENT_PRESETS}

NOTICE_COPY = {
    "en_route": "Your Nabitouch therapist is on the way. Open Track Visit for an estimated arrival time.",
    "arrived": "Your Nabitouch therapist has arrived. Location sharing has stopped.",
    "completed": "The visit was marked complete.",
    "delayed": "A delay was saved on the visit.",
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(body):
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(body or "")).strip()
    text = re.sub(r"\s+", " ", text)
    if not text or len(text) > MAX_BODY:
        raise HTTPException(400, "Write a message of 500 characters or less")
    return text


def presets_for(role):
    if role == "client":
        return CLIENT_PRESETS
    if role == "practitioner":
        return PRACTITIONER_PRESETS
    return []


def _roles_of(user):
    roles = set(user.get("roles") or [])
    if user.get("role"):
        roles.add(user.get("role"))
    return roles


def acting_chat_role(user, appt=None):
    """Dual Owner+Practitioner accounts chat as practitioner on their assigned visits."""
    subject = user.get("subject")
    roles = _roles_of(user)
    if appt and subject and subject == appt.get("practitionerId") and ("practitioner" in roles or "owner" in roles):
        return "practitioner"
    return user.get("role")


def can_access(user, appt, perms, write=False):
    role = user.get("role")
    subject = user.get("subject")
    roles = _roles_of(user)
    if role == "owner" or "owner" in roles:
        return not write or appt.get("status") not in WRITE_BLOCKED
    if role == "client" and subject and subject == appt.get("clientId"):
        return not write or appt.get("status") not in WRITE_BLOCKED
    if subject and subject == appt.get("practitionerId") and ("practitioner" in roles or role == "practitioner"):
        return not write or appt.get("status") not in WRITE_BLOCKED
    if role == "desk":
        if write:
            return bool(perms.get("createBooking")) and appt.get("status") not in WRITE_BLOCKED
        return bool(perms.get("viewHistory") or perms.get("createBooking"))
    return False


def render_preset(preset, minutes=None, reason=""):
    body = preset["body"]
    if preset.get("minutes"):
        if minutes not in DELAYS:
            raise HTTPException(400, "Choose 5, 10, 15, 20, or 30 minutes")
        body = body.replace("{minutes}", str(minutes))
    reason = _clean(reason) if reason else ""
    if reason:
        body = f"{body} {reason}"
    return body


async def ensure_messaging(db):
    await db.nt_messages.create_index("id", unique=True)
    await db.nt_messages.create_index([("appointmentId", 1), ("createdAt", 1)])
    await db.nt_messages.create_index("idempotencyKey", unique=True, sparse=True)
    await db.nt_trip_notices.create_index("id", unique=True)
    await db.nt_trip_notices.create_index("dedupeKey", unique=True)
    await db.nt_trip_notices.create_index([("appointmentId", 1), ("at", 1)])


def _public_message(row):
    return {
        "id": row.get("id"),
        "appointmentId": row.get("appointmentId"),
        "authorRole": row.get("authorRole"),
        "authorLabel": row.get("authorLabel"),
        "body": row.get("body"),
        "presetId": row.get("presetId"),
        "channel": "in_app",
        "kind": "chat",
        "createdAt": row.get("createdAt"),
        "deliveredAt": row.get("deliveredAt"),
        "readBy": row.get("readBy") or {},
        "sms": False,
        "email": False,
    }


def _public_notice(row):
    return {
        "id": row.get("id"),
        "appointmentId": row.get("appointmentId"),
        "event": row.get("event"),
        "body": row.get("body"),
        "channel": "in_app",
        "chat": False,
        "sms": False,
        "email": False,
        "at": row.get("at"),
        "delayMin": row.get("delayMin"),
    }


async def record_trip_notice(db, appt, event, delay_min=None, reason=""):
    """Persist an in-app status. This does not create a chat message, email, or SMS."""
    if event not in NOTICE_COPY:
        return None
    stamp = _now()
    delay = int(delay_min) if delay_min else None
    dedupe = f"{appt['id']}:{event}:{delay or ''}:{stamp[:16]}" if event == "delayed" else f"{appt['id']}:{event}"
    body = NOTICE_COPY[event]
    if event == "delayed" and delay:
        body = f"Running {delay} minutes late was saved on the visit. This status is in the app only."
    if reason:
        body = f"{body} Note: {str(reason)[:120]}"
    doc = {
        "id": "ntc-" + uuid.uuid4().hex[:16],
        "dedupeKey": dedupe,
        "appointmentId": appt["id"],
        "clientId": appt.get("clientId"),
        "practitionerId": appt.get("practitionerId"),
        "event": event,
        "body": body,
        "channel": "in_app",
        "chat": False,
        "sms": False,
        "email": False,
        "delayMin": delay,
        "at": stamp,
    }
    try:
        await db.nt_trip_notices.insert_one(dict(doc))
    except DuplicateKeyError:
        return None
    doc.pop("_id", None)
    await _wake(appt["id"], {"type": "notice", "id": doc["id"]})
    return doc


async def _wake(appointment_id, payload):
    url = os.environ.get("REDIS_URL") or ""
    if not url:
        return
    try:
        import redis.asyncio as redis
        client = redis.from_url(url, decode_responses=True)
        try:
            await client.publish(f"nt:msg:{appointment_id}", json.dumps(payload))
        finally:
            await client.aclose()
    except Exception:
        return


def build_messaging_router(db, coll, user_from, add_audit, reception_perms):
    router = APIRouter(prefix="/api")

    async def viewer(request: Request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def load(aid, user, write=False):
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        perms = await reception_perms() if user.get("role") == "desk" else {}
        if not can_access(user, appt, perms, write=write):
            raise HTTPException(403, "Not permitted for this conversation")
        return appt

    @router.get("/messages/presets")
    async def list_presets(request: Request):
        user = await viewer(request)
        role = user.get("role")
        if "practitioner" in _roles_of(user):
            role = "practitioner"
        return {"presets": presets_for(role), "delays": sorted(DELAYS), "sms": False, "email": False}

    @router.get("/inbox")
    async def inbox(request: Request):
        user = await viewer(request)
        role = user.get("role")
        subject = user.get("subject")
        roles = _roles_of(user)
        # Dual-role practitioners (e.g. Nabitu) count unread on their assigned visits.
        if subject and "practitioner" in roles:
            query = {
                "practitionerId": subject,
                "authorRole": {"$nin": ["practitioner", "owner"]},
                "readBy.practitioner": {"$exists": False},
            }
            unread = await db.nt_messages.count_documents(query)
            return {"unread": unread, "channel": "in_app", "sms": False, "email": False}
        query = {"authorRole": {"$ne": role}, f"readBy.{role}": {"$exists": False}}
        if role == "client":
            query["clientId"] = subject
        elif role == "practitioner":
            query["practitionerId"] = subject
        elif role == "desk":
            perms = await reception_perms()
            if not (perms.get("viewHistory") or perms.get("createBooking")):
                return {"unread": 0, "channel": "in_app", "sms": False, "email": False}
        elif role != "owner":
            return {"unread": 0, "channel": "in_app", "sms": False, "email": False}
        unread = await db.nt_messages.count_documents(query)
        return {"unread": unread, "channel": "in_app", "sms": False, "email": False}

    @router.get("/appointments/{aid}/messages")
    async def list_messages(aid: str, request: Request):
        user = await viewer(request)
        appt = await load(aid, user)
        messages = await db.nt_messages.find({"appointmentId": aid}, {"_id": 0}).sort("createdAt", 1).to_list(200)
        notices = await db.nt_trip_notices.find({"appointmentId": aid}, {"_id": 0}).sort("at", 1).to_list(100)
        return {
            "messages": [_public_message(row) for row in messages],
            "notices": [_public_notice(row) for row in notices],
            "canWrite": can_access(user, appt, await reception_perms() if user.get("role") == "desk" else {}, write=True),
            "channel": "in_app",
            "sms": False,
            "email": False,
        }

    @router.post("/appointments/{aid}/messages")
    async def post_message(aid: str, request: Request):
        user = await viewer(request)
        appt = await load(aid, user, write=True)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid message")
        preset_id = body.get("presetId") or None
        minutes = body.get("minutes")
        reason = body.get("reason") or ""
        preset = PRESETS.get((user.get("role"), preset_id)) if preset_id else None
        if preset_id and not preset:
            raise HTTPException(403, "That quick message is not available for your role")
        if preset:
            text = render_preset(preset, int(minutes) if str(minutes).isdigit() else minutes, reason)
            if body.get("body"):
                text = _clean(body.get("body"))
        else:
            text = _clean(body.get("body"))
        if len(text) > MAX_BODY:
            raise HTTPException(400, "Write a message of 500 characters or less")
        key = str(body.get("idempotencyKey") or "").strip()[:80] or None
        if key:
            key = f"{aid}:{user.get('id')}:{key}"
            existing = await db.nt_messages.find_one({"idempotencyKey": key}, {"_id": 0})
            if existing:
                return {"message": _public_message(existing), "duplicate": True}
        since = (datetime.now(timezone.utc) - WINDOW).isoformat()
        recent = await db.nt_messages.count_documents({"appointmentId": aid, "authorId": user.get("id"), "createdAt": {"$gte": since}})
        if recent >= LIMIT:
            raise HTTPException(429, "Too many messages. Wait a few minutes and try again.")
        delay = None
        if body.get("recordDelay"):
            roles = _roles_of(user)
            if not ({"practitioner", "owner"} & roles):
                raise HTTPException(403, "Only the assigned practitioner can record a delay")
            chosen = int(minutes) if str(minutes).isdigit() else None
            if chosen not in DELAYS:
                raise HTTPException(400, "Choose 5, 10, 15, 20, or 30 minutes")
            key = f"{aid}:{user.get('id')}:late:{chosen}:{_now()[:16]}"
            existing = await db.nt_messages.find_one({"idempotencyKey": key}, {"_id": 0})
            if existing:
                return {"message": _public_message(existing), "duplicate": True}
            delay = (chosen, _clean(reason) if reason else f"Running {chosen} minutes late")
        stamp = _now()
        chat_role = acting_chat_role(user, appt)
        labels = {"client": "Client", "practitioner": "Practitioner", "desk": "Reception", "owner": "Owner"}
        doc = {
            "id": "msg-" + uuid.uuid4().hex[:16],
            "idempotencyKey": key,
            "appointmentId": aid,
            "clientId": appt.get("clientId"),
            "practitionerId": appt.get("practitionerId"),
            "authorId": user.get("id"),
            "authorRole": chat_role,
            "authorLabel": labels.get(chat_role, "Participant"),
            "body": text,
            "presetId": preset_id,
            "channel": "in_app",
            "kind": "chat",
            "createdAt": stamp,
            "deliveredAt": stamp,
            "readBy": {chat_role: stamp},
            "sms": False,
            "email": False,
        }
        if not key:
            doc.pop("idempotencyKey", None)  # sparse unique index ignores missing fields, not explicit nulls
        try:
            await db.nt_messages.insert_one(dict(doc))
        except DuplicateKeyError:
            existing = await db.nt_messages.find_one({"idempotencyKey": key}, {"_id": 0}) if key else None
            if existing:
                return {"message": _public_message(existing), "duplicate": True}
            raise
        doc.pop("_id", None)
        if delay:
            # The unique message key won the race, so the delay side effects run once.
            chosen, note = delay
            await coll("appointments").update_one({"id": aid}, {"$set": {"delayMin": chosen}, "$push": {"events": {"status": "delayed", "at": _now(), "actor": user.get("name") or "practitioner", "note": note}}})
            await add_audit(user.get("name") or "practitioner", f"{appt.get('ref')} → delayed · {chosen} min", aid)
            await record_trip_notice(db, {**appt, "delayMin": chosen}, "delayed", chosen, reason)
        if user.get("role") == "client":
            from devices import notify
            await notify(db, "client_message", doc["id"], appt)
        await add_audit(user.get("name") or doc["authorLabel"], f"{appt.get('ref')} in-app message", aid)
        await _wake(aid, {"type": "message", "id": doc["id"]})
        return {"message": _public_message(doc), "duplicate": False}

    @router.post("/appointments/{aid}/messages/read")
    async def mark_read(aid: str, request: Request):
        user = await viewer(request)
        appt = await load(aid, user)
        role = acting_chat_role(user, appt)
        stamp = _now()
        await db.nt_messages.update_many(
            {"appointmentId": aid, "authorRole": {"$ne": role}, f"readBy.{role}": {"$exists": False}},
            {"$set": {f"readBy.{role}": stamp}},
        )
        return {"ok": True, "channel": "in_app"}

    @router.get("/appointments/{aid}/messages/stream")
    async def stream(aid: str, request: Request):
        user = await viewer(request)
        await load(aid, user)
        url = os.environ.get("REDIS_URL") or ""

        async def gen():
            yield "event: ready\ndata: {}\n\n"
            if not url:
                return
            try:
                import redis.asyncio as redis
                client = redis.from_url(url, decode_responses=True)
                pubsub = client.pubsub()
            except Exception:
                return
            try:
                await pubsub.subscribe(f"nt:msg:{aid}")
                while True:
                    if await request.is_disconnected():
                        break
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
                    if message and message.get("type") == "message":
                        yield f"data: {message.get('data')}\n\n"
                    else:
                        yield ": ping\n\n"
            finally:
                await pubsub.unsubscribe()
                await pubsub.aclose()
                await client.aclose()

        return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return router
