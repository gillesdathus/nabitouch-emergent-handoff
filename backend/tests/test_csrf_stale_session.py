"""Stale session cookies must not strand guests behind a CSRF 403."""
import pytest
import requests

from t1_common import API, SARAH, login

GEO_BODY = {"line": "10150 104 St NW, Edmonton, AB", "postal": "T5J 0Z9"}


def test_guest_geo_mutation_without_cookies():
    checked = requests.post(f"{API}/geo/check", json=GEO_BODY, timeout=20)
    assert checked.status_code == 200, checked.text


def test_stale_session_cookies_return_session_expired_and_clear():
    stale = "stale.invalid.token"
    response = requests.post(
        f"{API}/geo/check",
        json=GEO_BODY,
        headers={"Cookie": f"access_token={stale}; refresh_token={stale}; csrf_token=abc123abc123abc123abc123ab"},
        timeout=20,
    )
    assert response.status_code == 401, response.text
    assert response.json()["detail"] == "Session expired"
    # Clearing uses Set-Cookie max-age/expires; names must be present on the response.
    set_cookie = ",".join(response.headers.get("Set-Cookie") or response.headers.get("set-cookie") or "")
    if not set_cookie:
        # requests may expose multiple set-cookie via raw headers
        set_cookie = ",".join(v for k, v in response.raw.headers.items() if k.lower() == "set-cookie")
    lowered = set_cookie.lower()
    assert "access_token=" in lowered
    assert "refresh_token=" in lowered
    assert "csrf_token=" in lowered


def test_stale_session_without_csrf_header_is_not_csrf_403():
    response = requests.post(
        f"{API}/geo/confirm",
        json={**GEO_BODY, "clientConfirmed": True},
        headers={"Cookie": "access_token=stale.invalid.token; refresh_token=stale.invalid.token"},
        timeout=20,
    )
    assert response.status_code == 401, response.text
    assert response.json()["detail"] == "Session expired"
    assert "CSRF" not in response.json()["detail"]


def test_live_session_still_requires_csrf():
    session = login(SARAH, csrf=False)
    denied = session.patch(f"{API}/clients/c-sarah", json={"preferredName": "Sarah"}, timeout=20)
    assert denied.status_code == 403, denied.text
    assert denied.json()["detail"] == "CSRF token missing or invalid"
    session.headers["X-CSRF-Token"] = "wrong-token-wrong-token-wrong"
    assert session.patch(f"{API}/clients/c-sarah", json={"preferredName": "Sarah"}, timeout=20).status_code == 403


def test_live_session_accepts_matching_csrf():
    session = login(SARAH, csrf=True)
    allowed = session.get(f"{API}/auth/me", timeout=20)
    assert allowed.status_code == 200, allowed.text
    # Refresh is a cookie mutation that must succeed with a valid CSRF header.
    refreshed = session.post(f"{API}/auth/refresh", timeout=20)
    assert refreshed.status_code == 200, refreshed.text


def test_revoked_session_clears_instead_of_csrf_trap():
    session = login(SARAH, csrf=True)
    access = session.cookies.get("access_token")
    refresh = session.cookies.get("refresh_token")
    csrf = session.cookies.get("csrf_token")
    assert access and refresh and csrf
    assert session.post(f"{API}/auth/logout", timeout=20).status_code == 200
    trapped = requests.post(
        f"{API}/geo/check",
        json=GEO_BODY,
        cookies={"access_token": access, "refresh_token": refresh, "csrf_token": csrf},
        headers={"X-CSRF-Token": csrf},
        timeout=20,
    )
    assert trapped.status_code == 401, trapped.text
    assert trapped.json()["detail"] == "Session expired"


@pytest.mark.parametrize("path", ["/geo/check", "/geo/confirm"])
def test_invalid_access_still_tries_refresh_cookie(path):
    """Invalid access must not short-circuit before refresh is considered (session-gone)."""
    body = GEO_BODY if path.endswith("check") else {**GEO_BODY, "clientConfirmed": True}
    response = requests.post(
        f"{API}{path}",
        json=body,
        headers={"Cookie": "access_token=not-a-jwt; refresh_token=also-not-a-jwt"},
        timeout=20,
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Session expired"
