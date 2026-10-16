"""Winback invites: one-time return codes for inactive clients. Codes are copied by staff; nothing is emailed from here."""
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from zoneinfo import ZoneInfo

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

DEFAULTS = {"inactiveDays": 60, "percent": 15, "validDays": 30}
DONE = ("completed", "processing", "closed")
OPEN = ("requested", "confirmed", "assigned", "preparing", "en_route", "arrived", "in_session", "interrupted", "safety_hold")
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def today_local():
    return datetime.now(ZoneInfo("America/Edmonton")).date()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_winback(db):
    await db.nt_winback.create_index("id", unique=True)
    await db.nt_winback.create_index("code", unique=True)
    await db.nt_winback.create_index([("clientId", 1), ("status", 1)])


async def winback_settings(db):
    row = await db.nt_settings.find_one({"id": "app"}, {"_id": 0, "winback": 1}) or {}
    return {**DEFAULTS, **(row.get("winback") or {})}


def norm(code):
    return str(code or "").strip().upper()


async def valid_invite(db, code, client_id):
    invite = await db.nt_winback.find_one({"code": norm(code)}, {"_id": 0})
    if not invite or invite["clientId"] != client_id:
        raise HTTPException(404, "That welcome-back code was not found for this profile")
    if invite["status"] != "issued":
        raise HTTPException(409, "That welcome-back code was already used")
    if invite["expiresAt"] < now_iso():
        await db.nt_winback.update_one({"id": invite["id"], "status": "issued"}, {"$set": {"status": "expired"}})
        raise HTTPException(409, "That welcome-back code has expired")
    return invite


def winback_quote(quoted, percent, gst, service):
    """Percent off the treatment only. Never stacks with promotions, credits or rewards."""
    base = float(quoted["base"])
    discount = round(base * percent / 100, 2)
    subtotal = round(base - discount + float(quoted["addons"]) + float(quoted["travel"]), 2)
    tax = 0.0 if (service or {}).get("taxable") is False else round(subtotal * gst, 2)
    return {**quoted, "discount": discount, "promoId": None, "promoName": f"Welcome back offer ({percent:g}% off)", "promoCode": None, "welcomeOffer": False,
            "appliedPromoIds": [], "tax": tax, "total": round(subtotal + tax, 2), "treatmentAfterDiscount": round(base - discount, 2), "winback": True}


async def reserve_invite(db, code, client_id, appointment_id):
    saved = await db.nt_winback.find_one_and_update({"code": norm(code), "clientId": client_id, "status": "issued", "expiresAt": {"$gte": now_iso()}},
                                                    {"$set": {"status": "reserved", "appointmentId": appointment_id, "reservedAt": now_iso()}}, return_document=ReturnDocument.AFTER)
    if not saved:
        raise HTTPException(409, "That welcome-back code is no longer available")
    return saved


async def settle_invite(db, appointment_id, to):
    if to == "completed":
        await db.nt_winback.update_one({"appointmentId": appointment_id, "status": "reserved"}, {"$set": {"status": "redeemed", "redeemedAt": now_iso()}})
    elif to in ("cancelled", "no_show"):
        await db.nt_winback.update_one({"appointmentId": appointment_id, "status": "reserved"}, {"$set": {"status": "issued", "appointmentId": None, "reservedAt": None}})


def build_winback_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api/winback")

    async def owner(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can manage winback invites")
        return user

    @r.get("/settings")
    async def get_settings(request: Request):
        await owner(request)
        return await winback_settings(db)

    @r.put("/settings")
    async def put_settings(request: Request):
        user = await owner(request)
        body = await request.json()
        days, pct, valid = body.get("inactiveDays"), body.get("percent"), body.get("validDays")
        if not isinstance(days, int) or not 14 <= days <= 365:
            raise HTTPException(400, "Inactivity must be between 14 and 365 days")
        if not isinstance(pct, (int, float)) or not 1 <= pct <= 50:
            raise HTTPException(400, "The discount must be between 1% and 50%")
        if not isinstance(valid, int) or not 7 <= valid <= 90:
            raise HTTPException(400, "Codes must be valid for 7 to 90 days")
        doc = {"inactiveDays": days, "percent": float(pct), "validDays": valid}
        await db.nt_settings.update_one({"id": "app"}, {"$set": {"winback": doc}}, upsert=True)
        await add_audit(user.get("name") or "owner", f"Winback settings: {days} days inactive, {pct:g}% off, valid {valid} days")
        return doc

    @r.get("/candidates")
    async def candidates(request: Request):
        await owner(request)
        cfg = await winback_settings(db)
        cutoff = (today_local() - timedelta(days=cfg["inactiveDays"])).isoformat()
        appts = await coll("appointments").find({"status": {"$in": list(DONE + OPEN)}}, {"_id": 0, "clientId": 1, "date": 1, "status": 1}).to_list(50000)
        last, upcoming = {}, set()
        for a in appts:
            if a["status"] in OPEN and a.get("date", "") >= today_local().isoformat():
                upcoming.add(a["clientId"])
            if a["status"] in DONE:
                last[a["clientId"]] = max(last.get(a["clientId"], ""), a.get("date", ""))
        ids = [cid for cid, d in last.items() if d and d < cutoff and cid not in upcoming]
        clients = {c["id"]: c for c in await coll("clients").find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "firstName": 1, "lastName": 1, "email": 1}).to_list(5000)}
        live = {i["clientId"]: i for i in await db.nt_winback.find({"clientId": {"$in": ids}, "status": {"$in": ["issued", "reserved"]}}, {"_id": 0}).to_list(5000)}
        rows = [{"clientId": cid, "name": f"{clients[cid].get('firstName', '')} {clients[cid].get('lastName', '')}".strip(), "lastVisit": last[cid],
                 "daysInactive": (today_local() - date.fromisoformat(last[cid][:10])).days, "invite": live.get(cid)} for cid in ids if cid in clients]
        return {"settings": cfg, "candidates": sorted(rows, key=lambda r: r["lastVisit"])}

    @r.post("/invites")
    async def create(request: Request):
        user = await owner(request)
        cid = (await request.json()).get("clientId")
        cfg = await winback_settings(db)
        if not await coll("clients").find_one({"id": cid}, {"_id": 0, "id": 1}):
            raise HTTPException(404, "Client not found")
        if await db.nt_winback.find_one({"clientId": cid, "status": {"$in": ["issued", "reserved"]}, "expiresAt": {"$gte": now_iso()}}):
            raise HTTPException(409, "This client already has an active welcome-back code")
        for _ in range(5):
            doc = {"id": "wb-" + uuid.uuid4().hex[:10], "code": "BACK-" + "".join(secrets.choice(ALPHABET) for _ in range(6)), "clientId": cid, "percent": cfg["percent"],
                   "status": "issued", "createdAt": now_iso(), "createdBy": user.get("name"), "expiresAt": (datetime.now(timezone.utc) + timedelta(days=cfg["validDays"])).isoformat(),
                   "delivery": "copy_only"}
            try:
                await db.nt_winback.insert_one(dict(doc))
                break
            except DuplicateKeyError:
                continue
        await add_audit(user.get("name") or "owner", f"Winback code created for {cid} ({cfg['percent']:g}% off)")
        return doc

    @r.get("/invites")
    async def invites(request: Request):
        await owner(request)
        rows = await db.nt_winback.find({}, {"_id": 0}).sort("createdAt", -1).to_list(500)
        names = {c["id"]: f"{c.get('firstName', '')} {c.get('lastName', '')}".strip() for c in await coll("clients").find({"id": {"$in": list({r["clientId"] for r in rows})}}, {"_id": 0, "id": 1, "firstName": 1, "lastName": 1}).to_list(500)}
        return [{**r, "clientName": names.get(r["clientId"])} for r in rows]

    @r.post("/invites/{wid}/void")
    async def void(wid: str, request: Request):
        user = await owner(request)
        saved = await db.nt_winback.find_one_and_update({"id": wid, "status": "issued"}, {"$set": {"status": "voided"}}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if not saved:
            raise HTTPException(409, "Only an unused code can be voided")
        await add_audit(user.get("name") or "owner", f"Winback code {saved['code']} voided")
        return saved

    @r.get("/mine")
    async def mine(request: Request):
        user = await user_from(request)
        if not user or user["role"] != "client":
            raise HTTPException(401, "Not authenticated")
        row = await db.nt_winback.find_one({"clientId": user.get("subject"), "status": "issued", "expiresAt": {"$gte": now_iso()}}, {"_id": 0})
        return {"invite": {k: row[k] for k in ("code", "percent", "expiresAt")} if row else None}

    return r
