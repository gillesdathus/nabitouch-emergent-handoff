"""Client preparation guidance from approved, structured rules, plus the readiness checklist saved on the appointment."""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

MANDATORY = [
    "Your therapist needs a clean, quiet, safe and accessible space to provide your massage.",
    "Prepare the treatment area before arrival: clear furniture and obstacles, and leave enough room to move safely around the massage table.",
    "Keep pathways and entrances unobstructed.",
    "Provide a quiet environment with minimal interruptions.",
    "Secure pets away from the treatment area.",
    "Ensure adequate lighting, ventilation and a comfortable temperature.",
    "Give accurate access instructions and arrange parking or building entry when needed.",
    "Tell us about accessibility needs in advance.",
]
NOT_RESPONSIBLE = "Nabitouch practitioners are not responsible for cleaning, rearranging furniture, moving heavy objects or clearing your space."
LOCATION_RULES = {
    "hotel": ["Let the front desk know a therapist is visiting, and share your room number in the access notes."],
    "office": ["Book a private room where the session will not be interrupted."],
    "event": ["Confirm the event contact and the exact setup area with Nabitouch in advance."],
}
CHECKLIST = [
    ("space", "Treatment space is ready"),
    ("paths", "Pathways and entrance are clear"),
    ("pets", "Pets are secured away from the area"),
    ("entry", "Entry and parking instructions are accurate"),
    ("safe", "The environment is safe and quiet"),
    ("service", "Service-specific items are ready"),
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def preparation(appt, service, client):
    mobile = appt.get("locationType") != "clinic"
    sections = []
    if mobile:
        sections.append({"id": "space", "title": "Your space", "items": MANDATORY, "note": NOT_RESPONSIBLE})
    loc = LOCATION_RULES.get(appt.get("locationType") or "")
    if loc:
        sections.append({"id": "location", "title": "Your location", "items": loc})
    hour = int(str(appt.get("time") or "12:00")[:2] or 12)
    timing = ["Have a light meal at least an hour before, and drink water."]
    if hour >= 18:
        timing.append("Evening visit: make sure the entrance and the path to your door are well lit.")
    if hour < 9:
        timing.append("Early visit: please be ready a few minutes before the start time.")
    sections.append({"id": "timing", "title": "Before your appointment", "items": timing})
    prep = [str(x) for x in (service or {}).get("prep") or []][:6]
    if prep:
        sections.append({"id": "service", "title": f"For your {(service or {}).get('name') or 'treatment'}", "items": prep})
    access = ((appt.get("address") or {}).get("notes") or "").strip()
    sections.append({"id": "access", "title": "Access on file", "items": [access] if access else ["No access notes yet. Add entry, buzzer or parking details so your therapist can find you."]})
    return {"sections": sections, "mobile": mobile, "checklist": [{"key": k, "label": l} for k, l in CHECKLIST],
            "readiness": appt.get("readiness") or None, "disclaimer": "Your confirmation does not replace your therapist's on-site safety check."}


def build_readiness_router(db, coll, user_from, add_audit):
    r = APIRouter(prefix="/api/appointments")

    async def load(aid, request, roles):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        role = user["role"]
        allowed = (role == "client" and appt.get("clientId") == user.get("subject")) or (role == "practitioner" and appt.get("practitionerId") == user.get("subject")) or role in ("owner", "desk")
        if role not in roles or not allowed:
            raise HTTPException(404, "Appointment not found")
        return user, appt

    @r.get("/{aid}/preparation")
    async def get_preparation(aid: str, request: Request):
        user, appt = await load(aid, request, ("client", "practitioner", "owner", "desk"))
        service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, {"_id": 0, "name": 1, "prep": 1})
        out = preparation(appt, service, None)
        if user["role"] == "practitioner":
            out["sections"] = [s for s in out["sections"] if s["id"] in ("access", "location")]
        return out

    @r.put("/{aid}/readiness")
    async def put_readiness(aid: str, request: Request):
        user, appt = await load(aid, request, ("client",))
        if appt.get("status") in ("completed", "closed", "cancelled", "no_show", "in_session"):
            raise HTTPException(409, "Readiness can be updated before the visit only")
        body = await request.json()
        items = {k: bool((body.get("items") or {}).get(k)) for k, _ in CHECKLIST}
        stamp = now_iso()
        prior = appt.get("readiness") or {}
        readiness = {"items": items, "allReady": all(items.values()), "updatedAt": stamp, "confirmedAt": stamp if all(items.values()) else prior.get("confirmedAt") if all(items.values()) else None}
        await coll("appointments").update_one({"id": aid}, {"$set": {"readiness": readiness}})
        await add_audit("Client", f"Readiness {'confirmed' if readiness['allReady'] else 'updated'} for {appt.get('ref')}", aid)
        return readiness

    return r
