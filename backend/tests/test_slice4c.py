"""Slice 4C — billing notices stay generic and stay with the right client."""
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


def test_a_claim_update_notifies_only_that_client_without_insurer_details():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    liam = _login("liam.demo@example.com", _required("DEMO_PASSWORD"))
    booked = requests.post(f"{API}/bookings", headers=sarah, json={
        "source": "online", "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": f"2028-06-{(uuid.uuid4().int % 27) + 1:02d}", "time": "15:00",
            "locationType": "clinic", "paymentMethod": "insurance",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }, timeout=20)
    assert booked.status_code == 200, booked.text
    aid = booked.json()["appointment"]["id"]
    drafted = requests.post(f"{API}/invoices/from-appointment/{aid}", headers=owner, json={}, timeout=20).json()
    issued = requests.post(f"{API}/invoices/{drafted['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4c-" + uuid.uuid4().hex[:8]}, timeout=20)
    assert issued.status_code == 200, issued.text
    invoice = issued.json()
    opened = requests.post(f"{API}/invoices/{invoice['id']}/claims", headers=owner, json={"provider": "Canada Life", "claimedCents": invoice["balance"]["cents"]}, timeout=20)
    assert opened.status_code == 200, opened.text
    claim_id = opened.json()["claims"][0]["id"]
    approved = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}", headers=owner, json={"status": "approved", "approvedCents": invoice["balance"]["cents"]}, timeout=20)
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["balance"]["cents"] == invoice["balance"]["cents"]
    assert body["clientPaid"]["cents"] == 0
    assert body["insuranceReceived"]["cents"] == 0
    assert body["approved"]["cents"] == invoice["balance"]["cents"]
    again = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}", headers=owner, json={"status": "approved", "approvedCents": invoice["balance"]["cents"]}, timeout=20)
    assert again.status_code == 200
    notices = requests.get(f"{API}/billing/notices", headers=sarah, timeout=20)
    assert notices.status_code == 200, notices.text
    mine = [row for row in notices.json() if row["invoiceId"] == invoice["id"]]
    assert len(mine) == 1
    assert mine[0]["title"] == "Billing update"
    assert mine[0]["emailSubject"] == "Nabitouch billing update"
    blob = " ".join(mine[0].values())
    assert "Canada Life" not in blob and "$" not in blob
    other = requests.get(f"{API}/billing/notices", headers=liam, timeout=20)
    assert other.status_code == 200
    assert all(row["invoiceId"] != invoice["id"] for row in other.json())
    tag = uuid.uuid4().hex[:8]
    paid = requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}/payments", headers=owner, json={"idempotencyKey": "remit-4c-" + tag, "amountCents": min(1000, invoice["balance"]["cents"]), "reference": "C4-" + tag}, timeout=20)
    assert paid.status_code == 200, paid.text
    requests.post(f"{API}/invoices/{invoice['id']}/claims/{claim_id}/payments", headers=owner, json={"idempotencyKey": "remit-4c-" + tag, "amountCents": min(1000, invoice["balance"]["cents"]), "reference": "C4-" + tag}, timeout=20)
    after = [row for row in requests.get(f"{API}/billing/notices", headers=sarah, timeout=20).json() if row["invoiceId"] == invoice["id"]]
    assert len(after) == 2
