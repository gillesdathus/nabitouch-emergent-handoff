"""Append-only invoice ledger. Amounts are integer cents. Approval is not payment."""
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response

from documents import ScannerUnavailable, assess
from config import giftcards_enabled, invoice_email_enabled
from plans import settle_checkout as plan_settle, subscription_event as plan_subscription_event
from giftcards import activate_paid as gift_activate_paid, debit as gift_debit, norm_code, reverse as gift_reverse
from notifications import enqueue_billing
from pdfbrand import invoice_pdf as brand_invoice_pdf, receipt_pdf as brand_receipt_pdf


def require_giftcards():
    if not giftcards_enabled():
        raise HTTPException(503, "Gift-card transactions are turned off")
from fieldcrypto import open_bytes, seal_bytes
from payment_policy import (
    CHECKOUT_HOLD_MINUTES, allowed_online_amounts, checkout_event_action, collection_status, deposit_cents,
    due_after_payment, resolve_payment_policy, review_after_expiry,
)
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

TERMS_DAYS = 14
OPEN_STATES = ("draft", "issued", "partially_paid", "paid")


def now():
    return datetime.now(timezone.utc)


def now_iso():
    return now().isoformat()


def to_cents(value):
    return int((Decimal(str(value)) * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def money_view(cents):
    n = int(cents)
    sign = "-" if n < 0 else ""
    absolute = abs(n)
    return {"cents": n, "display": f"{sign}${absolute // 100}.{absolute % 100:02d}"}


def lines_from_pricing(pricing):
    """Copy the server quote. Do not recompute a second tax opinion."""
    pricing = pricing or {}
    rows = []
    base = to_cents(pricing.get("base", 0))
    discount = to_cents(pricing.get("discount", 0))
    if base:
        rows.append({"description": "Treatment", "quantity": 1, "netCents": base, "taxCode": "included"})
    credit = min(to_cents(pricing.get("creditUnit", 0)), discount) if pricing.get("packageCredit") else 0
    if discount - credit:
        label = "Package savings" if credit else pricing.get("promoName") or "Discount"
        rows.append({"description": label, "quantity": 1, "netCents": -(discount - credit), "taxCode": "included"})
    if credit:
        rows.append({"description": "Prepaid package credit", "quantity": 1, "netCents": -credit, "taxCode": "prepaid_credit"})
    addons = to_cents(pricing.get("addons", 0))
    if addons:
        rows.append({"description": "Enhancements", "quantity": 1, "netCents": addons, "taxCode": "included"})
    travel = to_cents(pricing.get("travel", 0))
    if travel:
        rows.append({"description": "Travel", "quantity": 1, "netCents": travel, "taxCode": "included"})
    tax = to_cents(pricing.get("tax", 0))
    target = to_cents(pricing.get("total", 0))
    net = sum(row["netCents"] for row in rows)
    drift = target - (net + tax)
    if drift:
        rows.append({"description": "Quote rounding", "quantity": 1, "netCents": drift, "taxCode": "included"})
        net += drift
    return rows, net, tax, target


def derive_state(current, total, received):
    if current == "voided" or current == "draft":
        return current
    if received <= 0:
        return "issued"
    if received < total:
        return "partially_paid"
    return "paid"


def project(invoice, ledger):
    received = 0
    for line in ledger:
        if line["type"] in ("client_payment", "insurance_receipt"):
            received += int(line["amountCents"])
        elif line["type"] in ("refund", "reversal"):
            received -= int(line["amountCents"])
    received = max(0, received)
    total = int(invoice["totalCents"])
    state = derive_state(invoice["state"], total, received)
    balance = 0 if state in ("draft", "voided") else max(0, total - received)
    due = invoice.get("dueDate")
    overdue = bool(state in ("issued", "partially_paid") and due and due < now().date().isoformat() and balance > 0)
    return received, balance, state, overdue


def split_received(ledger):
    insurance = 0
    client = 0
    for line in ledger:
        amount = int(line["amountCents"])
        if line["type"] == "insurance_receipt":
            insurance += amount
        elif line["type"] == "client_payment":
            client += amount
        elif line["type"] in ("refund", "reversal"):
            if line.get("method") == "insurance":
                insurance -= amount
            else:
                client -= amount
    return max(0, insurance), max(0, client)


def public_invoice(invoice, ledger, claims=None):
    received, balance, state, overdue = project(invoice, ledger)
    expected = int(invoice.get("expectedInsuranceCents") or 0)
    expected = min(expected, balance)
    insurance_received, client_paid = split_received(ledger)
    claimed = sum(int(item["claimed"]["cents"]) for item in (claims or []))
    approved = sum(int(item["approved"]["cents"]) for item in (claims or []))
    return {
        "id": invoice["id"],
        "number": invoice.get("number"),
        "appointmentId": invoice.get("appointmentId"),
        "clientId": invoice.get("clientId"),
        "practitionerId": invoice.get("practitionerId"),
        "clientName": invoice.get("clientName"),
        "practitionerName": invoice.get("practitionerName"),
        "service": invoice.get("service"),
        "duration": invoice.get("duration"),
        "serviceDate": invoice.get("serviceDate"),
        "issueDate": invoice.get("issueDate"),
        "dueDate": invoice.get("dueDate"),
        "currency": "CAD",
        "state": state,
        "version": invoice["version"],
        "origin": invoice.get("origin"),
        "countsAsRevenue": bool(invoice.get("countsAsRevenue", True)),
        "lines": invoice.get("lines") or [],
        "tax": money_view(invoice.get("taxCents") or 0),
        "total": money_view(invoice["totalCents"]),
        "received": money_view(received),
        "insuranceReceived": money_view(insurance_received),
        "clientPaid": money_view(client_paid),
        "claimed": money_view(claimed),
        "approved": money_view(approved),
        "balance": money_view(balance),
        "refunded": money_view(sum(int(line["amountCents"]) for line in ledger if line["type"] in ("refund", "reversal"))),
        "collectionStatus": collection_status(invoice["totalCents"], received, sum(int(line["amountCents"]) for line in ledger if line["type"] in ("refund", "reversal"))),
        "expectedInsurance": money_view(expected),
        "estimatedClientShare": money_view(max(0, balance - expected)),
        "overdue": overdue,
        "clientReportedTransfer": any(line["type"] == "transfer_reported" for line in ledger),
        "releasedAt": invoice.get("releasedAt"),
        "claims": claims or [],
        "payments": [
            {"id": line["id"], "type": line["type"], "method": line.get("method"), "amount": money_view(line["amountCents"]),
             "at": line["at"], "reference": line.get("reference"), "by": line.get("actorName")}
            for line in ledger if line["type"] not in ("issue", "transfer_reported")
        ],
    }


def render_pdf(invoice, view):
    paid_label = "PAID IN FULL" if view["state"] == "paid" else "BALANCE DUE " + view["balance"]["display"]
    rows = [
        "Nabitouch",
        "Invoice " + (view["number"] or "DRAFT"),
        "State: " + view["state"].replace("_", " "),
        paid_label,
        "Client: " + (view.get("clientName") or ""),
        "Practitioner: " + (view.get("practitionerName") or ""),
        "Service: " + (view.get("service") or "") + "  " + str(view.get("duration") or "") + " min",
        "Service date: " + str(view.get("serviceDate") or ""),
        "Issue date: " + str(view.get("issueDate") or ""),
        "Currency: CAD",
    ]
    for line in view["lines"]:
        rows.append(f"{line['description']}  {money_view(line['netCents'])['display']}")
    rows.append("Tax " + view["tax"]["display"])
    rows.append("Total " + view["total"]["display"])
    rows.append("Received " + view["received"]["display"])
    rows.append("Outstanding " + view["balance"]["display"])
    if view["expectedInsurance"]["cents"]:
        rows.append("Insurance approved, not yet received " + view["expectedInsurance"]["display"])
    rows.append("This document contains no clinical notes.")
    if view["state"] != "paid":
        rows.append("Unpaid amounts are not shown as paid.")
    return _pdf(rows)


def _pdf(lines):
    commands = ["BT /F1 11 Tf 48 760 Td 14 TL"]
    for line in lines:
        safe = "".join(ch if 32 <= ord(ch) < 127 else " " for ch in line)
        safe = safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"({safe}) '")
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1")
    objects = []

    def add(body):
        objects.append(body)
        return len(objects)

    add("<< /Type /Catalog /Pages 2 0 R >>")
    add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
    add(f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream")
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        raw = body if isinstance(body, bytes) else body.encode("latin-1")
        out += f"{number} 0 obj\n".encode("latin-1") + raw + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("latin-1")
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += f"{offset:010d} 00000 n \n".encode("latin-1")
    out += f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode("latin-1")
    return bytes(out)


PROVIDERS = ("Alberta Blue Cross", "TELUS eClaims", "Sun Life", "Canada Life", "Other")
CLAIM_STATES = ("submitted", "pending", "approved", "partially_approved", "denied", "cancelled")
_demo_webhook_secret = None


def stripe_signature_matches(payload: bytes, header: str, secret: str) -> bool:
    parts = {}
    for piece in (header or "").split(","):
        if "=" in piece:
            key, value = piece.split("=", 1)
            parts[key.strip()] = value.strip()
    stamp = parts.get("t")
    given = parts.get("v1")
    if not stamp or not given or not secret:
        return False
    digest = hmac.new(secret.encode(), stamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, given)


async def ensure_billing(db):
    await db.nt_invoices.create_index("id", unique=True)
    await db.nt_invoices.create_index(
        "appointmentId", unique=True,
        partialFilterExpression={"origin": "appointment", "state": {"$in": list(OPEN_STATES)}},
    )
    await db.nt_ledger.create_index("id", unique=True)
    await db.nt_ledger.create_index("idempotencyKey", unique=True)
    await db.nt_ledger.create_index("invoiceId")
    await db.nt_claims.create_index("id", unique=True)
    await db.nt_tips.create_index("idempotencyKey", unique=True)
    await db.nt_claims.create_index("invoiceId")
    await db.nt_files.create_index("id", unique=True)
    await db.nt_ledger.create_index([("claimId", 1), ("reference", 1)], unique=True, partialFilterExpression={"type": "insurance_receipt", "reference": {"$type": "string"}})
    await db.nt_notices.create_index("id", unique=True)
    await db.nt_notices.create_index("dedupeKey", unique=True)
    await db.nt_notices.create_index([("recipientId", 1), ("at", 1)])
    await db.nt_checkouts.create_index("id", unique=True)
    await db.nt_checkouts.create_index("sessionId", unique=True)
    await db.nt_ops.create_index("id", unique=True)


async def clear_billing(db):
    for name in ("nt_invoices", "nt_ledger", "nt_claims", "nt_notices", "nt_files", "nt_imports", "nt_checkouts", "nt_ops"):
        await db[name].delete_many({})


async def _body(request):
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


def build_billing_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api")

    async def settings():
        return (await coll("settings").find_one({"id": "app"}, {"_id": 0})) or {}

    async def perms():
        return (await settings()).get("receptionPerms") or {}

    async def actor(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def appointment(aid):
        found = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not found:
            raise HTTPException(404, "Appointment not found")
        return found

    async def sync_payment_due(invoice):
        """Copy the ledger result onto the visit. A missing payment policy leaves older visits unchanged."""
        lines = await ledger_for(invoice["id"])
        received, _balance, _state, _overdue = project(invoice, lines)
        refunded = sum(int(line["amountCents"]) for line in lines if line["type"] in ("refund", "reversal"))
        fields = due_after_payment(invoice["totalCents"], received, refunded)
        await coll("appointments").update_one(
            {"id": invoice.get("appointmentId"), "paymentDue": {"$type": "object"}},
            {"$set": {f"paymentDue.{key}": value for key, value in fields.items()}},
        )

    def allowed(user, appt, kind):
        if user["role"] == "owner":
            return True
        if user["role"] == "practitioner" and user.get("subject") == appt.get("practitionerId") and kind in ("view", "cash", "claim"):
            return True
        if user["role"] == "client" and user.get("subject") == appt.get("clientId") and kind == "view":
            return True
        if user["role"] == "desk" and kind == "view":
            return True
        return False

    async def desk_can(user, key):
        return user["role"] == "desk" and bool((await perms()).get(key))

    async def load(iid):
        found = await db.nt_invoices.find_one({"id": iid}, {"_id": 0})
        if not found:
            raise HTTPException(404, "Invoice not found")
        return found

    async def ledger_for(iid):
        return await db.nt_ledger.find({"invoiceId": iid}, {"_id": 0}).sort("at", 1).to_list(500)

    async def claim_views(iid):
        rows = await db.nt_claims.find({"invoiceId": iid}, {"_id": 0}).to_list(50)
        lines = await ledger_for(iid)
        out = []
        for claim in rows:
            received = sum(line["amountCents"] for line in lines if line.get("type") == "insurance_receipt" and line.get("claimId") == claim["id"])
            files = await db.nt_files.find({"claimId": claim["id"]}, {"_id": 0, "data": 0}).to_list(20)
            out.append({
                "id": claim["id"], "provider": claim.get("provider"), "reference": claim.get("reference") or "",
                "status": claim.get("status"), "claimed": money_view(claim.get("claimedCents") or 0),
                "approved": money_view(claim.get("approvedCents") or 0), "received": money_view(received),
                "notes": claim.get("notes") or "",
                "history": [{"status": item.get("status"), "at": item.get("at")} for item in (claim.get("history") or [])],
                "documents": [{"id": item["id"], "name": item.get("name"), "clientVisible": bool(item.get("clientVisible"))} for item in files],
            })
        return out

    async def refresh_expected(iid):
        claims = await claim_views(iid)
        expected = sum(max(0, claim["approved"]["cents"] - claim["received"]["cents"]) for claim in claims if claim["status"] in ("approved", "partially_approved"))
        await db.nt_invoices.update_one({"id": iid}, {"$set": {"expectedInsuranceCents": expected}})

    async def view_for(user, invoice):
        appt = await appointment(invoice["appointmentId"]) if invoice.get("appointmentId") else {"clientId": invoice.get("clientId"), "practitionerId": invoice.get("practitionerId")}
        if user["role"] == "desk":
            if not (await desk_can(user, "managePayments") or await desk_can(user, "viewInsuranceStatus")):
                raise HTTPException(404, "Invoice not found")
        elif not allowed(user, appt, "view"):
            raise HTTPException(404, "Invoice not found")
        view = public_invoice(invoice, await ledger_for(invoice["id"]), await claim_views(invoice["id"]))
        if user["role"] == "client":
            for claim in view["claims"]:
                claim["notes"] = ""
                claim["documents"] = [item for item in claim["documents"] if item["clientVisible"]]
        return view

    async def notify_client(invoice, dedupe):
        recipient = invoice.get("clientId")
        if not recipient:
            return
        key = f"billing:{invoice['id']}:{dedupe}"[:180]
        notice = {
            "id": "ntc-" + uuid.uuid4().hex[:12],
            "dedupeKey": key,
            "recipientId": recipient,
            "invoiceId": invoice["id"],
            "kind": "billing_update",
            "title": "Billing update",
            "body": "A billing update is ready in your account.",
            "emailSubject": "Nabitouch billing update",
            "channel": "billing",
            "at": now_iso(),
        }
        try:
            await db.nt_notices.insert_one(dict(notice))
        except DuplicateKeyError:
            return
        person = await coll("clients").find_one({"id": recipient}, {"_id": 0, "email": 1})
        if person and person.get("email"):
            try:
                from emailer import send_email
                await send_email(to=person["email"], subject=notice["emailSubject"], html="<p>A billing update is ready in your Nabitouch account.</p>")
            except Exception:
                pass
        try:
            from tracking_store import client as redis_client
            await redis_client().publish(f"nt:bill:ch:{recipient}", json.dumps({"id": notice["id"], "kind": notice["kind"]}))
        except Exception:
            pass

    async def mutate(invoice, user, key, build):
        if not key or len(str(key)) < 8 or len(str(key)) > 80:
            raise HTTPException(400, "Idempotency key is required")
        prior = await db.nt_ledger.find_one({"idempotencyKey": key}, {"_id": 0})
        if prior:
            if prior["invoiceId"] != invoice["id"]:
                raise HTTPException(409, "Idempotency key was used on another invoice")
            return await load(invoice["id"])
        version = int(invoice["version"])
        op_id = "op-" + uuid.uuid4().hex[:12]
        if (await db.command("hello")).get("setName"):
            return await mutate_txn(invoice, user, key, build, version, op_id)
        await db.nt_ops.insert_one({"id": op_id, "invoiceId": invoice["id"], "idempotencyKey": key, "status": "pending", "at": now_iso()})
        line = build(invoice, await ledger_for(invoice["id"]))
        line.update({"id": "led-" + uuid.uuid4().hex[:12], "invoiceId": invoice["id"], "idempotencyKey": key,
                     "appliedVersion": version, "at": now_iso(), "actorId": user.get("id"), "actorName": user.get("name")})
        try:
            await db.nt_ledger.insert_one(dict(line))
        except DuplicateKeyError:
            if await db.nt_ledger.find_one({"idempotencyKey": key}):
                return await load(invoice["id"])
            raise HTTPException(409, "That remittance was already recorded")
        fresh_lines = await ledger_for(invoice["id"])
        received, balance, state, _overdue = project({**invoice, "state": "issued" if invoice["state"] == "draft" else invoice["state"]}, fresh_lines)
        if line["type"] == "void":
            state = "voided"
            balance = 0
        updated = await db.nt_invoices.find_one_and_update(
            {"id": invoice["id"], "version": version},
            {"$set": {"state": state, "receivedCents": received, "balanceCents": balance}, "$inc": {"version": 1}},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            await db.nt_ledger.delete_one({"id": line["id"]})
            await db.nt_ops.update_one({"id": op_id}, {"$set": {"status": "reverted"}})
            raise HTTPException(409, "Invoice changed. Refresh and try again.")
        await db.nt_ops.update_one({"id": op_id}, {"$set": {"status": "completed"}})
        stored = {k: v for k, v in updated.items() if k != "_id"}
        await add_audit(user.get("name") or "staff", f"{stored.get('number') or stored['id']} {line['type']} {money_view(line['amountCents'])['display']}", stored.get("appointmentId"))
        return stored

    async def mutate_txn(invoice, user, key, build, version, op_id):
        """Ledger line, invoice balance, and operation journal commit together on a replica set."""
        try:
            async with await db.client.start_session() as session:
                async with session.start_transaction():
                    await db.nt_ops.insert_one({"id": op_id, "invoiceId": invoice["id"], "idempotencyKey": key, "status": "pending", "at": now_iso()}, session=session)
                    line = build(invoice, await ledger_for(invoice["id"]))
                    line.update({"id": "led-" + uuid.uuid4().hex[:12], "invoiceId": invoice["id"], "idempotencyKey": key,
                                 "appliedVersion": version, "at": now_iso(), "actorId": user.get("id"), "actorName": user.get("name")})
                    await db.nt_ledger.insert_one(dict(line), session=session)
                    fresh_lines = await db.nt_ledger.find({"invoiceId": invoice["id"]}, {"_id": 0}, session=session).sort("at", 1).to_list(500)
                    received, balance, state, _overdue = project({**invoice, "state": "issued" if invoice["state"] == "draft" else invoice["state"]}, fresh_lines)
                    if line["type"] == "void":
                        state = "voided"
                        balance = 0
                    updated = await db.nt_invoices.find_one_and_update(
                        {"id": invoice["id"], "version": version},
                        {"$set": {"state": state, "receivedCents": received, "balanceCents": balance}, "$inc": {"version": 1}},
                        return_document=ReturnDocument.AFTER,
                        session=session,
                    )
                    if not updated:
                        raise HTTPException(409, "Invoice changed. Refresh and try again.")
                    await db.nt_ops.update_one({"id": op_id}, {"$set": {"status": "completed"}}, session=session)
                    stored = {k: v for k, v in updated.items() if k != "_id"}
        except HTTPException:
            raise
        except DuplicateKeyError:
            if await db.nt_ledger.find_one({"idempotencyKey": key}):
                return await load(invoice["id"])
            raise HTTPException(409, "That remittance was already recorded")
        except OperationFailure as exc:
            if exc.code == 112 or exc.has_error_label("TransientTransactionError"):
                raise HTTPException(409, "Invoice changed. Refresh and try again.") from exc
            raise
        await add_audit(user.get("name") or "staff", f"{stored.get('number') or stored['id']} {line['type']} {money_view(line['amountCents'])['display']}", stored.get("appointmentId"))
        return stored

    @r.post("/invoices/from-appointment/{aid}")
    async def draft_invoice(aid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        appt = await appointment(aid)
        if not (user["role"] == "owner" or await desk_can(user, "managePayments") or allowed(user, appt, "cash")):
            raise HTTPException(403, "Not permitted to invoice this visit")
        if appt.get("status") == "cancelled":
            raise HTTPException(409, "A cancelled visit is not invoiced")
        existing = await db.nt_invoices.find_one({"appointmentId": aid, "origin": "appointment", "state": {"$in": list(OPEN_STATES)}}, {"_id": 0})
        if existing:
            return await view_for(user, existing)
        client = await coll("clients").find_one({"id": appt.get("clientId")}, {"_id": 0}) if appt.get("clientId") else None
        practitioner = await coll("practitioners").find_one({"id": appt.get("practitionerId")}, {"_id": 0}) if appt.get("practitionerId") else None
        service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, {"_id": 0})
        rows, _net, tax, total = lines_from_pricing(appt.get("pricing"))
        if total < 0:
            raise HTTPException(409, "Invoice total cannot be negative")
        invoice = {
            "id": "inv-" + uuid.uuid4().hex[:12], "number": None, "appointmentId": aid, "clientId": appt.get("clientId"),
            "practitionerId": appt.get("practitionerId"),
            "clientName": ((client or {}).get("firstName", "") + " " + (client or {}).get("lastName", "")).strip() or "Guest",
            "practitionerName": (practitioner or {}).get("name") or "",
            "service": (service or {}).get("name") or appt.get("serviceSlug"),
            "duration": appt.get("duration"), "serviceDate": appt.get("date"), "issueDate": None, "dueDate": None,
            "currency": "CAD", "state": "draft", "version": 1, "origin": "appointment", "countsAsRevenue": True,
            "lines": rows, "taxCents": tax, "totalCents": total, "expectedInsuranceCents": 0,
            "createdAt": now_iso(), "idempotencyKey": (body or {}).get("idempotencyKey"),
        }
        try:
            await db.nt_invoices.insert_one(dict(invoice))
        except DuplicateKeyError:
            existing = await db.nt_invoices.find_one({"appointmentId": aid, "origin": "appointment", "state": {"$in": list(OPEN_STATES)}}, {"_id": 0})
            return await view_for(user, existing)
        await add_audit(user.get("name") or "staff", f"Draft invoice {invoice['id']}", aid)
        return await view_for(user, invoice)

    @r.get("/invoices/by-appointment/{aid}")
    async def by_appointment(aid: str, request: Request):
        user = await actor(request)
        found = await db.nt_invoices.find_one({"appointmentId": aid, "state": {"$in": list(OPEN_STATES) + ["voided"]}}, {"_id": 0})
        if not found:
            raise HTTPException(404, "Invoice not found")
        return await view_for(user, found)

    @r.get("/invoices/{iid}")
    async def get_invoice(iid: str, request: Request):
        user = await actor(request)
        return await view_for(user, await load(iid))

    @r.get("/invoices/{iid}/pdf")
    async def invoice_pdf(iid: str, request: Request):
        user = await actor(request)
        if user["role"] == "client" and not (await load(iid)).get("releasedAt"):
            raise HTTPException(403, "Your invoice PDF is available once Nabitouch approves the final invoice")
        invoice = await load(iid)
        view = await view_for(user, invoice)
        if view["state"] == "draft":
            raise HTTPException(409, "Issue the invoice before downloading it")
        payload = brand_invoice_pdf(view, await settings())
        filename = (view["number"] or "invoice") + ".pdf"
        return Response(payload, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    async def can_list(user, client_id):
        if user["role"] == "owner":
            return True
        if user["role"] == "desk":
            return await desk_can(user, "managePayments") or await desk_can(user, "viewInsuranceStatus")
        return user["role"] == "client" and (not client_id or client_id == user.get("subject"))

    @r.get("/invoices")
    async def list_invoices(request: Request, clientId: str = "", state: str = "", limit: int = 50, skip: int = 0):
        user = await actor(request)
        if not await can_list(user, clientId):
            raise HTTPException(403, "Not permitted to list invoices")
        query = {}
        if user["role"] == "client":
            query["clientId"] = user.get("subject")
            query["state"] = {"$ne": "draft"}
        elif clientId:
            query["clientId"] = clientId
        if state:
            query["state"] = state
        limit = max(1, min(int(limit), 100))
        total = await db.nt_invoices.count_documents(query)
        rows = await db.nt_invoices.find(query, {"_id": 0}).sort([("serviceDate", -1), ("issueDate", -1)]).skip(max(0, int(skip))).limit(limit).to_list(limit)
        items = []
        for row in rows:
            view = public_invoice(row, await ledger_for(row["id"]), await claim_views(row["id"]))
            if user["role"] == "client":
                for claim in view["claims"]:
                    claim["notes"] = ""
                    claim["documents"] = [item for item in claim["documents"] if item["clientVisible"]]
            items.append(view)
        return {"items": items, "total": total, "limit": limit, "skip": skip}

    @r.get("/invoices/{iid}/receipt")
    async def receipt(iid: str, request: Request):
        user = await actor(request)
        if user["role"] == "client" and not (await load(iid)).get("releasedAt"):
            raise HTTPException(403, "Your invoice PDF is available once Nabitouch approves the final invoice")
        view = await view_for(user, await load(iid))
        if view["received"]["cents"] <= 0:
            raise HTTPException(409, "There is no confirmed payment to receipt yet")
        payload = brand_receipt_pdf(view, await settings())
        return Response(payload, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="receipt-{view["number"] or iid}.pdf"'})

    @r.post("/invoices/{iid}/email")
    async def email_invoice(iid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        invoice = await load(iid)
        view = await view_for(user, invoice)
        if user["role"] not in ("owner", "client") and not await desk_can(user, "managePayments"):
            raise HTTPException(403, "Not permitted to email this invoice")
        kind = body.get("kind") or "invoice"
        if kind not in ("invoice", "receipt", "payment_link"):
            raise HTTPException(400, "Unknown email type")
        if view["state"] in ("draft", "voided"):
            raise HTTPException(409, "Only an issued invoice can be emailed")
        if not invoice_email_enabled():
            raise HTTPException(503, "Invoice email is turned off")
        key = str(body.get("idempotencyKey") or "")
        if not 8 <= len(key) <= 80:
            raise HTTPException(400, "Idempotency key is required")
        note, created = await enqueue_billing(db, invoice, kind, key)
        if created:
            await add_audit(user.get("name") or "staff", f"{view['number']} {kind} email queued", invoice.get("appointmentId"))
        return {"queued": True, "status": note.get("status"), "delivered": False}

    @r.post("/invoices/{iid}/giftcard")
    async def redeem_giftcard(iid: str, request: Request):
        user = await actor(request)
        require_giftcards()
        body = await _body(request)
        invoice = await load(iid)
        view = await view_for(user, invoice)
        if user["role"] == "client":
            if view.get("clientId") != user.get("subject"):
                raise HTTPException(404, "Invoice not found")
        elif not (user["role"] == "owner" or await desk_can(user, "managePayments")):
            raise HTTPException(403, "Not permitted to apply a gift card")
        if invoice["state"] not in ("issued", "partially_paid"):
            raise HTTPException(409, "Only an issued invoice with a balance can take a gift card")
        amount = body.get("amountCents")
        if not isinstance(amount, int) or amount <= 0 or amount > view["balance"]["cents"]:
            raise HTTPException(400, "Amount must be positive and no more than the balance")
        key = str(body.get("idempotencyKey") or "")
        if not 8 <= len(key) <= 80:
            raise HTTPException(400, "Idempotency key is required")
        txn = await gift_debit(db, body.get("code"), amount, "gc:" + key, iid, user)
        if txn.get("status") != "completed":
            raise HTTPException(409, "This gift-card redemption is not complete")

        def build(current, lines):
            _received, balance, _state, _overdue = project(current, lines)
            if amount > balance:
                raise HTTPException(409, "That amount is more than the outstanding balance")
            return {"type": "client_payment", "method": "giftcard", "amountCents": amount, "reference": f"gift card ••{norm_code(body.get('code'))[-4:]}"}

        try:
            saved = await mutate(invoice, user, key, build)
        except HTTPException:
            if txn.get("status") == "completed" and not await db.nt_ledger.find_one({"idempotencyKey": key}):
                await gift_reverse(db, txn, "invoice payment not recorded")
            raise
        await sync_payment_due(saved)
        await notify_client(saved, "giftcard:" + key)
        return await view_for(user, saved)

    @r.post("/invoices/{iid}/issue")
    async def issue(iid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        if not (user["role"] == "owner" or await desk_can(user, "managePayments") or allowed(user, appt, "cash")):
            raise HTTPException(403, "Not permitted to issue this invoice")
        if invoice["state"] != "draft":
            return await view_for(user, invoice)

        def build(current, _lines):
            return {"type": "issue", "amountCents": 0, "method": None, "reference": None}

        issued = await mutate(invoice, user, body.get("idempotencyKey"), build)
        if not issued.get("number"):
            counter = await db.nt_counters.find_one_and_update(
                {"id": "invoice"}, {"$inc": {"n": 1}}, upsert=True, return_document=ReturnDocument.AFTER,
            )
            number = f"NT-INV-{int(counter['n']):05d}"
            due = (now().date() + timedelta(days=int((await settings()).get("billingTermsDays") or TERMS_DAYS))).isoformat()
            await db.nt_invoices.update_one(
                {"id": iid, "number": None},
                {"$set": {"number": number, "issueDate": now_iso(), "dueDate": due, "state": "issued"}},
            )
            issued = await load(iid)
        return await view_for(user, issued)

    @r.post("/invoices/{iid}/payments")
    async def record_payment(iid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        method = body.get("method")
        if method != "cash":
            raise HTTPException(400, "This endpoint records cash. Card and insurance use their own confirmation.")
        if user["role"] == "client":
            raise HTTPException(403, "Clients cannot confirm cash")
        if not (user["role"] == "owner" or await desk_can(user, "managePayments") or allowed(user, appt, "cash")):
            raise HTTPException(403, "Not permitted to record this payment")
        amount = body.get("amountCents")
        if not isinstance(amount, int) or amount <= 0:
            raise HTTPException(400, "Amount must be a positive number of cents")
        if invoice["state"] == "draft":
            raise HTTPException(409, "Issue the invoice before recording a payment")
        if invoice["state"] == "voided":
            raise HTTPException(409, "A voided invoice cannot take a payment")

        def build(current, lines):
            received, balance, _state, _overdue = project(current, lines)
            if amount > balance:
                raise HTTPException(409, "That payment is more than the outstanding balance")
            return {"type": "client_payment", "method": "cash", "amountCents": amount, "reference": body.get("reference")}

        saved = await mutate(invoice, user, body.get("idempotencyKey"), build)
        await sync_payment_due(saved)
        await notify_client(saved, "cash:" + str(body.get("idempotencyKey")))
        return await view_for(user, saved)

    @r.post("/invoices/{iid}/adjustments")
    async def adjust(iid: str, request: Request):
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can adjust an invoice")
        body = await _body(request)
        invoice = await load(iid)
        delta = body.get("netCents")
        if not isinstance(delta, int) or delta == 0:
            raise HTTPException(400, "Adjustment cents are required")
        if invoice["state"] in ("draft", "voided"):
            raise HTTPException(409, "Issue the invoice before adjusting it")
        reason = (body.get("reason") or "").strip()
        if len(reason) < 3:
            raise HTTPException(400, "A reason is required")

        def build(current, lines):
            received, balance, _state, _overdue = project(current, lines)
            if current["totalCents"] + delta < received:
                raise HTTPException(409, "Adjustment would hide money already received")
            return {"type": "credit" if delta < 0 else "adjustment", "method": "adjustment", "amountCents": abs(delta), "reference": reason}

        saved = await mutate(invoice, user, body.get("idempotencyKey"), build)
        await db.nt_invoices.update_one(
            {"id": iid},
            {"$inc": {"totalCents": delta}, "$push": {"lines": {"description": reason, "quantity": 1, "netCents": delta, "taxCode": "adjustment"}}},
        )
        saved = await load(iid)
        received, balance, state, _overdue = project(saved, await ledger_for(iid))
        await db.nt_invoices.update_one({"id": iid}, {"$set": {"state": state, "balanceCents": balance, "receivedCents": received}})
        return await view_for(user, await load(iid))

    @r.post("/invoices/{iid}/refunds")
    async def refund(iid: str, request: Request):
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can refund")
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        if settings.get("requireMfaForPrivileged") or settings.get("mfaEnforcePrivileged"):
            session = await db.nt_sessions.find_one({"sid": user.get("sid")}) if user.get("sid") else None
            if not session or not session.get("mfaAt"):
                raise HTTPException(403, "Confirm your authenticator before this action")
        body = await _body(request)
        invoice = await load(iid)
        amount = body.get("amountCents")
        payment_id = body.get("paymentId")
        if not isinstance(amount, int) or amount <= 0:
            raise HTTPException(400, "Refund cents are required")

        def build(current, lines):
            payment = next((line for line in lines if line["id"] == payment_id and line["type"] == "client_payment"), None)
            if not payment:
                raise HTTPException(404, "Payment not found")
            already = sum(line["amountCents"] for line in lines if line["type"] in ("refund", "reversal") and line.get("reference") == payment_id)
            if amount > payment["amountCents"] - already:
                raise HTTPException(409, "Refund exceeds the captured amount")
            return {"type": "refund", "method": payment.get("method"), "amountCents": amount, "reference": payment_id}

        saved = await mutate(invoice, user, body.get("idempotencyKey"), build)
        await sync_payment_due(saved)
        await notify_client(saved, "refund:" + str(body.get("idempotencyKey")))
        return await view_for(user, saved)

    @r.post("/invoices/{iid}/void")
    async def void(iid: str, request: Request):
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can void an invoice")
        body = await _body(request)
        invoice = await load(iid)

        def build(current, lines):
            received, _balance, _state, _overdue = project(current, lines)
            if received:
                raise HTTPException(409, "Refund recorded payments before voiding")
            return {"type": "void", "method": None, "amountCents": 0, "reference": (body.get("reason") or "void")[:160]}

        saved = await mutate(invoice, user, body.get("idempotencyKey"), build)
        return await view_for(user, saved)

    async def can_claim(user, appt):
        if user["role"] in ("owner",) or allowed(user, appt, "claim"):
            return True
        return await desk_can(user, "viewInsuranceStatus") or await desk_can(user, "managePayments")

    @r.post("/invoices/{iid}/claims")
    async def open_claim(iid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        if not await can_claim(user, appt):
            raise HTTPException(403, "Not permitted to record a claim")
        if invoice["state"] in ("draft", "voided"):
            raise HTTPException(409, "Issue the invoice before recording a claim")
        provider = body.get("provider")
        if provider not in PROVIDERS:
            raise HTTPException(400, "Choose a configured insurer")
        claimed = body.get("claimedCents")
        if not isinstance(claimed, int) or claimed < 0:
            raise HTTPException(400, "Claimed cents are required")
        claim = {
            "id": "clm-" + uuid.uuid4().hex[:12], "invoiceId": iid, "appointmentId": invoice.get("appointmentId"),
            "provider": provider, "reference": (body.get("reference") or "")[:80], "status": "submitted",
            "claimedCents": claimed, "approvedCents": 0, "notes": "", "createdAt": now_iso(), "by": user.get("name"),
        }
        await db.nt_claims.insert_one(dict(claim))
        await add_audit(user.get("name") or "staff", f"{invoice.get('number') or iid} claim submitted {provider}", invoice.get("appointmentId"))
        return await view_for(user, await load(iid))

    @r.post("/invoices/{iid}/claims/{cid}")
    async def update_claim(iid: str, cid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        claim = await db.nt_claims.find_one({"id": cid, "invoiceId": iid}, {"_id": 0})
        if not claim:
            raise HTTPException(404, "Claim not found")
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        if not await can_claim(user, appt):
            raise HTTPException(403, "Not permitted to update this claim")
        status = body.get("status")
        if status not in CLAIM_STATES:
            raise HTTPException(400, "Unknown claim status")
        approved = body.get("approvedCents", claim.get("approvedCents") or 0)
        if not isinstance(approved, int) or approved < 0:
            raise HTTPException(400, "Approved cents are required")
        if status == "approved":
            approved = claim.get("claimedCents") or approved
        if status == "partially_approved" and approved > (claim.get("claimedCents") or approved):
            raise HTTPException(409, "Approved coverage cannot exceed the claimed amount")
        if status in ("denied", "cancelled", "submitted", "pending"):
            approved = 0 if status in ("denied", "cancelled") else approved
        notes = body.get("notes")
        patch = {"status": status, "approvedCents": approved}
        if isinstance(notes, str):
            patch["notes"] = notes[:2000]
        await db.nt_claims.update_one({"id": cid}, {"$set": patch, "$push": {"history": {"status": status, "approvedCents": approved, "at": now_iso(), "by": user.get("name")}}})
        await refresh_expected(invoice["id"])
        await add_audit(user.get("name") or "staff", f"{invoice.get('number') or invoice['id']} claim {status}", invoice.get("appointmentId"))
        fresh = await load(invoice["id"])
        await notify_client(fresh, f"claim:{cid}:{status}:{approved}")
        return await view_for(user, fresh)

    @r.post("/invoices/{iid}/claims/{cid}/payments")
    async def insurer_payment(iid: str, cid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        claim = await db.nt_claims.find_one({"id": cid, "invoiceId": iid}, {"_id": 0})
        if not claim:
            raise HTTPException(404, "Claim not found")
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        if user["role"] == "client" or not await can_claim(user, appt):
            raise HTTPException(403, "Not permitted to record insurer money")
        if claim.get("status") not in ("approved", "partially_approved"):
            raise HTTPException(409, "Record an approval before an insurer payment")
        amount = body.get("amountCents")
        reference = (body.get("reference") or "").strip()
        if not isinstance(amount, int) or amount <= 0 or not reference:
            raise HTTPException(400, "Amount and a remittance reference are required")

        def build(current, lines):
            already = sum(line["amountCents"] for line in lines if line.get("type") == "insurance_receipt" and line.get("claimId") == cid)
            if amount > (claim.get("approvedCents") or 0) - already:
                raise HTTPException(409, "Insurer payment exceeds approved coverage still unpaid")
            _received, balance, _state, _overdue = project(current, lines)
            if amount > balance:
                raise HTTPException(409, "That payment is more than the outstanding balance")
            return {"type": "insurance_receipt", "method": "insurance", "amountCents": amount, "reference": reference, "claimId": cid, "paidOn": body.get("paidOn")}

        saved = await mutate(invoice, user, body.get("idempotencyKey"), build)
        await refresh_expected(saved["id"])
        fresh = await load(saved["id"])
        await notify_client(fresh, "remit:" + str(body.get("idempotencyKey")))
        return await view_for(user, fresh)

    @r.post("/invoices/{iid}/claims/{cid}/documents")
    async def claim_document(iid: str, cid: str, request: Request, upload: UploadFile = File(...), client_visible: str = Form("false")):
        from config import document_uploads_enabled
        if not document_uploads_enabled():
            raise HTTPException(403, "Document uploads are turned off")
        user = await actor(request)
        claim = await db.nt_claims.find_one({"id": cid, "invoiceId": iid}, {"_id": 0})
        if not claim:
            raise HTTPException(404, "Claim not found")
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        if not await can_claim(user, appt):
            raise HTTPException(403, "Not permitted to attach a report")
        data = await upload.read()
        if len(data) > 8 * 1024 * 1024:
            raise HTTPException(413, "File is too large")
        if data.startswith(b"%PDF"):
            mime = "application/pdf"
        elif data.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        elif data.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
        else:
            raise HTTPException(400, "Only PDF, JPEG, and PNG files are accepted")
        file_id = "file-" + uuid.uuid4().hex[:12]
        raw_name = os.path.basename(upload.filename or "report")
        safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in raw_name)[:80] or "report"
        await db.nt_files.insert_one({
            "id": file_id, "claimId": cid, "invoiceId": invoice["id"], "name": safe_name,
            "mime": mime, "size": len(data), "clientVisible": str(client_visible).lower() in ("1", "true", "yes"),
            "data": seal_bytes(data), "at": now_iso(), "by": user.get("name"), "scanStatus": "quarantined",
            "quarantined": True, "retentionDays": 2555, "public": False,
        })
        await add_audit(user.get("name") or "staff", f"{invoice.get('number') or invoice['id']} insurance report attached", invoice.get("appointmentId"))
        return await view_for(user, invoice)

    @r.get("/billing/notices")
    async def list_notices(request: Request):
        user = await actor(request)
        rows = await db.nt_notices.find({"recipientId": user.get("subject"), "channel": {"$ne": "marketing"}}, {"_id": 0, "dedupeKey": 0}).sort("at", 1).to_list(50)
        return [{k: row[k] for k in ("id", "invoiceId", "kind", "title", "body", "emailSubject", "at") if k in row} for row in rows]

    @r.get("/billing/documents/{fid}")
    async def download_document(fid: str, request: Request):
        user = await actor(request)
        stored = await db.nt_files.find_one({"id": fid})
        if not stored:
            raise HTTPException(404, "Document not found")
        invoice = await load(stored["invoiceId"])
        await view_for(user, invoice)
        if user["role"] == "client" and not stored.get("clientVisible"):
            raise HTTPException(404, "Document not found")
        if stored.get("quarantined") or stored.get("scanStatus") not in ("signature-checked", "clean"):
            raise HTTPException(409, "This file stays in quarantine until a security check passes")
        try:
            payload = open_bytes(stored["data"])
        except RuntimeError:
            raise HTTPException(503, "This file cannot be opened until the encryption key is available")
        return Response(payload, media_type=stored["mime"], headers={"Content-Disposition": "attachment", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @r.post("/billing/documents/{fid}/scan")
    async def scan_document(fid: str, request: Request):
        user = await actor(request)
        stored = await db.nt_files.find_one({"id": fid})
        if not stored:
            raise HTTPException(404, "Document not found")
        invoice = await load(stored["invoiceId"])
        appt = await appointment(invoice["appointmentId"])
        if not await can_claim(user, appt):
            raise HTTPException(403, "Not permitted to review this file")
        try:
            payload = open_bytes(stored["data"])
            status = assess(payload)
        except RuntimeError:
            raise HTTPException(503, "This file cannot be opened until the encryption key is available")
        except ScannerUnavailable:
            raise HTTPException(503, "The file scanner is unavailable. The file stays in quarantine.")
        if status in ("rejected", "infected"):
            await db.nt_files.update_one({"id": fid}, {"$set": {"scanStatus": status, "quarantined": True}})
            raise HTTPException(422, "This file did not pass the security check and stays in quarantine")
        await db.nt_files.update_one({"id": fid}, {"$set": {"scanStatus": status, "quarantined": False, "scannedAt": now_iso()}})
        await add_audit(user.get("name") or "staff", f"{invoice.get('number') or invoice['id']} insurance report released from quarantine", invoice.get("appointmentId"))
        return {"scanStatus": status, "quarantined": False}

    def card_secret():
        return os.environ.get("STRIPE_WEBHOOK_SECRET") or _demo_webhook_secret

    @r.get("/billing/insurers")
    async def insurer_catalog(request: Request):
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can view insurer integrations")
        from insurers import catalog
        return {"providers": catalog()}

    @r.get("/billing/stripe/status")
    async def stripe_status(request: Request):
        await actor(request)
        key = os.environ.get("STRIPE_SECRET_KEY") or ""
        return {
            "configured": bool(key),
            "liveEnabled": key.startswith("sk_live"),
            "testKeyPresent": key.startswith("sk_test_"),
            "webhookConfigured": bool(card_secret()),
            "externalVerification": "not-run",
        }

    @r.get("/billing/reconciliation")
    async def reconciliation(request: Request):
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can reconcile the ledger")
        hello = await db.command("hello")
        mismatches = []
        async for invoice in db.nt_invoices.find({}, {"_id": 0}):
            lines = await ledger_for(invoice["id"])
            _received, balance, state, _overdue = project(invoice, lines)
            if invoice.get("state") == "draft":
                continue
            if invoice.get("balanceCents") != balance or invoice.get("state") != state:
                mismatches.append({"id": invoice["id"], "storedBalance": invoice.get("balanceCents"), "ledgerBalance": balance, "storedState": invoice.get("state"), "ledgerState": state})
        pending = await db.nt_ops.count_documents({"status": "pending"})
        return {
            "transactionMode": "replica-set" if hello.get("setName") else "standalone-journal",
            "replicaSet": bool(hello.get("setName")),
            "pendingOperations": pending,
            "mismatches": mismatches[:50],
        }

    @r.post("/billing/reconciliation/repair")
    async def repair(request: Request):
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can repair stored balances")
        repaired = 0
        async for invoice in db.nt_invoices.find({}, {"_id": 0}):
            if invoice.get("state") == "draft":
                continue
            lines = await ledger_for(invoice["id"])
            received, balance, state, _overdue = project(invoice, lines)
            if invoice.get("balanceCents") == balance and invoice.get("state") == state and invoice.get("receivedCents") == received:
                continue
            await db.nt_invoices.update_one({"id": invoice["id"]}, {"$set": {"balanceCents": balance, "receivedCents": received, "state": state}})
            repaired += 1
        return {"repaired": repaired}

    @r.post("/billing/stripe/signing-secret")
    async def set_signing_secret(request: Request):
        from config import demo_mode
        global _demo_webhook_secret
        if not demo_mode():
            raise HTTPException(404, "Not available")
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can set the signing secret")
        body = await _body(request)
        secret = body.get("secret") or ""
        if not isinstance(secret, str) or len(secret) < 16 or len(secret) > 80:
            raise HTTPException(400, "Signing secret is required")
        _demo_webhook_secret = secret
        return {"saved": True}

    @r.post("/invoices/{iid}/checkout")
    async def checkout(iid: str, request: Request):
        from config import payments_simulated, stripe_card_checkout_enabled
        if not stripe_card_checkout_enabled():
            raise HTTPException(503, "Card checkout is turned off")
        user = await actor(request)
        invoice = await load(iid)
        await view_for(user, invoice)
        if invoice["state"] in ("draft", "voided"):
            raise HTTPException(409, "Issue the invoice before checkout")
        body = await _body(request)
        received, balance, _state, _overdue = project(invoice, await ledger_for(iid))
        visit = await appointment(invoice["appointmentId"])
        settings = await db.nt_settings.find_one({"id": "app"}) or {}
        from config import is_production
        policy = resolve_payment_policy(
            settings.get("paymentPolicy"), production=is_production(),
            explicit=isinstance(settings.get("paymentPolicy"), dict) and bool(settings.get("paymentPolicy")),
        )
        amount = body.get("amountCents", balance)
        if visit.get("payNow") == "deposit" and "amountCents" not in body and received <= 0:
            try:
                amount = deposit_cents(int(invoice["totalCents"]), policy)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        if not isinstance(amount, int) or amount <= 0 or amount > balance:
            raise HTTPException(400, "Amount must be within the outstanding balance")
        if user["role"] == "client" and visit.get("payNow") in ("full", "deposit") and amount not in allowed_online_amounts(balance, policy, received):
            raise HTTPException(400, "That amount is not one of the amounts due")
        if user["role"] == "client":
            expected = min(int(invoice.get("expectedInsuranceCents") or 0), balance)
            share = balance - expected
            if "amountCents" not in body or amount > share:
                amount = share
            if amount <= 0:
                raise HTTPException(409, "The remaining balance is expected from insurance")
        tip = body.get("tipCents") or 0
        if not isinstance(tip, int) or tip < 0 or tip > min(20000, int(invoice["totalCents"])):
            raise HTTPException(400, "Tip must be between $0 and the invoice total (max $200)")
        key = os.environ.get("STRIPE_SECRET_KEY") or ""
        session_id = None
        hosted_url = None
        if key.startswith("sk_live"):
            raise HTTPException(503, "Live card checkout is not enabled")
        if key.startswith("sk_test_"):
            import httpx
            from config import public_base_url
            app_url = public_base_url(request)
            form = {
                "mode": "payment",
                "success_url": app_url + "/me/billing?card=return&session_id={CHECKOUT_SESSION_ID}",
                "cancel_url": app_url + "/me/billing?card=cancel",
                "line_items[0][quantity]": "1",
                "line_items[0][price_data][currency]": "cad",
                "line_items[0][price_data][unit_amount]": str(amount),
                "line_items[0][price_data][product_data][name]": invoice.get("number") or "Nabitouch invoice",
                "metadata[invoiceId]": iid,
            }
            if tip:
                form.update({"line_items[1][quantity]": "1", "line_items[1][price_data][currency]": "cad", "line_items[1][price_data][unit_amount]": str(tip),
                             "line_items[1][price_data][product_data][name]": "Tip for your practitioner (100% passed through)"})
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post("https://api.stripe.com/v1/checkout/sessions", auth=(key, ""), data=form)
            if resp.status_code >= 400:
                raise HTTPException(502, "Card checkout could not be started")
            created = resp.json()
            session_id = created.get("id")
            hosted_url = created.get("url")
            if not session_id:
                raise HTTPException(502, "Card checkout could not be started")
        elif payments_simulated():
            session_id = "cs_test_" + uuid.uuid4().hex[:16]
        else:
            raise HTTPException(503, "Card checkout is not configured")
        await db.nt_checkouts.insert_one({
            "id": "chk-" + uuid.uuid4().hex[:12], "invoiceId": iid, "sessionId": session_id,
            "amountCents": amount, "tipCents": tip, "chargeCents": amount + tip, "practitionerId": invoice.get("practitionerId"),
            "createdBy": user.get("role"), "status": "pending", "at": now_iso(),
            "expiresAt": (now() + timedelta(minutes=CHECKOUT_HOLD_MINUTES)).isoformat(),
        })
        return {"confirmed": False, "sessionId": session_id, "url": hosted_url, "amount": money_view(amount), "tip": money_view(tip)}

    @r.post("/invoices/{iid}/release")
    async def release_invoice(iid: str, request: Request):
        user = await actor(request)
        if not (user["role"] == "owner" or await desk_can(user, "managePayments")):
            raise HTTPException(403, "Not permitted to release invoices")
        invoice = await load(iid)
        _received, balance, state, _overdue = project(invoice, await ledger_for(iid))
        if state != "paid" or balance > 0:
            raise HTTPException(409, "Release the final invoice once it is paid in full")
        if not invoice.get("releasedAt"):
            await db.nt_invoices.update_one({"id": iid}, {"$set": {"releasedAt": now_iso(), "releasedBy": user.get("name")}})
            await add_audit(user.get("name") or "staff", f"{invoice.get('number')} final invoice released to client", invoice.get("appointmentId"))
        return await view_for(user, await load(iid))

    @r.post("/invoices/{iid}/tip")
    async def record_tip(iid: str, request: Request):
        user = await actor(request)
        if not (user["role"] == "owner" or await desk_can(user, "managePayments")):
            raise HTTPException(403, "Not permitted to record tips")
        invoice = await load(iid)
        if invoice["state"] in ("draft", "voided"):
            raise HTTPException(409, "Tips can be recorded on issued invoices only")
        body = await _body(request)
        amount = body.get("amountCents")
        if not isinstance(amount, int) or not 0 < amount <= 20000:
            raise HTTPException(400, "Tip must be between $0.01 and $200")
        if body.get("method") not in ("cash", "etransfer"):
            raise HTTPException(400, "Record a cash or verified e-Transfer tip")
        key = str(body.get("idempotencyKey") or "")
        if not 8 <= len(key) <= 80:
            raise HTTPException(400, "Idempotency key is required")
        try:
            await db.nt_tips.insert_one({"id": "tip-" + uuid.uuid4().hex[:10], "invoiceId": iid, "practitionerId": invoice.get("practitionerId"), "amountCents": amount,
                                         "method": body["method"], "reference": str(body.get("reference") or "")[:80], "idempotencyKey": key, "at": now_iso(), "actorName": user.get("name")})
        except DuplicateKeyError:
            pass
        await add_audit(user.get("name") or "staff", f"{invoice.get('number')} tip {money_view(amount)['display']} recorded", invoice.get("appointmentId"))
        return {"recorded": True}

    @r.get("/billing/stripe/return")
    async def stripe_return(request: Request, session_id: str = ""):
        """Webhook fallback: confirm a returning checkout directly with Stripe. Settlement is idempotent."""
        user = await actor(request)
        row = await db.nt_checkouts.find_one({"sessionId": session_id}, {"_id": 0}) if session_id else None
        if not row:
            return {"confirmed": False}
        if user["role"] == "client":
            owner_id = row.get("clientId") or (await db.nt_invoices.find_one({"id": row.get("invoiceId")}, {"_id": 0, "clientId": 1}) or {}).get("clientId") if row.get("invoiceId") else (await db.nt_giftcards.find_one({"id": row.get("giftCardId")}, {"_id": 0, "purchaserId": 1}) or {}).get("purchaserId")
            if owner_id != user.get("subject"):
                return {"confirmed": False}
        if row.get("status") == "paid":
            return {"confirmed": True}
        key = os.environ.get("STRIPE_SECRET_KEY") or ""
        if not key.startswith("sk_test_"):
            return {"confirmed": False}
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"https://api.stripe.com/v1/checkout/sessions/{session_id}", auth=(key, ""))
        session = resp.json() if resp.status_code < 400 else {}
        if session.get("payment_status") != "paid":
            return {"confirmed": False}
        result = await process_event({"id": "poll-" + session_id, "type": "checkout.session.completed", "data": {"object": session}})
        return {"confirmed": bool(result.get("settled"))}

    @r.post("/billing/stripe/webhook")
    @r.post("/stripe/webhook")
    async def stripe_webhook(request: Request):
        payload = await request.body()
        secret = card_secret()
        if not secret:
            raise HTTPException(503, "Card webhook is not configured")
        if not stripe_signature_matches(payload, request.headers.get("stripe-signature") or "", secret):
            raise HTTPException(400, "Invalid signature")
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            raise HTTPException(400, "Invalid event")
        return await process_event(event)

    async def process_event(event):
        event_id = str(event.get("id") or "")
        if len(event_id) < 8:
            raise HTTPException(400, "Event id is required")
        kind = event.get("type")
        obj = ((event.get("data") or {}).get("object") or {})
        if kind == "checkout.session.expired":
            expired = await db.nt_checkouts.find_one_and_update(
                {"sessionId": obj.get("id"), "status": "pending"}, {"$set": {"status": "expired"}}, return_document=ReturnDocument.AFTER,
            )
            review = False
            if expired and expired.get("invoiceId"):
                invoice = await db.nt_invoices.find_one({"id": expired["invoiceId"]}, {"_id": 0})
                visit = await coll("appointments").find_one({"id": (invoice or {}).get("appointmentId")}, {"_id": 0}) if invoice else None
                received = 0
                if invoice:
                    received, _balance, _state, _overdue = project(invoice, await ledger_for(invoice["id"]))
                status = review_after_expiry((visit or {}).get("payNow"), received)
                if status and visit:
                    review = True
                    await coll("appointments").update_one(
                        {"id": visit["id"], "paymentDue.status": {"$in": ["deposit_pending", "payment_required"]}},
                        {"$set": {"paymentDue.status": status}},
                    )
                    await add_audit("Stripe", f"{visit.get('ref') or visit['id']} card checkout expired and needs review", visit["id"])
            return {"received": True, "settled": False, "review": review}
        if kind in ("invoice.paid", "customer.subscription.updated", "customer.subscription.deleted"):
            return await plan_subscription_event(db, kind, obj, add_audit)
        if kind not in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
            return {"received": True, "settled": False}
        if obj.get("payment_status") != "paid":
            return {"received": True, "settled": False}
        checkout_row = await db.nt_checkouts.find_one({"sessionId": obj.get("id")})
        if not checkout_row:
            return {"received": True, "settled": False}
        action = checkout_event_action(checkout_row.get("status"), obj.get("amount_total"), checkout_row.get("chargeCents", checkout_row["amountCents"]))
        if action == "reject":
            raise HTTPException(409, "Checkout amount does not match the invoice")
        if action == "duplicate":
            return {"received": True, "settled": True}
        if action != "settle":
            return {"received": True, "settled": False}
        if checkout_row.get("planPurchaseId"):
            settled = await plan_settle(db, checkout_row, obj, event_id, add_audit)
            if settled:
                await db.nt_checkouts.update_one({"id": checkout_row["id"]}, {"$set": {"status": "paid", "eventId": event_id}})
            return {"received": True, "settled": settled}
        if checkout_row.get("giftCardId"):
            settled = await gift_activate_paid(db, checkout_row, event_id)
            if settled:
                await db.nt_checkouts.update_one({"id": checkout_row["id"]}, {"$set": {"status": "paid", "eventId": event_id}})
                await add_audit("Stripe", f"Gift card checkout {checkout_row['sessionId']} paid")
            return {"received": True, "settled": settled}
        invoice = await load(checkout_row["invoiceId"])

        def build(current, lines):
            _received, due, _state, _overdue = project(current, lines)
            if checkout_row["amountCents"] > due:
                raise HTTPException(409, "That payment is more than the outstanding balance")
            return {"type": "client_payment", "method": "stripe", "amountCents": checkout_row["amountCents"], "reference": checkout_row["sessionId"]}

        try:
            saved = await mutate(invoice, {"name": "Stripe", "role": "owner"}, "stripe-" + str(obj.get("id"))[:70], build)
        except HTTPException as exc:
            if exc.status_code == 409:
                return {"received": True, "settled": False}
            raise
        await db.nt_checkouts.update_one({"id": checkout_row["id"]}, {"$set": {"status": "paid", "eventId": event_id}})
        if checkout_row.get("tipCents"):
            try:
                await db.nt_tips.insert_one({"id": "tip-" + uuid.uuid4().hex[:10], "invoiceId": invoice["id"], "practitionerId": checkout_row.get("practitionerId") or invoice.get("practitionerId"),
                                             "amountCents": checkout_row["tipCents"], "method": "stripe", "reference": checkout_row["sessionId"], "idempotencyKey": "stripe-tip-" + str(obj.get("id"))[:60], "at": now_iso()})
            except DuplicateKeyError:
                pass
        await sync_payment_due(saved)
        await notify_client(saved, "stripe:" + event_id)
        return {"received": True, "settled": True}

    @r.put("/billing/etransfer")
    async def save_etransfer(request: Request):
        user = await actor(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can set e-Transfer instructions")
        body = await _body(request)
        email = (body.get("recipientEmail") or "").strip()
        name = (body.get("recipientName") or "").strip()
        instructions = (body.get("instructions") or "").strip()
        reference_format = (body.get("referenceFormat") or "Invoice {number}").strip()
        if "@" not in email or len(name) < 2 or len(instructions) < 3:
            raise HTTPException(400, "Recipient email, name, and instructions are required")
        saved = {"id": "etransfer", "recipientEmail": email[:120], "recipientName": name[:80], "instructions": instructions[:500], "referenceFormat": reference_format[:80]}
        await db.nt_billing_config.update_one({"id": "etransfer"}, {"$set": saved}, upsert=True)
        return {k: saved[k] for k in ("recipientEmail", "recipientName", "instructions", "referenceFormat")}

    @r.get("/billing/etransfer")
    async def read_etransfer(request: Request):
        await actor(request)
        saved = await db.nt_billing_config.find_one({"id": "etransfer"}, {"_id": 0}) or {}
        return {k: saved.get(k) or "" for k in ("recipientEmail", "recipientName", "instructions", "referenceFormat")}

    @r.post("/invoices/{iid}/etransfer-notice")
    async def report_transfer(iid: str, request: Request):
        user = await actor(request)
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        if user["role"] != "client" or user.get("subject") != appt.get("clientId"):
            raise HTTPException(403, "Only the client can report a transfer")
        body = await _body(request)

        def build(current, _lines):
            return {"type": "transfer_reported", "method": "etransfer", "amountCents": 0, "reference": "client-reported"}

        saved = await mutate(invoice, user, body.get("idempotencyKey"), build)
        return await view_for(user, saved)

    @r.post("/invoices/{iid}/etransfer")
    async def confirm_transfer(iid: str, request: Request):
        user = await actor(request)
        body = await _body(request)
        invoice = await load(iid)
        appt = await appointment(invoice["appointmentId"])
        if user["role"] == "client" or not (user["role"] == "owner" or await desk_can(user, "managePayments") or allowed(user, appt, "cash")):
            raise HTTPException(403, "Not permitted to confirm this transfer")
        amount = body.get("amountCents")
        if not isinstance(amount, int) or amount <= 0:
            raise HTTPException(400, "Amount must be a positive number of cents")

        def build(current, lines):
            _received, due, _state, _overdue = project(current, lines)
            if amount > due:
                raise HTTPException(409, "That payment is more than the outstanding balance")
            return {"type": "client_payment", "method": "etransfer", "amountCents": amount, "reference": (body.get("reference") or "")[:80]}

        saved = await mutate(invoice, user, body.get("idempotencyKey"), build)
        await notify_client(saved, "etransfer:" + str(body.get("idempotencyKey")))
        return await view_for(user, saved)

    return r
