"""Push notifications via the Firebase Admin SDK.
Device tokens are sealed at rest. Each notification kind has a fixed audience. Every outbox row has a unique key and is claimed atomically before sending.
Nothing is delivered unless PUSH_ENABLED=true and a valid service-account file is configured."""
import asyncio
import hashlib
import json
import logging
import os
import stat
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from config import _flag
from fieldcrypto import open_text, seal

log = logging.getLogger(__name__)
PLATFORMS = ("ios", "android")
MAX_DEVICES_PER_USER = 5
MAX_REGISTRATIONS_PER_HOUR = 10
MAX_ATTEMPTS = 5
CLAIM_TIMEOUT_S = 300
HELD_TTL_H = 1
APP_NAME = "nabitouch-push"
ANDROID_PACKAGE = "com.nabitouch.practitioner"

# Fixed audiences and copy. Payloads carry no health, address or location data, only a short title and an in-app path.
KINDS = {
    "safety_alert": {"audience": "safety", "title": "Safety alert", "body": "{who} needs attention on {ref}.", "path": "/owner/safety"},
    "visit_assigned": {"audience": "practitioner", "title": "New visit assigned", "body": "{ref} on {date} at {time}.", "path": "/pro/visit/{aid}"},
    "visit_rescheduled": {"audience": "practitioner", "title": "Visit rescheduled", "body": "{ref} moved to {date} at {time}.", "path": "/pro/visit/{aid}"},
    "visit_cancelled": {"audience": "practitioner", "title": "Visit cancelled", "body": "{ref} on {date} was cancelled.", "path": "/pro"},
    "client_message": {"audience": "practitioner", "title": "New message", "body": "Your client sent a message about {ref}.", "path": "/pro/visit/{aid}/messages"},
}


def now():
    return datetime.now(timezone.utc)


def now_iso():
    return now().isoformat()


def token_hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


# --- credentials ---------------------------------------------------------------------------------

def credential_state():
    """Validates the service-account file without logging its contents. Returns (state, project_id)."""
    path = (os.environ.get("FIREBASE_SERVICE_ACCOUNT_FILE") or "").strip()
    expected = (os.environ.get("FIREBASE_PROJECT_ID") or "").strip()
    if not path:
        return "missing", None
    real = os.path.realpath(path)
    if real.startswith("/app/") or real == "/app":
        return "inside_code_folder", None
    try:
        info = os.stat(real)
    except OSError:
        return "unreadable", None
    if not stat.S_ISREG(info.st_mode):
        return "unreadable", None
    if info.st_mode & 0o077:
        return "insecure_permissions", None
    try:
        with open(real) as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return "invalid_json", None
    if data.get("type") != "service_account" or not data.get("private_key") or not data.get("client_email"):
        return "not_a_service_account", None
    if not expected or data.get("project_id") != expected:
        return "project_mismatch", None
    return "ok", expected


def push_enabled():
    return _flag("PUSH_ENABLED", False) and credential_state()[0] == "ok"


def dry_run():
    return _flag("PUSH_DRY_RUN", True)


def _app():
    import firebase_admin
    from firebase_admin import credentials
    try:
        return firebase_admin.get_app(APP_NAME)
    except ValueError:
        state, project = credential_state()
        if state != "ok":
            raise RuntimeError(f"Firebase credentials not usable: {state}")
        path = os.path.realpath(os.environ["FIREBASE_SERVICE_ACCOUNT_FILE"])
        return firebase_admin.initialize_app(credentials.Certificate(path), {"projectId": project}, name=APP_NAME)


def _send_one(token, row):
    from firebase_admin import messaging
    msg = messaging.Message(
        token=token,
        notification=messaging.Notification(title=row["title"], body=row["body"]),
        data={k: str(v) for k, v in (row.get("data") or {}).items()},
        android=messaging.AndroidConfig(priority="high", collapse_key=row["kind"], restricted_package_name=ANDROID_PACKAGE,
                                        notification=messaging.AndroidNotification(channel_id="safety" if row["kind"] == "safety_alert" else "visits")),
        apns=messaging.APNSConfig(headers={"apns-priority": "10"}, payload=messaging.APNSPayload(aps=messaging.Aps(sound="default"))),
    )
    return messaging.send(msg, dry_run=dry_run(), app=_app())


def _dead_token(exc):
    from firebase_admin import exceptions, messaging
    if isinstance(exc, (messaging.UnregisteredError, messaging.SenderIdMismatchError)):
        return True
    return isinstance(exc, exceptions.InvalidArgumentError) and "registration token" in str(exc).lower()


# --- storage -------------------------------------------------------------------------------------

async def ensure_devices(db):
    for legacy in ("token_1",):
        try:
            await db.nt_devices.drop_index(legacy)
        except Exception:
            pass
    async for d in db.nt_devices.find({"token": {"$exists": True}}, {"_id": 0, "id": 1, "token": 1}):
        await db.nt_devices.update_one({"id": d["id"]}, {"$set": {"tokenHash": token_hash(d["token"]), "tokenSealed": seal(d["token"]), "fingerprint": token_hash(d["token"])[-8:]},
                                                         "$unset": {"token": ""}})
    await db.nt_devices.create_index("id", unique=True)
    await db.nt_devices.create_index("tokenHash", unique=True, sparse=True)
    await db.nt_devices.create_index([("userId", 1), ("active", 1)])
    await db.nt_devices.create_index("sessionId", sparse=True)
    await db.nt_push_outbox.create_index("id", unique=True)
    await db.nt_push_outbox.create_index("dedupeKey", unique=True)
    await db.nt_push_outbox.create_index([("status", 1), ("nextAttemptAt", 1)])
    await db.nt_device_registrations.create_index("at", expireAfterSeconds=3600)


async def revoke_devices(db, reason, *, session_id=None, user_id=None, device_id=None):
    query = {"active": True}
    if session_id:
        query["sessionId"] = session_id
    if user_id:
        query["userId"] = user_id
    if device_id:
        query["id"] = device_id
    if len(query) == 1:
        return 0
    res = await db.nt_devices.update_many(query, {"$set": {"active": False, "revokedAt": now_iso(), "revokedReason": reason}, "$unset": {"tokenSealed": ""}})
    return res.modified_count


async def _audience(db, kind, appt):
    who = KINDS[kind]["audience"]
    if who == "safety":
        settings = await db.nt_settings.find_one({"id": "app"}, {"_id": 0, "safetyManagers": 1}) or {}
        owners = [u["id"] for u in await db.nt_users.find({"role": "owner"}, {"_id": 0, "id": 1}).to_list(10)]
        return set(owners) | set(settings.get("safetyManagers") or [])
    pid = (appt or {}).get("practitionerId")
    if not pid:
        return set()
    return {u["id"] for u in await db.nt_users.find({"role": {"$in": ["practitioner", "owner"]}, "subject": pid}, {"_id": 0, "id": 1}).to_list(5)}


async def notify(db, kind, dedupe, appt=None, **fields):
    """Queue one row per active device of the fixed audience. While push is off rows are 'held' and never sent."""
    spec = KINDS[kind]
    appt = appt or {}
    ctx = {"ref": appt.get("ref") or "", "date": appt.get("date") or "", "time": appt.get("time") or "", "aid": appt.get("id") or "", "who": "A practitioner", **fields}
    users = await _audience(db, kind, appt)
    if not users:
        return 0
    devices = await db.nt_devices.find({"userId": {"$in": list(users)}, "active": True}, {"_id": 0, "id": 1, "userId": 1, "platform": 1}).to_list(200)
    live = push_enabled()
    queued = 0
    for d in devices:
        row = {"id": "push-" + uuid.uuid4().hex[:12], "dedupeKey": f"{kind}:{dedupe}:{d['id']}", "kind": kind, "deviceId": d["id"], "userId": d["userId"], "platform": d["platform"],
               "title": spec["title"], "body": spec["body"].format(**ctx)[:180], "data": {"kind": kind, "path": spec["path"].format(**ctx)},
               "status": "queued" if live else "held", "attempts": 0, "nextAttemptAt": now_iso(), "at": now_iso()}
        try:
            await db.nt_push_outbox.insert_one(row)
            queued += 1
        except DuplicateKeyError:
            continue
    if live and queued:
        asyncio.get_running_loop().create_task(_safe_process(db))
    return queued


async def _safe_process(db):
    try:
        await process_outbox(db)
    except Exception:
        log.error("Push processing stopped; rows stay queued for the next run")


async def _claim(db):
    stamp = now()
    stale = (stamp - timedelta(seconds=CLAIM_TIMEOUT_S)).isoformat()
    return await db.nt_push_outbox.find_one_and_update(
        {"$or": [{"status": {"$in": ["queued", "retry"]}, "nextAttemptAt": {"$lte": stamp.isoformat()}}, {"status": "sending", "claimedAt": {"$lt": stale}}]},
        {"$set": {"status": "sending", "claimedAt": stamp.isoformat(), "claimId": uuid.uuid4().hex}, "$inc": {"attempts": 1}},
        sort=[("nextAttemptAt", 1)], return_document=ReturnDocument.AFTER, projection={"_id": 0})


async def _finish(db, row, fields):
    await db.nt_push_outbox.update_one({"id": row["id"], "claimId": row["claimId"]}, {"$set": fields})


async def process_outbox(db, limit=50):
    """Claim, send once, record. A row is only ever sent by the worker that holds its claimId."""
    if not push_enabled():
        return {"processed": 0, "enabled": False}
    held_cutoff = (now() - timedelta(hours=HELD_TTL_H)).isoformat()
    await db.nt_push_outbox.update_many({"status": "held", "at": {"$lt": held_cutoff}}, {"$set": {"status": "expired"}})
    done = 0
    for _ in range(limit):
        row = await _claim(db)
        if not row:
            break
        done += 1
        device = await db.nt_devices.find_one({"id": row["deviceId"], "active": True}, {"_id": 0})
        session_ok = True
        if device and device.get("sessionId"):
            s = await db.nt_sessions.find_one({"sid": device["sessionId"]}, {"_id": 0, "revoked": 1, "expiresAt": 1})
            session_ok = bool(s) and not s.get("revoked") and (s.get("expiresAt") or "") > now_iso()
            if not session_ok:
                await revoke_devices(db, "session_ended", device_id=device["id"])
        if not device or not session_ok or not device.get("tokenSealed"):
            await _finish(db, row, {"status": "skipped", "finishedAt": now_iso(), "error": "device inactive"})
            continue
        try:
            message_id = await asyncio.to_thread(_send_one, open_text(device["tokenSealed"]), row)
            await _finish(db, row, {"status": "sent", "messageId": message_id, "dryRun": dry_run(), "finishedAt": now_iso(), "error": None})
        except Exception as exc:
            if _dead_token(exc):
                await revoke_devices(db, "token_invalid", device_id=device["id"])
                await _finish(db, row, {"status": "dead", "finishedAt": now_iso(), "error": type(exc).__name__})
            elif row["attempts"] >= MAX_ATTEMPTS:
                await _finish(db, row, {"status": "failed", "finishedAt": now_iso(), "error": type(exc).__name__})
            else:
                wait = 30 * 2 ** (row["attempts"] - 1)
                await _finish(db, row, {"status": "retry", "nextAttemptAt": (now() + timedelta(seconds=wait)).isoformat(), "error": type(exc).__name__})
    return {"processed": done, "enabled": True}


# --- API -----------------------------------------------------------------------------------------

def public_device(d):
    return {k: d.get(k) for k in ("id", "platform", "app", "role", "active", "fingerprint", "createdAt", "lastSeenAt", "revokedAt", "revokedReason", "userId")}


def build_devices_router(db, user_from):
    r = APIRouter(prefix="/api/devices")

    async def viewer(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def owner(request):
        user = await viewer(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can manage push")
        return user

    @r.post("")
    async def register(request: Request):
        user = await viewer(request)
        if user["role"] not in ("owner", "practitioner", "desk"):
            raise HTTPException(403, "Push is available in the practitioner app only")
        try:
            body = await request.json()
        except Exception:
            body = {}
        platform, tok = body.get("platform"), str(body.get("token") or "").strip()
        if platform not in PLATFORMS or not 20 <= len(tok) <= 4096 or any(c.isspace() for c in tok):
            raise HTTPException(400, "A platform (ios or android) and a push token are required")
        if await db.nt_device_registrations.count_documents({"userId": user["id"]}) >= MAX_REGISTRATIONS_PER_HOUR:
            raise HTTPException(429, "Too many device registrations. Try again later")
        await db.nt_device_registrations.insert_one({"userId": user["id"], "at": now()})
        digest = token_hash(tok)
        fields = {"userId": user["id"], "role": user["role"], "platform": platform, "app": str(body.get("app") or "pro")[:20], "active": True, "sessionId": user.get("sid"),
                  "tokenSealed": seal(tok), "fingerprint": digest[-8:], "lastSeenAt": now_iso(), "revokedAt": None, "revokedReason": None}
        saved = await db.nt_devices.find_one_and_update({"tokenHash": digest}, {"$set": fields, "$setOnInsert": {"id": "dev-" + uuid.uuid4().hex[:12], "createdAt": now_iso()}},
                                                        upsert=True, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        extra = await db.nt_devices.find({"userId": user["id"], "active": True, "id": {"$ne": saved["id"]}}, {"_id": 0, "id": 1}).sort("lastSeenAt", -1).to_list(50)
        for d in extra[MAX_DEVICES_PER_USER - 1:]:
            await revoke_devices(db, "device_limit", device_id=d["id"])
        return {**public_device(saved), "pushEnabled": push_enabled()}

    @r.delete("/{did}")
    async def remove(did: str, request: Request):
        user = await viewer(request)
        query = {"id": did} if user["role"] == "owner" else {"id": did, "userId": user["id"]}
        device = await db.nt_devices.find_one(query, {"_id": 0, "id": 1})
        if not device:
            raise HTTPException(404, "Device not found")
        await revoke_devices(db, "removed_by_owner" if user["role"] == "owner" else "removed_by_user", device_id=did)
        return {"ok": True}

    @r.get("")
    async def mine(request: Request):
        user = await viewer(request)
        rows = await db.nt_devices.find({"userId": user["id"]}, {"_id": 0}).sort("lastSeenAt", -1).to_list(20)
        return {"devices": [public_device(d) for d in rows], "pushEnabled": push_enabled()}

    @r.get("/all")
    async def all_devices(request: Request):
        await owner(request)
        rows = await db.nt_devices.find({}, {"_id": 0}).sort("lastSeenAt", -1).to_list(500)
        return [public_device(d) for d in rows]

    @r.get("/status")
    async def status(request: Request):
        await owner(request)
        counts = {k: await db.nt_push_outbox.count_documents({"status": k}) for k in ("held", "queued", "sending", "retry", "sent", "failed", "dead", "skipped", "expired")}
        state, project = credential_state()
        return {"pushEnabled": push_enabled(), "flag": _flag("PUSH_ENABLED", False), "dryRun": dry_run(), "credentials": state, "projectId": project,
                "firebaseConfigured": state == "ok", "outbox": counts, "devices": await db.nt_devices.count_documents({"active": True}), "kinds": list(KINDS)}

    @r.post("/outbox/process")
    async def process(request: Request):
        await owner(request)
        return await process_outbox(db)

    return r
