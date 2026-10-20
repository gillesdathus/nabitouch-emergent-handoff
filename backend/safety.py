"""Practitioner safety: check-in/out, unsafe-space reports, assistance alerts and the 911 control log. Nothing here dispatches emergency services."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument

from devices import notify

INCIDENT_KINDS = ("obstructed", "unsafe", "unhygienic", "unsuitable", "other")
ACTIONS = ("request_fix", "cannot_proceed")
CHECKIN_FROM = ("en_route", "arrived", "in_session", "interrupted")
CHECKOUT_FROM = ("in_session", "session_ended", "soap_pending", "soap_completed", "leaving", "completed", "processing", "interrupted", "safety_hold", "cancelled")
HOLD_FROM = ("en_route", "arrived", "in_session", "interrupted")
RESOLVE_TO = {"resume": "arrived", "resume_session": "in_session", "leave": "leaving", "cancel": "cancelled"}
ASSIST_LABEL = "In-app assistance alert to Nabitouch managers. This is not emergency dispatch. Call 911 in an emergency."


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_safety(db):
    await db.nt_safety_events.create_index("id", unique=True)
    await db.nt_safety_events.create_index([("appointmentId", 1), ("at", 1)])
    await db.nt_safety_events.create_index([("status", 1), ("at", -1)])


def build_safety_router(db, coll, add_audit, user_from, apply_transition):
    r = APIRouter(prefix="/api")

    async def managers():
        row = await db.nt_settings.find_one({"id": "app"}, {"_id": 0, "safetyManagers": 1}) or {}
        return list(row.get("safetyManagers") or [])

    async def viewer(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def is_manager(user):
        return user["role"] == "owner" or user.get("id") in await managers()

    async def manager(request):
        user = await viewer(request)
        if not await is_manager(user):
            raise HTTPException(403, "Safety events are limited to the owner and safety managers")
        return user

    async def own_visit(aid, request):
        user = await viewer(request)
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        if user["role"] == "practitioner" and appt.get("practitionerId") == user.get("subject"):
            return user, appt
        if user["role"] == "owner" and appt.get("practitionerId") == user.get("subject"):
            return user, appt
        raise HTTPException(403, "Only the assigned practitioner can do this")

    async def body_of(request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        return data if isinstance(data, dict) else {}

    async def record(appt, user, kind, **extra):
        alert = kind in ("assist", "incident")
        row = {"id": "se-" + uuid.uuid4().hex[:12], "appointmentId": appt["id"], "ref": appt.get("ref"), "practitionerId": appt.get("practitionerId"),
               "practitionerName": user.get("name"), "kind": kind, "at": now_iso(), "status": "open" if alert else "logged", "alert": alert,
               "recipients": ["owner", *await managers()] if alert else [], "acks": [], **extra}
        await db.nt_safety_events.insert_one(dict(row))
        row.pop("_id", None)
        if alert:
            await notify(db, "safety_alert", row["id"], appt, who=user.get("name") or "A practitioner")
        await add_audit(user.get("name") or "Practitioner", f"Safety: {appt.get('ref')} {kind.replace('_', ' ')}{(' · ' + extra['incidentKind']) if extra.get('incidentKind') else ''}", appt["id"])
        return row

    def public(row):
        return {k: v for k, v in row.items() if k != "recipients"}

    @r.get("/appointments/{aid}/safety")
    async def visit_safety(aid: str, request: Request):
        user = await viewer(request)
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0, "practitionerId": 1, "safety": 1})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        if not (appt.get("practitionerId") == user.get("subject") and user["role"] in ("practitioner", "owner")) and not await is_manager(user):
            raise HTTPException(403, "Not permitted")
        rows = await db.nt_safety_events.find({"appointmentId": aid}, {"_id": 0}).sort("at", 1).to_list(100)
        return {"safety": appt.get("safety") or {}, "events": [public(x) for x in rows], "assistLabel": ASSIST_LABEL, "incidentKinds": list(INCIDENT_KINDS)}

    @r.post("/appointments/{aid}/safety/{step}")
    async def check(aid: str, step: str, request: Request):
        if step not in ("checkin", "checkout"):
            raise HTTPException(404, "Unknown safety step")
        user, appt = await own_visit(aid, request)
        allowed = CHECKIN_FROM if step == "checkin" else CHECKOUT_FROM
        if appt.get("status") not in allowed:
            raise HTTPException(409, "Check in when you arrive, and check out after the session" if step == "checkin" else "Check out once the session has ended")
        safety = appt.get("safety") or {}
        if step == "checkout" and not safety.get("checkinAt"):
            raise HTTPException(409, "Check in first")
        field = "checkinAt" if step == "checkin" else "checkoutAt"
        if safety.get(field):
            return {"safety": safety}
        safety = {**safety, field: now_iso()}
        await coll("appointments").update_one({"id": aid}, {"$set": {"safety": safety}})
        await record(appt, user, step)
        return {"safety": safety}

    @r.post("/appointments/{aid}/incidents")
    async def incident(aid: str, request: Request):
        user, appt = await own_visit(aid, request)
        body = await body_of(request)
        kind, action = body.get("kind"), body.get("action")
        note = str(body.get("note") or "").strip()[:500]
        if kind not in INCIDENT_KINDS or action not in ACTIONS:
            raise HTTPException(400, "Choose what is wrong and what you need")
        if kind == "other" and not note:
            raise HTTPException(400, "Describe the issue")
        if action == "cannot_proceed" and appt.get("status") not in HOLD_FROM:
            raise HTTPException(409, "A visit can be put on safety hold while you are en route, on site or in session")
        row = await record(appt, user, "incident", incidentKind=kind, action=action, note=note, priorStatus=appt.get("status"))
        saved = appt
        if action == "cannot_proceed":
            saved = await apply_transition(appt, "safety_hold", user.get("name") or "Practitioner", f"Safety hold: {kind}")
            await coll("appointments").update_one({"id": aid}, {"$set": {"safety": {**(appt.get("safety") or {}), "holdAt": now_iso(), "holdEventId": row["id"], "penalty": "none_pending_owner_review"}}})
        return {"event": public(row), "status": saved.get("status")}

    @r.post("/appointments/{aid}/assist")
    async def assist(aid: str, request: Request):
        user, appt = await own_visit(aid, request)
        note = str((await body_of(request)).get("note") or "").strip()[:300]
        last_known = None
        try:
            from tracking_store import TrackingUnavailable, read_fix
            fix = await read_fix(aid)
            if fix and "lat" in fix:
                last_known = {"lat": fix["lat"], "lng": fix["lng"], "at": fix.get("serverTime"), "accuracy": fix.get("accuracy")}
        except Exception:
            last_known = None
        row = await record(appt, user, "assist", note=note, label=ASSIST_LABEL, lastKnown=last_known, dispatch=False)
        return {"event": public(row), "label": ASSIST_LABEL, "dispatch": False, "lastKnown": last_known}

    @r.post("/appointments/{aid}/emergency-call")
    async def emergency_call(aid: str, request: Request):
        user, appt = await own_visit(aid, request)
        row = await record(appt, user, "emergency_call_opened", note="Phone dialer opened for 911. No location or health data was sent by Nabitouch.")
        return {"event": public(row), "sent": False}

    @r.get("/safety/events")
    async def events(request: Request, status: str = ""):
        await manager(request)
        query = {"alert": True}
        if status:
            query["status"] = status
        rows = await db.nt_safety_events.find(query, {"_id": 0}).sort("at", -1).to_list(200)
        open_count = await db.nt_safety_events.count_documents({"alert": True, "status": "open"})
        return {"events": [public(x) for x in rows], "open": open_count, "assistLabel": ASSIST_LABEL}

    @r.post("/safety/events/{eid}/ack")
    async def ack(eid: str, request: Request):
        user = await manager(request)
        saved = await db.nt_safety_events.find_one_and_update({"id": eid, "alert": True, "status": {"$ne": "resolved"}}, {"$set": {"status": "acknowledged"}, "$push": {"acks": {"by": user.get("name"), "at": now_iso()}}},
                                                              return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if not saved:
            raise HTTPException(404, "Safety event not found")
        await add_audit(user.get("name") or "manager", f"Safety alert {saved.get('ref')} acknowledged", saved["appointmentId"])
        return public(saved)

    @r.post("/safety/events/{eid}/resolve")
    async def resolve(eid: str, request: Request):
        user = await manager(request)
        body = await body_of(request)
        note = str(body.get("note") or "").strip()[:300]
        outcome = body.get("outcome")
        row = await db.nt_safety_events.find_one({"id": eid, "alert": True}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Safety event not found")
        appt = await coll("appointments").find_one({"id": row["appointmentId"]}, {"_id": 0})
        if appt and appt.get("status") == "safety_hold":
            if outcome not in RESOLVE_TO:
                raise HTTPException(400, "Choose how the visit continues")
            await apply_transition(appt, RESOLVE_TO[outcome], user.get("name") or "manager", note or f"Safety hold resolved: {outcome}")
        done = {"status": "resolved", "resolvedAt": now_iso(), "resolvedBy": user.get("name"), "resolution": note, "outcome": outcome}
        saved = await db.nt_safety_events.find_one_and_update({"id": eid}, {"$set": done}, return_document=ReturnDocument.AFTER, projection={"_id": 0})
        if appt and appt.get("status") == "safety_hold":
            await db.nt_safety_events.update_many({"appointmentId": row["appointmentId"], "alert": True, "status": {"$ne": "resolved"}, "id": {"$ne": eid}},
                                                  {"$set": {**done, "resolution": f"Closed with {row.get('ref')} safety hold" + (f": {note}" if note else "")}})
        await add_audit(user.get("name") or "manager", f"Safety alert {row.get('ref')} resolved{(' · ' + outcome) if outcome else ''}", row["appointmentId"])
        return public(saved)

    @r.get("/safety/managers")
    async def get_managers(request: Request):
        user = await viewer(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can manage safety managers")
        staff = await db.nt_users.find({"role": {"$in": ["desk", "practitioner"]}}, {"_id": 0, "id": 1, "name": 1, "role": 1, "email": 1}).to_list(200)
        return {"managers": await managers(), "staff": staff}

    @r.put("/safety/managers")
    async def put_managers(request: Request):
        user = await viewer(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner can manage safety managers")
        ids = (await body_of(request)).get("managers") or []
        valid = {u["id"] for u in await db.nt_users.find({"id": {"$in": ids}, "role": {"$in": ["desk", "practitioner"]}}, {"_id": 0, "id": 1}).to_list(200)}
        await db.nt_settings.update_one({"id": "app"}, {"$set": {"safetyManagers": sorted(valid)}}, upsert=True)
        await add_audit(user.get("name") or "owner", f"Safety managers updated ({len(valid)})")
        return {"managers": sorted(valid)}

    @r.get("/safety/me")
    async def me(request: Request):
        user = await viewer(request)
        mgr = await is_manager(user)
        return {"manager": mgr, "open": await db.nt_safety_events.count_documents({"alert": True, "status": "open"}) if mgr else 0}

    return r
