"""Launch configuration. No live Mapbox, Resend, Stripe, or patient data."""
import base64
import hashlib
import hmac
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
import requests

from config import validate_env
from emailer import resend_webhook_authentic, send_email
from notifications import apply_delivery_receipt
from seed import build_launch_seed

ROOT = Path(__file__).resolve().parents[1]
API = "http://127.0.0.1:8014/api"


def _production_base(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("EMAIL_PROVIDER", "disabled")
    monkeypatch.setenv("MONGO_URL", os.environ.get("MONGO_URL") or "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "nabitouch_launch_unit")
    monkeypatch.setenv("JWT_SECRET", "launch-unit-secret-16")
    monkeypatch.setenv("OWNER_EMAIL", "admin@nabitouch.com")
    monkeypatch.setenv("OWNER_PASSWORD", "not-a-default-password")
    monkeypatch.setenv("EMAIL_FROM_NAME", "Nabitouch")
    monkeypatch.setenv("APP_URL", "https://nabitouch.com")
    monkeypatch.setenv("CORS_ORIGINS", "https://nabitouch.com")
    monkeypatch.setenv("REDIS_URL", "rediss://:test-password@redis:6379/0")
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode())
    monkeypatch.setenv("DOCUMENT_UPLOADS_ENABLED", "false")
    monkeypatch.setenv("STRIPE_CARD_CHECKOUT_ENABLED", "false")
    monkeypatch.setenv("LEGACY_PATIENT_IMPORT_ENABLED", "false")
    monkeypatch.setenv("HOSTING_STRATEGY", "shared-vps")
    monkeypatch.setenv("CLAMAV_HOST", "")
    monkeypatch.setenv("MAPBOX_TOKEN", "sk.test-not-a-live-token")
    monkeypatch.delenv("REACT_APP_MAPBOX_PUBLIC_TOKEN", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)


def test_launch_seed_has_catalogue_and_no_patients():
    seed = build_launch_seed()
    assert seed["services"]
    assert seed["zones"]
    assert seed["clients"] == []
    assert seed["appointments"] == []
    assert seed["soap"] == []
    assert seed["plans"] == []
    assert seed["practitioners"][0]["name"] == "Nabitu Kahindo"
    assert seed["practitioners"][0]["available"] is False
    assert seed["practitioners"][0]["onboardingStatus"] == "draft"
    assert "email" not in seed["practitioners"][0]
    assert seed["schedules"][0]["weekly"] == []
    assert seed["schedules"][0]["status"] == "draft"
    assert seed["settings"][0]["cashEnabled"] is True
    assert seed["settings"][0]["mfaEnforcePrivileged"] is False
    assert seed["settings"][0]["clinic"]["enabled"] is False
    assert seed["settings"][0]["clinic"]["address"] == ""
    assert seed["settings"][0]["clinic"]["email"] == "info@nabitouch.com"
    assert seed["settings"][0]["clinic"]["phoneDisplay"] == "(780) 235-6508"
    assert seed["settings"][0]["clinic"]["phoneTel"] == "+17802356508"
    assert seed["settings"][0]["clinic"]["hours"] == "By appointment only"
    assert seed["settings"][0]["clinic"]["mobileEnabled"] is True
    assert seed["settings"][0]["cancellationPolicy"]["status"] == "pending"
    assert seed["settings"][0]["cancellationPolicy"]["automaticFee"] is False
    assert seed["settings"][0]["scheduling"]["enforceAdjacentTravel"] is True
    fee = seed["settings"][0]["cancellationFee"]
    assert fee["enabled"] is False and fee["noShowEnabled"] is False and fee["automaticCollection"] is False
    assert fee["published"] is False and fee["effectiveOn"] is None
    assert seed["settings"][0]["recovery"]["exclusiveMinutes"] == 20
    assert "revenueTrend" not in seed["settings"][0]
    assert len(seed["services"]) == 11
    assert any(row.get("slug") == "ten-minutes-on-us" and row.get("kind") == "trial" for row in seed["services"])
    assert [zone["fee"] for zone in seed["zones"]] == [0, 15, 30]
    swedish = next(service for service in seed["services"] if service["slug"] == "swedish")
    assert swedish["prices"]["60"] == 120
    offer = seed["promotions"][0]
    assert offer["id"] == "promo-welcome"
    assert offer["code"] == "WELCOME20"
    assert offer["enabled"] is True
    assert offer["approval"] == "approved"
    assert offer["value"] == 20
    assert offer["maxDiscount"] == 40
    assert offer["stackable"] is False
    assert offer["eligibility"] == "first_online"
    assert offer["redemptions"] == 0
    assert offer["end"] is None
    assert seed["settings"][0]["rewards"]["enabled"] is False
    assert seed["settings"][0]["rewards"]["referralsEnabled"] is False


def test_production_launch_env_is_accepted(monkeypatch):
    _production_base(monkeypatch)
    validate_env()


def test_unset_restricted_flags_stay_off(monkeypatch):
    monkeypatch.delenv("DOCUMENT_UPLOADS_ENABLED", raising=False)
    monkeypatch.delenv("STRIPE_CARD_CHECKOUT_ENABLED", raising=False)
    monkeypatch.delenv("LEGACY_PATIENT_IMPORT_ENABLED", raising=False)
    from availability import clinic_is_bookable, feasible_slot
    from config import document_uploads_enabled, legacy_patient_import_enabled, stripe_card_checkout_enabled
    assert document_uploads_enabled() is False
    assert stripe_card_checkout_enabled() is False
    assert legacy_patient_import_enabled() is False
    clinic = feasible_slot(
        schedule=None, person={"id": "p-maya"}, service={"slug": "swedish", "enabled": True, "mobile": True},
        day="2026-10-22", start=9 * 60, duration=60, point=None, zone={"name": "core"},
        appointments=[], rules={}, drives=lambda _a, _b: (0, "none"),
        location_type="clinic", now=None, production=False,
    )
    assert clinic == {"ok": False, "reason": "In-clinic booking is not available"}
    assert clinic_is_bookable({"enabled": False, "address": "10150 104 St NW, Edmonton"}) is False
    assert clinic_is_bookable({"enabled": True, "address": "[Clinic address — to be supplied]"}) is False
    assert clinic_is_bookable({"enabled": True, "address": "10150 104 St NW, Edmonton"}) is True


def test_production_requires_explicit_upload_flag(monkeypatch):
    _production_base(monkeypatch)
    monkeypatch.delenv("DOCUMENT_UPLOADS_ENABLED")
    with pytest.raises(RuntimeError, match="DOCUMENT_UPLOADS_ENABLED"):
        validate_env()


def test_shared_vps_refuses_clamav(monkeypatch):
    _production_base(monkeypatch)
    monkeypatch.setenv("CLAMAV_HOST", "clamav")
    with pytest.raises(RuntimeError, match="CLAMAV_HOST"):
        validate_env()


def test_production_requires_mapbox_token(monkeypatch):
    _production_base(monkeypatch)
    monkeypatch.setenv("MAPBOX_TOKEN", "")
    with pytest.raises(RuntimeError, match="MAPBOX_TOKEN"):
        validate_env()


def test_production_accepts_distinct_public_scope_mapbox_tokens(monkeypatch):
    _production_base(monkeypatch)
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.backend-public-scope-token")
    monkeypatch.setenv("REACT_APP_MAPBOX_PUBLIC_TOKEN", "pk.frontend-url-restricted-token")
    validate_env()


def test_production_rejects_one_mapbox_token_used_for_both_roles(monkeypatch):
    _production_base(monkeypatch)
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.same-token-value-example")
    monkeypatch.setenv("REACT_APP_MAPBOX_PUBLIC_TOKEN", "pk.same-token-value-example")
    with pytest.raises(RuntimeError, match="different tokens"):
        validate_env()


def test_resend_sender_must_be_on_nabitouch(monkeypatch):
    _production_base(monkeypatch)
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_placeholder")
    monkeypatch.setenv("EMAIL_FROM", "Nabitouch <bookings@example.com>")
    with pytest.raises(RuntimeError, match="nabitouch.com"):
        validate_env()


def test_resend_send_uses_branded_from_and_does_not_call_without_a_key(monkeypatch):
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("EMAIL_FROM_NAME", "Nabitouch")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("EMAIL_FROM", "Nabitouch <bookings@nabitouch.com>")

    from fastapi import HTTPException
    import asyncio

    async def _run():
        with pytest.raises(HTTPException) as caught:
            await send_email(to="admin@nabitouch.com", subject="Booked", html="<p>https://nabitouch.com/me</p>")
        assert caught.value.status_code == 503

    asyncio.run(_run())
    asyncio.set_event_loop(asyncio.new_event_loop())


def test_resend_accepts_a_mocked_provider(monkeypatch):
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_placeholder")
    monkeypatch.setenv("EMAIL_FROM", "Nabitouch <bookings@nabitouch.com>")
    seen = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"id": "email_test_1"}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers, json):
            seen["url"] = url
            seen["auth"] = headers.get("Authorization", "")
            seen["key"] = headers.get("Idempotency-Key")
            seen["from"] = json["from"]
            seen["to"] = json["to"]
            assert "re_test_placeholder" not in json["html"]
            return FakeResponse()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", lambda *args, **kwargs: FakeClient())

    import asyncio

    async def _run():
        return await send_email(
            to="admin@nabitouch.com", subject="Booked", html="<p>https://nabitouch.com/me</p>",
            idempotency_key="note-1",
        )

    assert asyncio.run(_run()) == "email_test_1"
    asyncio.set_event_loop(asyncio.new_event_loop())
    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["auth"] == "Bearer re_test_placeholder"
    assert seen["key"] == "note-1"
    assert seen["from"] == "Nabitouch <bookings@nabitouch.com>"
    assert seen["to"] == ["admin@nabitouch.com"]


def test_resend_webhook_signature_and_receipt():
    secret_bytes = b"0123456789abcdef"
    secret = "whsec_" + base64.b64encode(secret_bytes).decode()
    body = b'{"type":"email.delivered","data":{"email_id":"email_test_1"}}'
    stamp = "1710000000"
    msg_id = "msg_test"
    digest = base64.b64encode(hmac.new(secret_bytes, f"{msg_id}.{stamp}.".encode() + body, hashlib.sha256).digest()).decode()
    headers = {"svix-id": msg_id, "svix-timestamp": stamp, "svix-signature": f"v1,{digest}"}
    assert resend_webhook_authentic(body, headers, secret, now=1710000000)
    headers["svix-signature"] = "v1,not-the-digest"
    assert not resend_webhook_authentic(body, headers, secret, now=1710000000)

    # Durable receipt/replay/race behavior is covered against isolated Mongo in
    # test_resend_acceptance.py; a one-method collection fake cannot verify it.


def _wait(url, proc):
    deadline = time.time() + 25
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            if requests.get(url, timeout=1).status_code == 200:
                return True
        except requests.RequestException:
            time.sleep(0.3)
    return False


def test_production_process_refuses_uploads_cards_and_import():
    env = os.environ.copy()
    env.update({
        "APP_ENV": "production", "DEMO_MODE": "false", "COOKIE_SECURE": "true", "EMAIL_PROVIDER": "disabled",
        "DB_NAME": os.environ["DB_NAME"] + "_launch",
        "REDIS_URL": "rediss://:test-password@127.0.0.1:6390/0",
        "DOCUMENT_UPLOADS_ENABLED": "false", "STRIPE_CARD_CHECKOUT_ENABLED": "false",
        "LEGACY_PATIENT_IMPORT_ENABLED": "false", "HOSTING_STRATEGY": "shared-vps",
        "CLAMAV_HOST": "", "MAPBOX_TOKEN": "sk.test-not-a-live-token",
    })
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8014"],
        cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert _wait(API + "/", proc), "launch API did not start"
        health = requests.get(API + "/health", timeout=10).json()
        assert health["documentUploads"] is False
        assert health["cardCheckout"] is False
        state = requests.get(API + "/state", timeout=20).json()
        assert state["clients"] == []
        assert state["appointments"] == []
        assert state["services"]
        # Full launch seed must run before trial upsert; a lone trial row skips reset_data.
        assert any(row.get("slug") == "swedish" for row in state["services"])
        assert state["settings"], "launch seed must include settings (trial upsert must not precede reset_data)"
        assert state["settings"][0]["documentUploadsEnabled"] is False
        assert state["settings"][0]["cardCheckoutEnabled"] is False
        checkout = requests.post(API + "/invoices/none/checkout", json={}, timeout=10)
        intent = requests.post(API + "/payments/none/intent", json={}, timeout=10)
        upload = requests.post(API + "/invoices/none/claims/none/documents", files={"upload": ("card.pdf", b"%PDF-1.4", "application/pdf")}, timeout=10)
        legacy = requests.post(API + "/legacy/import", json={"backupConfirmed": True, "authorize": True, "records": []}, timeout=10)
        history = requests.post(API + "/billing/imports/preview", files={"upload": ("rows.csv", b"id\n", "text/csv")}, timeout=10)
        assert checkout.status_code == 503 and "turned off" in checkout.text
        assert intent.status_code == 503 and "turned off" in intent.text
        assert upload.status_code == 403 and "turned off" in upload.text
        assert legacy.status_code == 403 and "turned off" in legacy.text
        assert history.status_code == 403 and "turned off" in history.text
        signed = requests.post(API + "/auth/login", json={"email": env["OWNER_EMAIL"], "password": env["OWNER_PASSWORD"]}, timeout=10)
        assert signed.status_code == 200
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
