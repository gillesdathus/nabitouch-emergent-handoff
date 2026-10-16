"""Wellness plans: prepaid packages and memberships, per-credit ledger, booking reservation and Stripe test checkout."""
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from config import payments_simulated, stripe_card_checkout_enabled

KINDS = ("package", "membership")
STATUSES = ("draft", "published", "paused", "archived")
MAX_CENTS = 500_000


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def money(cents):
    cents = int(cents or 0)
    return {"cents": cents, "display": f"{'-' if cents < 0 else ''}${abs(cents) // 100:,}.{abs(cents) % 100:02d}"}


async def ensure_plans(db):
    await db.nt_plan_products.create_index("id", unique=True)
    await db.nt_plan_purchases.create_index("id", unique=True)
    await db.nt_plan_purchases.create_index("idempotencyKey", unique=True)
    await db.nt_credits.create_index("id", unique=True)
    await db.nt_credits.create_index([("clientId", 1), ("state", 1), ("serviceSlug", 1), ("duration", 1)])
    await db.nt_credits.create_index("appointmentId", sparse=True)
    await db.nt_credit_ledger.create_index("idempotencyKey", unique=True)
    await db.nt_credit_ledger.create_index([("clientId", 1), ("at", -1)])
    await db.nt_memberships.create_index("id", unique=True)
    await db.nt_memberships.create_index("stripeSubscriptionId", sparse=True)


async def _gst(db):
    row = await db.nt_settings.find_one({"id": "app"}, {"_id": 0, "gst": 1}) or {}
    return float(row.get("gst") if row.get("gst") is not None else 0.05)


async def _log(db, credit, kind, key, actor="system", appointment_id=None, note=None):
    try:
        await db.nt_credit_ledger.insert_one({"id": "cl-" + uuid.uuid4().hex[:12], "creditId": credit["id"], "purchaseId": credit["purchaseId"], "clientId": credit["clientId"],
                                              "type": kind, "unitCents": credit["unitCents"], "appointmentId": appointment_id, "note": note, "actor": actor,
                                              "idempotencyKey": key, "at": now_iso()})
        return True
    except DuplicateKeyError:
        return False


async def expire_stale(db, client_id):
    stamp = now_iso()
    rows = await db.nt_credits.find({"clientId": client_id, "state": "available", "expiresAt": {"$lt": stamp}}, {"_id": 0}).to_list(500)
    for credit in rows:
        if await db.nt_credits.find_one_and_update({"id": credit["id"], "state": "available"}, {"$set": {"state": "expired", "expiredAt": stamp}}):
            await _log(db, credit, "expired", f"expire-{credit['id']}")


async def available_credit(db, client_id, slug, duration):
    await expire_stale(db, client_id)
    return await db.nt_credits.find_one({"clientId": client_id, "state": "available", "serviceSlug": slug, "duration": int(duration)}, {"_id": 0}, sort=[("expiresAt", 1)])


def credit_quote(quoted, unit_cents, gst, service):
    """The credit covers the treatment. Promotions never stack with it; enhancements and travel stay payable."""
    base = float(quoted["base"])
    credit = min(round(unit_cents / 100, 2), base)
    subtotal = round(float(quoted["addons"]) + float(quoted["travel"]), 2)
    tax = 0.0 if (service or {}).get("taxable") is False else round(subtotal * gst, 2)
    return {**quoted, "discount": base, "promoId": None, "promoName": "Wellness package credit", "promoCode": None, "welcomeOffer": False, "appliedPromoIds": [],
            "tax": tax, "total": round(subtotal + tax, 2), "treatmentAfterDiscount": 0.0, "packageCredit": True, "creditUnit": credit}


async def reserve_credit(db, client_id, slug, duration, appointment_id, actor):
    await expire_stale(db, client_id)
    credit = await db.nt_credits.find_one_and_update(
        {"clientId": client_id, "state": "available", "serviceSlug": slug, "duration": int(duration)},
        {"$set": {"state": "reserved", "appointmentId": appointment_id, "reservedAt": now_iso()}},
        sort=[("expiresAt", 1)], return_document=ReturnDocument.AFTER, projection={"_id": 0})
    if not credit:
        raise HTTPException(409, "No package credit is available for this treatment")
    await _log(db, credit, "reserved", f"reserve-{credit['id']}-{appointment_id}", actor, appointment_id)
    return credit


async def consume_credit(db, appointment_id, actor="system"):
    credit = await db.nt_credits.find_one_and_update({"appointmentId": appointment_id, "state": "reserved"},
                                                     {"$set": {"state": "consumed", "consumedAt": now_iso()}}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
    if credit:
        await _log(db, credit, "consumed", f"consume-{credit['id']}-{appointment_id}", actor, appointment_id)
    return credit


async def release_credit(db, appointment_id, actor="system", note=None):
    credit = await db.nt_credits.find_one_and_update({"appointmentId": appointment_id, "state": "reserved"},
                                                     {"$set": {"state": "available", "appointmentId": None, "reservedAt": None}}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
    if credit:
        await _log(db, credit, "released", f"release-{credit['id']}-{appointment_id}", actor, appointment_id, note)
    return credit


async def issue_credits(db, purchase):
    days = int(purchase.get("validityDays") or 365)
    expires = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    for n in range(int(purchase["credits"])):
        credit = {"id": f"cr-{purchase['id'][-10:]}-{n + 1}", "purchaseId": purchase["id"], "productId": purchase["productId"], "clientId": purchase["clientId"],
                  "kind": purchase["kind"], "serviceSlug": purchase["serviceSlug"], "duration": purchase["duration"], "unitCents": purchase["unitCents"],
                  "state": "available", "appointmentId": None, "issuedAt": now_iso(), "expiresAt": expires}
        try:
            await db.nt_credits.insert_one(dict(credit))
        except DuplicateKeyError:
            continue
        await _log(db, credit, "issued", f"issue-{credit['id']}", "Stripe")


def _purchase_doc(product, client_id, key, gst, kind=None, membership_id=None):
    price = int(product["priceCents"])
    tax = round(price * gst)
    credits = int(product["credits"])
    return {"id": "pp-" + uuid.uuid4().hex[:10], "idempotencyKey": key, "productId": product["id"], "productName": product["name"], "kind": kind or product["kind"],
            "clientId": client_id, "serviceSlug": product["serviceSlug"], "serviceName": product.get("serviceName"), "duration": int(product["duration"]),
            "credits": credits, "priceCents": price, "taxCents": tax, "totalCents": price + tax, "unitCents": price // credits if credits else 0,
            "validityDays": int(product.get("validityDays") or (60 if product["kind"] == "membership" else 365)), "membershipId": membership_id,
            "status": "pending_payment", "refundedCents": 0, "createdAt": now_iso()}


async def settle_checkout(db, checkout_row, obj, event_id, add_audit):
    """checkout.session.completed for a package purchase or a membership's first cycle."""
    purchase = await db.nt_plan_purchases.find_one({"id": checkout_row["planPurchaseId"]}, {"_id": 0})
    if not purchase:
        return False
    stamp = now_iso()
    updated = await db.nt_plan_purchases.find_one_and_update(
        {"id": purchase["id"], "status": "pending_payment"},
        {"$set": {"status": "paid", "paidAt": stamp, "paymentIntent": obj.get("payment_intent"), "stripeInvoiceId": obj.get("invoice"), "eventId": event_id}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0})
    if updated:
        await issue_credits(db, updated)
        if updated.get("membershipId"):
            await db.nt_memberships.update_one({"id": updated["membershipId"]}, {"$set": {
                "status": "active", "stripeSubscriptionId": obj.get("subscription"), "stripeCustomerId": obj.get("customer"), "activatedAt": stamp,
                "lastInvoiceId": obj.get("invoice"), "currentPeriodEnd": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()}})
        await add_audit("Stripe", f"Wellness plan {updated['productName']} paid ({money(updated['totalCents'])['display']})")
    return True


async def subscription_event(db, kind, obj, add_audit):
    """invoice.paid issues one cycle of credits per Stripe invoice; customer.subscription.* drives status."""
    if kind == "invoice.paid":
        sub = obj.get("subscription") or (((obj.get("parent") or {}).get("subscription_details") or {}).get("subscription"))
        meta = ((obj.get("subscription_details") or (obj.get("parent") or {}).get("subscription_details") or {}).get("metadata") or {})
        member = await db.nt_memberships.find_one({"$or": [{"stripeSubscriptionId": sub}, {"id": meta.get("membershipId") or "-"}]}, {"_id": 0}) if sub or meta else None
        if not member or not obj.get("id"):
            return {"received": True, "settled": False}
        if obj.get("billing_reason") == "subscription_create" or obj.get("id") == member.get("lastInvoiceId"):
            return {"received": True, "settled": True}
        product = await db.nt_plan_products.find_one({"id": member["productId"]}, {"_id": 0})
        if not product:
            return {"received": True, "settled": False}
        doc = _purchase_doc(product, member["clientId"], "inv-" + obj["id"][:70], await _gst(db), "membership", member["id"])
        doc.update(status="paid", paidAt=now_iso(), stripeInvoiceId=obj["id"], totalCents=int(obj.get("amount_paid") or doc["totalCents"]))
        try:
            await db.nt_plan_purchases.insert_one(dict(doc))
        except DuplicateKeyError:
            return {"received": True, "settled": True}
        await issue_credits(db, doc)
        await db.nt_memberships.update_one({"id": member["id"]}, {"$set": {"status": "active", "lastInvoiceId": obj["id"], "currentPeriodEnd": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()}})
        await add_audit("Stripe", f"Membership {product['name']} renewed")
        return {"received": True, "settled": True}
    member = await db.nt_memberships.find_one({"stripeSubscriptionId": obj.get("id")}, {"_id": 0}) if obj.get("id") else None
    if not member:
        return {"received": True, "settled": False}
    status = {"active": "active", "trialing": "active", "past_due": "past_due", "unpaid": "past_due", "canceled": "canceled", "incomplete_expired": "canceled"}.get(obj.get("status"), member["status"])
    if kind == "customer.subscription.deleted":
        status = "canceled"
    fields = {"status": status, "cancelAtPeriodEnd": bool(obj.get("cancel_at_period_end"))}
    if obj.get("current_period_end"):
        fields["currentPeriodEnd"] = datetime.fromtimestamp(int(obj["current_period_end"]), timezone.utc).isoformat()
    await db.nt_memberships.update_one({"id": member["id"]}, {"$set": fields})
    return {"received": True, "settled": True}


def public_product(p):
    return {**p, "price": money(p["priceCents"]), "perCredit": money(p["priceCents"] // max(1, int(p["credits"])))}


async def plans_report(db, start, end):
    """Deferred revenue: a purchase is an obligation until its credits are consumed."""
    def cad(c):
        return money(c)["display"]
    purchases = [p for p in await db.nt_plan_purchases.find({"status": {"$ne": "pending_payment"}}, {"_id": 0}).to_list(20000) if start <= (p.get("paidAt") or "")[:10] <= end]
    credits = await db.nt_credits.find({}, {"_id": 0, "state": 1, "unitCents": 1, "consumedAt": 1}).to_list(100000)
    recognized = sum(c["unitCents"] for c in credits if c["state"] == "consumed" and start <= (c.get("consumedAt") or "")[:10] <= end)
    outstanding = sum(c["unitCents"] for c in credits if c["state"] in ("available", "reserved"))
    members = await db.nt_memberships.find({"status": "active"}, {"_id": 0, "productId": 1}).to_list(5000)
    prices = {p["id"]: p["priceCents"] for p in await db.nt_plan_products.find({"kind": "membership"}, {"_id": 0, "id": 1, "priceCents": 1}).to_list(200)}
    mrr = sum(prices.get(m["productId"], 0) for m in members)
    sold = sum(p["priceCents"] for p in purchases)
    refunded = sum(round(int(p.get("refundedCents") or 0) * p["priceCents"] / p["totalCents"]) for p in purchases if p.get("totalCents"))
    rows = sorted([[(p.get("paidAt") or "")[:10], p["productName"], p["kind"], str(p["credits"]), cad(p["priceCents"]), cad(p["taxCents"]), cad(int(p.get("refundedCents") or 0)), p["status"]] for p in purchases], key=lambda r: r[0])
    kpis = [("Plans sold (net of GST)", cad(sold)), ("Recognized on use", cad(recognized)), ("Outstanding prepaid obligation", cad(outstanding)),
            ("Refunded (net of GST)", cad(refunded)), ("Active memberships", str(len(members))), ("Membership MRR", cad(mrr))]
    by_kind = {}
    for p in purchases:
        by_kind[p["kind"]] = by_kind.get(p["kind"], 0) + p["priceCents"]
    groups = [("Sales by type", ["Type", "Sold"], [[k, cad(v)] for k, v in sorted(by_kind.items())], [3, 1])]
    return kpis, ["Paid", "Plan", "Type", "Credits", "Price", "GST", "Refunded (incl. GST)", "Status"], rows, groups


def build_plans_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api/plans")

    async def actor(request, *roles):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if roles and user["role"] not in roles:
            raise HTTPException(403, "Not permitted for your role")
        return user

    async def body_of(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        return data if isinstance(data, dict) else {}

    async def clean(body):
        kind = body.get("kind")
        if kind not in KINDS:
            raise HTTPException(400, "Choose a package or a membership")
        name = str(body.get("name") or "").strip()[:60]
        service = await coll("services").find_one({"slug": body.get("serviceSlug")}, {"_id": 0})
        duration = body.get("duration")
        credits, price = body.get("credits"), body.get("priceCents")
        if not name or not service:
            raise HTTPException(400, "A plan needs a name and a service")
        if str(duration) not in ((service.get("prices") or {})):
            raise HTTPException(400, "That duration is not offered for this service")
        if not isinstance(credits, int) or not 1 <= credits <= 24:
            raise HTTPException(400, "Credits must be between 1 and 24")
        if not isinstance(price, int) or not 100 <= price <= MAX_CENTS:
            raise HTTPException(400, "Price must be between $1 and $5,000")
        validity = body.get("validityDays") or (60 if kind == "membership" else 365)
        if not isinstance(validity, int) or not 7 <= validity <= 730:
            raise HTTPException(400, "Validity must be between 7 and 730 days")
        return {"kind": kind, "name": name, "description": str(body.get("description") or "")[:240], "serviceSlug": service["slug"], "serviceName": service.get("name"),
                "duration": int(duration), "credits": credits, "priceCents": price, "validityDays": validity, "regularCents": round(float(service["prices"][str(duration)]) * 100) * credits,
                "order": int(body.get("order") or 0)}

    @r.get("")
    async def published():
        rows = await db.nt_plan_products.find({"status": "published"}, {"_id": 0}).sort("order", 1).to_list(50)
        return {"products": [public_product(p) for p in rows], "checkoutEnabled": stripe_card_checkout_enabled() and os.environ.get("PAYMENT_MODE") != "test"}

    @r.get("/products")
    async def products(request: Request):
        await actor(request, "owner")
        return [public_product(p) for p in await db.nt_plan_products.find({}, {"_id": 0}).sort("order", 1).to_list(200)]

    @r.post("/products")
    async def create_product(request: Request):
        user = await actor(request, "owner")
        doc = {"id": "plp-" + uuid.uuid4().hex[:10], **(await clean(await body_of(request))), "status": "draft", "createdAt": now_iso()}
        await db.nt_plan_products.insert_one(dict(doc))
        await add_audit(user.get("name") or "owner", f"Wellness plan {doc['name']} created")
        doc.pop("_id", None)
        return public_product(doc)

    @r.put("/products/{pid}")
    async def update_product(pid: str, request: Request):
        user = await actor(request, "owner")
        fields = await clean(await body_of(request))
        sold = await db.nt_plan_purchases.count_documents({"productId": pid, "status": {"$ne": "pending_payment"}})
        current = await db.nt_plan_products.find_one({"id": pid}, {"_id": 0})
        if not current:
            raise HTTPException(404, "Plan not found")
        if sold and any(fields[k] != current.get(k) for k in ("kind", "serviceSlug", "duration", "credits")):
            raise HTTPException(409, "This plan has been sold. Archive it and create a new one to change what it includes.")
        saved = await db.nt_plan_products.find_one_and_update({"id": pid}, {"$set": fields}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        await add_audit(user.get("name") or "owner", f"Wellness plan {saved['name']} updated")
        return public_product(saved)

    @r.post("/products/{pid}/status")
    async def set_status(pid: str, request: Request):
        user = await actor(request, "owner")
        status = (await body_of(request)).get("status")
        if status not in STATUSES:
            raise HTTPException(400, "Unknown status")
        saved = await db.nt_plan_products.find_one_and_update({"id": pid}, {"$set": {"status": status}}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if not saved:
            raise HTTPException(404, "Plan not found")
        await add_audit(user.get("name") or "owner", f"Wellness plan {saved['name']} {status}")
        return public_product(saved)

    def present_purchase(p):
        return {k: p.get(k) for k in ("id", "productId", "productName", "kind", "serviceSlug", "serviceName", "duration", "credits", "status", "createdAt", "paidAt", "membershipId", "clientId")} | {
            "price": money(p["priceCents"]), "tax": money(p["taxCents"]), "total": money(p["totalCents"]), "refunded": money(p.get("refundedCents") or 0), "perCredit": money(p["unitCents"])}

    @r.get("/mine")
    async def mine(request: Request):
        user = await actor(request, "client")
        cid = user.get("subject")
        await expire_stale(db, cid)
        credits = await db.nt_credits.find({"clientId": cid}, {"_id": 0}).to_list(1000)
        groups = {}
        for c in credits:
            g = groups.setdefault(f"{c['serviceSlug']}:{c['duration']}", {"serviceSlug": c["serviceSlug"], "duration": c["duration"], "available": 0, "reserved": 0, "consumed": 0, "expired": 0, "refunded": 0, "nextExpiry": None})
            g[c["state"]] = g.get(c["state"], 0) + 1
            if c["state"] == "available" and (not g["nextExpiry"] or c["expiresAt"] < g["nextExpiry"]):
                g["nextExpiry"] = c["expiresAt"]
        names = {s["slug"]: s.get("name") for s in await coll("services").find({"slug": {"$in": list({c["serviceSlug"] for c in credits})}}, {"_id": 0, "slug": 1, "name": 1}).to_list(50)}
        for g in groups.values():
            g["serviceName"] = names.get(g["serviceSlug"]) or g["serviceSlug"]
        purchases = await db.nt_plan_purchases.find({"clientId": cid}, {"_id": 0}).sort("createdAt", -1).to_list(100)
        memberships = await db.nt_memberships.find({"clientId": cid}, {"_id": 0}).sort("createdAt", -1).to_list(20)
        history = await db.nt_credit_ledger.find({"clientId": cid}, {"_id": 0, "idempotencyKey": 0}).sort("at", -1).to_list(60)
        return {"wallet": sorted(groups.values(), key=lambda g: -g["available"]), "purchases": [present_purchase(p) for p in purchases], "memberships": memberships,
                "history": history, "totals": {s: sum(1 for c in credits if c["state"] == s) for s in ("available", "reserved", "consumed")}}

    async def start_checkout(request, purchase, product, subscription=False):
        if os.environ.get("PAYMENT_MODE") == "test":
            raise HTTPException(503, "New wellness-plan payments await credit/refund reconciliation; existing credits remain usable")
        if not stripe_card_checkout_enabled():
            raise HTTPException(503, "Card checkout is turned off")
        key = os.environ.get("STRIPE_SECRET_KEY") or ""
        url = None
        if key.startswith("sk_live"):
            raise HTTPException(503, "Live card checkout is not enabled")
        if key.startswith("sk_test_"):
            import httpx
            from config import public_base_url
            app_url = public_base_url(request)
            form = {"mode": "subscription" if subscription else "payment", "success_url": app_url + "/me/plans?plan=return&session_id={CHECKOUT_SESSION_ID}", "cancel_url": app_url + "/me/plans?plan=cancel",
                    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "cad", "line_items[0][price_data][unit_amount]": str(purchase["totalCents"]),
                    "line_items[0][price_data][product_data][name]": f"Nabitouch {product['name']} (GST incl.)", "metadata[planPurchaseId]": purchase["id"], "client_reference_id": purchase["clientId"]}
            if subscription:
                form["line_items[0][price_data][recurring][interval]"] = "month"
                form["subscription_data[metadata][membershipId]"] = purchase["membershipId"]
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post("https://api.stripe.com/v1/checkout/sessions", auth=(key, ""), data=form)
            if resp.status_code >= 400 or not resp.json().get("id"):
                raise HTTPException(502, "Card checkout could not be started")
            session_id, url = resp.json()["id"], resp.json().get("url")
        elif payments_simulated():
            session_id = "cs_test_" + uuid.uuid4().hex[:16]
        else:
            raise HTTPException(503, "Card checkout is not configured")
        await db.nt_checkouts.insert_one({"id": "chk-" + uuid.uuid4().hex[:12], "planPurchaseId": purchase["id"], "clientId": purchase["clientId"], "sessionId": session_id,
                                          "amountCents": purchase["totalCents"], "status": "pending", "at": now_iso()})
        await db.nt_plan_purchases.update_one({"id": purchase["id"]}, {"$set": {"sessionId": session_id}})
        return {"sessionId": session_id, "url": url, "total": money(purchase["totalCents"]), "purchaseId": purchase["id"]}

    async def product_for_sale(pid, kind):
        product = await db.nt_plan_products.find_one({"id": pid, "status": "published", "kind": kind}, {"_id": 0})
        if not product:
            raise HTTPException(404, "That plan is not available")
        return product

    def idem(body):
        key = str(body.get("idempotencyKey") or "")
        if not 8 <= len(key) <= 80:
            raise HTTPException(400, "Idempotency key is required")
        return key

    @r.get("/visit/{aid}/member")
    async def visit_member(aid: str, request: Request):
        """Membership badge for the visit screen: plan name and credits left this cycle. No billing details."""
        user = await actor(request, "practitioner", "owner", "desk")
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0, "clientId": 1, "practitionerId": 1})
        if not appt or (user["role"] == "practitioner" and appt.get("practitionerId") != user.get("subject")):
            raise HTTPException(404, "Appointment not found")
        await expire_stale(db, appt["clientId"])
        members = await db.nt_memberships.find({"clientId": appt["clientId"], "status": {"$in": ["active", "past_due"]}}, {"_id": 0}).to_list(5)
        out = []
        for m in members:
            ids = [p["id"] for p in await db.nt_plan_purchases.find({"membershipId": m["id"], "status": {"$ne": "pending_payment"}}, {"_id": 0, "id": 1}).to_list(100)]
            left = await db.nt_credits.count_documents({"purchaseId": {"$in": ids}, "state": "available"}) if ids else 0
            held = await db.nt_credits.count_documents({"purchaseId": {"$in": ids}, "state": "reserved"}) if ids else 0
            out.append({"id": m["id"], "name": m["productName"], "status": m["status"], "creditsLeft": left, "creditsHeld": held, "perCycle": m.get("creditsPerCycle"),
                        "serviceName": m.get("serviceName"), "duration": m.get("duration"), "renewsAt": m.get("currentPeriodEnd"), "endingSoon": bool(m.get("cancelAtPeriodEnd"))})
        return {"memberships": out}

    @r.get("/nudge")
    async def nudge(request: Request):
        """After a recent completed visit, show what a matching published package would have saved. Read-only."""
        user = await actor(request, "client")
        cid = user.get("subject")
        from zoneinfo import ZoneInfo
        since = (datetime.now(ZoneInfo("America/Edmonton")) - timedelta(days=60)).date().isoformat()
        visits = await coll("appointments").find({"clientId": cid, "status": {"$in": ["completed", "processing", "closed"]}, "date": {"$gte": since}},
                                                 {"_id": 0, "id": 1, "ref": 1, "serviceSlug": 1, "duration": 1, "date": 1, "pricing": 1}).sort("date", -1).to_list(20)
        for v in visits:
            if (v.get("pricing") or {}).get("packageCredit"):
                continue
            if await available_credit(db, cid, v["serviceSlug"], v["duration"]):
                return {"nudge": None}
            plan = await db.nt_plan_products.find_one({"status": "published", "kind": "package", "serviceSlug": v["serviceSlug"], "duration": int(v["duration"])}, {"_id": 0}, sort=[("order", 1)])
            if not plan:
                continue
            saving = int(plan.get("regularCents") or 0) - int(plan["priceCents"])
            if saving <= 0:
                continue
            return {"nudge": {"productId": plan["id"], "name": plan["name"], "credits": plan["credits"], "serviceName": plan.get("serviceName"), "duration": plan["duration"],
                              "saving": money(saving), "perVisitSaving": money(saving // plan["credits"]), "visitRef": v["ref"], "visitId": v["id"]}}
        return {"nudge": None}

    @r.post("/{pid}/checkout")
    async def checkout(pid: str, request: Request):
        user = await actor(request, "client")
        key = idem(await body_of(request))
        product = await product_for_sale(pid, "package")
        prior = await db.nt_plan_purchases.find_one({"idempotencyKey": f"{user['subject']}:{key}"}, {"_id": 0})
        if prior and prior["status"] != "pending_payment":
            raise HTTPException(409, "That purchase was already completed")
        purchase = prior or _purchase_doc(product, user["subject"], f"{user['subject']}:{key}", await _gst(db))
        if not prior:
            await db.nt_plan_purchases.insert_one(dict(purchase))
            purchase.pop("_id", None)
        out = await start_checkout(request, purchase, product)
        await add_audit(user.get("name") or "client", f"Package {product['name']} checkout started")
        return out

    @r.post("/memberships/{pid}/subscribe")
    async def subscribe(pid: str, request: Request):
        user = await actor(request, "client")
        key = idem(await body_of(request))
        product = await product_for_sale(pid, "membership")
        if await db.nt_memberships.find_one({"clientId": user["subject"], "productId": pid, "status": {"$in": ["active", "past_due"]}}):
            raise HTTPException(409, "You already have this membership")
        member = {"id": "mem-" + uuid.uuid4().hex[:10], "productId": pid, "productName": product["name"], "clientId": user["subject"], "status": "pending",
                  "priceCents": product["priceCents"], "creditsPerCycle": product["credits"], "serviceSlug": product["serviceSlug"], "serviceName": product.get("serviceName"),
                  "duration": product["duration"], "cancelAtPeriodEnd": False, "createdAt": now_iso()}
        purchase = _purchase_doc(product, user["subject"], f"{user['subject']}:{key}", await _gst(db), "membership", member["id"])
        try:
            await db.nt_plan_purchases.insert_one(dict(purchase))
        except DuplicateKeyError:
            raise HTTPException(409, "That request was already processed")
        purchase.pop("_id", None)
        await db.nt_memberships.insert_one(dict(member))
        out = await start_checkout(request, purchase, product, subscription=True)
        await add_audit(user.get("name") or "client", f"Membership {product['name']} checkout started")
        return {**out, "membershipId": member["id"]}

    @r.get("/return")
    async def checkout_return(request: Request, session_id: str = ""):
        """Read-only browser return; only signed webhooks settle payments."""
        user = await actor(request)
        row = await db.nt_checkouts.find_one({"sessionId": session_id, "planPurchaseId": {"$exists": True}}, {"_id": 0}) if session_id else None
        if not row or (user["role"] == "client" and row.get("clientId") != user.get("subject")):
            return {"confirmed": False}
        if row.get("status") == "paid":
            return {"confirmed": True}
        return {"confirmed": False, "status": row.get("status", "pending")}

    @r.post("/memberships/{mid}/cancel")
    async def cancel_membership(mid: str, request: Request):
        user = await actor(request, "client", "owner")
        member = await db.nt_memberships.find_one({"id": mid}, {"_id": 0})
        if not member or (user["role"] == "client" and member["clientId"] != user.get("subject")):
            raise HTTPException(404, "Membership not found")
        if member["status"] not in ("active", "past_due", "pending"):
            raise HTTPException(409, "This membership is not active")
        key = os.environ.get("STRIPE_SECRET_KEY") or ""
        if member.get("stripeSubscriptionId") and key.startswith("sk_test_"):
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(f"https://api.stripe.com/v1/subscriptions/{member['stripeSubscriptionId']}", auth=(key, ""), data={"cancel_at_period_end": "true"})
            if resp.status_code >= 400:
                raise HTTPException(502, "Stripe could not schedule the cancellation")
        fields = {"cancelAtPeriodEnd": True, "cancelRequestedAt": now_iso()} if member["status"] != "pending" else {"status": "canceled"}
        saved = await db.nt_memberships.find_one_and_update({"id": mid}, {"$set": fields}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        await add_audit(user.get("name") or user["role"], f"Membership {member['productName']} cancellation requested")
        return saved

    @r.get("/purchases")
    async def all_purchases(request: Request, status: str = ""):
        await actor(request, "owner")
        rows = await db.nt_plan_purchases.find({"status": status} if status else {"status": {"$ne": "pending_payment"}}, {"_id": 0}).sort("createdAt", -1).to_list(500)
        ids = list({p["clientId"] for p in rows})
        names = {c["id"]: f"{c.get('firstName', '')} {c.get('lastName', '')}".strip() for c in await coll("clients").find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "firstName": 1, "lastName": 1}).to_list(500)}
        out = []
        for p in rows:
            states = await db.nt_credits.find({"purchaseId": p["id"]}, {"_id": 0, "state": 1}).to_list(50)
            out.append({**present_purchase(p), "clientName": names.get(p["clientId"]) or p["clientId"], "credits": p["credits"],
                        "usage": {s: sum(1 for c in states if c["state"] == s) for s in ("available", "reserved", "consumed", "refunded", "expired")}})
        return out

    @r.get("/memberships")
    async def all_memberships(request: Request):
        await actor(request, "owner")
        return await db.nt_memberships.find({}, {"_id": 0}).sort("createdAt", -1).to_list(500)

    @r.post("/purchases/{ppid}/refund")
    async def refund(ppid: str, request: Request):
        user = await actor(request, "owner")
        # The legacy credit refund path mutates credits before provider success.
        # Keep it inaccessible to real Stripe funds until credit/refund webhook
        # reconciliation is implemented and separately accepted.
        if os.environ.get("PAYMENT_MODE") == "test":
            raise HTTPException(503, "Stripe plan refunds require credit reconciliation; no credits or funds were changed")
        body = await body_of(request)
        key = idem(body)
        reason = str(body.get("reason") or "").strip()[:160]
        if not reason:
            raise HTTPException(400, "A reason is required")
        purchase = await db.nt_plan_purchases.find_one({"id": ppid}, {"_id": 0})
        if purchase and await db.nt_credit_ledger.find_one({"idempotencyKey": f"refund-{ppid}-{key}"}):
            return present_purchase(purchase)
        if not purchase or purchase["status"] not in ("paid", "partially_refunded"):
            raise HTTPException(409, "Only a paid plan can be refunded")
        await expire_stale(db, purchase["clientId"])
        unused = await db.nt_credits.find({"purchaseId": ppid, "state": "available"}, {"_id": 0}).to_list(50)
        if not unused:
            raise HTTPException(409, "No unused credits are left to refund. Reserved credits must be released by cancelling the visit first.")
        refunded = []
        for credit in unused:
            if await db.nt_credits.find_one_and_update({"id": credit["id"], "state": "available"}, {"$set": {"state": "refunded", "refundedAt": now_iso()}}):
                refunded.append(credit)
                await _log(db, credit, "refunded", f"refund-{credit['id']}", user.get("name") or "owner", note=reason)
        cents = round(purchase["totalCents"] * len(refunded) / purchase["credits"])
        method = "manual"
        skey = os.environ.get("STRIPE_SECRET_KEY") or ""
        if purchase.get("paymentIntent") and skey.startswith("sk_test_") and cents:
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post("https://api.stripe.com/v1/refunds", auth=(skey, ""), data={"payment_intent": purchase["paymentIntent"], "amount": str(cents)},
                                         headers={"Idempotency-Key": f"plan-refund-{ppid}-{key}"})
            method = "stripe" if resp.status_code < 400 else "manual_review"
        total_refunded = int(purchase.get("refundedCents") or 0) + cents
        left = await db.nt_credits.count_documents({"purchaseId": ppid, "state": {"$in": ["available", "reserved", "consumed"]}})
        saved = await db.nt_plan_purchases.find_one_and_update({"id": ppid}, {"$set": {"refundedCents": total_refunded, "status": "partially_refunded" if left else "refunded"},
                                                                              "$push": {"refunds": {"cents": cents, "credits": len(refunded), "reason": reason, "method": method, "at": now_iso(), "by": user.get("name")}}},
                                                               return_document=ReturnDocument.AFTER, projection={"_id": 0})
        await db.nt_credit_ledger.insert_one({"id": "cl-" + uuid.uuid4().hex[:12], "creditId": None, "purchaseId": ppid, "clientId": purchase["clientId"], "type": "purchase_refund",
                                              "unitCents": cents, "note": f"{len(refunded)} credits · {method} · {reason}", "actor": user.get("name"), "idempotencyKey": f"refund-{ppid}-{key}", "at": now_iso()})
        await add_audit(user.get("name") or "owner", f"Wellness plan {purchase['productName']} refunded {money(cents)['display']} for {len(refunded)} unused credits ({method})")
        return {**present_purchase(saved), "refundMethod": method}

    return r
