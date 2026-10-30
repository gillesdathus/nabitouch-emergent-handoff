"""Slice 4B — insurer approval is not money received."""
import os
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


def _issued(owner, sarah, when):
    booked = requests.post(f"{API}/bookings", headers=sarah, json={
        "source": "online", "practitionerId": "p-nabitu-kahindo",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": f"2028-04-{(uuid.uuid4().int % 27) + 1:02d}", "time": when,
            "locationType": "clinic", "paymentMethod": "insurance",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }, timeout=20)
    assert booked.status_code == 200, booked.text
    aid = booked.json()["appointment"]["id"]
    drafted = requests.post(f"{API}/invoices/from-appointment/{aid}", headers=owner, json={}, timeout=20).json()
    issued = requests.post(f"{API}/invoices/{drafted['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4b-" + when + "-" + uuid.uuid4().hex[:8]}, timeout=20)
    assert issued.status_code == 200, issued.text
    return issued.json()


def test_approval_does_not_reduce_the_balance_until_money_arrives():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    liam = _login("liam.demo@example.com", _required("DEMO_PASSWORD"))
    invoice = _issued(owner, sarah, "09:00")
    total = invoice["balance"]["cents"]
    opened = requests.post(f"{API}/invoices/{invoice['id']}/claims", headers=owner, json={
        "provider": "Alberta Blue Cross", "reference": "ABC-100", "claimedCents": total,
    }, timeout=20)
    assert opened.status_code == 200, opened.text
    claim_id = opened.json()["claims"][0]["id"]
    blocked = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}", headers=sarah, json={"status": "approved", "approvedCents": total}, timeout=20)
    assert blocked.status_code == 403
    approved_cents = min(9000, total)
    first_cents = min(6000, approved_cents - 1)
    approved = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}", headers=owner, json={"status": "partially_approved", "approvedCents": approved_cents, "notes": "internal plan note"}, timeout=20)
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["balance"]["cents"] == total
    assert body["expectedInsurance"]["cents"] == approved_cents
    assert body["estimatedClientShare"]["cents"] == total - approved_cents
    assert body["claims"][0]["received"]["cents"] == 0
    client = requests.get(f"{API}/invoices/{invoice['id']}", headers=sarah, timeout=20).json()
    assert client["claims"][0]["notes"] == ""
    hidden = requests.get(f"{API}/invoices/{invoice['id']}", headers=liam, timeout=20)
    assert hidden.status_code == 404
    tag = uuid.uuid4().hex[:8]
    paid = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}/payments", headers=owner, json={"idempotencyKey": "remit-4b-" + tag, "amountCents": first_cents, "reference": "R-" + tag, "paidOn": "2027-12-04"}, timeout=20)
    assert paid.status_code == 200, paid.text
    assert paid.json()["balance"]["cents"] == total - first_cents
    assert paid.json()["expectedInsurance"]["cents"] == approved_cents - first_cents
    assert paid.json()["claims"][0]["received"]["cents"] == first_cents
    duplicate = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}/payments", headers=owner, json={"idempotencyKey": "remit-dup-" + tag, "amountCents": 1000, "reference": "R-" + tag}, timeout=20)
    assert duplicate.status_code == 409
    rest = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}/payments", headers=owner, json={"idempotencyKey": "remit-rest-" + tag, "amountCents": approved_cents - first_cents, "reference": "R2-" + tag}, timeout=20)
    assert rest.status_code == 200, rest.text
    assert rest.json()["expectedInsurance"]["cents"] == 0
    assert rest.json()["balance"]["cents"] == total - approved_cents
    report = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}/documents", headers=owner, files={"upload": ("eob.pdf", b"%PDF-1.4\n", "application/pdf")}, data={"client_visible": "false"}, timeout=20)
    assert report.status_code == 200, report.text
    file_id = report.json()["claims"][0]["documents"][0]["id"]
    hidden_doc = requests.get(f"{API}/billing/documents/{file_id}", headers=sarah, timeout=20)
    assert hidden_doc.status_code == 404
    held = requests.get(f"{API}/billing/documents/{file_id}", headers=owner, timeout=20)
    assert held.status_code == 409
    scanned = requests.post(f"{API}/billing/documents/{file_id}/scan", headers=owner, timeout=20)
    assert scanned.status_code == 200 and scanned.json()["quarantined"] is False
    owner_doc = requests.get(f"{API}/billing/documents/{file_id}", headers=owner, timeout=20)
    assert owner_doc.status_code == 200 and owner_doc.content.startswith(b"%PDF")
    denied_name = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}/documents", headers=owner, files={"upload": ("note.txt", b"hello", "text/plain")}, timeout=20)
    assert denied_name.status_code == 400


def test_a_denied_claim_leaves_the_client_balance():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    invoice = _issued(owner, sarah, "12:30")
    total = invoice["balance"]["cents"]
    opened = requests.post(f"{API}/invoices/{invoice['id']}/claims", headers=owner, json={"provider": "Sun Life", "claimedCents": 5000}, timeout=20).json()
    denied = requests.post(f"{API}/invoices/{invoice['id']}/claims/{opened['claims'][0]['id']}", headers=owner, json={"status": "denied", "notes": "not eligible"}, timeout=20)
    assert denied.status_code == 200, denied.text
    assert denied.json()["balance"]["cents"] == total
    assert denied.json()["expectedInsurance"]["cents"] == 0
    assert denied.json()["claims"][0]["documents"] == []
