"""Append-only rewards ledger. Earning, redemption, and NabiDerm stay off until the owner authorizes them."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from money import dollars, to_cents
from pricing import money

CLINICAL_KEYS = {"soap", "notes", "diagnosis", "treatment", "clinical", "address", "line", "email", "phone", "name"}


def now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat()


def proposed_rules():
    return {
        "active": False,
        "pointsPerDollar": 1,
        "referrerPoints": 200,
        "welcomePoints": 100,
        "pointsPerDollarValue": 100,
        "maxRedeemCents": 5000,
        "serviceRedeemable": True,
        "travelRedeemable": True,
        "productRedeemable": False,
    }


def default_badges():
    return [
        {"id": "explorer", "name": "Wellness Explorer", "active": False, "visible": True, "perk": "", "criteria": {"completedVisits": 1}},
        {"id": "regular", "name": "Wellness Regular", "active": False, "visible": True, "perk": "", "criteria": {"completedVisits": 5}},
        {"id": "gold", "name": "Nabitouch Gold", "active": False, "visible": True, "perk": "", "criteria": {"completedVisits": 12}},
        {"id": "ambassador", "name": "Wellness Ambassador", "active": False, "visible": True, "perk": "", "criteria": {"qualifiedReferrals": 3}},
    ]


def launch_rewards():
    return {
        "enabled": False,
        "earningEnabled": False,
        "redemptionEnabled": False,
        "referralsEnabled": False,
        "nabidermEnabled": False,
        "stackWithPromotions": False,
        "taxTreatment": "unconfirmed",
        "rules": proposed_rules(),
        "badges": default_badges(),
    }


def can_configure(role):
    return role == "owner"


def rewards_from_client(payload):
    """Draft rates can be saved. Client-supplied activation flags cannot turn rewards on."""
    return validate_rewards(payload, authorize=False, tax_confirmed=False)


def validate_rewards(incoming, *, authorize=False, tax_confirmed=False):
    current = launch_rewards()
    raw = incoming or {}
    rules = {**current["rules"], **(raw.get("rules") or {})}
    rules["active"] = False
    badges = raw.get("badges") if isinstance(raw.get("badges"), list) else current["badges"]
    saved = {
        **current,
        "rules": rules,
        "badges": [_badge(row) for row in badges],
        "stackWithPromotions": False,
        "taxTreatment": "confirmed_pre_tax" if tax_confirmed else "unconfirmed",
        "nabidermEnabled": False,
    }
    flags = ("enabled", "earningEnabled", "redemptionEnabled", "referralsEnabled")
    if authorize and tax_confirmed:
        for flag in flags:
            saved[flag] = bool(raw.get(flag))
        saved["rules"]["active"] = bool(saved["earningEnabled"] or saved["redemptionEnabled"])
        saved["stackWithPromotions"] = bool(raw.get("stackWithPromotions"))
    else:
        for flag in flags:
            if raw.get(flag):
                raise ValueError("Rewards stay off until tax treatment is confirmed and the owner authorizes activation")
    if raw.get("nabidermEnabled"):
        raise ValueError("NabiDerm commerce stays off")
    return saved


def _badge(row):
    criteria = row.get("criteria") if isinstance(row.get("criteria"), dict) else {}
    clean = {}
    for key in ("completedVisits", "qualifiedReferrals"):
        if key in criteria:
            clean[key] = max(0, int(criteria[key]))
    return {
        "id": str(row.get("id") or "")[:40],
        "name": str(row.get("name") or "")[:80],
        "active": bool(row.get("active")),
        "visible": bool(row.get("visible", True)),
        "perk": str(row.get("perk") or "")[:160],
        "criteria": clean,
    }


def new_code():
    return "NB" + secrets.token_hex(4).upper()


def attribute(referrer, client, existing_referrer, completed_paid):
    if not referrer or not client:
        return "missing"
    if referrer.get("id") == client.get("id"):
        return "self"
    referrer_email = str(referrer.get("email") or "").strip().lower()
    client_email = str(client.get("email") or "").strip().lower()
    if referrer_email and referrer_email == client_email:
        return "self"
    if client.get("referredBy") == referrer.get("id") or referrer.get("referredBy") == client.get("id"):
        return "cycle" if referrer.get("referredBy") == client.get("id") else "already"
    if existing_referrer:
        return "already"
    if completed_paid:
        return "too_late"
    return "ok"


def earn_points(eligible_cents, rules):
    per = int((rules or {}).get("pointsPerDollar") or 0)
    if per <= 0:
        return 0
    return (max(0, int(eligible_cents)) // 100) * per


def eligible_spend_cents(pricing):
    pricing = pricing or {}
    service = to_cents(pricing.get("base") or 0) - to_cents(pricing.get("discount") or 0) - to_cents(pricing.get("loyaltyService") or 0)
    travel = to_cents(pricing.get("travel") or 0) - to_cents(pricing.get("loyaltyTravel") or 0)
    return max(0, service) + max(0, travel)


def points_value_cents(points, points_per_dollar):
    rate = int(points_per_dollar or 0)
    if rate <= 0 or int(points) <= 0:
        return 0
    return (int(points) * 100) // rate


def preview_redemption(quoted, points, rules, gst=0.05):
    """Proposed pre-tax credit. Live redemption still requires owner authorization."""
    rules = rules or {}
    points = int(points or 0)
    if points < 0:
        return {"ok": False, "reason": "points"}
    if float((quoted or {}).get("discount") or 0) > 0 and not rules.get("stackWithPromotions"):
        return {"ok": False, "reason": "stacking"}
    rate = int(rules.get("pointsPerDollarValue") or 100)
    cap = int(rules.get("maxRedeemCents") or 0)
    value = points_value_cents(points, rate)
    if cap > 0:
        value = min(value, cap)
    service_room = 0
    if rules.get("serviceRedeemable", True):
        service_room = max(0, to_cents(quoted.get("base") or 0) - to_cents(quoted.get("discount") or 0))
    travel_room = to_cents(quoted.get("travel") or 0) if rules.get("travelRedeemable", True) else 0
    use_service = min(value, service_room)
    use_travel = min(max(0, value - use_service), travel_room)
    used_cents = use_service + use_travel
    used_points = (used_cents * rate) // 100
    used_cents = points_value_cents(used_points, rate)
    use_service = min(used_cents, service_room)
    use_travel = min(max(0, used_cents - use_service), travel_room)
    used_cents = use_service + use_travel
    used_points = (used_cents * rate) // 100
    if used_points <= 0:
        return {"ok": False, "reason": "nothing"}
    subtotal_cents = (
        to_cents(quoted.get("base") or 0) - to_cents(quoted.get("discount") or 0) - use_service
        + to_cents(quoted.get("addons") or 0) + to_cents(quoted.get("travel") or 0) - use_travel
    )
    tax = money(dollars(max(0, subtotal_cents)) * float(gst))
    total = money(dollars(max(0, subtotal_cents)) + tax)
    return {
        "ok": True,
        "points": used_points,
        "loyaltyService": dollars(use_service),
        "loyaltyTravel": dollars(use_travel),
        "tax": tax,
        "total": total,
        "taxTreatment": "proposed_pre_tax",
    }


def apply_balance(balance, delta):
    nxt = int(balance) + int(delta)
    if nxt < 0:
        return None
    return nxt


def ledger_balance(entries):
    return sum(int(row.get("points") or 0) for row in entries or [] if row.get("state") != "reversed")


def reversal_points(earned, refund_cents, paid_cents):
    earned = int(earned or 0)
    refund_cents = int(refund_cents or 0)
    paid_cents = int(paid_cents or 0)
    if earned <= 0 or refund_cents <= 0 or paid_cents <= 0:
        return 0
    if refund_cents >= paid_cents:
        return earned
    return min(earned, (earned * refund_cents) // paid_cents)


def claim_key(seen, key):
    if key in seen:
        return False
    seen.add(key)
    return True


def qualifies(appointment):
    paid = appointment.get("paymentStatus") == "fully_paid"
    done = appointment.get("status") in ("completed", "processing", "closed")
    return bool(paid and done)


def badge_earned(badge, stats):
    if not badge or not badge.get("active"):
        return False
    criteria = badge.get("criteria") or {}
    if "completedVisits" in criteria and int(stats.get("completedVisits") or 0) < int(criteria["completedVisits"]):
        return False
    if "qualifiedReferrals" in criteria and int(stats.get("qualifiedReferrals") or 0) < int(criteria["qualifiedReferrals"]):
        return False
    return True


def product_intent(order, rules):
    if not (rules or {}).get("nabidermEnabled"):
        return {"accepted": False, "reason": "disabled"}
    required = {"productId", "sku", "orderId", "paidCents"}
    if not required <= set(order or {}):
        return {"accepted": False, "reason": "contract"}
    if str(order.get("status") or "") not in ("paid", "refunded"):
        return {"accepted": False, "reason": "unpaid"}
    return {
        "accepted": True,
        "points": earn_points(order.get("paidCents"), (rules or {}).get("rules") or rules),
        "idempotencyKey": f"product:{order['orderId']}",
        "sku": order["sku"],
        "productId": order["productId"],
    }


def safe_entry(entry):
    meta = entry.get("meta") or {}
    clean = {key: value for key, value in meta.items() if key not in CLINICAL_KEYS}
    kind = entry.get("kind")
    if kind in ("referral", "welcome"):
        clean = {"label": "Referral bonus" if kind == "referral" else "Welcome points"}
    return {
        "id": entry.get("id"),
        "kind": kind,
        "points": int(entry.get("points") or 0),
        "at": entry.get("at"),
        "appointmentRef": clean.get("ref"),
        "label": clean.get("label") or kind,
    }


def redemption_allowed(settings):
    rewards = (settings or {}).get("rewards") or {}
    return bool(
        rewards.get("enabled") and rewards.get("redemptionEnabled")
        and rewards.get("taxTreatment") == "confirmed_pre_tax"
    )


def earning_allowed(settings):
    rewards = (settings or {}).get("rewards") or {}
    return bool(rewards.get("enabled") and rewards.get("earningEnabled") and rewards.get("taxTreatment") == "confirmed_pre_tax")


async def post_entry(db, coll, client_id, points, key, kind, meta=None):
    existing = await db.nt_points_ledger.find_one({"idempotencyKey": key}, {"_id": 0})
    if existing:
        return existing, False
    points = int(points)
    if points == 0:
        return None, False
    if points < 0:
        updated = await coll("clients").find_one_and_update(
            {"id": client_id, "loyaltyPoints": {"$gte": -points}},
            {"$inc": {"loyaltyPoints": points}},
        )
        if not updated:
            raise HTTPException(409, "Not enough points")
    else:
        await coll("clients").update_one({"id": client_id}, {"$inc": {"loyaltyPoints": points}})
    row = {
        "id": "pts-" + uuid.uuid4().hex[:10],
        "clientId": client_id,
        "points": points,
        "kind": kind,
        "idempotencyKey": key,
        "state": "posted",
        "at": iso(now()),
        "meta": {key: value for key, value in (meta or {}).items() if key not in CLINICAL_KEYS},
    }
    try:
        await db.nt_points_ledger.insert_one(dict(row))
    except DuplicateKeyError:
        await coll("clients").update_one({"id": client_id}, {"$inc": {"loyaltyPoints": -points}})
        found = await db.nt_points_ledger.find_one({"idempotencyKey": key}, {"_id": 0})
        return found, False
    row.pop("_id", None)
    return row, True


async def ensure_code(coll, client):
    if client.get("referralCode"):
        return client["referralCode"]
    for _ in range(5):
        code = new_code()
        saved = await coll("clients").find_one_and_update(
            {"id": client["id"], "$or": [{"referralCode": {"$exists": False}}, {"referralCode": None}, {"referralCode": ""}]},
            {"$set": {"referralCode": code}},
            return_document=ReturnDocument.AFTER,
        )
        if saved and saved.get("referralCode"):
            return saved["referralCode"]
        current = await coll("clients").find_one({"id": client["id"]}, {"_id": 0, "referralCode": 1})
        if current and current.get("referralCode"):
            return current["referralCode"]
    raise HTTPException(409, "A referral code could not be reserved")


async def settle_appointment_points(db, coll, appointment):
    settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
    if not earning_allowed(settings):
        return None
    if not qualifies(appointment):
        return None
    rules = (settings.get("rewards") or {}).get("rules") or {}
    points = earn_points(eligible_spend_cents(appointment.get("pricing")), rules)
    if points:
        await post_entry(db, coll, appointment.get("clientId"), points, f"earn:{appointment.get('id')}", "earn", {"ref": appointment.get("ref")})
    rewards = settings.get("rewards") or {}
    if not rewards.get("referralsEnabled"):
        return points
    client = await coll("clients").find_one({"id": appointment.get("clientId")}, {"_id": 0, "id": 1, "referredBy": 1})
    referrer_id = (client or {}).get("referredBy")
    if not referrer_id or referrer_id == appointment.get("clientId"):
        return points
    earlier = await coll("appointments").count_documents({
        "clientId": appointment.get("clientId"),
        "id": {"$ne": appointment.get("id")},
        "status": {"$in": ["completed", "processing", "closed"]},
        "paymentStatus": "fully_paid",
    })
    if earlier:
        return points
    await post_entry(db, coll, appointment.get("clientId"), int(rules.get("welcomePoints") or 0), f"welcome:{appointment.get('clientId')}", "welcome", {})
    await post_entry(db, coll, referrer_id, int(rules.get("referrerPoints") or 0), f"referral:{appointment.get('clientId')}", "referral", {})
    return points


async def reverse_appointment_points(db, coll, appointment, refund_cents, payment_id):
    earned = await db.nt_points_ledger.find_one({"idempotencyKey": f"earn:{appointment.get('id')}"}, {"_id": 0})
    if not earned:
        return 0
    paid = to_cents((appointment.get("pricing") or {}).get("total") or 0)
    points = reversal_points(earned.get("points"), refund_cents, paid)
    if points <= 0:
        return 0
    await post_entry(db, coll, appointment.get("clientId"), -points, f"reverse:{payment_id}:{refund_cents}", "reverse", {"ref": appointment.get("ref")})
    return points


async def reserve_redemption(db, coll, settings, quoted, points, client_id, appointment_id):
    points = int(points or 0)
    if points <= 0:
        return quoted, 0
    if not redemption_allowed(settings):
        raise HTTPException(409, "Points redemption is not active")
    rewards = settings.get("rewards") or {}
    rules = {**(rewards.get("rules") or {}), "stackWithPromotions": bool(rewards.get("stackWithPromotions"))}
    preview = preview_redemption(quoted, points, rules, settings.get("gst", 0.05))
    if not preview.get("ok"):
        raise HTTPException(409, "Those points cannot be applied to this visit")
    await post_entry(db, coll, client_id, -preview["points"], f"redeem:{appointment_id}", "redeem", {})
    service_left = money(float(quoted.get("base") or 0) - float(quoted.get("discount") or 0) - float(preview["loyaltyService"]))
    return {
        **quoted,
        "loyaltyPoints": preview["points"],
        "loyaltyService": preview["loyaltyService"],
        "loyaltyTravel": preview["loyaltyTravel"],
        "tax": preview["tax"],
        "total": preview["total"],
        "treatmentAfterDiscount": service_left,
        "taxTreatment": preview["taxTreatment"],
    }, preview["points"]


async def release_redemption(db, coll, client_id, appointment_id, points):
    points = int(points or 0)
    if points <= 0 or not client_id or not appointment_id:
        return
    await post_entry(db, coll, client_id, points, f"release:{appointment_id}", "reverse", {})


def build_rewards_router(db, coll, add_audit, require, user_from):
    router = APIRouter(prefix="/api")

    @router.get("/rewards/me")
    async def mine(request: Request):
        user = await require(request, "client")
        client = await coll("clients").find_one({"id": user["subject"]}, {"_id": 0})
        if not client:
            raise HTTPException(404, "Profile not found")
        code = await ensure_code(coll, client)
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0, "rewards": 1}) or {}
        rewards = settings.get("rewards") or launch_rewards()
        entries = await db.nt_points_ledger.find({"clientId": user["subject"]}, {"_id": 0}).sort("at", -1).to_list(100)
        qualified = await db.nt_points_ledger.count_documents({"clientId": user["subject"], "kind": "referral"})
        completed = await coll("appointments").count_documents({"clientId": user["subject"], "status": {"$in": ["completed", "processing", "closed"]}, "paymentStatus": "fully_paid"})
        pending = 0
        if earning_allowed(settings):
            waiting = await coll("appointments").find({"clientId": user["subject"], "status": {"$in": ["completed", "processing", "closed"]}, "paymentStatus": {"$ne": "fully_paid"}}, {"_id": 0, "pricing": 1}).to_list(50)
            rules = (rewards.get("rules") or {})
            pending = sum(earn_points(eligible_spend_cents(row.get("pricing")), rules) for row in waiting)
        stats = {"completedVisits": completed, "qualifiedReferrals": qualified}
        badges = []
        for badge in rewards.get("badges") or []:
            if badge.get("visible") is False:
                continue
            badges.append({"id": badge.get("id"), "name": badge.get("name"), "earned": badge_earned(badge, stats), "active": bool(badge.get("active")), "perk": badge.get("perk") or ""})
        return {
            "active": bool(rewards.get("enabled")),
            "earning": earning_allowed(settings),
            "redemption": redemption_allowed(settings),
            "balance": ledger_balance(entries),
            "pending": pending,
            "history": [safe_entry(row) for row in entries],
            "referralCode": code,
            "sharePath": f"/book?ref={code}",
            "referrals": {"qualified": qualified},
            "badges": badges,
            "referred": bool(client.get("referredBy")),
        }

    @router.post("/rewards/attribute")
    async def attribute_code(request: Request, payload: dict = Body(...)):
        user = await require(request, "client")
        code = str(payload.get("code") or "").strip().upper()
        client = await coll("clients").find_one({"id": user["subject"]}, {"_id": 0})
        referrer = await coll("clients").find_one({"referralCode": code}, {"_id": 0, "id": 1, "email": 1, "referredBy": 1}) if code else None
        completed = await coll("appointments").count_documents({"clientId": user["subject"], "status": {"$in": ["completed", "processing", "closed"]}, "paymentStatus": "fully_paid"})
        decision = attribute(referrer, client, (client or {}).get("referredBy"), completed > 0)
        if decision != "ok":
            raise HTTPException(409, "That referral cannot be applied")
        saved = await coll("clients").find_one_and_update(
            {"id": user["subject"], "$or": [{"referredBy": {"$exists": False}}, {"referredBy": None}, {"referredBy": ""}]},
            {"$set": {"referredBy": referrer["id"], "referredAt": iso(now())}},
            return_document=ReturnDocument.AFTER,
        )
        if not saved:
            raise HTTPException(409, "That referral cannot be applied")
        await add_audit(user["name"], "Referral code applied", None)
        return {"attributed": True}

    @router.get("/rewards/settings")
    async def read_settings(request: Request):
        await require(request, "owner")
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0, "rewards": 1}) or {}
        return settings.get("rewards") or launch_rewards()

    @router.put("/rewards/settings")
    async def write_settings(request: Request, payload: dict = Body(...)):
        user = await require(request, "owner")
        if not can_configure(user.get("role")):
            raise HTTPException(403, "Only the owner can change rewards")
        try:
            saved = rewards_from_client(payload)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        await coll("settings").update_one({"id": "app"}, {"$set": {"rewards": saved}})
        await add_audit(user["name"], "Rewards settings updated", None)
        return saved

    @router.post("/rewards/products/preview")
    async def product_preview(request: Request, payload: dict = Body(default={})):
        await require(request, "owner")
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0, "rewards": 1}) or {}
        return product_intent(payload, settings.get("rewards") or launch_rewards())

    return router
