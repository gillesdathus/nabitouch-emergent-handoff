"""Authoritative practitioner availability and route feasibility.

Local calendars use America/Edmonton. Stored instants stay in UTC.
A recommendation is not a booking. Existing appointments are never moved here.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, HTTPException, Request

from catalog import booking_block_reason
from pricing import BLOCKING_STATUSES, haversine_km, minutes, zone_for

TZ = ZoneInfo("America/Edmonton")
SETUP_MIN = 10
CLEANUP_MIN = 15
TRAVEL_BUFFER_MIN = 10
LEAD_MIN = 90
LOCK_MIN = 30
STEP_MIN = 30
UNKNOWN_TRAVEL_MIN = 45
BLOCKING_KINDS = {"break", "vacation", "sick", "emergency", "closed"}
OPEN_KIND = "open"
WEEKDAYS = range(7)
CANCELLATION_DRAFT = (
    "We understand that plans can change. If you need to cancel or reschedule your massage appointment, "
    "please contact Nabitouch as soon as possible. We currently do not charge an automatic cancellation fee."
)
OUTBOUND_OPENING_NOTICES = False


def scheduling_rules(settings):
    raw = (settings or {}).get("scheduling") or {}
    return {
        "setupMin": int(raw.get("setupMin") if raw.get("setupMin") is not None else SETUP_MIN),
        "cleanupMin": int(raw.get("cleanupMin") if raw.get("cleanupMin") is not None else CLEANUP_MIN),
        "travelBufferMin": int(raw.get("travelBufferMin") if raw.get("travelBufferMin") is not None else TRAVEL_BUFFER_MIN),
        "leadMin": int(raw.get("leadMin") if raw.get("leadMin") is not None else LEAD_MIN),
        "turnaround": turnaround_config(settings),
    }


def turnaround_config(settings):
    """Cleanup buffers by appointment type, service and practitioner. Mobile packing defaults to the scheduling cleanup buffer."""
    raw = (settings or {}).get("turnaround") or {}
    sched = (settings or {}).get("scheduling") or {}
    mobile = raw.get("mobileCleanupMin")
    if mobile is None:
        mobile = sched.get("cleanupMin") if sched.get("cleanupMin") is not None else CLEANUP_MIN
    return {
        "clinicCleanupMin": int(raw.get("clinicCleanupMin") if raw.get("clinicCleanupMin") is not None else 10),
        "equipmentCleanupMin": int(raw.get("equipmentCleanupMin") if raw.get("equipmentCleanupMin") is not None else 15),
        "mobileCleanupMin": int(mobile),
        "equipmentServices": [str(slug) for slug in (raw.get("equipmentServices") or ["hot-stone"])],
        "byService": {str(k): int(v) for k, v in (raw.get("byService") or {}).items()},
        "byPractitioner": {str(k): int(v) for k, v in (raw.get("byPractitioner") or {}).items()},
        "departureSoonMin": int(raw.get("departureSoonMin") if raw.get("departureSoonMin") is not None else 15),
    }


def cleanup_minutes(config, service_slug, practitioner_id, location_type, override=None):
    """Appointment override, then practitioner, then service, then appointment type."""
    if override is not None:
        return int(override), "appointment"
    if practitioner_id and practitioner_id in config["byPractitioner"]:
        return config["byPractitioner"][practitioner_id], "practitioner"
    if service_slug and service_slug in config["byService"]:
        return config["byService"][service_slug], "service"
    base = config["clinicCleanupMin"] if location_type == "clinic" else config["mobileCleanupMin"]
    if service_slug in config["equipmentServices"]:
        return max(base, config["equipmentCleanupMin"]), "equipment"
    return base, "clinic" if location_type == "clinic" else "mobile"


def validate_turnaround(raw):
    raw = dict(raw or {})
    out = {}
    out["_inherit"] = [key for key in ("clinicCleanupMin", "equipmentCleanupMin", "mobileCleanupMin", "departureSoonMin") if key in raw and raw[key] is None]
    for key in ("clinicCleanupMin", "equipmentCleanupMin", "mobileCleanupMin", "departureSoonMin"):
        if raw.get(key) is None:
            continue
        value = int(raw[key])
        if value < 0 or value > 120:
            raise ValueError("Cleanup buffers must be between 0 and 120 minutes")
        out[key] = value
    for key in ("byService", "byPractitioner"):
        if key in raw:
            table = {}
            for name, value in (raw.get(key) or {}).items():
                if value in (None, ""):
                    continue
                value = int(value)
                if value < 0 or value > 120:
                    raise ValueError("Cleanup buffers must be between 0 and 120 minutes")
                table[str(name)[:60]] = value
            out[key] = table
    if "equipmentServices" in raw:
        out["equipmentServices"] = [str(slug)[:60] for slug in (raw.get("equipmentServices") or [])][:40]
    return out


def adjacent_travel_enforced(settings, production):
    raw = (settings or {}).get("scheduling") or {}
    if "enforceAdjacentTravel" in raw:
        return bool(raw.get("enforceAdjacentTravel"))
    return bool(production)


def validate_scheduling(raw):
    """Owner-configured buffers. Missing keys are left unchanged by the caller."""
    raw = dict(raw or {})
    limits = {"setupMin": 180, "cleanupMin": 180, "travelBufferMin": 180, "leadMin": 24 * 60}
    cleaned = {}
    for key, limit in limits.items():
        if key not in raw or raw.get(key) is None:
            continue
        try:
            value = int(raw.get(key))
        except (TypeError, ValueError) as exc:
            raise ValueError("Buffers must be whole minutes") from exc
        if value < 0 or value > limit:
            raise ValueError("Buffers must stay within the allowed range")
        cleaned[key] = value
    if "enforceAdjacentTravel" in raw:
        cleaned["enforceAdjacentTravel"] = bool(raw.get("enforceAdjacentTravel"))
    return cleaned


def local_date_time(day, hhmm, fold=0):
    """Wall-clock time in Edmonton. Rejects times that do not exist on a spring-forward morning."""
    year, month, date = (int(part) for part in str(day).split("-"))
    hour, minute = (int(part) for part in str(hhmm).split(":"))
    stamp = datetime(year, month, date, hour, minute, tzinfo=TZ, fold=fold)
    back = stamp.astimezone(timezone.utc).astimezone(TZ)
    if (back.hour, back.minute) != (hour, minute):
        raise ValueError("That local time does not exist in Edmonton")
    return stamp


def weekday_of(day):
    year, month, date = (int(part) for part in str(day).split("-"))
    return datetime(year, month, date).weekday()


def hhmm(total):
    total = int(total) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def validate_weekly(weekly):
    cleaned = []
    for row in weekly or []:
        day = int(row.get("weekday"))
        if day not in WEEKDAYS:
            raise ValueError("Weekday must be 0 (Monday) through 6 (Sunday)")
        start, end = str(row.get("start") or ""), str(row.get("end") or "")
        if minutes(end) <= minutes(start):
            raise ValueError("An availability interval must end after it starts")
        services = row.get("services") or []
        if not isinstance(services, list) or any(not isinstance(item, str) or not item.strip() for item in services):
            raise ValueError("Limit a weekly interval to catalogue services, or leave it open to every approved service")
        entry = {"weekday": day, "start": start, "end": end}
        if services:
            entry["services"] = [item.strip() for item in services]
        cleaned.append(entry)
    for day in WEEKDAYS:
        spans = sorted((row for row in cleaned if row["weekday"] == day), key=lambda row: row["start"])
        for left, right in zip(spans, spans[1:]):
            if minutes(left["end"]) > minutes(right["start"]):
                raise ValueError("Weekly intervals on the same day cannot overlap")
    return cleaned


def _span_on(day, start, end):
    if not start or not end:
        return 0, 24 * 60
    return minutes(start), minutes(end)


def _covers(exception, day, start, end):
    if str(exception.get("startDate") or "") > day or str(exception.get("endDate") or day) < day:
        return False
    block_start, block_end = _span_on(day, exception.get("start"), exception.get("end"))
    return start < block_end and block_start < end


def _contains(exception, day, start, end):
    if str(exception.get("startDate") or "") > day or str(exception.get("endDate") or day) < day:
        return False
    block_start, block_end = _span_on(day, exception.get("start"), exception.get("end"))
    return start >= block_start and end <= block_end


def blocking_cover(schedule, day, start, end):
    return [row for row in (schedule or {}).get("exceptions") or [] if row.get("kind") in BLOCKING_KINDS and _covers(row, day, start, end)]


def open_cover(schedule, day, start, end):
    return [row for row in (schedule or {}).get("exceptions") or [] if row.get("kind") == OPEN_KIND and _contains(row, day, start, end)]


def weekly_cover(schedule, day, start, end, service_slug=None):
    weekday = weekday_of(day)
    for row in (schedule or {}).get("weekly") or []:
        if int(row.get("weekday")) != weekday:
            continue
        if start < minutes(row["start"]) or end > minutes(row["end"]):
            continue
        limited = row.get("services") or []
        if service_slug and limited and service_slug not in limited:
            continue
        return True
    return False


def interval_open(schedule, day, start, duration, service_slug=None):
    """The whole treatment must sit in open time. Leave beats a manual reopen."""
    end = int(start) + int(duration)
    if blocking_cover(schedule, day, start, end):
        return False
    if open_cover(schedule, day, start, end) or weekly_cover(schedule, day, start, end, service_slug):
        return True
    return False


def practitioner_bookable(person, schedule):
    if not person or person.get("available") is False:
        return False
    status = person.get("onboardingStatus")
    if status and status != "approved":
        return False
    if schedule is None:
        return True
    if schedule.get("status") != "approved" or schedule.get("acceptingBookings") is False:
        return False
    return True


def qualified(person, service):
    from trial import is_trial_service

    # Trial is bound to a campaign practitioner; legacy specialty lists often omit the trial slug.
    if is_trial_service(service):
        return True
    specialties = person.get("specialties")
    if specialties is None:
        return True
    if not specialties:
        return False
    slug = (service or {}).get("slug") or ""
    return slug in specialties


def point_of(address):
    if not address or address.get("lat") is None or address.get("lng") is None:
        return None
    return {"lat": float(address["lat"]), "lng": float(address["lng"])}


def _finite_point(lat, lng):
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if lat != lat or lng != lng or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return {"lat": lat, "lng": lng}


GPS_STALE_SEC = 30
GPS_MAX_SKEW_SEC = 120
GPS_MAX_ACCURACY_M = 150


def gps_origin(fix, now=None):
    """A recorded trip origin is a current device fix. Missing, denied, invalid, and stale fixes are not a location."""
    if not isinstance(fix, dict):
        return None
    point = _finite_point(fix.get("lat"), fix.get("lng"))
    if not point:
        return None
    accuracy = fix.get("accuracy")
    if accuracy is not None:
        try:
            accuracy = float(accuracy)
        except (TypeError, ValueError):
            return None
        if accuracy < 0 or (accuracy > GPS_MAX_ACCURACY_M and not fix.get("approximate")):
            return None
    recorded = fix.get("recordedAt")
    if not recorded:
        return None
    try:
        stamp = datetime.fromisoformat(str(recorded).replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    skew = (now - stamp).total_seconds()
    if skew < -GPS_MAX_SKEW_SEC or skew > GPS_STALE_SEC:
        return None
    return point


def visit_navigation_point(address, location_type="home"):
    """Coordinates for an external maps handoff. A clinic pin is used only after that address was verified."""
    address = address or {}
    if location_type == "clinic":
        if address.get("navigation") != "ready":
            return None
        return _finite_point(address.get("lat"), address.get("lng"))
    arrival = address.get("arrival") if isinstance(address.get("arrival"), dict) else None
    if arrival:
        point = _finite_point(arrival.get("lat"), arrival.get("lng"))
        if point:
            return point
    return _finite_point(address.get("lat"), address.get("lng"))


def conservative_drive(origin, dest):
    """Never report zero travel when the two stops differ or either stop is unknown."""
    if not origin or not dest:
        return UNKNOWN_TRAVEL_MIN, "conservative"
    km = haversine_km(origin, dest) * 1.3
    if km <= 0.05:
        return 0, "same-stop"
    return max(25, math.ceil(4 + km * 1.9)), "conservative"


def buffer_before(rules):
    return int(rules["cleanupMin"]) + int(rules["travelBufferMin"]) + int(rules["setupMin"])


def required_gap(drive_min, rules):
    return int(drive_min) + buffer_before(rules)


def neighbors(appointments, day, start, duration, exclude_id=None):
    rows = [row for row in appointments or [] if row.get("date") == day and row.get("status") in BLOCKING_STATUSES and row.get("id") != exclude_id]
    end = int(start) + int(duration)
    previous = [row for row in rows if minutes(row["time"]) + int(row["duration"]) <= start]
    following = [row for row in rows if minutes(row["time"]) >= end]
    previous.sort(key=lambda row: minutes(row["time"]) + int(row["duration"]))
    following.sort(key=lambda row: minutes(row["time"]))
    return (previous[-1] if previous else None), (following[0] if following else None)


def overlaps_appointment(appointments, day, start, duration, exclude_id=None):
    end = int(start) + int(duration)
    for row in appointments or []:
        if row.get("date") != day or row.get("id") == exclude_id or row.get("status") not in BLOCKING_STATUSES:
            continue
        other = minutes(row["time"])
        if start < other + int(row["duration"]) and other < end:
            return row
    return None


def conflicts_for_close(appointments, start_date, end_date, start, end):
    found = []
    day = datetime.fromisoformat(start_date).date()
    last = datetime.fromisoformat(end_date).date()
    while day <= last:
        key = day.isoformat()
        for row in appointments or []:
            if row.get("date") != key or row.get("status") not in BLOCKING_STATUSES:
                continue
            row_start = minutes(row["time"])
            row_end = row_start + int(row["duration"])
            block_start, block_end = _span_on(key, start, end)
            if row_start < block_end and block_start < row_end:
                found.append({"id": row["id"], "ref": row.get("ref"), "date": key, "time": row["time"], "duration": int(row["duration"])})
        day += timedelta(days=1)
    return found


def appointment_outside_hours(schedule, appointments):
    """Appointments that would no longer sit in open time after a weekly edit."""
    outside = []
    for row in appointments or []:
        if row.get("status") not in BLOCKING_STATUSES:
            continue
        start = minutes(row["time"])
        if not interval_open(schedule, row["date"], start, int(row["duration"])):
            outside.append({"id": row["id"], "ref": row.get("ref"), "date": row["date"], "time": row["time"], "duration": int(row["duration"])})
    return outside


def lock_marks(practitioner_id, day, start, duration, gap):
    end = int(start) + int(duration) + max(int(gap), LOCK_MIN)
    return [f"{practitioner_id}|{day}|{mark}" for mark in range(int(start), int(end))]


def can_manage(user, practitioner_id, perms):
    if not user:
        return False
    from rbac import has_role, has_strict_role
    # Owner-equivalent managers share schedule/route access with owners.
    if has_role(user, "owner"):
        return True
    if has_strict_role(user, "practitioner"):
        return user.get("subject") == practitioner_id
    if has_strict_role(user, "desk"):
        return bool((perms or {}).get("manageAvailability"))
    return False


def visible_to(person, role, subject):
    status = person.get("onboardingStatus") or "approved"
    if status == "approved":
        return True
    if role in ("owner", "desk"):
        return True
    return role == "practitioner" and person.get("id") == subject


def public_cancellation(policy, role):
    if not policy:
        return None
    if policy.get("automaticFee") or policy.get("deadlineHours") or policy.get("noShowPenalty"):
        return None
    if policy.get("status") == "approved":
        return {"status": "approved", "automaticFee": False, "text": policy.get("text") or ""}
    if role == "owner":
        return {"status": "pending", "automaticFee": False, "text": policy.get("text") or ""}
    return None


def zone_name(zone):
    return (zone or {}).get("name") or "the mobile service area"


def feasible_slot(*, schedule, person, service, day, start, duration, point, zone, appointments, rules, drives, location_type, now, production, exclude_id=None, check_service=True):
    """Return a feasibility record. drives(origin, dest) -> (minutes, provider)."""
    if location_type == "clinic":
        return {"ok": False, "reason": "In-clinic booking is not available"}
    if not service or service.get("enabled") is False or service.get("archived") is True or not service.get("mobile", True):
        return {"ok": False, "reason": "Choose a mobile service"}
    if check_service:
        blocked = booking_block_reason(service, duration, "home")
        if blocked:
            return {"ok": False, "reason": blocked}
    if not zone:
        return {"ok": False, "reason": "That address is outside the mobile service area"}
    if not practitioner_bookable(person, schedule):
        return {"ok": False, "reason": "That practitioner is not available"}
    if check_service and not qualified(person, service):
        return {"ok": False, "reason": "That practitioner is not offered for this service"}
    service_slug = (service or {}).get("slug") if check_service else None
    if schedule is not None and not interval_open(schedule, day, start, duration, service_slug):
        return {"ok": False, "reason": "That time is not open"}
    if schedule is None and production:
        return {"ok": False, "reason": "That time is not open"}
    if overlaps_appointment(appointments, day, start, duration, exclude_id):
        return {"ok": False, "reason": "That time was just booked"}
    local_now = now.astimezone(TZ)
    if day == local_now.date().isoformat() and start < local_now.hour * 60 + local_now.minute + int(rules["leadMin"]):
        return {"ok": False, "reason": "That time is too soon"}
    previous, following = neighbors(appointments, day, start, duration, exclude_id)
    extra = 0
    idle = 0
    warnings = []
    legs = []
    config = rules.get("turnaround")

    def gap_after(row_slug, row_person, row_location, override, drive):
        if not config:
            return required_gap(drive, rules)
        clean, _source = cleanup_minutes(config, row_slug, row_person, row_location, override)
        return int(drive) + clean + int(rules["travelBufferMin"]) + int(rules["setupMin"])

    if previous:
        origin = point_of(previous.get("address"))
        drive, provider = drives(origin, point)
        need = gap_after(previous.get("serviceSlug"), previous.get("practitionerId"), previous.get("locationType"), previous.get("cleanupMin"), drive)
        prev_end = minutes(previous["time"]) + int(previous["duration"])
        if start < prev_end + need:
            return {"ok": False, "reason": "There is not enough travel time before that appointment", "travelMin": drive, "provider": provider}
        extra += drive
        idle += start - (prev_end + need)
        if provider == "conservative":
            warnings.append("Travel time is a conservative estimate because routing was unavailable")
        legs.append({"direction": "from-previous", "minutes": drive, "provider": provider})
    if following:
        dest = point_of(following.get("address"))
        drive, provider = drives(point, dest)
        need = gap_after((service or {}).get("slug"), (person or {}).get("id"), location_type, None, drive)
        next_start = minutes(following["time"])
        if start + int(duration) + need > next_start:
            return {"ok": False, "reason": "There is not enough travel time after that appointment", "travelMin": drive, "provider": provider}
        extra += drive
        idle += next_start - (start + int(duration) + need)
        if provider == "conservative":
            warnings.append("Travel time is a conservative estimate because routing was unavailable")
        legs.append({"direction": "to-next", "minutes": drive, "provider": provider})
    if previous and following:
        direct, _provider = drives(point_of(previous.get("address")), point_of(following.get("address")))
        extra = max(0, extra - direct)
    return {"ok": True, "additionalDrive": extra, "idle": idle, "legs": legs, "warnings": warnings, "zone": zone_name(zone)}


def rank_slots(records):
    ranked = [row for row in records if row.get("ok")]
    ranked.sort(key=lambda row: (row["additionalDrive"], min((leg["minutes"] for leg in row["legs"]), default=0), row["idle"], row["time"]))
    labels = {}
    if ranked:
        labels[id(ranked[0])] = "Best route fit"
        shortest = min(ranked, key=lambda row: (row["additionalDrive"], row["time"]))
        if shortest is not ranked[0]:
            labels[id(shortest)] = "Shortest travel"
    for row in ranked:
        row["label"] = labels.get(id(row), "Available")
    return ranked


def public_slot(row):
    return {
        "time": row["time"],
        "label": row["label"],
        "additionalDrive": row["additionalDrive"],
        "zone": row.get("zone") or "",
        "practitionerId": row.get("practitionerId") or "",
    }


def gap_suggestions(schedule, person, day, appointments, rules, drives, durations=(60, 90)):
    """Internal gaps only. The area name is a zone, never another client's street."""
    if not practitioner_bookable(person, schedule):
        return []
    rows = [row for row in appointments or [] if row.get("date") == day and row.get("status") in BLOCKING_STATUSES and row.get("practitionerId") == person.get("id")]
    rows.sort(key=lambda row: row["time"])
    found = []
    for left, right in zip(rows, rows[1:]):
        for duration in durations:
            start = minutes(left["time"]) + int(left["duration"])
            slot = None
            while start + duration <= minutes(right["time"]):
                if schedule is None or interval_open(schedule, day, start, duration):
                    probe = feasible_slot(
                        schedule=schedule, person=person, service={"slug": "mobile", "enabled": True, "mobile": True},
                        day=day, start=start, duration=duration, point=point_of(left.get("address")), zone={"name": "the previous visit area"},
                        appointments=rows, rules=rules, drives=drives, location_type="home",
                        now=datetime(2000, 1, 1, tzinfo=timezone.utc), production=False, exclude_id=None, check_service=False,
                    )
                    if probe["ok"]:
                        slot = start
                        break
                start += STEP_MIN
            if slot is None:
                continue
            zone = (left.get("address") or {}).get("zoneName") or "the previous visit area"
            found.append({
                "start": hhmm(slot),
                "duration": duration,
                "area": zone,
                "text": f"{duration}-minute appointment possible near {zone}.",
            })
    return found


def match_watches(watches, opening, now):
    """Only clients who opted in. No client is invented and nothing is sent."""
    matched = []
    for watch in watches or []:
        if watch.get("optIn") is not True:
            continue
        if watch.get("serviceSlug") and opening.get("serviceSlug") and watch["serviceSlug"] != opening["serviceSlug"]:
            continue
        if int(watch.get("duration") or opening.get("duration") or 0) != int(opening.get("duration") or 0):
            continue
        if watch.get("earliestDate") and opening["date"] < watch["earliestDate"]:
            continue
        if watch.get("latestDate") and opening["date"] > watch["latestDate"]:
            continue
        if watch.get("timeFrom") and opening["time"] < watch["timeFrom"]:
            continue
        if watch.get("timeTo") and opening["time"] > watch["timeTo"]:
            continue
        matched.append({"watchId": watch["id"], "clientId": watch["clientId"], "notify": False})
    return matched


def claim_offer(offer, client_id, feasible):
    if not offer or offer.get("status") != "available":
        return "taken"
    if offer.get("clientId") != client_id:
        return "forbidden"
    if not feasible:
        return "stale"
    return "claimed"


def propose_order(stops, drives):
    """A shorter visit order is a proposal. It does not change appointment times."""
    if len(stops) < 3 or len(stops) > 4:
        return None
    current = 0
    for left, right in zip(stops, stops[1:]):
        minutes_drive, _provider = drives(point_of(left.get("address")), point_of(right.get("address")))
        current += minutes_drive
    best = current
    best_order = stops
    from itertools import permutations
    for order in permutations(stops):
        if list(order) == stops:
            continue
        total = 0
        for left, right in zip(order, order[1:]):
            minutes_drive, _provider = drives(point_of(left.get("address")), point_of(right.get("address")))
            total += minutes_drive
        if total + 5 < best:
            best = total
            best_order = list(order)
    if best_order == stops:
        return None
    moves = []
    for stop, proposed in zip(stops, best_order):
        if stop["id"] != proposed["id"]:
            moves.append({"appointmentId": proposed["id"], "currentTime": proposed["time"], "suggestedTime": stop["time"]})
    return {"status": "needs_approval", "applied": False, "savedMinutes": current - best, "moves": moves}


def draft_schedule(practitioner_id):
    return {
        "id": f"sch-{practitioner_id}",
        "practitionerId": practitioner_id,
        "timezone": "America/Edmonton",
        "status": "draft",
        "acceptingBookings": False,
        "weekly": [],
        "exceptions": [],
    }


def launch_practitioner():
    from trial import TRIAL_SERVICE_SLUG

    return {
        "id": "p-nabitu-kahindo",
        "name": "Nabitu Kahindo",
        "initials": "NK",
        "color": "#1565F0",
        "isOwner": False,
        # Trial specialty is catalogued only — available/bookable stay false until owner authorizes.
        "specialties": [TRIAL_SERVICE_SLUG],
        "available": False,
        "onboardingStatus": "draft",
        "bookable": False,
        "mobile": True,
        "clinic": True,
        "directBilling": False,
        "bio": "",
    }


def launch_clinic():
    return {
        "enabled": False,
        "address": "",
        "name": "Nabitouch",
        "email": "info@nabitouch.com",
        "phone": "+1 780-235-6508",
        "phoneDisplay": "(780) 235-6508",
        "phoneTel": "+17802356508",
        "hours": "By appointment only",
        "mobileEnabled": True,
    }


def launch_policy():
    return {"status": "pending", "automaticFee": False, "text": CANCELLATION_DRAFT}


def normalize_phone(value):
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if digits == "17802356508" or digits == "7802356508":
        return {"phone": "+1 780-235-6508", "phoneDisplay": "(780) 235-6508", "phoneTel": "+17802356508"}
    if len(digits) == 10:
        return {"phone": f"+1 {digits[:3]}-{digits[3:6]}-{digits[6:]}", "phoneDisplay": f"{digits[:3]}-{digits[3:6]}-{digits[6:]}", "phoneTel": f"+1{digits}"}
    if len(digits) == 11 and digits.startswith("1"):
        rest = digits[1:]
        return {"phone": f"+1 {rest[:3]}-{rest[3:6]}-{rest[6:]}", "phoneDisplay": f"{rest[:3]}-{rest[3:6]}-{rest[6:]}", "phoneTel": f"+{digits}"}
    raise ValueError("Enter a Canadian phone number")


def clinic_is_bookable(clinic):
    """A clinic visit needs an enabled record and a real street address."""
    if (clinic or {}).get("enabled") is not True:
        return False
    try:
        validate_clinic(clinic)
    except ValueError:
        return False
    return True


def clinic_has_address(clinic):
    """Street address present and valid — used for campaign-scoped clinic trials without enabling general in-clinic booking."""
    try:
        validate_clinic(clinic)
    except ValueError:
        return False
    return bool(str((clinic or {}).get("address") or "").strip())


def clinic_visit_address(clinic, notes="", *, trial=False):
    """Keep the clinic street address. Coordinates are used only after that same address was confirmed.

    Trial campaigns may reserve clinic time when a street address exists even if general
    in-clinic booking stays disabled for the catalogue.
    """
    if trial:
        if not clinic_has_address(clinic):
            raise ValueError("The clinic address is not ready for trial booking")
    elif not clinic_is_bookable(clinic):
        raise ValueError("In-clinic booking is not available")
    address = {"line": str((clinic or {}).get("address") or "").strip(), "zoneId": None, "notes": str(notes or "")[:240], "navigation": "unavailable"}
    if (clinic or {}).get("coordinatesVerified") is not True:
        return address
    lat, lng = (clinic or {}).get("lat"), (clinic or {}).get("lng")
    try:
        if lat is not None and lng is not None and str(lat) != "" and str(lng) != "":
            address["lat"] = float(lat)
            address["lng"] = float(lng)
            address["navigation"] = "ready"
    except (TypeError, ValueError):
        pass
    return address


def _clinic_line(value):
    return " ".join(str(value or "").split())


def merge_clinic(current, incoming, resolved=None, provider_down=False):
    """Apply an owner clinic edit. Client coordinates are ignored. A new street drops the old pin."""
    current = dict(current or {})
    incoming = dict(incoming or {})
    confirmation = incoming.get("confirmation") if isinstance(incoming.get("confirmation"), dict) else {}
    line = _clinic_line(incoming.get("address", current.get("address")))
    previous = _clinic_line(current.get("address"))
    kept = {key: value for key, value in incoming.items() if key not in ("lat", "lng", "mapboxId", "coordinatesVerified", "navigation", "confirmation")}
    clinic = {**current, **kept, "address": line}
    clinic.pop("lat", None)
    clinic.pop("lng", None)
    clinic.pop("mapboxId", None)
    clinic["coordinatesVerified"] = False
    clinic["navigation"] = "unavailable"
    same_street = line == previous and current.get("coordinatesVerified") is True
    if same_street and not confirmation and not provider_down:
        if current.get("lat") is not None and current.get("lng") is not None:
            clinic["lat"] = float(current["lat"])
            clinic["lng"] = float(current["lng"])
            clinic["mapboxId"] = current.get("mapboxId") or ""
            clinic["coordinatesVerified"] = True
            clinic["navigation"] = "ready"
        return clinic
    if provider_down or not resolved or confirmation.get("clientConfirmed") is not True:
        return clinic
    if resolved.get("confidence") != "address":
        raise ValueError("This address needs review before the clinic location can be saved.")
    clinic["address"] = _clinic_line(resolved.get("line") or line)
    clinic["lat"] = float(resolved["lat"])
    clinic["lng"] = float(resolved["lng"])
    clinic["mapboxId"] = resolved.get("mapboxId") or ""
    clinic["coordinatesVerified"] = True
    clinic["navigation"] = "ready"
    return clinic


def public_clinic(clinic):
    """Public pages never receive a placeholder clinic address.

    When general in-clinic booking is off, the street line stays hidden, but
    addressReady tells trial campaigns the clinic can still host a reserved visit.
    """
    clinic = clinic if isinstance(clinic, dict) else {}
    mobile = clinic.get("mobileEnabled") is not False
    ready = clinic_has_address(clinic)
    if not clinic_is_bookable(clinic):
        return {
            "enabled": False,
            "mobileEnabled": mobile,
            "address": "",
            "addressReady": ready,
            "name": clinic.get("name") or "Nabitouch",
        }
    return {
        "enabled": True,
        "mobileEnabled": mobile,
        "address": clinic.get("address") or "",
        "addressReady": ready,
        "name": clinic.get("name") or "Nabitouch",
        "phoneDisplay": clinic.get("phoneDisplay") or "",
        "hours": clinic.get("hours") or "",
    }


def validate_clinic(clinic):
    clinic = dict(clinic or {})
    if clinic.get("phone"):
        clinic.update(normalize_phone(clinic.get("phoneTel") or clinic.get("phone")))
    if clinic.get("enabled") and not str(clinic.get("address") or "").strip():
        raise ValueError("An in-clinic address is required before in-clinic booking can be turned on")
    if "[" in str(clinic.get("address") or "") or "to be supplied" in str(clinic.get("address") or "").lower():
        raise ValueError("A placeholder street address cannot be published")
    return clinic


def validate_policy(policy):
    policy = dict(policy or {})
    if policy.get("automaticFee") or policy.get("deadlineHours") or policy.get("noShowPenalty") or policy.get("depositForfeiture"):
        raise ValueError("Automatic cancellation charges are not enabled")
    if policy.get("status") not in ("pending", "approved"):
        raise ValueError("A cancellation policy is pending or approved")
    policy["automaticFee"] = False
    policy.pop("deadlineHours", None)
    policy.pop("noShowPenalty", None)
    policy.pop("depositForfeiture", None)
    return policy


def candidate_starts(schedule, day, duration, service_slug=None):
    if schedule is None:
        return list(range(9 * 60, 20 * 60 - int(duration) + 1, STEP_MIN))
    starts = []
    for mark in range(0, 24 * 60 - int(duration) + 1, STEP_MIN):
        if interval_open(schedule, day, mark, duration, service_slug):
            starts.append(mark)
    return starts


def day_segments(schedule, day, appointments, practitioner_id):
    states = ["unavailable"] * (24 * 60)
    for mark in range(24 * 60):
        if interval_open(schedule or {"weekly": [], "exceptions": []}, day, mark, 1):
            states[mark] = "available"
        if blocking_cover(schedule or {}, day, mark, mark + 1):
            states[mark] = "blocked"
    for row in appointments or []:
        if row.get("practitionerId") != practitioner_id or row.get("date") != day or row.get("status") not in BLOCKING_STATUSES:
            continue
        start = minutes(row["time"])
        for mark in range(start, min(24 * 60, start + int(row["duration"]))):
            states[mark] = "booked"
    segments = []
    cursor = 0
    while cursor < 24 * 60:
        state = states[cursor]
        end = cursor + 1
        while end < 24 * 60 and states[end] == state:
            end += 1
        if state != "unavailable":
            segments.append({"start": hhmm(cursor), "end": hhmm(end), "state": state})
        cursor = end
    return segments


def route_location_type(row):
    """Return the booking's stored locationType when present. Never invent a type."""
    if not isinstance(row, dict):
        return None
    value = row.get("locationType")
    if value is None or value == "":
        return None
    return str(value)


def navigation_location_type(row):
    """Coordinate resolution mode. Missing types resolve as mobile (not clinic)."""
    location = route_location_type(row)
    if location == "clinic":
        return "clinic"
    return location or "home"


def is_clinic_location(location_type):
    return location_type == "clinic"


def _estimate_type(provider):
    if provider == "mapbox-traffic":
        return "traffic-aware"
    if provider == "mapbox":
        return "standard"
    if provider == "same-stop":
        return "same-stop"
    return None


def _geojson_linestring(raw):
    """Validate Mapbox GeoJSON LineString coordinates as [lng, lat] pairs."""
    if not isinstance(raw, dict):
        return None
    coords = raw.get("coordinates")
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    cleaned = []
    for pair in coords:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            return None
        try:
            lng = float(pair[0])
            lat = float(pair[1])
        except (TypeError, ValueError):
            return None
        if not math.isfinite(lng) or not math.isfinite(lat):
            return None
        if lat < -90 or lat > 90 or lng < -180 or lng > 180:
            return None
        cleaned.append([lng, lat])
    if len(cleaned) < 2:
        return None
    return {"type": "LineString", "coordinates": cleaned}


def _road_points(geometry):
    """lat/lng points for LiveMap (same convention as tracking MapboxDirections.eta)."""
    if not geometry:
        return None
    return [{"lat": lat, "lng": lng} for lng, lat in geometry["coordinates"]]


def _unavailable_leg(minutes_est=None, provider="unavailable"):
    """Explicit non-road state. Never fabricate geometry or present haversine as road distance."""
    return {
        "available": False,
        "minutes": minutes_est,
        "provider": provider,
        "km": None,
        "durationSec": None,
        "distanceM": None,
        "geometry": None,
        "route": None,
        "estimateType": None,
        "routingProvider": "mapbox",
    }


async def mapbox_leg(origin, dest):
    """Road leg from Mapbox Directions when available.

    Scheduling callers may still use minutes from a conservative fallback via mapbox_drive.
    My Route only treats available=True legs (with optional geometry) as driving ETA.
    """
    minutes_est, provider = conservative_drive(origin, dest)
    if not origin or not dest:
        return _unavailable_leg(minutes_est, provider)
    if provider == "same-stop":
        return {
            "available": True,
            "minutes": 0,
            "provider": "same-stop",
            "km": 0,
            "durationSec": 0,
            "distanceM": 0,
            "geometry": None,
            "route": None,
            "estimateType": "same-stop",
            "routingProvider": "mapbox",
        }
    fallback = _unavailable_leg(minutes_est, "unavailable")
    try:
        from tracking import DIRECTIONS
        import os
        token = os.environ.get("MAPBOX_TOKEN")
        if not token:
            return fallback
        for profile, label in (("driving-traffic", "mapbox-traffic"), ("driving", "mapbox")):
            try:
                route = await DIRECTIONS._fetch(profile, origin, dest, token)
                distance_m = float(route["distance"])
                duration_sec = float(route["duration"])
                if not math.isfinite(distance_m) or not math.isfinite(duration_sec):
                    continue
                if distance_m <= 50:
                    return {
                        "available": True,
                        "minutes": 0,
                        "provider": "same-stop",
                        "km": 0,
                        "durationSec": 0,
                        "distanceM": 0,
                        "geometry": None,
                        "route": None,
                        "estimateType": "same-stop",
                        "routingProvider": "mapbox",
                    }
                geometry = _geojson_linestring(route.get("geometry") or {})
                # Duration/distance may still be shown when geometry is missing, but never invent a line.
                return {
                    "available": True,
                    "minutes": max(1, math.ceil(duration_sec / 60)),
                    "provider": label,
                    "km": round(distance_m / 1000, 1),
                    "durationSec": int(round(duration_sec)),
                    "distanceM": int(round(distance_m)),
                    "geometry": geometry,
                    "route": _road_points(geometry),
                    "estimateType": _estimate_type(label),
                    "routingProvider": "mapbox",
                }
            except Exception:
                continue
    except Exception:
        return fallback
    return fallback


async def mapbox_drive(origin, dest):
    """Coordinates only. A failed route becomes a conservative non-zero estimate for scheduling."""
    leg = await mapbox_leg(origin, dest)
    if leg.get("available") and leg.get("provider") != "unavailable":
        return int(leg["minutes"]), leg["provider"]
    minutes_est, provider = conservative_drive(origin, dest)
    return minutes_est, provider


def _live(production):
    return production() if callable(production) else bool(production)


def build_schedule_router(db, coll, add_audit, require, user_from, locate_visit, reception_perms, production):
    router = APIRouter(prefix="/api")

    async def _schedule(practitioner_id):
        return await db.nt_schedules.find_one({"practitionerId": practitioner_id}, {"_id": 0})

    async def _guard(user, practitioner_id):
        if not can_manage(user, practitioner_id, await reception_perms() if user and user.get("role") == "desk" else {}):
            raise HTTPException(403, "Not permitted")

    @router.post("/availability/recommendations")
    async def recommend(request: Request, payload: dict = Body(...)):
        await user_from(request)
        return await recommend_slots(db, coll, locate_visit, payload, production=_live(production))

    @router.get("/schedules/{practitioner_id}")
    async def read_schedule(practitioner_id: str, request: Request, start: str = "", end: str = ""):
        user = await require(request)
        await _guard(user, practitioner_id)
        person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0})
        if not person:
            raise HTTPException(404, "Practitioner not found")
        schedule = await _schedule(practitioner_id) or draft_schedule(practitioner_id)
        appointments = await coll("appointments").find({"practitionerId": practitioner_id}, {"_id": 0, "id": 1, "ref": 1, "date": 1, "time": 1, "duration": 1, "status": 1, "practitionerId": 1}).to_list(500)
        days = []
        if start and end:
            cursor = datetime.fromisoformat(start).date()
            last = datetime.fromisoformat(end).date()
            while cursor <= last:
                key = cursor.isoformat()
                days.append({"date": key, "segments": day_segments(schedule, key, appointments, practitioner_id)})
                cursor += timedelta(days=1)
        return {"schedule": schedule, "days": days, "onboardingStatus": person.get("onboardingStatus") or "approved", "available": person.get("available") is not False}

    @router.put("/schedules/{practitioner_id}/weekly")
    async def save_weekly(practitioner_id: str, request: Request, payload: dict = Body(...)):
        user = await require(request)
        await _guard(user, practitioner_id)
        try:
            weekly = validate_weekly(payload.get("weekly") or [])
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        known = {row.get("slug") for row in await coll("services").find({}, {"_id": 0, "slug": 1}).to_list(50)}
        for row in weekly:
            unknown = [slug for slug in row.get("services") or [] if slug not in known]
            if unknown:
                raise HTTPException(400, "Limit a weekly interval to a service in the catalogue")
        schedule = await _schedule(practitioner_id) or draft_schedule(practitioner_id)
        proposed = {**schedule, "weekly": weekly}
        appointments = await coll("appointments").find({"practitionerId": practitioner_id}, {"_id": 0}).to_list(500)
        outside = appointment_outside_hours(proposed, appointments)
        if outside and payload.get("resolution") != "keep_appointments":
            raise HTTPException(409, {"detail": "This change covers existing appointments", "conflicts": outside, "resolutionRequired": "keep_appointments"})
        if user.get("role") != "owner":
            proposed["status"] = "pending"
        proposed["acceptingBookings"] = bool(proposed.get("acceptingBookings")) and proposed.get("status") == "approved"
        await db.nt_schedules.replace_one({"practitionerId": practitioner_id}, proposed, upsert=True)
        await add_audit(user["name"], f"Weekly availability updated for {practitioner_id}", None)
        return {"schedule": proposed, "conflictsKept": len(outside)}

    @router.post("/schedules/{practitioner_id}/exceptions")
    async def add_exception(practitioner_id: str, request: Request, payload: dict = Body(...)):
        user = await require(request)
        await _guard(user, practitioner_id)
        kind = payload.get("kind")
        if kind not in BLOCKING_KINDS | {OPEN_KIND}:
            raise HTTPException(400, "Unknown availability change")
        if payload.get("ownerOverride") and user.get("role") != "owner":
            raise HTTPException(403, "Only the owner can authorize a schedule override")
        start_date = str(payload.get("startDate") or "")
        end_date = str(payload.get("endDate") or start_date)
        if len(start_date) != 10 or len(end_date) != 10 or end_date < start_date:
            raise HTTPException(400, "Choose a valid date range")
        schedule = await _schedule(practitioner_id) or draft_schedule(practitioner_id)
        if kind == OPEN_KIND and blocking_cover({**schedule, "exceptions": schedule.get("exceptions") or []}, start_date, minutes(payload.get("start") or "00:00"), minutes(payload.get("end") or "23:59")):
            raise HTTPException(409, "Remove the leave before opening this time")
        appointments = await coll("appointments").find({"practitionerId": practitioner_id}, {"_id": 0}).to_list(500)
        if kind in BLOCKING_KINDS:
            conflicts = conflicts_for_close(appointments, start_date, end_date, payload.get("start"), payload.get("end"))
            if conflicts and payload.get("resolution") != "keep_appointments":
                raise HTTPException(409, {"detail": "This change covers existing appointments", "conflicts": conflicts, "resolutionRequired": "keep_appointments"})
        row = {
            "id": "ex-" + uuid.uuid4().hex[:10],
            "kind": kind,
            "startDate": start_date,
            "endDate": end_date,
            "start": payload.get("start") or "",
            "end": payload.get("end") or "",
            "ownerOverride": bool(payload.get("ownerOverride")) and user.get("role") == "owner",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        schedule.setdefault("exceptions", []).append(row)
        if user.get("role") != "owner" and schedule.get("status") == "approved":
            schedule["status"] = "pending"
            schedule["acceptingBookings"] = False
        await db.nt_schedules.replace_one({"practitionerId": practitioner_id}, schedule, upsert=True)
        await add_audit(user["name"], f"Availability {kind} recorded for {practitioner_id}", None)
        return {"exception": row, "schedule": schedule}

    @router.post("/schedules/{practitioner_id}/pause")
    async def pause(practitioner_id: str, request: Request, payload: dict = Body(...)):
        user = await require(request)
        await _guard(user, practitioner_id)
        schedule = await _schedule(practitioner_id) or draft_schedule(practitioner_id)
        person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0, "onboardingStatus": 1}) or {}
        schedule["acceptingBookings"] = bool(payload.get("acceptingBookings"))
        await db.nt_schedules.replace_one({"practitionerId": practitioner_id}, schedule, upsert=True)
        bookable = (
            schedule["acceptingBookings"]
            and schedule.get("status") == "approved"
            and person.get("onboardingStatus") in (None, "approved")
        )
        await coll("practitioners").update_one({"id": practitioner_id}, {"$set": {"available": bookable, "bookable": bookable}})
        await add_audit(user["name"], f"New bookings {'opened' if schedule['acceptingBookings'] else 'paused'} for {practitioner_id}", None)
        return {"acceptingBookings": schedule["acceptingBookings"], "bookable": bookable}

    @router.get("/onboarding")
    async def onboarding_board(request: Request):
        await require(request, "owner")
        from onboarding import activation_blockers, launch_readiness, load_practitioner_onboarding
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        people = await coll("practitioners").find({}, {"_id": 0, "id": 1}).to_list(50)
        rows = []
        for person in people:
            loaded = await load_practitioner_onboarding(db, coll, person["id"])
            if not loaded:
                continue
            profile = loaded["person"]
            gaps = loaded["gaps"]
            rows.append({
                "practitionerId": profile["id"],
                "name": profile.get("name") or "",
                "onboardingStatus": profile.get("onboardingStatus") or "approved",
                "available": profile.get("available") is True,
                "bookable": profile.get("bookable") is True,
                "gaps": gaps,
                "specialties": profile.get("specialties") or [],
                "activationReady": profile.get("onboardingStatus") in ("invited", "draft", "pending") and not activation_blockers(gaps),
                "accountStatus": (loaded.get("account") or {}).get("status"),
                "activatedAt": profile.get("activatedAt") or "",
                "credentialAttestations": profile.get("credentialAttestations") or {},
            })
        return {"practitioners": rows, "launch": launch_readiness(settings), "mfaEnforced": bool(settings.get("mfaEnforcePrivileged"))}

    @router.put("/practitioners/{practitioner_id}/services")
    async def set_services(practitioner_id: str, request: Request, payload: dict = Body(...)):
        user = await require(request, "owner")
        person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0})
        if not person:
            raise HTTPException(404, "Practitioner not found")
        slugs = payload.get("specialties")
        if not isinstance(slugs, list):
            raise HTTPException(400, "Choose services from the catalogue")
        known = {row.get("slug") for row in await coll("services").find({}, {"_id": 0, "slug": 1}).to_list(200)}
        cleaned = []
        for slug in slugs:
            if slug not in known or slug in cleaned:
                raise HTTPException(400, "Choose services from the catalogue")
            cleaned.append(slug)
        # Disabled and archived treatments may stay on a profile. Booking still rejects them.
        await coll("practitioners").update_one({"id": practitioner_id}, {"$set": {"specialties": cleaned}})
        await add_audit(user["name"], f"Services updated for {practitioner_id}", None)
        return {"specialties": cleaned, "onboardingStatus": person.get("onboardingStatus") or "draft", "available": person.get("available") is True}

    @router.post("/practitioners/{practitioner_id}/onboarding/approve")
    async def approve_onboarding(practitioner_id: str, request: Request, payload: dict = Body(...)):
        """Activate the practitioner profile and open new bookings by default when hours exist."""
        user = await require(request, "owner")
        if payload.get("confirm") is not True:
            raise HTTPException(400, "Confirm that you are approving this practitioner")
        return await _activate_profile(user, practitioner_id)

    @router.post("/practitioners/{practitioner_id}/credential-attestation")
    async def attest_credential(practitioner_id: str, request: Request, payload: dict = Body(...)):
        """Owner note that a credential was seen. Does not open booking; the 14-day grace after approval does."""
        from onboarding import ATTESTABLE_KINDS
        user = await require(request, "owner")
        kind = payload.get("kind")
        if kind not in ATTESTABLE_KINDS:
            raise HTTPException(400, "Choose registration or liability insurance")
        if payload.get("confirm") is not True:
            raise HTTPException(400, "Confirm that you have seen this credential")
        note = " ".join(str(payload.get("note") or "").split())[:300]
        if not await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0, "id": 1}):
            raise HTTPException(404, "Practitioner not found")
        row = {"by": user["name"], "byId": user.get("id"), "at": datetime.now(timezone.utc).isoformat(), "note": note}
        await coll("practitioners").update_one({"id": practitioner_id}, {"$set": {f"credentialAttestations.{kind}": row}})
        await add_audit(user["name"], f"Owner attested {kind} for {practitioner_id} (document not on file)", None)
        saved = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0, "credentialAttestations": 1})
        return {"credentialAttestations": (saved or {}).get("credentialAttestations") or {}}

    @router.delete("/practitioners/{practitioner_id}/credential-attestation/{kind}")
    async def revoke_attestation(practitioner_id: str, kind: str, request: Request):
        from onboarding import ATTESTABLE_KINDS
        user = await require(request, "owner")
        if kind not in ATTESTABLE_KINDS:
            raise HTTPException(400, "Choose registration or liability insurance")
        if not await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0, "id": 1}):
            raise HTTPException(404, "Practitioner not found")
        await coll("practitioners").update_one({"id": practitioner_id}, {"$unset": {f"credentialAttestations.{kind}": ""}})
        await add_audit(user["name"], f"Owner attestation removed: {kind} for {practitioner_id}", None)
        saved = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0, "credentialAttestations": 1})
        return {"credentialAttestations": (saved or {}).get("credentialAttestations") or {}}

    @router.post("/schedules/{practitioner_id}/approve")
    async def approve(practitioner_id: str, request: Request):
        """Approve weekly hours and open new bookings by default. Owner can pause later."""
        user = await require(request, "owner")
        return await _approve_schedule(user, practitioner_id)

    async def _activate_profile(user, practitioner_id):
        from onboarding import activation_blockers, load_practitioner_onboarding
        loaded = await load_practitioner_onboarding(db, coll, practitioner_id)
        if not loaded:
            raise HTTPException(404, "Practitioner not found")
        person = loaded["person"]
        status = person.get("onboardingStatus")
        if status in ("invited", "draft", "pending"):
            blockers = activation_blockers(loaded["gaps"])
            if blockers:
                raise HTTPException(409, {"message": "Link a staff login before activating this profile", "gaps": blockers})
        elif status not in (None, "approved"):
            raise HTTPException(409, "This practitioner cannot be activated from its current status")
        updates = {
            "onboardingStatus": "approved",
            # Owner approval opens booking by default; pause endpoint can close it later.
            "available": True,
            "bookable": True,
        }
        if not person.get("activatedAt"):
            updates["activatedAt"] = datetime.now(timezone.utc).isoformat()
        schedule = dict(loaded.get("schedule") or draft_schedule(practitioner_id))
        opened_bookings = False
        if schedule.get("weekly"):
            schedule["status"] = "approved"
            schedule["acceptingBookings"] = True
            await db.nt_schedules.replace_one({"practitionerId": practitioner_id}, schedule, upsert=True)
            opened_bookings = True
        else:
            # No hours yet — keep acceptingBookings false until schedule approve opens it.
            updates["bookable"] = False
            updates["available"] = False
        await coll("practitioners").update_one({"id": practitioner_id}, {"$set": updates})
        saved = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0})
        from media import sync_practitioner_visibility
        from profiles import profile_media_public
        await sync_practitioner_visibility(db, practitioner_id, profile_media_public({**(saved or person), "onboardingStatus": "approved"}))
        await add_audit(
            user["name"],
            f"Practitioner profile activated: {practitioner_id}" + (" · bookings opened" if opened_bookings else " · bookings wait for weekly hours"),
            None,
        )
        return {
            "onboardingStatus": "approved",
            "available": bool((saved or {}).get("available")),
            "bookable": bool((saved or {}).get("bookable")),
            "acceptingBookings": bool(schedule.get("acceptingBookings")),
            "schedule": schedule,
        }

    async def _approve_schedule(user, practitioner_id):
        from onboarding import load_practitioner_onboarding
        loaded = await load_practitioner_onboarding(db, coll, practitioner_id)
        if not loaded or not loaded.get("schedule"):
            raise HTTPException(404, "Practitioner schedule not found")
        person = loaded["person"]
        schedule = dict(loaded["schedule"])
        if person.get("onboardingStatus") not in (None, "approved"):
            raise HTTPException(409, "Activate the practitioner profile before approving the schedule")
        if not schedule.get("weekly"):
            raise HTTPException(409, "Add weekly hours before approving the schedule")
        schedule["status"] = "approved"
        # Open new bookings by default; owner pauses with /schedules/{id}/pause.
        schedule["acceptingBookings"] = True
        await db.nt_schedules.replace_one({"practitionerId": practitioner_id}, schedule, upsert=True)
        bookable = person.get("onboardingStatus") in (None, "approved")
        await coll("practitioners").update_one(
            {"id": practitioner_id},
            {"$set": {"available": bookable, "bookable": bookable}},
        )
        await add_audit(user["name"], f"Schedule approved for {practitioner_id} · bookings opened", None)
        return {"schedule": schedule, "onboardingStatus": person.get("onboardingStatus") or "approved", "available": bookable, "bookable": bookable, "acceptingBookings": True}

    @router.get("/schedules/{practitioner_id}/route")
    async def daily_route(practitioner_id: str, request: Request, date: str):
        user = await require(request)
        await _guard(user, practitioner_id)
        return await build_route(db, coll, practitioner_id, date, user)

    @router.post("/schedules/{practitioner_id}/route/preview")
    async def route_preview(practitioner_id: str, request: Request, payload: dict = Body(...)):
        """Optional one-shot GPS → appointment preview. Never starts On My Way or stores origin."""
        from fastapi.responses import JSONResponse
        from geo import allow

        user = await require(request)
        await _guard(user, practitioner_id)
        if not isinstance(payload, dict):
            raise HTTPException(400, "Invalid preview request")
        subject = user.get("id") or user.get("subject") or "anon"
        if not allow(_PREVIEW_BUCKET, f"route-preview:{subject}", PREVIEW_LIMIT, window=60):
            raise HTTPException(429, "Route preview is busy. Wait a moment and try again.")
        body = await preview_route_from_origin(
            db, coll, practitioner_id, user,
            payload.get("origin"),
            payload.get("appointmentId"),
        )
        return JSONResponse(body, headers={"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"})

    @router.get("/schedule-overview")
    async def overview(request: Request, date: str):
        user = await require(request, "owner")
        people = await coll("practitioners").find({}, {"_id": 0, "id": 1, "name": 1, "available": 1, "onboardingStatus": 1}).to_list(50)
        rows = []
        for person in people:
            route = await build_route(db, coll, person["id"], date, user, include_address=False)
            rows.append({"practitionerId": person["id"], "name": person["name"], "onboardingStatus": person.get("onboardingStatus") or "approved", **route["summary"]})
        return {"date": date, "practitioners": rows, "notices": opening_notice_status()}

    @router.post("/openings/watch")
    async def watch(request: Request, payload: dict = Body(...)):
        user = await require(request, "client")
        if payload.get("optIn") is not True:
            raise HTTPException(400, "Earlier-appointment notices require an explicit opt-in")
        row = {
            "id": "watch-" + uuid.uuid4().hex[:10],
            "clientId": user["subject"],
            "optIn": True,
            "serviceSlug": payload.get("serviceSlug") or "",
            "duration": int(payload.get("duration") or 60),
            "earliestDate": payload.get("earliestDate") or "",
            "latestDate": payload.get("latestDate") or "",
            "timeFrom": payload.get("timeFrom") or "",
            "timeTo": payload.get("timeTo") or "",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        await db.nt_opening_watches.insert_one(dict(row))
        row.pop("_id", None)
        return {"watch": row, "notices": opening_notice_status()}

    @router.post("/openings/{offer_id}/accept")
    async def accept(offer_id: str, request: Request):
        user = await require(request, "client")
        offer = await db.nt_opening_offers.find_one_and_update(
            {"id": offer_id, "status": "available", "clientId": user["subject"]},
            {"$set": {"status": "claimed", "claimedAt": datetime.now(timezone.utc).isoformat()}},
        )
        if not offer:
            raise HTTPException(409, "That opening is no longer available")
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        person = await coll("practitioners").find_one({"id": offer.get("practitionerId")}, {"_id": 0})
        schedule = await _schedule(offer.get("practitionerId"))
        appointments = await coll("appointments").find({"practitionerId": offer.get("practitionerId"), "date": offer.get("date")}, {"_id": 0}).to_list(100)
        rules = scheduling_rules(settings)
        probe = feasible_slot(
            schedule=schedule, person=person, service={"slug": offer.get("serviceSlug"), "enabled": True, "mobile": True, "specialties": None},
            day=offer["date"], start=minutes(offer["time"]), duration=int(offer["duration"]),
            point=point_of(offer.get("point")), zone=offer.get("zone") or {"name": "mobile"},
            appointments=appointments, rules=rules, drives=lambda a, b: conservative_drive(a, b),
            location_type="home", now=datetime.now(timezone.utc), production=_live(production),
        )
        if not probe["ok"] or not qualified(person, {"slug": offer.get("serviceSlug")}):
            await db.nt_opening_offers.update_one({"id": offer_id}, {"$set": {"status": "expired"}})
            raise HTTPException(409, probe.get("reason") or "That opening is no longer available")
        return {"offerId": offer_id, "status": "claimed", "booked": False, "date": offer["date"], "time": offer["time"], "detail": "The opening is held for you. Complete booking to confirm it. Nothing is booked automatically."}

    return router


def opening_notice_status():
    return {
        "enabled": OUTBOUND_OPENING_NOTICES,
        "reason": "Earlier-appointment messages stay off until a separate opt-in and a secure offer link exist. Marketing consent is not used.",
    }


def _drive_key(origin, dest):
    if not origin or not dest:
        return None
    return (round(origin["lat"], 4), round(origin["lng"], 4), round(dest["lat"], 4), round(dest["lng"], 4))


def _table_drive(table):
    def drives(origin, dest):
        key = _drive_key(origin, dest)
        if key and key in table:
            return table[key]
        return conservative_drive(origin, dest)
    return drives


async def recommend_slots(db, coll, locate_visit, payload, production):
    from pricing import money, zone_travel

    from trial import is_trial_service

    settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
    clinic = settings.get("clinic") or {}
    location = payload.get("locationType") or "home"
    service = await coll("services").find_one({"slug": payload.get("serviceSlug")}, {"_id": 0})
    trial_visit = is_trial_service(service) or bool(payload.get("campaignId"))
    if location == "clinic":
        if trial_visit:
            if not clinic_has_address(clinic):
                raise HTTPException(400, "The clinic address is not ready for trial booking")
        elif clinic.get("enabled") is not True:
            raise HTTPException(400, "In-clinic booking is not available")
    if clinic.get("mobileEnabled") is False and location != "clinic":
        raise HTTPException(400, "Mobile booking is not available")
    duration = payload.get("duration")
    blocked = booking_block_reason(service, duration, location)
    if blocked:
        raise HTTPException(400, blocked)
    duration = int(duration)
    day = str(payload.get("date") or "")
    if len(day) != 10:
        raise HTTPException(400, "Choose a date")
    zones = await coll("zones").find({}, {"_id": 0}).to_list(20)
    if location == "clinic":
        address, zone, km = {"line": clinic.get("address") or ""}, {"name": "Clinic", "fee": 0}, 0
    else:
        address, zone, km = await locate_visit(payload.get("address") or {}, zones, settings)
    zone_label = {"name": zone_name(zone), "id": (zone or {}).get("id")}
    people = await coll("practitioners").find({}, {"_id": 0}).to_list(50)
    if payload.get("practitionerId"):
        people = [person for person in people if person["id"] == payload["practitionerId"]]
    rules = scheduling_rules(settings)
    now = datetime.now(timezone.utc)
    point = point_of(address)
    table = {}

    async def remember(origin, dest):
        key = _drive_key(origin, dest)
        if key and key not in table:
            table[key] = await mapbox_drive(origin, dest)

    checked = []
    for person in people:
        if not qualified(person, service):
            continue
        from profiles import person_booking_block
        credentials = await db.nt_credentials.find({"practitionerId": person["id"]}, {"_id": 0}).to_list(20)
        if person_booking_block(person, service, credentials):
            continue
        schedule = await db.nt_schedules.find_one({"practitionerId": person["id"]}, {"_id": 0})
        if not practitioner_bookable(person, schedule):
            continue
        appointments = await coll("appointments").find({"practitionerId": person["id"], "date": day}, {"_id": 0}).to_list(100)
        # Trial hours follow the practitioner's open week; do not require the trial slug on each weekly row.
        hours_slug = None if trial_visit else service.get("slug")
        for start in candidate_starts(None if location == "clinic" and schedule is None else schedule, day, duration, hours_slug):
            if location != "clinic":
                previous, following = neighbors(appointments, day, start, duration)
                if previous:
                    await remember(point_of(previous.get("address")), point)
                if following:
                    await remember(point, point_of(following.get("address")))
                    if previous:
                        await remember(point_of(previous.get("address")), point_of(following.get("address")))
            probe = feasible_slot(
                schedule=schedule, person=person, service=service, day=day, start=start, duration=duration,
                point=point, zone=zone_label if location != "clinic" else {"name": "Clinic"},
                appointments=appointments, rules=rules, drives=_table_drive(table) if location != "clinic" else (lambda _a, _b: (0, "clinic")),
                location_type="home" if location != "clinic" else "home", now=now, production=production if location != "clinic" else False,
            )
            if location == "clinic" and schedule is not None and not interval_open(schedule, day, start, duration, hours_slug):
                continue
            if probe["ok"]:
                checked.append({**probe, "time": hhmm(start), "practitionerId": person["id"]})
    ordered = rank_slots(checked)
    if not payload.get("practitionerId"):
        for row in ordered:
            row["practitionerId"] = ""
    slots = [public_slot(row) for row in ordered]
    seen = set()
    unique = []
    for row in slots:
        if row["time"] in seen:
            continue
        seen.add(row["time"])
        unique.append(row)
    return {
        "recommendations": unique[:3],
        "slots": unique,
        "travelFee": money(zone_travel(zone, km, "home", settings)) if zone and location != "clinic" else 0,
        "zone": zone_name(zone) if location != "clinic" else "",
    }


async def assert_public_slot(db, coll, *, settings, production, practitioner_id, day, time, duration, address, location_type, service, exclude_id=None, trial=False):
    """Reject a booking that is outside a real opening. Legacy demo data with no schedules is unchanged."""
    from trial import is_trial_service

    clinic = (settings or {}).get("clinic") or {}
    trial_visit = trial or is_trial_service(service)
    if location_type == "clinic":
        if trial_visit:
            if not clinic_has_address(clinic):
                raise HTTPException(400, "The clinic address is not ready for trial booking")
        elif not clinic_is_bookable(clinic):
            raise HTTPException(400, "In-clinic booking is not available")
    if location_type != "clinic" and clinic.get("mobileEnabled") is False:
        raise HTTPException(400, "Mobile booking is not available")
    if location_type == "clinic":
        # Clinic visits still need an open schedule window for the assigned practitioner.
        if not practitioner_id:
            return
        schedule = await db.nt_schedules.find_one({"practitionerId": practitioner_id}, {"_id": 0})
        person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0})
        if not practitioner_bookable(person, schedule):
            raise HTTPException(409, "That practitioner is not available")
        start = minutes(time)
        hours_slug = None if trial_visit else (service or {}).get("slug")
        if schedule is not None and not interval_open(schedule, day, start, int(duration), hours_slug):
            raise HTTPException(409, "That time is not open")
        appointments = await coll("appointments").find({"practitionerId": practitioner_id, "date": day}, {"_id": 0}).to_list(100)
        if overlaps_appointment(appointments, day, start, int(duration), exclude_id):
            raise HTTPException(409, "That time was just booked")
        return
    schedule_count = await db.nt_schedules.count_documents({})
    enforced = adjacent_travel_enforced(settings, production)
    if not production and not schedule_count and not enforced:
        return
    people = await coll("practitioners").find({}, {"_id": 0}).to_list(50)
    if practitioner_id:
        people = [person for person in people if person.get("id") == practitioner_id]
        if not people:
            raise HTTPException(409, "That practitioner is not available")
    rules = scheduling_rules(settings)
    point = point_of(address)
    zone = {"name": "mobile"} if point or not production else None
    start = minutes(time)
    drives = conservative_drive if enforced else (lambda _a, _b: (0, "unchecked"))
    now = datetime.now(timezone.utc)
    for person in people:
        if not qualified(person, service):
            continue
        from profiles import person_booking_block
        credentials = await db.nt_credentials.find({"practitionerId": person["id"]}, {"_id": 0}).to_list(20)
        blocked = person_booking_block(person, service, credentials)
        if blocked:
            if practitioner_id:
                raise HTTPException(409, blocked)
            continue
        schedule = await db.nt_schedules.find_one({"practitionerId": person["id"]}, {"_id": 0})
        if not practitioner_bookable(person, schedule):
            continue
        appointments = await coll("appointments").find({"practitionerId": person["id"], "date": day}, {"_id": 0}).to_list(100)
        probe = feasible_slot(
            schedule=schedule, person=person, service=service, day=day, start=start, duration=int(duration),
            point=point, zone=zone or {"name": "mobile"}, appointments=appointments, rules=rules, drives=drives,
            location_type="home", now=now, production=production or schedule is not None, exclude_id=exclude_id,
        )
        if probe["ok"]:
            return
        if practitioner_id:
            raise HTTPException(409, probe.get("reason") or "That time is not open")
    if practitioner_id or production or schedule_count:
        raise HTTPException(409, "No practitioner is available at that time")


def _route_show_address(user, perms, include_address):
    from rbac import has_role
    if not include_address:
        return False
    if has_role(user, "owner", "practitioner"):
        return True
    return bool((perms or {}).get("viewAddresses"))


def leave_by_minutes(appointment_start_min, drive_min, rules):
    """Recommended departure for a one-shot origin → appointment leg (no prior cleanup)."""
    allowance = int(rules["setupMin"]) + int(rules["travelBufferMin"])
    return int(appointment_start_min) - int(drive_min) - allowance


async def build_route(db, coll, practitioner_id, day, user, include_address=True):
    person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0}) or {}
    schedule = await db.nt_schedules.find_one({"practitionerId": practitioner_id}, {"_id": 0})
    appointments = await coll("appointments").find({"practitionerId": practitioner_id, "date": day}, {"_id": 0}).to_list(100)
    appointments = [row for row in appointments if row.get("status") in BLOCKING_STATUSES]
    appointments.sort(key=lambda row: row["time"])
    settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
    rules = scheduling_rules(settings)
    perms = (settings.get("receptionPerms") or {})
    show_address = _route_show_address(user, perms, include_address)
    stops = []
    travel_total = 0
    warnings = []
    computed_at = datetime.now(timezone.utc).isoformat()
    for index, row in enumerate(appointments):
        leg = None
        location = route_location_type(row)
        nav_type = navigation_location_type(row)
        if index:
            previous = appointments[index - 1]
            origin_point = visit_navigation_point(previous.get("address"), navigation_location_type(previous))
            dest_point = visit_navigation_point(row.get("address"), nav_type)
            detail = await mapbox_leg(origin_point, dest_point)
            prev_end = minutes(appointments[index - 1]["time"]) + int(appointments[index - 1]["duration"])
            depart_ready = prev_end + int(rules["cleanupMin"])
            if detail.get("available") and detail.get("minutes") is not None:
                drive = int(detail["minutes"])
                travel_total += drive
                arrive = depart_ready + drive
                if arrive + int(rules["setupMin"]) + int(rules["travelBufferMin"]) > minutes(row["time"]):
                    warnings.append({"appointmentId": row["id"], "ref": row.get("ref"), "message": "Travel time is tight before this visit"})
                leg = {
                    "available": True,
                    "minutes": drive,
                    "provider": detail["provider"],
                    "km": detail.get("km"),
                    "durationSec": detail.get("durationSec"),
                    "distanceM": detail.get("distanceM"),
                    "geometry": detail.get("geometry"),
                    "route": detail.get("route"),
                    "estimateType": detail.get("estimateType"),
                    "routingProvider": detail.get("routingProvider") or "mapbox",
                    "origin": origin_point,
                    "destination": dest_point,
                    "depart": hhmm(depart_ready),
                    "arrive": hhmm(arrive),
                    "computedAt": computed_at,
                }
            else:
                leg = {
                    "available": False,
                    "minutes": None,
                    "provider": "unavailable",
                    "km": None,
                    "durationSec": None,
                    "distanceM": None,
                    "geometry": None,
                    "route": None,
                    "estimateType": None,
                    "routingProvider": "mapbox",
                    "origin": origin_point,
                    "destination": dest_point,
                    "depart": None,
                    "arrive": None,
                    "message": "Driving ETA unavailable",
                    "computedAt": computed_at,
                }
        address = row.get("address") or {}
        stop = {
            "id": row["id"],
            "ref": row.get("ref"),
            "time": row["time"],
            "duration": int(row["duration"]),
            "status": row.get("status"),
            "serviceSlug": row.get("serviceSlug") or "",
            "area": address.get("zoneName") or "",
        }
        if location is not None:
            stop["locationType"] = location
        point = visit_navigation_point(address, nav_type) if show_address else None
        if show_address and address.get("line"):
            stop["addressLine"] = address.get("line")
        if point:
            stop["position"] = point
            stop["maps"] = f"https://www.google.com/maps/dir/?api=1&destination={point['lat']},{point['lng']}"
        stops.append({"stop": stop, "leg": leg})
    gaps = gap_suggestions(schedule, person, day, appointments, rules, conservative_drive)
    proposal = propose_order(appointments, conservative_drive)
    if proposal:
        proposal["applied"] = False
    booked = sum(int(row["duration"]) for row in appointments)
    return {
        "date": day,
        "timezone": "America/Edmonton",
        "stops": stops,
        "gaps": gaps,
        "warnings": warnings,
        "proposal": proposal,
        "rules": rules,
        "computedAt": computed_at,
        "summary": {
            "bookedMin": booked,
            "travelMin": travel_total,
            "gaps": len(gaps),
            "warnings": len(warnings),
            "acceptingBookings": bool(schedule and schedule.get("acceptingBookings")),
        },
    }


_PREVIEW_BUCKET = {}
PREVIEW_LIMIT = 12


def _finite_origin(raw):
    if not isinstance(raw, dict):
        return None
    try:
        lat = float(raw.get("lat"))
        lng = float(raw.get("lng"))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng):
        return None
    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        return None
    return {"lat": lat, "lng": lng}


async def preview_route_from_origin(db, coll, practitioner_id, user, origin, appointment_id):
    """One-shot road preview. Does not start a trip, mutate status, or persist the origin."""
    settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
    perms = (settings.get("receptionPerms") or {})
    if not _route_show_address(user, perms, True):
        raise HTTPException(403, "Not permitted to preview destinations")
    point = _finite_origin(origin)
    if not point:
        raise HTTPException(400, "A valid origin latitude and longitude are required")
    appt = await coll("appointments").find_one({"id": appointment_id}, {"_id": 0})
    if not appt or appt.get("practitionerId") != practitioner_id:
        raise HTTPException(404, "Appointment not found")
    if appt.get("status") not in BLOCKING_STATUSES:
        raise HTTPException(409, "That appointment is not an active route stop")
    if is_clinic_location(route_location_type(appt)):
        raise HTTPException(409, "Clinic visits are not driving destinations")
    dest = visit_navigation_point(appt.get("address"), navigation_location_type(appt))
    if not dest:
        raise HTTPException(409, "This visit does not have a navigable destination yet")
    rules = scheduling_rules(settings)
    detail = await mapbox_leg(point, dest)
    computed_at = datetime.now(timezone.utc).isoformat()
    base = {
        "appointmentId": appt["id"],
        "ref": appt.get("ref"),
        "date": appt.get("date"),
        "time": appt.get("time"),
        "destination": dest,
        "setupMin": int(rules["setupMin"]),
        "travelBufferMin": int(rules["travelBufferMin"]),
        "computedAt": computed_at,
        "persisted": False,
        "tripStarted": False,
        "sharing": False,
        "statusUnchanged": True,
        "routingProvider": "mapbox",
    }
    if not detail.get("available") or detail.get("minutes") is None:
        return {
            **base,
            "available": False,
            "minutes": None,
            "km": None,
            "durationSec": None,
            "distanceM": None,
            "geometry": None,
            "route": None,
            "provider": "unavailable",
            "estimateType": None,
            "trafficAware": False,
            "trafficNote": "Driving ETA unavailable — Mapbox Directions did not return a road route.",
            "depart": None,
            "arrive": None,
            "message": "Driving ETA unavailable",
        }
    drive = int(detail["minutes"])
    start = minutes(appt["time"])
    leave = leave_by_minutes(start, drive, rules)
    arrive = leave + drive
    traffic = detail["provider"] == "mapbox-traffic"
    return {
        **base,
        "available": True,
        "minutes": drive,
        "km": detail.get("km"),
        "durationSec": detail.get("durationSec"),
        "distanceM": detail.get("distanceM"),
        "geometry": detail.get("geometry"),
        "route": detail.get("route"),
        "provider": detail["provider"],
        "estimateType": detail.get("estimateType"),
        "trafficAware": traffic,
        "trafficNote": (
            "Uses current traffic conditions — not a forecast for a future departure."
            if traffic else
            "Road estimate without live traffic — not a confirmed arrival."
        ),
        "depart": hhmm(max(0, leave)),
        "arrive": hhmm(max(0, arrive)),
    }


async def note_cancellation(db, coll, appt):
    """Open a recovery case for the practitioner. Do not notify or book."""
    from recovery import open_case
    case = await open_case(db, appt)
    return [case] if case else []
