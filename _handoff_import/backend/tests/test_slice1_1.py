"""Slice 1.1 regressions. These cover gaps left after the first security pass."""
import asyncio
import hashlib
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


BASE = _required("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"
ROOT = Path(__file__).resolve().parents[1]


def login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def cookie_session(email, password):
    session = requests.Session()
    response = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    session.headers["X-CSRF-Token"] = session.cookies.get("csrf_token")
    return session


@pytest.fixture(scope="module")
def owner():
    return login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))


@pytest.fixture(scope="module")
def sarah():
    return login("sarah.demo@example.com", _required("DEMO_PASSWORD"))


@pytest.fixture(scope="module")
def maya():
    return login("maya.demo@example.com", _required("DEMO_PASSWORD"))


@pytest.fixture(scope="module")
def liam():
    return login("liam.demo@example.com", _required("DEMO_PASSWORD"))


@pytest.fixture(scope="module")
def desk():
    return login("reception.demo@example.com", _required("DEMO_PASSWORD"))


def _book(headers, when, key=None, practitioner="p-maya"):
    body = {
        "source": "online",
        "practitionerId": practitioner,
        "idempotencyKey": key,
        "appointment": {
            "serviceSlug": "swedish", "duration": 60, "date": "2027-04-01", "time": when,
            "locationType": "clinic", "paymentMethod": "self",
            "pricing": {"total": 1, "discount": 99},
            "address": {"lat": 53.5461, "lng": -113.4938},
        },
    }
    return requests.post(f"{API}/bookings", headers=headers, json=body, timeout=20)


def test_refresh_rotates_and_replay_is_rejected():
    session = cookie_session(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    original = session.cookies.get("refresh_token")
    first = session.post(f"{API}/auth/refresh", timeout=20)
    assert first.status_code == 200, first.text
    rotated = session.cookies.get("refresh_token")
    assert rotated and rotated != original
    replay = requests.post(
        f"{API}/auth/refresh",
        cookies={"refresh_token": original, "csrf_token": session.cookies.get("csrf_token")},
        headers={"X-CSRF-Token": session.cookies.get("csrf_token")},
        timeout=20,
    )
    assert replay.status_code == 401
    assert session.post(f"{API}/auth/refresh", timeout=20).status_code == 200
    assert session.get(f"{API}/auth/me", timeout=20).status_code == 200


def test_password_reset_revokes_existing_session():
    email = f"reset_{uuid.uuid4().hex[:8]}@example.com"
    password = f"Start-{uuid.uuid4().hex[:8]}!"
    registered = requests.post(f"{API}/auth/register", json={
        "email": email, "password": password, "firstName": "Reset", "lastName": "Check",
        "phone": "780-555-0100", "dob": "1992-02-02", "marketingConsent": False,
    }, timeout=20)
    assert registered.status_code == 200, registered.text
    access = registered.cookies.get("access_token")
    assert requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {access}"}, timeout=20).status_code == 200
    raw = uuid.uuid4().hex + uuid.uuid4().hex
    now = datetime.now(timezone.utc)

    async def plant():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        await client[os.environ["DB_NAME"]].nt_password_resets.insert_one({
            "tokenHash": hashlib.sha256(raw.encode()).hexdigest(),
            "userId": registered.json()["id"],
            "used": False,
            "createdAt": now.isoformat(),
            "expiresAt": (now + timedelta(minutes=30)).isoformat(),
        })
        client.close()

    asyncio.run(plant())
    reset = requests.post(f"{API}/auth/reset-password", json={"token": raw, "password": f"Next-{uuid.uuid4().hex[:8]}!"}, timeout=20)
    assert reset.status_code == 200, reset.text
    assert requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {access}"}, timeout=20).status_code == 401


def test_booking_idempotency_returns_the_same_visit(sarah):
    key = f"idem-{uuid.uuid4().hex}"
    first = _book(sarah, "15:00", key)
    second = _book(sarah, "15:00", key)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["appointment"]["id"] == second.json()["appointment"]["id"]
    assert first.json()["appointment"]["pricing"]["total"] != 1


def _remove_welcome_fixtures(emails):
    """Remove only the clients, visits, and identity claims created for this run."""
    async def remove():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        database = client[os.environ["DB_NAME"]]
        people = await database.nt_clients.find({"email": {"$in": list(emails)}}, {"_id": 0, "id": 1}).to_list(10)
        ids = [person["id"] for person in people]
        appointments = []
        if ids:
            appointments = await database.nt_appointments.find({"clientId": {"$in": ids}}, {"_id": 0, "id": 1}).to_list(20)
        appointment_ids = [row["id"] for row in appointments]
        if appointment_ids:
            await database.nt_slot_locks.delete_many({"appointmentId": {"$in": appointment_ids}})
            await database.nt_invoices.delete_many({"appointmentId": {"$in": appointment_ids}})
            await database.nt_appointments.delete_many({"id": {"$in": appointment_ids}})
        if ids:
            await database.nt_clients.delete_many({"id": {"$in": ids}})
        keys = [f"email:{email}" for email in emails] + [f"client:{person_id}" for person_id in ids]
        await database.nt_welcome_claims.delete_many({"key": {"$in": keys}})
        client.close()

    asyncio.run(remove())


def test_concurrent_promo_redemption_allows_one(owner):
    state = requests.get(f"{API}/state", headers=owner, timeout=20).json()
    promo = next(item for item in state["promotions"] if item["id"] == "promo-welcome")
    original = promo["redemptionLimit"]
    patched = requests.patch(
        f"{API}/promotions/promo-welcome", headers=owner,
        json={"redemptionLimit": int(promo["redemptions"]) + 1}, timeout=20)
    assert patched.status_code == 200, patched.text
    token = uuid.uuid4().hex
    emails = [f"welcome-{token}-{mark}@example.com" for mark in (0, 1)]
    day = f"2027-05-{4 + (int(token[:2], 16) % 24):02d}"

    def book(mark):
        return requests.post(f"{API}/bookings", headers=owner, json={
            "source": "online",
            "client": {"firstName": "Welcome", "lastName": f"Race{mark}", "email": emails[mark]},
            "appointment": {
                "serviceSlug": "swedish", "duration": 60, "date": day, "time": "09:00" if mark == 0 else "16:00",
                "locationType": "home", "paymentMethod": "self",
                "pricing": {"total": 1, "promoId": "promo-welcome"},
                "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True, "lat": 53.5461, "lng": -113.4938},
            },
        }, timeout=20)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(book, (0, 1)))
        assert [item.status_code for item in results] == [200, 200], [(item.status_code, item.text[:240]) for item in results]
        discounts = sorted(item.json()["appointment"]["pricing"]["discount"] for item in results)
        assert discounts == [0, 24], discounts
    finally:
        requests.patch(f"{API}/promotions/promo-welcome", headers=owner, json={"redemptionLimit": original}, timeout=20)
        _remove_welcome_fixtures(emails)


def test_simulate_ignores_client_amount_and_refund_is_capped(owner, sarah):
    booked = _book(sarah, "18:00", practitioner="p-liam")
    assert booked.status_code == 200, booked.text
    appointment = booked.json()["appointment"]
    intent = requests.post(f"{API}/payments/{appointment['id']}/intent", headers=sarah, json={"idempotencyKey": uuid.uuid4().hex}, timeout=20)
    assert intent.status_code == 200, intent.text
    amount = intent.json()["intent"]["amount"]
    assert amount > 1
    settled = requests.post(
        f"{API}/payments/{appointment['id']}/simulate", headers=sarah,
        json={"paymentId": intent.json()["intent"]["id"], "outcome": "succeeded", "amount": 1}, timeout=20)
    assert settled.status_code == 200, settled.text
    payment = settled.json()["payments"][-1]
    assert payment["amount"] == amount
    assert payment["amount"] != 1
    too_much = requests.post(
        f"{API}/payments/{appointment['id']}/refund", headers=owner,
        json={"paymentId": payment["id"], "amount": amount + 50}, timeout=20)
    assert too_much.status_code == 409
    allowed = requests.post(
        f"{API}/payments/{appointment['id']}/refund", headers=owner,
        json={"paymentId": payment["id"], "amount": amount}, timeout=20)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["payments"][-1]["status"] == "refund_pending"


def test_restricted_transitions(sarah, maya, desk):
    own = _book(sarah, "19:00")
    assert own.status_code == 200, own.text
    client_cancel = requests.post(
        f"{API}/appointments/{own.json()['appointment']['id']}/transition",
        headers=sarah, json={"to": "cancelled"}, timeout=20)
    assert client_cancel.status_code == 403
    desk_travel = requests.post(
        f"{API}/appointments/a-105/transition", headers=desk, json={"to": "en_route"}, timeout=20)
    assert desk_travel.status_code == 403
    other = requests.post(
        f"{API}/appointments/a-106/transition", headers=maya, json={"to": "arrived"}, timeout=20)
    assert other.status_code == 403


def test_other_practitioner_cannot_read_or_write_maya_soap(liam, maya):
    state = requests.get(f"{API}/state", headers=liam, timeout=20).json()
    assert all(note.get("practitionerId") == "p-liam" for note in state["soap"])
    assert all(note.get("id") != "soap-090" for note in state["soap"])
    write = requests.put(f"{API}/soap/a-104", headers=maya, json={"S": "not my visit"}, timeout=20)
    assert write.status_code == 403


def test_desk_clinical_flag_does_not_reveal_soap_or_home_base(owner, desk):
    state = requests.get(f"{API}/state", headers=owner, timeout=20).json()
    perms = state["settings"][0]["receptionPerms"]
    turned_on = requests.patch(
        f"{API}/settings/app", headers=owner,
        json={"receptionPerms": {**perms, "clinical": True}}, timeout=20)
    assert turned_on.status_code == 200, turned_on.text
    try:
        desk_state = requests.get(f"{API}/state", headers=desk, timeout=20).json()
        assert desk_state["soap"] == []
        assert all("base" not in person for person in desk_state["practitioners"])
        assert "revenueTrend" not in desk_state["settings"][0]
    finally:
        requests.patch(f"{API}/settings/app", headers=owner, json={"receptionPerms": perms}, timeout=20)


def _wait_for(url, proc, seconds=25):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            if requests.get(url, timeout=1).status_code == 200:
                return True
        except requests.RequestException:
            time.sleep(0.3)
    return False


def test_production_process_rejects_demo_and_simulated_payments():
    env = os.environ.copy()
    env.update({
        "APP_ENV": "production", "DEMO_MODE": "false", "COOKIE_SECURE": "true", "EMAIL_PROVIDER": "disabled",
        "DB_NAME": "nabitouch_s31_prodcheck",
        "REDIS_URL": "rediss://:test-password@127.0.0.1:6390/0",
        "DOCUMENT_UPLOADS_ENABLED": "false", "STRIPE_CARD_CHECKOUT_ENABLED": "false",
        "LEGACY_PATIENT_IMPORT_ENABLED": "false", "HOSTING_STRATEGY": "shared-vps",
        "CLAMAV_HOST": "", "MAPBOX_TOKEN": "sk.test-not-a-live-token",
    })
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8011"],
        cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert _wait_for("http://127.0.0.1:8011/api/", proc), "production API did not start"
        demo = requests.post("http://127.0.0.1:8011/api/auth/demo-login", json={"role": "owner"}, timeout=10)
        reset = requests.post("http://127.0.0.1:8011/api/demo/reset", timeout=10)
        simulate = requests.post("http://127.0.0.1:8011/api/payments/a-111/simulate", json={"paymentId": "pay-x", "outcome": "succeeded"}, timeout=10)
        assert demo.status_code == 404
        assert reset.status_code == 404
        assert simulate.status_code == 404
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_production_startup_refuses_demo_mode():
    env = os.environ.copy()
    env.update({"APP_ENV": "production", "DEMO_MODE": "true", "COOKIE_SECURE": "true", "EMAIL_PROVIDER": "disabled"})
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8012"],
        cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        code = proc.wait(timeout=25)
        assert code != 0
    except subprocess.TimeoutExpired:
        proc.kill()
        pytest.fail("production startup stayed up with DEMO_MODE=true")
    finally:
        if proc.poll() is None:
            proc.kill()
