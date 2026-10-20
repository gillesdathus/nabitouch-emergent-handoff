"""Follow-up coupons issued after a completed acquisition campaign visit.

Winback-shaped: personal percent-off code, one redemption, never stacks with
WELCOME20, flash campaigns, package credit, or rewards.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def norm(code):
    return str(code or "").strip().upper()


async def ensure_followup(db):
    await db.nt_followup_coupons.create_index("id", unique=True)
    await db.nt_followup_coupons.create_index("code", unique=True)
    await db.nt_followup_coupons.create_index([("clientId", 1), ("status", 1)])
    await db.nt_followup_coupons.create_index("appointmentId", unique=True, sparse=True)


def followup_quote(quoted, percent, gst, service):
    """Percent off treatment only. Exclusive — clears other promo markers."""
    base = float(quoted["base"])
    discount = round(base * float(percent) / 100, 2)
    subtotal = round(base - discount + float(quoted.get("addons") or 0) + float(quoted.get("travel") or 0), 2)
    tax = 0.0 if (service or {}).get("taxable") is False else round(subtotal * float(gst), 2)
    return {
        **quoted,
        "discount": discount,
        "promoId": None,
        "promoName": f"Follow-up offer ({percent:g}% off)",
        "promoCode": None,
        "welcomeOffer": False,
        "appliedPromoIds": [],
        "tax": tax,
        "total": round(subtotal + tax, 2),
        "treatmentAfterDiscount": round(base - discount, 2),
        "followUp": True,
        "winback": False,
    }


async def valid_followup(db, code, client_id):
    row = await db.nt_followup_coupons.find_one({"code": norm(code)}, {"_id": 0})
    if not row or row.get("clientId") != client_id:
        raise HTTPException(404, "That follow-up code was not found for this profile")
    if row.get("status") != "issued":
        raise HTTPException(409, "That follow-up code was already used")
    if row.get("expiresAt") and row["expiresAt"] < now_iso():
        await db.nt_followup_coupons.update_one({"id": row["id"], "status": "issued"}, {"$set": {"status": "expired"}})
        raise HTTPException(409, "That follow-up code has expired")
    return row


async def reserve_followup(db, code, client_id, appointment_id):
    saved = await db.nt_followup_coupons.find_one_and_update(
        {"code": norm(code), "clientId": client_id, "status": "issued", "expiresAt": {"$gte": now_iso()}},
        {"$set": {"status": "reserved", "redeemAppointmentId": appointment_id, "reservedAt": now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if not saved:
        raise HTTPException(409, "That follow-up code is no longer available")
    return saved


async def settle_followup(db, appointment_id, to):
    if to == "completed":
        await db.nt_followup_coupons.update_one(
            {"redeemAppointmentId": appointment_id, "status": "reserved"},
            {"$set": {"status": "redeemed", "redeemedAt": now_iso()}},
        )
    elif to in ("cancelled", "no_show"):
        await db.nt_followup_coupons.update_one(
            {"redeemAppointmentId": appointment_id, "status": "reserved"},
            {"$set": {"status": "issued", "redeemAppointmentId": None, "reservedAt": None}},
        )


async def issue_on_complete(db, appointment, add_audit=None):
    """Issue a follow-up coupon when a campaign visit completes (idempotent per appointment)."""
    if not appointment or appointment.get("status") not in ("completed",):
        return None
    pricing = appointment.get("pricing") or {}
    campaign_id = pricing.get("campaignId")
    if not campaign_id:
        return None
    existing = await db.nt_followup_coupons.find_one({"appointmentId": appointment["id"]}, {"_id": 0})
    if existing:
        return existing
    campaign = await db.nt_campaigns.find_one({"id": campaign_id}, {"_id": 0})
    if not campaign:
        return None
    follow = campaign.get("followUp") or {}
    if not follow.get("enabled") or follow.get("autoIssueOnComplete") is False:
        return None
    percent = float(follow.get("percent") or 20)
    valid_days = int(follow.get("validDays") or 14)
    client_id = appointment.get("clientId")
    if not client_id:
        return None
    for _ in range(5):
        doc = {
            "id": "fu-" + uuid.uuid4().hex[:10],
            "campaignId": campaign_id,
            "clientId": client_id,
            "code": "NEXT-" + "".join(secrets.choice(ALPHABET) for _ in range(6)),
            "percent": percent,
            "expiresAt": (datetime.now(timezone.utc) + timedelta(days=valid_days)).isoformat(),
            "status": "issued",
            "appointmentId": appointment["id"],
            "createdAt": now_iso(),
        }
        try:
            await db.nt_followup_coupons.insert_one(dict(doc))
            doc.pop("_id", None)
            if add_audit:
                await add_audit("system", f"Follow-up coupon {doc['code']} issued after {appointment.get('ref')}", appointment["id"])
            return doc
        except DuplicateKeyError:
            again = await db.nt_followup_coupons.find_one({"appointmentId": appointment["id"]}, {"_id": 0})
            if again:
                return again
            continue
    return None


def build_followup_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api/followup-coupons")

    async def owner(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can manage follow-up coupons")
        return user

    @r.get("")
    async def list_coupons(request: Request):
        await owner(request)
        rows = await db.nt_followup_coupons.find({}, {"_id": 0}).sort("createdAt", -1).to_list(500)
        names = {
            c["id"]: f"{c.get('firstName', '')} {c.get('lastName', '')}".strip()
            for c in await coll("clients").find(
                {"id": {"$in": list({row["clientId"] for row in rows})}},
                {"_id": 0, "id": 1, "firstName": 1, "lastName": 1},
            ).to_list(500)
        }
        return [{**row, "clientName": names.get(row["clientId"]) or "Deleted client"} for row in rows]

    @r.post("/{coupon_id}/void")
    async def void_coupon(coupon_id: str, request: Request):
        user = await owner(request)
        saved = await db.nt_followup_coupons.find_one_and_update(
            {"id": coupon_id, "status": "issued"},
            {"$set": {"status": "void"}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not saved:
            raise HTTPException(409, "Only an unused follow-up code can be voided")
        await add_audit(user.get("name") or "owner", f"Follow-up code {saved['code']} voided")
        return saved

    @r.get("/mine")
    async def mine(request: Request):
        user = await user_from(request)
        if not user or user["role"] != "client":
            raise HTTPException(401, "Not authenticated")
        rows = await db.nt_followup_coupons.find(
            {"clientId": user.get("subject"), "status": "issued", "expiresAt": {"$gte": now_iso()}},
            {"_id": 0},
        ).to_list(20)
        return {
            "coupons": [
                {k: row[k] for k in ("id", "code", "percent", "expiresAt", "campaignId") if k in row}
                for row in rows
            ]
        }

    return r
