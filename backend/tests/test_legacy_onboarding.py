"""Onboarding progress, consent versions, and quarantined insurance files."""
import os
import uuid

import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def _login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def _linked(owner, suffix):
    record = {
        "id": f"src-{suffix}", "first_name": "Nora", "last_name": "Singh",
        "email": f"nora.{suffix}@example.com", "phone": "7805550133",
        "date_of_birth": "1992-07-09", "allergies": "legacy-only", "consent_signed": True,
        "insurance_policy_number": "LEGACY-POLICY", "source": "synthetic",
    }
    saved = requests.post(f"{API}/legacy/import", headers=owner, json={"backupConfirmed": True, "authorize": True, "records": [record]}, timeout=20)
    assert saved.status_code == 200, saved.text
    record_id = requests.get(f"{API}/legacy/patients", headers=owner, params={"q": suffix}, timeout=20).json()["items"][0]["id"]
    invited = requests.post(f"{API}/legacy/patients/{record_id}/invite", headers=owner, json={}, timeout=20)
    assert invited.status_code == 200, invited.text
    token = invited.json()["link"].split("#", 1)[1]
    verified = requests.post(f"{API}/legacy/invitations/verify", json={
        "token": token, "lastName": "Singh", "dateOfBirth": "1992-07-09",
        "email": f"nora.{suffix}@example.com", "password": "CorrectHorse1",
    }, timeout=20)
    assert verified.status_code == 200, verified.text
    return record_id, {"Authorization": f"Bearer {verified.cookies.get('access_token')}"}


def test_onboarding_resumes_and_keeps_documents_quarantined():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    other = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    suffix = uuid.uuid4().hex[:8]
    record_id, client = _linked(owner, suffix)
    first = requests.get(f"{API}/legacy/onboarding", headers=client, timeout=20)
    assert first.status_code == 200, first.text
    assert first.json()["draft"]["personal"]["firstName"] == "Nora"
    assert "legacy-only" not in str(first.json()["draft"].get("health"))
    saved = requests.patch(f"{API}/legacy/onboarding", headers=client, json={
        "step": 5,
        "insurance": [
            {"company": "Example Plan", "memberId": "M-1", "policy": "G-1", "relationship": "self"},
            {"company": "Second Plan", "memberId": "M-2", "policy": "G-2", "relationship": "spouse"},
        ],
    }, timeout=20)
    assert saved.status_code == 200, saved.text
    resumed = requests.get(f"{API}/legacy/onboarding", headers=client, timeout=20).json()
    assert resumed["step"] == 5 and len(resumed["draft"]["insurance"]) == 2
    empty = requests.post(f"{API}/legacy/onboarding/submit", headers=client, json={"version": "2026-1"}, timeout=20)
    assert empty.status_code == 400
    uploaded = requests.post(f"{API}/legacy/onboarding/documents", headers=client, files={"upload": ("card.pdf", PDF, "application/pdf")}, data={"side": "front"}, timeout=20)
    assert uploaded.status_code == 200, uploaded.text
    file_id = uploaded.json()["id"]
    assert uploaded.json()["released"] is False
    blocked = requests.get(f"{API}/legacy/onboarding/documents/{file_id}", headers=client, timeout=20)
    assert blocked.status_code == 409
    secret = requests.get(f"{API}/legacy/onboarding/documents/{file_id}", headers=other, timeout=20)
    assert secret.status_code == 403
    requests.patch(f"{API}/legacy/onboarding", headers=client, json={
        "health": {"allergies": "None stated", "medications": "", "concerns": "Neck", "preferences": "", "contraindications": ""},
        "consents": {"privacy": True, "treatment": True, "marketing": False},
    }, timeout=20)
    submitted = requests.post(f"{API}/legacy/onboarding/submit", headers=client, json={"version": "2026-1"}, timeout=20)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "needs_review"
    assert submitted.json()["consentVersion"] == "2026-1"
    consents = requests.get(f"{API}/consents", headers=client, timeout=20).json()
    assert [row["version"] for row in consents if row["kind"] == "treatment"] == ["2026-1"]
    again = requests.post(f"{API}/legacy/onboarding/submit", headers=client, json={"version": "2026-2"}, timeout=20)
    assert again.status_code == 200, again.text
    consents = requests.get(f"{API}/consents", headers=client, timeout=20).json()
    assert [row["version"] for row in consents if row["kind"] == "treatment"] == ["2026-1", "2026-2"]
    activated = requests.post(f"{API}/legacy/patients/{record_id}/activate", headers=owner, timeout=20)
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "activated"
    assert activated.json()["ledgerLinesForClient"] == 0
