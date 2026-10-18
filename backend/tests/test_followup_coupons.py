"""Follow-up coupons: issue once on complete, redeem exclusively, reject expired."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from followup_coupons import followup_quote, issue_on_complete, settle_followup, valid_followup


SERVICE = {"slug": "swedish", "taxable": True}
GST = 0.05


def test_followup_quote_is_exclusive_percent_off_treatment():
    quoted = {"base": 100, "addons": 0, "travel": 10, "discount": 20, "welcomeOffer": True, "appliedPromoIds": ["promo-welcome"]}
    priced = followup_quote(quoted, 20, GST, SERVICE)
    assert priced["discount"] == 20
    assert priced["welcomeOffer"] is False
    assert priced["appliedPromoIds"] == []
    assert priced["followUp"] is True
    assert priced["total"] == round(100 - 20 + 10 + (90 * GST), 2)


def test_issue_on_complete_is_idempotent_per_appointment():
    db = MagicMock()
    campaign = {
        "id": "cmp-1",
        "followUp": {"enabled": True, "percent": 20, "validDays": 14, "autoIssueOnComplete": True},
    }
    appt = {
        "id": "a-1",
        "ref": "NT-1",
        "clientId": "c-1",
        "status": "completed",
        "pricing": {"campaignId": "cmp-1"},
    }
    db.nt_followup_coupons.find_one = AsyncMock(side_effect=[None, {"id": "fu-1", "code": "NEXT-AAAAAA", "appointmentId": "a-1"}])
    db.nt_campaigns.find_one = AsyncMock(return_value=campaign)
    db.nt_followup_coupons.insert_one = AsyncMock(return_value=None)
    first = asyncio.run(issue_on_complete(db, appt))
    assert first["code"].startswith("NEXT-")
    assert first["percent"] == 20
    second = asyncio.run(issue_on_complete(db, appt))
    assert second["id"] == "fu-1"
    assert db.nt_followup_coupons.insert_one.await_count == 1


def test_issue_skipped_when_followup_disabled():
    db = MagicMock()
    db.nt_followup_coupons.find_one = AsyncMock(return_value=None)
    db.nt_campaigns.find_one = AsyncMock(return_value={"id": "cmp-1", "followUp": {"enabled": False}})
    appt = {"id": "a-2", "clientId": "c-1", "status": "completed", "pricing": {"campaignId": "cmp-1"}}
    assert asyncio.run(issue_on_complete(db, appt)) is None


def test_expired_followup_is_rejected():
    db = MagicMock()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    db.nt_followup_coupons.find_one = AsyncMock(return_value={
        "id": "fu-x", "code": "NEXT-EXPIRED", "clientId": "c-1", "status": "issued", "expiresAt": past,
    })
    db.nt_followup_coupons.update_one = AsyncMock()
    with pytest.raises(Exception) as exc:
        asyncio.run(valid_followup(db, "NEXT-EXPIRED", "c-1"))
    assert "expired" in str(exc.value.detail).lower()


def test_settle_followup_redeems_or_releases():
    db = MagicMock()
    db.nt_followup_coupons.update_one = AsyncMock()
    asyncio.run(settle_followup(db, "a-9", "completed"))
    asyncio.run(settle_followup(db, "a-9", "cancelled"))
    assert db.nt_followup_coupons.update_one.await_count == 2
