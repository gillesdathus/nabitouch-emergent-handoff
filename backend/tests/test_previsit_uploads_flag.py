"""Health history and session consent must save when document uploads are off."""
import hashlib
import os
import uuid
from pathlib import Path

import pytest
import requests

API = os.environ.get("API_BASE") or os.environ.get("API_URL") or "http://127.0.0.1:8000/api"
ROOT = Path(__file__).resolve().parents[1]
OPEN = ("requested", "confirmed", "assigned", "preparing", "en_route", "arrived", "interrupted", "safety_hold")
PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def test_source_contract_profile_photo_does_not_block_client_patch():
    server = (ROOT / "server.py").read_text(encoding="utf-8")
    session = (ROOT / "session_care.py").read_text(encoding="utf-8")
    clinical = (ROOT / "clinical.py").read_text(encoding="utf-8")
    assert 'doc.pop("photo"' in server
    assert "ignore photo payloads instead of failing the whole client update" in server
    assert "document_uploads_enabled" not in session
    assert "document_uploads_enabled" not in clinical


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.cookies.get('access_token')}"}


def _sarah():
    return _login("sarah.demo@example.com", os.environ["DEMO_PASSWORD"])


def _baseline_body(**extra):
    body = {
        "allergies": "None",
        "medications": "None",
        "conditions": ["None of these"],
        "conditionsOther": "",
        "contraindications": "",
        "surgeries": "None",
        "physician": "",
        "pregnancy": "Not applicable",
        "emergencyName": "Alex Friend",
        "emergencyPhone": "7805550199",
        "emergencyRelation": "Friend",
        "concerns": "Shoulders",
        "preferences": "Pressure: medium",
        "answers": {"unwell": "no"},
    }
    body.update(extra)
    return body


@pytest.fixture(scope="module")
def uploads_off():
    health = requests.get(f"{API}/health", timeout=20)
    assert health.status_code == 200, health.text
    assert health.json().get("documentUploads") is False, "These tests require DOCUMENT_UPLOADS_ENABLED=false"


def test_profile_patch_saves_when_photo_payload_present_and_uploads_off(uploads_off):
    sarah = _sarah()
    me = requests.get(f"{API}/auth/me", headers=sarah, timeout=20)
    assert me.status_code == 200, me.text
    cid = me.json()["subject"]
    preferred = f"Pref-{uuid.uuid4().hex[:6]}"
    patched = requests.patch(
        f"{API}/clients/{cid}",
        headers=sarah,
        json={"preferredName": preferred, "photo": PHOTO},
        timeout=20,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["preferredName"] == preferred
    assert patched.json().get("photo") != PHOTO


def test_intake_baseline_when_uploads_off(uploads_off):
    sarah = _sarah()
    baseline = requests.post(f"{API}/intake/baseline", headers=sarah, json=_baseline_body(), timeout=30)
    assert baseline.status_code == 200, baseline.text
    assert baseline.json().get("baseline") is True
    assert baseline.json().get("version") >= 1


def test_session_consent_when_uploads_off(uploads_off):
    sarah = _sarah()
    me = requests.get(f"{API}/auth/me", headers=sarah, timeout=20).json()
    state = requests.get(f"{API}/state", headers=sarah, timeout=20)
    assert state.status_code == 200, state.text
    appts = [a for a in state.json().get("appointments") or [] if a.get("clientId") == me["subject"] and a.get("status") in OPEN]
    if not appts:
        pytest.skip("No open Sarah appointment for session consent")
    aid = appts[0]["id"]

    baseline = requests.post(f"{API}/intake/baseline", headers=sarah, json=_baseline_body(appointmentId=aid), timeout=30)
    assert baseline.status_code == 200, baseline.text

    body = requests.get(f"{API}/sessions/{aid}/readiness", headers=sarah, timeout=20).json()
    if body["intake"]["state"] != "confirmed":
        confirm = requests.post(
            f"{API}/sessions/{aid}/intake-confirm",
            headers=sarah,
            json={"changed": False, "answers": {"unwell": "no"}},
            timeout=20,
        )
        assert confirm.status_code == 200, confirm.text
        body = confirm.json()
    assert body["intake"]["state"] == "confirmed"

    if body.get("ready"):
        assert body["consent"]["state"] == "signed"
        return

    consent_text = body["consentText"]
    text_hash = hashlib.sha256(consent_text.encode()).hexdigest()
    acks = {key: True for key in body["acknowledgements"]}
    signed = requests.post(
        f"{API}/sessions/{aid}/consent",
        headers=sarah,
        json={
            "acknowledgements": acks,
            "restrictions": {"pressureMax": "medium", "draping": "standard", "avoidAreas": [], "sensitiveAreas": False, "notes": ""},
            "typedName": "Sarah Thompson",
            "signature": "data:image/png;base64," + ("A" * 420),
            "textHash": text_hash,
        },
        timeout=20,
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["ready"] is True
    assert signed.json()["consent"]["state"] == "signed"
    assert signed.json()["consent"]["record"]["typedName"] == "Sarah Thompson"
