"""Slice 3.1 — guest-link hardening, worker consistency, and fail-closed tracking."""
import asyncio
import logging
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


BASE = _required("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"


def _login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    token = response.cookies.get("access_token")
    assert token
    return {"Authorization": f"Bearer {token}"}


def _book(headers, practitioner, when, guest=None, service="swedish"):
    body = {
        "source": "online",
        "practitionerId": practitioner,
        "appointment": {
            "serviceSlug": service, "duration": 60, "date": "2027-11-03", "time": when,
            "locationType": "clinic", "paymentMethod": "self",
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }
    if guest:
        body["client"] = guest
    response = requests.post(f"{API}/bookings", headers=headers or {}, json=body, timeout=20)
    assert response.status_code == 200, response.text
    return response.json()


def _fix(seq, lat, lng=-113.49):
    return {"lat": lat, "lng": lng, "accuracy": 12, "seq": seq, "recordedAt": datetime.now(timezone.utc).isoformat(), "source": "gps"}


def _open(token):
    session = requests.Session()
    opened = session.post(f"{API}/tracking/guest/open", json={"token": token}, timeout=20)
    return session, opened


@pytest.fixture(scope="module")
def accounts():
    return {
        "owner": _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD")),
        "maya": _login("maya.demo@example.com", _required("DEMO_PASSWORD")),
        "liam": _login("liam.demo@example.com", _required("DEMO_PASSWORD")),
        "priya": _login("priya.demo@example.com", _required("DEMO_PASSWORD")),
    }


def test_guest_token_stays_out_of_the_url_and_is_not_cached(accounts):
    booked = _book(None, "p-maya", "09:00", {"firstName": "Nell", "lastName": "Guest", "email": "nell.guest@example.com", "phone": "7805550194"})
    token = booked["trackingCapability"]["token"]
    aid = booked["appointment"]["id"]
    moved = requests.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, headers=accounts["maya"], timeout=20)
    assert moved.status_code == 200, moved.text
    started = requests.post(f"{API}/tracking/sessions/{aid}/start", headers=accounts["maya"], timeout=20)
    assert started.status_code == 200, started.text
    accepted = requests.post(f"{API}/tracking/sessions/{aid}/locations", json=_fix(11, 51.2345), headers=accounts["maya"], timeout=20)
    assert accepted.json()["accepted"] is True
    leaked = requests.get(f"{API}/tracking/guest/{token}", timeout=20)
    assert leaked.status_code == 404
    session, opened = _open(token)
    assert opened.status_code == 200, opened.text
    assert opened.headers["cache-control"] == "no-store"
    assert opened.headers["referrer-policy"] == "no-referrer"
    assert opened.json()["position"]["lat"] == 51.2345
    assert session.cookies.get("nt_track")
    assert token not in opened.text
    assert "httponly" in opened.headers.get("set-cookie", "").lower()
    state = requests.get(f"{API}/state", headers=accounts["owner"], timeout=20).json()
    stored = next(item for item in state["appointments"] if item["id"] == aid)
    assert "51.2345" not in str(stored)
    assert all("51.2345" not in (row.get("action") or "") for row in state["audit"])
    stopped = requests.post(f"{API}/tracking/sessions/{aid}/stop", headers=accounts["maya"], timeout=20)
    assert stopped.status_code == 200, stopped.text
    quiet = session.get(f"{API}/tracking/guest/session", timeout=20).json()
    assert quiet["phase"] == "stopped" and "position" not in quiet


def test_guest_revocation_expiration_reassignment_cancellation_and_concurrency(accounts):
    if not os.environ.get("REDIS_URL"):
        pytest.fail("REDIS_URL is required for tracking tests")
    first = _book(None, "p-maya", "11:00", {"firstName": "Ida", "lastName": "Guest", "email": "ida.guest@example.com", "phone": "7805550195"})
    second = _book(None, "p-liam", "13:00", {"firstName": "Otto", "lastName": "Guest", "email": "otto.guest@example.com", "phone": "7805550196"})
    for booking, headers in ((first, accounts["maya"]), (second, accounts["liam"])):
        aid = booking["appointment"]["id"]
        assert requests.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, headers=headers, timeout=20).status_code == 200
        assert requests.post(f"{API}/tracking/sessions/{aid}/start", headers=headers, timeout=20).status_code == 200
        assert requests.post(f"{API}/tracking/sessions/{aid}/locations", json=_fix(3, 53.5), headers=headers, timeout=20).json()["accepted"] is True
    token = first["trackingCapability"]["token"]
    aid = first["appointment"]["id"]

    def read():
        return requests.post(f"{API}/tracking/guest/open", json={"token": token}, timeout=20)

    with ThreadPoolExecutor(max_workers=4) as pool:
        live = list(pool.map(lambda _: read(), range(6)))
    assert all(item.status_code == 200 and item.json()["appointmentId"] == aid and item.json()["position"]["lat"] == 53.5 for item in live)
    reassigned = requests.post(f"{API}/appointments/{aid}/event", headers=accounts["owner"], json={"kind": "reassigned", "set": {"practitionerId": "p-priya"}}, timeout=20)
    assert reassigned.status_code == 200, reassigned.text
    with ThreadPoolExecutor(max_workers=4) as pool:
        revoked = list(pool.map(lambda _: read(), range(6)))
    assert all(item.status_code == 401 for item in revoked)
    assert requests.post(f"{API}/tracking/sessions/{aid}/locations", json=_fix(9, 53.5), headers=accounts["maya"]).status_code == 403
    cancelled = requests.post(f"{API}/appointments/{second['appointment']['id']}/transition", json={"to": "cancelled"}, headers=accounts["liam"], timeout=20)
    assert cancelled.status_code == 200, cancelled.text
    assert requests.post(f"{API}/tracking/guest/open", json={"token": second["trackingCapability"]["token"]}, timeout=20).status_code == 401

    async def expire():
        import tracking_store
        tracking_store._pool = None
        short = await tracking_store.issue_capability("unit-31-expire", ttl=1)
        browser = await tracking_store.open_guest_browser(short, ttl=30)
        assert browser
        await asyncio.sleep(1.4)
        assert await tracking_store.lookup_capability(short) is None
        assert await tracking_store.lookup_browser(browser) is None
        lasting = await tracking_store.issue_capability("unit-31-revoke", ttl=60)
        browser = await tracking_store.open_guest_browser(lasting, ttl=60)
        await tracking_store.revoke_capabilities("unit-31-revoke")
        assert await tracking_store.lookup_capability(lasting) is None
        assert await tracking_store.lookup_browser(browser) is None

    asyncio.run(expire())


def test_tracking_phases_stay_distinct(accounts):
    if not os.environ.get("REDIS_URL"):
        pytest.fail("REDIS_URL is required for tracking tests")
    booked = _book(None, "p-priya", "15:00", {"firstName": "Bea", "lastName": "Guest", "email": "bea.guest@example.com", "phone": "7805550197"}, service="prenatal")
    aid = booked["appointment"]["id"]
    assert requests.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, headers=accounts["priya"], timeout=20).status_code == 200
    waiting = requests.get(f"{API}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20).json()
    assert waiting["phase"] == "unavailable" and "position" not in waiting
    assert requests.post(f"{API}/tracking/sessions/{aid}/start", headers=accounts["priya"], timeout=20).status_code == 200
    assert requests.post(f"{API}/tracking/sessions/{aid}/locations", json=_fix(4, 53.48), headers=accounts["priya"], timeout=20).json()["accepted"] is True

    async def age_the_fix():
        import tracking_store
        tracking_store._pool = None
        current = await tracking_store.read_fix(aid)
        current["receivedTs"] = time.time() - 45
        await tracking_store.force_set(aid, current)

    asyncio.run(age_the_fix())
    stale = requests.get(f"{API}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20).json()
    assert stale["phase"] == "stale" and stale["stale"] is True and stale["position"]["lat"] == 53.48

    async def forget_the_fix():
        import tracking_store
        tracking_store._pool = None
        await tracking_store.drop_session(aid)

    asyncio.run(forget_the_fix())
    expired = requests.get(f"{API}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20).json()
    assert expired["phase"] == "expired" and "position" not in expired
    assert requests.post(f"{API}/tracking/sessions/{aid}/start", headers=accounts["priya"], timeout=20).status_code == 200
    assert requests.post(f"{API}/tracking/sessions/{aid}/stop", headers=accounts["priya"], timeout=20).status_code == 200
    stopped = requests.get(f"{API}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20).json()
    assert stopped["phase"] == "stopped" and "position" not in stopped
    assert requests.post(f"{API}/appointments/{aid}/transition", json={"to": "arrived"}, headers=accounts["priya"], timeout=20).status_code == 200
    assert requests.get(f"{API}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20).json()["phase"] == "arrived"
    assert requests.post(f"{API}/appointments/{aid}/transition", json={"to": "in_session"}, headers=accounts["priya"], timeout=20).status_code == 200
    done = requests.get(f"{API}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20).json()
    assert done["phase"] == "completed" and "position" not in done


def test_two_workers_share_one_redis(accounts):
    if not os.environ.get("REDIS_URL"):
        pytest.fail("REDIS_URL is required for tracking tests")
    port = 8123
    root = os.path.dirname(os.path.dirname(__file__))
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=root, env=os.environ.copy(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    other = f"http://127.0.0.1:{port}/api"
    try:
        ready = False
        for _ in range(40):
            if proc.poll() is not None:
                break
            try:
                if requests.get(f"{other}/", timeout=1).status_code == 200:
                    ready = True
                    break
            except requests.RequestException:
                time.sleep(0.5)
        assert ready, "second tracking worker did not start"
        booked = _book(None, "p-liam", "17:00", {"firstName": "Wes", "lastName": "Guest", "email": "wes.guest@example.com", "phone": "7805550198"})
        aid = booked["appointment"]["id"]
        assert requests.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, headers=accounts["liam"], timeout=20).status_code == 200
        assert requests.post(f"{API}/tracking/sessions/{aid}/start", headers=accounts["liam"], timeout=20).status_code == 200
        assert requests.post(f"{API}/tracking/sessions/{aid}/locations", json=_fix(20, 53.41), headers=accounts["liam"], timeout=20).json()["accepted"] is True
        seen = requests.get(f"{other}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20)
        assert seen.status_code == 200, seen.text
        assert seen.json()["position"]["lat"] == 53.41
        assert requests.post(f"{other}/tracking/sessions/{aid}/locations", json=_fix(21, 53.42), headers=accounts["liam"], timeout=20).json()["accepted"] is True
        echoed = requests.get(f"{API}/tracking/sessions/{aid}", headers=accounts["owner"], timeout=20).json()
        assert echoed["position"]["lat"] == 53.42 and echoed["appointmentId"] == aid
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_redis_outage_hides_gps_and_booking_still_works(monkeypatch):
    import tracking_store
    from fastapi.testclient import TestClient
    import server

    class Dead:
        def __getattr__(self, _name):
            async def fail(*_args, **_kwargs):
                raise tracking_store.redis.RedisError("down")
            return fail

    with TestClient(server.app) as client:
        login = client.post("/api/auth/login", json={"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")})
        assert login.status_code == 200, login.text
        token = login.cookies.get("access_token")
        client.headers["Authorization"] = f"Bearer {token}"
        original = tracking_store.client
        tracking_store.client = lambda: Dead()
        try:
            hidden = client.get("/api/tracking/sessions/a-106")
            assert hidden.status_code == 503
            assert "position" not in hidden.text
            booked = client.post("/api/bookings", json={
            "source": "online",
            "practitionerId": "p-priya",
            "appointment": {
                "serviceSlug": "prenatal", "duration": 60, "date": "2027-11-04", "time": "09:30",
                "locationType": "clinic", "paymentMethod": "self",
                "address": {"lat": 53.5461, "lng": -113.4938},
            },
        })
            assert booked.status_code == 200, booked.text
            assert booked.json().get("appointment", {}).get("id")
            assert client.get("/api/").status_code == 200
        finally:
            tracking_store.client = original

    async def reconnect():
        original = os.environ["REDIS_URL"]
        tracking_store._pool = None
        os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0?socket_connect_timeout=0.3&socket_timeout=0.3"
        tracking_store._pool = None
        try:
            with pytest.raises(tracking_store.TrackingUnavailable):
                await tracking_store.read_fix("unit-31-down")
        finally:
            tracking_store._pool = None
            os.environ["REDIS_URL"] = original
            tracking_store._pool = None
        await tracking_store.force_set("unit-31-down", {"seq": 1, "lat": 53.2, "lng": -113.2})
        assert (await tracking_store.read_fix("unit-31-down"))["seq"] == 1
        await tracking_store.drop_session("unit-31-down")

    asyncio.run(reconnect())


def test_production_seed_cannot_share_and_redis_must_be_locked(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    from seed import build_seed
    seeded = build_seed()["appointments"]
    assert all(not (item.get("trip") or {}).get("sharing") for item in seeded)
    import config
    with pytest.raises(RuntimeError, match="rediss"):
        config.validate_redis("redis://localhost:6379/0")
    with pytest.raises(RuntimeError, match="password"):
        config.validate_redis("rediss://localhost:6379/0")
    config.validate_redis("rediss://:example-password@redis.internal:6380/0")
    import tracking
    monkeypatch.setattr(tracking, "is_production", lambda: True)
    assert tracking.trip_sharing({"status": "en_route", "trip": {"sharing": True, "simulated": True}}) is False
    assert tracking.trip_sharing({"status": "en_route", "trip": {"sharing": True, "sharingSource": "practitioner"}}) is True


def test_logs_drop_coordinates_and_guest_paths():
    from redact import AccessPathRedact, RedactLogFilter
    message = logging.LogRecord("tracking", logging.INFO, __file__, 1, 'stored {"lat": 51.2345, "lng": -113.49} token=abcdefghijklmnop', (), None)
    assert RedactLogFilter().filter(message) is True
    assert "51.2345" not in message.msg and "abcdefghijklmnop" not in message.msg
    access = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d', ("127.0.0.1", "GET", "/api/tracking/guest/secret-token", "1.1", 200), None)
    assert AccessPathRedact().filter(access) is True
    assert access.args[2] == "/api/tracking/guest/[redacted]"
