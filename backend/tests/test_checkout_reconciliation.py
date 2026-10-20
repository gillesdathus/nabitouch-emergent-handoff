"""Signed synthetic Stripe events; no Stripe API requests or real payments."""
import uuid

import pytest

from booking_fixtures import book_appointment
from t1_common import API, BENV, OWNER, login, stripe_webhook
from pymongo import MongoClient

DB = MongoClient(BENV["MONGO_URL"])[BENV["DB_NAME"]]


def book(owner):
    return book_appointment(owner, API)


@pytest.mark.parametrize("kind,payment_status,settled", [
    ("checkout.session.completed", "unpaid", False),
    ("checkout.session.completed", None, False),
    ("checkout.session.completed", "no_payment_required", False),
    ("checkout.session.completed", "paid", True),
    ("checkout.session.async_payment_succeeded", "paid", True),
])
def test_signed_deposit_requires_payment_confirmation_and_settles_once(kind, payment_status, settled):
    owner = login(OWNER)
    appt = book(owner)
    draft = owner.post(f"{API}/invoices/from-appointment/{appt['id']}", json={}, timeout=20)
    assert draft.status_code == 200
    iid = draft.json()["id"]
    assert owner.post(f"{API}/invoices/{iid}/issue", json={"idempotencyKey": uuid.uuid4().hex}, timeout=20).status_code == 200
    session_id = "cs_test_synthetic_" + uuid.uuid4().hex
    DB.nt_checkouts.insert_one({"id": "chk-" + uuid.uuid4().hex, "invoiceId": iid, "sessionId": session_id,
        "amountCents": 2520, "chargeCents": 2520, "tipCents": 0, "status": "pending"})
    obj = {"id": session_id, "amount_total": 2520, "currency": "cad"}
    if payment_status is not None:
        obj["payment_status"] = payment_status
    event = {"id": "evt_synthetic_" + uuid.uuid4().hex, "livemode": False, "type": kind, "data": {"object": obj}}
    response = stripe_webhook(event)
    assert response.status_code == 200
    assert response.json()["settled"] is settled
    assert stripe_webhook(event).json()["settled"] is settled
    payments = list(DB.nt_ledger.find({"invoiceId": iid, "type": "client_payment"}))
    assert sum(row["amountCents"] for row in payments) == (2520 if settled else 0)
    assert len(payments) == int(settled)
    invoice = owner.get(f"{API}/invoices/{iid}", timeout=20).json()
    assert invoice["received"]["cents"] == (2520 if settled else 0)
    if settled:
        assert invoice["state"] == "partially_paid"
        receipt = owner.get(f"{API}/invoices/{iid}/receipt", timeout=20)
        assert receipt.status_code == 200 and receipt.content.startswith(b"%PDF")
