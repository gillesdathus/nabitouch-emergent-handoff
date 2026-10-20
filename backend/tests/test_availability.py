"""Scheduling feasibility. No Mapbox, Mongo, or live bookings."""
from datetime import datetime, timezone

import pytest

from availability import (
    CANCELLATION_DRAFT, TRIAL_CAMPAIGN_ID, blocking_cover, can_manage, candidate_starts, claim_offer,
    conflicts_for_close, conservative_drive, day_segments, draft_schedule, feasible_slot, gap_suggestions,
    interval_open, launch_clinic, launch_policy, local_date_time, lock_marks, match_watches,
    opening_notice_status, practitioner_bookable, propose_order, public_cancellation, rank_slots,
    required_gap, scheduling_rules, validate_campaign_blocks, validate_clinic, validate_policy,
    validate_weekly, weekday_of,
)
from pricing import minutes

RULES = scheduling_rules({"scheduling": {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 5, "leadMin": 90}})
NOW = datetime(2026, 6, 1, 15, 0, tzinfo=timezone.utc)
PERSON = {"id": "p-1", "name": "A", "available": True, "onboardingStatus": "approved", "specialties": ["swedish"]}
SERVICE = {"slug": "swedish", "enabled": True, "mobile": True, "prices": {"60": 120, "90": 165}}
ZONE = {"id": "z-central", "name": "Central Edmonton"}


def schedule(weekly=None, exceptions=None, status="approved", campaign_blocks=None):
    return {
        "status": status,
        "acceptingBookings": status == "approved",
        "weekly": weekly or [],
        "exceptions": exceptions or [],
        "campaignBlocks": campaign_blocks or [],
    }


TRIAL = {"slug": "ten-minutes-on-us", "enabled": True, "mobile": True, "kind": "trial", "prices": {"10": 0}}


def campaign_block(**extra):
    row = {
        "id": "cb-test",
        "campaignId": TRIAL_CAMPAIGN_ID,
        "open": True,
        "mode": "recurring",
        "weekdays": [1],
        "start": "13:00",
        "end": "15:00",
        "fullDay": False,
        "timezone": "America/Edmonton",
    }
    row.update(extra)
    return row


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
    assert row["campaignBlocks"] == []
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


def test_campaign_blocks_saturday_and_multi_weekday_save():
    """Scenarios 1–2: Saturday 10–14 and Tue+Thu 13–15 in one validation pass."""
    saturday = weekday_of("2026-06-20")  # Saturday
    assert saturday == 5
    blocks = validate_campaign_blocks([
        {"campaignId": TRIAL_CAMPAIGN_ID, "mode": "recurring", "weekdays": [5], "start": "10:00", "end": "14:00", "open": True},
        {"campaignId": TRIAL_CAMPAIGN_ID, "mode": "recurring", "weekdays": [1, 3], "start": "13:00", "end": "15:00", "open": True},
    ], practitioner_id="p-1")
    assert len(blocks) == 2
    assert blocks[0]["weekdays"] == [5] and blocks[0]["start"] == "10:00"
    assert blocks[1]["weekdays"] == [1, 3]
    sched = schedule(week(), campaign_blocks=blocks)
    assert interval_open(sched, "2026-06-20", minutes("10:00"), 10, campaign=True) is True
    assert interval_open(sched, "2026-06-16", minutes("13:00"), 10, campaign=True) is True  # Tuesday
    assert interval_open(sched, "2026-06-18", minutes("13:30"), 10, campaign=True) is True  # Thursday


def test_campaign_one_time_open_close_and_persistence_shape():
    """Scenarios 3–4 and closed-block rejection for new campaign bookings."""
    one = validate_campaign_blocks([{
        "campaignId": TRIAL_CAMPAIGN_ID, "mode": "one_time", "startDate": "2026-06-17",
        "start": "09:00", "end": "11:00", "open": True,
    }], practitioner_id="p-1")[0]
    assert one["mode"] == "one_time" and one["endDate"] == "2026-06-17"
    open_sched = schedule(week(), campaign_blocks=[one])
    assert interval_open(open_sched, "2026-06-17", minutes("09:30"), 10, campaign=True) is True
    closed = {**one, "open": False}
    closed_sched = schedule(week(), campaign_blocks=[closed])
    assert interval_open(closed_sched, "2026-06-17", minutes("09:30"), 10, campaign=True) is False
    # Closing does not invent cancellations — confirmed visits stay in appointment_outside checks via campaign cover when open only.
    assert draft_schedule("p-1")["campaignBlocks"] == []


def test_regular_cannot_consume_campaign_slots_and_campaign_needs_blocks():
    """Scenarios 5–6: reserved campaign time vs regular-only hours."""
    blocks = [campaign_block(weekdays=[1], start="13:00", end="15:00")]
    sched = schedule(week(), campaign_blocks=blocks)
    # Regular paid booking refused inside open campaign window.
    assert probe("13:30", [], sched=sched)["ok"] is False
    assert interval_open(sched, "2026-06-16", minutes("13:30"), 60) is False
    # Regular still ok outside the reserved window.
    assert probe("10:00", [], sched=sched)["ok"] is True
    # Campaign refused in regular-only morning hours (no campaign block).
    trial_probe = feasible_slot(
        schedule=sched, person=PERSON, service=TRIAL, day="2026-06-16", start=minutes("10:00"), duration=10,
        point={"lat": 53.54, "lng": -113.5}, zone=ZONE, appointments=[], rules=RULES,
        drives=lambda _a, _b: (20, "test"), location_type="home", now=NOW, production=True, campaign=True,
    )
    assert trial_probe["ok"] is False
    # Campaign accepted inside open block.
    ok = feasible_slot(
        schedule=sched, person=PERSON, service=TRIAL, day="2026-06-16", start=minutes("13:00"), duration=10,
        point={"lat": 53.54, "lng": -113.5}, zone=ZONE, appointments=[], rules=RULES,
        drives=lambda _a, _b: (20, "test"), location_type="home", now=NOW, production=True, campaign=True,
    )
    assert ok["ok"] is True
    starts = candidate_starts(sched, "2026-06-16", 10, campaign=True, campaign_id=TRIAL_CAMPAIGN_ID)
    assert minutes("13:00") in starts and minutes("14:50") in starts
    assert all(minutes("13:00") <= mark <= minutes("14:50") for mark in starts)


def test_campaign_outside_hours_requires_intentional_block():
    """Explicit campaign block may authorize time outside weekly hours; weekly alone does not."""
    short_week = [{"weekday": 1, "start": "09:00", "end": "12:00"}]
    outside = campaign_block(weekdays=[1], start="18:00", end="19:00")
    sched = schedule(short_week, campaign_blocks=[outside])
    assert interval_open(sched, "2026-06-16", minutes("18:10"), 10, campaign=True) is True
    assert interval_open(sched, "2026-06-16", minutes("18:10"), 10) is False
    assert probe("18:10", [], sched=sched, duration=60)["ok"] is False


def test_campaign_travel_buffers_and_no_double_booking():
    """Scenario 7: shared conflict calendar with travel buffers."""
    blocks = [campaign_block(weekdays=[1], start="10:00", end="16:00")]
    sched = schedule(week(), campaign_blocks=blocks)
    booked = [visit("a-trial", "13:00", 10, 53.54)]
    clash = feasible_slot(
        schedule=sched, person=PERSON, service=TRIAL, day="2026-06-16", start=minutes("13:00"), duration=10,
        point={"lat": 53.54, "lng": -113.5}, zone=ZONE, appointments=booked, rules=RULES,
        drives=lambda _a, _b: (20, "test"), location_type="home", now=NOW, production=True, campaign=True,
    )
    assert clash["ok"] is False
    # Not enough cleanup/travel before a following regular visit after the campaign window edge.
    following = [visit("a-2", "14:00", 60, 53.60)]
    tight = feasible_slot(
        schedule=sched, person=PERSON, service=TRIAL, day="2026-06-16", start=minutes("13:20"), duration=10,
        point={"lat": 53.54, "lng": -113.5}, zone=ZONE, appointments=following, rules=RULES,
        drives=lambda _a, _b: (40, "test"), location_type="home", now=NOW, production=True, campaign=True,
    )
    assert tight["ok"] is False


def test_closing_campaign_block_keeps_confirmed_appointments():
    """Scenario 9: close prevents new campaign bookings; existing visits are not reported as schedule conflicts."""
    from availability import appointment_outside_hours

    blocks = [campaign_block(weekdays=[1], start="13:00", end="15:00", open=False)]
    sched = schedule(week(), campaign_blocks=blocks)
    confirmed = [{
        "id": "a-1", "ref": "NT-1", "date": "2026-06-16", "time": "13:00", "duration": 10,
        "status": "confirmed", "appointmentKind": "trial", "pricing": {"campaignId": TRIAL_CAMPAIGN_ID},
    }]
    # Closed reservation releases regular inventory, so weekly cover still holds the confirmed visit.
    assert appointment_outside_hours(sched, confirmed) == []
    assert interval_open(sched, "2026-06-16", minutes("13:00"), 10, campaign=True) is False
    assert interval_open(sched, "2026-06-16", minutes("13:00"), 60) is True


def test_campaign_segments_and_full_day_use_weekly_hours():
    full = campaign_block(weekdays=[1], fullDay=True, start="", end="")
    cleaned = validate_campaign_blocks([full], practitioner_id="p-1")[0]
    assert cleaned["fullDay"] is True and cleaned["start"] == ""
    sched = schedule(week(), campaign_blocks=[cleaned])
    assert interval_open(sched, "2026-06-16", minutes("09:00"), 10, campaign=True) is True
    assert interval_open(sched, "2026-06-16", minutes("16:50"), 10, campaign=True) is True
    segments = day_segments(sched, "2026-06-16", [], "p-1")
    assert any(row["state"] == "campaign" for row in segments)


def test_campaign_open_blocks_cannot_overlap():
    with pytest.raises(ValueError, match="cannot overlap"):
        validate_campaign_blocks([
            {"campaignId": TRIAL_CAMPAIGN_ID, "mode": "recurring", "weekdays": [1], "start": "10:00", "end": "14:00", "open": True},
            {"campaignId": TRIAL_CAMPAIGN_ID, "mode": "recurring", "weekdays": [1], "start": "13:00", "end": "15:00", "open": True},
        ], practitioner_id="p-1")
    # Closed blocks may overlap open ones (they do not reserve inventory).
    cleaned = validate_campaign_blocks([
        {"campaignId": TRIAL_CAMPAIGN_ID, "mode": "recurring", "weekdays": [1], "start": "10:00", "end": "14:00", "open": True},
        {"campaignId": TRIAL_CAMPAIGN_ID, "mode": "recurring", "weekdays": [1], "start": "13:00", "end": "15:00", "open": False},
    ], practitioner_id="p-1")
    assert len(cleaned) == 2


def test_campaign_eligible_home_address_and_zone():
    """Scenario 8: eligible mobile home address still goes through zone + campaign block checks."""
    blocks = [campaign_block(weekdays=[1], start="10:00", end="16:00")]
    sched = schedule(week(), campaign_blocks=blocks)
    ok = feasible_slot(
        schedule=sched, person=PERSON, service=TRIAL, day="2026-06-16", start=minutes("11:00"), duration=10,
        point={"lat": 53.54, "lng": -113.5}, zone=ZONE, appointments=[], rules=RULES,
        drives=lambda _a, _b: (20, "test"), location_type="home", now=NOW, production=True, campaign=True,
    )
    assert ok["ok"] is True
    outside = feasible_slot(
        schedule=sched, person=PERSON, service=TRIAL, day="2026-06-16", start=minutes("11:00"), duration=10,
        point={"lat": 53.2, "lng": -113.5}, zone=None, appointments=[], rules=RULES,
        drives=lambda _a, _b: (20, "test"), location_type="home", now=NOW, production=True, campaign=True,
    )
    assert outside["ok"] is False
    assert outside["reason"] == "That address is outside the mobile service area"


def test_campaign_visibility_independent_of_scheduling_blocks():
    """Scenarios 11–12: empty/closed blocks do not imply campaign visibility state; owner flags stay separate."""
    empty = schedule(week(), campaign_blocks=[])
    assert interval_open(empty, "2026-06-16", minutes("10:00"), 10, campaign=True) is False
    # Practitioner schedule inventory is independent of campaign.showHome / status (those live on nt_campaigns).
    closed = schedule(week(), campaign_blocks=[campaign_block(weekdays=[1], start="10:00", end="12:00", open=False)])
    assert interval_open(closed, "2026-06-16", minutes("10:00"), 10, campaign=True) is False
    assert draft_schedule("p-1").get("campaignBlocks") == []
