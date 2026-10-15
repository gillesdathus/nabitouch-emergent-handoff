"""Slice 3 — multi-practitioner tracking, Redis sessions, and guest capabilities."""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import httpx
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


def _book(headers, practitioner, when, guest=None, service="swedish", day="2027-08-18"):
    body = {
        "source": "online",
        "practitionerId": practitioner,
        "appointment": {
            "serviceSlug": service, "duration": 60, "date": day, "time": when,
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


def _share(aid, headers):
    started = requests.post(f"{API}/tracking/sessions/{aid}/start", headers=headers, timeout=20)
    assert started.status_code == 200, started.text


@pytest.fixture(scope="module")
def accounts():
    return {
        "owner": _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD")),
        "maya": _login("maya.demo@example.com", _required("DEMO_PASSWORD")),
        "liam": _login("liam.demo@example.com", _required("DEMO_PASSWORD")),
        "priya": _login("priya.demo@example.com", _required("DEMO_PASSWORD")),
        "sarah": _login("sarah.demo@example.com", _required("DEMO_PASSWORD")),
        "desk": _login("reception.demo@example.com", _required("DEMO_PASSWORD")),
    }


def test_concurrent_practitioners_stay_isolated(accounts):
    cleared = requests.patch(f"{API}/settings/app", headers=accounts["owner"], json={"liveGpsPractitionerId": None}, timeout=20)
    assert cleared.status_code == 200, cleared.text
    day = f"2027-07-{(uuid.uuid4().int % 27) + 1:02d}"
    maya = _book(None, "p-maya", "10:00", {"firstName": "Gus", "lastName": "One", "email": "gus.one@example.com", "phone": "7805550191"}, day=day)
    liam = _book(None, "p-liam", "14:00", {"firstName": "Gus", "lastName": "Two", "email": "gus.two@example.com", "phone": "7805550192"}, day=day)
    assert "trackingCapability" in maya and "trackingCapability" not in _book(accounts["sarah"], "p-priya", "16:00", service="prenatal", day=day)
    for booking, headers in ((maya, accounts["maya"]), (liam, accounts["liam"])):
        aid = booking["appointment"]["id"]
        moved = requests.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, headers=headers, timeout=20)
        assert moved.status_code == 200, moved.text
        _share(aid, headers)
    maya_id = maya["appointment"]["id"]
    liam_id = liam["appointment"]["id"]
    assert requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(3, 53.51), headers=accounts["liam"]).status_code == 403
    assert requests.post(f"{API}/tracking/sessions/{liam_id}/locations", json=_fix(3, 53.44), headers=accounts["maya"]).status_code == 403
    assert requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(3, 53.51), headers=accounts["owner"]).status_code == 403
    assert requests.get(f"{API}/tracking/sessions/{maya_id}", headers=accounts["sarah"]).status_code == 403
    assert requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(4, 53.51), headers=accounts["maya"]).json()["accepted"] is True
    assert requests.post(f"{API}/tracking/sessions/{liam_id}/locations", json=_fix(4, 53.44), headers=accounts["liam"]).json()["accepted"] is True
    maya_view = requests.get(f"{API}/tracking/sessions/{maya_id}", headers=accounts["owner"]).json()
    liam_view = requests.get(f"{API}/tracking/sessions/{liam_id}", headers=accounts["desk"]).json()
    assert maya_view["position"]["lat"] == 53.51 and liam_view["position"]["lat"] == 53.44
    assert maya_view["eta"]["confirmed"] is False
    assert maya_view["eta"]["provider"] in ("estimated", "mapbox-traffic")
    perms = requests.get(f"{API}/state", headers=accounts["owner"], timeout=20).json()["settings"][0]["receptionPerms"]
    try:
        requests.patch(f"{API}/settings/app", headers=accounts["owner"], json={"receptionPerms": {**perms, "viewLocations": False, "viewEta": True}}, timeout=20)
        restricted = requests.get(f"{API}/tracking/sessions/{liam_id}", headers=accounts["desk"], timeout=20)
        assert restricted.status_code == 200, restricted.text
        assert "position" not in restricted.json() and restricted.json().get("eta", {}).get("confirmed") is False
    finally:
        requests.patch(f"{API}/settings/app", headers=accounts["owner"], json={"receptionPerms": perms}, timeout=20)
    guest_http = requests.Session()
    guest = guest_http.post(f"{API}/tracking/guest/open", json={"token": maya["trackingCapability"]["token"]}, timeout=20)
    assert guest.status_code == 200 and guest.json()["position"]["lat"] == 53.51
    assert "token" not in guest.json()
    assert requests.get(f"{API}/tracking/sessions/{maya_id}/stream", timeout=20).status_code == 401
    denied = requests.get(f"{API}/tracking/sessions/{maya_id}/stream", headers=accounts["sarah"], timeout=20)
    assert denied.status_code == 403
    with guest_http.get(f"{API}/tracking/guest/stream", stream=True, timeout=(5, 10)) as stream:
        assert stream.status_code == 200
        assert b"data:" in next(stream.iter_content(256))
    duplicate = requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(4, 53.52), headers=accounts["maya"]).json()
    assert duplicate["accepted"] is False and duplicate["reason"] == "out_of_order"
    stale = requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(2, 53.52), headers=accounts["maya"]).json()
    assert stale["accepted"] is False and stale["reason"] == "out_of_order"
    paused = requests.post(f"{API}/tracking/sessions/{maya_id}/pause", headers=accounts["maya"], timeout=20)
    assert paused.status_code == 200
    assert requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(5, 53.52), headers=accounts["maya"]).json()["reason"] == "paused"
    quiet = requests.get(f"{API}/tracking/sessions/{maya_id}", headers=accounts["owner"]).json()
    assert quiet["phase"] == "paused" and "position" not in quiet
    requests.post(f"{API}/tracking/sessions/{maya_id}/resume", headers=accounts["maya"], timeout=20)
    events = requests.get(f"{API}/tracking/events", headers=accounts["owner"], timeout=20).json()["events"]
    assert all("lat" not in (event.get("payload") or {}) and "lng" not in (event.get("payload") or {}) for event in events)
    reassigned = requests.post(f"{API}/appointments/{maya_id}/event", headers=accounts["owner"], json={"kind": "reassigned", "set": {"practitionerId": "p-priya"}}, timeout=20)
    assert reassigned.status_code == 200, reassigned.text
    assert requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(6, 53.51), headers=accounts["maya"]).status_code == 403
    assert requests.post(f"{API}/tracking/guest/open", json={"token": maya["trackingCapability"]["token"]}, timeout=20).status_code == 401
    hidden = requests.get(f"{API}/tracking/sessions/{maya_id}", headers=accounts["owner"]).json()
    assert hidden["sharing"] is False and "position" not in hidden
    _share(maya_id, accounts["priya"])
    assert requests.post(f"{API}/tracking/sessions/{maya_id}/locations", json=_fix(1, 53.50), headers=accounts["priya"]).json()["accepted"] is True
    arrived = requests.post(f"{API}/appointments/{maya_id}/transition", json={"to": "arrived"}, headers=accounts["priya"], timeout=20)
    assert arrived.status_code == 200, arrived.text
    after = requests.get(f"{API}/tracking/sessions/{maya_id}", headers=accounts["owner"]).json()
    assert after["phase"] == "arrived" and "position" not in after
    leftover = requests.get(f"{API}/tracking/events", headers=accounts["owner"], timeout=20).json()["events"]
    assert all(event["type"] not in ("location.updated", "eta.updated") or event["appointmentId"] != maya_id for event in leftover)
    cancelled = requests.post(f"{API}/appointments/{liam_id}/transition", json={"to": "cancelled"}, headers=accounts["liam"], timeout=20)
    assert cancelled.status_code == 200, cancelled.text
    assert requests.post(f"{API}/tracking/sessions/{liam_id}/locations", json=_fix(8, 53.44), headers=accounts["liam"]).status_code == 409
    assert requests.post(f"{API}/tracking/guest/open", json={"token": liam["trackingCapability"]["token"]}, timeout=20).status_code == 401


def test_redis_sessions_are_atomic_and_expire():
    if not os.environ.get("REDIS_URL"):
        pytest.fail("REDIS_URL is required for tracking tests")

    async def go():
        import tracking_store
        tracking_store._pool = None
        import redis.asyncio as redis
        from tracking_store import accept_fix, drop_session, force_set, issue_capability, lookup_capability, poll_events, publish_event, read_fix, revoke_capabilities
        aid = "unit-slice3"
        await drop_session(aid)
        await force_set(aid, {"seq": 1, "lat": 53.1, "lng": -113.1, "practitionerId": "p"})
        url = os.environ["REDIS_URL"]
        left = redis.from_url(url, decode_responses=True)
        right = redis.from_url(url, decode_responses=True)
        script = """
        local key = KEYS[1]
        local seq = tonumber(ARGV[1])
        local body = ARGV[2]
        local cur = redis.call('HGET', key, 'seq')
        if cur and seq <= tonumber(cur) then return cur end
        redis.call('HSET', key, 'seq', seq, 'body', body)
        redis.call('EXPIRE', key, 120)
        return 'ok'
        """
        body_a = '{"seq": 2, "lat": 53.2, "lng": -113.2}'
        body_b = '{"seq": 2, "lat": 53.8, "lng": -113.8}'
        one, two = await asyncio.gather(
            left.eval(script, 1, f"nt:trk:fix:{aid}", "2", body_a),
            right.eval(script, 1, f"nt:trk:fix:{aid}", "2", body_b),
        )
        assert [one, two].count("ok") == 1
        saved = await read_fix(aid)
        assert saved["seq"] == 2 and saved["lat"] in (53.2, 53.8)
        rejected = await accept_fix(aid, 2, {"seq": 2, "lat": 1, "lng": 1})
        assert rejected == 2
        await force_set("unit-slice3-ttl", {"seq": 1, "lat": 1, "lng": 2, "receivedTs": 1}, ttl=1)
        assert await read_fix("unit-slice3-ttl")
        await asyncio.sleep(1.4)
        assert await read_fix("unit-slice3-ttl") is None
        token = await issue_capability("unit-slice3-cap", ttl=1)
        assert (await lookup_capability(token))["appointmentId"] == "unit-slice3-cap"
        await asyncio.sleep(1.4)
        assert await lookup_capability(token) is None
        lasting = await issue_capability("unit-slice3-revoke", ttl=60)
        await revoke_capabilities("unit-slice3-revoke")
        assert await lookup_capability(lasting) is None
        await publish_event({"type": "location.updated", "appointmentId": aid, "payload": {"lat": 53.2, "lng": -113.2, "seq": 2}})
        _, events = await poll_events(0)
        mine = [event for event in events if event.get("appointmentId") == aid and event.get("type") == "location.updated"]
        assert mine and "lat" not in mine[-1]["payload"] and "lng" not in mine[-1]["payload"]
        await drop_session(aid)
        await left.aclose()
        await right.aclose()

    asyncio.run(go())


def test_mapbox_failure_uses_an_estimate(monkeypatch):
    monkeypatch.setenv("MAPBOX_TOKEN", "sk.test-not-a-live-token")

    class Boom:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            raise httpx.ConnectError("down")

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(httpx, "AsyncClient", Boom)
    import tracking_store
    tracking_store._pool = None
    from tracking import MapboxDirections
    eta, route = asyncio.run(MapboxDirections().eta("mapbox-fallback", {"lat": 53.55, "lng": -113.50}, {"lat": 53.54, "lng": -113.49}))
    assert eta["provider"] == "estimated" and eta["confirmed"] is False and route is None
