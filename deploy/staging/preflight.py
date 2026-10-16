"""Read-only staging configuration validation. Never prints values or connects to services."""
import argparse
import base64
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def read_env(path):
    values = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return values


def validate(api, frontend):
    errors = []
    def check(ok, label):
        if not ok:
            errors.append(label)
    def real(value):
        return bool(value) and not any(word in value.lower() for word in ("replace", "placeholder", "example", "changeme"))
    check(api.get("APP_ENV") == "production" and api.get("DEMO_MODE") == "false", "production guards/demo mode")
    check(api.get("COOKIE_SECURE") == "true" and api.get("COOKIE_SAMESITE") == "lax", "secure same-site cookies")
    origin = urlparse(api.get("APP_URL", ""))
    check(origin.scheme == "https" and real(origin.hostname or "") and origin.path in ("", "/") and not origin.username and not origin.query, "approved HTTPS origin")
    check(api.get("CORS_ORIGINS") == api.get("APP_URL") == frontend.get("REACT_APP_BACKEND_URL"), "exact staging frontend/API origins")
    mongo = urlparse(api.get("MONGO_URL", ""))
    check(api.get("DB_NAME") == "nabitouch_staging" and mongo.hostname == "mongo" and mongo.path == "/nabitouch_staging" and mongo.scheme == "mongodb", "isolated staging Mongo destination")
    check(mongo.username == "staging_app" and real(mongo.password or "") and len(mongo.password or "") >= 16, "least-privilege staging Mongo credentials")
    check(parse_qs(mongo.query).get("replicaSet") == ["rs0"] and parse_qs(mongo.query).get("authSource") == ["nabitouch_staging"], "Mongo replica/auth database")
    redis = urlparse(api.get("REDIS_URL", ""))
    check(redis.scheme == "rediss" and redis.hostname == "redis" and real(redis.password or "") and len(redis.password or "") >= 16, "isolated authenticated TLS Redis")
    query = parse_qs(redis.query)
    check(query.get("ssl_ca_certs") == ["/certs/ca.crt"] and query.get("ssl_cert_reqs", ["required"])[0] not in ("none", "0"), "Redis certificate validation")
    for key in ("JWT_SECRET", "OWNER_PASSWORD"):
        check(real(api.get(key, "")) and len(api.get(key, "")) >= 32, key + " supplied independently")
    check(api.get("JWT_SECRET") != api.get("OWNER_PASSWORD"), "independent application secrets")
    try:
        check(len(base64.urlsafe_b64decode(api.get("FIELD_ENCRYPTION_KEY", ""))) == 32, "field encryption key")
    except (ValueError, TypeError):
        errors.append("field encryption key")
    token = api.get("MAPBOX_TOKEN", "")
    browser_token = frontend.get("REACT_APP_MAPBOX_PUBLIC_TOKEN", "")
    check(real(token) and token.startswith(("pk.", "sk.")), "Mapbox server token")
    check(not browser_token or (real(browser_token) and browser_token.startswith("pk.") and browser_token != token), "separate public Mapbox token")
    flags = ("DOCUMENT_UPLOADS_ENABLED", "STRIPE_CARD_CHECKOUT_ENABLED", "LEGACY_PATIENT_IMPORT_ENABLED", "GIFTCARDS_ENABLED", "EMAIL_LIFECYCLE_ENABLED", "INVOICE_EMAIL_ENABLED", "STATEMENT_EMAIL_ENABLED", "REVIEW_INVITES_ENABLED", "SMS_ENABLED", "PUSH_ENABLED", "GEO_SAMPLE_CATALOG")
    for flag in flags:
        check(api.get(flag) == "false", flag + " remains disabled before acceptance authorization")
    check(api.get("EMAIL_PROVIDER") == "disabled" and api.get("PUSH_DRY_RUN") == "true", "delivery disabled/dry-run")
    check(not api.get("STRIPE_SECRET_KEY") and not api.get("RESEND_API_KEY") and not api.get("FIREBASE_SERVICE_ACCOUNT_FILE"), "external credentials deferred until authorized integration phase")
    check(not api.get("LEGACY_MONGO_URL") and not api.get("LEGACY_DB_NAME"), "legacy/production source absent")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-env", required=True)
    parser.add_argument("--frontend-env", required=True)
    args = parser.parse_args()
    errors = validate(read_env(args.api_env), read_env(args.frontend_env))
    for label in errors:
        print("BLOCKED:", label)
    if not errors:
        print("PASS: initial staging configuration guards; no deployment or external integration was performed")
    return 2 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
