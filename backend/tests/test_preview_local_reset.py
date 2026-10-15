"""Preview password reset stays local. Production never receives a reset code in the response."""
import os
import uuid

import pytest
import requests

from auth import preview_local_reset


def test_preview_local_reset_is_off_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("EMAIL_PROVIDER", "mock")
    assert preview_local_reset() is False


def test_preview_local_reset_is_on_for_the_local_mock(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("EMAIL_PROVIDER", "mock")
    assert preview_local_reset() is True


@pytest.mark.skipif(not os.environ.get("API_URL"), reason="live preview API is not configured")
def test_preview_reset_replaces_the_password_and_clears_attempts():
    from pymongo import MongoClient
    import bcrypt

    api = os.environ["API_URL"].rstrip("/")
    email = f"preview.reset.{uuid.uuid4().hex[:10]}@example.com"
    old_pw = f"Old-{uuid.uuid4().hex}"
    new_pw = f"New-{uuid.uuid4().hex}"
    user_id = str(uuid.uuid4())
    client = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=4000)
    db = client[os.environ["DB_NAME"]]
    assert db.name == "nabitouch_preview"
    db.nt_users.insert_one({
        "id": user_id, "email": email, "role": "client", "demo": False, "subject": user_id,
        "password_hash": bcrypt.hashpw(old_pw.encode(), bcrypt.gensalt()).decode(),
        "name": "Preview Reset",
    })
    db.nt_login_attempts.insert_one({"identifier": f"email:{email}", "count": 4, "lockedUntil": "2099-01-01T00:00:00+00:00"})
    try:
        unknown = requests.post(f"{api}/api/auth/forgot-password", json={"email": f"missing.{uuid.uuid4().hex[:8]}@example.com"}, timeout=20)
        assert unknown.status_code == 200
        assert "previewResetToken" not in unknown.json()

        asked = requests.post(f"{api}/api/auth/forgot-password", json={"email": email}, timeout=20)
        assert asked.status_code == 200
        token = asked.json().get("previewResetToken") or ""
        assert len(token) >= 20

        wrong = requests.post(f"{api}/api/auth/login", json={"email": email, "password": "not-the-password"}, timeout=20)
        assert wrong.status_code == 401
        assert wrong.json().get("detail") == "Invalid email or password"

        reset = requests.post(f"{api}/api/auth/reset-password", json={"token": token, "password": new_pw}, timeout=20)
        assert reset.status_code == 200
        assert db.nt_login_attempts.find_one({"identifier": f"email:{email}"}) is None

        stale = requests.post(f"{api}/api/auth/login", json={"email": email, "password": old_pw}, timeout=20)
        assert stale.status_code == 401

        signed = requests.post(f"{api}/api/auth/login", json={"email": email, "password": new_pw}, timeout=20)
        assert signed.status_code == 200
        body = signed.json()
        assert body.get("role") == "client"
        assert body.get("enrollmentRequired") is not True
        assert signed.cookies.get("access_token")
    finally:
        db.nt_users.delete_one({"id": user_id})
        db.nt_password_resets.delete_many({"userId": user_id})
        db.nt_login_attempts.delete_many({"identifier": f"email:{email}"})
        db.nt_sessions.delete_many({"userId": user_id})
        client.close()
