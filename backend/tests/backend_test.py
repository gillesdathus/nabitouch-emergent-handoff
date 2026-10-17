"""Nabitouch backend regression tests — real JWT sessions (post-auth). Scenarios A/C + payments/claims/CRUD."""
import os
import uuid
import pytest
import requests

def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


BASE = _required("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"
OWNER_EMAIL = _required("OWNER_EMAIL")
OWNER_PASSWORD = _required("OWNER_PASSWORD")
DEMO_PASSWORD = _required("DEMO_PASSWORD")

_SESSIONS = {}


def session_for(email, password):
    """Return a requests.Session logged in with the given credentials (cookie-based)."""
    key = email
    if key in _SESSIONS:
        return _SESSIONS[key]
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    csrf = s.cookies.get("csrf_token")
    assert csrf, "csrf_token cookie not set"
    s.headers["X-CSRF-Token"] = csrf
    _SESSIONS[key] = s
    return s


def owner():
    return session_for(OWNER_EMAIL, OWNER_PASSWORD)


def maya():
    return session_for("maya.demo@example.com", DEMO_PASSWORD)


def sarah():
    return session_for("sarah.demo@example.com", DEMO_PASSWORD)


def desk():
    return session_for("reception.demo@example.com", DEMO_PASSWORD)


# ---------- fixtures ----------
@pytest.fixture(scope="session", autouse=True)
def reset_once():
    r = owner().post(f"{API}/demo/reset", timeout=30)
    assert r.status_code == 200
    yield
    owner().post(f"{API}/demo/reset", timeout=30)


@pytest.fixture
def state():
    r = owner().get(f"{API}/state", timeout=15)
    assert r.status_code == 200
    return r.json()


def get_appt(aid):
    s = owner().get(f"{API}/state", timeout=15).json()
    return next((a for a in s["appointments"] if a["id"] == aid), None)


# ---------- state & seed sanity ----------
class TestStateSeed:
    def test_state_shape(self, state):
        for k in ("services", "practitioners", "clients", "appointments", "promotions", "zones", "settings"):
            assert k in state and isinstance(state[k], list), f"missing {k}"
        assert len(state["appointments"]) >= 10
        assert len(state["practitioners"]) == 4
        assert any(c["id"] == "c-sarah" for c in state["clients"])

    def test_seeded_appointments(self, state):
        ids = {a["id"]: a for a in state["appointments"]}
        for req in ("a-090", "a-092", "a-101", "a-105", "a-106", "a-107", "a-111", "a-112"):
            assert req in ids, f"missing seeded {req}"
        assert ids["a-106"]["status"] == "en_route"
        assert ids["a-107"]["practitionerId"] is None  # unassigned
        assert ids["a-111"]["clientId"] == "c-sarah"

    def test_promo_welcome20(self, state):
        promo = next((p for p in state["promotions"] if p["id"].lower().startswith("welcome") or "WELCOME20" in str(p).upper()), None)
        assert promo is not None


# ---------- booking (Scenario A core, guest flow — public) ----------
class TestBookingCreate:
    def test_create_guest_booking_self_pay(self):
        payload = {
            "actor": "client",
            "source": "online",
            "client": {"firstName": "TEST", "lastName": "Guest", "email": f"test_{uuid.uuid4().hex[:6]}@example.com",
                       "phone": "+15555550123", "dob": "1990-05-01"},
            "appointment": {
                "serviceSlug": "deep-tissue",
                "duration": 60,
                "date": "2026-12-01",
                "time": "15:00",
                "locationType": "home",
                "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.544, "lng": -113.49},
                "paymentMethod": "self",
                "pricing": {"base": 140, "discount": 28, "addons": 0, "travel": 10, "tax": 7.1, "total": 129.1, "promoId": "WELCOME20"},
            },
        }
        r = requests.post(f"{API}/bookings", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "appointment" in data and "clientId" in data
        a = data["appointment"]
        assert a["status"] == "requested"
        assert a["ref"].startswith("NT-")
        assert a["clientId"] == data["clientId"]
        assert a["pricing"]["total"] != 129.1
        assert a["pricing"]["discount"] != 28
        got = get_appt(a["id"])
        assert got and got["ref"] == a["ref"]


# ---------- lifecycle (Scenario C) ----------
class TestLifecycle:
    def test_full_visit_lifecycle(self):
        aid = "a-101"
        base = get_appt(aid)
        assert base and base["status"] == "assigned"
        s = maya()
        for to in ("en_route", "arrived", "in_session", "session_ended"):
            r = s.post(f"{API}/appointments/{aid}/transition", json={"to": to, "actor": "p-maya"})
            assert r.status_code == 200, f"{to}: {r.text}"
        appt = get_appt(aid)
        assert appt["status"] == "soap_pending"
        assert appt.get("trip", {}).get("sharing") is False

        rs = s.put(f"{API}/soap/{aid}", json={"S": "intake", "O": "obs", "A": "assess", "P": "plan", "pain": 5})
        assert rs.status_code == 200
        rs2 = s.post(f"{API}/soap/{aid}/sign", json={"by": "p-maya"})
        assert rs2.status_code == 200
        appt = get_appt(aid)
        assert appt["soapStatus"] == "signed"
        assert appt["status"] == "soap_completed"

        rs3 = s.put(f"{API}/soap/{aid}", json={"S": "edit"})
        assert rs3.status_code == 409

        r = s.post(f"{API}/appointments/{aid}/transition", json={"to": "leaving", "actor": "p-maya"})
        assert r.status_code == 200
        r = s.post(f"{API}/appointments/{aid}/transition", json={"to": "completed", "actor": "p-maya"})
        assert r.status_code == 200
        appt = get_appt(aid)
        assert appt["status"] == "processing"

    def test_invalid_transition_rejected(self):
        r = maya().post(f"{API}/appointments/a-105/transition", json={"to": "in_session", "actor": "p-maya"})
        assert r.status_code == 409

    def test_start_travel_creates_trip(self):
        aid = "a-105"
        r = maya().post(f"{API}/appointments/{aid}/transition", json={"to": "en_route", "actor": "p-maya"})
        assert r.status_code == 200
        appt = get_appt(aid)
        trip = appt.get("trip") or {}
        assert trip.get("sharing") is False
        assert trip.get("simulated") is False
        assert trip.get("location") == "unavailable"
        assert "from" not in trip
        assert "km" not in trip
        started = maya().post(f"{API}/tracking/sessions/{aid}/start")
        assert started.status_code == 200
        assert get_appt(aid).get("trip", {}).get("sharing") is True


# ---------- payments & claims (Payments scenario) ----------
class TestPayments:
    def test_claim_partial_then_insurer_paid_and_client_settles(self):
        aid = "a-111"
        a = get_appt(aid)
        assert a and a["paymentMethod"] == "insurance"
        total = a["pricing"]["total"]

        o = owner()
        assert a["claim"]["status"] in ("submitted", "verification_pending")
        if a["claim"]["status"] == "verification_pending":
            o.post(f"{API}/claims/{aid}", json={"action": "submitted", "actor": "owner"})

        r = o.post(f"{API}/claims/{aid}", json={"action": "partially_approved", "amount": 85, "actor": "owner"})
        assert r.status_code == 200, r.text
        assert r.json()["claim"]["approved"] == 85

        r = o.post(f"{API}/claims/{aid}", json={"action": "insurer_paid", "actor": "owner"})
        assert r.status_code == 200
        a2 = r.json()
        assert a2["claim"]["insurerPayment"] == "confirmed"
        assert a2["settle"]["insuranceConfirmed"] == 85
        payable = a2["settle"]["payable"]
        assert payable == round(total - 85, 2)

        key = f"idem-{uuid.uuid4().hex[:8]}"
        cs = sarah()
        r = cs.post(f"{API}/payments/{aid}/intent", json={"idempotencyKey": key, "actor": "c-sarah"})
        assert r.status_code == 200, r.text
        intent = r.json()["intent"]
        assert intent["amount"] == payable
        assert intent["status"] == "pending"

        r2 = cs.post(f"{API}/payments/{aid}/intent", json={"idempotencyKey": key, "actor": "c-sarah"})
        assert r2.json()["intent"]["id"] == intent["id"]

        # Webhook is a mock stripe callback — reuses guard() so appointment owner auth required
        r = cs.post(f"{API}/payments/{aid}/simulate", json={"paymentId": intent["id"], "outcome": "succeeded"})
        assert r.status_code == 200
        final = r.json()
        assert final["paymentStatus"] == "fully_paid"
        assert final["settle"]["balance"] == 0
        assert final["payments"][-1]["receipt"].startswith("RCPT-")

    def test_cash_payment(self):
        aid = "a-112"
        a = get_appt(aid)
        if a["settle"].get("payable", 0) <= 0:
            pytest.skip("nothing payable on a-112")
        r = desk().post(f"{API}/payments/{aid}/cash", json={"amount": a["settle"]["payable"], "actor": "receptionist"})
        assert r.status_code == 200
        assert r.json()["paymentStatus"] == "fully_paid"

    def test_webhook_idempotent(self):
        aid = "a-111"
        a = get_appt(aid)
        pays = [p for p in a.get("payments", []) if p["status"] == "succeeded"]
        if not pays:
            pytest.skip("no succeeded payment")
        pid = pays[-1]["id"]
        r = sarah().post(f"{API}/payments/{aid}/simulate", json={"paymentId": pid, "outcome": "succeeded"})
        assert r.status_code == 200
        a2 = get_appt(aid)
        assert a2["paymentStatus"] == "fully_paid"


# ---------- events (reschedule/delay) ----------
class TestEvents:
    def test_delay_event(self):
        aid = "a-104"
        r = owner().post(f"{API}/appointments/{aid}/event", json={"kind": "delay", "actor": "p-jordan", "note": "+10 min traffic"})
        assert r.status_code == 200
        a = get_appt(aid)
        assert any(e["status"] == "delay" for e in a["events"])


# ---------- generic doc CRUD (owner) ----------
class TestGenericCrud:
    def test_patch_promotion(self, state):
        promo = state["promotions"][0]
        r = owner().patch(f"{API}/promotions/{promo['id']}", json={"description": "TEST updated", "_actor": "owner", "_audit": "promo updated"})
        assert r.status_code == 400
        enabled = promo["enabled"]
        r = owner().patch(f"{API}/promotions/{promo['id']}", json={"enabled": enabled, "_actor": "owner", "_audit": "promo updated"})
        assert r.status_code == 200
        assert r.json().get("description") != "TEST updated"
        assert r.json()["enabled"] == enabled

    def test_patch_zone_fee(self, state):
        zone = state["zones"][0]
        r = owner().patch(f"{API}/zones/{zone['id']}", json={"fee": 12.5})
        assert r.status_code == 200
        assert r.json()["fee"] == 12.5

    def test_patch_unknown_returns_404(self):
        r = owner().patch(f"{API}/appointments/nonexistent-id", json={"foo": "bar"})
        assert r.status_code == 404


# ---------- auth negative paths ----------
class TestAuth:
    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "wrong-xxx"})
        assert r.status_code == 401

    def test_me_requires_auth(self):
        assert requests.get(f"{API}/auth/me").status_code == 401
        assert owner().get(f"{API}/auth/me").status_code == 200

    def test_public_state_hides_private(self):
        s = requests.get(f"{API}/state").json()
        assert s["clients"] == [] and s["soap"] == []
        assert all("address" not in a for a in s["appointments"])

    def test_client_cannot_access_other_appointment(self):
        # Sarah cannot create intent on David's a-092
        r = sarah().post(f"{API}/payments/a-092/intent", json={})
        assert r.status_code == 403
