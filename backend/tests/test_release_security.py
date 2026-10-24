"""Release blockers: privileged MFA cannot be skipped, sensitive fields stay sealed, uploads stay quarantined."""
import asyncio
import os
import uuid

import requests
from motor.motor_asyncio import AsyncIOMotorClient

from documents import ScannerUnavailable, clamav_instream
from totp import totp


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def _mongo():
    return AsyncIOMotorClient(_required("MONGO_URL"))


def _set_enforcement(enabled):
    async def run():
        client = _mongo()
        await client[_required("DB_NAME")]["nt_settings"].update_one({"id": "app"}, {"$set": {"mfaEnforcePrivileged": enabled}}, upsert=True)
        client.close()
    asyncio.run(run())


def _enforcement():
    async def run():
        client = _mongo()
        row = await client[_required("DB_NAME")]["nt_settings"].find_one({"id": "app"}, {"mfaEnforcePrivileged": 1})
        client.close()
        return bool(row and row.get("mfaEnforcePrivileged"))
    return asyncio.run(run())


def _drop_pending_mfa(email):
    async def run():
        client = _mongo()
        database = client[_required("DB_NAME")]
        user = await database["nt_users"].find_one({"email": email.lower()}, {"id": 1})
        if user:
            await database["nt_mfa"].delete_many({"userId": user["id"], "enabled": False})
        client.close()
    asyncio.run(run())


def _stored_client(client_id):
    async def run():
        client = _mongo()
        row = await client[_required("DB_NAME")]["nt_clients"].find_one({"id": client_id}, {"insurance": 1})
        client.close()
        return row
    return asyncio.run(run())


def _stored_intake(client_id):
    async def run():
        client = _mongo()
        rows = await client[_required("DB_NAME")]["nt_intake"].find({"clientId": client_id}).sort("version", -1).to_list(1)
        client.close()
        return rows[0] if rows else None
    return asyncio.run(run())


def test_unreachable_scanner_stays_unavailable():
    try:
        clamav_instream(b"%PDF-1.4\n", "127.0.0.1", 1, timeout=0.5)
    except ScannerUnavailable:
        return
    raise AssertionError("a closed scanner port must stay unavailable")


def test_privileged_sessions_cannot_skip_enforced_mfa():
    _set_enforcement(False)
    try:
        owner = requests.Session()
        signed = owner.post(f"{API}/auth/login", json={"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")}, timeout=20)
        assert signed.status_code == 200 and signed.cookies.get("access_token")
        owner.headers["X-CSRF-Token"] = owner.cookies.get("csrf_token")
        blocked = owner.patch(f"{API}/settings/app", json={"mfaEnforcePrivileged": True}, timeout=20)
        assert blocked.status_code == 403

        email = f"guard.{uuid.uuid4().hex[:8]}@example.com"
        password = "guard-pass-" + uuid.uuid4().hex[:8]
        created = owner.post(f"{API}/auth/staff", json={"email": email, "password": password, "name": "Guard Desk", "role": "desk"}, timeout=20)
        assert created.status_code == 200, created.text

        _set_enforcement(True)
        assert owner.get(f"{API}/auth/me", timeout=20).status_code == 401
        refreshed = owner.post(f"{API}/auth/refresh", timeout=20)
        assert refreshed.status_code == 401
        password_only = requests.post(f"{API}/auth/login", json={"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")}, timeout=20)
        assert password_only.status_code == 200 and password_only.json().get("enrollmentRequired") is True
        assert not password_only.cookies.get("access_token")
        demo = requests.post(f"{API}/auth/demo-login", json={"role": "practitioner", "subject": "p-maya"}, timeout=20)
        assert demo.status_code == 403 and not demo.cookies.get("access_token")
        client_demo = requests.post(f"{API}/auth/demo-login", json={"role": "client"}, timeout=20)
        assert client_demo.status_code == 200 and client_demo.cookies.get("access_token")

        challenged = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
        assert challenged.status_code == 200 and challenged.json().get("enrollmentRequired") is True
        assert not challenged.cookies.get("access_token")
        challenge = challenged.json()["challenge"]
        enrolled = requests.post(f"{API}/auth/mfa/enroll", json={"challenge": challenge}, timeout=20)
        assert enrolled.status_code == 200, enrolled.text
        secret = enrolled.json()["secret"]
        recovery = enrolled.json()["recoveryCodes"]
        confirmed = requests.post(f"{API}/auth/mfa/confirm", json={"challenge": challenge, "code": totp(secret)}, timeout=20)
        assert confirmed.status_code == 200 and confirmed.json()["role"] == "desk" and confirmed.cookies.get("access_token")
        reused = requests.post(f"{API}/auth/mfa/verify", json={"challenge": challenge, "code": totp(secret)}, timeout=20)
        assert reused.status_code == 401
        second = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
        assert second.json().get("mfaRequired") is True and not second.cookies.get("access_token")
        recovered = requests.post(f"{API}/auth/mfa/verify", json={"challenge": second.json()["challenge"], "code": recovery[0]}, timeout=20)
        assert recovered.status_code == 200
        again = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
        assert requests.post(f"{API}/auth/mfa/verify", json={"challenge": again.json()["challenge"], "code": recovery[0]}, timeout=20).status_code == 401
    finally:
        _set_enforcement(False)


def test_sensitive_fields_are_sealed_at_rest_and_absent_from_the_access_log():
    assert os.environ.get("FIELD_ENCRYPTION_KEY"), "FIELD_ENCRYPTION_KEY is required to prove field encryption"
    email = f"seal.{uuid.uuid4().hex[:8]}@example.com"
    sarah = requests.post(f"{API}/auth/register", json={
        "email": email, "password": "seal-pass-" + uuid.uuid4().hex[:8], "firstName": "Seal", "lastName": "Client",
        "phone": "780-555-0101", "dob": "1990-01-01", "marketingConsent": False,
        "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True,
    }, timeout=20)
    assert sarah.status_code == 200, sarah.text
    headers = {"Authorization": f"Bearer {sarah.cookies.get('access_token')}"}
    profile = sarah.json()
    marker = "MBR-" + uuid.uuid4().hex
    allergy = "allergy-" + uuid.uuid4().hex
    patched = requests.patch(f"{API}/clients/{profile['subject']}", headers=headers, json={
        "insurance": [{"id": "ins-release", "insurer": "Sample Benefits Co. (demo)", "policy": "POL-" + marker, "memberId": marker, "holderName": "Sarah Thompson", "relationship": "Self"}],
    }, timeout=20)
    assert patched.status_code == 200, patched.text
    assert patched.json()["insurance"][0]["memberId"] == marker
    stored = _stored_client(profile["subject"])
    sealed = stored["insurance"][0]["memberId"]
    assert sealed.startswith("ntenc1:") and marker not in sealed
    visible = requests.get(f"{API}/state", headers=headers, timeout=20).json()
    mine = next(row for row in visible["clients"] if row["id"] == profile["subject"])
    assert mine["insurance"][0]["memberId"] == marker
    maya = requests.post(f"{API}/auth/login", json={"email": "maya.demo@example.com", "password": _required("DEMO_PASSWORD")}, timeout=20)
    practitioner = requests.get(f"{API}/state", headers={"Authorization": f"Bearer {maya.cookies.get('access_token')}"}, timeout=20).text
    assert marker not in practitioner
    submitted = requests.post(f"{API}/intake", headers=headers, json={"allergies": allergy, "medications": "", "concerns": "", "preferences": "", "contraindications": ""}, timeout=20)
    assert submitted.status_code == 200 and submitted.json()["allergies"] == allergy
    intake = _stored_intake(profile["subject"])
    assert intake["allergies"].startswith("ntenc1:") and allergy not in intake["allergies"]
    owner = requests.post(f"{API}/auth/login", json={"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")}, timeout=20)
    log = requests.get(f"{API}/clinical/access", headers={"Authorization": f"Bearer {owner.cookies.get('access_token')}"}, timeout=20).text
    assert marker not in log and allergy not in log


def test_stale_cookie_does_not_block_mfa_challenge():
    """A leftover session cookie must not turn authenticator enrollment into a CSRF failure."""
    previous = _enforcement()
    email = _required("OWNER_EMAIL")
    _set_enforcement(True)
    try:
        session = requests.Session()
        session.cookies.set("access_token", "stale-token", path="/")
        started = session.post(f"{API}/auth/login", json={"email": email, "password": _required("OWNER_PASSWORD")}, timeout=20)
        assert started.status_code == 200, started.text
        body = started.json()
        assert body.get("mfaRequired") is True and not started.cookies.get("access_token")
        if body.get("enrollmentRequired"):
            refused = session.post(f"{API}/auth/mfa/enroll", json={"challenge": "invalid"}, timeout=20)
            # Invalid challenge is rejected by the MFA handler (not CSRF-trapped by stale cookies).
            assert refused.status_code == 401, refused.text
            assert "CSRF" not in refused.text
            empty = session.post(f"{API}/auth/mfa/enroll", json={}, timeout=20)
            assert empty.status_code in (401, 403), empty.text
            assert "CSRF" not in empty.text
            enrolled = session.post(f"{API}/auth/mfa/enroll", json={"challenge": body["challenge"]}, timeout=20)
            assert enrolled.status_code == 200 and enrolled.json().get("secret"), enrolled.text
            invalid_code = session.post(f"{API}/auth/mfa/confirm", json={"challenge": body["challenge"], "code": "invalid"}, timeout=20)
            assert invalid_code.status_code == 400
        else:
            challenged = session.post(f"{API}/auth/mfa/verify", json={"challenge": body["challenge"], "code": "000000"}, timeout=20)
            assert challenged.status_code == 401, challenged.text
    finally:
        _drop_pending_mfa(email)
        _set_enforcement(previous)
