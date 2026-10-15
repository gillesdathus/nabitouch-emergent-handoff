"""Tests for /api/auth/forgot-password and /api/auth/reset-password.

Rules (per review request):
- Only trigger forgot-password emails for delivered@resend.dev or nonexistent emails.
- Never trigger for the configured owner address or demo accounts.
- Do not call /api/demo/reset.
- Clean up delivered@resend.dev user + nt_password_resets + nt_login_attempts we create.
"""
import os
import re
import hashlib
import secrets
import asyncio
import time

_LOOP = asyncio.new_event_loop()


def _run(coro):
    asyncio.set_event_loop(_LOOP)
    return _LOOP.run_until_complete(coro)


import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

def _load_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except FileNotFoundError:
        pass
    return None

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env()
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "delivered@resend.dev"
TEST_PW = "NewPass!234"
NEW_PW = "FreshPass!987"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


async def _get_user(db, email):
    return await db["nt_users"].find_one({"email": email})


async def _ensure_test_user(db, session):
    """Register the test user via /api/auth/register if missing."""
    u = await _get_user(db, TEST_EMAIL)
    if u:
        return u
    r = session.post(f"{API}/auth/register", json={
        "email": TEST_EMAIL, "password": TEST_PW,
        "firstName": "Delivered", "lastName": "Resend",
    })
    assert r.status_code == 200, r.text
    return await _get_user(db, TEST_EMAIL)


@pytest.fixture(scope="module")
def test_user(db, session):
    u = _run(_ensure_test_user(db, session))
    yield u
    # Cleanup
    async def _cleanup():
        await db["nt_password_resets"].delete_many({"userId": u["id"]})
        await db["nt_login_attempts"].delete_many({"identifier": f"email:{TEST_EMAIL}"})
        await db["nt_users"].delete_one({"email": TEST_EMAIL})
        await db["clients"].delete_many({"email": TEST_EMAIL})
    _run(_cleanup())


# --- forgot-password: generic response (no enumeration) ---

def test_forgot_password_unknown_email_returns_ok(session):
    r = session.post(f"{API}/auth/forgot-password",
                     json={"email": f"nope_{uuid.uuid4().hex[:8]}@example.com"})
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert "message" in data


def test_forgot_password_known_email_returns_ok(session, test_user, db):
    # Clean slate
    async def _clear():
        await db["nt_password_resets"].delete_many({"userId": test_user["id"]})
    _run(_clear())

    r = session.post(f"{API}/auth/forgot-password", json={"email": TEST_EMAIL})
    assert r.status_code == 200
    assert r.json().get("ok") is True

    # Verify a nt_password_resets record was created
    async def _count():
        return await db["nt_password_resets"].count_documents({"userId": test_user["id"]})
    cnt = _run(_count())
    assert cnt == 1


def test_forgot_password_rate_limit_4th_no_new_record(session, test_user, db):
    """3 are allowed per 15 min; 4th call still 200 but creates no new record."""
    async def _clear():
        await db["nt_password_resets"].delete_many({"userId": test_user["id"]})
    _run(_clear())

    for _ in range(3):
        r = session.post(f"{API}/auth/forgot-password", json={"email": TEST_EMAIL})
        assert r.status_code == 200

    async def _count():
        return await db["nt_password_resets"].count_documents({"userId": test_user["id"]})
    before = _run(_count())
    assert before == 3

    r4 = session.post(f"{API}/auth/forgot-password", json={"email": TEST_EMAIL})
    assert r4.status_code == 200
    assert r4.json().get("ok") is True

    after = _run(_count())
    assert after == 3, f"4th request must NOT create a new reset record, got {after}"


# --- reset-password flow ---

def _insert_token(db, user_id, minutes_valid=30, used=False):
    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    rec = {
        "tokenHash": hashlib.sha256(raw.encode()).hexdigest(),
        "userId": user_id,
        "used": used,
        "createdAt": now.isoformat(),
        "expiresAt": (now + timedelta(minutes=minutes_valid)).isoformat(),
    }
    _run(db["nt_password_resets"].insert_one(rec))
    return raw


def test_reset_password_invalid_token(session):
    r = session.post(f"{API}/auth/reset-password",
                     json={"token": "totally-bogus", "password": "GoodPass123"})
    assert r.status_code == 400


def test_reset_password_short_password_422(session):
    r = session.post(f"{API}/auth/reset-password",
                     json={"token": "x" * 20, "password": "short"})
    assert r.status_code == 422


def test_reset_password_expired_token(db, session, test_user):
    raw = _insert_token(db, test_user["id"], minutes_valid=-5)  # already expired
    r = session.post(f"{API}/auth/reset-password",
                     json={"token": raw, "password": "NewValid!234"})
    assert r.status_code == 400


def test_reset_password_full_flow(db, session, test_user):
    """Valid token sets password; single-use; old pw fails; new pw works; lockout cleared."""
    # Seed a lockout record to confirm it gets cleared
    async def _seed_lockout():
        await db["nt_login_attempts"].update_one(
            {"identifier": f"email:{TEST_EMAIL}"},
            {"$set": {"count": 9, "lockedUntil": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()}},
            upsert=True,
        )
    _run(_seed_lockout())

    raw = _insert_token(db, test_user["id"])

    # Confirm current password is TEST_PW (not yet reset)
    # (skip: lockout rec would 429, so clear is required anyway)
    r = session.post(f"{API}/auth/reset-password",
                     json={"token": raw, "password": NEW_PW})
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    # 2nd use of same token must fail
    r2 = session.post(f"{API}/auth/reset-password",
                     json={"token": raw, "password": "AnotherOne!234"})
    assert r2.status_code == 400

    # Lockout cleared
    async def _lockout():
        return await db["nt_login_attempts"].find_one({"identifier": f"email:{TEST_EMAIL}"})
    rec = _run(_lockout())
    assert rec is None, "login_attempts for user should be cleared after reset"

    # Old password no longer works
    old = session.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PW})
    assert old.status_code == 401

    # New password works
    good = session.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": NEW_PW})
    assert good.status_code == 200, good.text
    body = good.json()
    assert body.get("email") == TEST_EMAIL
