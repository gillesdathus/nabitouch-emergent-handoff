"""Slice 4D — a card return is not payment, and a client transfer report is not payment."""
import hashlib
import hmac
import json
import os
import time
import uuid

import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def _sign(secret, body):
    stamp = str(int(time.time()))
    digest = hmac.new(secret.encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


def test_only_a_signed_checkout_event_reduces_the_balance():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    booked = requests.post(f"{API}/bookings", headers=sarah, json={
        "source": "online", "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": f"2028-08-{(uuid.uuid4().int % 27) + 1:02d}", "time": "11:00",
            "locationType": "clinic", "paymentMethod": "self",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }, timeout=20)
    assert booked.status_code == 200, booked.text
    aid = booked.json()["appointment"]["id"]
    drafted = requests.post(f"{API}/invoices/from-appointment/{aid}", headers=owner, json={}, timeout=20).json()
    issued = requests.post(f"{API}/invoices/{drafted['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4d-" + uuid.uuid4().hex[:8]}, timeout=20).json()
    total = issued["balance"]["cents"]
    too_much = requests.post(f"{API}/invoices/{issued['id']}/checkout", headers=sarah, json={"amountCents": total + 1}, timeout=20)
    assert too_much.status_code == 400
    started = requests.post(f"{API}/invoices/{issued['id']}/checkout", headers=sarah, json={"amountCents": min(2500, total)}, timeout=20)
    assert started.status_code == 200, started.text
    assert started.json()["confirmed"] is False
    amount = started.json()["amount"]["cents"]
    session_id = started.json()["sessionId"]
    returned = requests.get(f"{API}/billing/stripe/return", headers=sarah, timeout=20)
    assert returned.status_code == 200 and returned.json()["confirmed"] is False
    still = requests.get(f"{API}/invoices/{issued['id']}", headers=sarah, timeout=20).json()
    assert still["balance"]["cents"] == total
    unsigned = requests.post(f"{API}/billing/stripe/webhook", data=b"{}", headers={"Content-Type": "application/json", "Stripe-Signature": "t=1,v1=nope"}, timeout=20)
    assert unsigned.status_code in (400, 503)
    assert requests.get(f"{API}/invoices/{issued['id']}", headers=owner, timeout=20).json()["balance"]["cents"] == total
    secret = "whsec_" + uuid.uuid4().hex
    saved = requests.post(f"{API}/billing/stripe/signing-secret", headers=owner, json={"secret": secret}, timeout=20)
    assert saved.status_code == 200, saved.text
    denied = requests.post(f"{API}/billing/stripe/signing-secret", headers=sarah, json={"secret": secret}, timeout=20)
    assert denied.status_code == 403
    early = {"id": "evt_" + uuid.uuid4().hex[:12], "type": "payment_intent.succeeded", "data": {"object": {"id": session_id, "amount_total": amount}}}
    raw = json.dumps(early).encode()
    pending = requests.post(f"{API}/billing/stripe/webhook", data=raw, headers={"Content-Type": "application/json", "Stripe-Signature": _sign(secret, raw)}, timeout=20)
    assert pending.status_code == 200 and pending.json()["settled"] is False
    assert requests.get(f"{API}/invoices/{issued['id']}", headers=owner, timeout=20).json()["balance"]["cents"] == total
    wrong = {"id": "evt_" + uuid.uuid4().hex[:12], "type": "checkout.session.completed", "data": {"object": {"id": session_id, "amount_total": amount + 1}}}
    raw = json.dumps(wrong).encode()
    mismatch = requests.post(f"{API}/billing/stripe/webhook", data=raw, headers={"Content-Type": "application/json", "Stripe-Signature": _sign(secret, raw)}, timeout=20)
    assert mismatch.status_code == 409
    done = {"id": "evt_" + uuid.uuid4().hex[:12], "type": "checkout.session.completed", "data": {"object": {"id": session_id, "amount_total": amount}}}
    raw = json.dumps(done).encode()
    signature = _sign(secret, raw)
    settled = requests.post(f"{API}/billing/stripe/webhook", data=raw, headers={"Content-Type": "application/json", "Stripe-Signature": signature}, timeout=20)
    assert settled.status_code == 200 and settled.json()["settled"] is True
    paid = requests.get(f"{API}/invoices/{issued['id']}", headers=owner, timeout=20).json()
    assert paid["balance"]["cents"] == total - amount
    assert paid["clientPaid"]["cents"] == amount
    replay = requests.post(f"{API}/billing/stripe/webhook", data=raw, headers={"Content-Type": "application/json", "Stripe-Signature": signature}, timeout=20)
    assert replay.status_code == 200
    assert requests.get(f"{API}/invoices/{issued['id']}", headers=owner, timeout=20).json()["balance"]["cents"] == total - amount
    settings = requests.put(f"{API}/billing/etransfer", headers=owner, json={
        "recipientEmail": "pay@example.com", "recipientName": "Nabitouch", "instructions": "Send from your bank", "referenceFormat": "Invoice {number}",
    }, timeout=20)
    assert settings.status_code == 200, settings.text
    reported = requests.post(f"{API}/invoices/{issued['id']}/etransfer-notice", headers=sarah, json={"idempotencyKey": "sent-" + uuid.uuid4().hex[:8]}, timeout=20)
    assert reported.status_code == 200, reported.text
    assert reported.json()["clientReportedTransfer"] is True
    assert reported.json()["balance"]["cents"] == total - amount
    blocked = requests.post(f"{API}/invoices/{issued['id']}/etransfer", headers=sarah, json={"idempotencyKey": "econf-" + uuid.uuid4().hex[:8], "amountCents": 500}, timeout=20)
    assert blocked.status_code == 403
    rest = total - amount
    confirmed = requests.post(f"{API}/invoices/{issued['id']}/etransfer", headers=owner, json={"idempotencyKey": "econf-" + uuid.uuid4().hex[:8], "amountCents": min(500, rest), "reference": "ET-1"}, timeout=20)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["balance"]["cents"] == rest - min(500, rest)
    over = requests.post(f"{API}/invoices/{issued['id']}/payments", headers=owner, json={"idempotencyKey": "cash-" + uuid.uuid4().hex[:8], "method": "cash", "amountCents": confirmed.json()["balance"]["cents"] + 1}, timeout=20)
    assert over.status_code == 409
