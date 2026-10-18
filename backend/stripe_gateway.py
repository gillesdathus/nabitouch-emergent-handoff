"""Server-only Stripe gateway helpers. Never forwards provider errors or credentials."""
import os

import httpx
from fastapi import HTTPException

API_VERSION = "2026-08-26.dahlia"


def _checkout_enabled():
    return os.environ.get("STRIPE_CARD_CHECKOUT_ENABLED", "false").lower() in ("true", "1", "yes", "on")


def payment_mode():
    return os.environ.get("PAYMENT_MODE", "disabled").strip().lower()


def validate_stripe_env():
    """Validate PAYMENT_MODE against Stripe secrets.

    - test: sandbox keys only; acceptance still requires delivery channels off.
    - live: matching live secret + webhook; checkout may be enabled when authorized.
    """
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    mode = payment_mode()
    enabled = _checkout_enabled()
    whsec = (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()

    if mode not in ("disabled", "simulated", "test", "live"):
        raise RuntimeError("PAYMENT_MODE must be disabled, simulated, test, or live")

    is_test_key = key.startswith(("sk_test_", "rk_test_"))
    is_live_key = key.startswith(("sk_live_", "rk_live_"))

    if key and not (is_test_key or is_live_key):
        raise RuntimeError("STRIPE_SECRET_KEY must be a sk_test_/rk_test_ or sk_live_/rk_live_ secret key")

    if mode == "test":
        if not is_test_key:
            raise RuntimeError("Stripe test mode requires a sk_test_ or rk_test_ secret key")
        if not whsec.startswith("whsec_"):
            raise RuntimeError("Stripe test mode requires server key and webhook signing secret")
        # Separate authorization is required for all customer delivery.
        if os.environ.get("EMAIL_PROVIDER", "disabled") != "disabled":
            raise RuntimeError("Stripe acceptance requires EMAIL_PROVIDER=disabled")
        for flag in (
            "EMAIL_LIFECYCLE_ENABLED",
            "INVOICE_EMAIL_ENABLED",
            "STATEMENT_EMAIL_ENABLED",
            "REVIEW_INVITES_ENABLED",
            "SMS_ENABLED",
            "PUSH_ENABLED",
            "GIFTCARDS_ENABLED",
        ):
            if os.environ.get(flag, "false").lower() not in ("false", "0", "off", "no", ""):
                raise RuntimeError("Stripe acceptance requires customer delivery disabled: " + flag)
        return

    if mode == "live":
        if key and not is_live_key:
            raise RuntimeError("Stripe live mode requires a sk_live_ or rk_live_ secret key when a secret key is set")
        if key and not whsec.startswith("whsec_"):
            raise RuntimeError("Stripe live mode requires a webhook signing secret when a secret key is set")
        if enabled and not (is_live_key and whsec.startswith("whsec_")):
            raise RuntimeError("Live card checkout requires a live secret key and webhook signing secret")
        return

    # disabled / simulated
    if is_live_key:
        raise RuntimeError("Live Stripe credentials require PAYMENT_MODE=live")
    if is_test_key:
        raise RuntimeError("Stripe test credentials require PAYMENT_MODE=test")
    if enabled and mode != "simulated":
        raise RuntimeError("Enabled checkout requires explicit PAYMENT_MODE=test or PAYMENT_MODE=live")


async def stripe_request(method, path, *, data=None, idempotency_key=None):
    try:
        validate_stripe_env()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    mode = payment_mode()
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if mode not in ("test", "live") or not key:
        raise HTTPException(503, "Stripe is not configured")
    if mode == "live" and not _checkout_enabled():
        raise HTTPException(503, "Card checkout is turned off")
    headers = {"Stripe-Version": API_VERSION}
    if method != "GET":
        if not idempotency_key:
            raise HTTPException(400, "Stripe operation requires an idempotency key")
        headers["Idempotency-Key"] = idempotency_key
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.request(method, "https://api.stripe.com/v1/" + path, auth=(key, ""), headers=headers, data=data)
        if response.status_code >= 400:
            raise HTTPException(502, "Stripe request failed; retry the same operation key")
        obj = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Stripe unavailable; retry the same operation key") from exc
    live_obj = obj.get("livemode") is True
    if mode == "test" and live_obj:
        raise HTTPException(409, "Live Stripe objects are prohibited")
    if mode == "live" and obj.get("livemode") is False:
        raise HTTPException(409, "Sandbox Stripe objects are prohibited in live mode")
    return obj
