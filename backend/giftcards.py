"""Gift cards: products, purchase, issuance, redemption ledger, and void. Money movement stays behind GIFTCARDS_ENABLED."""
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import os

from config import giftcards_enabled, payments_simulated, stripe_card_checkout_enabled

DESIGNS = ("lagoon", "tide", "meadow", "coral")
MAX_CENTS = 500_000
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def money(cents):
    cents = int(cents or 0)
    return {"cents": cents, "display": f"{'-' if cents < 0 else ''}${abs(cents) // 100}.{abs(cents) % 100:02d}"}


def new_code():
    part = lambda: "".join(secrets.choice(ALPHABET) for _ in range(4))
    return f"NABI-{part()}-{part()}"


def norm_code(code):
    return str(code or "").strip().upper()


def public_card(card, full_code=False):
    return {
        "id": card["id"], "code": card["code"] if full_code else f"NABI-••••-{card['code'][-4:]}", "last4": card["code"][-4:],
        "status": card["status"], "design": card.get("design", "lagoon"), "productName": card.get("productName"),
        "amount": money(card["amountCents"]), "balance": money(card["balanceCents"]),
        "purchaserName": card.get("purchaserName"), "recipientName": card.get("recipientName"), "recipientEmail": card.get("recipientEmail"),
        "message": card.get("message") or "", "origin": card.get("origin"), "createdAt": card.get("createdAt"), "activatedAt": card.get("activatedAt"),
        "delivery": card.get("delivery") or {"channel": "email", "status": "not_sent"},
    }


async def ensure_giftcards(db):
    await db.nt_giftcards.create_index("id", unique=True)
    await db.nt_giftcards.create_index("code", unique=True)
    await db.nt_gc_ledger.create_index("idempotencyKey", unique=True)
    await db.nt_gc_ledger.create_index([("cardId", 1), ("at", 1)])
    await db.nt_gc_products.create_index("id", unique=True)


def require_enabled():
    if not giftcards_enabled():
        raise HTTPException(503, "Gift-card transactions are turned off")


def _key(body):
    key = str(body.get("idempotencyKey") or "")
    if not 8 <= len(key) <= 80:
        raise HTTPException(400, "Idempotency key is required")
    return key


def _amount(value):
    if not isinstance(value, int) or value <= 0 or value > MAX_CENTS:
        raise HTTPException(400, "Amount must be between $0.01 and $5,000")
    return value


async def debit(db, code, amount, key, reference, actor):
    """Redeem once per idempotency key. The balance check and decrement are a single atomic update."""
    prior = await db.nt_gc_ledger.find_one({"idempotencyKey": key}, {"_id": 0})
    if prior:
        return prior
    card = await db.nt_giftcards.find_one({"code": norm_code(code)}, {"_id": 0})
    if not card or card["status"] not in ("active",):
        raise HTTPException(404, "Gift card not found or not active")
    row = {"id": "gct-" + uuid.uuid4().hex[:12], "cardId": card["id"], "type": "redemption", "amountCents": amount, "reference": reference,
           "idempotencyKey": key, "status": "pending", "at": now_iso(), "actorName": actor.get("name"), "actorId": actor.get("id")}
    try:
        await db.nt_gc_ledger.insert_one(dict(row))
    except DuplicateKeyError:
        return await db.nt_gc_ledger.find_one({"idempotencyKey": key}, {"_id": 0})
    updated = await db.nt_giftcards.find_one_and_update(
        {"id": card["id"], "status": "active", "balanceCents": {"$gte": amount}},
        {"$inc": {"balanceCents": -amount, "version": 1}, "$set": {"updatedAt": now_iso()}}, return_document=ReturnDocument.AFTER)
    if not updated:
        await db.nt_gc_ledger.delete_one({"id": row["id"]})
        raise HTTPException(409, "The gift card balance is lower than that amount")
    if updated["balanceCents"] == 0:
        await db.nt_giftcards.update_one({"id": card["id"], "balanceCents": 0}, {"$set": {"status": "redeemed"}})
    await db.nt_gc_ledger.update_one({"id": row["id"]}, {"$set": {"status": "completed", "balanceAfterCents": updated["balanceCents"]}})
    row.update(status="completed", balanceAfterCents=updated["balanceCents"])
    return row


async def activate_paid(db, checkout_row, event_id):
    """Stripe webhook settlement for a gift-card checkout. One activation per event and per card."""
    card = await db.nt_giftcards.find_one({"id": checkout_row["giftCardId"]}, {"_id": 0})
    if not card or card["amountCents"] != checkout_row["amountCents"]:
        return False
    try:
        await db.nt_gc_ledger.insert_one({"id": "gct-" + uuid.uuid4().hex[:12], "cardId": card["id"], "type": "issue", "amountCents": card["amountCents"], "status": "completed",
                                          "method": "stripe", "reference": checkout_row["sessionId"], "idempotencyKey": "stripe-" + event_id[:70], "at": now_iso(), "actorName": "Stripe"})
    except DuplicateKeyError:
        return True
    saved = await db.nt_giftcards.find_one_and_update({"id": card["id"], "status": "pending_payment"},
                                                      {"$set": {"status": "active", "balanceCents": card["amountCents"], "activatedAt": now_iso()}, "$inc": {"version": 1}})
    if not saved:
        await db.nt_gc_ledger.delete_one({"idempotencyKey": "stripe-" + event_id[:70]})
        return False
    return True


async def reverse(db, txn, reason):
    """Undo a redemption whose invoice payment could not be recorded."""
    await db.nt_giftcards.update_one({"id": txn["cardId"]}, {"$inc": {"balanceCents": txn["amountCents"], "version": 1}, "$set": {"status": "active", "updatedAt": now_iso()}})
    await db.nt_gc_ledger.update_one({"id": txn["id"]}, {"$set": {"status": "reversed", "reversedReason": reason}})


def build_giftcard_router(db, coll, add_audit, user_from, reception_perms):
    r = APIRouter(prefix="/api/giftcards")

    async def actor(request, *roles):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if roles and user["role"] not in roles:
            raise HTTPException(403, "Not permitted for your role")
        return user

    async def staff(request):
        user = await actor(request, "owner", "desk")
        if user["role"] == "desk" and not (await reception_perms()).get("managePayments"):
            raise HTTPException(403, "Reception needs the payments permission")
        return user

    async def body_of(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        return data if isinstance(data, dict) else {}

    async def load(cid):
        card = await db.nt_giftcards.find_one({"id": cid}, {"_id": 0})
        if not card:
            raise HTTPException(404, "Gift card not found")
        return card

    async def ledger(cid):
        rows = await db.nt_gc_ledger.find({"cardId": cid, "status": {"$ne": "pending"}}, {"_id": 0}).sort("at", 1).to_list(200)
        return [{"id": x["id"], "type": x["type"], "amount": money(x["amountCents"]), "status": x["status"], "reference": x.get("reference"), "at": x["at"], "by": x.get("actorName")} for x in rows]

    async def client_of(user):
        return await coll("clients").find_one({"id": user.get("subject")}, {"_id": 0}) or {}

    async def owns(user, card):
        if user["role"] != "client":
            return True
        me = await client_of(user)
        return card.get("purchaserId") == user.get("subject") or (me.get("email") and (card.get("recipientEmail") or "").lower() == me["email"].lower())

    @r.get("/config")
    async def config():
        products = await db.nt_gc_products.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(20)
        return {"enabled": giftcards_enabled(), "products": products, "designs": list(DESIGNS)}

    @r.get("/products")
    async def products(request: Request):
        await actor(request, "owner")
        return await db.nt_gc_products.find({}, {"_id": 0}).sort("order", 1).to_list(50)

    def clean_product(body):
        name = str(body.get("name") or "").strip()[:60]
        amounts = body.get("amountsCents") or []
        if not name or not amounts or not all(isinstance(a, int) and 0 < a <= MAX_CENTS for a in amounts):
            raise HTTPException(400, "A product needs a name and amounts between $0.01 and $5,000")
        design = body.get("design") if body.get("design") in DESIGNS else "lagoon"
        return {"name": name, "description": str(body.get("description") or "")[:240], "design": design, "amountsCents": sorted(set(amounts)),
                "active": bool(body.get("active", False)), "order": int(body.get("order") or 0)}

    @r.post("/products")
    async def create_product(request: Request):
        user = await actor(request, "owner")
        doc = {"id": "gcp-" + uuid.uuid4().hex[:10], **clean_product(await body_of(request)), "createdAt": now_iso()}
        await db.nt_gc_products.insert_one(dict(doc))
        await add_audit(user.get("name") or "owner", f"Gift-card product {doc['name']} created")
        doc.pop("_id", None)
        return doc

    @r.put("/products/{pid}")
    async def update_product(pid: str, request: Request):
        user = await actor(request, "owner")
        fields = clean_product(await body_of(request))
        saved = await db.nt_gc_products.find_one_and_update({"id": pid}, {"$set": fields}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if not saved:
            raise HTTPException(404, "Product not found")
        await add_audit(user.get("name") or "owner", f"Gift-card product {saved['name']} updated")
        return saved

    @r.get("/mine")
    async def mine(request: Request):
        user = await actor(request, "client")
        me = await client_of(user)
        query = {"$or": [{"purchaserId": user.get("subject")}] + ([{"recipientEmail": me["email"].lower()}] if me.get("email") else [])}
        rows = await db.nt_giftcards.find(query, {"_id": 0}).sort("createdAt", -1).to_list(50)
        return [{**public_card(c, full_code=c["status"] in ("active", "redeemed")), "transactions": await ledger(c["id"]), "isPurchaser": c.get("purchaserId") == user.get("subject")} for c in rows]

    @r.get("")
    async def list_cards(request: Request, status: str = "", q: str = ""):
        user = await staff(request)
        query = {"status": status} if status else {}
        if q:
            query["$or"] = [{"code": {"$regex": norm_code(q)[-4:] + "$"}}, {"recipientName": {"$regex": q, "$options": "i"}}, {"purchaserName": {"$regex": q, "$options": "i"}}]
        rows = await db.nt_giftcards.find(query, {"_id": 0}).sort("createdAt", -1).to_list(200)
        return [public_card(c, full_code=user["role"] == "owner") for c in rows]

    @r.get("/liability")
    async def liability(request: Request):
        await actor(request, "owner")
        cards = await db.nt_giftcards.find({}, {"_id": 0, "status": 1, "amountCents": 1, "balanceCents": 1}).to_list(5000)
        live = [c for c in cards if c["status"] in ("active", "redeemed")]
        return {"outstanding": money(sum(c["balanceCents"] for c in live if c["status"] == "active")), "issued": money(sum(c["amountCents"] for c in live)),
                "redeemed": money(sum(c["amountCents"] - c["balanceCents"] for c in live)), "activeCount": sum(1 for c in cards if c["status"] == "active"),
                "pendingCount": sum(1 for c in cards if c["status"] == "pending_payment"), "voidedCount": sum(1 for c in cards if c["status"] == "voided")}

    @r.get("/lookup")
    async def lookup(request: Request, code: str):
        await actor(request)
        card = await db.nt_giftcards.find_one({"code": norm_code(code)}, {"_id": 0})
        if not card:
            raise HTTPException(404, "Gift card not found")
        return {"last4": card["code"][-4:], "status": card["status"], "balance": money(card["balanceCents"])}

    @r.get("/{cid}")
    async def detail(cid: str, request: Request):
        user = await actor(request)
        card = await load(cid)
        if user["role"] == "desk":
            await staff(request)
        elif user["role"] not in ("owner",) and not await owns(user, card):
            raise HTTPException(404, "Gift card not found")
        return {**public_card(card, full_code=user["role"] == "owner" or (user["role"] == "client" and card["status"] in ("active", "redeemed"))), "transactions": await ledger(cid)}

    async def insert_card(doc):
        for _ in range(5):
            doc["code"] = new_code()
            try:
                await db.nt_giftcards.insert_one(dict(doc))
                doc.pop("_id", None)
                return doc
            except DuplicateKeyError as exc:
                if await db.nt_giftcards.find_one({"idempotencyKey": doc["idempotencyKey"]}):
                    raise HTTPException(409, "That request was already processed") from exc
        raise HTTPException(500, "Could not allocate a gift-card code")

    def recipient(body):
        name = str(body.get("recipientName") or "").strip()[:80]
        email = str(body.get("recipientEmail") or "").strip().lower()[:120]
        if not name:
            raise HTTPException(400, "Recipient name is required")
        if email and "@" not in email:
            raise HTTPException(400, "Recipient email looks invalid")
        return name, email

    @r.post("/purchase")
    async def purchase(request: Request):
        user = await actor(request, "client")
        require_enabled()
        body = await body_of(request)
        key = _key(body)
        prior = await db.nt_giftcards.find_one({"idempotencyKey": key}, {"_id": 0})
        if prior:
            return public_card(prior)
        product = await db.nt_gc_products.find_one({"id": body.get("productId"), "active": True}, {"_id": 0})
        if not product:
            raise HTTPException(404, "Gift-card product is not available")
        amount = _amount(body.get("amountCents"))
        if amount not in product["amountsCents"]:
            raise HTTPException(400, "Choose one of the listed amounts")
        name, email = recipient(body)
        me = await client_of(user)
        doc = {"id": "gc-" + uuid.uuid4().hex[:10], "idempotencyKey": key, "status": "pending_payment", "origin": "purchase", "productId": product["id"],
               "productName": product["name"], "design": product["design"], "amountCents": amount, "balanceCents": 0, "version": 1,
               "purchaserId": user.get("subject"), "purchaserName": f"{me.get('firstName', '')} {me.get('lastName', '')}".strip() or user.get("name"),
               "recipientName": name, "recipientEmail": email, "message": str(body.get("message") or "")[:240],
               "delivery": {"channel": "email", "status": "not_sent", "note": "Email delivery is turned off"}, "createdAt": now_iso()}
        doc = await insert_card(doc)
        await add_audit(doc["purchaserName"] or "client", f"Gift card ••{doc['code'][-4:]} requested ({money(amount)['display']}), awaiting payment")
        return public_card(doc)

    @r.post("/issue")
    async def issue(request: Request):
        user = await actor(request, "owner")
        require_enabled()
        body = await body_of(request)
        key = _key(body)
        amount = _amount(body.get("amountCents"))
        name, email = recipient(body)
        kind = "complimentary" if body.get("complimentary") else "paid"
        method = str(body.get("method") or "")
        if kind == "paid" and method not in ("cash", "etransfer"):
            raise HTTPException(400, "Paid issuance needs a verified cash or e-Transfer payment")
        doc = {"id": "gc-" + uuid.uuid4().hex[:10], "idempotencyKey": key, "status": "active", "origin": kind, "productName": str(body.get("productName") or "Nabitouch gift card")[:60],
               "design": body.get("design") if body.get("design") in DESIGNS else "lagoon", "amountCents": amount, "balanceCents": amount, "version": 1,
               "purchaserName": str(body.get("purchaserName") or "")[:80] or None, "recipientName": name, "recipientEmail": email, "message": str(body.get("message") or "")[:240],
               "delivery": {"channel": "email", "status": "not_sent", "note": "Email delivery is turned off"}, "createdAt": now_iso(), "activatedAt": now_iso()}
        doc = await insert_card(doc)
        await db.nt_gc_ledger.insert_one({"id": "gct-" + uuid.uuid4().hex[:12], "cardId": doc["id"], "type": "issue", "amountCents": amount, "status": "completed",
                                          "reference": (body.get("reference") or kind)[:80], "method": method or None, "idempotencyKey": key + ":issue", "at": now_iso(), "actorName": user.get("name")})
        await add_audit(user.get("name") or "owner", f"Gift card ••{doc['code'][-4:]} issued {money(amount)['display']} ({kind})")
        return public_card(doc, full_code=True)

    @r.post("/{cid}/checkout")
    async def checkout(cid: str, request: Request):
        user = await actor(request, "client")
        require_enabled()
        if not stripe_card_checkout_enabled():
            raise HTTPException(503, "Card checkout is turned off")
        card = await load(cid)
        if card.get("purchaserId") != user.get("subject"):
            raise HTTPException(404, "Gift card not found")
        if card["status"] != "pending_payment":
            raise HTTPException(409, "This gift card is not awaiting payment")
        key = os.environ.get("STRIPE_SECRET_KEY") or ""
        url = None
        if key.startswith("sk_live"):
            raise HTTPException(503, "Live card checkout is not enabled")
        if key.startswith("sk_test_"):
            import httpx
            app_url = os.environ["APP_URL"].rstrip("/")
            form = {"mode": "payment", "success_url": app_url + "/me/gifts?card=return", "cancel_url": app_url + "/me/gifts?card=cancel",
                    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "cad", "line_items[0][price_data][unit_amount]": str(card["amountCents"]),
                    "line_items[0][price_data][product_data][name]": f"Nabitouch gift card ••{card['code'][-4:]}", "metadata[giftCardId]": cid}
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post("https://api.stripe.com/v1/checkout/sessions", auth=(key, ""), data=form)
            if resp.status_code >= 400 or not resp.json().get("id"):
                raise HTTPException(502, "Card checkout could not be started")
            session_id, url = resp.json()["id"], resp.json().get("url")
        elif payments_simulated():
            session_id = "cs_test_" + uuid.uuid4().hex[:16]
        else:
            raise HTTPException(503, "Card checkout is not configured")
        await db.nt_checkouts.insert_one({"id": "chk-" + uuid.uuid4().hex[:12], "giftCardId": cid, "sessionId": session_id, "amountCents": card["amountCents"], "status": "pending", "at": now_iso()})
        return {"confirmed": False, "sessionId": session_id, "url": url, "amount": money(card["amountCents"])}

    @r.post("/{cid}/activate")
    async def activate(cid: str, request: Request):
        user = await staff(request)
        require_enabled()
        body = await body_of(request)
        key = _key(body)
        method = body.get("method")
        reference = str(body.get("reference") or "").strip()[:80]
        if method not in ("cash", "etransfer") or not reference:
            raise HTTPException(400, "Record the verified cash or e-Transfer payment and its reference")
        card = await load(cid)
        try:
            await db.nt_gc_ledger.insert_one({"id": "gct-" + uuid.uuid4().hex[:12], "cardId": cid, "type": "issue", "amountCents": card["amountCents"], "status": "completed",
                                              "method": method, "reference": reference, "idempotencyKey": key, "at": now_iso(), "actorName": user.get("name")})
        except DuplicateKeyError:
            return public_card(await load(cid), full_code=user["role"] == "owner")
        saved = await db.nt_giftcards.find_one_and_update({"id": cid, "status": "pending_payment"},
                                                          {"$set": {"status": "active", "balanceCents": card["amountCents"], "activatedAt": now_iso()}, "$inc": {"version": 1}},
                                                          return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if not saved:
            await db.nt_gc_ledger.delete_one({"idempotencyKey": key})
            raise HTTPException(409, "Only a card awaiting payment can be activated")
        await add_audit(user.get("name") or "staff", f"Gift card ••{saved['code'][-4:]} activated after {method} {reference}")
        return public_card(saved, full_code=user["role"] == "owner")

    @r.post("/{cid}/void")
    async def void(cid: str, request: Request):
        user = await actor(request, "owner")
        require_enabled()
        body = await body_of(request)
        key = _key(body)
        reason = str(body.get("reason") or "").strip()[:160]
        if not reason:
            raise HTTPException(400, "A reason is required")
        card = await load(cid)
        if card["status"] not in ("active", "pending_payment"):
            raise HTTPException(409, "This card cannot be voided")
        refund = bool(body.get("refund"))
        try:
            await db.nt_gc_ledger.insert_one({"id": "gct-" + uuid.uuid4().hex[:12], "cardId": cid, "type": "refund" if refund else "void", "amountCents": card["balanceCents"],
                                              "status": "completed", "reference": reason, "idempotencyKey": key, "at": now_iso(), "actorName": user.get("name")})
        except DuplicateKeyError:
            return public_card(await load(cid), full_code=True)
        saved = await db.nt_giftcards.find_one_and_update({"id": cid, "version": card["version"]}, {"$set": {"status": "voided", "balanceCents": 0, "voidReason": reason}, "$inc": {"version": 1}},
                                                          return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if not saved:
            await db.nt_gc_ledger.delete_one({"idempotencyKey": key})
            raise HTTPException(409, "The card changed. Refresh and try again.")
        await add_audit(user.get("name") or "owner", f"Gift card ••{saved['code'][-4:]} {'refunded' if refund else 'voided'}: {reason}")
        return public_card(saved, full_code=True)

    return r
