"""Legacy import uses synthetic records only."""
import os
import uuid

import requests
from pymongo import MongoClient

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


def _record(suffix, **extra):
    body = {
        "id": f"src-{suffix}",
        "first_name": "Ada",
        "last_name": f"Case{suffix}",
        "email": f"ada.{suffix}@example.com",
        "phone": "7805550101",
        "address": "10150 104 St NW, Edmonton, AB",
        "date_of_birth": "1990-01-02",
        "source": "synthetic",
    }
    body.update(extra)
    return body


def _import(headers, records, invoices=None):
    return requests.post(f"{API}/legacy/import", headers=headers, json={
        "backupConfirmed": True, "authorize": True, "records": records, "invoices": invoices or [],
    }, timeout=20)


def test_import_is_idempotent_and_does_not_post_the_ledger():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    desk = _login("reception.demo@example.com", _required("DEMO_PASSWORD"))
    denied = requests.get(f"{API}/legacy/patients", headers=desk, timeout=20)
    assert denied.status_code == 403
    refused = requests.post(f"{API}/legacy/import", headers=owner, json={"records": [_record("noauth")]}, timeout=20)
    assert refused.status_code == 403
    client = MongoClient(_required("MONGO_URL"))
    ledger_before = client[_required("DB_NAME")].nt_ledger.count_documents({})
    suffix = uuid.uuid4().hex[:8]
    first = _import(owner, [_record(suffix)], [{
        "sourceId": f"inv-{suffix}", "sourcePatientId": f"src-{suffix}", "number": f"H-{suffix}",
        "issuedOn": "2024-04-01", "totalCents": 12000, "currency": "CAD", "state": "paid", "service": "Swedish 60",
    }])
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["imported"] == 1 and body["ledgerPostings"] == 0 and body["invoicesPrepared"] == 1
    second = _import(owner, [_record(suffix)])
    assert second.status_code == 200, second.text
    assert second.json()["imported"] == 0 and second.json()["skipped"] == 1
    listed = requests.get(f"{API}/legacy/patients", headers=owner, params={"q": suffix}, timeout=20)
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    detail = requests.get(f"{API}/legacy/patients/{listed.json()['items'][0]['id']}", headers=owner, timeout=20)
    assert detail.status_code == 200
    invoice = detail.json()["invoices"][0]
    assert invoice["number"] == f"H-{suffix}" and invoice["countsAsRevenue"] is False and invoice["ledgerPosted"] is False
    assert client[_required("DB_NAME")].nt_ledger.count_documents({}) == ledger_before
    stored = client[_required("DB_NAME")].nt_legacy_patients.find_one({"sourceId": f"src-{suffix}"})
    assert str(stored["profile"].get("email", "")).startswith("ntenc1:")
    schema = requests.get(f"{API}/legacy/schema", headers=owner, timeout=20)
    assert schema.json()["invoicesMessage"] == "No historical invoices found in the source system."
    assert schema.json()["invoiceCollections"] == []


def test_missing_contact_duplicates_and_rollback():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    suffix = uuid.uuid4().hex[:8]
    missing = _record(f"miss-{suffix}", email="", phone="")
    twin_a = _record(f"a-{suffix}", email=f"twin.{suffix}@example.com", phone="7805550191")
    twin_b = _record(f"b-{suffix}", email=f"twin.{suffix}@example.com", phone="7805550191", first_name="Other")
    preview = requests.post(f"{API}/legacy/import/preview", headers=owner, json={
        "backupConfirmed": True, "authorize": True, "records": [missing, twin_a, twin_b],
    }, timeout=20)
    assert preview.status_code == 200, preview.text
    assert preview.json()["needsContactReview"] == 1 and preview.json()["duplicates"] == 1 and preview.json()["message"]
    saved = _import(owner, [missing, twin_a, twin_b])
    assert saved.status_code == 200, saved.text
    assert saved.json()["imported"] == 3 and saved.json()["ledgerPostings"] == 0
    rolled = requests.post(f"{API}/legacy/batches/{saved.json()['batchId']}/rollback", headers=owner, timeout=20)
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["removed"] == 3
    gone = requests.get(f"{API}/legacy/patients", headers=owner, params={"q": suffix}, timeout=20)
    assert gone.json()["total"] == 0
