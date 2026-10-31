"""Slice 1 — shareable Stripe payment-link email uses server checkout URL and optional recipient."""
import asyncio

from pymongo.errors import DuplicateKeyError

from email_templates import payment_link_email
from notifications import enqueue_billing


def test_payment_link_email_prefers_payable_amount():
    view = {
        "number": "NT-INV-00042",
        "balance": {"cents": 10000, "display": "$100.00"},
        "payableNow": {"cents": 2000, "display": "$20.00"},
    }
    subject, html = payment_link_email("Nabitouch", "Sarah", view, "https://checkout.stripe.com/c/pay/cs_test")
    assert "NT-INV-00042" in subject
    assert "$20.00" in html
    assert "https://checkout.stripe.com/c/pay/cs_test" in html
    amount_cell = html.split("Amount due")[1].split("</tr>")[0]
    assert "$20.00" in amount_cell
    assert "$100.00" not in amount_cell


def test_payment_link_email_falls_back_to_balance():
    view = {"number": "NT-INV-1", "balance": {"cents": 5500, "display": "$55.00"}}
    _subject, html = payment_link_email("Nabitouch", "there", view, "https://app.nabitouch.com/me/billing")
    assert "$55.00" in html


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


class _FakeNotes:
    def __init__(self):
        self.rows = {}

    async def insert_one(self, doc):
        key = doc["dedupeKey"]
        if key in self.rows:
            raise DuplicateKeyError("dup")
        self.rows[key] = {**doc}
        return None

    async def find_one(self, query, *_a, **_k):
        return self.rows.get(query.get("dedupeKey"))


class _FakeDB:
    def __init__(self):
        self.nt_notifications = _FakeNotes()


def test_enqueue_billing_stores_shareable_link_fields():
    async def run():
        db = _FakeDB()
        invoice = {"id": "inv-plink-1", "number": "NT-INV-9", "appointmentId": "a-1", "clientId": "c-1"}
        note, created = await enqueue_billing(
            db, invoice, "payment_link", "idem-plink-001234",
            payment_url="https://checkout.stripe.com/c/pay/cs_test_abc",
            recipient_email="Care.Giver@Example.org",
            amount_cents=2000,
        )
        assert created is True
        assert note["paymentUrl"].startswith("https://checkout.stripe.com/")
        assert note["recipientEmail"] == "care.giver@example.org"
        assert note["amountCents"] == 2000
        again, created_again = await enqueue_billing(
            db, invoice, "payment_link", "idem-plink-001234",
            payment_url="https://checkout.stripe.com/c/pay/cs_other",
            recipient_email="other@example.org",
            amount_cents=1,
        )
        assert created_again is False
        assert again["paymentUrl"] == note["paymentUrl"]

    _run(run())


def test_payment_link_delivery_fields_prefer_stripe_url_and_override():
    """Mirrors _deliver_billing recipient/link selection without importing the full server module."""
    note = {
        "paymentUrl": "https://checkout.stripe.com/c/pay/cs_test_live",
        "recipientEmail": "authorized.other@nabitouch.com",
        "amountCents": 2000,
    }
    client_email = "patient@nabitouch.com"
    override = (note.get("recipientEmail") or "").strip().lower()
    to = override or client_email
    link = (note.get("paymentUrl") or "").strip() or "https://app.nabitouch.com/me/billing"
    view = {
        "number": "NT-INV-1",
        "balance": {"cents": 10000, "display": "$100.00"},
        "payableNow": {"cents": note["amountCents"], "display": "$20.00"},
    }
    _subject, html = payment_link_email("Nabitouch", "Pat", view, link)
    assert to == "authorized.other@nabitouch.com"
    assert "https://checkout.stripe.com/c/pay/cs_test_live" in html
    assert "/me/billing" not in html
    assert "$20.00" in html
