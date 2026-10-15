"""Slice 4A — invoice ledger in integer cents."""
import os
from concurrent.futures import ThreadPoolExecutor

import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


BASE = _required("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"


def _login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    token = response.cookies.get("access_token")
    assert token
    return {"Authorization": f"Bearer {token}"}


def _book(headers, when):
    response = requests.post(f"{API}/bookings", headers=headers, json={
        "source": "online", "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": "2027-12-02", "time": when,
            "locationType": "clinic", "paymentMethod": "self",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }, timeout=20)
    assert response.status_code == 200, response.text
    return response.json()["appointment"]


def test_invoice_is_idempotent_partial_and_scoped():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    liam = _login("liam.demo@example.com", _required("DEMO_PASSWORD"))
    appt = _book(sarah, "09:00")
    total = int(round(float(appt["pricing"]["total"]) * 100))
    first = requests.post(f"{API}/invoices/from-appointment/{appt['id']}", headers=owner, json={"idempotencyKey": "draft-4a-1"}, timeout=20)
    second = requests.post(f"{API}/invoices/from-appointment/{appt['id']}", headers=owner, json={"idempotencyKey": "draft-4a-2"}, timeout=20)
    assert first.status_code == 200 and second.status_code == 200, first.text
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["state"] == "draft"
    assert first.json()["total"]["cents"] == total
    issued = requests.post(f"{API}/invoices/{first.json()['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4a-1"}, timeout=20)
    assert issued.status_code == 200, issued.text
    body = issued.json()
    assert body["number"].startswith("NT-INV-")
    assert body["state"] == "issued" and body["balance"]["cents"] == total
    again = requests.post(f"{API}/invoices/{body['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4a-2"}, timeout=20)
    assert again.json()["number"] == body["number"]
    half = total // 2
    paid = requests.post(f"{API}/invoices/{body['id']}/payments", headers=owner, json={"idempotencyKey": "cash-4a-1", "method": "cash", "amountCents": half}, timeout=20)
    assert paid.status_code == 200, paid.text
    assert paid.json()["state"] == "partially_paid"
    assert paid.json()["balance"]["cents"] == total - half
    replay = requests.post(f"{API}/invoices/{body['id']}/payments", headers=owner, json={"idempotencyKey": "cash-4a-1", "method": "cash", "amountCents": half}, timeout=20)
    assert replay.json()["balance"]["cents"] == total - half
    over = requests.post(f"{API}/invoices/{body['id']}/payments", headers=owner, json={"idempotencyKey": "cash-4a-over", "method": "cash", "amountCents": total}, timeout=20)
    assert over.status_code == 409
    denied = requests.get(f"{API}/invoices/{body['id']}", headers=liam, timeout=20)
    assert denied.status_code == 404
    own = requests.get(f"{API}/invoices/{body['id']}", headers=sarah, timeout=20)
    assert own.status_code == 200 and own.json()["balance"]["cents"] == total - half
    client_cash = requests.post(f"{API}/invoices/{body['id']}/payments", headers=sarah, json={"idempotencyKey": "cash-4a-client", "method": "cash", "amountCents": 100}, timeout=20)
    assert client_cash.status_code == 403
    pdf = requests.get(f"{API}/invoices/{body['id']}/pdf", headers=sarah, timeout=20)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert b"BALANCE DUE" in pdf.content and b"SOAP" not in pdf.content
    credit = requests.post(f"{API}/invoices/{body['id']}/adjustments", headers=owner, json={"idempotencyKey": "adj-4a-1", "netCents": -100, "reason": "Goodwill credit"}, timeout=20)
    assert credit.status_code == 200, credit.text
    assert credit.json()["total"]["cents"] == total - 100
    payment_id = next(row["id"] for row in paid.json()["payments"] if row["type"] == "client_payment")
    refunded = requests.post(f"{API}/invoices/{body['id']}/refunds", headers=owner, json={"idempotencyKey": "refund-4a-1", "paymentId": payment_id, "amountCents": half + 1}, timeout=20)
    assert refunded.status_code == 409
    allowed = requests.post(f"{API}/invoices/{body['id']}/refunds", headers=owner, json={"idempotencyKey": "refund-4a-2", "paymentId": payment_id, "amountCents": half}, timeout=20)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["received"]["cents"] == 0


def test_concurrent_cash_cannot_overpay():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    appt = _book(sarah, "12:00")
    drafted = requests.post(f"{API}/invoices/from-appointment/{appt['id']}", headers=owner, json={}, timeout=20).json()
    issued = requests.post(f"{API}/invoices/{drafted['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4a-race"}, timeout=20).json()
    total = issued["total"]["cents"]

    def pay(key):
        return requests.post(f"{API}/invoices/{issued['id']}/payments", headers=owner, json={"idempotencyKey": key, "method": "cash", "amountCents": total}, timeout=20)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(pay, ("race-4a-a", "race-4a-b")))
    codes = sorted(item.status_code for item in results)
    assert codes == [200, 409]
    final = requests.get(f"{API}/invoices/{issued['id']}", headers=owner, timeout=20).json()
    assert final["state"] == "paid" and final["balance"]["cents"] == 0


def test_void_requires_a_clear_balance():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    appt = _book(sarah, "15:00")
    drafted = requests.post(f"{API}/invoices/from-appointment/{appt['id']}", headers=owner, json={}, timeout=20).json()
    issued = requests.post(f"{API}/invoices/{drafted['id']}/issue", headers=owner, json={"idempotencyKey": "issue-4a-void"}, timeout=20).json()
    blocked = requests.post(f"{API}/invoices/{issued['id']}/void", headers=sarah, json={"idempotencyKey": "void-4a-client", "reason": "no"}, timeout=20)
    assert blocked.status_code == 403
    voided = requests.post(f"{API}/invoices/{issued['id']}/void", headers=owner, json={"idempotencyKey": "void-4a-owner", "reason": "Booked in error"}, timeout=20)
    assert voided.status_code == 200, voided.text
    assert voided.json()["state"] == "voided"
