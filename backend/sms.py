"""SMS readiness. No provider is contracted and nothing is sent.

Resend is email-only. A future provider must be approved separately, then
implemented behind `deliver`. Until that approval, `deliver` refuses every row.
"""
import re

DISABLED = "disabled"

# Planning figures only. They are not a quote and they do not start billing.
ESTIMATE = {
    "currency": "CAD",
    "perMessage": "0.01-0.05",
    "monthlyNumber": "1-5",
    "note": "Planning estimate for a future Canadian SMS provider. No messages are sent and no provider is billed.",
}


def provider_name():
    return DISABLED


def sending_enabled():
    """Hard off. A separate approval has to change this before any text can leave the server."""
    return False


def normalize_phone(raw):
    """Return E.164 for a Canadian or NANP number, or None when it cannot be used."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01":
        return None
    return "+1" + digits


def consent_allows(purpose, client):
    """Operational texts need an explicit future smsConsent. Marketing also needs the existing offer opt-in."""
    if not client:
        return False
    if purpose == "marketing":
        return bool(client.get("marketingConsent")) and bool(client.get("smsConsent"))
    if purpose == "operational":
        return bool(client.get("smsConsent"))
    return False


async def deliver(*, to, body, purpose, client=None):
    """Refuse delivery. The arguments are validated so a future provider can reuse this gate."""
    number = normalize_phone(to)
    if not number:
        return {"accepted": False, "channel": "sms", "status": "invalid_recipient", "provider": DISABLED}
    if not consent_allows(purpose, client):
        return {"accepted": False, "channel": "sms", "status": "no_consent", "provider": DISABLED}
    if not body or len(str(body)) > 320:
        return {"accepted": False, "channel": "sms", "status": "invalid_body", "provider": DISABLED}
    if not sending_enabled():
        return {"accepted": False, "channel": "sms", "status": "disabled", "provider": DISABLED}
    return {"accepted": False, "channel": "sms", "status": "disabled", "provider": DISABLED}


def readiness():
    return {
        "channel": "sms",
        "provider": DISABLED,
        "status": "disabled",
        "sending": False,
        "country": "CA",
        "consent": "smsConsent is required and is not collected yet. Marketing also requires marketingConsent.",
        "estimate": ESTIMATE,
    }
