"""Isolated regressions. No genuine Resend delivery or inbox receipt is claimed."""
import asyncio
from datetime import datetime, timedelta, timezone
import os
import uuid

import pytest
from fastapi import HTTPException

from emailer import acceptance_guard, plain_email, send_email
from notifications import (apply_delivery_receipt, enqueue_booking_confirmation, enqueue_due_email_reminders,
    enqueue_email_test, freeze_delivery, notification_summary, PermanentDelivery, process_available)
from test_notifications import _db, _run, _Audit, _appt


def test_exact_preview_is_single_responsive_shell_without_login_or_timezone():
    from email_templates import email_test_message
    from emailtpl import wrap, MARKER
    from emailer import _assert_safe_email
    subject, html = email_test_message()
    assert subject == "Nabitouch — Email Delivery Test"
    assert html.count(MARKER) == 1 and html.count('<!doctype html>') == 1
    assert html.count("Breathe. Feel. Heal. Anywhere.") == 1
    assert 'width="560"' not in html and 'max-width:600px' in html
    assert 'href=' not in html and 'Times are shown' not in html
    assert 'background:#0B1B3F' in html
    assert wrap(html, subject) == html
    _assert_safe_email(subject, html)
    text = plain_email(html)
    assert "Hi there," in text and "No action is needed." in text
    assert "Nabitouch will never ask for your password or full payment card details by email." in text


def test_acceptance_preview_and_isolation_block_before_any_provider_call(monkeypatch):
    import hashlib
    import httpx
    from email_templates import email_test_message
    monkeypatch.setenv("EMAIL_ACCEPTANCE_MODE", "true")
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("EMAIL_ALLOWED_RECIPIENTS", "approved@example.invalid")
    monkeypatch.setenv("EMAIL_APPROVED_SENDERS", "bookings@nabitouch.com")
    monkeypatch.setenv("EMAIL_FROM", "Nabitouch <bookings@nabitouch.com>")
    monkeypatch.setenv("NOTIFICATION_WORKER_ENABLED", "false")
    monkeypatch.setenv("EMAIL_TEST_RECIPIENT", "")
    monkeypatch.setenv("EMAIL_PROVIDER_ISOLATION_CONFIRMED", "false")
    monkeypatch.setenv("EMAIL_APPROVED_PREVIEW_SHA256", "")
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: pytest.fail("No external send is permitted"))
    subject, html = email_test_message()
    with pytest.raises(HTTPException, match="isolation"):
        _run(send_email(to="approved@example.invalid", subject=subject, html=html))
    monkeypatch.setenv("EMAIL_PROVIDER_ISOLATION_CONFIRMED", "true")
    with pytest.raises(HTTPException, match="preview"):
        _run(send_email(to="approved@example.invalid", subject=subject, html=html))
    monkeypatch.setenv("EMAIL_APPROVED_PREVIEW_SHA256", hashlib.sha256(html.encode()).hexdigest())
    from emailer import acceptance_message_guard
    acceptance_message_guard(subject, html)
    for changed_subject, changed_html in [(subject + "!", html), (subject, html + " ")]:
        with pytest.raises(HTTPException, match="preview"):
            _run(send_email(to="approved@example.invalid", subject=changed_subject, html=changed_html))


def test_acceptance_blocks_unapproved_original_and_redirect_recipient(monkeypatch):
    monkeypatch.setenv("EMAIL_ACCEPTANCE_MODE", "true")
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("EMAIL_ALLOWED_RECIPIENTS", "approved@example.invalid")
    monkeypatch.setenv("EMAIL_APPROVED_SENDERS", "bookings@nabitouch.com")
    monkeypatch.setenv("EMAIL_FROM", "Nabitouch <bookings@nabitouch.com>")
    monkeypatch.setenv("NOTIFICATION_WORKER_ENABLED", "false")
    monkeypatch.setenv("EMAIL_TEST_RECIPIENT", "approved@example.invalid")
    with pytest.raises(HTTPException, match="not approved"):
        _run(send_email(to="customer@example.invalid", subject="test", html="<p>test</p>"))
    acceptance_guard("approved@example.invalid")
    monkeypatch.setenv("EMAIL_APPROVED_SENDERS", "")
    with pytest.raises(HTTPException, match="Sender"):
        acceptance_guard("approved@example.invalid")


def test_resend_payload_has_plain_text_and_stable_key(monkeypatch):
    import httpx
    monkeypatch.setenv("EMAIL_PROVIDER", "resend")
    monkeypatch.setenv("RESEND_API_KEY", "synthetic-only")
    monkeypatch.setenv("EMAIL_FROM", "Nabitouch <bookings@nabitouch.com>")
    monkeypatch.setenv("APP_URL", "https://qa.nabitouch.example")
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, headers, json):
            assert headers["Idempotency-Key"] == "fixture-email-key"
            assert "Nabitouch" in json["text"] and "https://qa.nabitouch.example/me" in json["text"]
            assert "<table" not in json["text"]
            return httpx.Response(200, json={"id": "synthetic-provider-id"})
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: Client())
    assert _run(send_email(to="synthetic@example.invalid", subject="Test", html="<p>Body</p>", idempotency_key="fixture-email-key")) == "synthetic-provider-id"


def test_early_receipt_reconciles_after_acceptance_without_duplicate_or_downgrade():
    async def run():
        client, db = await _db()
        try:
            note, _ = await enqueue_booking_confirmation(db, _appt(), "c-synthetic")
            receipt = {"type": "email.delivered", "data": {"email_id": "provider-fixture"}}
            assert await apply_delivery_receipt(db, receipt, "event-delivered") is False
            async def deliver(_): return "provider-fixture"
            await process_available(db, deliver, "worker", _Audit())
            row = await db.nt_notifications.find_one({"id": note["id"]})
            assert row["deliveredAt"] and row["deliveryStatus"] == "delivered"
            delivered = row["deliveredAt"]
            assert await apply_delivery_receipt(db, receipt, "event-delivered") is False
            assert (await db.nt_notifications.find_one({"id": note["id"]}))["deliveredAt"] == delivered
            assert await apply_delivery_receipt(db, {"type": "email.bounced", "data": {"email_id": "provider-fixture"}}, "event-bounced")
            await apply_delivery_receipt(db, receipt, "late-delivered")
            row = await db.nt_notifications.find_one({"id": note["id"]})
            assert row["deliveryStatus"] == "bounced"
            assert (await notification_summary(db))["attention"][0]["deliveryStatus"] == "bounced"
            assert await db.nt_email_events.count_documents({}) == 3
        finally:
            await client.drop_database(db.name); client.close()
    _run(run())


def test_outbox_payload_changes_and_expired_retry_require_review():
    async def run():
        client, db = await _db()
        try:
            note, _ = await enqueue_booking_confirmation(db, _appt(), "c-synthetic")
            await freeze_delivery(db, note, {"subject": "original"})
            await freeze_delivery(db, note, {"subject": "original"})
            with pytest.raises(PermanentDelivery, match="message_changed"):
                await freeze_delivery(db, note, {"subject": "changed"})
            with pytest.raises(PermanentDelivery, match="idempotency_window"):
                await freeze_delivery(db, {**note, "firstAttemptAt": (datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()}, {"subject": "original"})
        finally:
            await client.drop_database(db.name); client.close()
    _run(run())


def test_controlled_test_retry_claims_only_its_id_and_never_resends_sent_row():
    async def run():
        client, db = await _db()
        try:
            unrelated, _ = await enqueue_booking_confirmation(db, _appt(), "unrelated")
            note, _ = await enqueue_email_test(db, "approved@example.invalid", "approved-key")
            duplicate, created = await enqueue_email_test(db, "approved@example.invalid", "approved-key")
            assert not created and duplicate["id"] == note["id"]
            sends = []
            async def deliver(row): sends.append(row["id"]); return "provider-test"
            await process_available(db, deliver, "owner", _Audit(), notification_id=note["id"])
            assert not await process_available(db, deliver, "owner", _Audit(), notification_id=note["id"])
            assert sends == [note["id"]]
            assert (await db.nt_notifications.find_one({"id": unrelated["id"]}))["status"] == "pending"
        finally:
            await client.drop_database(db.name); client.close()
    _run(run())


def test_email_reminders_stay_disabled_and_enabled_windows_deduplicate(monkeypatch):
    async def run():
        client, db = await _db()
        try:
            from zoneinfo import ZoneInfo
            now = datetime(2026, 11, 20, 10, 0, tzinfo=ZoneInfo("America/Edmonton"))
            await db.nt_appointments.insert_one({"id": "reminder-synthetic", "clientId": "c-synthetic", "date": "2026-11-21", "time": "09:00", "status": "confirmed"})
            coll = lambda name: db["nt_"+name]
            monkeypatch.setenv("EMAIL_REMINDERS_ENABLED", "false")
            assert await enqueue_due_email_reminders(db, coll, now) == 0
            monkeypatch.setenv("EMAIL_REMINDERS_ENABLED", "true")
            assert await enqueue_due_email_reminders(db, coll, now) == 1
            assert await enqueue_due_email_reminders(db, coll, now) == 0
        finally:
            await client.drop_database(db.name); client.close()
    _run(run())


def test_review_invitation_uses_durable_outbox_without_inline_send(monkeypatch):
    async def run():
        from reviews import prepare_review_invite, ensure_reviews
        client, db = await _db()
        try:
            await ensure_reviews(db)
            await db.nt_clients.insert_one({"id": "c-synthetic", "firstName": "Synthetic", "email": "synthetic@example.invalid"})
            monkeypatch.setenv("REVIEW_INVITES_ENABLED", "true")
            appt = {"id": "review-synthetic", "clientId": "c-synthetic", "status": "completed"}
            await prepare_review_invite(db, lambda name: db["nt_"+name], appt)
            await prepare_review_invite(db, lambda name: db["nt_"+name], appt)
            assert await db.nt_notifications.count_documents({"kind": "review_invite", "status": "pending"}) == 1
            assert (await db.nt_review_invites.find_one({"appointmentId": appt["id"]}))["status"] == "queued"
        finally:
            await client.drop_database(db.name); client.close()
    _run(run())


def test_durable_receipt_can_be_repaired_without_replaying_or_sending():
    async def run():
        from notifications import reconcile_pending_email_receipts
        client, db = await _db()
        try:
            note, _ = await enqueue_booking_confirmation(db, _appt(), "c-synthetic")
            await apply_delivery_receipt(db, {"type": "email.delivered", "data": {"email_id": "early-provider"}}, "early-event")
            await db.nt_notifications.update_one({"id": note["id"]}, {"$set": {"providerId": "early-provider", "status": "sent"}})
            await reconcile_pending_email_receipts(db)
            assert (await db.nt_notifications.find_one({"id": note["id"]}))["deliveryStatus"] == "delivered"
        finally:
            await client.drop_database(db.name); client.close()
    _run(run())


@pytest.mark.parametrize("kind", ["booking_confirmation", "reminder_24h", "reminder_2h", "cancellation", "reschedule", "review_invite", "invoice", "receipt"])
def test_transactional_templates_exclude_clinical_sentinels(monkeypatch, kind):
    async def run():
        import server
        client, db = await _db()
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setenv("APP_URL", "https://qa.nabitouch.example")
        captured = []
        async def capture(note, **payload): captured.append(payload); return "mock"
        monkeypatch.setattr(server, "_send_note", capture)
        try:
            private = {"clinicalNotes": "PRIVATE_CLINICAL_SENTINEL", "intake": "PRIVATE_INTAKE_SENTINEL", "signature": "PRIVATE_SIGNATURE_SENTINEL", "notes": "PRIVATE_NOTES_SENTINEL"}
            appt = {"id": "a-synthetic", "ref": "SYN-01", "date": "2026-11-20", "time": "10:00", "status": "confirmed", "clientId": "c-synthetic", "serviceSlug": "swedish", "duration": 60, "address": {"line": "Public synthetic location", **private}, "pricing": {"total": 100}, **private}
            await db.nt_appointments.insert_one(appt)
            await db.nt_clients.insert_one({"id": "c-synthetic", "firstName": "Synthetic", "email": "synthetic@example.invalid", **private})
            await db.nt_services.insert_one({"slug": "swedish", "name": "Massage"})
            note = {"id": "note-synthetic", "kind": kind, "clientId": "c-synthetic", "appointmentId": "a-synthetic"}
            if kind in ("invoice", "receipt"):
                await db.nt_invoices.insert_one({"id": "inv-synthetic", "version": 0, "number": "SYN-INV", "clientId": "c-synthetic", "appointmentId": "a-synthetic", "state": "issued", "totalCents": 10000, "serviceDate": "2026-11-20", "lines": [], **private})
                note["invoiceId"] = "inv-synthetic"
            await server._deliver_booking(note)
            assert len(captured) == 1
            content = captured[0]["subject"] + captured[0]["html"] + plain_email(captured[0]["html"])
            assert "PRIVATE_" not in content
        finally:
            await client.drop_database(db.name); client.close()
    _run(run())
