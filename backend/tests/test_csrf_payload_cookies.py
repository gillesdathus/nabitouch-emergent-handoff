"""Unit tests for CSRF session cookie decoding (no live API required)."""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt

os.environ.setdefault("JWT_SECRET", "csrf-unit-test-secret")

from csrf_session import ALG, session_payload_from_cookies  # noqa: E402


def _token(kind="access", sid="sid-1", *, expired=False, secret=None):
    exp = datetime.now(timezone.utc) + (timedelta(minutes=-5) if expired else timedelta(minutes=15))
    return jwt.encode({"sub": "u-1", "type": kind, "sid": sid, "exp": exp}, secret or os.environ["JWT_SECRET"], algorithm=ALG)


def test_prefers_valid_access_token():
    request = SimpleNamespace(cookies={"access_token": _token("access"), "refresh_token": _token("refresh")})
    payload = session_payload_from_cookies(request)
    assert payload["type"] == "access"
    assert payload["sid"] == "sid-1"


def test_falls_back_to_refresh_when_access_expired():
    request = SimpleNamespace(cookies={"access_token": _token("access", expired=True), "refresh_token": _token("refresh")})
    payload = session_payload_from_cookies(request)
    assert payload["type"] == "refresh"


def test_falls_back_to_refresh_when_access_is_garbage():
    request = SimpleNamespace(cookies={"access_token": "not-a-jwt", "refresh_token": _token("refresh")})
    payload = session_payload_from_cookies(request)
    assert payload is not None
    assert payload["type"] == "refresh"


def test_dead_cookies_yield_none():
    request = SimpleNamespace(cookies={"access_token": "stale.invalid.token", "refresh_token": "stale.invalid.token"})
    assert session_payload_from_cookies(request) is None


def test_wrong_secret_is_dead():
    request = SimpleNamespace(cookies={"access_token": _token("access", secret="other-secret"), "refresh_token": "x"})
    assert session_payload_from_cookies(request) is None
