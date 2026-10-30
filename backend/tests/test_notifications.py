"""Durable booking-email outbox. Unit cases use a private database the API worker does not poll."""
import asyncio
import os
import time
import uuid
from datetime import date, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ServerSelectionTimeoutError

from notifications import (
    CancelDelivery, PermanentDelivery, TransientDelivery, clear_notifications, enqueue_booking_confirmation,
    ensure_notifications, process_available,
)


def _run(coro):
    """Run a coroutine, then leave a fresh loop for tests that call get_event_loop."""
    try:
        return asyncio.run(coro)
    finally:
        asyncio.set_event_loop(asyncio.new_event_loop())


def _mongo():
    return os.environ.get("MONGO_URL") or ""


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _api():
    root = os.environ.get("API_URL") or os.environ.get("REACT_APP_BACKEND_URL") or ""
    if not root:
        return ""
    root = root.rstrip("/")
    return root if root.endswith("/api") else f"{root}/api"


def _login(email, password):
    response = requests.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    token = response.cookies.get("access_token") or response.json().get("accessToken")
    return {"Authorization": f"Bearer {token}"}


class _Audit:
    def __init__(self):
        self.events = []

    async def __call__(self, note, outcome):
        self.events.append((note.get("ref"), outcome))


def _appt(ref="NT-9001"):
    return {"id": "a-" + uuid.uuid4().hex[:8], "ref": ref, "date": "2026-11-20", "time": "10:00"}


async def _db():
    url = _mongo()
    if not url:
        pytest.skip("MONGO_URL is required for outbox tests")
    client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=2000)
    try:
        await client.admin.command("ping")
    except ServerSelectionTimeoutError as exc:
        client.close()
        pytest.skip(f"MongoDB is not reachable: {exc}")
    name = "nabitouch_notify_" + uuid.uuid4().hex[:8]
    database = client[name]
    await ensure_notifications(database)
    return client, database


def test_enqueue_is_durable_and_duplicate_booking_is_one_row():
    async def run():
        client, database = await _db()
        try:
            appt = _appt()
            first, created = await enqueue_booking_confirmation(database, appt, "c-1")
            second, again = await enqueue_booking_confirmation(database, appt, "c-1")
            assert created is True and again is False
            assert first["id"] == second["id"]
            assert first["status"] == "pending"
            assert await database.nt_notifications.count_documents({"dedupeKey": first["dedupeKey"]}) == 1
        finally:
            await client.drop_database(database.name)
            client.close()
    _run(run())


def test_worker_restart_sends_a_row_left_pending():
    async def run():
        client, database = await _db()
        try:
            appt = _appt("NT-9002")
            await enqueue_booking_confirmation(database, appt, "c-1")
            audit = _Audit()

            async def deliver(_note):
                return "mock-1"

            fresh = AsyncIOMotorClient(_mongo(), serverSelectionTimeoutMS=2000)
            try:
                worked = await process_available(fresh[database.name], deliver, "worker-b", audit, retry_base=0)
            finally:
                fresh.close()
            assert worked is True
            row = await database.nt_notifications.find_one({"ref": "NT-9002"})
            assert row["status"] == "sent"
            assert row["providerId"] == "mock-1"
            assert row["providerAcceptedAt"]
            assert row["deliveredAt"] is None
            assert audit.events == [("NT-9002", "sent")]
        finally:
            await client.drop_database(database.name)
            client.close()
    _run(run())


def test_expired_lease_is_recovered_after_a_crash():
    async def run():
        client, database = await _db()
        try:
            appt = _appt("NT-9003")
            await enqueue_booking_confirmation(database, appt, "c-1")
            from notifications import claim_one
            claimed = await claim_one(database, "worker-crashed", lease_for=30)
            assert claimed["status"] == "processing"
            assert claimed["attempts"] == 1
            await database.nt_notifications.update_one({"id": claimed["id"]}, {"$set": {"leaseUntil": "2000-01-01T00:00:00+00:00"}})
            audit = _Audit()

            async def deliver(_note):
                return "mock-recovered"

            assert await process_available(database, deliver, "worker-b", audit, retry_base=0) is True
            row = await database.nt_notifications.find_one({"id": claimed["id"]})
            assert row["status"] == "sent"
            assert row["attempts"] == 2
            assert row["providerId"] == "mock-recovered"
            assert audit.events == [("NT-9003", "sent")]
        finally:
            await client.drop_database(database.name)
            client.close()
    _run(run())


def test_transient_failure_retries_and_permanent_failure_stops():
    async def run():
        client, database = await _db()
        try:
            transient = _appt("NT-9004")
            await enqueue_booking_confirmation(database, transient, "c-1")
            audit = _Audit()
            calls = {"n": 0}

            async def flaky(_note):
                calls["n"] += 1
                if calls["n"] == 1:
                    raise TransientDelivery("provider_unavailable")
                return "mock-2"

            assert await process_available(database, flaky, "w", audit, retry_base=0) is True
            waiting = await database.nt_notifications.find_one({"ref": "NT-9004"})
            assert waiting["status"] == "retryable-failed"
            assert waiting["lastError"] == "provider_unavailable"
            assert await process_available(database, flaky, "w", audit, retry_base=0) is True
            assert (await database.nt_notifications.find_one({"ref": "NT-9004"}))["status"] == "sent"

            permanent = _appt("NT-9005")
            await enqueue_booking_confirmation(database, permanent, "c-1")
            await database.nt_notifications.update_one({"ref": "NT-9005"}, {"$set": {"maxAttempts": 2}})

            async def always(_note):
                raise TransientDelivery("provider_unavailable")

            await process_available(database, always, "w", audit, retry_base=0)
            await process_available(database, always, "w", audit, retry_base=0)
            stopped = await database.nt_notifications.find_one({"ref": "NT-9005"})
            assert stopped["status"] == "permanently-failed"
            assert ("NT-9005", "failed") in audit.events

            rejected = _appt("NT-9006")
            await enqueue_booking_confirmation(database, rejected, "c-1")

            async def reject(_note):
                raise PermanentDelivery("provider_rejected")

            await process_available(database, reject, "w", audit, retry_base=0)
            assert (await database.nt_notifications.find_one({"ref": "NT-9006"}))["status"] == "permanently-failed"
        finally:
            await client.drop_database(database.name)
            client.close()
    _run(run())


def test_concurrent_workers_claim_one_row():
    async def run():
        client, database = await _db()
        try:
            appt = _appt("NT-9007")
            await enqueue_booking_confirmation(database, appt, "c-1")
            started = asyncio.Event()
            release = asyncio.Event()
            calls = []

            async def slow(note):
                calls.append(note["id"])
                started.set()
                await release.wait()
                return "mock-one"

            audit = _Audit()
            first = asyncio.create_task(process_available(database, slow, "w1", audit, retry_base=0))
            await started.wait()
            second = await process_available(database, slow, "w2", audit, retry_base=0)
            release.set()
            assert await first is True
            assert second is False
            assert len(calls) == 1
            assert await database.nt_notifications.count_documents({"status": "sent"}) == 1
        finally:
            await client.drop_database(database.name)
            client.close()
    _run(run())


def test_no_recipient_cancels_without_a_sent_audit():
    async def run():
        client, database = await _db()
        try:
            appt = _appt("NT-9008")
            await enqueue_booking_confirmation(database, appt, "c-1")
            audit = _Audit()

            async def deliver(_note):
                raise CancelDelivery("no_recipient")

            await process_available(database, deliver, "w", audit, retry_base=0)
            row = await database.nt_notifications.find_one({"ref": "NT-9008"})
            assert row["status"] == "cancelled"
            assert row["lastError"] == "no_recipient"
            assert audit.events == []
            await clear_notifications(database)
            assert await database.nt_notifications.count_documents({}) == 0
        finally:
            await client.drop_database(database.name)
            client.close()
    _run(run())


_booking_day = 0


def _book(headers, when="10:00"):
    global _booking_day
    _booking_day += 1
    day = (date.today() + timedelta(days=400 + _booking_day)).isoformat()
    body = {"client": {}, "practitionerId": "p-nabitu-kahindo", "idempotencyKey": "mail-" + uuid.uuid4().hex[:12],
            "appointment": {"date": day, "time": when, "duration": 60, "serviceSlug": "swedish",
                            "address": {"line": "10150 104 St NW, Edmonton, AB", "mapboxId": "local-downtown", "postal": "T5J 2R4", "clientConfirmed": True},
                            "pricing": {"subtotal": 100, "gst": 5, "total": 105}, "paymentMethod": "card", "preferences": {}},
            "source": "online"}
    response = requests.post(f"{_api()}/bookings", json=body, headers=headers, timeout=20)
    assert response.status_code == 200, response.text
    return response.json()["appointment"]


def _owner():
    if not _api():
        pytest.skip("REACT_APP_BACKEND_URL is required")
    return _login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))


def test_live_booking_queues_then_records_provider_acceptance():
    owner = _owner()
    email = f"box.{uuid.uuid4().hex[:8]}@resend.dev"
    created = requests.post(f"{_api()}/auth/register", json={
        "email": email, "password": "TestPass!234", "firstName": "Box", "lastName": "Client",
        "phone": "780-555-0101", "dob": "1992-02-02", "marketingConsent": False, "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True,
    }, timeout=20)
    assert created.status_code == 200, created.text
    headers = _login(email, "TestPass!234")
    appt = _book(headers, "12:30")
    deadline = time.monotonic() + 15
    queued = sent = False
    while time.monotonic() < deadline:
        audit = requests.get(f"{_api()}/state", headers=owner, timeout=20).json()["audit"]
        queued = queued or any(row.get("action") == f"{appt['ref']} confirmation email queued" for row in audit)
        sent = sent or any(row.get("action") == f"{appt['ref']} confirmation email sent" for row in audit)
        if queued and sent:
            break
        time.sleep(0.2)
    assert queued and sent
    ops = requests.get(f"{_api()}/notifications/operations", headers=owner, timeout=20)
    assert ops.status_code == 200, ops.text
    assert ops.json()["meanings"]["providerAccepted"]
    denied = requests.get(f"{_api()}/notifications/operations", headers=headers, timeout=20)
    assert denied.status_code == 403


def test_demo_reset_drops_notification_rows_and_detached_accounts():
    owner = _owner()
    email = f"reset.{uuid.uuid4().hex[:8]}@resend.dev"
    assert requests.post(f"{_api()}/auth/register", json={
        "email": email, "password": "TestPass!234", "firstName": "Reset", "lastName": "Client",
        "phone": "780-555-0102", "dob": "1993-03-03", "marketingConsent": False, "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True,
    }, timeout=20).status_code == 200
    headers = _login(email, "TestPass!234")
    _book(headers, "13:00")
    reset = requests.post(f"{_api()}/demo/reset", headers=owner, timeout=30)
    assert reset.status_code == 200, reset.text
    again = requests.post(f"{_api()}/auth/login", json={"email": email, "password": "TestPass!234"}, timeout=20)
    assert again.status_code == 401
    ops = requests.get(f"{_api()}/notifications/operations", headers=owner, timeout=20).json()
    assert ops["counts"]["pending"] == 0
    assert ops["counts"]["sent"] == 0


def test_missing_client_profile_is_restored_before_confirmation():
    owner = _owner()
    email = f"restore.{uuid.uuid4().hex[:8]}@resend.dev"
    created = requests.post(f"{_api()}/auth/register", json={
        "email": email, "password": "TestPass!234", "firstName": "Restored", "lastName": "Client",
        "phone": "780-555-0103", "dob": "1994-04-04", "marketingConsent": False, "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True,
    }, timeout=20)
    assert created.status_code == 200, created.text
    subject = created.json()["subject"]
    url = _mongo()
    if not url:
        pytest.skip("MONGO_URL is required to remove the profile row")
    client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=2000)
    database = client[os.environ.get("DB_NAME") or "nabitouch"]

    async def _drop():
        await database.nt_clients.delete_one({"id": subject})

    _run(_drop())
    client.close()
    headers = _login(email, "TestPass!234")
    appt = _book(headers, "13:30")
    assert appt["clientId"] == subject
    deadline = time.monotonic() + 15
    found = False
    while time.monotonic() < deadline:
        audit = requests.get(f"{_api()}/state", headers=owner, timeout=20).json()["audit"]
        if any(row.get("action") == f"{appt['ref']} confirmation email sent" for row in audit):
            found = True
            break
        time.sleep(0.2)
    assert found, "restored profile did not produce a confirmation audit"
