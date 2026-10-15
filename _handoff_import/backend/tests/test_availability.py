"""Scheduling feasibility. No Mapbox, Mongo, or live bookings."""
from datetime import datetime, timezone

import pytest

from availability import (
    CANCELLATION_DRAFT, blocking_cover, can_manage, claim_offer, conflicts_for_close, conservative_drive,
    day_segments, draft_schedule, feasible_slot, gap_suggestions, launch_clinic, launch_policy, local_date_time,
    lock_marks, match_watches, opening_notice_status, practitioner_bookable, propose_order, public_cancellation,
    rank_slots, required_gap, scheduling_rules, validate_clinic, validate_policy, validate_weekly, weekday_of,
)
from pricing import minutes

RULES = scheduling_rules({"scheduling": {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 5, "leadMin": 90}})
NOW = datetime(2026, 6, 1, 15, 0, tzinfo=timezone.utc)
PERSON = {"id": "p-1", "name": "A", "available": True, "onboardingStatus": "approved", "specialties": ["swedish"]}
SERVICE = {"slug": "swedish", "enabled": True, "mobile": True, "prices": {"60": 120, "90": 165}}
ZONE = {"id": "z-central", "name": "Central Edmonton"}


def schedule(weekly=None, exceptions=None, status="approved"):
    return {"status": status, "acceptingBookings": status == "approved", "weekly": weekly or [], "exceptions": exceptions or []}


def week():
    return [{"weekday": day, "start": "09:00", "end": "17:00"} for day in range(7)]


def drive_of(table):
    def drives(origin, dest):
        if not origin or not dest:
            return conservative_drive(origin, dest)
        return table.get((round(origin["lat"], 2), round(dest["lat"], 2)), (20, "test"))
    return drives


def visit(appt_id, time, duration, lat, status="assigned"):
    return {
        "id": appt_id, "ref": appt_id, "date": "2026-06-16", "time": time, "duration": duration, "status": status,
        "practitionerId": "p-1", "address": {"lat": lat, "lng": -113.5, "zoneName": "Central Edmonton"},
    }


def probe(start, appointments, duration=60, point=None, person=None, sched=None, drives=None, production=True):
    return feasible_slot(
        schedule=sched if sched is not None else schedule(week()), person=person or PERSON, service=SERVICE,
        day="2026-06-16", start=minutes(start) if isinstance(start, str) else start, duration=duration,
        point=point or {"lat": 53.54, "lng": -113.5}, zone=ZONE, appointments=appointments, rules=RULES,
        drives=drives or (lambda _a, _b: (20, "test")), location_type="home", now=NOW, production=production,
    )


def test_launch_profile_is_inactive_and_policy_stays_pending():
    clinic = launch_clinic()
    assert clinic["phoneTel"] == "+17802356508"
    assert clinic["phoneDisplay"] == "(780) 235-6508"
    assert clinic["hours"] == "By appointment only"
    assert clinic["enabled"] is False
    assert clinic["address"] == ""
    policy = launch_policy()
    assert policy["status"] == "pending"
    assert policy["text"] == CANCELLATION_DRAFT
    assert public_cancellation(policy, None) is None
    assert public_cancellation(policy, "owner")["status"] == "pending"
    assert opening_notice_status()["enabled"] is False
    row = draft_schedule("p-nabitu-kahindo")
    assert row["weekly"] == []
    assert practitioner_bookable({"available": False, "onboardingStatus": "draft"}, row) is False


def test_service_limited_hours_reject_other_treatments():
    limited = schedule([{"weekday": 1, "start": "09:00", "end": "12:00", "services": ["swedish"]}])
    assert probe("09:00", [], sched=limited)["ok"] is True
    sports = {**SERVICE, "slug": "sports"}
    refused = feasible_slot(
        schedule=limited, person={**PERSON, "specialties": ["swedish", "sports"]}, service=sports,
        day="2026-06-16", start=minutes("09:00"), duration=60, point={"lat": 53.54, "lng": -113.5}, zone=ZONE,
        appointments=[], rules=RULES, drives=lambda _a, _b: (20, "test"), location_type="home", now=NOW, production=True,
    )
    assert refused["ok"] is False
    assert probe("13:00", [], sched=limited)["ok"] is False


def test_weekly_intervals_and_dst_boundaries():
    weekly = validate_weekly([
        {"weekday": 1, "start": "09:00", "end": "12:00"},
        {"weekday": 1, "start": "13:00", "end": "17:00"},
    ])
    assert len(weekly) == 2
    with pytest.raises(ValueError):
        validate_weekly([{"weekday": 1, "start": "09:00", "end": "13:00"}, {"weekday": 1, "start": "12:00", "end": "15:00"}])
    with pytest.raises(ValueError):
        local_date_time("2026-03-08", "02:30")
    assert local_date_time("2026-11-01", "01:30").tzinfo.key == "America/Edmonton"
    day = weekday_of("2026-06-16")
    open_day = schedule([{"weekday": day, "start": "09:00", "end": "12:00"}])
    assert probe("10:00", [], sched=open_day)["ok"] is True


def test_closed_days_leave_and_reopen_cannot_override_protection():
    closed = schedule(week(), [{"kind": "closed", "startDate": "2026-06-16", "endDate": "2026-06-16", "start": "", "end": ""}])
    assert probe("10:00", [], sched=closed)["ok"] is False
    vacation = schedule(week(), [{"kind": "vacation", "startDate": "2026-06-16", "endDate": "2026-06-20", "start": "", "end": ""}])
    assert probe("11:00", [], sched=vacation)["ok"] is False
    reopen = schedule([], [{"kind": "open", "startDate": "2026-06-16", "endDate": "2026-06-16", "start": "12:00", "end": "13:00"}])
    assert probe("12:00", [], sched=reopen, duration=60)["ok"] is True
    blocked = schedule([], [
        {"kind": "sick", "startDate": "2026-06-16", "endDate": "2026-06-16", "start": "12:00", "end": "15:00"},
        {"kind": "open", "startDate": "2026-06-16", "endDate": "2026-06-16", "start": "12:00", "end": "13:00"},
    ])
    assert probe("12:00", [], sched=blocked)["ok"] is False
    booked = [visit("a-1", "12:00", 60, 53.54)]
    assert probe("12:00", booked, sched=reopen)["ok"] is False
    conflicts = conflicts_for_close(booked, "2026-06-16", "2026-06-16", "12:00", "13:00")
    assert conflicts[0]["ref"] == "a-1"
    assert "line" not in conflicts[0]


def test_travel_before_and_after_and_routing_failure():
    appointments = [visit("a-9", "09:00", 60, 53.50), visit("a-2", "14:00", 60, 53.60)]
    drives = drive_of({})
    assert probe("11:00", appointments, drives=drives)["ok"] is True
    slow = lambda _a, _b: (40, "test")
    assert required_gap(40, RULES) == 70
    assert probe("11:00", appointments, duration=90, drives=slow)["ok"] is False
    assert probe("11:00", appointments, duration=60, drives=slow)["ok"] is False
    tight = lambda _a, _b: (15, "mapbox-traffic")
    assert probe("11:00", appointments, duration=60, drives=tight)["ok"] is True
    missing = conservative_drive(None, {"lat": 53.5, "lng": -113.5})
    assert missing[0] >= 45 and missing[1] == "conservative"
    assert conservative_drive({"lat": 53.5, "lng": -113.5}, {"lat": 53.5, "lng": -113.5})[0] == 0
    outside = feasible_slot(
        schedule=schedule(week()), person=PERSON, service=SERVICE, day="2026-06-16", start=minutes("11:00"), duration=60,
        point={"lat": 53.2, "lng": -113.5}, zone=None, appointments=[], rules=RULES, drives=drives, location_type="home",
        now=NOW, production=True,
    )
    assert outside["reason"] == "That address is outside the mobile service area"


def test_multiple_practitioners_rank_without_client_details():
    near = {**probe("11:00", [visit("a-9", "09:00", 60, 53.54)]), "time": "11:00", "practitionerId": "p-near"}
    far = {**probe("15:00", []), "time": "15:00", "practitionerId": "p-far", "additionalDrive": 50, "idle": 80, "legs": [{"minutes": 50}]}
    ranked = rank_slots([far, near])
    assert ranked[0]["label"] == "Best route fit"
    assert "address" not in ranked[0]
    assert {row["practitionerId"] for row in ranked} == {"p-near", "p-far"}


def test_gap_detection_and_cancellation_matching():
    appointments = [visit("a-9", "09:00", 60, 53.54), visit("a-2", "14:00", 60, 53.55)]
    gaps = gap_suggestions(schedule(week()), PERSON, "2026-06-16", appointments, RULES, lambda _a, _b: (20, "test"))
    assert any(row["duration"] == 60 and "Central Edmonton" in row["text"] for row in gaps)
    assert all("104" not in row["text"] for row in gaps)
    watches = [
        {"id": "w-1", "clientId": "c-1", "optIn": True, "serviceSlug": "swedish", "duration": 60, "earliestDate": "2026-06-01", "latestDate": "2026-06-30"},
        {"id": "w-2", "clientId": "c-2", "optIn": False, "serviceSlug": "swedish", "duration": 60},
    ]
    matched = match_watches(watches, {"serviceSlug": "swedish", "duration": 60, "date": "2026-06-16", "time": "11:00"}, NOW)
    assert [row["clientId"] for row in matched] == ["c-1"]
    assert matched[0]["notify"] is False
    offer = {"status": "available", "clientId": "c-1"}
    assert claim_offer(offer, "c-1", True) == "claimed"
    assert claim_offer({"status": "claimed", "clientId": "c-1"}, "c-2", True) == "taken"
    assert claim_offer(offer, "c-1", False) == "stale"


def test_route_proposal_does_not_apply_and_roles_are_enforced():
    stops = [
        visit("a", "09:00", 60, 53.60),
        visit("b", "11:00", 60, 53.50),
        visit("c", "13:00", 60, 53.58),
    ]
    proposal = propose_order(stops, lambda origin, dest: (abs(origin["lat"] - dest["lat"]) * 100, "test"))
    assert proposal is None or proposal["applied"] is False
    assert can_manage({"role": "practitioner", "subject": "p-1"}, "p-1", {}) is True
    assert can_manage({"role": "practitioner", "subject": "p-1"}, "p-2", {}) is False
    assert can_manage({"role": "desk"}, "p-1", {}) is False
    assert can_manage({"role": "desk"}, "p-1", {"manageAvailability": True}) is True
    assert can_manage({"role": "owner"}, "p-2", {}) is True
    marks = lock_marks("p-1", "2026-06-16", minutes("11:00"), 60, 30)
    other = lock_marks("p-1", "2026-06-16", minutes("11:00"), 60, 30)
    assert set(marks) & set(other)
    later = lock_marks("p-1", "2026-06-16", minutes("16:00"), 60, 20)
    assert not (set(marks) & set(later))


def test_calendar_segments_distinguish_booked_and_blocked():
    sched = schedule(week(), [{"kind": "break", "startDate": "2026-06-16", "endDate": "2026-06-16", "start": "12:00", "end": "13:00"}])
    segments = day_segments(sched, "2026-06-16", [visit("a-1", "10:00", 60, 53.54)], "p-1")
    states = {row["state"] for row in segments}
    assert {"available", "blocked", "booked"} <= states
    assert blocking_cover(sched, "2026-06-16", minutes("12:15"), minutes("12:45"))


def test_policy_and_phone_validation_reject_penalties_and_placeholders():
    with pytest.raises(ValueError):
        validate_policy({"status": "approved", "automaticFee": True, "text": "fee"})
    approved = validate_policy({"status": "approved", "text": CANCELLATION_DRAFT})
    assert approved["automaticFee"] is False
    phone = validate_clinic({"enabled": False, "address": "", "phone": "780-235-6508"})
    assert phone["phoneTel"] == "+17802356508"
    assert phone["phoneDisplay"] == "(780) 235-6508"
    with pytest.raises(ValueError):
        validate_clinic({"enabled": True, "address": ""})
    with pytest.raises(ValueError):
        validate_clinic({"enabled": False, "address": "[Clinic address — to be supplied]"})
