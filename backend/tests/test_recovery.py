"""Recovery offers, flash discounts, consent, and disabled cancellation fees."""
from datetime import datetime, timedelta, timezone

import pytest

from recovery import (
    FEE_TEXT, OUTBOUND_PROMOTIONS, OUTBOUND_RECOVERY, active_exclusive, analytics, apply_campaign_price,
    audience_ok, broadcast_ready, campaign_fits, campaign_live, consent_state, decline_then_next, fee_amount,
    fill_case, launch_fee, launch_ten_minutes_on_us, next_candidate, public_campaign, rank_broadcast,
    rank_exclusive, record_consent, release_count, reserve_decision, sending_allowed, take_claim, unsubscribe,
    validate_fee, can_manage_campaign,
)

AT = datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc)


def later(hours=2):
    return (AT + timedelta(hours=hours)).isoformat()


def visit(appt_id, client, time, lat=53.54):
    return {"id": appt_id, "ref": appt_id, "clientId": client, "practitionerId": "p-1", "serviceSlug": "swedish", "date": "2026-10-21", "time": time, "status": "assigned", "address": {"lat": lat, "lng": -113.5}}


def cancelled():
    return {"id": "a-x", "practitionerId": "p-1", "serviceSlug": "swedish", "date": "2026-10-21", "time": "09:00", "address": {"lat": 53.54, "lng": -113.5}}


def drives(_origin, dest):
    if dest is None:
        return 45, "conservative"
    return int(abs(dest.get("lat", 0) - 53.54) * 100) or 10, "test"


def campaign(**extra):
    base = {
        "id": "cmp-1", "status": "live", "public": True, "discountPercent": 20, "maxRedemptions": 5, "redemptions": 0,
        "perClientLimit": 1, "audience": "all", "stackable": False, "serviceSlug": "swedish", "minDuration": 60,
        "publishAt": "2026-10-20T17:00:00+00:00", "expiresAt": later(1),
        "bookingStart": "2026-10-21", "bookingEnd": "2026-10-21", "windowStart": "14:00", "windowEnd": "17:00",
        "title": "Afternoon opening",
    }
    base.update(extra)
    return base


def test_exclusive_sequence_does_not_overlap_and_broadcast_waits():
    ranked = rank_exclusive(cancelled(), [visit("b", "c-b", "14:00", 53.55), visit("c", "c-c", "16:00", 53.60), visit("early", "c-a", "08:00")], drives)
    assert [row["clientId"] for row in ranked] == ["c-b", "c-c"]
    first = next_candidate(ranked, [], 5, AT)
    assert first["clientId"] == "c-b"
    pending = [{"kind": "exclusive", "status": "pending", "clientId": "c-b", "expiresAt": later(1)}]
    assert next_candidate(ranked, pending, 5, AT) is None
    assert active_exclusive(pending, AT)["clientId"] == "c-b"
    declined = [{"kind": "exclusive", "status": "declined", "clientId": "c-b", "expiresAt": later(1)}]
    assert decline_then_next(ranked, declined, 5, AT)["clientId"] == "c-c"
    both = declined + [{"kind": "exclusive", "status": "declined", "clientId": "c-c", "expiresAt": later(1)}]
    assert next_candidate(ranked, both, 5, AT) is None
    assert broadcast_ready(pending, AT) is False
    assert broadcast_ready(both, AT) is True


def test_broadcast_is_opt_in_and_first_hold_wins():
    watches = [
        {"id": "w-1", "clientId": "c-1", "optIn": True, "point": {"lat": 53.55, "lng": -113.5}},
        {"id": "w-2", "clientId": "c-2", "optIn": False, "point": {"lat": 53.54, "lng": -113.5}},
        {"id": "w-3", "clientId": "c-3", "optIn": True, "point": None},
    ]
    ranked = rank_broadcast(watches, drives, {"lat": 53.54, "lng": -113.5}, 25)
    assert [row["clientId"] for row in ranked] == ["c-1", "c-3"]
    case = {"status": "broadcast", "filledAppointmentId": None}
    first = take_claim(case, "c-1", AT)
    assert first["holdClientId"] == "c-1"
    second = take_claim({**case, **first}, "c-2", AT)
    assert second == "held"
    assert fill_case({**case, **first, "status": "held"}, "c-1")["status"] == "filled"
    assert fill_case({**case, **first, "status": "filled", "filledAppointmentId": "a-1"}, "c-2") == "rejected"


def test_expired_offer_infeasible_route_and_unavailable_practitioner():
    expired = [{"kind": "exclusive", "status": "pending", "clientId": "c-b", "expiresAt": "2026-10-20T17:00:00+00:00"}]
    assert active_exclusive(expired, AT) is None
    assert reserve_decision(campaign(expiresAt="2026-10-20T17:30:00+00:00"), {}, AT, 0) == "expired"
    failed = drives
    def broken(_origin, _dest):
        return 45, "conservative"
    row = rank_broadcast([{"id": "w", "clientId": "c", "optIn": True, "point": None}], broken, None, 5)
    assert row[0]["provider"] == "conservative" and row[0]["travelMin"] >= 45
    def infeasible(_origin, _dest):
        return 0, "infeasible"
    assert rank_broadcast([{"id": "w", "clientId": "c", "optIn": True, "point": {"lat": 1, "lng": 1}}], infeasible, {"lat": 1, "lng": 1}, 5) == []
    ranked = rank_exclusive({**cancelled(), "practitionerId": "p-gone"}, [visit("b", "c-b", "14:00")], drives)
    assert ranked == []


def test_campaign_quota_expiry_release_and_client_limit():
    live = campaign()
    assert campaign_live(live, AT) is True
    assert campaign_fits(live, "2026-10-21", "14:30", 60, "swedish") is True
    assert campaign_fits(live, "2026-10-22", "14:30", 60, "swedish") is False
    assert campaign_fits(live, "2026-10-21", "10:00", 60, "swedish") is False
    assert campaign_fits(live, "2026-10-21", "14:30", 60, "sports") is False
    assert reserve_decision(live, {"onlineBookings": 0}, AT, 0) == "reserved"
    assert reserve_decision(campaign(redemptions=5), {}, AT, 0) == "sold_out"
    assert reserve_decision(live, {}, AT, 1) == "limit"
    assert reserve_decision(campaign(audience="new"), {"onlineBookings": 2}, AT, 0) == "reserved"
    assert audience_ok(campaign(audience="new"), {"onlineBookings": 2}) is False
    assert audience_ok(campaign(audience="returning"), {"onlineBookings": 2}) is True
    priced = apply_campaign_price({"base": 120, "addons": 0, "travel": 0, "discount": 15, "tax": 0, "total": 120}, 20, 0.05, False)
    assert priced["discount"] == 24
    stacked = apply_campaign_price({"base": 120, "addons": 0, "travel": 0, "discount": 15, "tax": 0, "total": 120}, 20, 0.05, True)
    assert stacked["discount"] == 39
    assert release_count(1) == 0
    view = public_campaign(live, AT)
    assert view["remaining"] == 5 and "redemptions" not in view
    fall = datetime(2026, 11, 1, 8, 30, tzinfo=timezone.utc)
    assert campaign_live(campaign(expiresAt="2026-11-01T08:00:00+00:00"), fall) is False


def test_consent_unsubscribe_and_fees_stay_off():
    events = record_consent([], "operational", True, "booking", AT)
    events = record_consent(events, "promotional", False, "profile", AT)
    assert sending_allowed("operational", events) is True
    assert sending_allowed("promotional", events) is False
    events = record_consent(events, "promotional", True, "profile", AT)
    assert consent_state(events, "promotional") is True
    events = unsubscribe(events, "promotional", AT)
    assert consent_state(events, "promotional") is False
    assert sending_allowed("promotional", events) is False
    assert OUTBOUND_PROMOTIONS is False and OUTBOUND_RECOVERY is False
    fee = launch_fee()
    assert fee["enabled"] is False and fee["automaticCollection"] is False
    assert fee["text"] == FEE_TEXT
    with pytest.raises(ValueError):
        validate_fee({**fee, "enabled": True})
    appointment = {"createdAt": "2026-01-01T00:00:00+00:00", "pricing": {"total": 120}}
    configured = {**fee, "enabled": True, "automaticCollection": False, "effectiveOn": "2026-11-01T00:00:00+00:00", "fixedFee": 25}
    assert fee_amount({"cancellationFee": configured}, appointment) == 0
    later_visit = {**appointment, "createdAt": "2026-12-01T00:00:00+00:00"}
    assert fee_amount({"cancellationFee": configured}, later_visit) == 25
    assert fee_amount({"cancellationFee": {**configured, "automaticCollection": True}}, later_visit) == 0
    summary = analytics(
        [{"status": "filled", "offers": [{}], "minutesToFill": 12, "travelSaved": 8}, {"status": "review", "offers": [{}]}],
        [{"bookings": 2, "redemptions": 2, "gross": 200, "discountCost": 40}],
    )
    assert summary["recovered"] == 1
    assert summary["estimatedIncrementalRevenue"] is None
    assert can_manage_campaign("owner") is True
    assert can_manage_campaign("practitioner") is False
    assert can_manage_campaign("desk") is False


def test_ten_minutes_template_stays_draft_and_allows_home():
    row = launch_ten_minutes_on_us()
    assert row["status"] == "draft"
    assert row["offerKind"] == "trial"
    assert row["complimentaryMinutes"] == 10
    assert row["serviceSlug"] == "ten-minutes-on-us"
    assert row["practitionerId"] == "p-nabitu-kahindo"
    assert row["maxRedemptions"] == 30
    assert "home" in row["locationTypes"]
    assert "clinic" in row["locationTypes"]
    assert row["followUp"]["enabled"] is False
    assert campaign_live(row, AT) is False
    live = {**row, "status": "live", "expiresAt": later(24)}
    assert campaign_fits(live, live["bookingStart"], "10:00", 10, "ten-minutes-on-us", "clinic") is True
    assert campaign_fits(live, live["bookingStart"], "10:00", 10, "ten-minutes-on-us", "home") is True
    assert campaign_fits(live, live["bookingStart"], "10:00", 60, "ten-minutes-on-us", "clinic") is False
    free = apply_campaign_price({"base": 0, "addons": 10, "travel": 15, "discount": 0}, {"offerKind": "trial", "complimentaryMinutes": 10, "title": row["title"]}, 0.05)
    assert free["total"] == 0 and free["travel"] == 0 and free["campaignOfferKind"] == "trial"
    complimentary = apply_campaign_price({"base": 45, "addons": 10, "travel": 15, "discount": 0}, {"offerKind": "complimentary", "complimentaryMinutes": 10, "title": "Legacy"}, 0.05)
    assert complimentary["total"] == 0 and complimentary["travel"] == 0 and complimentary["discount"] == 45
    fixed = apply_campaign_price({"base": 120, "addons": 0, "travel": 0, "discount": 0}, {"offerKind": "fixed", "discountFixed": 25, "title": "Flash $25"}, 0.05)
    assert fixed["discount"] == 25
    assert reserve_decision({**live, "redemptions": 30, "maxRedemptions": 30}, {}, AT, 0) == "sold_out"
    exclusive = apply_campaign_price({"base": 120, "addons": 0, "travel": 0, "discount": 24, "welcomeOffer": True}, {"offerKind": "percent", "percent": 20, "stackable": False, "title": "Flash"}, 0.05, False)
    assert exclusive["discount"] == 24
