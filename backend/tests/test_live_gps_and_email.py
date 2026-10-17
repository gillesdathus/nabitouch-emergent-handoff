"""Iteration 7 — Live GPS trial + booking email tests.

Covers:
- Owner PATCH settings.liveGpsPractitionerId persistence
- Tracking ingest rejects source='simulated' for the trial practitioner (live_gps_required)
- Tracking ingest accepts source='gps' for the trial practitioner
- Non-trial practitioner still accepts source='simulated'
- GET /api/tracking/sessions/{aid} and /api/tracking/active include 'source'
- Booking email: @example.com clients get no email send; real client triggers audit entry
"""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta
import pytest
import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


_API_ROOT = os.environ.get("API_URL") or _required("REACT_APP_BACKEND_URL")
API = _API_ROOT.rstrip("/") if _API_ROOT.rstrip("/").endswith("/api") else f"{_API_ROOT.rstrip('/')}/api"
OWNER = {"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")}
DEMO_PW = _required("DEMO_PASSWORD")
TEST_CLIENT_EMAIL = "delivered@resend.dev"
TEST_CLIENT_PW = "TestPass!234"
TRIAL_PID = "p-maya"
TRIAL_APPT = "a-101"
NON_TRIAL_APPT = "a-106"  # p-liam en_route


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    tok = r.cookies.get("access_token") or r.json().get("accessToken")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_h():
    return _login(OWNER["email"], OWNER["password"])


@pytest.fixture(scope="module")
def maya_h():
    return _login("maya.demo@example.com", DEMO_PW)


@pytest.fixture(scope="module")
def liam_h():
    return _login("liam.demo@example.com", DEMO_PW)


def _ensure_enroute(owner_h, aid, practitioner_h):
    """Reset demo data, then reach en_route through the lifecycle. Status is not writable by PATCH."""
    reset = requests.post(f"{API}/demo/reset", headers=owner_h, timeout=30)
    assert reset.status_code == 200, reset.text
    appt = next(a for a in requests.get(f"{API}/state", headers=owner_h).json()["appointments"] if a["id"] == aid)
    if appt["status"] != "en_route":
        assert appt["status"] in ("assigned", "confirmed", "preparing"), appt["status"]
        r = requests.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, headers=practitioner_h)
        assert r.status_code == 200, f"transition {aid}->en_route: {r.status_code} {r.text}"
    started = requests.post(f"{API}/tracking/sessions/{aid}/start", headers=practitioner_h)
    assert started.status_code == 200, started.text


def _fix(seq, source="simulated", lat=53.53, lng=-113.50, acc=10):
    return {"lat": lat, "lng": lng, "accuracy": acc, "seq": seq,
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "source": source}


# ---------- Settings & GPS trial ----------

def test_patch_live_gps_trial_persists(owner_h):
    # Set trial
    r = requests.patch(f"{API}/settings/app", headers=owner_h,
                       json={"liveGpsPractitionerId": TRIAL_PID, "_actor": "TestOwner"})
    assert r.status_code == 200, r.text
    s = requests.get(f"{API}/state", headers=owner_h).json()["settings"][0]
    assert s["liveGpsPractitionerId"] == TRIAL_PID
    # Off
    r = requests.patch(f"{API}/settings/app", headers=owner_h,
                       json={"liveGpsPractitionerId": None, "_actor": "TestOwner"})
    assert r.status_code == 200
    s = requests.get(f"{API}/state", headers=owner_h).json()["settings"][0]
    assert s.get("liveGpsPractitionerId") in (None, "")


# ---------- Tracking ingest with trial on ----------

def test_trial_rejects_simulated_accepts_gps(owner_h, maya_h):
    _ensure_enroute(owner_h, TRIAL_APPT, maya_h)
    requests.patch(f"{API}/settings/app", headers=owner_h,
                   json={"liveGpsPractitionerId": TRIAL_PID, "_actor": "TestOwner"})

    # Simulated fix → rejected
    r = requests.post(f"{API}/tracking/sessions/{TRIAL_APPT}/locations",
                      json=_fix(10001, source="simulated"), headers=maya_h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("accepted") is False
    assert body.get("reason") == "live_gps_required"

    # GPS fix → accepted
    r = requests.post(f"{API}/tracking/sessions/{TRIAL_APPT}/locations",
                      json=_fix(10002, source="gps"), headers=maya_h)
    assert r.status_code == 200, r.text
    assert r.json().get("accepted") is True

    # Session includes source=gps
    s = requests.get(f"{API}/tracking/sessions/{TRIAL_APPT}", headers=owner_h).json()
    assert s.get("source") == "gps"
    assert "position" in s

    # /tracking/active includes source
    act = requests.get(f"{API}/tracking/active", headers=owner_h).json()
    hit = [x for x in act if x["appointmentId"] == TRIAL_APPT]
    assert hit and hit[0].get("source") == "gps"


def test_non_trial_practitioner_still_accepts_simulated(owner_h, liam_h):
    # Trial = p-maya; p-liam appointment (a-106) should still accept simulated
    _ensure_enroute(owner_h, NON_TRIAL_APPT, liam_h)
    requests.patch(f"{API}/settings/app", headers=owner_h,
                   json={"liveGpsPractitionerId": TRIAL_PID, "_actor": "TestOwner"})
    r = requests.post(f"{API}/tracking/sessions/{NON_TRIAL_APPT}/locations",
                      json=_fix(20001, source="simulated", lat=53.54, lng=-113.49), headers=liam_h)
    assert r.status_code == 200, r.text
    assert r.json().get("accepted") is True
    s = requests.get(f"{API}/tracking/sessions/{NON_TRIAL_APPT}", headers=owner_h).json()
    assert s.get("source") == "simulated"


def test_trial_off_simulated_accepted(owner_h, maya_h):
    """Regression: with trial OFF, simulated fixes are accepted for everyone."""
    requests.patch(f"{API}/settings/app", headers=owner_h,
                   json={"liveGpsPractitionerId": None, "_actor": "TestOwner"})
    _ensure_enroute(owner_h, TRIAL_APPT, maya_h)
    r = requests.post(f"{API}/tracking/sessions/{TRIAL_APPT}/locations",
                      json=_fix(30001, source="simulated"), headers=maya_h)
    assert r.status_code == 200
    assert r.json().get("accepted") is True


# ---------- Booking email ----------

def test_booking_example_com_sends_no_email(owner_h):
    """Booking for a sarah.demo@example.com client (sign-in) must NOT send email."""
    sarah_h = _login("sarah.demo@example.com", DEMO_PW)
    before = requests.get(f"{API}/state", headers=owner_h).json()["audit"]
    before_count = sum(1 for a in before if a.get("action", "").endswith("confirmation email sent"))
    body = {"client": {}, "practitionerId": "p-maya",
            "appointment": {"date": "2026-11-15", "time": "10:00", "duration": 60,
                            "serviceSlug": "swedish",
                            "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.53, "lng": -113.5},
                            "pricing": {"subtotal": 100, "gst": 5, "total": 105},
                            "paymentMethod": "card", "preferences": {}},
            "source": "online"}
    r = requests.post(f"{API}/bookings", json=body, headers=sarah_h, timeout=15)
    assert r.status_code == 200, r.text
    ref = r.json()["appointment"]["ref"]
    time.sleep(2)
    after = requests.get(f"{API}/state", headers=owner_h).json()["audit"]
    sent = [a for a in after if a.get("action") == f"{ref} confirmation email sent"]
    assert sent == [], f"should NOT send email for @example.com client but got audit: {sent}"
    # cleanup appointment via transition to cancelled
    requests.post(f"{API}/appointments/{r.json()['appointment']['id']}/transition",
                  json={"to": "cancelled", "actor": "TestCleanup"}, headers=owner_h)


def test_booking_real_email_triggers_send(owner_h):
    """Signed-in client with real email (delivered@resend.dev) triggers audit entry."""
    login = requests.post(f"{API}/auth/login", json={"email": TEST_CLIENT_EMAIL, "password": TEST_CLIENT_PW}, timeout=15)
    if login.status_code != 200:
        created = requests.post(f"{API}/auth/register", json={
            "email": TEST_CLIENT_EMAIL, "password": TEST_CLIENT_PW, "firstName": "Delivered", "lastName": "Resend",
            "phone": "780-555-0199", "dob": "1991-04-04", "marketingConsent": False,
        }, timeout=20)
        if created.status_code != 200:
            pytest.skip(f"{TEST_CLIENT_EMAIL} exists with a different password")
    h = _login(TEST_CLIENT_EMAIL, TEST_CLIENT_PW)
    body = {"client": {}, "practitionerId": "p-maya",
            "appointment": {"date": "2026-11-16", "time": "11:00", "duration": 60,
                            "serviceSlug": "swedish",
                            "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.53, "lng": -113.5},
                            "pricing": {"subtotal": 100, "gst": 5, "total": 105},
                            "paymentMethod": "card", "preferences": {}},
            "source": "online"}
    r = requests.post(f"{API}/bookings", json=body, headers=h, timeout=20)
    # Must return 200 even if email fails
    assert r.status_code == 200, r.text
    ref = r.json()["appointment"]["ref"]
    aid = r.json()["appointment"]["id"]
    # The response returns before the worker writes the audit. Poll until it appears.
    deadline = time.monotonic() + 15
    found = False
    while time.monotonic() < deadline:
        audit = requests.get(f"{API}/state", headers=owner_h, timeout=15).json()["audit"]
        if any(a.get("action") == f"{ref} confirmation email sent" for a in audit):
            found = True
            break
        time.sleep(0.2)
    assert found, f"No '{ref} confirmation email sent' audit found within 15s"
    # cleanup
    requests.post(f"{API}/appointments/{aid}/transition",
                  json={"to": "cancelled", "actor": "TestCleanup"}, headers=owner_h)
