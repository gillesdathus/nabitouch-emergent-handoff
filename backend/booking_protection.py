"""Booking Protection and Flash Booking Protection helpers.

Owner toggles activate insurance prepay and flash grace windows.
Cancellation fee amounts may be assessed for staff review; automatic card
collection stays off (see recovery.validate_fee / fee_amount).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from payment_policy import _cents, deposit_cents
from recovery import fee_amount, stamp


def resolve_booking_protection(raw):
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("insurancePrepayMode") or "travel_only"
    if mode not in ("travel_only", "higher_of", "travel_plus_deposit", "none"):
        raise ValueError("Choose a valid insurance prepay mode")
    try:
        percent = int(raw.get("selfPayDepositPercent") if raw.get("selfPayDepositPercent") is not None else 25)
    except (TypeError, ValueError) as exc:
        raise ValueError("Self-pay deposit percent must be a whole number") from exc
    if percent < 0 or percent > 100:
        raise ValueError("Self-pay deposit percent must be between 0 and 100")
    return {
        "selfPayDepositPercent": percent,
        "insurancePrepayMode": mode,
        "insurancePrepayEnabled": bool(raw.get("insurancePrepayEnabled")),
    }


def resolve_flash_protection(raw):
    raw = raw if isinstance(raw, dict) else {}

    def _mins(key, default):
        try:
            value = int(raw.get(key) if raw.get(key) is not None else default)
        except (TypeError, ValueError) as exc:
            raise ValueError("Grace minutes must be whole numbers") from exc
        if value < 0 or value > 120:
            raise ValueError("Grace minutes are out of range")
        return value

    return {
        "enabled": bool(raw.get("enabled")),
        "graceOver3hMinutes": _mins("graceOver3hMinutes", 15),
        "grace1to3hMinutes": _mins("grace1to3hMinutes", 10),
        "graceUnder1hMinutes": _mins("graceUnder1hMinutes", 5),
    }


def insurance_prepay_due(total_dollars, travel_dollars, booking_protection, payment_policy=None):
    """Card amount due now for an insurance booking when prepay is enabled."""
    protection = resolve_booking_protection(booking_protection or {})
    if not protection.get("insurancePrepayEnabled"):
        return None
    mode = protection.get("insurancePrepayMode") or "travel_only"
    if mode == "none":
        return None
    total = _cents(total_dollars)
    travel = max(0, _cents(travel_dollars or 0))
    policy = payment_policy or {
        "mode": "deposit",
        "depositType": "percent",
        "depositPercent": protection["selfPayDepositPercent"],
        "depositCents": 0,
        "cashAccepted": False,
    }
    try:
        treatment_deposit = deposit_cents(total, {
            **policy,
            "depositType": "percent",
            "depositPercent": protection["selfPayDepositPercent"],
        })
    except ValueError:
        treatment_deposit = 0
    if mode == "travel_only":
        due = travel
    elif mode == "higher_of":
        due = max(travel, treatment_deposit)
    else:  # travel_plus_deposit
        due = min(total, travel + treatment_deposit)
    if due <= 0:
        return None
    due = min(due, total) if total > 0 else due
    return {
        "totalCents": total,
        "dueNowCents": due,
        "remainingCents": max(0, total - due),
        "paidCents": 0,
        "refundedCents": 0,
        "choice": "deposit",
        "mode": "insurance_prepay",
        "status": "deposit_pending" if due < total else "payment_required",
        "prepaid": False,
        "insurancePrepayMode": mode,
    }


def due_for_booking_with_protection(total_dollars, policy, fields, *, booking_protection=None, travel_dollars=0):
    """Extend payment_policy.due_for_booking with insurance prepay when enabled."""
    from payment_policy import due_for_booking

    fields = fields or {}
    if fields.get("paymentMethod") == "insurance":
        return insurance_prepay_due(total_dollars, travel_dollars, booking_protection, policy)
    return due_for_booking(total_dollars, policy, fields)


def _hours_until_visit(booked_at, visit_date, visit_time):
    start = stamp(booked_at) or datetime.now(timezone.utc)
    try:
        hour, minute = [int(part) for part in str(visit_time or "0:0").split(":")[:2]]
    except (TypeError, ValueError):
        return None
    try:
        year, month, day = [int(part) for part in str(visit_date).split("-")[:3]]
        visit = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return (visit - start).total_seconds() / 3600.0


def flash_grace_minutes_for_lead(hours_until, flash_protection):
    cfg = resolve_flash_protection(flash_protection or {})
    if not cfg.get("enabled") or hours_until is None or hours_until < 0:
        return None
    if hours_until > 3:
        return cfg["graceOver3hMinutes"]
    if hours_until >= 1:
        return cfg["grace1to3hMinutes"]
    return cfg["graceUnder1hMinutes"]


def flash_snapshot(booked_at, visit_date, visit_time, flash_protection):
    """Capture grace window at booking time when Flash Protection is enabled."""
    cfg = resolve_flash_protection(flash_protection or {})
    if not cfg.get("enabled"):
        return None
    hours = _hours_until_visit(booked_at, visit_date, visit_time)
    minutes = flash_grace_minutes_for_lead(hours, cfg)
    if minutes is None:
        return None
    created = stamp(booked_at) or datetime.now(timezone.utc)
    ends = created + timedelta(minutes=int(minutes))
    return {
        "enabled": True,
        "graceMinutes": int(minutes),
        "graceEndsAt": ends.isoformat(),
        "hoursUntilVisitAtBooking": round(hours, 2) if hours is not None else None,
    }


def assess_cancellation(settings, appointment, *, kind="cancel", at=None):
    """Suggested fee for staff review. Never charges a card automatically."""
    when = stamp(at) or datetime.now(timezone.utc)
    flash = (appointment or {}).get("flashProtection") or {}
    within_grace = False
    grace_ends = stamp(flash.get("graceEndsAt")) if flash.get("enabled") else None
    if grace_ends and when <= grace_ends:
        within_grace = True
    suggested = 0.0 if within_grace else float(fee_amount(settings, appointment, kind=kind) or 0)
    return {
        "kind": kind,
        "suggestedFee": suggested,
        "withinFlashGrace": within_grace,
        "graceEndsAt": flash.get("graceEndsAt") if flash.get("enabled") else None,
        "automaticCollection": False,
        "requiresManagerReview": suggested > 0,
        "assessedAt": when.isoformat(),
    }
