"""Synthetic integration regressions, NOT external Stripe acceptance evidence."""
import hashlib
import hmac
import json
import os
import time
import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from motor.motor_asyncio import AsyncIOMotorClient

import billing
from finance import build_finance_router
from stripe_gateway import validate_stripe_env
from test_smart_intake_turnaround import DB


@pytest.fixture
def sandbox(monkeypatch):
    monkeypatch.setenv("PAYMENT_MODE", "test")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_synthetic_fixture")
    monkeypatch.setenv("STRIPE_CARD_CHECKOUT_ENABLED", "true")
    monkeypatch.setenv("EMAIL_PROVIDER", "disabled")
    mid = uuid.uuid4().hex
    iid, aid, sid, pi = "inv-" + mid, "appt-" + mid, "cs_test_fixture_" + mid, "pi_fixture_" + mid
    DB.nt_invoices.insert_one({"id": iid, "number": iid, "appointmentId": aid, "state": "issued", "version": 0, "totalCents": 10080, "balanceCents": 10080, "receivedCents": 0, "clientId": "synthetic-client", "serviceDate": "2026-10-16", "lines": []})
    DB.nt_appointments.insert_one({"id": aid, "clientId": "synthetic-client", "payNow": "deposit", "paymentDue": {"status": "deposit_pending", "totalCents": 10080, "dueNowCents": 2520, "remainingCents": 7560, "paidCents": 0}})
    motor = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = motor[os.environ["DB_NAME"]]
    calls = []
    remote_status = "open"

    async def provider(method, path, **kwargs):
        nonlocal remote_status
        calls.append((method, path, kwargs))
        if path == "checkout/sessions":
            return {"id": sid, "url": "https://checkout.stripe.com/c/pay/synthetic", "livemode": False}
        if path == "refunds":
            return {"id": "re_fixture_" + mid, "status": "succeeded", "livemode": False}
        if method == "GET" and path.startswith("checkout/sessions/"):
            return {"id": sid, "status": remote_status, "payment_status": "unpaid", "livemode": False}
        if method == "POST" and path.endswith("/expire"):
            remote_status = "expired"
            return {"id": sid, "status": "expired", "payment_status": "unpaid", "livemode": False}
        raise AssertionError("Unexpected provider request: " + path)

    monkeypatch.setattr(billing, "stripe_request", provider)
    async def user(_request):
        return {"role": _request.headers.get("x-fixture-role", "owner"), "name": "Synthetic owner", "subject": "synthetic-client"}
    async def audit(*_args):
        pass
    @asynccontextmanager
    async def lifespan(_app):
        await billing.ensure_billing(db)
        yield
        motor.close()
    app = FastAPI(lifespan=lifespan)
    app.include_router(billing.build_billing_router(db, lambda name: db["nt_" + name], audit, user))
    async def settings():
        return {}
    app.include_router(build_finance_router(db, user, settings))
    with TestClient(app) as client:
        yield client, iid, aid, sid, pi, calls


def event(client, kind, obj, eid=None, live=False):
    payload = json.dumps({"id": eid or "evt_fixture_" + uuid.uuid4().hex, "livemode": live, "type": kind, "data": {"object": obj}}).encode()
    stamp = str(int(time.time()))
    signature = hmac.new(os.environ["STRIPE_WEBHOOK_SECRET"].encode(), stamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
    return client.post("/api/stripe/webhook", content=payload, headers={"stripe-signature": f"t={stamp},v1={signature}"})


def start(sandbox, amount=2520):
    client, iid, aid, sid, pi, calls = sandbox
    result = client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": amount})
    assert result.status_code == 200, result.text
    return {"id": sid, "payment_intent": pi, "amount_total": amount, "currency": "cad", "payment_status": "paid", "metadata": {"invoiceId": iid}}


@pytest.mark.parametrize("amount", [2520])
def test_hosted_checkout_server_amount_and_duplicate_submission(sandbox, amount):
    client, iid, aid, sid, pi, calls = sandbox
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": 10080}).status_code == 400
    start(sandbox, amount)
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": amount}).status_code == 200
    assert len(calls) == 1
    form = calls[0][2]["data"]
    assert form["line_items[0][price_data][unit_amount]"] == str(amount)
    assert form["line_items[0][price_data][currency]"] == "cad"
    assert form["integration_identifier"] == "nabitouch_qlagoonx"
    assert calls[0][2]["idempotency_key"].startswith("checkout-")
    assert "customer_email" not in form and "receipt_email" not in form
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": 10081}).status_code == 400
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": True}).status_code == 400
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": amount, "tipCents": 100}).status_code == 409


def test_browser_return_cannot_settle(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    start(sandbox)
    assert client.get("/api/billing/stripe/return", params={"session_id": sid}).json()["confirmed"] is False
    assert len(calls) == 2 and calls[-1][0] == "GET"
    assert DB.nt_ledger.count_documents({"invoiceId": iid}) == 0


def test_provider_paid_return_remains_pending_until_signed_webhook(sandbox, monkeypatch):
    client, iid, aid, sid, pi, calls = sandbox
    start(sandbox)
    async def paid(*args, **kwargs):
        return {"id": sid, "status": "complete", "payment_status": "paid", "payment_intent": pi, "livemode": False}
    monkeypatch.setattr(billing, "stripe_request", paid)
    result = client.get("/api/billing/stripe/return", params={"session_id": sid, "success": "true"}).json()
    assert result["status"] == "pending" and result["confirmed"] is False
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "client_payment"}) == 0


def test_explicit_authenticated_checkout_cancellation_never_cancels_appointment(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    start(sandbox)
    result = client.post(f"/api/billing/stripe/checkout/{sid}/cancel", json={})
    assert result.status_code == 200 and result.json()["status"] == "cancelled"
    assert DB.nt_appointments.find_one({"id": aid})["paymentDue"]["status"] == "deposit_pending"
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "client_payment"}) == 0
    expiry_calls = [call for call in calls if call[0] == "POST" and call[1].endswith("/expire")]
    assert len(expiry_calls) == 1 and expiry_calls[0][2]["idempotency_key"].startswith("expire-")


def test_result_endpoint_enforces_invoice_ownership_and_paid_ledger(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    start(sandbox)
    DB.nt_invoices.update_one({"id": iid}, {"$set": {"clientId": "another-client"}})
    DB.nt_appointments.update_one({"id": aid}, {"$set": {"clientId": "another-client"}})
    result = client.get("/api/billing/stripe/return", params={"session_id": sid}, headers={"x-fixture-role": "client"})
    assert result.status_code == 404
    DB.nt_checkouts.update_one({"sessionId": sid}, {"$set": {"status": "paid"}})
    assert client.get("/api/billing/stripe/return", params={"session_id": sid}).status_code == 503


def test_void_after_verified_refund_closes_appointment_balance(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    obj = start(sandbox)
    assert event(client, "checkout.session.completed", obj).status_code == 200
    refund = {"id": "re_void_" + uuid.uuid4().hex, "payment_intent": pi, "status": "succeeded", "currency": "cad", "amount": 2520}
    assert event(client, "refund.updated", refund).status_code == 200
    result = client.post(f"/api/invoices/{iid}/void", json={"idempotencyKey": uuid.uuid4().hex})
    assert result.status_code == 200 and result.json()["state"] == "voided"
    assert result.json()["balance"]["cents"] == 0
    due = DB.nt_appointments.find_one({"id": aid})["paymentDue"]
    assert due["remainingCents"] == 0 and due["refundedCents"] == 2520 and due["status"] == "refunded"


def test_expiry_failure_late_success_replay_and_refund(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    obj = start(sandbox)
    for kind in ("checkout.session.async_payment_failed", "checkout.session.expired"):
        assert event(client, kind, obj).status_code == 200
    assert DB.nt_appointments.find_one({"id": aid})["paymentDue"]["status"] == "payment_failed"
    assert event(client, "checkout.session.completed", {**obj, "payment_status": "unpaid"}).json()["settled"] is False
    eid = "evt_fixture_" + uuid.uuid4().hex
    for _ in range(2):
        assert event(client, "checkout.session.async_payment_succeeded", obj, eid).json()["settled"] is True
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "client_payment"}) == 1
    assert DB.nt_stripe_events.find_one({"id": eid})["deliveries"] == 2
    payment = DB.nt_ledger.find_one({"invoiceId": iid, "type": "client_payment"})
    body = {"amountCents": 1000, "paymentId": payment["id"], "idempotencyKey": uuid.uuid4().hex}
    refund = client.post(f"/api/invoices/{iid}/refunds", json=body)
    assert refund.status_code == 200 and refund.json()["refundPendingWebhook"] is True
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "refund"}) == 0
    robj = {"id": refund.json()["stripeRefundId"], "payment_intent": pi, "amount": 1000, "currency": "cad", "status": "pending"}
    assert event(client, "refund.created", robj).json()["settled"] is False
    for _ in range(2):
        assert event(client, "refund.updated", {**robj, "status": "succeeded"}).json()["settled"] is True
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "refund"}) == 1
    invoice = client.get(f"/api/invoices/{iid}").json()
    assert invoice["received"]["cents"] == 1520 and invoice["balance"]["cents"] == 8560
    report = client.get("/api/finance/reports/earnings", params={"start": "2026-10-16", "end": "2026-10-16", "limit": 200}).json()
    header = report["headers"]
    matching = next(row for row in report["rows"] if row[header.index("Invoice")] == iid)
    assert matching[header.index("Collected")] == "$15.20"
    assert matching[header.index("Balance")] == "$85.60"
    assert DB.nt_appointments.find_one({"id": aid})["paymentDue"]["refundedCents"] == 1000
    assert client.post(f"/api/invoices/{iid}/refunds", json=body).status_code == 200
    assert len(calls) == 2  # checkout + one real-refund API boundary
    assert DB.nt_notices.count_documents({"invoiceId": iid}) == 0
    assert event(client, "checkout.session.expired", obj).status_code == 200
    assert DB.nt_checkouts.find_one({"sessionId": sid})["status"] == "paid"


def test_reject_mismatch_live_event_unknown_checkout_and_refund_before_capture(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    obj = start(sandbox)
    for changed in ({"amount_total": 1}, {"currency": "usd"}, {"metadata": {"invoiceId": "wrong"}}):
        assert event(client, "checkout.session.completed", {**obj, **changed}).status_code == 409
    assert event(client, "checkout.session.completed", obj, live=True).status_code == 400
    assert event(client, "checkout.session.completed", {**obj, "id": "cs_test_unknown"}).status_code == 503
    # Unique Stripe refund id per run: ledger idempotency is stripe-refund-<id>, and
    # the shared acceptance Mongo retains prior synthetic rows across TestClient runs.
    refund = {
        "id": "re_early_" + uuid.uuid4().hex[:12],
        "payment_intent": pi,
        "amount": 1000,
        "currency": "cad",
        "status": "succeeded",
    }
    assert event(client, "refund.created", {**refund, "payment_intent": None}).status_code == 409
    assert event(client, "refund.created", refund).status_code == 503
    assert event(client, "checkout.session.completed", obj).json()["settled"] is True
    assert event(client, "refund.created", refund).json()["settled"] is True
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "refund", "stripeRefundId": refund["id"]}) == 1
    # Replay must not double-post the same Stripe refund onto the ledger.
    assert event(client, "refund.created", refund).json()["settled"] is True
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "refund", "stripeRefundId": refund["id"]}) == 1


def test_provider_refund_failure_cannot_change_ledger(sandbox, monkeypatch):
    client, iid, aid, sid, pi, calls = sandbox
    obj = start(sandbox)
    event(client, "checkout.session.completed", obj)
    payment = DB.nt_ledger.find_one({"invoiceId": iid, "type": "client_payment"})
    async def failure(*args, **kwargs):
        raise HTTPException(502, "Synthetic provider outage")
    monkeypatch.setattr(billing, "stripe_request", failure)
    assert client.post(f"/api/invoices/{iid}/refunds", json={"paymentId": payment["id"], "amountCents": 1000, "idempotencyKey": uuid.uuid4().hex}).status_code == 502
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "refund"}) == 0


def test_tip_refund_and_late_payment_do_not_uncancel_visit(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    # A late provider success is real money, even after a booking cancellation.
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": 2520, "tipCents": 100}).status_code == 200
    DB.nt_appointments.update_one({"id": aid}, {"$set": {"status": "cancelled"}})
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": 2520}).status_code == 409
    obj = {"id": sid, "payment_intent": pi, "payment_status": "paid", "amount_total": 2620, "currency": "cad"}
    assert event(client, "checkout.session.completed", obj).status_code == 200
    assert DB.nt_appointments.find_one({"id": aid})["status"] == "cancelled"
    refund = {"id": "re_tip_" + uuid.uuid4().hex, "payment_intent": pi, "status": "succeeded", "amount": 2620, "currency": "cad"}
    for _ in range(2):
        assert event(client, "refund.updated", refund).status_code == 200
    invoice = client.get(f"/api/invoices/{iid}").json()
    assert invoice["received"]["cents"] == 0 and invoice["refunded"]["cents"] == 2520
    assert sum(row["amountCents"] for row in DB.nt_tips.find({"invoiceId": iid})) == 0


def test_client_default_is_deposit_not_full_balance(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    original = DB.nt_settings.find_one({"id": "app"})
    try:
        DB.nt_settings.update_one({"id": "app"}, {"$set": {"paymentPolicy": {"mode": "choice", "depositPercent": 25, "depositType": "percent", "cashAccepted": True}}}, upsert=True)
        result = client.post(f"/api/invoices/{iid}/checkout", json={}, headers={"x-fixture-role": "client"})
        assert result.status_code == 200, result.text
        assert result.json()["amount"]["cents"] == 2520
        assert calls[0][2]["data"]["line_items[0][price_data][unit_amount]"] == "2520"
    finally:
        if original:
            DB.nt_settings.replace_one({"id": "app"}, original)
        else:
            DB.nt_settings.delete_one({"id": "app"})


@pytest.mark.parametrize("quote,total", [
    ({"base": 100, "discount": 5, "travel": 10, "tax": 5.25, "total": 110.25}, 11025),
    ({"base": 100, "discount": 100, "creditUnit": 80, "packageCredit": True, "travel": 10, "tax": .5, "total": 10.5}, 1050),
])
def test_checkout_uses_persisted_server_quote_gst_travel_discount_and_credit(sandbox, quote, total):
    client, iid, aid, sid, pi, calls = sandbox
    lines, net, tax, amount = billing.lines_from_pricing(quote)
    assert amount == total and net + tax == total
    DB.nt_invoices.update_one({"id": iid}, {"$set": {"lines": lines, "totalCents": total, "taxCents": tax}})
    DB.nt_appointments.update_one({"id": aid}, {"$set": {"payNow": "full", "paymentDue.dueNowCents": total, "paymentDue.totalCents": total}})
    assert client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": total, "totalCents": 1, "taxCents": 0, "discount": 999}).status_code == 200
    assert calls[0][2]["data"]["line_items[0][price_data][unit_amount]"] == str(total)


def test_settlement_recovers_followup_after_payment_marker(sandbox):
    client, iid, aid, sid, pi, calls = sandbox
    obj = start(sandbox)
    assert event(client, "checkout.session.completed", obj).status_code == 200
    DB.nt_ledger.update_one({"invoiceId": iid, "type": "client_payment"}, {"$set": {"idempotencyKey": "stripe-" + sid[:70]}})
    DB.nt_appointments.update_one({"id": aid}, {"$set": {"paymentDue.paidCents": 0}})
    assert event(client, "checkout.session.completed", obj).status_code == 200
    assert DB.nt_appointments.find_one({"id": aid})["paymentDue"]["paidCents"] == 2520
    assert DB.nt_ledger.count_documents({"invoiceId": iid, "type": "client_payment"}) == 1


def test_simultaneous_checkout_submissions_share_provider_request(sandbox):
    from concurrent.futures import ThreadPoolExecutor
    client, iid, aid, sid, pi, calls = sandbox
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post(f"/api/invoices/{iid}/checkout", json={"amountCents": 2520}), range(2)))
    assert all(result.status_code == 200 for result in results)
    assert len({result.json()["sessionId"] for result in results}) == 1
    assert len({call[2]["idempotency_key"] for call in calls}) == 1
    assert DB.nt_checkouts.count_documents({"invoiceId": iid}) == 1


@pytest.mark.parametrize("key", ["sk_live_synthetic", "rk_live_synthetic", "pk_test_synthetic"])
def test_reject_live_or_public_keys(monkeypatch, key):
    monkeypatch.setenv("STRIPE_SECRET_KEY", key)
    with pytest.raises(RuntimeError, match="sandbox/test"):
        validate_stripe_env()


def test_signature_rotation_and_replay_window():
    payload, secret = b"synthetic", "synthetic-signing-key"
    def sign(stamp):
        return hmac.new(secret.encode(), f"{stamp}.".encode() + payload, hashlib.sha256).hexdigest()
    stamp = int(time.time())
    assert billing.stripe_signature_matches(payload, f"t={stamp},v1=old,v1={sign(stamp)}", secret)
    assert not billing.stripe_signature_matches(payload, f"t={stamp-301},v1={sign(stamp-301)}", secret)
    assert not billing.stripe_signature_matches(payload, "t=invalid,v1=bad", secret)


def test_gateway_sends_version_auth_idempotency_and_redacts_errors(sandbox, monkeypatch):
    import asyncio
    import httpx
    import stripe_gateway
    seen = []
    def respond(request):
        seen.append(request)
        return httpx.Response(200, json={"id": "cs_test_fixture_gateway", "livemode": False})
    original = httpx.AsyncClient
    monkeypatch.setattr(stripe_gateway.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    result = asyncio.run(stripe_gateway.stripe_request("POST", "checkout/sessions", data={"mode": "payment"}, idempotency_key="fixture-stable-key"))
    assert result["livemode"] is False
    assert seen[0].url.host == "api.stripe.com"
    assert seen[0].headers["authorization"].startswith("Basic ")
    assert seen[0].headers["idempotency-key"] == "fixture-stable-key"
    assert seen[0].headers["stripe-version"] == stripe_gateway.API_VERSION
    def failure(request):
        return httpx.Response(401, json={"error": {"message": os.environ["STRIPE_SECRET_KEY"]}})
    monkeypatch.setattr(stripe_gateway.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(failure), **kwargs))
    with pytest.raises(HTTPException) as caught:
        asyncio.run(stripe_gateway.stripe_request("POST", "refunds", data={}, idempotency_key="fixture-refund-key"))
    assert caught.value.status_code == 502
    assert os.environ["STRIPE_SECRET_KEY"] not in caught.value.detail


@pytest.mark.parametrize("flag,value", [("EMAIL_PROVIDER", "resend"), ("PUSH_ENABLED", "true"), ("PAYMENT_MODE", "simulated"), ("STRIPE_WEBHOOK_SECRET", "")])
def test_sandbox_configuration_fails_closed(sandbox, monkeypatch, flag, value):
    monkeypatch.setenv(flag, value)
    with pytest.raises(RuntimeError):
        validate_stripe_env()
