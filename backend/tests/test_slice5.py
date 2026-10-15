"""Slice 5 — clinical records, consent, credentials, and optional authenticator sign-in."""
import os
import uuid
from datetime import date, timedelta

import requests

from totp import totp

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("mfaRequired") is not True
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}, body


def _book(headers, clock):
    day = (uuid.uuid4().int % 27) + 1
    response = requests.post(f"{API}/bookings", headers=headers, json={
        "source": "online", "practitionerId": "p-maya",
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": f"2028-11-{day:02d}", "time": clock,
            "locationType": "clinic", "paymentMethod": "self",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }, timeout=20)
    assert response.status_code == 200, response.text
    return response.json()["appointment"]["id"]


def test_signed_notes_gain_amendments_and_booking_does_not_create_consent():
    owner, _profile = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    sarah, _client = _login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    maya, _maya = _login("maya.demo@example.com", _required("DEMO_PASSWORD"))
    liam, _liam = _login("liam.demo@example.com", _required("DEMO_PASSWORD"))
    desk, _desk = _login("reception.demo@example.com", _required("DEMO_PASSWORD"))
    before = requests.get(f"{API}/consents", headers=sarah, timeout=20)
    assert before.status_code == 200 and before.json() == []
    aid = _book(sarah, "09:00")
    assert requests.get(f"{API}/consents", headers=sarah, timeout=20).json() == []
    recorded = requests.post(f"{API}/consents", headers=sarah, json={"kind": "treatment", "version": "2026-1", "acknowledged": True}, timeout=20)
    assert recorded.status_code == 200, recorded.text
    _book(sarah, "13:00")
    assert len(requests.get(f"{API}/consents", headers=sarah, timeout=20).json()) == 1
    first = requests.post(f"{API}/intake", headers=sarah, json={"allergies": "Latex", "medications": "None relevant", "concerns": "Neck", "preferences": "Light pressure", "contraindications": ""}, timeout=20)
    second = requests.post(f"{API}/intake", headers=sarah, json={"allergies": "Latex and nuts", "medications": "None relevant", "concerns": "Neck", "preferences": "Light pressure", "contraindications": "Avoid neck end-range"}, timeout=20)
    assert first.status_code == 200 and second.json()["version"] == 2
    history = requests.get(f"{API}/intake/c-sarah", headers=maya, timeout=20)
    assert history.status_code == 200 and [row["version"] for row in history.json()] == [1, 2]
    assert requests.get(f"{API}/intake/c-sarah", headers=desk, timeout=20).status_code == 403
    precautions = requests.get(f"{API}/intake/c-sarah/precautions", headers=desk, timeout=20)
    assert precautions.status_code == 200 and set(precautions.json()) == {"allergies", "contraindications"}
    saved = requests.put(f"{API}/soap/{aid}", headers=maya, json={"S": {"chips": [], "pain": 2, "text": "Client reports a stiff neck."}, "O": {"chips": [], "areas": [], "text": ""}, "A": {"chips": [], "text": ""}, "P": {"chips": [], "text": ""}}, timeout=20)
    assert saved.status_code == 200, saved.text
    assert requests.post(f"{API}/soap/{aid}/sign", headers=maya, json={}, timeout=20).status_code == 200
    original = requests.get(f"{API}/soap/{aid}", headers=maya, timeout=20).json()["note"]["S"]["text"]
    blocked = requests.put(f"{API}/soap/{aid}", headers=maya, json={"S": {"chips": [], "pain": 0, "text": "replaced"}}, timeout=20)
    assert blocked.status_code == 409
    amended = requests.post(f"{API}/soap/{aid}/amendments", headers=maya, json={"reason": "Added the technique actually used", "treatmentPerformed": "Light Swedish strokes to the neck."}, timeout=20)
    assert amended.status_code == 200, amended.text
    after = requests.get(f"{API}/soap/{aid}", headers=maya, timeout=20).json()
    assert after["note"]["S"]["text"] == original
    assert after["amendments"][0]["fields"]["treatmentPerformed"].startswith("Light Swedish")
    assert requests.get(f"{API}/soap/{aid}", headers=liam, timeout=20).status_code == 403
    assert requests.get(f"{API}/soap/{aid}", headers=desk, timeout=20).status_code == 403
    phrase = requests.post(f"{API}/clinical/snippets", headers=maya, json={"label": "Pressure", "text": "Client asked for light pressure."}, timeout=20)
    assert phrase.status_code == 200
    assert requests.get(f"{API}/clinical/snippets", headers=liam, timeout=20).json() == []
    brief = requests.get(f"{API}/appointments/{aid}/mobile-brief", headers=maya, timeout=20)
    assert brief.status_code == 200, brief.text
    assert "lat" not in brief.json() and brief.json()["consentOnFile"] is True
    assert brief.json()["precautions"]["allergies"] == "Latex and nuts"
    refused = requests.post(f"{API}/notices/marketing", headers=owner, json={"clientId": "c-david", "body": "A spring visit is available."}, timeout=20)
    assert refused.status_code == 403
    clinical = requests.post(f"{API}/notices/marketing", headers=owner, json={"clientId": "c-sarah", "body": "Your SOAP note is ready."}, timeout=20)
    assert clinical.status_code == 400
    sent = requests.post(f"{API}/notices/marketing", headers=owner, json={"clientId": "c-sarah", "body": "A spring visit is available."}, timeout=20)
    assert sent.status_code == 200, sent.text
    billing = requests.get(f"{API}/billing/notices", headers=sarah, timeout=20).json()
    assert all(row.get("channel") != "marketing" and "spring" not in row.get("body", "").lower() for row in billing)
    promo = requests.get(f"{API}/notices/marketing", headers=sarah, timeout=20).json()
    assert promo[0]["body"] == "A spring visit is available."
    soon = (date.today() + timedelta(days=10)).isoformat()
    later = (date.today() + timedelta(days=400)).isoformat()
    near = requests.post(f"{API}/credentials", headers=owner, json={"practitionerId": "p-maya", "kind": "liability", "identifier": "POL-100", "expiresOn": soon}, timeout=20)
    requests.post(f"{API}/credentials", headers=owner, json={"practitionerId": "p-liam", "kind": "registration", "identifier": "REG-200", "expiresOn": later}, timeout=20)
    assert near.json()["status"] == "uploaded"
    due = requests.get(f"{API}/credentials/reminders", headers=owner, timeout=20).json()
    assert any(row["id"] == near.json()["id"] and row["verified"] is False for row in due["due"])
    assert all(row["identifier"] != "REG-200" for row in due["due"])
    try:
        requests.patch(f"{API}/settings/app", headers=owner, json={"credentialReminderDays": [7]}, timeout=20)
        narrowed = requests.get(f"{API}/credentials/reminders", headers=owner, timeout=20).json()
        assert all(row["id"] != near.json()["id"] for row in narrowed["due"])
        requests.patch(f"{API}/settings/app", headers=owner, json={"requireMfaForPrivileged": True}, timeout=20)
        refund = requests.post(f"{API}/invoices/missing/refunds", headers=owner, json={"amountCents": 1, "paymentId": "none", "idempotencyKey": "refund-" + uuid.uuid4().hex[:8]}, timeout=20)
        assert refund.status_code == 403 and "authenticator" in refund.text
        exported = requests.get(f"{API}/clinical/export/c-sarah", headers=owner, timeout=20)
        assert exported.status_code == 403
    finally:
        requests.patch(f"{API}/settings/app", headers=owner, json={"credentialReminderDays": [60, 30, 14, 7], "requireMfaForPrivileged": False}, timeout=20)
    verified = requests.post(f"{API}/credentials/{near.json()['id']}/verify", headers=owner, timeout=20)
    assert verified.status_code == 200, verified.text
    opened = requests.get(f"{API}/clinical/export/c-sarah", headers=owner, timeout=20)
    assert opened.status_code == 200 and opened.json()["intake"][-1]["version"] == 2
    log = requests.get(f"{API}/clinical/access", headers=owner, timeout=20).text
    assert "Light Swedish" not in log and "None relevant" not in log


def test_authenticator_is_required_only_after_a_staff_account_enrolls():
    owner, _profile = _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    email = f"desk.{uuid.uuid4().hex[:8]}@example.com"
    password = "desk-pass-" + uuid.uuid4().hex[:8]
    created = requests.post(f"{API}/auth/staff", headers=owner, json={"email": email, "password": password, "name": "Desk MFA", "role": "desk"}, timeout=20)
    assert created.status_code == 200, created.text
    desk, _body = _login(email, password)
    enrolled = requests.post(f"{API}/auth/mfa/enroll", headers=desk, timeout=20)
    assert enrolled.status_code == 200, enrolled.text
    secret = enrolled.json()["secret"]
    recovery = enrolled.json()["recoveryCodes"]
    assert len(recovery) == 8 and secret not in recovery
    assert requests.post(f"{API}/auth/mfa/confirm", headers=desk, json={"code": totp(secret)}, timeout=20).status_code == 200
    challenged = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert challenged.status_code == 200 and challenged.json()["mfaRequired"] is True
    assert "access_token" not in challenged.cookies
    challenge = challenged.json()["challenge"]
    replay = totp(secret)
    accepted = requests.post(f"{API}/auth/mfa/verify", json={"challenge": challenge, "code": replay}, timeout=20)
    assert accepted.status_code == 200 and accepted.json()["role"] == "desk"
    again = requests.post(f"{API}/auth/mfa/verify", json={"challenge": challenge, "code": replay}, timeout=20)
    assert again.status_code == 401
    second = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20).json()["challenge"]
    recovered = requests.post(f"{API}/auth/mfa/verify", json={"challenge": second, "code": recovery[0]}, timeout=20)
    assert recovered.status_code == 200, recovered.text
    reused = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20).json()["challenge"]
    assert requests.post(f"{API}/auth/mfa/verify", json={"challenge": reused, "code": recovery[0]}, timeout=20).status_code == 401
    session = {"Authorization": f"Bearer {recovered.cookies.get('access_token')}"}
    assert requests.post(f"{API}/auth/mfa/disable", headers=session, json={"code": recovery[1]}, timeout=20).status_code == 200
    restored, profile = _login(email, password)
    assert profile["role"] == "desk" and restored["Authorization"].startswith("Bearer ")
    other = f"limit.{uuid.uuid4().hex[:8]}@example.com"
    other_password = "limit-pass-" + uuid.uuid4().hex[:8]
    requests.post(f"{API}/auth/staff", headers=owner, json={"email": other, "password": other_password, "name": "Limit MFA", "role": "desk"}, timeout=20)
    limited, _ignored = _login(other, other_password)
    other_enroll = requests.post(f"{API}/auth/mfa/enroll", headers=limited, timeout=20).json()
    requests.post(f"{API}/auth/mfa/confirm", headers=limited, json={"code": totp(other_enroll["secret"])}, timeout=20)
    locked = requests.post(f"{API}/auth/login", json={"email": other, "password": other_password}, timeout=20).json()["challenge"]
    for _ in range(5):
        requests.post(f"{API}/auth/mfa/verify", json={"challenge": locked, "code": "000000"}, timeout=20)
    blocked = requests.post(f"{API}/auth/mfa/verify", json={"challenge": locked, "code": "000000"}, timeout=20)
    assert blocked.status_code == 429
