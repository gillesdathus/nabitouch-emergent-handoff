"""Slice 4F — ledger recovery, tax choice, and Stripe events that must not settle."""
import asyncio
import hashlib
import hmac
import json
import os
import time
import uuid

import requests
from motor.motor_asyncio import AsyncIOMotorClient

from pricing import quote

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


def test_exempt_service_tax_is_zero_and_the_default_stays_taxed():
    service = {"slug": "swedish", "prices": {"60": 100}}
    settings = {"gst": 0.05, "addons": []}
    taxed = quote(service=service, duration=60, addons=[], zone=None, client=None, promotions=[], settings=settings, location_type="clinic")
    exempt = quote(service={**service, "taxable": False}, duration=60, addons=[], zone=None, client=None, promotions=[], settings=settings, location_type="clinic")
    assert taxed["tax"] == 5.0
    assert exempt["tax"] == 0.0
    assert exempt["total"] == 100.0


def test_stored_balance_can_be_repaired_from_the_ledger_without_a_replica_set():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    status = requests.get(f"{API}/billing/stripe/status", headers=owner, timeout=20)
    assert status.status_code == 200, status.text
    body = status.json()
    assert body["externalVerification"] == "not-run"
    assert body["liveEnabled"] is False
    assert "sk_" not in json.dumps(body)
    booked = requests.post(f"{API}/bookings", headers=sarah, json={
        "source": "online", "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": f"2028-09-{(uuid.uuid4().int % 27) + 1:02d}", "time": "16:00",
            "locationType": "clinic", "paymentMethod": "self",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }, timeout=20)
    assert booked.status_code == 200, booked.text
    aid = booked.json()["appointment"]["id"]
    drafted = requests.post(f"{API}/invoices/from-appointment/{aid}", headers=owner, json={}, timeout=20).json()
    issued = requests.post(f"{API}/invoices/{drafted['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4f-" + uuid.uuid4().hex[:8]}, timeout=20).json()
    secret = "whsec_" + uuid.uuid4().hex
    assert requests.post(f"{API}/billing/stripe/signing-secret", headers=owner, json={"secret": secret}, timeout=20).status_code == 200
    first = requests.post(f"{API}/invoices/{issued['id']}/checkout", headers=sarah, json={}, timeout=20).json()
    second = requests.post(f"{API}/invoices/{issued['id']}/checkout", headers=sarah, json={}, timeout=20).json()
    assert first["confirmed"] is False and second["confirmed"] is False

    def event(kind, session_id, amount, event_id):
        payload = json.dumps({"id": event_id, "type": kind, "data": {"object": {"id": session_id, "amount_total": amount}}}).encode()
        response = requests.post(f"{API}/billing/stripe/webhook", data=payload, headers={"Content-Type": "application/json", "Stripe-Signature": _sign(secret, payload)}, timeout=20)
        return response

    expired = event("checkout.session.expired", second["sessionId"], second["amount"]["cents"], "evt_" + uuid.uuid4().hex[:12])
    assert expired.status_code == 200 and expired.json()["settled"] is False
    paid = event("checkout.session.completed", first["sessionId"], first["amount"]["cents"], "evt_" + uuid.uuid4().hex[:12])
    assert paid.status_code == 200 and paid.json()["settled"] is True
    over = event("checkout.session.completed", second["sessionId"], second["amount"]["cents"], "evt_" + uuid.uuid4().hex[:12])
    assert over.status_code in (200, 409)
    final = requests.get(f"{API}/invoices/{issued['id']}", headers=owner, timeout=20).json()
    assert final["balance"]["cents"] == 0
    assert final["clientPaid"]["cents"] == issued["total"]["cents"]

    async def corrupt():
        db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
        await db.nt_invoices.update_one({"id": issued["id"]}, {"$set": {"balanceCents": 1, "state": "issued"}})

    asyncio.run(corrupt())
    report = requests.get(f"{API}/billing/reconciliation", headers=owner, timeout=20)
    assert report.status_code == 200, report.text
    topology = report.json()
    assert topology["transactionMode"] == ("replica-set" if topology["replicaSet"] else "standalone-journal")
    assert any(row["id"] == issued["id"] for row in report.json()["mismatches"])
    repair = requests.post(f"{API}/billing/reconciliation/repair", headers=owner, timeout=20)
    assert repair.status_code == 200 and repair.json()["repaired"] >= 1
    again = requests.get(f"{API}/billing/reconciliation", headers=owner, timeout=20).json()
    assert all(row["id"] != issued["id"] for row in again["mismatches"])
    hidden = requests.get(f"{API}/billing/reconciliation", headers=sarah, timeout=20)
    assert hidden.status_code == 403


def test_upload_names_are_stored_safely_and_noterro_stays_unverified():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    booked = requests.post(f"{API}/bookings", headers=sarah, json={
        "source": "online", "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": f"2028-10-{(uuid.uuid4().int % 27) + 1:02d}", "time": "09:30",
            "locationType": "clinic", "paymentMethod": "insurance",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }, timeout=20)
    assert booked.status_code == 200, booked.text
    aid = booked.json()["appointment"]["id"]
    drafted = requests.post(f"{API}/invoices/from-appointment/{aid}", headers=owner, json={}, timeout=20).json()
    issued = requests.post(f"{API}/invoices/{drafted['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4f-doc-" + uuid.uuid4().hex[:8]}, timeout=20).json()
    opened = requests.post(f"{API}/invoices/{issued['id']}/claims", headers=owner, json={"provider": "Other", "claimedCents": 1000}, timeout=20).json()
    uploaded = requests.post(
        f"{API}/invoices/{issued['id']}/claims/{opened['claims'][0]['id']}/documents",
        headers=owner,
        files={"upload": ("../../secret.pdf", b"%PDF-1.4\n", "application/pdf")},
        timeout=20,
    )
    assert uploaded.status_code == 200, uploaded.text
    name = uploaded.json()["claims"][0]["documents"][0]["name"]
    assert "/" not in name and ".." not in name
    preview = requests.post(f"{API}/billing/imports/preview", headers=owner, files={"upload": ("history.csv", b"source_id,invoice_total_cents\nN1,100\n", "text/csv")}, timeout=20)
    assert preview.status_code == 200, preview.text
    assert preview.json()["sourceCompatibility"] == "unverified"
    assert "source_id" in preview.json()["expectedColumns"]
