"""Nabitouch Live Phase 1 — tracking authorization & validation tests (run: pytest backend/tests/test_tracking.py)."""
import os
from datetime import datetime, timezone, timedelta
import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


_API_ROOT = os.environ.get("API_URL") or _required("REACT_APP_BACKEND_URL")
API = _API_ROOT.rstrip("/") if _API_ROOT.rstrip("/").endswith("/api") else f"{_API_ROOT.rstrip('/')}/api"
_TOK = {}
EMAILS = {"practitioner:p-maya": "maya.demo@example.com", "practitioner:p-liam": "liam.demo@example.com", "client:c-sarah": "sarah.demo@example.com", "desk:x": "reception.demo@example.com"}


def H(a):
    """Bearer token for a demo account (real JWT login). client:c-david / practitioner:p-jordan / owner use registered or owner logins."""
    if a not in _TOK:
        if a.startswith("owner") or a == "practitioner:p-jordan":
            body = {"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")}
        elif a == "client:c-david":
            return {}  # David has no account; see test_client_only_own_appointment
        else:
            body = {"email": EMAILS[a], "password": _required("DEMO_PASSWORD")}
        r = requests.post(f"{API}/auth/login", json=body)
        _TOK[a] = r.cookies.get("access_token")
    return {"Authorization": f"Bearer {_TOK[a]}"} if _TOK.get(a) else {}


def fix(seq, ago=0, acc=8, lat=53.55, lng=-113.5):
    return {"lat": lat, "lng": lng, "accuracy": acc, "seq": seq, "recordedAt": (datetime.now(timezone.utc) - timedelta(seconds=ago)).isoformat()}


def setup_module():
    requests.post(f"{API}/demo/reset", headers=H("owner:x"))
    requests.post(f"{API}/appointments/a-101/transition", json={"to": "en_route"}, headers=H("practitioner:p-maya"))
    requests.post(f"{API}/tracking/sessions/a-101/start", headers=H("practitioner:p-maya"))


def teardown_module():
    requests.post(f"{API}/demo/reset", headers=H("owner:x"))


def ingest(seq=1, auth="practitioner:p-maya", **kw):
    return requests.post(f"{API}/tracking/sessions/a-101/locations", json=fix(seq, **kw), headers=H(auth))


def test_missing_auth_rejected():
    assert requests.post(f"{API}/tracking/sessions/a-101/locations", json=fix(1)).status_code == 401
    assert requests.post(f"{API}/appointments/a-105/transition", json={"to": "en_route"}).status_code == 401
    assert requests.post(f"{API}/appointments/a-105/transition", json={"to": "en_route"}, headers=H("practitioner:p-liam")).status_code == 403


def test_practitioner_mismatch_rejected():
    assert ingest(1, auth="practitioner:p-liam").status_code == 403


def test_accepts_valid_fix_and_eta():
    r = ingest(10).json()
    assert r["accepted"] and r["eta"]["etaMin"] >= 0


def test_out_of_order_rejected():
    assert ingest(5).json()["reason"] == "out_of_order"


def test_stale_fix_rejected():
    assert ingest(20, ago=600).json()["reason"] == "stale_fix"


def test_poor_accuracy_rejected():
    assert ingest(21, acc=900).json()["reason"] == "poor_accuracy"


def test_owner_sees_session_live():
    s = requests.get(f"{API}/tracking/sessions/a-101", headers=H("owner:x")).json()
    assert s["position"] and s["stale"] is False


def test_client_only_own_appointment():
    assert requests.get(f"{API}/tracking/sessions/a-101", headers=H("client:c-sarah")).status_code == 403
    assert requests.get(f"{API}/tracking/sessions/a-101").status_code == 401
    assert requests.get(f"{API}/tracking/active", headers=H("client:c-sarah")).status_code == 403


def test_receptionist_permission_revocation():
    perms = requests.get(f"{API}/state", headers=H("owner:x")).json()["settings"][0]["receptionPerms"]
    P = lambda v: requests.patch(f"{API}/settings/app", json={"receptionPerms": v}, headers=H("owner:x"))
    assert requests.get(f"{API}/tracking/sessions/a-101", headers=H("desk:x")).json().get("position")
    assert requests.patch(f"{API}/settings/app", json={"receptionPerms": perms}, headers=H("desk:x")).status_code == 403
    P({**perms, "viewLocations": False, "viewEta": False})
    assert requests.get(f"{API}/tracking/sessions/a-101", headers=H("desk:x")).status_code == 403
    assert requests.get(f"{API}/tracking/active", headers=H("desk:x")).json() == []
    P({**perms, "viewLocations": False, "viewEta": True})
    s = requests.get(f"{API}/tracking/sessions/a-101", headers=H("desk:x")).json()
    assert "position" not in s and "eta" in s
    P(perms)


def test_events_scoped():
    ev = requests.get(f"{API}/tracking/events", headers=H("client:c-sarah")).json()["events"]
    assert all(e["appointmentId"] != "a-101" for e in ev)
    assert any(e["type"] == "location.updated" for e in requests.get(f"{API}/tracking/events", headers=H("owner:x")).json()["events"])


def test_tracking_stops_after_arrival():
    requests.post(f"{API}/appointments/a-101/transition", json={"to": "arrived"}, headers=H("practitioner:p-maya"))
    assert ingest(30).status_code == 409
    assert requests.get(f"{API}/tracking/sessions/a-101", headers=H("client:c-sarah")).status_code == 403
    assert "position" not in requests.get(f"{API}/tracking/sessions/a-101", headers=H("owner:x")).json()
    events = requests.get(f"{API}/tracking/events", headers=H("owner:x")).json()["events"]
    assert all(e["type"] not in ("location.updated", "eta.updated") or e["appointmentId"] != "a-101" for e in events)


def test_tracking_after_cancellation():
    requests.post(f"{API}/appointments/a-104/transition", json={"to": "en_route"}, headers=H("owner:x"))
    requests.post(f"{API}/appointments/a-104/transition", json={"to": "cancelled"}, headers=H("owner:x"))
    r = requests.post(f"{API}/tracking/sessions/a-104/locations", json=fix(1), headers=H("practitioner:p-jordan"))
    assert r.status_code == 409


def test_payments_require_auth_and_ownership():
    assert requests.post(f"{API}/payments/a-111/intent", json={}).status_code == 401
    assert requests.post(f"{API}/claims/a-111", json={"action": "approved"}, headers=H("client:c-sarah")).status_code == 403
    assert requests.post(f"{API}/payments/a-092/intent", json={}, headers=H("client:c-sarah")).status_code == 403
    assert requests.post(f"{API}/payments/a-092/intent", json={}, headers=H("owner:x")).status_code == 200


def test_public_state_hides_clients():
    s = requests.get(f"{API}/state").json()
    assert s["clients"] == [] and s["soap"] == [] and all("address" not in a for a in s["appointments"])


def test_receptionist_no_soap_and_no_reset_of_perms():
    s = requests.get(f"{API}/state", headers=H("desk:x")).json()
    assert s["soap"] == []
    assert requests.put(f"{API}/soap/a-103", json={}, headers=H("desk:x")).status_code == 403
