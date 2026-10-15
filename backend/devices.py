"""Push device registry and a held push outbox. Nothing is delivered until PUSH_ENABLED is approved and a provider is wired."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from config import _flag

PLATFORMS = ("ios", "android")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def push_enabled():
    return _flag("PUSH_ENABLED", False)


async def ensure_devices(db):
    await db.nt_devices.create_index("id", unique=True)
    await db.nt_devices.create_index("token", unique=True)
    await db.nt_devices.create_index("userId")
    await db.nt_push_outbox.create_index("id", unique=True)
    await db.nt_push_outbox.create_index("dedupeKey", unique=True)


async def queue_push(db, user_ids, title, body, data, dedupe):
    """One held row per device. Status stays 'held' while push is off."""
    devices = await db.nt_devices.find({"userId": {"$in": list(user_ids)}, "active": True}, {"_id": 0}).to_list(200)
    for d in devices:
        row = {"id": "push-" + uuid.uuid4().hex[:12], "dedupeKey": f"{dedupe}:{d['id']}", "deviceId": d["id"], "userId": d["userId"], "platform": d["platform"],
               "title": title[:80], "body": body[:180], "data": data, "status": "queued" if push_enabled() else "held", "at": now_iso()}
        try:
            await db.nt_push_outbox.insert_one(row)
        except Exception:
            continue
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

    @r.get("")
    async def mine(request: Request):
        user = await viewer(request)
        rows = await db.nt_devices.find({"userId": user["id"]}, {"_id": 0, "token": 0}).to_list(20)
        return {"devices": rows, "pushEnabled": push_enabled()}

    return r
