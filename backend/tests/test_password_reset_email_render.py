"""Password-reset email must render without remote assets or hostile CSS (Apple Mail / Gmail / Outlook)."""
import asyncio
import os
import re

import pytest

from auth import RESET_MIN, reset_email_html
from emailer import assert_complete_email_body, plain_email, send_email
from emailtpl import MARKER, TEMPLATE_VERSION, wrap


SYNTHETIC_LINK = "https://nabitouch.com/reset-password?token=preview-not-a-real-token"


@pytest.fixture(autouse=True)
def _email_env(monkeypatch):
    monkeypatch.setenv("EMAIL_FROM_NAME", "Nabitouch")
    monkeypatch.setenv("APP_URL", "https://nabitouch.com")
    monkeypatch.setenv("SUPPORT_EMAIL", "info@nabitouch.com")
    monkeypatch.setenv("EMAIL_PROVIDER", "mock")
    monkeypatch.delenv("EMAIL_TEST_RECIPIENT", raising=False)
    monkeypatch.delenv("EMAIL_ACCEPTANCE_MODE", raising=False)


def _wrapped_reset():
    return wrap(reset_email_html("Alex", SYNTHETIC_LINK), "Reset your Nabitouch password")


def test_reset_html_has_button_and_plaintext_fallback_url():
    body = reset_email_html("Alex", SYNTHETIC_LINK)
    assert "Choose a new password" in body
    assert f'href="{SYNTHETIC_LINK}"' in body
    assert SYNTHETIC_LINK in body
    assert "copy and paste" in body.lower()
    assert str(RESET_MIN) in body
    assert "background-image:" not in body.lower()
    assert "<img" not in body.lower()
    assert "<script" not in body.lower()


def test_wrapped_reset_starts_with_doctype_marker_in_head():
    html = _wrapped_reset()
    assert html.lstrip().lower().startswith("<!doctype html")
    assert MARKER in html
    # Marker must not precede doctype (Apple Mail hang / blank body).
    assert html.index("<!doctype html") < html.index(MARKER)
    assert "background-image:" not in html.lower()
    assert "linear-gradient" not in html.lower()
    assert_complete_email_body(html)


def test_plain_text_multipart_includes_reset_url_not_blank():
    html = _wrapped_reset()
    text = plain_email(html)
    assert "Choose a new password" in text
    assert SYNTHETIC_LINK in text
    assert "Nabitouch" in text
    assert len(text) > 80


def test_assert_complete_rejects_leading_comment_and_gradients():
    with pytest.raises(ValueError, match="doctype"):
        assert_complete_email_body("<!-- x --><!doctype html><html><body><p>https://nabitouch.com/a</p></body></html>")
    with pytest.raises(ValueError, match="background-image"):
        assert_complete_email_body(
            '<!doctype html><html><body style="background-image:linear-gradient(#000,#fff)">'
            "<p>Hi https://nabitouch.com/reset</p></body></html>"
        )


def test_send_email_mock_delivers_complete_multipart(monkeypatch):
    from emailer import OUTBOX, clear_outbox

    clear_outbox()
    seen = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"id": "email_reset_preview_1"}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers, json):
            seen["payload"] = json
            return FakeResponse()

    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "re_test_placeholder")
    monkeypatch.setenv("EMAIL_FROM", "Nabitouch <bookings@nabitouch.com>")
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", lambda *args, **kwargs: FakeClient())

    mid = asyncio.run(
        send_email(
            to="info@nabitouch.com",
            subject="Reset your Nabitouch password",
            html=reset_email_html("Alex", SYNTHETIC_LINK),
            idempotency_key="reset-email-render-test",
        )
    )
    asyncio.set_event_loop(asyncio.new_event_loop())
    assert mid == "email_reset_preview_1"
    payload = seen["payload"]
    assert payload["html"].lstrip().lower().startswith("<!doctype html")
    assert "Choose a new password" in payload["html"]
    assert SYNTHETIC_LINK in payload["html"]
    assert SYNTHETIC_LINK in payload["text"]
    assert payload["text"].strip()
    assert "background-image:" not in payload["html"].lower()
    # Never treat the synthetic preview token as something to log in assertions beyond URL presence.
    assert "preview-not-a-real-token" in SYNTHETIC_LINK
    assert re.search(r"tide-2026-10", payload["tags"][0]["value"])
    assert TEMPLATE_VERSION.startswith("tide-")
    clear_outbox()
    assert OUTBOX == []
