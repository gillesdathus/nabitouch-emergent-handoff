"""Team Connect Quick Help / assistance requests.

On-duty routing is separate from practitioner bookability.
Escalation timers are server-evaluated (on read/list/tick), not browser-only.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from rbac import STAFF_ROLES, effective_roles, has_role, is_privileged, require_roles

CATEGORIES = {
    "running_late": {"title": "Running Late", "priority": "routine"},
    "vehicle_issue": {"title": "Vehicle Issue", "priority": "routine"},
    "safety_concern": {"title": "Safety Concern", "priority": "urgent"},
    "address_problem": {"title": "Address Problem", "priority": "routine"},
    "need_supplies": {"title": "Need Supplies", "priority": "routine"},
    "other": {"title": "Other Assistance", "priority": "routine"},
}
STATUSES = ("new", "accepted", "in_progress", "resolved", "escalated", "cancelled", "unable")
ACTIVE = ("new", "accepted", "in_progress", "escalated")
MAX_NOTE = 1000
URGENT_MIN = 3
ROUTINE_MIN = 15


def _now():
    return datetime.now(timezone.utc)


def _iso(dt=None):
    return (dt or _now()).isoformat()


def _clean(text, limit=MAX_NOTE):
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(text or "")).strip()
    value = re.sub(r"\s+", " ", value)
    if len(value) > limit:
        raise HTTPException(400, f"Keep notes under {limit} characters")
    return value


def default_team_connect_settings():
    return {
        "urgentAckMinutes": URGENT_MIN,
        "routineAckMinutes": ROUTINE_MIN,
        "dutyPrimaryUserIds": [],
        "dutyBackupUserIds": [],
    }


def resolve_team_connect(settings):
    raw = (settings or {}).get("teamConnect") if isinstance(settings, dict) else {}
    base = default_team_connect_settings()
    if not isinstance(raw, dict):
        return base
    try:
        urgent = int(raw.get("urgentAckMinutes") or URGENT_MIN)
        routine = int(raw.get("routineAckMinutes") or ROUTINE_MIN)
    except (TypeError, ValueError) as exc:
        raise ValueError("Escalation minutes must be whole numbers") from exc
    if urgent < 1 or urgent > 60 or routine < 1 or routine > 180:
        raise ValueError("Escalation windows are out of range")
    primary = [str(x) for x in (raw.get("dutyPrimaryUserIds") or []) if x][:20]
    backup = [str(x) for x in (raw.get("dutyBackupUserIds") or []) if x][:20]
    return {
        "urgentAckMinutes": urgent,
        "routineAckMinutes": routine,
        "dutyPrimaryUserIds": primary,
        "dutyBackupUserIds": backup,
    }


async def ensure_assist_requests(db):
    await db.nt_assist_requests.create_index("id", unique=True)
    await db.nt_assist_requests.create_index("idempotencyKey", unique=True, sparse=True)
    await db.nt_assist_requests.create_index([("status", 1), ("createdAt", -1)])
    await db.nt_assist_requests.create_index("requesterId")
    await db.nt_assist_requests.create_index("assigneeId")
    await db.nt_assist_requests.create_index("escalateAt")


def _public(row, viewer_id=None, *, include_location=False):
    history = list(row.get("history") or [])
    location = None
    if include_location and row.get("locationShare") and row.get("location"):
        authorized = viewer_id in {
            row.get("requesterId"),
            row.get("assigneeId"),
            *(row.get("responderIds") or []),
        } or row.get("status") in ACTIVE
        if authorized:
            location = {
                "lat": row["location"].get("lat"),
                "lng": row["location"].get("lng"),
                "label": row["location"].get("label") or "",
                "consentAt": row.get("locationConsentAt"),
            }
    return {
        "id": row.get("id"),
        "ref": row.get("ref"),
        "category": row.get("category"),
        "categoryTitle": (CATEGORIES.get(row.get("category")) or {}).get("title") or row.get("category"),
        "priority": row.get("priority"),
        "status": row.get("status"),
        "note": row.get("note") or "",
        "requesterId": row.get("requesterId"),
        "requesterName": row.get("requesterName"),
        "requesterRole": row.get("requesterRole"),
        "assigneeId": row.get("assigneeId"),
        "assigneeName": row.get("assigneeName"),
        "appointmentId": row.get("appointmentId"),
        "appointmentRef": row.get("appointmentRef"),
        "responderIds": list(row.get("responderIds") or []),
        "backupIds": list(row.get("backupIds") or []),
        "createdAt": row.get("createdAt"),
        "updatedAt": row.get("updatedAt"),
        "acknowledgedAt": row.get("acknowledgedAt"),
        "escalateAt": row.get("escalateAt"),
        "escalatedAt": row.get("escalatedAt"),
        "resolvedAt": row.get("resolvedAt"),
        "outcome": row.get("outcome") or "",
        "locationShare": bool(row.get("locationShare")),
        "location": location,
        "history": history,
        "updates": list(row.get("updates") or []),
        "shieldRelated": bool(row.get("shieldRelated")),
        "shieldHref": row.get("shieldHref") or None,
    }


def build_assist_router(db, coll, user_from, add_audit):
    router = APIRouter(prefix="/api/team/requests", tags=["team-connect-requests"])

    async def viewer(request: Request):
        user = await user_from(request)
        require_roles(user, *STAFF_ROLES)
        if not is_privileged(user):
            raise HTTPException(403, "Staff only")
        return user

    async def settings():
        row = await db.nt_settings.find_one({"id": "app"}, {"_id": 0, "teamConnect": 1}) or {}
        return resolve_team_connect(row)

    async def staff_names(ids):
        if not ids:
            return {}
        rows = await db.nt_users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(ids))
        return {r["id"]: r.get("name") or "Staff" for r in rows if r.get("id")}

    def push_history(doc, status, actor, note=""):
        entry = {"status": status, "at": _iso(), "actor": actor, "note": note or ""}
        history = list(doc.get("history") or [])
        history.append(entry)
        doc["history"] = history
        doc["status"] = status
        doc["updatedAt"] = entry["at"]
        return entry

    async def maybe_escalate(doc):
        if not doc or doc.get("status") not in ("new", "escalated"):
            return doc
        if doc.get("acknowledgedAt"):
            return doc
        escalate_at = doc.get("escalateAt")
        if not escalate_at:
            return doc
        try:
            due = datetime.fromisoformat(str(escalate_at).replace("Z", "+00:00"))
        except ValueError:
            return doc
        if _now() < due:
            return doc
        if doc.get("status") == "new":
            backup = list(doc.get("backupIds") or [])
            names = await staff_names(backup)
            note = "Escalated to backup — no acknowledgement yet"
            if backup:
                note = f"Escalated to backup ({', '.join(names.get(i, i) for i in backup)})"
            push_history(doc, "escalated", "system", note)
            doc["escalatedAt"] = doc["updatedAt"]
            # Keep escalateAt for supervisory follow-up; extend by routine window.
            cfg = await settings()
            doc["escalateAt"] = _iso(_now() + timedelta(minutes=cfg["routineAckMinutes"]))
            await db.nt_assist_requests.update_one({"id": doc["id"], "status": "new"}, {"$set": {
                "status": "escalated",
                "escalatedAt": doc["escalatedAt"],
                "escalateAt": doc["escalateAt"],
                "updatedAt": doc["updatedAt"],
                "history": doc["history"],
            }})
            refreshed = await db.nt_assist_requests.find_one({"id": doc["id"]}, {"_id": 0})
            return refreshed or doc
        return doc

    @router.get("/meta")
    async def meta(request: Request):
        await viewer(request)
        cfg = await settings()
        return {
            "categories": [
                {"id": key, "title": val["title"], "priority": val["priority"]}
                for key, val in CATEGORIES.items()
            ],
            "statuses": list(STATUSES),
            "escalation": {
                "urgentMinutes": cfg["urgentAckMinutes"],
                "routineMinutes": cfg["routineAckMinutes"],
            },
            "routing": "assigned_on_duty_then_backup",
        }

    @router.post("/tick")
    async def tick(request: Request):
        """Server-side escalation sweep for unacknowledged requests."""
        await viewer(request)
        due = await db.nt_assist_requests.find(
            {"status": "new", "acknowledgedAt": None, "escalateAt": {"$lte": _iso()}},
            {"_id": 0},
        ).to_list(100)
        changed = 0
        for row in due:
            after = await maybe_escalate(row)
            if after and after.get("status") == "escalated":
                changed += 1
        return {"ok": True, "escalated": changed}

    @router.get("")
    async def list_requests(request: Request, status: str = "", mine: bool = False):
        user = await viewer(request)
        query = {}
        if status:
            if status == "active":
                query["status"] = {"$in": list(ACTIVE)}
            elif status in STATUSES:
                query["status"] = status
            else:
                raise HTTPException(400, "Unknown status filter")
        if mine or not has_role(user, "owner", "manager", "desk"):
            query["$or"] = [
                {"requesterId": user.get("id")},
                {"assigneeId": user.get("id")},
                {"responderIds": user.get("id")},
                {"backupIds": user.get("id")},
            ]
        rows = await db.nt_assist_requests.find(query, {"_id": 0}).sort("createdAt", -1).to_list(200)
        out = []
        for row in rows:
            row = await maybe_escalate(row)
            out.append(_public(row, user.get("id"), include_location=False))
        return {"requests": out}

    @router.get("/{request_id}")
    async def get_request(request_id: str, request: Request):
        user = await viewer(request)
        row = await db.nt_assist_requests.find_one({"id": request_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Request not found")
        row = await maybe_escalate(row)
        board = has_role(user, "owner", "manager", "desk")
        involved = user.get("id") in {
            row.get("requesterId"),
            row.get("assigneeId"),
            *(row.get("responderIds") or []),
            *(row.get("backupIds") or []),
        }
        if not board and not involved:
            raise HTTPException(403, "Not permitted for this request")
        show_loc = bool(row.get("locationShare")) and (board or involved)
        return {"request": _public(row, user.get("id"), include_location=show_loc)}

    @router.post("")
    async def create_request(request: Request):
        user = await viewer(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid request")
        category = body.get("category")
        if category not in CATEGORIES:
            raise HTTPException(400, "Choose a Quick Help category")
        note = _clean(body.get("note") or "")
        if category == "other" and not note:
            raise HTTPException(400, "Add a short note for other assistance")
        key = str(body.get("idempotencyKey") or "").strip()[:80] or None
        if key:
            key = f"{user.get('id')}:{key}"
            existing = await db.nt_assist_requests.find_one({"idempotencyKey": key}, {"_id": 0})
            if existing:
                return {"request": _public(existing, user.get("id"), include_location=True), "duplicate": True}
        appointment_id = str(body.get("appointmentId") or "").strip() or None
        appt = None
        if appointment_id:
            appt = await coll("appointments").find_one({"id": appointment_id}, {"_id": 0, "id": 1, "ref": 1, "practitionerId": 1})
            if not appt:
                raise HTTPException(404, "Appointment not found")
        location_share = bool(body.get("locationShare"))
        location = None
        location_consent_at = None
        if location_share:
            raw_loc = body.get("location") if isinstance(body.get("location"), dict) else {}
            try:
                lat = float(raw_loc.get("lat"))
                lng = float(raw_loc.get("lng"))
            except (TypeError, ValueError):
                raise HTTPException(400, "Location coordinates are invalid") from None
            if not body.get("locationConsent"):
                raise HTTPException(400, "Confirm location consent for this request only")
            location = {"lat": lat, "lng": lng, "label": _clean(raw_loc.get("label") or "", 120)}
            location_consent_at = _iso()
        # Location denied/off still allows submit.
        cfg = await settings()
        priority = CATEGORIES[category]["priority"]
        minutes = cfg["urgentAckMinutes"] if priority == "urgent" else cfg["routineAckMinutes"]
        responders = list(cfg["dutyPrimaryUserIds"])
        backups = list(cfg["dutyBackupUserIds"])
        # Never use practitioner bookability flags.
        names = await staff_names(set(responders + backups))
        stamp = _iso()
        ref = "AH-" + uuid.uuid4().hex[:6].upper()
        doc = {
            "id": "ahr-" + uuid.uuid4().hex[:14],
            "ref": ref,
            "idempotencyKey": key,
            "category": category,
            "priority": priority,
            "status": "new",
            "note": note,
            "requesterId": user.get("id"),
            "requesterName": user.get("name") or "Staff",
            "requesterRole": user.get("role") or (effective_roles(user) or ["staff"])[0],
            "assigneeId": None,
            "assigneeName": None,
            "appointmentId": appt.get("id") if appt else None,
            "appointmentRef": appt.get("ref") if appt else None,
            "responderIds": responders,
            "backupIds": backups,
            "createdAt": stamp,
            "updatedAt": stamp,
            "acknowledgedAt": None,
            "escalateAt": _iso(_now() + timedelta(minutes=minutes)),
            "escalatedAt": None,
            "resolvedAt": None,
            "outcome": "",
            "locationShare": bool(location),
            "locationConsentAt": location_consent_at,
            "location": location,
            "history": [{"status": "new", "at": stamp, "actor": user.get("name") or "Staff", "note": "Submitted"}],
            "updates": [],
        }
        if not key:
            doc.pop("idempotencyKey", None)
        # Phase 8: vehicle / safety Quick Help links into Security Shield when flags are on.
        shield_related = category in ("vehicle_issue", "safety_concern")
        if shield_related:
            try:
                from config import (
                    security_shield_fleet_enabled, security_shield_docs_enabled,
                    security_shield_safety_sampling_enabled,
                )
                shield_on = (
                    security_shield_fleet_enabled()
                    or security_shield_docs_enabled()
                    or security_shield_safety_sampling_enabled()
                )
            except Exception:
                shield_on = False
            if shield_on:
                doc["shieldRelated"] = True
                doc["shieldHref"] = "/owner/shield" if category == "vehicle_issue" else "/owner/shield/visits"
        try:
            await db.nt_assist_requests.insert_one(dict(doc))
        except DuplicateKeyError:
            existing = await db.nt_assist_requests.find_one({"idempotencyKey": key}, {"_id": 0}) if key else None
            if existing:
                return {"request": _public(existing, user.get("id"), include_location=True), "duplicate": True}
            raise
        doc.pop("_id", None)
        await add_audit(user.get("name") or "Staff", f"Quick Help {ref} · {category}", doc["id"])
        if doc.get("shieldRelated"):
            try:
                await db.nt_notifications.insert_one({
                    "id": "ntf-" + uuid.uuid4().hex[:12],
                    "kind": "team_shield_assist",
                    "audience": ["owner", "desk"] + [f"user:{uid}" for uid in responders + backups],
                    "title": CATEGORIES[category]["title"],
                    "body": f"{ref}: {CATEGORIES[category]['title']} — open Security Shield if fleet or safety follow-up is needed.",
                    "at": stamp,
                    "read": False,
                    "teamConnect": True,
                    "href": doc.get("shieldHref") or "/owner/shield",
                    "assistRequestId": doc["id"],
                })
            except Exception:
                pass
        return {
            "request": _public(doc, user.get("id"), include_location=True),
            "duplicate": False,
            "routing": {
                "primary": [{"id": i, "name": names.get(i, i)} for i in responders],
                "backup": [{"id": i, "name": names.get(i, i)} for i in backups],
                "policy": "assigned_on_duty_then_backup",
            },
        }

    @router.post("/{request_id}/accept")
    async def accept_request(request_id: str, request: Request):
        user = await viewer(request)
        stamp = _iso()
        claimed = await db.nt_assist_requests.find_one_and_update(
            {"id": request_id, "status": {"$in": ["new", "escalated"]}, "acknowledgedAt": None},
            {
                "$set": {
                    "status": "accepted",
                    "assigneeId": user.get("id"),
                    "assigneeName": user.get("name") or "Staff",
                    "acknowledgedAt": stamp,
                    "updatedAt": stamp,
                },
                "$push": {"history": {"status": "accepted", "at": stamp, "actor": user.get("name") or "Staff", "note": "Accepted"}},
            },
            return_document=ReturnDocument.AFTER,
        )
        if not claimed:
            row = await db.nt_assist_requests.find_one({"id": request_id}, {"_id": 0})
            if not row:
                raise HTTPException(404, "Request not found")
            if row.get("assigneeId") and row.get("assigneeId") != user.get("id"):
                raise HTTPException(409, "Another responder already accepted this request")
            raise HTTPException(409, "This request can no longer be accepted")
        claimed.pop("_id", None)
        await add_audit(user.get("name") or "Staff", f"Quick Help {claimed.get('ref')} accepted", request_id)
        return {"request": _public(claimed, user.get("id"), include_location=True)}

    @router.post("/{request_id}/status")
    async def set_status(request_id: str, request: Request):
        user = await viewer(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid status")
        to = body.get("status")
        if to not in ("in_progress", "resolved", "cancelled", "unable", "escalated"):
            raise HTTPException(400, "Unsupported status")
        row = await db.nt_assist_requests.find_one({"id": request_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Request not found")
        board = has_role(user, "owner", "manager", "desk")
        if row.get("assigneeId") not in (None, user.get("id")) and not board and row.get("requesterId") != user.get("id"):
            raise HTTPException(403, "Only the assignee or desk can update this request")
        if to in ("cancelled",) and row.get("requesterId") != user.get("id") and not board:
            raise HTTPException(403, "Only the requester or desk can cancel")
        if to == "in_progress" and row.get("status") not in ("accepted", "in_progress", "escalated"):
            raise HTTPException(409, "Accept the request before marking in progress")
        note = _clean(body.get("note") or body.get("outcome") or "")
        stamp = _iso()
        updates = {
            "status": to,
            "updatedAt": stamp,
        }
        if to == "resolved":
            updates["resolvedAt"] = stamp
            updates["outcome"] = note or "Resolved"
        if to == "unable":
            updates["resolvedAt"] = stamp
            updates["outcome"] = note or "Unable to fulfill"
        if to == "cancelled":
            updates["resolvedAt"] = stamp
            updates["outcome"] = note or "Cancelled"
        history_entry = {"status": to, "at": stamp, "actor": user.get("name") or "Staff", "note": note}
        await db.nt_assist_requests.update_one({"id": request_id}, {"$set": updates, "$push": {"history": history_entry}})
        refreshed = await db.nt_assist_requests.find_one({"id": request_id}, {"_id": 0})
        await add_audit(user.get("name") or "Staff", f"Quick Help {refreshed.get('ref')} → {to}", request_id)
        return {"request": _public(refreshed, user.get("id"), include_location=True)}

    @router.post("/{request_id}/updates")
    async def add_update(request_id: str, request: Request):
        user = await viewer(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid update")
        text = _clean(body.get("body") or body.get("note") or "")
        if not text:
            raise HTTPException(400, "Write an update")
        row = await db.nt_assist_requests.find_one({"id": request_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Request not found")
        stamp = _iso()
        entry = {"id": "ahu-" + uuid.uuid4().hex[:10], "at": stamp, "authorId": user.get("id"), "authorName": user.get("name") or "Staff", "body": text}
        await db.nt_assist_requests.update_one({"id": request_id}, {"$push": {"updates": entry}, "$set": {"updatedAt": stamp}})
        refreshed = await db.nt_assist_requests.find_one({"id": request_id}, {"_id": 0})
        return {"request": _public(refreshed, user.get("id"), include_location=True), "update": entry}

    return router
