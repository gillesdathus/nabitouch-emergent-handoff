"""Booking / Flash protection helpers and fee validation unlock."""
from booking_protection import (
    assess_cancellation,
    due_for_booking_with_protection,
    flash_grace_minutes_for_lead,
    flash_snapshot,
    insurance_prepay_due,
    resolve_booking_protection,
    resolve_flash_protection,
)
from recovery import launch_fee, validate_fee


def test_resolve_booking_protection_owner_toggle():
    off = resolve_booking_protection({})
    assert off["insurancePrepayEnabled"] is False
    assert off["insurancePrepayMode"] == "travel_only"
    on = resolve_booking_protection({"insurancePrepayEnabled": True, "insurancePrepayMode": "higher_of"})
    assert on["insurancePrepayEnabled"] is True
    assert on["insurancePrepayMode"] == "higher_of"


def test_insurance_prepay_off_stays_none():
    assert insurance_prepay_due(200, 25, {"insurancePrepayEnabled": False}) is None
    assert due_for_booking_with_protection(
        200, {"mode": "full"}, {"paymentMethod": "insurance"}, booking_protection={}, travel_dollars=25,
    ) is None


def test_insurance_prepay_travel_only():
    due = insurance_prepay_due(
        210, 25,
        {"insurancePrepayEnabled": True, "insurancePrepayMode": "travel_only", "selfPayDepositPercent": 25},
    )
    assert due["dueNowCents"] == 2500
    assert due["remainingCents"] == 18500
    assert due["insurancePrepayMode"] == "travel_only"


def test_flash_grace_buckets_and_snapshot():
    cfg = resolve_flash_protection({"enabled": True, "graceOver3hMinutes": 15, "grace1to3hMinutes": 10, "graceUnder1hMinutes": 5})
    assert flash_grace_minutes_for_lead(4, cfg) == 15
    assert flash_grace_minutes_for_lead(2, cfg) == 10
    assert flash_grace_minutes_for_lead(0.5, cfg) == 5
    assert flash_snapshot("2026-10-20T12:00:00+00:00", "2026-10-20", "14:00", {"enabled": False}) is None
    snap = flash_snapshot("2026-10-20T12:00:00+00:00", "2026-10-20", "14:00", cfg)
    assert snap["graceMinutes"] == 10
    assert snap["graceEndsAt"]


def test_assess_cancellation_respects_flash_grace():
    settings = {"cancellationFee": {
        **launch_fee(),
        "enabled": True,
        "automaticCollection": False,
        "effectiveOn": "2026-01-01T00:00:00+00:00",
        "fixedFee": 40,
    }}
    appt = {
        "createdAt": "2026-06-01T00:00:00+00:00",
        "pricing": {"total": 120},
        "flashProtection": {
            "enabled": True,
            "graceMinutes": 15,
            "graceEndsAt": "2026-10-20T12:30:00+00:00",
        },
    }
    inside = assess_cancellation(settings, appt, at="2026-10-20T12:10:00+00:00")
    assert inside["withinFlashGrace"] is True
    assert inside["suggestedFee"] == 0
    outside = assess_cancellation(settings, appt, at="2026-10-20T13:00:00+00:00")
    assert outside["withinFlashGrace"] is False
    assert outside["suggestedFee"] == 40
    assert outside["automaticCollection"] is False


def test_validate_fee_allows_enabled_but_blocks_automatic_collection():
    fee = validate_fee({
        **launch_fee(),
        "enabled": True,
        "fixedFee": 25,
        "effectiveOn": "2026-11-01",
        "published": True,
    })
    assert fee["enabled"] is True
    assert fee["published"] is True
    assert fee["automaticCollection"] is False
    try:
        validate_fee({**fee, "automaticCollection": True})
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "Automatic" in str(exc)
