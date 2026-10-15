"""Environment rules for Nabitouch. Production refuses demo mode, wildcard CORS, and insecure cookies."""
import os


def app_env():
    return os.environ.get("APP_ENV", "development").strip().lower()


def is_production():
    return app_env() == "production"


def demo_mode():
    return os.environ.get("DEMO_MODE") == "true" and not is_production()


def cors_origins():
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw or raw == "*":
        raise RuntimeError("CORS_ORIGINS must be an explicit comma-separated list, not *")
    return [part.strip() for part in raw.split(",") if part.strip()]


def cookie_secure():
    default = "true" if is_production() else "false"
    return os.environ.get("COOKIE_SECURE", default).strip().lower() == "true"


def cookie_samesite():
    value = os.environ.get("COOKIE_SAMESITE", "lax").strip().lower()
    if value not in ("lax", "strict", "none"):
        raise RuntimeError("COOKIE_SAMESITE must be lax, strict, or none")
    return value


def email_provider():
    chosen = os.environ.get("EMAIL_PROVIDER", "").strip().lower()
    if chosen:
        return chosen
    return "disabled" if is_production() else "mock"


def email_lifecycle_enabled():
    """Cancellation, reschedule, and assignment mail. Off until explicitly approved."""
    return _flag("EMAIL_LIFECYCLE_ENABLED", False)


def payments_simulated():
    if is_production():
        return False
    return os.environ.get("PAYMENT_MODE", "simulated").strip().lower() == "simulated"


def _flag(name, default):
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def document_uploads_enabled():
    """Insurance and clinical file uploads. Unset stays off. Production must set the variable explicitly."""
    return _flag("DOCUMENT_UPLOADS_ENABLED", False)


def stripe_card_checkout_enabled():
    """Card checkout. Unset stays off. Production must set the variable explicitly. Cash and e-Transfer are separate."""
    return _flag("STRIPE_CARD_CHECKOUT_ENABLED", False)


def invoice_email_enabled():
    """Invoice, receipt, and payment-link email. Unset stays off."""
    return _flag("INVOICE_EMAIL_ENABLED", False)


def giftcards_enabled():
    """Gift-card purchase, issuance, redemption, and void. Unset stays off."""
    return _flag("GIFTCARDS_ENABLED", False)


def legacy_patient_import_enabled():
    """Historical patient and invoice imports. Unset stays off. Production must set the variable explicitly."""
    return _flag("LEGACY_PATIENT_IMPORT_ENABLED", False)


def sender_address():
    raw = (os.environ.get("EMAIL_FROM") or "").strip()
    if "<" in raw and raw.endswith(">"):
        return raw[raw.rfind("<") + 1:-1].strip().lower()
    return raw.lower()


def validate_redis(url):
    """Production Redis must be authenticated and encrypted. Development may use a local instance."""
    from urllib.parse import urlparse
    parsed = urlparse(url or "")
    if parsed.scheme != "rediss":
        raise RuntimeError("REDIS_URL must use rediss:// when APP_ENV=production")
    if not parsed.password:
        raise RuntimeError("REDIS_URL must include a password when APP_ENV=production")


def validate_env():
    required = ["MONGO_URL", "DB_NAME", "JWT_SECRET", "OWNER_EMAIL", "OWNER_PASSWORD", "EMAIL_FROM_NAME", "APP_URL"]
    if not is_production():
        required.append("DEMO_PASSWORD")
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Missing required environment variables: " + ", ".join(missing))
    if len(os.environ.get("JWT_SECRET", "")) < 16:
        raise RuntimeError("JWT_SECRET must be at least 16 characters")
    if is_production() and not os.environ.get("FIELD_ENCRYPTION_KEY"):
        raise RuntimeError("FIELD_ENCRYPTION_KEY is required when APP_ENV=production")
    if os.environ.get("FIELD_ENCRYPTION_KEY"):
        from fieldcrypto import current_key
        current_key()
    cors_origins()
    if cookie_samesite() == "none" and not cookie_secure():
        raise RuntimeError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
    if is_production():
        if os.environ.get("DEMO_MODE") == "true":
            raise RuntimeError("DEMO_MODE cannot be enabled when APP_ENV=production")
        if not cookie_secure():
            raise RuntimeError("COOKIE_SECURE must be true when APP_ENV=production")
        if email_provider() == "emergent":
            raise RuntimeError("EMAIL_PROVIDER=emergent cannot be used when APP_ENV=production")
        if not os.environ.get("REDIS_URL"):
            raise RuntimeError("REDIS_URL is required when APP_ENV=production")
        validate_redis(os.environ["REDIS_URL"])
        for name in ("DOCUMENT_UPLOADS_ENABLED", "STRIPE_CARD_CHECKOUT_ENABLED", "LEGACY_PATIENT_IMPORT_ENABLED"):
            raw = os.environ.get(name)
            if raw is None or str(raw).strip() == "":
                raise RuntimeError(f"{name} must be set explicitly when APP_ENV=production")
            if str(raw).strip().lower() not in ("true", "false", "1", "0", "yes", "no", "on", "off"):
                raise RuntimeError(f"{name} must be true or false")
        strategy = (os.environ.get("HOSTING_STRATEGY") or "").strip()
        if strategy not in ("shared-vps", "dedicated-vps"):
            raise RuntimeError("HOSTING_STRATEGY must be shared-vps or dedicated-vps")
        if strategy == "shared-vps" and (os.environ.get("CLAMAV_HOST") or "").strip():
            raise RuntimeError("CLAMAV_HOST must stay empty when HOSTING_STRATEGY=shared-vps")
        if email_provider() == "resend":
            if not (os.environ.get("RESEND_API_KEY") or "").strip():
                raise RuntimeError("RESEND_API_KEY is required when EMAIL_PROVIDER=resend")
            if not sender_address().endswith("@nabitouch.com"):
                raise RuntimeError("EMAIL_FROM must use an address at nabitouch.com")
    level = (os.environ.get("LOG_LEVEL") or "").strip().upper()
    if level:
        import logging
        if level not in ("DEBUG", "INFO", "WARNING", "ERROR"):
            raise RuntimeError("LOG_LEVEL must be DEBUG, INFO, WARNING, or ERROR")
        logging.getLogger().setLevel(level)
    token = os.environ.get("MAPBOX_TOKEN") or ""
    public = os.environ.get("REACT_APP_MAPBOX_PUBLIC_TOKEN") or ""
    if token and not (token.startswith("pk.") or token.startswith("sk.")):
        raise RuntimeError("MAPBOX_TOKEN must be a Mapbox pk. or sk. token")
    if public.startswith("sk."):
        raise RuntimeError("REACT_APP_MAPBOX_PUBLIC_TOKEN must be a public pk. token, not a secret sk. token.")
    if public and not public.startswith("pk."):
        raise RuntimeError("REACT_APP_MAPBOX_PUBLIC_TOKEN must be a public pk. token.")
    if token and public and token == public:
        raise RuntimeError("MAPBOX_TOKEN and REACT_APP_MAPBOX_PUBLIC_TOKEN must be different tokens")
    if is_production() and not token:
        raise RuntimeError("MAPBOX_TOKEN is required when APP_ENV=production")
