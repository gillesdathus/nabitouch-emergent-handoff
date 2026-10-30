"""Sole-therapist booking assignment for NabiTouch.

All massage bookings resolve to Nabitu Kahindo (p-nabitu-kahindo) through this
module. Slot locks, travel buffers, credentials, and onboarding gates stay in
the existing availability / profile checks — this does not create a second engine.
"""
from __future__ import annotations

from fastapi import HTTPException

import os

from staff_identity import CANONICAL_PRACTITIONER_ID, CANONICAL_PRACTITIONER_NAME

# Terminal / historical statuses that are not open schedule demand.
COMPLETED_STATUSES = frozenset({
    "completed", "closed", "processing", "leaving", "soap_completed",
})
CANCELLED_STATUSES = frozenset({
    "cancelled", "no_show", "interrupted",
})

# Live Hostinger Nabitu subject predates the launch canonical id. Do not invent merges;
# accept either id as the same designated therapist.
DESIGNATED_PRACTITIONER_ALIASES = frozenset({
    CANONICAL_PRACTITIONER_ID,
    "p-f3a4279b",
})


def designated_practitioner_id():
    override = (os.environ.get("DESIGNATED_PRACTITIONER_ID") or "").strip()
    return override or CANONICAL_PRACTITIONER_ID


def is_designated_practitioner_id(practitioner_id):
    text = str(practitioner_id or "").strip()
    if not text:
        return False
    if text == designated_practitioner_id():
        return True
    return text in DESIGNATED_PRACTITIONER_ALIASES


def normalize_requested_practitioner_id(requested):
    """Map client/admin requests onto the sole designated therapist.

    Empty / any / wildcard → Nabitu. Explicit Nabitu id (canonical or live alias) → accepted.
    Any other id → rejected (never assign Dathus or unrelated therapists).
    """
    text = str(requested or "").strip()
    designated = designated_practitioner_id()
    if not text or text.lower() in {"any", "any_available", "available", "*"}:
        return designated, "auto"
    if is_designated_practitioner_id(text):
        return designated if text == designated else text, "explicit"
    raise HTTPException(
        409,
        f"Nabitouch currently assigns massage visits to {CANONICAL_PRACTITIONER_NAME} only.",
    )


async def resolve_booking_practitioner(
    db,
    coll,
    *,
    requested_id,
    service,
    settings,
    production,
    day,
    time,
    duration,
    address,
    location_type,
    trial=False,
    exclude_id=None,
    enforce_slot=True,
):
    """Return the practitioner id that must own this booking, or raise clearly.

    Validates bookability and (when enforce_slot) schedule / overlap / travel via
    assert_public_slot. Never returns an unauthorized therapist id.
    """
    from availability import assert_public_slot, practitioner_bookable
    from profiles import person_booking_block

    practitioner_id, mode = normalize_requested_practitioner_id(requested_id)
    person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0})
    if not person:
        # Production may still use the pre-canonical Nabitu id; resolve by exact launch name.
        person = await coll("practitioners").find_one(
            {"name": {"$regex": f"^{CANONICAL_PRACTITIONER_NAME}$", "$options": "i"}},
            {"_id": 0},
        )
        if person and person.get("id"):
            practitioner_id = person["id"]
            mode = mode if mode == "explicit" else "auto_name"
    if not person:
        raise HTTPException(
            409,
            f"{CANONICAL_PRACTITIONER_NAME} is not configured as an active therapist yet. "
            "Ask Nabitouch to finish practitioner setup before booking.",
        )
    credentials = await db.nt_credentials.find({"practitionerId": practitioner_id}, {"_id": 0}).to_list(20)
    blocked = person_booking_block(person, service, credentials)
    if blocked:
        raise HTTPException(409, blocked)
    schedule = await db.nt_schedules.find_one({"practitionerId": practitioner_id}, {"_id": 0})
    if not practitioner_bookable(person, schedule):
        raise HTTPException(
            409,
            f"{CANONICAL_PRACTITIONER_NAME} is not accepting bookings at this time. "
            "Choose another day or contact Nabitouch.",
        )
    if enforce_slot:
        await assert_public_slot(
            db, coll, settings=settings, production=production, practitioner_id=practitioner_id,
            day=day, time=time, duration=int(duration), address=address,
            location_type=location_type, service=service, exclude_id=exclude_id, trial=trial,
        )
    return {
        "practitionerId": practitioner_id,
        "person": person,
        "resolution": mode,
        "name": person.get("name") or CANONICAL_PRACTITIONER_NAME,
    }


def filter_recommendation_people(people, requested_id=None):
    """Restrict slot search to the designated therapist (or an explicit Nabitu request)."""
    practitioner_id, _mode = normalize_requested_practitioner_id(requested_id)
    matched = [
        person for person in (people or [])
        if person and (
            person.get("id") == practitioner_id
            or is_designated_practitioner_id(person.get("id"))
            or str(person.get("name") or "").strip().lower() == CANONICAL_PRACTITIONER_NAME.lower()
        )
    ]
    if not matched:
        raise HTTPException(
            409,
            f"{CANONICAL_PRACTITIONER_NAME} is not available for online booking yet.",
        )
    live_id = matched[0].get("id") or practitioner_id
    return matched, live_id


def categorize_appointment(appt):
    """Classify one appointment for the Checkpoint C audit. Never mutates."""
    if not appt:
        return "manual_review"
    status = str(appt.get("status") or "")
    pid = appt.get("practitionerId") or ""
    if status in CANCELLED_STATUSES:
        return "cancelled_or_historical"
    if status in COMPLETED_STATUSES:
        return "cancelled_or_historical"
    if not pid:
        return "unassigned"
    if is_designated_practitioner_id(pid):
        return "assigned_nabitu"
    return "assigned_other"


def audit_appointment_assignments(appointments):
    """Read-only tally. Does not reassign."""
    buckets = {
        "assigned_nabitu": [],
        "unassigned": [],
        "assigned_other": [],
        "cancelled_or_historical": [],
        "manual_review": [],
    }
    for appt in appointments or []:
        key = categorize_appointment(appt)
        buckets[key].append({
            "id": appt.get("id"),
            "ref": appt.get("ref"),
            "status": appt.get("status"),
            "practitionerId": appt.get("practitionerId") or None,
            "date": appt.get("date"),
            "time": appt.get("time"),
        })
    # Open visits assigned to another therapist need human review before any bulk fix.
    for row in buckets["assigned_other"]:
        if row.get("status") not in CANCELLED_STATUSES | COMPLETED_STATUSES:
            buckets["manual_review"].append(row)
    # Deduplicate manual_review ids that were also listed under assigned_other.
    seen = set()
    unique_review = []
    for row in buckets["manual_review"]:
        if row.get("id") in seen:
            continue
        seen.add(row.get("id"))
        unique_review.append(row)
    buckets["manual_review"] = unique_review
    return {
        "canonicalPractitionerId": CANONICAL_PRACTITIONER_ID,
        "counts": {key: len(rows) for key, rows in buckets.items()},
        "samples": {key: rows[:20] for key, rows in buckets.items()},
        "bulkReassign": "not authorized",
        "note": "Dry-run audit only. Historical records were not modified.",
    }
