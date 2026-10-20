"""Practitioner booking email — dual-role recipient resolution and durable queue."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from notifications import enqueue_practitioner_notice, resolve_practitioner_account


@pytest.mark.asyncio
async def test_resolve_practitioner_account_supports_dual_owner_roles():
    db = MagicMock()
    db.nt_users.find_one = AsyncMock(return_value={
        "id": "u-nabitu",
        "email": "nabitu@nabitouch.com",
        "name": "Nabitu Kahindo",
        "role": "owner",
        "roles": ["owner", "practitioner"],
        "subject": "p-nabitu-kahindo",
    })
    account = await resolve_practitioner_account(db, "p-nabitu-kahindo")
    assert account["email"] == "nabitu@nabitouch.com"
    db.nt_users.find_one.assert_awaited()


@pytest.mark.asyncio
async def test_resolve_skips_example_and_missing_email():
    db = MagicMock()
    db.nt_users.find_one = AsyncMock(return_value={"id": "u1", "email": "demo@example.com", "subject": "p-1"})
    assert await resolve_practitioner_account(db, "p-1") is None
    db.nt_users.find_one = AsyncMock(return_value=None)
    assert await resolve_practitioner_account(db, "p-missing") is None
    assert await resolve_practitioner_account(db, None) is None


@pytest.mark.asyncio
async def test_enqueue_practitioner_notice_is_idempotent():
    from pymongo.errors import DuplicateKeyError

    db = MagicMock()
    db.nt_notifications.insert_one = AsyncMock(side_effect=[None, DuplicateKeyError("dup")])
    db.nt_notifications.find_one = AsyncMock(return_value={"id": "ntf-existing", "dedupeKey": "practitioner_booking:a-1:x"})
    appt = {
        "id": "a-1", "ref": "NT-1200", "clientId": "c-1", "practitionerId": "p-nabitu-kahindo",
        "date": "2026-10-20", "time": "10:00", "status": "assigned",
    }
    note, created = await enqueue_practitioner_notice(db, appt, "practitioner_booking")
    assert created is True
    note2, created2 = await enqueue_practitioner_notice(db, appt, "practitioner_booking")
    assert created2 is False
    assert note2["id"] == "ntf-existing"


@pytest.mark.asyncio
async def test_enqueue_requires_practitioner_and_known_kind():
    db = MagicMock()
    db.nt_notifications.insert_one = AsyncMock()
    empty, created = await enqueue_practitioner_notice(db, {"id": "a-1"}, "practitioner_booking")
    assert empty is None and created is False
    with pytest.raises(ValueError):
        await enqueue_practitioner_notice(db, {"id": "a-1", "practitionerId": "p-1"}, "marketing")
