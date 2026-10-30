"""Iteration 5: client self-registration during booking, 409 duplicate, per-email lockout."""
import os
import uuid
import time
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


def _csrf(session):
    token = session.cookies.get("csrf_token")
    if token:
        session.headers["X-CSRF-Token"] = token
    return session

_created_emails: list[str] = []


def _rand_email(prefix="test_reg"):
    e = f"{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    _created_emails.append(e)
    return e


# ---- Register / login lifecycle ----
class TestRegister:
    def test_register_creates_client_and_sets_cookies(self):
        s = requests.Session()
        email = _rand_email()
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "StrongPass!23", "firstName": "Test", "lastName": "User",
            "phone": "780-555-1212", "dob": "1990-01-15", "marketingConsent": False,
            "profile": {"favorites": ["swedish-relaxation"]},
        }, timeout=20)
        assert r.status_code == 200, r.text
        _csrf(s)
        data = r.json()
        assert data["email"] == email
        assert data["role"] == "client"
        assert data["subject"].startswith("c-")
        # Cookies set
        assert s.cookies.get("access_token"), "access_token cookie not set"
        # /auth/me returns the new client
        me = s.get(f"{API}/auth/me", timeout=10)
        assert me.status_code == 200
        assert me.json()["email"] == email
        assert me.json()["role"] == "client"

    def test_duplicate_register_returns_409(self):
        email = _rand_email()
        payload = {"email": email, "password": "StrongPass!23", "firstName": "Dup", "lastName": "User",
                   "phone": "", "dob": "1990-01-01", "marketingConsent": False, "profile": {}}
        r1 = requests.post(f"{API}/auth/register", json=payload, timeout=20)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/register", json=payload, timeout=20)
        assert r2.status_code == 409, r2.text

    def test_register_then_login_persists(self):
        s = requests.Session()
        email = _rand_email()
        pw = "StrongPass!23"
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": pw, "firstName": "Persist", "lastName": "User",
            "phone": "", "dob": "1990-01-01", "marketingConsent": False, "profile": {}}, timeout=20)
        assert r.status_code == 200
        subject = r.json()["subject"]
        # New session: can log in again
        s2 = requests.Session()
        lr = s2.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
        assert lr.status_code == 200
        assert lr.json()["subject"] == subject


# ---- Booking links to the newly-registered client ----
class TestBookingLinksToNewClient:
    def test_booking_appears_in_me_appointments(self):
        s = requests.Session()
        email = _rand_email()
        pw = "StrongPass!23"
        reg = s.post(f"{API}/auth/register", json={
            "email": email, "password": pw, "firstName": "Book", "lastName": "Flow",
            "phone": "780-555-0001", "dob": "1990-01-01", "marketingConsent": False,
            "profile": {"addresses": [{"id": "ad-1", "label": "Home", "line": "1 Jasper Ave, Edmonton", "lat": 53.5461, "lng": -113.4938, "zoneId": None}]}}, timeout=20)
        assert reg.status_code == 200
        _csrf(s)
        cid = reg.json()["subject"]
        # Create appointment via /api/book (matches frontend api.book)
        appt = {
            "client": {"id": cid},
            "practitionerId": "p-nabitu-kahindo",
            "actor": "Book Flow",
            "appointment": {
                "serviceSlug": "swedish", "duration": 60,
                "date": "2026-02-20", "time": "10:00",
                "locationType": "home",
                "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.5461, "lng": -113.4938, "zoneId": None},
                "pricing": {"base": 120, "discount": 0, "addons": 0, "travel": 15, "tax": 6.75, "total": 141.75, "addonList": [], "treatmentAfterDiscount": 120},
                "paymentMethod": "self", "paymentStatus": "unpaid", "insuranceId": None, "selfMethod": "card",
                "preferences": {"goals": "", "pressure": "medium", "focus": "", "notes": ""},
                "checkedIn": False, "feedback": None,
            },
        }
        br = s.post(f"{API}/bookings", json=appt, timeout=20)
        assert br.status_code in (200, 201), br.text
        body = br.json()
        aid = body.get("appointment", {}).get("id") or body.get("id")
        assert aid, body
        # Verify client sees it in authenticated /state (server filters to this client's appts)
        state = s.get(f"{API}/state", timeout=10)
        assert state.status_code == 200
        js = state.json()
        appts = js.get("appointments", [])
        assert any(a.get("id") == aid and a.get("clientId") == cid for a in appts), f"booking {aid} not linked to client {cid}: {[a.get('id') for a in appts]}"


# ---- Per-email lockout (not owner!) ----
class TestLockout:
    def test_five_wrong_then_locked_even_with_correct_password(self):
        s = requests.Session()
        email = _rand_email("test_lock")
        pw = "StrongPass!23"
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": pw, "firstName": "Lock", "lastName": "Target",
            "phone": "", "dob": "1990-01-01", "marketingConsent": False, "profile": {}}, timeout=20)
        assert r.status_code == 200
        # 5 wrong passwords
        for i in range(5):
            rr = requests.post(f"{API}/auth/login", json={"email": email, "password": "WrongPass!!"}, timeout=20)
            assert rr.status_code == 401, f"attempt {i}: {rr.status_code}"
        # 6th: even correct password must be 429
        rr = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
        assert rr.status_code == 429, f"expected 429 after 5 fails, got {rr.status_code} {rr.text}"

    def test_lockout_does_not_affect_other_accounts(self):
        """Verify owner can still login while a different test account is locked."""
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=20)
        assert r.status_code == 200, r.text


def test_cleanup_report():
    """Not a cleanup — just prints what we created so main-agent can verify."""
    print("\nTEST EMAILS CREATED:", _created_emails)
