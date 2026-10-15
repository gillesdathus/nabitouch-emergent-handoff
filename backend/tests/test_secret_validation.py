"""Validator statuses only. The sample values are fake and are not production secrets."""
import base64
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("validate_secrets", ROOT / "deploy" / "validate-production-secrets.py")
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def _key():
    return base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode()


def _env(**overrides):
    values = {
        "APP_ENV": "production",
        "APP_URL": "https://nabitouch.com",
        "CORS_ORIGINS": "https://nabitouch.com",
        "COOKIE_SECURE": "true",
        "COOKIE_SAMESITE": "lax",
        "JWT_SECRET": "jwt-secret-value-not-used-live",
        "OWNER_EMAIL": "admin@nabitouch.com",
        "OWNER_PASSWORD": "OwnerPasswordValue19",
        "MONGO_URL": "mongodb://ntnext:mongo-password-value@mongo:27017/nabitouch_prod?replicaSet=rs0&authSource=admin",
        "DB_NAME": "nabitouch_prod",
        "REDIS_PASSWORD": "redis-password-value",
        "REDIS_URL": "rediss://:redis-password-value@redis:6379/0",
        "FIELD_ENCRYPTION_KEY": _key(),
        "EMAIL_FROM_NAME": "Nabitouch",
        "EMAIL_FROM": '"Nabitouch <bookings@nabitouch.com>"',
        "EMAIL_PROVIDER": "resend",
        "HOSTING_STRATEGY": "shared-vps",
        "MAPBOX_TOKEN": "sk.server-token-example",
        "RESEND_API_KEY": "re_examplekeyvalue",
        "RESEND_WEBHOOK_SECRET": "",
        "DOCUMENT_UPLOADS_ENABLED": "false",
        "STRIPE_CARD_CHECKOUT_ENABLED": "false",
        "LEGACY_PATIENT_IMPORT_ENABLED": "false",
        "CLAMAV_HOST": "",
        "STRIPE_SECRET_KEY": "",
    }
    values.update(overrides)
    return "\n".join(f"{key}={value}" for key, value in values.items()) + "\n"


def _status(rows, name):
    return dict(rows)[name]


def test_missing_file_is_fail_and_the_rest_pending():
    rows = validator.assess(None)
    assert _status(rows, "environment file") == "FAIL"
    assert _status(rows, "mapbox backend token") == "PENDING"
    assert _status(rows, "resend api key") == "PENDING"
    assert all(status in ("PASS", "FAIL", "PENDING") for _, status in rows)


def test_complete_file_marks_missing_webhook_pending():
    frontend = "REACT_APP_BACKEND_URL=https://nabitouch.com\nREACT_APP_MAPBOX_PUBLIC_TOKEN=pk.public-token-example\n"
    rows = validator.assess(_env(), frontend_text=frontend, resend_status="PENDING", recovery_attested=False, file_mode=0o600)
    assert _status(rows, "application secrets") == "PASS"
    assert _status(rows, "field encryption key") == "PASS"
    assert _status(rows, "mongodb url") == "PASS"
    assert _status(rows, "redis") == "PASS"
    assert _status(rows, "secret independence") == "PASS"
    assert _status(rows, "mapbox backend token") == "PASS"
    assert _status(rows, "mapbox public token") == "PASS"
    assert _status(rows, "resend api key") == "PASS"
    assert _status(rows, "resend webhook") == "PENDING"
    assert _status(rows, "resend domain") == "PENDING"
    assert _status(rows, "document uploads") == "PASS"
    assert _status(rows, "card checkout") == "PASS"
    assert _status(rows, "legacy import") == "PASS"
    assert _status(rows, "recovery copy") == "PENDING"
    assert _status(rows, "stripe secret") == "PASS"


def test_public_scope_backend_token_passes_when_it_differs_from_the_browser_token():
    frontend = "REACT_APP_MAPBOX_PUBLIC_TOKEN=pk.frontend-url-restricted-token\n"
    rows = validator.assess(_env(MAPBOX_TOKEN="pk.backend-public-scope-token"), frontend_text=frontend, file_mode=0o600)
    assert _status(rows, "mapbox backend token") == "PASS"
    assert _status(rows, "mapbox public token") == "PASS"


def test_secret_browser_token_and_enabled_uploads_fail():
    frontend = "REACT_APP_MAPBOX_PUBLIC_TOKEN=sk.server-token-example\n"
    rows = validator.assess(
        _env(MAPBOX_TOKEN="pk.public-token-example", DOCUMENT_UPLOADS_ENABLED="true"),
        frontend_text=frontend,
        file_mode=0o600,
    )
    assert _status(rows, "mapbox backend token") == "PASS"
    assert _status(rows, "mapbox public token") == "FAIL"
    assert _status(rows, "document uploads") == "FAIL"


def test_identical_mapbox_tokens_fail():
    frontend = "REACT_APP_MAPBOX_PUBLIC_TOKEN=pk.public-token-example\n"
    rows = validator.assess(_env(MAPBOX_TOKEN="pk.public-token-example"), frontend_text=frontend, file_mode=0o600)
    assert _status(rows, "mapbox backend token") == "FAIL"
    assert _status(rows, "mapbox public token") == "FAIL"


def test_short_encryption_key_and_live_stripe_key_fail():
    rows = validator.assess(_env(FIELD_ENCRYPTION_KEY="aaaa", STRIPE_SECRET_KEY="sk_live_example"), file_mode=0o644)
    assert _status(rows, "field encryption key") == "FAIL"
    assert _status(rows, "stripe secret") == "FAIL"
    assert _status(rows, "mode") == "FAIL"


def test_repository_has_no_tracked_production_secret_file():
    assert validator.git_is_clean(str(ROOT)) is True
