"""Smart session timer: backend-authoritative treatment and cleanup timing, next-booking risk, ops visibility and turnaround reporting."""
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

from availability import TZ, cleanup_minutes, local_date_time, mapbox_drive, point_of, scheduling_rules, turnaround_config, validate_turnaround

NEXT_STATUSES = ("confirmed", "assigned", "preparing")
CHECKLIST = ("linens", "sanitize", "oils", "equipment", "hands", "packed")
STATES = ("on_schedule", "preparation_required", "departure_soon", "at_risk", "running_late")
_TRAVEL = {}


def now_utc():
    return datetime.now(timezone.utc)


def _iso(value):
    return value.isoformat() if value else None


def _parse(value):
    return datetime.fromisoformat(value) if value else None


def _mins(delta):
    return round(delta.total_seconds() / 60, 1)


def scheduled_start(appt):
    try:
        return local_date_time(appt["date"], appt["time"]).astimezone(timezone.utc)
    except (KeyError, ValueError):
        return None


def treatment_ms(appt, at):
    session = appt.get("session") or {}
    started = _parse(session.get("startedAt") or (appt.get("timestamps") or {}).get("in_session"))
    if not started:
        return 0
    end = _parse(session.get("endedAt")) or at
    timer = appt.get("timer") or {}
    paused = float(timer.get("pausedMs") or 0)
    if timer.get("pausedAt") and not session.get("endedAt"):
        paused += max(0, (at - _parse(timer["pausedAt"])).total_seconds() * 1000)
    return max(0, (end - started).total_seconds() * 1000 - paused)


async def resolve_cleanup(coll, appt):
    settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
    return cleanup_minutes(turnaround_config(settings), appt.get("serviceSlug"), appt.get("practitionerId"), appt.get("locationType"), appt.get("cleanupMin"))


async def assert_no_active_session(coll, appt):
    other = await coll("appointments").find_one(
        {"practitionerId": appt.get("practitionerId"), "id": {"$ne": appt["id"]}, "status": "in_session"}, {"_id": 0, "ref": 1})
    if other:
        raise HTTPException(409, f"Session {other.get('ref')} is still in progress. End it before starting another.")


async def session_start_update(appt, ts):
    start = _parse(ts)
    planned = scheduled_start(appt)
    booked = int(appt.get("duration") or 0)
    return {"session": {
        "startedAt": ts, "bookedMin": booked, "scheduledEndAt": _iso(start + timedelta(minutes=booked)),
        "scheduledStartAt": _iso(planned), "startDelayMin": _mins(start - planned) if planned else None, "endedAt": None,
    }}


async def session_end_update(coll, appt, ts):
    at = _parse(ts)
    session = dict(appt.get("session") or {})
    if not session.get("startedAt"):
        session["startedAt"] = (appt.get("timestamps") or {}).get("in_session") or ts
        session["bookedMin"] = int(appt.get("duration") or 0)
    actual = treatment_ms({**appt, "session": {**session, "endedAt": None}}, at) / 60000
    session.update({"endedAt": ts, "actualMin": round(actual, 1), "overtimeMin": round(max(0, actual - session["bookedMin"]), 1),
                    "earlyMin": round(max(0, session["bookedMin"] - actual), 1)})
    minutes, source = await resolve_cleanup(coll, appt)
    cleanup = {"startedAt": ts, "bufferMin": minutes, "source": source, "dueAt": _iso(at + timedelta(minutes=minutes)), "completedAt": None}
    return {"session": session, "cleanup": cleanup, "opsStatus": "cleanup_in_progress",
            "timer": {**(appt.get("timer") or {}), "pausedAt": None}}


async def travel_minutes(origin, dest, key):
    """Mapbox road time only. Anything else is reported as unavailable, never estimated."""
    if not origin or not dest:
        return None, "unavailable"
    hit = _TRAVEL.get(key)
    if hit and time.monotonic() - hit[2] < 300:
        return hit[0], hit[1]
    minutes, provider = await mapbox_drive(origin, dest)
    result = (minutes, provider) if provider in ("mapbox", "mapbox-traffic", "same-stop") else (None, "unavailable")
    _TRAVEL[key] = (*result, time.monotonic())
    return result


async def next_booking(coll, appt):
    if not appt.get("practitionerId"):
        return None
    mine = scheduled_start(appt)
    rows = await coll("appointments").find(
        {"practitionerId": appt["practitionerId"], "date": appt.get("date"), "status": {"$in": list(NEXT_STATUSES)}, "id": {"$ne": appt["id"]}},
        {"_id": 0}).to_list(50)
    later = [(scheduled_start(row), row) for row in rows]
    later = [pair for pair in later if pair[0] and mine and pair[0] > mine]
    later.sort(key=lambda pair: pair[0])
    return later[0] if later else None


async def snapshot(coll, appt, at=None):
    at = at or now_utc()
    settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
    rules = scheduling_rules(settings)
    config = rules["turnaround"]
    session = appt.get("session") or {}
    started = session.get("startedAt") or (appt.get("timestamps") or {}).get("in_session")
    booked = int(session.get("bookedMin") or appt.get("duration") or 0)
    elapsed = treatment_ms(appt, at)
    timer = appt.get("timer") or {}
    treatment = None
    if started:
        treatment = {
            "startedAt": started, "bookedMin": booked, "elapsedSec": round(elapsed / 1000),
            "remainingSec": round(booked * 60 - elapsed / 1000), "overtime": elapsed / 1000 > booked * 60,
            "paused": bool(timer.get("pausedAt")) and not session.get("endedAt"), "pausedAt": timer.get("pausedAt"),
            "pausedMs": float(timer.get("pausedMs") or 0), "endedAt": session.get("endedAt"), "actualMin": session.get("actualMin"),
            "overtimeMin": session.get("overtimeMin"), "scheduledStartAt": session.get("scheduledStartAt") or _iso(scheduled_start(appt)),
            "startDelayMin": session.get("startDelayMin"), "scheduledEndAt": session.get("scheduledEndAt"),
        }
    cleanup = appt.get("cleanup")
    cleanup_view = None
    if cleanup:
        due = _parse(cleanup["dueAt"])
        done = _parse(cleanup.get("completedAt"))
        cleanup_view = {**cleanup, "remainingSec": round((due - (done or at)).total_seconds()),
                        "elapsedSec": round(((done or at) - _parse(cleanup["startedAt"])).total_seconds())}
    planned_min, planned_source = cleanup_minutes(config, appt.get("serviceSlug"), appt.get("practitionerId"), appt.get("locationType"), appt.get("cleanupMin"))
    pair = await next_booking(coll, appt)
    nxt = None
    state = None
    if pair:
        start_at, row = pair
        setup = int(rules["setupMin"])
        mobile = row.get("locationType") != "clinic"
        travel, provider = (0, "same-location")
        if mobile:
            travel, provider = await travel_minutes(point_of(appt.get("address")), point_of(row.get("address")), (appt["id"], row["id"]))
        if cleanup and cleanup.get("completedAt"):
            ready_at = at
        elif cleanup:
            ready_at = max(at, _parse(cleanup["dueAt"]))
        elif started:
            remaining = max(0, booked * 60 - elapsed / 1000)
            ready_at = at + timedelta(seconds=remaining) + timedelta(minutes=planned_min)
        else:
            base = scheduled_start(appt) or at
            ready_at = max(at, base) + timedelta(minutes=int(appt.get("duration") or 0) + planned_min)
        depart_by = start_at - timedelta(minutes=setup + (travel or 0))
        slack = _mins(depart_by - ready_at)
        ready = bool(cleanup and cleanup.get("completedAt"))
        if at > depart_by:
            state = "running_late"
        elif slack < 0:
            state = "at_risk"
        elif ready and _mins(depart_by - at) <= config["departureSoonMin"]:
            state = "departure_soon"
        elif not ready and slack <= 20:
            state = "preparation_required"
        else:
            state = "on_schedule"
        nxt = {
            "id": row["id"], "ref": row.get("ref"), "date": row.get("date"), "time": row.get("time"), "startAt": _iso(start_at),
            "duration": row.get("duration"), "serviceSlug": row.get("serviceSlug"), "clientId": row.get("clientId"),
            "locationType": row.get("locationType") or "home", "addressLine": (row.get("address") or {}).get("line") or "",
            "setupMin": setup, "travelMin": travel, "travelProvider": provider, "travelKnown": travel is not None,
            "departBy": _iso(depart_by), "readyAt": _iso(ready_at), "bufferMin": slack, "state": state,
        }
    return {
        "serverNow": _iso(at), "appointmentId": appt["id"], "ref": appt.get("ref"), "status": appt.get("status"),
        "opsStatus": appt.get("opsStatus"), "treatment": treatment, "cleanup": cleanup_view,
        "plannedCleanup": {"minutes": planned_min, "source": planned_source}, "checklist": list(CHECKLIST), "next": nxt, "state": state,
    }


def ops_state(appt, at):
    status = appt.get("status")
    if status == "in_session":
        session = appt.get("session") or {}
        booked = int(session.get("bookedMin") or appt.get("duration") or 0)
        return "treatment_overtime" if treatment_ms(appt, at) / 60000 > booked else "in_session"
    if status in ("interrupted", "safety_hold"):
        return "interrupted"
    cleanup = appt.get("cleanup") or {}
    if cleanup and not cleanup.get("completedAt"):
        return "cleanup_in_progress"
    if status == "en_route":
        return "running_late" if (appt.get("delayMin") or 0) > 0 else "traveling"
    if cleanup.get("completedAt") and status not in ("closed",):
        return "ready_next"
    return None


def build_turnaround_router(db, coll, add_audit, user_from, reception_perms):
    r = APIRouter(prefix="/api")

    async def viewer(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def own_visit(request, appt_id, staff=False):
        user = await viewer(request)
        appt = await coll("appointments").find_one({"id": appt_id}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        if user["role"] == "owner":
            return user, appt
        if user["role"] == "practitioner" and appt.get("practitionerId") == user.get("subject"):
            return user, appt
        if staff and user["role"] == "desk":
            return user, appt
        raise HTTPException(403, "Limited to the assigned practitioner")

    def replayed(appt, op_id):
        return bool(op_id) and op_id in (appt.get("opIds") or [])

    async def save(appt, upd, op_id, event=None):
        query = {"$set": upd}
        if op_id:
            query["$push"] = {"opIds": {"$each": [op_id], "$slice": -40}}
        if event:
            query.setdefault("$push", {})["events"] = event
        await coll("appointments").update_one({"id": appt["id"]}, query)
        return await coll("appointments").find_one({"id": appt["id"]}, {"_id": 0})

    async def raise_alert(appt, snap):
        nxt = snap.get("next")
        if not nxt or nxt["state"] not in ("at_risk", "running_late"):
            return
        key = f"{appt['id']}:{nxt['id']}:{nxt['state']}"
        if await db.nt_ops_alerts.find_one({"dedupeKey": key}, {"_id": 1}):
            return
        await db.nt_ops_alerts.insert_one({
            "id": "opa-" + uuid.uuid4().hex[:12], "dedupeKey": key, "kind": nxt["state"], "appointmentId": appt["id"], "ref": appt.get("ref"),
            "nextAppointmentId": nxt["id"], "nextRef": nxt.get("ref"), "practitionerId": appt.get("practitionerId"),
            "bufferMin": nxt["bufferMin"], "at": now_utc().isoformat(), "status": "open", "note": None,
        })

    @r.get("/appointments/{appt_id}/turnaround")
    async def read(appt_id: str, request: Request):
        _user, appt = await own_visit(request, appt_id)
        snap = await snapshot(coll, appt)
        await raise_alert(appt, snap)
        return snap

    @r.post("/appointments/{appt_id}/session/pause")
    async def pause(appt_id: str, request: Request):
        user, appt = await own_visit(request, appt_id)
        body = await request.json()
        if replayed(appt, body.get("opId")):
            return await snapshot(coll, appt)
        if appt.get("status") != "in_session":
            raise HTTPException(409, "Only an active treatment can be paused")
        if (appt.get("timer") or {}).get("pausedAt"):
            return await snapshot(coll, appt)
        reason = str(body.get("reason") or "").strip()[:160]
        if len(reason) < 3:
            raise HTTPException(400, "Record why the treatment is paused")
        ts = now_utc().isoformat()
        appt = await save(appt, {"timer": {**(appt.get("timer") or {}), "pausedAt": ts}}, body.get("opId"),
                          {"status": "paused", "at": ts, "actor": user.get("name"), "note": reason})
        await add_audit(user.get("name"), f"{appt.get('ref')} treatment paused · {reason}", appt_id)
        return await snapshot(coll, appt)

    @r.post("/appointments/{appt_id}/session/resume")
    async def resume(appt_id: str, request: Request):
        user, appt = await own_visit(request, appt_id)
        body = await request.json()
        timer = appt.get("timer") or {}
        if replayed(appt, body.get("opId")) or not timer.get("pausedAt"):
            return await snapshot(coll, appt)
        if appt.get("status") != "in_session":
            raise HTTPException(409, "Only an active treatment can be resumed")
        at = now_utc()
        gap = (at - _parse(timer["pausedAt"])).total_seconds() * 1000
        appt = await save(appt, {"timer": {"pausedMs": float(timer.get("pausedMs") or 0) + gap, "pausedAt": None}}, body.get("opId"),
                          {"status": "resumed", "at": at.isoformat(), "actor": user.get("name"), "note": None})
        await add_audit(user.get("name"), f"{appt.get('ref')} treatment resumed", appt_id)
        return await snapshot(coll, appt)

    @r.post("/appointments/{appt_id}/turnaround/ready")
    async def ready(appt_id: str, request: Request):
        user, appt = await own_visit(request, appt_id)
        body = await request.json()
        cleanup = appt.get("cleanup")
        if not cleanup:
            raise HTTPException(409, "Cleanup starts when treatment ends")
        if cleanup.get("completedAt") or replayed(appt, body.get("opId")):
            return await snapshot(coll, appt)
        checklist = [item for item in (body.get("checklist") or []) if item in CHECKLIST]
        at = now_utc()
        actual = _mins(at - _parse(cleanup["startedAt"]))
        done = {**cleanup, "completedAt": at.isoformat(), "actualMin": actual, "overrunMin": round(max(0, actual - cleanup["bufferMin"]), 1),
                "checklist": checklist, "completedBy": user.get("name")}
        appt = await save(appt, {"cleanup": done, "opsStatus": "ready_next"}, body.get("opId"),
                          {"status": "ready_next", "at": at.isoformat(), "actor": user.get("name"), "note": f"Cleanup {actual} min"})
        await add_audit(user.get("name"), f"{appt.get('ref')} ready for next appointment · cleanup {actual} min", appt_id)
        return await snapshot(coll, appt)

    @r.post("/appointments/{appt_id}/turnaround/escalate")
    async def escalate(appt_id: str, request: Request):
        user, appt = await own_visit(request, appt_id)
        body = await request.json()
        kind = body.get("kind")
        if kind not in ("adjustment", "reception"):
            raise HTTPException(400, "Choose a schedule adjustment request or a reception alert")
        snap = await snapshot(coll, appt)
        nxt = snap.get("next") or {}
        row = {
            "id": "opa-" + uuid.uuid4().hex[:12], "dedupeKey": "req:" + uuid.uuid4().hex, "kind": kind, "appointmentId": appt_id, "ref": appt.get("ref"),
            "nextAppointmentId": nxt.get("id"), "nextRef": nxt.get("ref"), "practitionerId": appt.get("practitionerId"),
            "bufferMin": nxt.get("bufferMin"), "at": now_utc().isoformat(), "status": "open",
            "note": str(body.get("note") or "").strip()[:240] or None, "by": user.get("name"),
        }
        await db.nt_ops_alerts.insert_one(dict(row))
        await add_audit(user.get("name"), f"{appt.get('ref')} {'schedule adjustment requested' if kind == 'adjustment' else 'reception alerted'}", appt_id)
        row.pop("_id", None)
        return row

    @r.put("/appointments/{appt_id}/turnaround/cleanup")
    async def override_cleanup(appt_id: str, request: Request):
        user, appt = await own_visit(request, appt_id)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner sets an appointment cleanup buffer")
        body = await request.json()
        value = body.get("minutes")
        if value is not None and (not isinstance(value, int) or not 0 <= value <= 120):
            raise HTTPException(400, "Cleanup must be 0 to 120 minutes")
        upd = {"cleanupMin": value}
        cleanup = appt.get("cleanup")
        if cleanup and not cleanup.get("completedAt"):
            minutes, source = cleanup_minutes(turnaround_config(await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}),
                                              appt.get("serviceSlug"), appt.get("practitionerId"), appt.get("locationType"), value)
            upd["cleanup"] = {**cleanup, "bufferMin": minutes, "source": source, "dueAt": _iso(_parse(cleanup["startedAt"]) + timedelta(minutes=minutes))}
        appt = await save(appt, upd, None)
        await add_audit(user.get("name"), f"{appt.get('ref')} cleanup buffer set to {value if value is not None else 'default'}", appt_id)
        return await snapshot(coll, appt)

    @r.get("/turnaround/config")
    async def get_config(request: Request):
        user = await viewer(request)
        if user["role"] not in ("owner", "desk", "practitioner"):
            raise HTTPException(403, "Not permitted")
        return turnaround_config(await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {})

    @r.put("/turnaround/config")
    async def put_config(request: Request):
        user = await viewer(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner configures cleanup buffers")
        try:
            cleaned = validate_turnaround(await request.json())
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, str(exc) or "Cleanup buffers must be whole minutes") from exc
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        merged = {**(settings.get("turnaround") or {}), **cleaned}
        for key in cleaned.pop("_inherit", []):
            merged.pop(key, None)
        merged.pop("_inherit", None)
        await coll("settings").update_one({"id": "app"}, {"$set": {"turnaround": merged}}, upsert=True)
        await add_audit(user.get("name"), "Cleanup and turnaround buffers updated")
        return turnaround_config({**settings, "turnaround": merged})

    @r.get("/ops/turnaround")
    async def board(request: Request):
        user = await viewer(request)
        if user["role"] not in ("owner", "desk"):
            raise HTTPException(403, "Not permitted")
        at = now_utc()
        today = at.astimezone(TZ).date().isoformat()
        people = await coll("practitioners").find({}, {"_id": 0, "id": 1, "name": 1, "available": 1}).to_list(200)
        rows = await coll("appointments").find({"date": today, "practitionerId": {"$in": [p["id"] for p in people]}}, {"_id": 0}).to_list(1000)
        out = []
        for person in people:
            mine = sorted([row for row in rows if row.get("practitionerId") == person["id"]], key=lambda row: row.get("time") or "")
            current, state = None, None
            for priority in ("treatment_overtime", "in_session", "interrupted", "cleanup_in_progress", "running_late", "traveling", "ready_next"):
                hit = next((row for row in reversed(mine) if ops_state(row, at) == priority), None)
                if hit:
                    current, state = hit, priority
                    break
            entry = {"practitionerId": person["id"], "name": person.get("name"), "state": state or "idle", "appointmentId": None, "ref": None, "next": None}
            if current:
                snap = await snapshot(coll, current, at)
                await raise_alert(current, snap)
                treatment = snap.get("treatment") or {}
                cleanup = snap.get("cleanup") or {}
                entry.update({
                    "appointmentId": current["id"], "ref": current.get("ref"), "time": current.get("time"),
                    "treatment": {"elapsedSec": treatment.get("elapsedSec"), "bookedMin": treatment.get("bookedMin")} if treatment else None,
                    "cleanup": {"remainingSec": cleanup.get("remainingSec"), "bufferMin": cleanup.get("bufferMin")} if cleanup else None,
                    "next": {key: (snap["next"] or {}).get(key) for key in ("ref", "time", "state", "bufferMin", "departBy", "travelKnown")} if snap.get("next") else None,
                })
                if snap.get("next") and snap["next"]["state"] == "running_late" and state in ("ready_next", "cleanup_in_progress"):
                    entry["state"] = "running_late"
            out.append(entry)
        day_start = datetime.combine(at.astimezone(TZ).date(), datetime.min.time(), TZ).astimezone(timezone.utc).isoformat()
        stale = await db.nt_ops_alerts.find({"status": "open"}, {"_id": 0, "id": 1, "at": 1, "kind": 1, "nextAppointmentId": 1}).to_list(500)
        next_ids = [row["nextAppointmentId"] for row in stale if row.get("nextAppointmentId")]
        nexts = {row["id"]: row.get("status") for row in await coll("appointments").find({"id": {"$in": next_ids}}, {"_id": 0, "id": 1, "status": 1}).to_list(500)}
        expired = [row["id"] for row in stale if row["at"] < day_start or (row.get("nextAppointmentId") and nexts.get(row["nextAppointmentId"]) not in NEXT_STATUSES)]
        if expired:
            await db.nt_ops_alerts.update_many({"id": {"$in": expired}}, {"$set": {"status": "resolved", "ackBy": "system", "ackAt": at.isoformat(),
                                                                               "resolution": "Next visit started, finished or the day ended"}})
        alerts = await db.nt_ops_alerts.find({"status": "open", "at": {"$gte": day_start}}, {"_id": 0, "dedupeKey": 0}).sort("at", -1).to_list(50)
        return {"serverNow": at.isoformat(), "practitioners": out, "alerts": alerts}

    @r.post("/ops/turnaround/alerts/{alert_id}/ack")
    async def ack(alert_id: str, request: Request):
        user = await viewer(request)
        if user["role"] not in ("owner", "desk"):
            raise HTTPException(403, "Not permitted")
        done = await db.nt_ops_alerts.find_one_and_update({"id": alert_id, "status": "open"},
                                                          {"$set": {"status": "acknowledged", "ackBy": user.get("name"), "ackAt": now_utc().isoformat()}})
        if not done:
            raise HTTPException(404, "Alert not found")
        return {"acknowledged": True}

    @r.get("/reports/turnaround")
    async def report(request: Request, start: str = "", end: str = "", practitionerId: str = ""):
        user = await viewer(request)
        if user["role"] != "owner":
            raise HTTPException(403, "Only the owner reviews turnaround reports")
        query = {"session.startedAt": {"$ne": None}}
        if start or end:
            query["date"] = {**({"$gte": start} if start else {}), **({"$lte": end} if end else {})}
        if practitionerId:
            query["practitionerId"] = practitionerId
        rows = await coll("appointments").find(query, {"_id": 0}).to_list(5000)
        rows = [row for row in rows if (row.get("session") or {}).get("startedAt")]
        alert_query = {"kind": {"$in": ["at_risk", "running_late"]}}
        if practitionerId:
            alert_query["practitionerId"] = practitionerId
        ids = {row["id"] for row in rows}
        conflicts = [row for row in await db.nt_ops_alerts.find(alert_query, {"_id": 0}).to_list(5000) if row.get("appointmentId") in ids]

        def avg(values):
            values = [v for v in values if v is not None]
            return round(sum(values) / len(values), 1) if values else None

        def summarize(items):
            ended = [row["session"] for row in items if row["session"].get("endedAt")]
            cleaned = [row["cleanup"] for row in items if (row.get("cleanup") or {}).get("completedAt")]
            starts = [row["session"].get("startDelayMin") for row in items if row["session"].get("startDelayMin") is not None]
            delays = [int(row.get("delayMin") or 0) for row in items if int(row.get("delayMin") or 0) > 0]
            return {
                "sessions": len(items), "completedTreatments": len(ended),
                "avgBookedMin": avg([s.get("bookedMin") for s in ended]), "avgActualMin": avg([s.get("actualMin") for s in ended]),
                "overtimeCount": sum(1 for s in ended if (s.get("overtimeMin") or 0) > 0), "avgOvertimeMin": avg([s.get("overtimeMin") for s in ended if (s.get("overtimeMin") or 0) > 0]),
                "earlyCount": sum(1 for s in ended if (s.get("earlyMin") or 0) >= 1),
                "cleanups": len(cleaned), "avgCleanupMin": avg([c.get("actualMin") for c in cleaned]), "avgCleanupBufferMin": avg([c.get("bufferMin") for c in cleaned]),
                "cleanupOverruns": sum(1 for c in cleaned if (c.get("overrunMin") or 0) > 0),
                "avgTurnaroundMin": avg([c.get("actualMin") for c in cleaned]),
                "onTimeStarts": sum(1 for d in starts if -15 <= d <= 5), "lateStarts": sum(1 for d in starts if d > 5),
                "earlyStarts": sum(1 for d in starts if d < -15), "avgStartDelayMin": avg([d for d in starts if d >= -15]),
                "travelDelays": len(delays), "avgTravelDelayMin": avg(delays),
            }

        people = {p["id"]: p.get("name") for p in await coll("practitioners").find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)}
        by_person = []
        for pid in sorted({row.get("practitionerId") for row in rows if row.get("practitionerId")}):
            mine = [row for row in rows if row.get("practitionerId") == pid]
            by_person.append({"practitionerId": pid, "name": people.get(pid), **summarize(mine),
                              "conflicts": sum(1 for c in conflicts if c.get("practitionerId") == pid)})
        visits = [{
            "id": row["id"], "ref": row.get("ref"), "date": row.get("date"), "time": row.get("time"), "practitioner": people.get(row.get("practitionerId")),
            "bookedMin": row["session"].get("bookedMin"), "actualMin": row["session"].get("actualMin"), "overtimeMin": row["session"].get("overtimeMin"),
            "startDelayMin": row["session"].get("startDelayMin"), "cleanupMin": (row.get("cleanup") or {}).get("actualMin"),
            "cleanupBufferMin": (row.get("cleanup") or {}).get("bufferMin"), "travelDelayMin": row.get("delayMin") or 0,
        } for row in sorted(rows, key=lambda row: f"{row.get('date')}{row.get('time')}", reverse=True)[:200]]
        return {"summary": {**summarize(rows), "conflicts": len(conflicts)}, "practitioners": by_person, "visits": visits}

    return r
