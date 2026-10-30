"""Invitation lifecycle. Tokens in this file are synthetic."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import requests
from pymongo import MongoClient

from legacy import invitation_message

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


def _stage(owner, suffix, **extra):
    record = {
        "id": f"src-{suffix}", "first_name": "Mina", "last_name": "Patel",
        "email": f"mina.{suffix}@example.com", "phone": "7805550144",
        "date_of_birth": "1988-03-04", "source": "synthetic",
    }
    record.update(extra)
    saved = requests.post(f"{API}/legacy/import", headers=owner, json={
        "backupConfirmed": True, "authorize": True, "records": [record],
    }, timeout=20)
    assert saved.status_code == 200, saved.text
    listed = requests.get(f"{API}/legacy/patients", headers=owner, params={"q": suffix}, timeout=20).json()
    return listed["items"][0]["id"]


def _db():
    return MongoClient(_required("MONGO_URL"))[_required("DB_NAME")]


def test_invitation_message_has_no_clinical_detail():
    subject, html = invitation_message("https://localhost:3011/welcome#synthetic-token")
    assert "allerg" not in html.lower() and "policy" not in html.lower()
    assert "#" in html and "synthetic-token" not in subject


def test_invite_verify_replay_expiry_revoke_and_conflict():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    desk = _login("reception.demo@example.com", _required("DEMO_PASSWORD"))
    suffix = uuid.uuid4().hex[:8]
    record_id = _stage(owner, suffix)
    denied = requests.post(f"{API}/legacy/patients/{record_id}/invite", headers=desk, json={}, timeout=20)
    assert denied.status_code == 403
    preview = requests.post(f"{API}/legacy/invitations/preview", headers=owner, json={"ids": [record_id]}, timeout=20)
    assert preview.status_code == 200 and preview.json()["willSend"] is False and record_id in preview.json()["ready"]
    invited = requests.post(f"{API}/legacy/patients/{record_id}/invite", headers=owner, json={}, timeout=20)
    assert invited.status_code == 200, invited.text
    link = invited.json()["link"]
    token = link.split("#", 1)[1]
    assert invited.json()["delivery"] == "sent"
    again = requests.post(f"{API}/legacy/patients/{record_id}/invite", headers=owner, json={}, timeout=20)
    assert again.status_code == 429
    opened = requests.post(f"{API}/legacy/invitations/open", json={"token": token}, timeout=20)
    assert opened.status_code == 200 and "email" not in opened.json()
    wrong = requests.post(f"{API}/legacy/invitations/verify", json={
        "token": token, "lastName": "Nobody", "dateOfBirth": "1988-03-04",
        "email": f"mina.{suffix}@example.com", "password": "CorrectHorse1",
    }, timeout=20)
    assert wrong.status_code == 401
    verified = requests.post(f"{API}/legacy/invitations/verify", json={
        "token": token, "lastName": "Patel", "dateOfBirth": "1988-03-04",
        "email": f"mina.{suffix}@example.com", "password": "CorrectHorse1",
    }, timeout=20)
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "onboarding_in_progress"
    replay = requests.post(f"{API}/legacy/invitations/verify", json={
        "token": token, "lastName": "Patel", "dateOfBirth": "1988-03-04",
        "email": f"mina.{suffix}@example.com", "password": "CorrectHorse1",
    }, timeout=20)
    assert replay.status_code == 410
    other = _stage(owner, f"other-{suffix}", email=f"other.{suffix}@example.com", phone="7805550177")
    second = requests.post(f"{API}/legacy/patients/{other}/invite", headers=owner, json={}, timeout=20)
    assert second.status_code == 200, second.text
    other_token = second.json()["link"].split("#", 1)[1]
    conflict = requests.post(f"{API}/legacy/invitations/verify", json={
        "token": other_token, "lastName": "Patel", "dateOfBirth": "1988-03-04",
        "email": f"mina.{suffix}@example.com", "password": "CorrectHorse1",
    }, timeout=20)
    assert conflict.status_code == 409
    fresh = _stage(owner, f"exp-{suffix}", email=f"exp.{suffix}@example.com", phone="7805550166")
    issued = requests.post(f"{API}/legacy/patients/{fresh}/invite", headers=owner, json={}, timeout=20)
    invite_id = issued.json()["id"]
    _db().nt_legacy_invitations.update_one({"id": invite_id}, {"$set": {"expiresAt": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()}})
    expired = requests.post(f"{API}/legacy/invitations/open", json={"token": issued.json()["link"].split('#', 1)[1]}, timeout=20)
    assert expired.status_code == 410
    revoke_target = _stage(owner, f"rev-{suffix}", email=f"rev.{suffix}@example.com", phone="7805550155")
    created = requests.post(f"{API}/legacy/patients/{revoke_target}/invite", headers=owner, json={}, timeout=20)
    revoked = requests.post(f"{API}/legacy/invitations/{created.json()['id']}/revoke", headers=owner, timeout=20)
    assert revoked.status_code == 200
    dead = requests.post(f"{API}/legacy/invitations/open", json={"token": created.json()["link"].split("#", 1)[1]}, timeout=20)
    assert dead.status_code == 410
    patient = requests.get(f"{API}/legacy/patients/{revoke_target}", headers=owner, timeout=20).json()
    assert patient["status"] == "invitation_expired"


def test_batch_preview_eligible_exclusions_and_exact_send():
    owner = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    suffix = uuid.uuid4().hex[:8]
    ready_id = _stage(owner, f"ok-{suffix}", email=f"ok.{suffix}@example.com", phone="7805550111")
    blocked_id = _stage(
        owner, f"bad-{suffix}",
        email="", phone="",
        first_name="No", last_name="Contact",
    )
    listed = requests.get(f"{API}/legacy/patients", headers=owner, params={"q": f"bad-{suffix}"}, timeout=20).json()
    assert listed["items"][0]["id"] == blocked_id
    eligible = requests.get(f"{API}/legacy/invitations/eligible", headers=owner, params={"q": suffix}, timeout=20)
    assert eligible.status_code == 200, eligible.text
    body = eligible.json()
    assert body["autoExpand"] is False
    assert ready_id in body["ids"]
    assert blocked_id not in body["ids"]
    preview = requests.post(
        f"{API}/legacy/invitations/preview",
        headers=owner,
        json={"ids": [ready_id, blocked_id, "leg-missing"]},
        timeout=20,
    )
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert data["willSend"] is False and data["autoSendOnImport"] is False
    assert data["ready"] == [ready_id]
    assert blocked_id in data["blocked"] and "leg-missing" in data["blocked"]
    assert data["confirmCount"] == 1 and data["requestedCount"] == 3
    assert data["recipients"][0]["destination"] == f"ok.{suffix}@example.com"
    assert data["recipients"][0]["channel"] == "email"
    assert data["template"]["includesClinicalDetail"] is False
    assert data["template"]["marketingConsent"] is False
    assert "allerg" not in (data["template"].get("previewText") or "").lower()
    refused = requests.post(
        f"{API}/legacy/invitations/send",
        headers=owner,
        json={"ids": [ready_id], "confirm": False},
        timeout=20,
    )
    assert refused.status_code == 400
    sent = requests.post(
        f"{API}/legacy/invitations/send",
        headers=owner,
        json={"ids": [ready_id, blocked_id], "confirm": True},
        timeout=20,
    )
    assert sent.status_code == 200, sent.text
    payload = sent.json()
    assert payload["autoExpanded"] is False
    assert payload["sentCount"] == 1 and payload["failedCount"] == 1
    assert payload["sent"][0]["patientId"] == ready_id
    assert payload["failed"][0]["patientId"] == blocked_id
    history = requests.get(f"{API}/legacy/invitations", headers=owner, params={"patientId": ready_id}, timeout=20)
    assert history.status_code == 200
    assert history.json()["items"]
    assert history.json()["items"][0]["outcome"] in ("open", "delivery_error")
