"""Server-only Stripe test gateway. Never forwards provider errors or credentials."""
import os

import httpx
from fastapi import HTTPException

API_VERSION = "2026-08-26.dahlia; integration_identifier=nabitouch_qlagoonx"


def validate_stripe_env():
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    mode = os.environ.get("PAYMENT_MODE", "disabled").strip().lower()
    enabled = os.environ.get("STRIPE_CARD_CHECKOUT_ENABLED", "false").lower() in ("true", "1", "yes", "on")
    if key and not key.startswith(("sk_test_", "rk_test_")):
        raise RuntimeError("Only Stripe sandbox/test secret keys are permitted")
    if key and mode != "test":
        raise RuntimeError("Stripe test credentials require PAYMENT_MODE=test")
    if mode == "test":
        if not key or not os.environ.get("STRIPE_WEBHOOK_SECRET", "").startswith("whsec_"):
            raise RuntimeError("Stripe test mode requires server key and webhook signing secret")
        # Separate authorization is required for all customer delivery.
        if os.environ.get("EMAIL_PROVIDER", "disabled") != "disabled":
            raise RuntimeError("Stripe acceptance requires EMAIL_PROVIDER=disabled")
        for flag in ("EMAIL_LIFECYCLE_ENABLED", "INVOICE_EMAIL_ENABLED", "STATEMENT_EMAIL_ENABLED", "REVIEW_INVITES_ENABLED", "SMS_ENABLED", "PUSH_ENABLED", "GIFTCARDS_ENABLED"):
            if os.environ.get(flag, "false").lower() not in ("false", "0", "off", "no", ""):
                raise RuntimeError("Stripe acceptance requires customer delivery disabled: " + flag)
    elif enabled and mode != "simulated":
        raise RuntimeError("Enabled checkout requires explicit PAYMENT_MODE=test")


async def stripe_request(method, path, *, data=None, idempotency_key=None):
    try:
        validate_stripe_env()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if os.environ.get("PAYMENT_MODE") != "test" or not key:
        raise HTTPException(503, "Stripe sandbox is not configured")
    headers = {"Stripe-Version": API_VERSION}
    if method != "GET":
        if not idempotency_key:
            raise HTTPException(400, "Stripe operation requires an idempotency key")
        headers["Idempotency-Key"] = idempotency_key
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.request(method, "https://api.stripe.com/v1/" + path, auth=(key, ""), headers=headers, data=data)
        if response.status_code >= 400:
            raise HTTPException(502, "Stripe sandbox request failed; retry the same operation key")
        obj = response.json()
        if obj.get("livemode") is True:
            raise HTTPException(409, "Live Stripe objects are prohibited")
        return obj
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Stripe sandbox unavailable; retry the same operation key") from exc
