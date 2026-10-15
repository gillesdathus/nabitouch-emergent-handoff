"""Transactional email with a content guardrail.

Production uses Resend directly. The Emergent proxy is refused in production.
Mock keeps the message in memory. Disabled returns no provider id.
"""
import os
import re
import ipaddress
import logging
import base64
import hashlib
import hmac
import time
import httpx
from html.parser import HTMLParser
from urllib.parse import urlparse
from fastapi import HTTPException

logger = logging.getLogger(__name__)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


OUTBOX: list[dict] = []


def clear_outbox():
    OUTBOX.clear()


def resend_webhook_authentic(body: bytes, headers, secret: str, now=None) -> bool:
    """Svix signature used by Resend webhooks. The secret stays out of logs."""
    msg_id = headers.get("svix-id") or ""
    timestamp = headers.get("svix-timestamp") or ""
    signature = headers.get("svix-signature") or ""
    if not msg_id or not timestamp or not signature or not secret:
        return False
    try:
        stamp = int(timestamp)
    except ValueError:
        return False
    moment = time.time() if now is None else now
    if abs(moment - stamp) > 300:
        return False
    raw_secret = secret[6:] if secret.startswith("whsec_") else secret
    try:
        key = base64.b64decode(raw_secret)
    except Exception:
        return False
    digest = base64.b64encode(hmac.new(key, f"{msg_id}.{timestamp}.".encode() + body, hashlib.sha256).digest()).decode()
    for part in signature.split():
        version, _, value = part.partition(",")
        if version == "v1" and hmac.compare_digest(value, digest):
            return True
    return False


async def send_email(*, to: str, subject: str, html: str, idempotency_key: str | None = None) -> str | None:
    from config import email_provider
    _assert_safe_email(subject, html)
    provider = email_provider()
    if provider == "mock":
        message_id = f"mock-{len(OUTBOX) + 1}"
        OUTBOX.append({"id": message_id, "to": to, "subject": subject})
        return message_id
    if provider == "disabled":
        logger.info("Email provider disabled; message not sent")
        return None
    if provider == "resend":
        return await _send_resend(to=to, subject=subject, html=html, idempotency_key=idempotency_key)
    if provider != "emergent":
        raise HTTPException(503, "Email is not configured")
    payload = {"to": [to], "subject": subject, "html": html, "from_name": os.environ["EMAIL_FROM_NAME"]}
    if os.environ.get("EMAIL_REPLY_TO"):
        payload["contact_email"] = os.environ["EMAIL_REPLY_TO"]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": os.environ["EMERGENT_EMAIL_KEY"]}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        try:
            code = e.response.json().get("code", "")
        except ValueError:
            code = ""
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):
            logger.warning(f"Email paused: {code} ({e.response.status_code}): {e.response.text}")
            raise HTTPException(503, "Email is temporarily unavailable")
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(502, "Failed to send email")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Email send error")
        raise HTTPException(500, "Failed to send email")


async def _send_resend(*, to: str, subject: str, html: str, idempotency_key: str | None):
    key = (os.environ.get("RESEND_API_KEY") or "").strip()
    sender = (os.environ.get("EMAIL_FROM") or "").strip()
    if not key or not sender:
        raise HTTPException(503, "Email is not configured")
    payload = {"from": sender, "to": [to], "subject": subject, "html": html}
    reply = (os.environ.get("EMAIL_REPLY_TO") or "").strip()
    if reply:
        payload["reply_to"] = reply
    headers = {"Authorization": f"Bearer {key}"}
    if idempotency_key:
        headers["Idempotency-Key"] = str(idempotency_key)[:256]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post("https://api.resend.com/emails", headers=headers, json=payload)
    except HTTPException:
        raise
    except Exception:
        logger.error("Resend send error")
        raise HTTPException(503, "Email is temporarily unavailable")
    if resp.status_code in (408, 429, 500, 502, 503):
        logger.warning("Resend temporarily unavailable: %s", resp.status_code)
        raise HTTPException(503, "Email is temporarily unavailable")
    if resp.status_code >= 400:
        logger.error("Resend rejected the message: %s", resp.status_code)
        raise HTTPException(502, "Failed to send email")
    try:
        message_id = resp.json().get("id")
    except ValueError:
        message_id = None
    if not message_id:
        raise HTTPException(502, "Failed to send email")
    return message_id
