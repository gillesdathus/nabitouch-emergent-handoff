"""Record completed treatments without a prior booking (historical / on-the-spot).

Inserts into nt_appointments as already-completed visits. Does not invent booking,
dispatch, travel, reminder, payment-ledger, or insurance-claim events.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from profiles import CAREER_COMPLETED_STATUSES
from rbac import (
    COMPLETED_TREATMENT_SOURCES,
    default_completed_treatment_source,
    is_completed_treatment_source,
    normalize_completed_treatment_source,
)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")

RECORDED_PAYMENT_STATUSES = frozenset({"paid", "unpaid", "partial", "waived"})
PAYMENT_STATUS_MAP = {
    "paid": "fully_paid",
    "unpaid": "balance_due",
    "partial": "partially_paid",
    "waived": "waived",
}
LOCATION_TYPES = frozenset({"clinic", "home", "office", "hotel", "other"})
CORRECTABLE_FIELDS = frozenset({
    "practitionerId", "serviceSlug", "duration", "date", "time", "locationType",
    "address", "charge", "paymentMethod", "selfMethod", "recordedPaymentStatus",
    "adminNotes",
})


def today_iso(*, now=None):
    stamp = now or datetime.now(timezone.utc)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    # Business calendar uses America/Edmonton for "today"; fall back to UTC date
    # when zoneinfo is unavailable so tests stay deterministic.
    try:
        from zoneinfo import ZoneInfo
        return stamp.astimezone(ZoneInfo("America/Edmonton")).date().isoformat()
    except Exception:
        return stamp.date().isoformat()


def parse_money(value, *, label="charge"):
    if value is None or value == "":
        return 0.0
    try:
        amount = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Enter a valid {label}") from exc
    if amount < 0:
        raise ValueError(f"{label.capitalize()} cannot be negative")
    return round(amount, 2)


def validate_service_date(value, *, today=None):
    day = str(value or "").strip()[:10]
    if not DATE_RE.match(day):
        raise ValueError("Enter a valid treatment date (YYYY-MM-DD)")
    cutoff = today or today_iso()
    if day > cutoff:
        raise ValueError("Treatment date cannot be in the future")
    return day


def validate_service_time(value):
    time = str(value or "").strip()[:5]
    if not TIME_RE.match(time):
        raise ValueError("Enter a valid treatment time (HH:MM)")
    hour, minute = int(time[:2]), int(time[3:5])
    if hour > 23 or minute > 59:
        raise ValueError("Enter a valid treatment time (HH:MM)")
    return f"{hour:02d}:{minute:02d}"


def resolve_source(payload, service_date, *, today=None):
    raw = payload.get("source")
    if raw:
        source = normalize_completed_treatment_source(raw)
        if not source:
            raise ValueError("Source must be historical_manual or on_the_spot")
        return source
    return default_completed_treatment_source(service_date, today=today or today_iso())


def resolve_location(payload, client, settings):
    location = str(payload.get("locationType") or "home").strip().lower()
    if location not in LOCATION_TYPES:
        raise ValueError("Select a valid treatment location")
    if location == "clinic":
        clinic = (settings or {}).get("clinic") or {}
        line = str(clinic.get("address") or "Clinic").strip() or "Clinic"
        return location, {
            "line": line,
            "zoneId": None,
            "notes": str(payload.get("locationNotes") or "")[:240],
            "lat": clinic.get("lat"),
            "lng": clinic.get("lng"),
        }
    address = payload.get("address") if isinstance(payload.get("address"), dict) else None
    address_id = str(payload.get("addressId") or "").strip()
    if address_id and client:
        saved = next((a for a in (client.get("addresses") or []) if a.get("id") == address_id), None)
        if not saved:
            raise ValueError("Selected client address was not found")
        snap = {k: saved.get(k) for k in (
            "id", "label", "purpose", "line", "unit", "access", "notes", "postal",
            "lat", "lng", "zoneId", "mapboxId", "clientConfirmed", "verificationState",
        ) if saved.get(k) is not None}
        if payload.get("locationNotes"):
            snap["notes"] = str(payload.get("locationNotes"))[:240]
        if not snap.get("line"):
            raise ValueError("Selected address is missing a street line")
        return location, snap
    if address and str(address.get("line") or "").strip():
        return location, {
            "line": str(address.get("line")).strip()[:240],
            "unit": str(address.get("unit") or "").strip()[:40],
            "access": str(address.get("access") or "").strip()[:240],
            "notes": str(address.get("notes") or payload.get("locationNotes") or "")[:240],
            "postal": str(address.get("postal") or "").strip()[:12],
            "lat": address.get("lat"),
            "lng": address.get("lng"),
            "zoneId": address.get("zoneId"),
            "label": str(address.get("label") or location.title())[:60],
            "purpose": str(address.get("purpose") or location)[:40],
            "manualEntry": bool(address.get("manualEntry", True)),
        }
    # Fall back to the client's default saved address when present.
    if client:
        addresses = list(client.get("addresses") or [])
        preferred = next((a for a in addresses if a.get("isDefault")), None) or (addresses[0] if addresses else None)
        if preferred and preferred.get("line"):
            snap = {k: preferred.get(k) for k in (
                "id", "label", "purpose", "line", "unit", "access", "notes", "postal",
                "lat", "lng", "zoneId", "mapboxId", "clientConfirmed", "verificationState",
            ) if preferred.get(k) is not None}
            return location, snap
    raise ValueError("Provide a treatment address or choose clinic")


def resolve_payment_fields(payload, *, can_finance: bool):
    if not can_finance:
        return {
            "charge": 0.0,
            "paymentMethod": "self",
            "selfMethod": None,
            "recordedPaymentStatus": "unpaid",
        }
    charge = parse_money(payload.get("charge") if "charge" in payload else payload.get("total"))
    method = str(payload.get("paymentMethod") or "self").strip().lower()
    if method not in ("self", "insurance"):
        method = "self"
    # Recording a completed treatment never opens an insurance claim workflow.
    if method == "insurance":
        method = "self"
    self_method = str(payload.get("selfMethod") or payload.get("paymentChannel") or "").strip().lower() or None
    if self_method and self_method not in ("cash", "card", "etransfer", "other"):
        self_method = "other"
    status = str(payload.get("recordedPaymentStatus") or payload.get("paymentStatus") or "unpaid").strip().lower()
    if status not in RECORDED_PAYMENT_STATUSES:
        raise ValueError("Payment status must be paid, unpaid, partial, or waived")
    if charge <= 0 and status in ("paid", "partial"):
        status = "waived" if status == "paid" else "unpaid"
    return {
        "charge": charge,
        "paymentMethod": method,
        "selfMethod": self_method,
        "recordedPaymentStatus": status,
    }


def build_pricing(charge, settings):
    gst_rate = float((settings or {}).get("gst") or 0.05)
    if charge <= 0:
        return {
            "base": 0.0,
            "addons": 0.0,
            "addonList": [],
            "discount": 0.0,
            "travel": 0.0,
            "tax": 0.0,
            "total": 0.0,
            "treatmentAfterDiscount": 0.0,
        }
    # Staff-entered charge is the amount charged to the client (inclusive of GST).
    total = round(float(charge), 2)
    base = round(total / (1 + gst_rate), 2)
    tax = round(total - base, 2)
    return {
        "base": base,
        "addons": 0.0,
        "addonList": [],
        "discount": 0.0,
        "travel": 0.0,
        "tax": tax,
        "total": total,
        "treatmentAfterDiscount": base,
        "manualCharge": True,
    }


def apply_recorded_payment_status(appt):
    """Keep settle() balances for ops views, but honor the staff-declared payment status
    without inventing payment ledger rows or insurance claims."""
    recorded = appt.get("recordedPaymentStatus") or "unpaid"
    appt["paymentStatus"] = PAYMENT_STATUS_MAP.get(recorded, "balance_due")
    settle = dict(appt.get("settle") or {})
    total = float((appt.get("pricing") or {}).get("total") or 0)
    if recorded == "paid":
        settle["clientPaid"] = total
        settle["balance"] = 0.0
        settle["payable"] = 0.0
    elif recorded == "waived":
        settle["clientPaid"] = 0.0
        settle["balance"] = 0.0
        settle["payable"] = 0.0
    elif recorded == "partial":
        # Half is a display placeholder until a later audited correction; no ledger row.
        paid = round(total / 2, 2)
        settle["clientPaid"] = paid
        settle["balance"] = round(max(0.0, total - paid), 2)
        settle["payable"] = settle["balance"]
    else:
        settle["clientPaid"] = 0.0
        settle["balance"] = total
        settle["payable"] = total
    appt["settle"] = settle
    return appt


def build_completed_appointment(
    *,
    client_id,
    practitioner_id,
    service,
    duration,
    service_date,
    service_time,
    location_type,
    address,
    payment,
    source,
    admin_notes,
    user,
    settings,
    ref,
    recorded_at,
    idempotency_key=None,
):
    if source not in COMPLETED_TREATMENT_SOURCES:
        raise ValueError("Invalid completed-treatment source")
    pricing = build_pricing(payment["charge"], settings)
    charge = float(pricing["total"] or 0)
    actor = (user or {}).get("name") or "staff"
    actor_id = (user or {}).get("id")
    note = str(admin_notes or "").strip()[:1000]
    preferences = {
        "goals": [],
        "focus": [],
        "pressure": "",
        "notes": note,
    }
    appt = {
        "id": f"a-{uuid.uuid4().hex[:10]}",
        "ref": ref,
        "clientId": client_id,
        "practitionerId": practitioner_id,
        "serviceSlug": service["slug"],
        "duration": int(duration),
        "date": service_date,
        "time": service_time,
        "serviceDate": service_date,
        "status": "completed",
        "locationType": location_type,
        "address": address,
        "pricing": pricing,
        "paymentMethod": payment["paymentMethod"],
        "selfMethod": payment.get("selfMethod"),
        "recordedPaymentStatus": payment["recordedPaymentStatus"],
        "insuranceId": None,
        "preferences": preferences,
        "adminNotes": note,
        "checkedIn": True,
        "feedback": None,
        "events": [{
            "status": "completed",
            "at": recorded_at,
            "actor": actor,
            "note": f"Recorded completed treatment ({source})",
        }],
        "timestamps": {
            "completed": recorded_at,
            "recorded": recorded_at,
        },
        "soapStatus": "none",
        "timer": {"pausedMs": 0},
        "source": source,
        "bookingKind": "completed_treatment_record",
        "countsAsAdvanceBooking": False,
        "countsAsRevenue": charge > 0 and payment["recordedPaymentStatus"] != "waived",
        "createdAt": recorded_at,
        "recordedAt": recorded_at,
        "recordedBy": {"id": actor_id, "name": actor},
        "payments": [],
        "claim": {
            "status": "none",
            "eligible": 0,
            "approved": 0,
            "insurerPayment": "none",
            "insurerPaid": 0,
            "history": [],
        },
        "corrections": [],
        "payNow": None,
        "paymentDue": None,
    }
    if idempotency_key:
        appt["idempotencyKey"] = f"{client_id}:{idempotency_key}"
    return appt


def natural_duplicate_query(client_id, practitioner_id, service_date, service_time, service_slug):
    return {
        "clientId": client_id,
        "practitionerId": practitioner_id,
        "date": service_date,
        "time": service_time,
        "serviceSlug": service_slug,
        "status": {"$in": list(CAREER_COMPLETED_STATUSES)},
        "source": {"$in": list(COMPLETED_TREATMENT_SOURCES)},
    }


def build_correction(*, actor, actor_id, before, after, reason):
    return {
        "id": f"tcx-{uuid.uuid4().hex[:10]}",
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "actorId": actor_id,
        "reason": str(reason or "").strip()[:400] or "Administrative correction",
        "before": before,
        "after": after,
    }


def snapshot_correctable(appt):
    pricing = appt.get("pricing") or {}
    return {
        "practitionerId": appt.get("practitionerId"),
        "serviceSlug": appt.get("serviceSlug"),
        "duration": appt.get("duration"),
        "date": appt.get("date"),
        "time": appt.get("time"),
        "locationType": appt.get("locationType"),
        "address": appt.get("address"),
        "charge": pricing.get("total"),
        "paymentMethod": appt.get("paymentMethod"),
        "selfMethod": appt.get("selfMethod"),
        "recordedPaymentStatus": appt.get("recordedPaymentStatus"),
        "adminNotes": appt.get("adminNotes") or (appt.get("preferences") or {}).get("notes"),
    }


def apply_correction_payload(appt, payload, *, settings, can_finance: bool, today=None):
    """Return (updated_appt, before_snap, after_snap). Never deletes history."""
    if not is_completed_treatment_source(appt.get("source")):
        raise ValueError("Only historical or on-the-spot treatments can be corrected here")
    before = snapshot_correctable(appt)
    working = dict(appt)
    keys = {k for k in payload if k in CORRECTABLE_FIELDS}
    if not keys:
        raise ValueError("No correctable fields supplied")

    if "date" in keys:
        working["date"] = validate_service_date(payload.get("date"), today=today)
        working["serviceDate"] = working["date"]
    if "time" in keys:
        working["time"] = validate_service_time(payload.get("time"))
    if "practitionerId" in keys:
        pid = str(payload.get("practitionerId") or "").strip()
        if not pid:
            raise ValueError("Practitioner is required")
        working["practitionerId"] = pid
    if "serviceSlug" in keys:
        slug = str(payload.get("serviceSlug") or "").strip()
        if not slug:
            raise ValueError("Treatment type is required")
        working["serviceSlug"] = slug
    if "duration" in keys:
        try:
            duration = int(payload.get("duration"))
        except (TypeError, ValueError) as exc:
            raise ValueError("Duration must be a whole number of minutes") from exc
        if duration <= 0 or duration > 480:
            raise ValueError("Duration must be between 1 and 480 minutes")
        working["duration"] = duration
    if "locationType" in keys or "address" in keys:
        loc = str(payload.get("locationType") or working.get("locationType") or "home").strip().lower()
        if loc not in LOCATION_TYPES:
            raise ValueError("Select a valid treatment location")
        working["locationType"] = loc
        if "address" in keys and isinstance(payload.get("address"), dict):
            line = str(payload["address"].get("line") or "").strip()
            if not line and loc != "clinic":
                raise ValueError("Address line is required")
            working["address"] = {
                **(working.get("address") or {}),
                **{k: v for k, v in payload["address"].items() if v is not None},
                "line": line or (working.get("address") or {}).get("line") or "Clinic",
            }

    finance_payload = {}
    if can_finance:
        for key in ("charge", "paymentMethod", "selfMethod", "recordedPaymentStatus", "paymentStatus", "paymentChannel", "total"):
            if key in payload:
                finance_payload[key] = payload[key]
        if "charge" not in finance_payload and "total" not in finance_payload:
            finance_payload["charge"] = (working.get("pricing") or {}).get("total")
        if "recordedPaymentStatus" not in finance_payload and "paymentStatus" not in finance_payload:
            finance_payload["recordedPaymentStatus"] = working.get("recordedPaymentStatus") or "unpaid"
        if "paymentMethod" not in finance_payload:
            finance_payload["paymentMethod"] = working.get("paymentMethod") or "self"
        if "selfMethod" not in finance_payload and working.get("selfMethod"):
            finance_payload["selfMethod"] = working.get("selfMethod")
        payment = resolve_payment_fields(finance_payload, can_finance=True)
        working["pricing"] = build_pricing(payment["charge"], settings)
        working["paymentMethod"] = payment["paymentMethod"]
        working["selfMethod"] = payment.get("selfMethod")
        working["recordedPaymentStatus"] = payment["recordedPaymentStatus"]
        charge = float((working["pricing"] or {}).get("total") or 0)
        working["countsAsRevenue"] = charge > 0 and payment["recordedPaymentStatus"] != "waived"

    if "adminNotes" in keys:
        note = str(payload.get("adminNotes") or "").strip()[:1000]
        working["adminNotes"] = note
        prefs = dict(working.get("preferences") or {})
        prefs["notes"] = note
        working["preferences"] = prefs

    # Source and lifecycle fabrication stay locked.
    working["source"] = appt.get("source")
    working["bookingKind"] = "completed_treatment_record"
    working["countsAsAdvanceBooking"] = False
    working["payments"] = []
    claim = dict(working.get("claim") or {})
    claim["status"] = "none"
    working["claim"] = claim
    after = snapshot_correctable(working)
    return working, before, after


def counts_toward_career(appt, as_of):
    """Mirror profiles.count_eligible_completed_appointments for a single row."""
    if (appt or {}).get("status") not in CAREER_COMPLETED_STATUSES:
        return False
    day = str((appt or {}).get("date") or "")[:10]
    if not DATE_RE.match(day):
        return False
    if as_of and DATE_RE.match(str(as_of)):
        return day > str(as_of)
    return False
