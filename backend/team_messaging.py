"""Staff Team Connect messaging — invitation-only DMs and groups.

Separate from appointment-scoped client visit chat in messaging.py.
Unread is keyed by user id so dual-role accounts are not double-counted.
"""
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from rbac import STAFF_ROLES, effective_roles, is_privileged, require_roles

MAX_BODY = 2000
WINDOW = timedelta(minutes=10)
LIMIT = 40
MAX_MEMBERS = 40


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(body):
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(body or "")).strip()
    text = re.sub(r"\s+", " ", text)
    if not text or len(text) > MAX_BODY:
        raise HTTPException(400, f"Write a message of {MAX_BODY} characters or less")
    return text


def _dm_key(user_a, user_b):
    pair = sorted([user_a, user_b])
    return f"dm:{pair[0]}:{pair[1]}"


async def ensure_team_messaging(db):
    await db.nt_staff_threads.create_index("id", unique=True)
    await db.nt_staff_threads.create_index("dmKey", unique=True, sparse=True)
    await db.nt_staff_threads.create_index("memberIds")
    await db.nt_staff_threads.create_index([("updatedAt", -1)])
    await db.nt_staff_messages.create_index("id", unique=True)
    await db.nt_staff_messages.create_index([("threadId", 1), ("createdAt", 1)])
    await db.nt_staff_messages.create_index("idempotencyKey", unique=True, sparse=True)


def _public_member(user):
    roles = effective_roles(user)
    return {
        "id": user.get("id"),
        "name": user.get("name") or user.get("email") or "Staff",
        "role": user.get("role") or (roles[0] if roles else "staff"),
        "roles": roles,
        "email": user.get("email"),
    }


def _public_thread(thread, me_id, unread=0):
    return {
        "id": thread.get("id"),
        "kind": thread.get("kind"),
        "title": thread.get("title") or "",
        "memberIds": list(thread.get("memberIds") or []),
        "members": list(thread.get("members") or []),
        "createdBy": thread.get("createdBy"),
        "createdAt": thread.get("createdAt"),
        "updatedAt": thread.get("updatedAt"),
        "lastMessageAt": thread.get("lastMessageAt"),
        "lastPreview": thread.get("lastPreview") or "",
        "lastAuthorId": thread.get("lastAuthorId"),
        "unread": int(unread or 0),
        "mine": me_id in (thread.get("memberIds") or []),
    }


def _public_message(row):
    return {
        "id": row.get("id"),
        "threadId": row.get("threadId"),
        "authorId": row.get("authorId"),
        "authorName": row.get("authorName"),
        "authorRole": row.get("authorRole"),
        "body": row.get("body"),
        "createdAt": row.get("createdAt"),
        "deliveredAt": row.get("deliveredAt"),
        "failedAt": row.get("failedAt"),
        "status": row.get("status") or ("failed" if row.get("failedAt") else "delivered"),
        "readBy": row.get("readBy") or {},
        "channel": "in_app",
        "sms": False,
        "email": False,
    }


async def _wake(thread_id, payload):
    url = os.environ.get("REDIS_URL") or ""
    if not url:
        return
    try:
        import json
        import redis.asyncio as redis
        client = redis.from_url(url, decode_responses=True)
        try:
            await client.publish(f"nt:team:{thread_id}", json.dumps(payload))
        finally:
            await client.aclose()
    except Exception:
        return


async def staff_unread_for_user(db, user_id):
    """Unread staff-thread messages for one user id (not role)."""
    if not user_id:
        return 0, {}
    threads = await db.nt_staff_threads.find(
        {"memberIds": user_id, "archived": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(500)
    ids = [row["id"] for row in threads if row.get("id")]
    if not ids:
        return 0, {}
    cursor = db.nt_staff_messages.aggregate([
        {
            "$match": {
                "threadId": {"$in": ids},
                "authorId": {"$ne": user_id},
                "status": {"$ne": "failed"},
                f"readBy.{user_id}": {"$exists": False},
            }
        },
        {"$group": {"_id": "$threadId", "count": {"$sum": 1}}},
    ])
    by_thread = {}
    total = 0
    async for row in cursor:
        tid = row.get("_id")
        count = int(row.get("count") or 0)
        if tid and count:
            by_thread[tid] = count
            total += count
    return total, by_thread


def build_team_messaging_router(db, user_from, add_audit):
    router = APIRouter(prefix="/api/team", tags=["team-connect"])

    async def viewer(request: Request):
        user = await user_from(request)
        require_roles(user, *STAFF_ROLES)
        if not is_privileged(user):
            raise HTTPException(403, "Staff only")
        return user

    async def load_thread(thread_id, user, *, write=False):
        thread = await db.nt_staff_threads.find_one({"id": thread_id}, {"_id": 0})
        if not thread or thread.get("archived"):
            raise HTTPException(404, "Conversation not found")
        if user.get("id") not in (thread.get("memberIds") or []):
            raise HTTPException(403, "Only invited members can open this conversation")
        return thread

    async def resolve_staff(ids):
        wanted = [str(i) for i in (ids or []) if i]
        if not wanted:
            return []
        rows = await db.nt_users.find(
            {
                "id": {"$in": wanted},
                "$or": [{"role": {"$in": list(STAFF_ROLES)}}, {"roles": {"$in": list(STAFF_ROLES)}}],
            },
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "roles": 1, "status": 1},
        ).to_list(len(wanted))
        by_id = {row["id"]: row for row in rows if row.get("id")}
        missing = [i for i in wanted if i not in by_id]
        if missing:
            raise HTTPException(400, "Choose active staff members only")
        return [_public_member(by_id[i]) for i in wanted]

    @router.get("/directory")
    async def directory(request: Request):
        user = await viewer(request)
        rows = await db.nt_users.find(
            {
                "$or": [{"role": {"$in": list(STAFF_ROLES)}}, {"roles": {"$in": list(STAFF_ROLES)}}],
                "status": {"$ne": "disabled"},
            },
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "roles": 1},
        ).sort("name", 1).to_list(300)
        people = [_public_member(row) for row in rows if row.get("id") and row.get("id") != user.get("id")]
        return {"people": people, "channel": "in_app"}

    @router.get("/inbox")
    async def inbox(request: Request):
        user = await viewer(request)
        unread, by_thread = await staff_unread_for_user(db, user.get("id"))
        return {
            "unread": unread,
            "byThread": by_thread,
            "channel": "in_app",
            "scope": "staff_threads",
            "sms": False,
            "email": False,
        }

    @router.get("/threads")
    async def list_threads(request: Request, q: str = ""):
        user = await viewer(request)
        me = user.get("id")
        rows = await db.nt_staff_threads.find(
            {"memberIds": me, "archived": {"$ne": True}},
            {"_id": 0},
        ).sort("updatedAt", -1).to_list(200)
        unread_total, by_thread = await staff_unread_for_user(db, me)
        needle = (q or "").strip().lower()
        out = []
        for thread in rows:
            item = _public_thread(thread, me, by_thread.get(thread.get("id"), 0))
            if needle:
                names = " ".join(m.get("name") or "" for m in item["members"]).lower()
                hay = f"{item.get('title') or ''} {names} {item.get('lastPreview') or ''}".lower()
                if needle not in hay:
                    continue
            out.append(item)
        return {"threads": out, "unread": unread_total, "channel": "in_app"}

    @router.post("/threads")
    async def create_thread(request: Request):
        user = await viewer(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid conversation")
        kind = body.get("kind") or "dm"
        if kind not in ("dm", "group"):
            raise HTTPException(400, "Choose a direct or group conversation")
        member_ids = [str(i) for i in (body.get("memberIds") or []) if i and i != user.get("id")]
        member_ids = list(dict.fromkeys(member_ids))
        if kind == "dm":
            if len(member_ids) != 1:
                raise HTTPException(400, "Direct messages need exactly one other staff member")
            title = ""
            dm_key = _dm_key(user["id"], member_ids[0])
            existing = await db.nt_staff_threads.find_one({"dmKey": dm_key, "archived": {"$ne": True}}, {"_id": 0})
            if existing:
                return {"thread": _public_thread(existing, user["id"]), "created": False}
        else:
            title = re.sub(r"\s+", " ", str(body.get("title") or "").strip())[:80]
            if len(title) < 2:
                raise HTTPException(400, "Give the group a name")
            if not member_ids:
                raise HTTPException(400, "Invite at least one staff member")
            dm_key = None
        if len(member_ids) + 1 > MAX_MEMBERS:
            raise HTTPException(400, f"Groups support up to {MAX_MEMBERS} members")
        members = await resolve_staff(member_ids)
        me_public = _public_member(user)
        all_members = [me_public] + members
        all_ids = [m["id"] for m in all_members]
        stamp = _now()
        doc = {
            "id": "sth-" + uuid.uuid4().hex[:16],
            "kind": kind,
            "title": title,
            "dmKey": dm_key,
            "memberIds": all_ids,
            "members": all_members,
            "createdBy": user.get("id"),
            "createdAt": stamp,
            "updatedAt": stamp,
            "lastMessageAt": None,
            "lastPreview": "",
            "lastAuthorId": None,
            "archived": False,
        }
        if not dm_key:
            doc.pop("dmKey", None)
        try:
            await db.nt_staff_threads.insert_one(dict(doc))
        except DuplicateKeyError:
            if dm_key:
                existing = await db.nt_staff_threads.find_one({"dmKey": dm_key}, {"_id": 0})
                if existing:
                    return {"thread": _public_thread(existing, user["id"]), "created": False}
            raise
        doc.pop("_id", None)
        await add_audit(user.get("name") or "staff", f"Team Connect {kind} created", doc["id"])
        return {"thread": _public_thread(doc, user["id"]), "created": True}

    @router.get("/threads/{thread_id}")
    async def get_thread(thread_id: str, request: Request):
        user = await viewer(request)
        thread = await load_thread(thread_id, user)
        _, by_thread = await staff_unread_for_user(db, user.get("id"))
        return {"thread": _public_thread(thread, user["id"], by_thread.get(thread_id, 0))}

    @router.post("/threads/{thread_id}/members")
    async def invite_members(thread_id: str, request: Request):
        user = await viewer(request)
        thread = await load_thread(thread_id, user, write=True)
        if thread.get("kind") != "group":
            raise HTTPException(400, "Only groups accept additional invites")
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid invite")
        add_ids = [str(i) for i in (body.get("memberIds") or []) if i]
        add_ids = [i for i in dict.fromkeys(add_ids) if i not in (thread.get("memberIds") or [])]
        if not add_ids:
            raise HTTPException(400, "Choose someone new to invite")
        if len(thread.get("memberIds") or []) + len(add_ids) > MAX_MEMBERS:
            raise HTTPException(400, f"Groups support up to {MAX_MEMBERS} members")
        newcomers = await resolve_staff(add_ids)
        stamp = _now()
        await db.nt_staff_threads.update_one(
            {"id": thread_id},
            {
                "$addToSet": {"memberIds": {"$each": add_ids}, "members": {"$each": newcomers}},
                "$set": {"updatedAt": stamp},
            },
        )
        refreshed = await db.nt_staff_threads.find_one({"id": thread_id}, {"_id": 0})
        await add_audit(user.get("name") or "staff", f"Team Connect group invite · {len(add_ids)}", thread_id)
        return {"thread": _public_thread(refreshed, user["id"]), "invited": len(add_ids)}

    @router.get("/threads/{thread_id}/messages")
    async def list_messages(thread_id: str, request: Request):
        user = await viewer(request)
        thread = await load_thread(thread_id, user)
        messages = await db.nt_staff_messages.find(
            {"threadId": thread_id},
            {"_id": 0},
        ).sort("createdAt", 1).to_list(400)
        return {
            "thread": _public_thread(thread, user["id"]),
            "messages": [_public_message(row) for row in messages],
            "canWrite": True,
            "channel": "in_app",
            "sms": False,
            "email": False,
        }

    @router.post("/threads/{thread_id}/messages")
    async def post_message(thread_id: str, request: Request):
        user = await viewer(request)
        thread = await load_thread(thread_id, user, write=True)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid message")
        text = _clean(body.get("body"))
        key = str(body.get("idempotencyKey") or "").strip()[:80] or None
        if key:
            key = f"{thread_id}:{user.get('id')}:{key}"
            existing = await db.nt_staff_messages.find_one({"idempotencyKey": key}, {"_id": 0})
            if existing:
                return {"message": _public_message(existing), "duplicate": True}
        since = (datetime.now(timezone.utc) - WINDOW).isoformat()
        recent = await db.nt_staff_messages.count_documents(
            {"threadId": thread_id, "authorId": user.get("id"), "createdAt": {"$gte": since}}
        )
        if recent >= LIMIT:
            raise HTTPException(429, "Too many messages. Wait a few minutes and try again.")
        stamp = _now()
        roles = effective_roles(user)
        doc = {
            "id": "stm-" + uuid.uuid4().hex[:16],
            "idempotencyKey": key,
            "threadId": thread_id,
            "authorId": user.get("id"),
            "authorName": user.get("name") or "Staff",
            "authorRole": user.get("role") or (roles[0] if roles else "staff"),
            "body": text,
            "createdAt": stamp,
            "deliveredAt": stamp,
            "failedAt": None,
            "status": "delivered",
            "readBy": {user.get("id"): stamp},
            "channel": "in_app",
            "sms": False,
            "email": False,
        }
        if not key:
            doc.pop("idempotencyKey", None)
        try:
            await db.nt_staff_messages.insert_one(dict(doc))
        except DuplicateKeyError:
            existing = await db.nt_staff_messages.find_one({"idempotencyKey": key}, {"_id": 0}) if key else None
            if existing:
                return {"message": _public_message(existing), "duplicate": True}
            raise
        doc.pop("_id", None)
        preview = text if len(text) <= 120 else text[:117] + "…"
        await db.nt_staff_threads.update_one(
            {"id": thread_id},
            {
                "$set": {
                    "updatedAt": stamp,
                    "lastMessageAt": stamp,
                    "lastPreview": preview,
                    "lastAuthorId": user.get("id"),
                }
            },
        )
        await add_audit(user.get("name") or "staff", f"Team Connect message · {thread.get('kind')}", thread_id)
        await _wake(thread_id, {"type": "message", "id": doc["id"]})
        return {"message": _public_message(doc), "duplicate": False}

    @router.post("/threads/{thread_id}/messages/{message_id}/retry")
    async def retry_message(thread_id: str, message_id: str, request: Request):
        user = await viewer(request)
        await load_thread(thread_id, user, write=True)
        row = await db.nt_staff_messages.find_one({"id": message_id, "threadId": thread_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Message not found")
        if row.get("authorId") != user.get("id"):
            raise HTTPException(403, "Only the author can retry a failed message")
        stamp = _now()
        await db.nt_staff_messages.update_one(
            {"id": message_id},
            {"$set": {"status": "delivered", "deliveredAt": stamp, "failedAt": None}},
        )
        row = await db.nt_staff_messages.find_one({"id": message_id}, {"_id": 0})
        await _wake(thread_id, {"type": "message", "id": message_id})
        return {"message": _public_message(row)}

    @router.post("/threads/{thread_id}/messages/read")
    async def mark_read(thread_id: str, request: Request):
        user = await viewer(request)
        await load_thread(thread_id, user)
        stamp = _now()
        me = user.get("id")
        await db.nt_staff_messages.update_many(
            {
                "threadId": thread_id,
                "authorId": {"$ne": me},
                f"readBy.{me}": {"$exists": False},
            },
            {"$set": {f"readBy.{me}": stamp}},
        )
        return {"ok": True, "channel": "in_app"}

    @router.get("/threads/{thread_id}/messages/stream")
    async def stream(thread_id: str, request: Request):
        user = await viewer(request)
        await load_thread(thread_id, user)
        url = os.environ.get("REDIS_URL") or ""

        async def gen():
            yield "event: ready\ndata: {}\n\n"
            if not url:
                return
            try:
                import asyncio
                import json
                import redis.asyncio as redis
                client = redis.from_url(url, decode_responses=True)
                pubsub = client.pubsub()
                await pubsub.subscribe(f"nt:team:{thread_id}")
                try:
                    while True:
                        if await request.is_disconnected():
                            break
                        message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15.0)
                        if message and message.get("data"):
                            yield f"data: {message['data']}\n\n"
                        else:
                            yield "event: ping\ndata: {}\n\n"
                        await asyncio.sleep(0.05)
                finally:
                    await pubsub.unsubscribe(f"nt:team:{thread_id}")
                    await pubsub.aclose()
                    await client.aclose()
            except Exception:
                return

        return StreamingResponse(gen(), media_type="text/event-stream")

    return router
