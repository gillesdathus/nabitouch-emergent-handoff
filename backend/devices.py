"""Push device registry and a held push outbox. Nothing is delivered until PUSH_ENABLED is approved and a provider is wired."""
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from config import _flag

PLATFORMS = ("ios", "android")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def push_enabled():
    return _flag("PUSH_ENABLED", False) and bool(_service_account())


def _service_account():
    """FIREBASE_SERVICE_ACCOUNT holds the JSON itself or a path to it. iOS goes through FCM with an APNs key uploaded in Firebase."""
    raw = (os.environ.get("FIREBASE_SERVICE_ACCOUNT") or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw) if raw.startswith("{") else json.load(open(raw))
    except (OSError, ValueError):
        logging.getLogger(__name__).error("Firebase service account could not be read")
        return None


def _access_token(info):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request as GoogleRequest
    creds = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/firebase.messaging"])
    creds.refresh(GoogleRequest())
    return creds.token


async def deliver(db, rows):
    """FCM HTTP v1. A token Firebase reports as unregistered deactivates the device."""
    info = _service_account()
    if not info or not rows:
        return
    import httpx
    token = await asyncio.to_thread(_access_token, info)
    url = f"https://fcm.googleapis.com/v1/projects/{info['project_id']}/messages:send"
    async with httpx.AsyncClient(timeout=10) as client:
        for row in rows:
            device = await db.nt_devices.find_one({"id": row["deviceId"], "active": True}, {"_id": 0, "token": 1})
            if not device:
                await db.nt_push_outbox.update_one({"id": row["id"]}, {"$set": {"status": "skipped"}})
                continue
            msg = {"message": {"token": device["token"], "notification": {"title": row["title"], "body": row["body"]},
                               "data": {k: str(v) for k, v in (row.get("data") or {}).items()}, "apns": {"payload": {"aps": {"sound": "default"}}}}}
            resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=msg)
            ok = resp.status_code < 300
            await db.nt_push_outbox.update_one({"id": row["id"]}, {"$set": {"status": "sent" if ok else "failed", "sentAt": now_iso(), "error": None if ok else resp.text[:200]}})
            if resp.status_code in (404, 400) and "UNREGISTERED" in resp.text:
                await db.nt_devices.update_one({"id": row["deviceId"]}, {"$set": {"active": False}})


async def ensure_devices(db):
    await db.nt_devices.create_index("id", unique=True)
    await db.nt_devices.create_index("token", unique=True)
    await db.nt_devices.create_index("userId")
    await db.nt_push_outbox.create_index("id", unique=True)
    await db.nt_push_outbox.create_index("dedupeKey", unique=True)


async def queue_push(db, user_ids, title, body, data, dedupe):
    """One held row per device. Status stays 'held' while push is off."""
    devices = await db.nt_devices.find({"userId": {"$in": list(user_ids)}, "active": True}, {"_id": 0}).to_list(200)
    queued = []
    for d in devices:
        row = {"id": "push-" + uuid.uuid4().hex[:12], "dedupeKey": f"{dedupe}:{d['id']}", "deviceId": d["id"], "userId": d["userId"], "platform": d["platform"],
               "title": title[:80], "body": body[:180], "data": data, "status": "queued" if push_enabled() else "held", "at": now_iso()}
        try:
            await db.nt_push_outbox.insert_one(dict(row))
            queued.append(row)
        except Exception:
            continue
    if push_enabled():
        try:
            await deliver(db, queued)
        except Exception:
            logging.getLogger(__name__).error("Push delivery failed; rows stay queued")
    return len(devices)


def build_devices_router(db, user_from):
    r = APIRouter(prefix="/api/devices")

    async def viewer(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    @r.post("")
    async def register(request: Request):
        user = await viewer(request)
        body = await request.json()
        platform, tok = body.get("platform"), str(body.get("token") or "").strip()
        if platform not in PLATFORMS or not 20 <= len(tok) <= 4096:
            raise HTTPException(400, "A platform (ios or android) and a push token are required")
        existing = await db.nt_devices.find_one({"token": tok}, {"_id": 0})
        fields = {"userId": user["id"], "role": user["role"], "platform": platform, "app": str(body.get("app") or "pro")[:20], "active": True, "lastSeenAt": now_iso()}
        if existing:
            await db.nt_devices.update_one({"id": existing["id"]}, {"$set": fields})
            return {"id": existing["id"], "pushEnabled": push_enabled()}
        doc = {"id": "dev-" + uuid.uuid4().hex[:12], "token": tok, "createdAt": now_iso(), **fields}
        await db.nt_devices.insert_one(dict(doc))
        return {"id": doc["id"], "pushEnabled": push_enabled()}

    @r.delete("/{did}")
    async def remove(did: str, request: Request):
        user = await viewer(request)
        res = await db.nt_devices.delete_one({"id": did, "userId": user["id"]})
        if not res.deleted_count:
            raise HTTPException(404, "Device not found")
        return {"ok": True}

    @r.get("/status")
    async def status(request: Request):
        user = await viewer(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can see push status")
        counts = {k: await db.nt_push_outbox.count_documents({"status": k}) for k in ("held", "queued", "sent", "failed")}
        return {"pushEnabled": push_enabled(), "flag": _flag("PUSH_ENABLED", False), "firebaseConfigured": bool(_service_account()), "outbox": counts,
                "devices": await db.nt_devices.count_documents({"active": True})}

    @r.get("")
    async def mine(request: Request):
        user = await viewer(request)
        rows = await db.nt_devices.find({"userId": user["id"]}, {"_id": 0, "token": 0}).to_list(20)
        return {"devices": rows, "pushEnabled": push_enabled()}

    return r
