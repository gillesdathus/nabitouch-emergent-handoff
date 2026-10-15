"""Mock payment + insurance-claim adapter. Replace with Stripe PaymentIntents + verified webhooks in production.
Raw card data is never received here; the simulated checkout only sends an outcome flag."""
import uuid
from datetime import datetime, timezone
import logging
from fastapi import APIRouter, HTTPException, Body, Request

CLAIM_FLOW = {
    "none": ["info_pending", "verification_pending", "submitted"],
    "info_pending": ["verification_pending", "submitted"],
    "verification_pending": ["submitted", "declined"],
    "submitted": ["approved", "partially_approved", "declined"],
    "approved": [], "partially_approved": [], "declined": [],
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def r2(x):
    """Legacy appointment dollars, quantized through cents so the float is not the source of truth."""
    from money import dollars, to_cents
    return dollars(to_cents(x))


def settle(appt):
    """Server-calculated balances. Estimated/approved insurance is never counted as paid."""
    p = appt.get("pricing") or {}
    total = r2(p.get("total", 0))
    claim = appt.get("claim") or {"status": "none"}
    pays = appt.get("payments", [])
    ok = [x for x in pays if x["status"] in ("succeeded", "refund_pending", "refunded")]
    client_paid = r2(sum(x["amount"] for x in ok))
    refunded = r2(sum(x.get("refunded", 0) for x in pays))
    ins_confirmed = r2(claim.get("insurerPaid", 0)) if claim.get("insurerPayment") == "confirmed" else 0
    approved = r2(claim.get("approved", 0)) if claim.get("status") in ("approved", "partially_approved") else 0
    ins_pending = r2(approved - ins_confirmed) if approved > ins_confirmed else 0
    uses_ins = appt.get("paymentMethod") == "insurance"
    awaiting = uses_ins and claim.get("status") not in ("approved", "partially_approved", "declined")
    expected_ins = ins_confirmed if ins_confirmed else approved
    net_paid = r2(client_paid - refunded)
    balance = r2(max(0, total - ins_confirmed - net_paid))
    payable = 0 if awaiting else r2(max(0, total - expected_ins - net_paid))
    overpaid = r2(max(0, ins_confirmed + net_paid - total))
    pending_card = any(x["status"] == "pending" for x in pays)
    last = pays[-1]["status"] if pays else None
    if any(x["status"] == "refund_pending" for x in pays):
        status = "refund_pending"
    elif refunded and net_paid <= 0 and not ins_confirmed:
        status = "refunded"
    elif pending_card:
        status = "stripe_pending"
    elif balance <= 0:
        status = "fully_paid"
    elif last == "failed":
        status = "stripe_failed"
    elif ins_pending and payable <= 0:
        status = "insurer_payment_pending"
    elif awaiting:
        status = {"none": "insurance_info_pending", "info_pending": "insurance_info_pending",
                  "verification_pending": "verification_pending", "submitted": "claim_submitted"}.get(claim.get("status"), "claim_submitted")
    elif net_paid > 0 or ins_confirmed > 0:
        status = "partially_paid"
    elif appt.get("status") in ("completed", "processing", "closed") or (uses_ins and claim.get("status") == "declined"):
        status = "balance_due"
    else:
        status = "method_selected"
    return {"total": total, "eligible": r2(claim.get("eligible", 0)), "approved": approved, "insuranceConfirmed": ins_confirmed,
            "insurancePending": ins_pending, "clientPaid": client_paid, "refunded": refunded, "balance": balance,
            "payable": payable, "awaiting": awaiting, "overpaid": overpaid, "clientResponsibility": r2(max(0, total - expected_ins))}, status


def with_settle(appt):
    s, st = settle(appt)
    return {**appt, "settle": s, "paymentStatus": st}


def claim_eligible(pricing, gst):
    # Demo insurer rule: discounted treatment + enhancements (+GST); travel excluded. Configure per insurer in production.
    return r2((pricing.get("base", 0) - pricing.get("discount", 0) + pricing.get("addons", 0)) * (1 + gst))


def build_router(coll, add_audit, user_from):
    r = APIRouter(prefix="/api")

    async def guard(request, a, need=None):
        """need=None: appointment's client or staff; 'payments'/'claims': staff with permission; 'owner'."""
        u = await user_from(request)
        if not u:
            raise HTTPException(401, "Not authenticated")
        if u["role"] == "owner":
            return u
        perms = ((await coll("settings").find_one({"id": "app"}, {"_id": 0})) or {}).get("receptionPerms", {})
        if u["role"] == "desk" and need != "owner" and perms.get("viewInsuranceStatus" if need == "claims" else "managePayments"):
            return u
        if need is None and u["role"] == "client" and a.get("clientId") == u.get("subject"):
            return u
        raise HTTPException(403, "Not permitted for this payment")

    async def load(aid):
        a = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not a:
            raise HTTPException(404, "Appointment not found")
        return a

    async def save(a, actor, msg):
        a = with_settle(a)
        await coll("appointments").update_one({"id": a["id"]}, {"$set": {k: a[k] for k in ("payments", "claim", "settle", "paymentStatus", "paymentMethod")}})
        await add_audit(actor, f"{a['ref']} · {msg}", a["id"])
        try:
            from rewards import reverse_appointment_points, settle_appointment_points
            from money import to_cents
            database = coll("appointments").database
            await settle_appointment_points(database, coll, a)
            for payment in a.get("payments") or []:
                if payment.get("status") == "refunded":
                    await reverse_appointment_points(database, coll, a, to_cents(payment.get("refunded") or 0), payment.get("id"))
        except Exception:
            logging.getLogger("rewards").exception("Rewards settlement was skipped")
        return a

    @r.post("/payments/{aid}/intent")
    async def create_intent(aid: str, request: Request, body: dict = Body(...)):
        from config import payments_simulated, stripe_card_checkout_enabled
        if not stripe_card_checkout_enabled():
            raise HTTPException(503, "Card checkout is turned off")
        if not payments_simulated():
            raise HTTPException(503, "Card checkout is not configured")
        a = with_settle(await load(aid))
        body["actor"] = (await guard(request, a))["name"]
        key = body.get("idempotencyKey")
        pays = a.get("payments", [])
        same = next((p for p in pays if key and p.get("idempotencyKey") == key), None) or next((p for p in pays if p["status"] == "pending"), None)
        if same:
            return {"intent": same, "appointment": a}
        amount = a["settle"]["payable"]
        if amount <= 0:
            raise HTTPException(409, "Nothing payable right now — no charge created")
        intent = {"id": f"pay-{uuid.uuid4().hex[:8]}", "intentId": f"pi_demo_{uuid.uuid4().hex[:14]}", "provider": "stripe",
                  "amount": amount, "status": "pending", "at": now_iso(), "idempotencyKey": key, "by": body.get("actor", "client")}
        a["payments"] = pays + [intent]
        a = await save(a, body.get("actor", "client"), f"Stripe PaymentIntent created (simulated) {amount:.2f}")
        return {"intent": intent, "appointment": a}

    async def settle_pending(aid, request, body, actor):
        a = await load(aid)
        await guard(request, a)
        pid, outcome = body.get("paymentId"), body.get("outcome")
        if outcome not in ("succeeded", "failed"):
            raise HTTPException(400, "Outcome must be succeeded or failed")
        p = next((x for x in a.get("payments", []) if x["id"] == pid), None)
        if not p:
            raise HTTPException(404, "Payment not found")
        if p["status"] != "pending":
            return with_settle(a)
        p["status"] = "succeeded" if outcome == "succeeded" else "failed"
        p["settledAt"] = now_iso()
        if outcome == "succeeded":
            p["receipt"] = f"RCPT-{uuid.uuid4().hex[:6].upper()}"
        else:
            p["failure"] = "card_declined (simulated)"
        return await save(a, actor, f"card payment {p['status']} {p['amount']:.2f}")

    @r.post("/payments/{aid}/webhook")
    async def stripe_webhook(aid: str, request: Request):
        """Unsigned callers cannot settle a charge. Live Stripe signatures arrive in a later slice."""
        raise HTTPException(404, "Not available")

    @r.post("/payments/{aid}/simulate")
    async def simulate_payment(aid: str, request: Request, body: dict = Body(...)):
        """Preview-only checkout. Uses the server-created pending amount and ignores any client total."""
        from config import payments_simulated
        if not payments_simulated():
            raise HTTPException(404, "Not available")
        body.pop("amount", None)
        return await settle_pending(aid, request, body, "Stripe (simulated)")

    @r.post("/payments/{aid}/cash")
    async def record_cash(aid: str, request: Request, body: dict = Body(...)):
        a = with_settle(await load(aid))
        body["actor"] = (await guard(request, a, "payments"))["name"]
        amt = r2(min(float(body.get("amount") or a["settle"]["payable"]), a["settle"]["payable"]))
        if amt <= 0:
            raise HTTPException(409, "Nothing payable")
        a["payments"] = a.get("payments", []) + [{"id": f"pay-{uuid.uuid4().hex[:8]}", "provider": "cash", "amount": amt, "status": "succeeded",
                                                  "at": now_iso(), "receipt": f"RCPT-{uuid.uuid4().hex[:6].upper()}", "by": body.get("actor")}]
        return await save(a, body.get("actor", "staff"), f"cash payment recorded {amt:.2f}")

    @r.post("/payments/{aid}/refund")
    async def refund(aid: str, request: Request, body: dict = Body(...)):
        a = await load(aid)
        body["actor"] = (await guard(request, a, "owner"))["name"]
        p = next((x for x in a.get("payments", []) if x["id"] == body.get("paymentId")), None)
        if not p or p["status"] not in ("succeeded", "refund_pending"):
            raise HTTPException(409, "Payment not refundable")
        remaining = r2(float(p["amount"]) - float(p.get("refunded") or 0))
        if p["status"] == "succeeded":
            requested = r2(body.get("amount") or remaining)
            if requested <= 0 or requested > remaining:
                raise HTTPException(409, "Refund exceeds the captured amount")
            p["status"], p["refundAmount"] = "refund_pending", requested
            msg = f"refund requested {p['refundAmount']:.2f}"
        else:
            p["status"], p["refunded"] = "refunded", p["refundAmount"]
            msg = f"refund completed {p['refunded']:.2f}"
        return await save(a, body.get("actor", "owner"), msg)

    @r.post("/payments/{aid}/method")
    async def set_method(aid: str, request: Request, body: dict = Body(...)):
        a = await load(aid)
        body["actor"] = (await guard(request, a))["name"]
        a["paymentMethod"] = body["method"]
        return await save(a, body.get("actor", "client"), f"payment method → {body['method']}")

    @r.post("/claims/{aid}")
    async def claim_action(aid: str, request: Request, body: dict = Body(...)):
        a = await load(aid)
        body["actor"] = (await guard(request, a, "claims"))["name"]
        c = a.get("claim") or {"status": "none"}
        act, actor = body.get("action"), body.get("actor", "staff")
        if act in CLAIM_FLOW:
            if act not in CLAIM_FLOW.get(c["status"], []):
                raise HTTPException(409, f"Claim cannot move from {c['status']} to {act}")
            c["status"] = act
            if act == "approved":
                c["approved"] = c.get("eligible", 0)
            if act == "partially_approved":
                c["approved"] = r2(min(float(body.get("amount", 0)), c.get("eligible", 0)))
            if act in ("approved", "partially_approved"):
                c["insurerPayment"] = "pending"
            if act == "declined":
                c["approved"], c["insurerPayment"] = 0, "none"
        elif act == "insurer_paid":
            if c.get("insurerPayment") != "pending":
                raise HTTPException(409, "No insurer payment pending")
            c["insurerPayment"], c["insurerPaid"] = "confirmed", c.get("approved", 0)
        else:
            raise HTTPException(400, "Unknown action")
        c.setdefault("history", []).append({"action": act, "at": now_iso(), "by": actor})
        a["claim"] = c
        return await save(a, actor, f"insurance claim → {act.replace('_', ' ')} (simulated)")

    return r
