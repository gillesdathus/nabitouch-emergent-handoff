"""Slice 4E — historical imports keep their dates and do not become new revenue."""
import io
import os
import uuid

import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
CSV = """source_id,first_name,last_name,email,service_date,service,practitioner,invoice_total_cents,payment_cents,payment_date,claim_provider,claimed_cents,approved_cents,received_cents,soap_note
H1,Ada,Lovelace,ada.hist@example.com,2020-01-15,Swedish,Maya Chen,12000,2000,2020-01-16,Sun Life,10000,9000,6000,Shoulder note
"""


def _login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def test_a_historical_file_imports_once_and_rolls_back_without_deleting_the_ledger():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    files = {"upload": ("history.csv", CSV.encode(), "text/csv")}
    blocked = requests.post(f"{API}/billing/imports/preview", headers=sarah, files=files, timeout=20)
    assert blocked.status_code == 403
    preview = requests.post(f"{API}/billing/imports/preview", headers=owner, files={"upload": ("history.csv", CSV.encode(), "text/csv")}, timeout=20)
    assert preview.status_code == 200, preview.text
    assert preview.json()["ready"] is True
    bad = "source_id,invoice_total_cents\nH9,12.50\n"
    rejected = requests.post(f"{API}/billing/imports", headers=owner, files={"upload": ("bad.csv", bad.encode(), "text/csv")}, timeout=20)
    assert rejected.status_code == 422
    first = requests.post(f"{API}/billing/imports", headers=owner, files={"upload": ("history.csv", CSV.encode(), "text/csv")}, timeout=20)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["created"] == 1 and body["countsAsRevenue"] is False and body["repeated"] is False
    again = requests.post(f"{API}/billing/imports", headers=owner, files={"upload": ("history.csv", CSV.encode(), "text/csv")}, timeout=20)
    assert again.status_code == 200 and again.json()["repeated"] is True
    detail = requests.get(f"{API}/billing/imports/{body['batchId']}", headers=owner, timeout=20).json()
    assert detail["rows"][0]["soapRecorded"] is True and detail["rows"][0]["signed"] is False
    invoice = requests.get(f"{API}/invoices/{detail['rows'][0]['invoiceId']}", headers=owner, timeout=20).json()
    assert invoice["countsAsRevenue"] is False
    assert invoice["origin"] == "historical"
    assert invoice["serviceDate"] == "2020-01-15"
    assert invoice["balance"]["cents"] == 4000
    assert invoice["expectedInsurance"]["cents"] == 3000
    assert invoice["insuranceReceived"]["cents"] == 6000
    assert invoice["clientPaid"]["cents"] == 2000
    assert all(line["method"] != "stripe" for line in invoice["payments"])
    rolled = requests.post(f"{API}/billing/imports/{body['batchId']}/rollback", headers=owner, timeout=20)
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["reversed"] == 2
    after = requests.get(f"{API}/invoices/{detail['rows'][0]['invoiceId']}", headers=owner, timeout=20).json()
    assert after["balance"]["cents"] == 12000
    assert any(line["type"] == "reversal" for line in after["payments"])
    second = requests.post(f"{API}/billing/imports/{body['batchId']}/rollback", headers=owner, timeout=20)
    assert second.json()["repeated"] is True and second.json()["reversed"] == 0


def test_xlsx_uses_the_same_columns():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    import pandas as pd
    frame = pd.DataFrame([{
        "source_id": "H-" + uuid.uuid4().hex[:8], "first_name": "Grace", "last_name": "Hopper",
        "email": "grace.hist@example.com", "service_date": "2019-05-02", "service": "Deep tissue",
        "practitioner": "Liam", "invoice_total_cents": "8000", "payment_cents": "0", "payment_date": "",
        "claim_provider": "", "claimed_cents": "0", "approved_cents": "0", "received_cents": "0", "soap_note": "",
    }])
    buffer = io.BytesIO()
    frame.to_excel(buffer, index=False)
    response = requests.post(f"{API}/billing/imports", headers=owner, files={"upload": ("history.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}, timeout=20)
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 1
