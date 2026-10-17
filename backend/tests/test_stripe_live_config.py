"""Focused PAYMENT_MODE=live configuration rules. No live Stripe network calls."""
import hashlib
import hmac
import time

import pytest

from config import stripe_card_checkout_enabled
from stripe_gateway import validate_stripe_env


def _live_ok(monkeypatch):
    monkeypatch.setenv("PAYMENT_MODE", "live")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_synthetic_fixture")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_synthetic_fixture")
    monkeypatch.setenv("STRIPE_CARD_CHECKOUT_ENABLED", "false")


def test_live_mode_accepts_live_key_with_checkout_disabled(monkeypatch):
    _live_ok(monkeypatch)
    validate_stripe_env()
    assert stripe_card_checkout_enabled() is False


def test_live_mode_rejects_test_key(monkeypatch):
    _live_ok(monkeypatch)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_synthetic_fixture")
    with pytest.raises(RuntimeError, match="live mode requires a sk_live_"):
        validate_stripe_env()


def test_live_mode_requires_webhook_secret_when_key_set(monkeypatch):
    _live_ok(monkeypatch)
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "")
    with pytest.raises(RuntimeError, match="webhook signing secret"):
        validate_stripe_env()


def test_live_mode_refuses_enabled_checkout(monkeypatch):
    _live_ok(monkeypatch)
    monkeypatch.setenv("STRIPE_CARD_CHECKOUT_ENABLED", "true")
    with pytest.raises(RuntimeError, match="Live card checkout remains disabled"):
        validate_stripe_env()


def test_live_credentials_require_live_mode(monkeypatch):
    monkeypatch.setenv("PAYMENT_MODE", "disabled")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_synthetic_fixture")
    monkeypatch.setenv("STRIPE_CARD_CHECKOUT_ENABLED", "false")
    with pytest.raises(RuntimeError, match="PAYMENT_MODE=live"):
        validate_stripe_env()


def test_webhook_signature_validation_still_enforced():
    # Import locally so pure config tests do not pull optional PDF/billing deps at collection time.
    import billing

    payload = b'{"id":"evt_synthetic"}'
    secret = "whsec_synthetic_fixture"
    stamp = int(time.time())
    digest = hmac.new(secret.encode(), f"{stamp}.".encode() + payload, hashlib.sha256).hexdigest()
    assert billing.stripe_signature_matches(payload, f"t={stamp},v1={digest}", secret)
    assert not billing.stripe_signature_matches(payload, f"t={stamp},v1=deadbeef", secret)
    assert not billing.stripe_signature_matches(payload, "", secret)
