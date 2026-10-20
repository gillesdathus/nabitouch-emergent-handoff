"""QR enrollment uses the existing TOTP secret and does not replace an authenticator that is already on."""
import os
import uuid
from urllib.parse import parse_qs, quote, urlparse

import pytest
import requests

from auth import provisioning_uri
from totp import matching_counter, totp


def test_provisioning_uri_matches_the_totp_settings():
    secret = "JBSWY3DPEHPK3PXP"
    email = "person@example.com"
    uri = provisioning_uri(email, secret)
    parsed = urlparse(uri)
    query = parse_qs(parsed.query)
    assert parsed.scheme == "otpauth"
    assert parsed.netloc == "totp"
    assert parsed.path == f"/Nabitouch:{quote(email, safe='')}"
    assert query["issuer"] == ["Nabitouch"]
    assert query["algorithm"] == ["SHA1"]
    assert query["digits"] == ["6"]
    assert query["period"] == ["30"]
    assert query["secret"] == [secret]
    assert "http://" not in uri and "https://" not in uri
    code = totp(secret)
    assert matching_counter(secret, code) is not None
    wrong = "000000" if code != "000000" else "111111"
    assert matching_counter(secret, wrong) is None


def test_provisioning_uri_is_not_logged(caplog):
    import logging
    secret = "JBSWY3DPEHPK3PXP"
    with caplog.at_level(logging.DEBUG):
        uri = provisioning_uri("person@example.com", secret)
    assert secret not in caplog.text
    assert uri not in caplog.text


@pytest.mark.skipif(not os.environ.get("API_URL"), reason="live preview API is not configured")
def test_qr_enrollment_follows_password_verification_and_leaves_existing_mfa():
    import bcrypt
    from pymongo import MongoClient

    api = os.environ["API_URL"].rstrip("/")
    email = f"qr.enroll.{uuid.uuid4().hex[:10]}@example.com"
    password = f"Qr-{uuid.uuid4().hex}"
    user_id = str(uuid.uuid4())
    client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=4000)
    db = client[os.environ["DB_NAME"]]
    assert db.name == "nabitouch_preview" or db.name.startswith("nabitouch_qa_codex_")
    db.nt_users.insert_one({
        "id": user_id, "email": email, "role": "desk", "demo": False, "subject": user_id,
        "password_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
        "name": "QR Enrollment",
    })
    try:
        blocked = requests.post(f"{api}/api/auth/mfa/enroll", json={}, timeout=20)
        assert blocked.status_code == 401
        rejected = requests.post(f"{api}/api/auth/login", json={"email": email, "password": "not-the-password"}, timeout=20)
        assert rejected.status_code == 401
        assert rejected.json().get("detail") == "Invalid email or password"
        assert "challenge" not in rejected.json()

        signed = requests.post(f"{api}/api/auth/login", json={"email": email, "password": password}, timeout=20)
        assert signed.status_code == 200
        body = signed.json()
        if not body.get("enrollmentRequired"):
            pytest.skip("Staff MFA enforcement is off in this isolated QA environment")
        assert signed.cookies.get("access_token") is None
        challenge = body.get("challenge") or ""
        assert len(challenge) >= 20

        enrolled = requests.post(f"{api}/api/auth/mfa/enroll", json={"challenge": challenge}, timeout=20)
        assert enrolled.status_code == 200
        assert enrolled.headers.get("Cache-Control") == "no-store"
        assert enrolled.headers.get("Referrer-Policy") == "no-referrer"
        body = enrolled.json()
        parsed = urlparse(body["otpauth"])
        query = parse_qs(parsed.query)
        assert parsed.scheme == "otpauth" and parsed.netloc == "totp"
        assert query.get("issuer") == ["Nabitouch"]
        assert query.get("algorithm") == ["SHA1"]
        assert query.get("digits") == ["6"]
        assert query.get("period") == ["30"]
        assert query.get("secret", [None])[0] == body["secret"]
        assert "http://" not in body["otpauth"] and "https://" not in body["otpauth"]
        assert len(body["recoveryCodes"]) == 8

        wrong = "000000" if totp(body["secret"]) != "000000" else "111111"
        refused = requests.post(f"{api}/api/auth/mfa/confirm", json={"challenge": challenge, "code": wrong}, timeout=20)
        assert refused.status_code == 400
        assert db.nt_mfa.find_one({"userId": user_id})["enabled"] is False

        confirmed = requests.post(f"{api}/api/auth/mfa/confirm", json={"challenge": challenge, "code": totp(body["secret"])}, timeout=20)
        assert confirmed.status_code == 200
        assert confirmed.json().get("role") == "desk"
        assert confirmed.cookies.get("access_token")
        stored = db.nt_mfa.find_one({"userId": user_id})
        assert stored["enabled"] is True

        session = requests.Session()
        session.cookies.update(confirmed.cookies)
        session.headers["X-CSRF-Token"] = confirmed.cookies.get("csrf_token")
        again = session.post(f"{api}/api/auth/mfa/enroll", json={}, timeout=20)
        assert again.status_code == 409
        untouched = db.nt_mfa.find_one({"userId": user_id})["secret"] == stored["secret"]
        assert untouched is True
        assert db.nt_mfa.find_one({"userId": user_id})["enabled"] is True
    finally:
        db.nt_users.delete_one({"id": user_id})
        db.nt_mfa.delete_many({"userId": user_id})
        db.nt_password_resets.delete_many({"userId": user_id})
        db.nt_login_attempts.delete_many({"identifier": f"email:{email}"})
        db.nt_sessions.delete_many({"userId": user_id})
        client.close()
