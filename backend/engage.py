"""NabiTouch Engage — thin public corporate-event check-in facade.

Reuses clients + appointments (when ENGAGE_WRITES_ENABLED). Does not create a second
booking engine or clinical database. Screening answers are sealed and never returned
on employer attendance endpoints.

Production notes:
- Prefer path `/engage` on nabitouch.com first; subdomain engage.nabitouch.com needs CORS_ORIGINS.
- Do not use the free trial catalogue for corporate events — use workplace-chair.
- ENGAGE_WRITES_ENABLED stays off until venue geocode + schedule capacity are signed off.
"""
import json
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import _flag, is_production
from fieldcrypto import current_key, open_text, seal

TZ = ZoneInfo("America/Edmonton")
CONSENT_VERSION = "engage-2026-1"
WORKPLACE_CHAIR_SLUG = "workplace-chair"
WORKPLACE_CHAIR_DURATION = 12
HARD_FLAGS = ("unwell", "contagious", "clot")
SCREENING_IDS = ("unwell", "contagious", "clot", "injury", "pregnancy", "allergy")
FOCUS_IDS = ("neck", "shoulders", "upper_back", "lower_back", "arms", "hips")
PRESSURE_IDS = ("light", "medium", "firm")
PHONE_RE = re.compile(r"\D+")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
CHECKIN_RATE_LIMIT = 8
CHECKIN_RATE_WINDOW_SEC = 600
_CHECKIN_HITS = defaultdict(deque)

# Edmonton employer events — same ids as frontend fixtures / Wellness Studio demo.
SEED_EVENTS = [
    {
        "id": "aurora-chair-day",
        "name": "Aurora · Chair massage day",
        "org": "Aurora North Consulting",
        "date": "2026-11-06",
        "timeWindow": "11:00–15:00",
        "place": "Downtown office · Floor 12 lounge",
        "durationMinutes": WORKPLACE_CHAIR_DURATION,
        "bookingDurationMinutes": WORKPLACE_CHAIR_DURATION,
        "serviceLabel": "Workplace chair massage",
        "serviceSlug": WORKPLACE_CHAIR_SLUG,
        "therapist": "Nabitu · RMT (on-site)",
        "seatsTotal": 28,
        "status": "confirmed",
        "venue": {
            "line": "10180 101 St NW, Edmonton, AB T5J 3S4",
            "lat": 53.5436,
            "lng": -113.4938,
            "confidence": "address",
            "clientConfirmed": True,
            "city": "Edmonton",
            "region": "AB",
            "postalCode": "T5J 3S4",
            "country": "CA",
        },
        "slots": [
            {"id": "s-1100", "label": "11:00", "time": "11:00", "capacity": 2},
            {"id": "s-1115", "label": "11:15", "time": "11:15", "capacity": 2},
            {"id": "s-1130", "label": "11:30", "time": "11:30", "capacity": 2},
            {"id": "s-1145", "label": "11:45", "time": "11:45", "capacity": 2},
            {"id": "s-1300", "label": "1:00", "time": "13:00", "capacity": 2},
            {"id": "s-1315", "label": "1:15", "time": "13:15", "capacity": 2},
            {"id": "s-1330", "label": "1:30", "time": "13:30", "capacity": 2},
            {"id": "s-1345", "label": "1:45", "time": "13:45", "capacity": 2},
        ],
    },
    {
        "id": "clearsky-afternoon",
        "name": "ClearSky wellness afternoon",
        "org": "ClearSky Energy Ops",
        "date": "2026-11-14",
        "timeWindow": "13:00–16:00",
        "place": "Sherwood Park HQ · Atrium",
        "durationMinutes": WORKPLACE_CHAIR_DURATION,
        "bookingDurationMinutes": WORKPLACE_CHAIR_DURATION,
        "serviceLabel": "Workplace chair massage",
        "serviceSlug": WORKPLACE_CHAIR_SLUG,
        "therapist": "Nabitu · RMT (on-site)",
        "seatsTotal": 36,
        "status": "confirmed",
        "venue": {
            "line": "201 Grande Blvd, Sherwood Park, AB T8A 0R2",
            "lat": 53.5168,
            "lng": -113.3182,
            "confidence": "address",
            "clientConfirmed": True,
            "city": "Sherwood Park",
            "region": "AB",
            "postalCode": "T8A 0R2",
            "country": "CA",
        },
        "slots": [
            {"id": "c-1300", "label": "1:00", "time": "13:00", "capacity": 3},
            {"id": "c-1315", "label": "1:15", "time": "13:15", "capacity": 3},
            {"id": "c-1330", "label": "1:30", "time": "13:30", "capacity": 3},
            {"id": "c-1445", "label": "2:45", "time": "14:45", "capacity": 2},
            {"id": "c-1500", "label": "3:00", "time": "15:00", "capacity": 3},
            {"id": "c-1515", "label": "3:15", "time": "15:15", "capacity": 3},
        ],
    },
]


def engage_public_enabled():
    """Public Engage read APIs. Default on outside production; production must opt in."""
    return _flag("ENGAGE_PUBLIC_ENABLED", not is_production())


def engage_writes_enabled():
    """When off (default), check-in validates and records a prototype check-in without creating an appointment."""
    return _flag("ENGAGE_WRITES_ENABLED", False)


def workplace_chair_service():
    """Complimentary on-site chair massage — not the consumer free-trial acquisition offer."""
    return {
        "id": WORKPLACE_CHAIR_SLUG,
        "slug": WORKPLACE_CHAIR_SLUG,
        "name": "Workplace chair massage",
        "short": "Short seated massage for corporate wellness events.",
        "description": "Clothed chair or seated massage for workplace wellness days. Neck, shoulders, back, and arms unless otherwise directed.",
        "benefits": ["On-site at the employer venue", "Short sessions for high throughput", "Employer-sponsored / complimentary to the employee"],
        "goals": ["Workplace wellness", "Desk relief", "Team recovery"],
        "prices": {str(WORKPLACE_CHAIR_DURATION): 0},
        "img": "/img/swedish.jpg",
        "mobile": True,
        "clinic": False,
        "enabled": True,
        "taxable": False,
        "kind": "engage",
        "category": "specialty",
        "publication": "published",
        "prep": [
            "Wear comfortable clothing; this is a seated, clothed session.",
            "Tell the therapist about injuries, allergies, or pressure preferences.",
            "Employer sees attendance only — not health screening answers.",
        ],
    }


def allow_checkin_rate(key):
    now = time.time()
    q = _CHECKIN_HITS[key]
    while q and q[0] < now - CHECKIN_RATE_WINDOW_SEC:
        q.popleft()
    if len(q) >= CHECKIN_RATE_LIMIT:
        return False
    q.append(now)
    return True


def client_ip(request: Request):
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded[:80]
    if request.client and request.client.host:
        return str(request.client.host)[:80]
    return "unknown"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def phone_digits(value):
    return PHONE_RE.sub("", str(value or ""))


def clip(value, limit=240):
    return str(value or "").strip()[:limit]


class CheckInBody(BaseModel):
    firstName: str = Field(min_length=1, max_length=80)
    lastName: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=160)
    phone: str = Field(min_length=7, max_length=40)
    slotId: str = Field(min_length=1, max_length=40)
    screening: dict = Field(default_factory=dict)
    focusAreas: List[str] = Field(default_factory=list)
    pressure: str = "medium"
    allergyNote: str = ""
    consentAccepted: bool = False
    consentVersion: str = CONSENT_VERSION
    idempotencyKey: Optional[str] = None
    mode: str = "phone"


def _require_public():
    if not engage_public_enabled():
        raise HTTPException(503, "Engage is not enabled")


async def ensure_workplace_chair_service(db):
    service = workplace_chair_service()
    stamp = now_iso()
    existing = await db.nt_services.find_one({"slug": WORKPLACE_CHAIR_SLUG}, {"_id": 0, "id": 1})
    if existing:
        await db.nt_services.update_one(
            {"slug": WORKPLACE_CHAIR_SLUG},
            {"$set": {
                "prices": service["prices"],
                "publication": "published",
                "enabled": True,
                "archived": False,
                "mobile": True,
                "kind": "engage",
                "updatedAt": stamp,
            }},
        )
        return
    await db.nt_services.insert_one({**service, "createdAt": stamp, "updatedAt": stamp, "version": 1})


async def ensure_engage(db):
    await db.nt_engage_events.create_index("id", unique=True)
    await db.nt_engage_checkins.create_index("id", unique=True)
    await db.nt_engage_checkins.create_index("idempotencyKey", unique=True, sparse=True)
    await db.nt_engage_checkins.create_index([("eventId", 1), ("slotId", 1), ("status", 1)])
    await ensure_workplace_chair_service(db)
    stamp = now_iso()
    for event in SEED_EVENTS:
        row = {**event, "seededAt": stamp, "source": "seed"}
        await db.nt_engage_events.update_one({"id": event["id"]}, {"$setOnInsert": row}, upsert=True)
    # Migrate early seed rows off the consumer free-trial catalogue.
    await db.nt_engage_events.update_many(
        {"source": "seed", "serviceSlug": "ten-minutes-on-us"},
        {"$set": {
            "serviceSlug": WORKPLACE_CHAIR_SLUG,
            "serviceLabel": "Workplace chair massage",
            "bookingDurationMinutes": WORKPLACE_CHAIR_DURATION,
            "durationMinutes": WORKPLACE_CHAIR_DURATION,
        }},
    )


async def engage_readiness(db):
    """Production cutover signals — never secrets."""
    blockers = []
    public_on = engage_public_enabled()
    writes_on = engage_writes_enabled()
    enc = bool(current_key())
    event_count = await db.nt_engage_events.count_documents({})
    service = await db.nt_services.find_one(
        {"slug": WORKPLACE_CHAIR_SLUG, "publication": "published", "enabled": {"$ne": False}},
        {"_id": 0, "slug": 1, "prices": 1},
    )
    service_ready = bool(service and str(WORKPLACE_CHAIR_DURATION) in (service.get("prices") or {}))
    if is_production() and not public_on:
        blockers.append("Set ENGAGE_PUBLIC_ENABLED=true to serve public check-in")
    if writes_on and not public_on:
        blockers.append("ENGAGE_WRITES_ENABLED requires ENGAGE_PUBLIC_ENABLED")
    if writes_on and is_production() and not enc:
        blockers.append("FIELD_ENCRYPTION_KEY required before Engage clinical sealing in production")
    if writes_on and not service_ready:
        blockers.append("workplace-chair service missing or not published")
    if event_count < 1:
        blockers.append("No Engage events seeded")
    return {
        "publicEnabled": public_on,
        "writesEnabled": writes_on,
        "encryptionConfigured": enc,
        "eventCount": event_count,
        "serviceReady": service_ready,
        "serviceSlug": WORKPLACE_CHAIR_SLUG,
        "consentVersion": CONSENT_VERSION,
        "production": is_production(),
        "readyForPublic": public_on and event_count > 0 and not (is_production() and not enc and writes_on),
        "readyForWrites": writes_on and public_on and service_ready and (enc or not is_production()) and not blockers,
        "blockers": blockers,
    }


def public_event_view(event, slot_counts):
    slots = []
    remaining_total = 0
    for slot in event.get("slots") or []:
        used = int(slot_counts.get(slot["id"], 0))
        capacity = int(slot.get("capacity") or 0)
        remaining = max(0, capacity - used)
        remaining_total += remaining
        slots.append({
            "id": slot["id"],
            "label": slot.get("label") or slot.get("time"),
            "time": slot.get("time"),
            "remaining": remaining,
            "capacity": capacity,
        })
    return {
        "id": event["id"],
        "name": event.get("name"),
        "org": event.get("org"),
        "date": event.get("date"),
        "timeWindow": event.get("timeWindow"),
        "place": event.get("place"),
        "durationMinutes": event.get("durationMinutes"),
        "serviceLabel": event.get("serviceLabel"),
        "serviceSlug": event.get("serviceSlug"),
        "therapist": event.get("therapist"),
        "status": event.get("status"),
        "seatsRemaining": remaining_total,
        "slots": slots,
        "writesEnabled": engage_writes_enabled(),
        "consentVersion": CONSENT_VERSION,
    }


def attendance_row(row):
    """Employer-safe projection — never include screening or clinical notes."""
    return {
        "id": row.get("id"),
        "eventId": row.get("eventId"),
        "slotId": row.get("slotId"),
        "slotLabel": row.get("slotLabel"),
        "firstName": row.get("firstName"),
        "lastName": row.get("lastName"),
        "checkInCode": row.get("checkInCode"),
        "status": row.get("status"),
        "privateFollowUp": bool(row.get("privateFollowUp")),
        "appointmentId": row.get("appointmentId"),
        "createdAt": row.get("createdAt"),
        "mode": row.get("writeMode"),
    }


def check_in_code(event_id, first, last, slot_label):
    initials = f"{(first or 'A')[0]}{(last or 'Z')[0]}".upper()
    time_bit = re.sub(r"\D", "", slot_label or "00")[:4] or "0000"
    return f"NT-{(event_id or 'EVT')[:3].upper()}-{initials}{time_bit}"


def validate_screening(screening: dict):
    if not isinstance(screening, dict):
        raise HTTPException(400, "Complete the health screening")
    for qid in SCREENING_IDS:
        val = screening.get(qid)
        if val not in ("yes", "no"):
            raise HTTPException(400, "Answer each health screening question")
    hard = [qid for qid in HARD_FLAGS if screening.get(qid) == "yes"]
    soft = [qid for qid in SCREENING_IDS if qid not in HARD_FLAGS and screening.get(qid) == "yes"]
    return hard, soft


async def slot_usage(db, event_id):
    pipeline = [
        {"$match": {"eventId": event_id, "status": {"$in": ["checked_in", "private_follow_up", "booked"]}}},
        {"$group": {"_id": "$slotId", "n": {"$sum": 1}}},
    ]
    rows = await db.nt_engage_checkins.aggregate(pipeline).to_list(100)
    return {row["_id"]: row["n"] for row in rows if row.get("_id")}


def build_engage_router(db, coll, add_audit, user_from, create_booking=None):
    r = APIRouter(prefix="/api/engage", tags=["engage"])

    async def load_event(event_id: str):
        event = await db.nt_engage_events.find_one({"id": event_id}, {"_id": 0})
        if not event:
            raise HTTPException(404, "Event not found")
        return event

    @r.get("/status")
    async def status():
        return await engage_readiness(db)

    @r.get("/events")
    async def list_events():
        _require_public()
        events = await db.nt_engage_events.find({}, {"_id": 0}).sort("date", 1).to_list(50)
        out = []
        for event in events:
            counts = await slot_usage(db, event["id"])
            out.append(public_event_view(event, counts))
        return {"events": out}

    @r.get("/events/{event_id}")
    async def get_event(event_id: str):
        _require_public()
        event = await load_event(event_id)
        counts = await slot_usage(db, event_id)
        return public_event_view(event, counts)

    @r.post("/events/{event_id}/check-in")
    async def check_in(event_id: str, request: Request, body: CheckInBody = Body(...)):
        _require_public()
        if engage_writes_enabled() and not engage_public_enabled():
            raise HTTPException(503, "Engage writes require public Engage to be enabled")
        ip = client_ip(request)
        email_key = clip(body.email, 160).lower()
        if not allow_checkin_rate(f"{ip}:{email_key}") or not allow_checkin_rate(f"ip:{ip}"):
            raise HTTPException(429, "Too many check-in attempts. Please wait and try again.")
        event = await load_event(event_id)
        email = email_key
        if not EMAIL_RE.match(email):
            raise HTTPException(400, "Enter a valid email address")
        phone = phone_digits(body.phone)
        if len(phone) < 10:
            raise HTTPException(400, "Enter a 10-digit mobile number")
        first = clip(body.firstName, 80)
        last = clip(body.lastName, 80)
        if len(first) < 1 or len(last) < 1:
            raise HTTPException(400, "Enter your name")
        slot = next((s for s in (event.get("slots") or []) if s.get("id") == body.slotId), None)
        if not slot:
            raise HTTPException(400, "Choose an open time slot")
        if body.pressure not in PRESSURE_IDS:
            raise HTTPException(400, "Choose a pressure preference")
        hard, soft = validate_screening(body.screening or {})
        private = bool(hard)
        focuses = [f for f in (body.focusAreas or []) if f in FOCUS_IDS]
        if private:
            # Hard screening stop — record attendance without requiring focus/treatment consent.
            pass
        else:
            if not focuses:
                raise HTTPException(400, "Choose at least one focus area")
            if body.consentAccepted is not True:
                raise HTTPException(400, "Confirm consent to continue")

        if body.idempotencyKey:
            prior = await db.nt_engage_checkins.find_one({"idempotencyKey": body.idempotencyKey}, {"_id": 0})
            if prior:
                return JSONResponse(
                    {
                        "checkIn": attendance_row(prior),
                        "replayed": True,
                        "writesEnabled": engage_writes_enabled(),
                        "message": "Existing check-in returned.",
                    }
                )

        counts = await slot_usage(db, event_id)
        used = int(counts.get(slot["id"], 0))
        capacity = int(slot.get("capacity") or 0)
        if used >= capacity:
            raise HTTPException(409, "That time slot is full")

        code = check_in_code(event_id, first, last, slot.get("label") or slot.get("time"))
        writes_on = engage_writes_enabled()
        if writes_on and is_production() and not current_key():
            raise HTTPException(503, "Engage clinical sealing is not configured for production")
        write_mode = "live" if writes_on else "prototype"
        status = "private_follow_up" if private else ("booked" if write_mode == "live" else "checked_in")
        check_id = "eg-" + uuid.uuid4().hex[:12]
        clinical = {
            "screening": {qid: (body.screening or {}).get(qid) for qid in SCREENING_IDS},
            "focusAreas": focuses,
            "pressure": body.pressure,
            "allergyNote": clip(body.allergyNote, 240) if (body.screening or {}).get("allergy") == "yes" else "",
            "softFlags": soft,
            "hardFlags": hard,
            "consentVersion": clip(body.consentVersion or CONSENT_VERSION, 40),
            "consentAcceptedAt": now_iso(),
        }
        # Attendance fields stay clear; clinical blob is sealed separately (never on employer APIs).
        row = {
            "id": check_id,
            "eventId": event_id,
            "slotId": slot["id"],
            "slotLabel": slot.get("label") or slot.get("time"),
            "slotTime": slot.get("time"),
            "firstName": first,
            "lastName": last,
            "email": email,
            "phone": phone,
            "checkInCode": code,
            "status": status,
            "privateFollowUp": private,
            "appointmentId": None,
            "clientId": None,
            "writeMode": write_mode,
            "deviceMode": clip(body.mode, 20) or "phone",
            "idempotencyKey": clip(body.idempotencyKey, 80) or None,
            "createdAt": now_iso(),
            "clinicalSealed": seal(json.dumps(clinical, separators=(",", ":"))),
        }

        if write_mode == "live" and not private:
            if create_booking is None:
                raise HTTPException(503, "Engage booking is not wired")
            venue = event.get("venue") or {}
            if venue.get("clientConfirmed") is not True:
                raise HTTPException(400, "Event venue is not confirmed for booking")
            idem = body.idempotencyKey or f"engage:{event_id}:{email}:{slot['id']}"
            duration = int(event.get("bookingDurationMinutes") or WORKPLACE_CHAIR_DURATION)
            booking_payload = {
                "source": "online",
                "idempotencyKey": idem,
                "client": {
                    "firstName": first,
                    "lastName": last,
                    "email": email,
                    "phone": phone,
                    "marketingConsent": False,
                    "smsConsent": False,
                },
                "appointment": {
                    "serviceSlug": event.get("serviceSlug") or WORKPLACE_CHAIR_SLUG,
                    "duration": duration,
                    "date": event.get("date"),
                    "time": slot.get("time"),
                    "locationType": "event",
                    "address": venue,
                    "goals": ["workplace wellness"],
                    "focus": focuses,
                    "notes": f"Engage event {event_id}; check-in {code}",
                },
            }
            try:
                result = await create_booking(request, booking_payload)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(502, f"Could not create event booking: {exc}") from exc
            appointment = result.get("appointment") if isinstance(result, dict) else None
            appt_id = (appointment or {}).get("id")
            client_id = result.get("clientId") if isinstance(result, dict) else (appointment or {}).get("clientId")
            row["appointmentId"] = appt_id
            row["clientId"] = client_id
            row["status"] = "booked"
            if appt_id:
                await coll("appointments").update_one(
                    {"id": appt_id},
                    {"$set": {
                        "engageEventId": event_id,
                        "engageCheckInId": check_id,
                        "appointmentKind": "engage_event",
                    }},
                )

        await db.nt_engage_checkins.insert_one(dict(row))
        await add_audit(
            "engage-public",
            f"Engage check-in {check_id} · {event_id} · {slot['id']} · {write_mode}"
            + (" · private follow-up" if private else ""),
            row.get("appointmentId"),
        )

        message = (
            "Private clinical follow-up required. Nothing here is shared with the employer."
            if private
            else (
                "Checked in. Appointment created on the NabiTouch schedule."
                if write_mode == "live"
                else "Checked in (prototype). No appointment was created — ENGAGE_WRITES_ENABLED is off."
            )
        )
        return {
            "checkIn": attendance_row(row),
            "replayed": False,
            "writesEnabled": engage_writes_enabled(),
            "privateFollowUp": private,
            "appointment": {"id": row.get("appointmentId")} if row.get("appointmentId") else None,
            "message": message,
        }

    @r.get("/check-ins/{check_in_id}/precautions")
    async def precautions(check_in_id: str, request: Request):
        """Treating staff only — opens sealed Engage screening. Never for employer attendance."""
        _require_public()
        user = await user_from(request)
        if not user or user.get("role") not in ("owner", "desk", "manager", "practitioner"):
            raise HTTPException(403, "Precautions are limited to treating staff")
        row = await db.nt_engage_checkins.find_one({"id": check_in_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Check-in not found")
        clinical = {}
        sealed = row.get("clinicalSealed")
        if sealed:
            try:
                clinical = json.loads(open_text(sealed))
            except Exception as exc:
                raise HTTPException(503, "Could not open sealed screening") from exc
        await add_audit(
            user.get("name") or user.get("role") or "staff",
            f"Engage precautions viewed {check_in_id}",
            row.get("appointmentId"),
            actor_id=user.get("id"),
        )
        return {
            "checkInId": check_in_id,
            "eventId": row.get("eventId"),
            "appointmentId": row.get("appointmentId"),
            "privateFollowUp": bool(row.get("privateFollowUp")),
            "guest": {"firstName": row.get("firstName"), "lastName": row.get("lastName")},
            "pressure": clinical.get("pressure"),
            "focusAreas": clinical.get("focusAreas") or [],
            "allergyNote": clinical.get("allergyNote") or "",
            "hardFlags": clinical.get("hardFlags") or [],
            "softFlags": clinical.get("softFlags") or [],
            "screening": clinical.get("screening") or {},
            "consentVersion": clinical.get("consentVersion"),
        }

    @r.get("/events/{event_id}/attendance")
    async def attendance(event_id: str, request: Request):
        """Employer / staff roster — never returns screening or clinical fields."""
        _require_public()
        user = await user_from(request)
        if not user or user.get("role") not in ("owner", "desk", "manager", "practitioner"):
            raise HTTPException(403, "Attendance is limited to staff")
        await load_event(event_id)
        rows = await db.nt_engage_checkins.find(
            {"eventId": event_id},
            {"_id": 0, "clinicalSealed": 0, "email": 0, "phone": 0},
        ).sort("createdAt", 1).to_list(500)
        return {
            "eventId": event_id,
            "attendance": [attendance_row(row) for row in rows],
        }

    return r
