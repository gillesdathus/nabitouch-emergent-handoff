"""Reception/Manager approved client messages for delay coordination.

Never auto-sends. Never discloses internal operational details.
"""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from rbac import has_role, require_roles

MAX_BODY = 600
BLOCKED = re.compile(r"\b(police|arrest|dui|weapon|gunshot|domestic)\b", re.I)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(text):
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(text or "")).strip()
    value = re.sub(r"\s+", " ", value)
    if not value or len(value) > MAX_BODY:
        raise HTTPException(400, f"Write a client message of {MAX_BODY} characters or less")
    if BLOCKED.search(value):
        raise HTTPException(400, "Remove internal or sensitive operational details before sending to a client")
    return value


async def ensure_client_comms(db):
    await db.nt_client_comms.create_index("id", unique=True)
    await db.nt_client_comms.create_index([("status", 1), ("createdAt", -1)])


def build_client_comms_router(db, coll, user_from, add_audit):
    router = APIRouter(prefix="/api/team/client-comms", tags=["team-connect-comms"])

    async def viewer(request: Request):
        user = await user_from(request)
        require_roles(user, "owner", "manager", "desk", "practitioner")
        return user

    def public(row):
        return {
            "id": row.get("id"),
            "assistRequestId": row.get("assistRequestId"),
            "appointmentId": row.get("appointmentId"),
            "appointmentRef": row.get("appointmentRef"),
            "clientId": row.get("clientId"),
            "draft": row.get("draft"),
            "status": row.get("status"),
            "createdBy": row.get("createdBy"),
            "createdAt": row.get("createdAt"),
            "approvedBy": row.get("approvedBy"),
            "approvedAt": row.get("approvedAt"),
            "deliveredAt": row.get("deliveredAt"),
            "deliveryOutcome": row.get("deliveryOutcome"),
        }

    @router.post("/draft")
    async def create_draft(request: Request):
        user = await viewer(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(400, "Invalid draft")
        appointment_id = str(body.get("appointmentId") or "").strip()
        appt = await coll("appointments").find_one({"id": appointment_id}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        minutes = body.get("delayMinutes")
        try:
            minutes = int(minutes) if minutes is not None else None
        except (TypeError, ValueError):
            minutes = None
        default = "We're running a little behind and will be with you as soon as we can. Thank you for your patience."
        if minutes in (5, 10, 15, 20, 30):
            default = f"We're running about {minutes} minutes behind and will be with you as soon as we can. Thank you for your patience."
        draft = _clean(body.get("draft") or default)
        stamp = _now()
        doc = {
            "id": "ccd-" + uuid.uuid4().hex[:14],
            "assistRequestId": body.get("assistRequestId") or None,
            "appointmentId": appt["id"],
            "appointmentRef": appt.get("ref"),
            "clientId": appt.get("clientId"),
            "draft": draft,
            "status": "pending_approval",
            "createdBy": user.get("id"),
            "createdByName": user.get("name") or "Staff",
            "createdAt": stamp,
            "approvedBy": None,
            "approvedAt": None,
            "deliveredAt": None,
            "deliveryOutcome": None,
            "channel": "in_app",
        }
        await db.nt_client_comms.insert_one(dict(doc))
        doc.pop("_id", None)
        await add_audit(user.get("name") or "Staff", f"Client message draft · {appt.get('ref')}", doc["id"])
        return {"comm": public(doc)}

    @router.get("")
    async def list_comms(request: Request, status: str = "pending_approval"):
        user = await viewer(request)
        if not has_role(user, "owner", "manager", "desk"):
            raise HTTPException(403, "Only reception or managers can review client messages")
        query = {"status": status} if status else {}
        rows = await db.nt_client_comms.find(query, {"_id": 0}).sort("createdAt", -1).to_list(100)
        return {"items": [public(row) for row in rows]}

    @router.post("/{comm_id}/approve")
    async def approve(comm_id: str, request: Request):
        user = await viewer(request)
        if not has_role(user, "owner", "manager", "desk"):
            raise HTTPException(403, "Reception or manager approval is required")
        body = await request.json() if request.headers.get("content-length") != "0" else {}
        if not isinstance(body, dict):
            body = {}
        row = await db.nt_client_comms.find_one({"id": comm_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Draft not found")
        if row.get("status") != "pending_approval":
            raise HTTPException(409, "This draft was already reviewed")
        draft = _clean(body.get("draft") or row.get("draft"))
        stamp = _now()
        # Deliver as in-app visit message only after approval — never SMS from here.
        appt = await coll("appointments").find_one({"id": row.get("appointmentId")}, {"_id": 0})
        outcome = "approved_not_delivered"
        if appt:
            author_role = "desk" if user.get("role") == "desk" else "owner"
            msg = {
                "id": "msg-" + uuid.uuid4().hex[:16],
                "appointmentId": appt["id"],
                "clientId": appt.get("clientId"),
                "practitionerId": appt.get("practitionerId"),
                "authorId": user.get("id"),
                "authorRole": author_role,
                "authorLabel": "Nabitouch",
                "body": draft,
                "presetId": None,
                "channel": "in_app",
                "kind": "chat",
                "createdAt": stamp,
                "deliveredAt": stamp,
                "readBy": {author_role: stamp},
                "sms": False,
                "email": False,
            }
            await db.nt_messages.insert_one(dict(msg))
            outcome = "delivered_in_app"
        await db.nt_client_comms.update_one(
            {"id": comm_id},
            {"$set": {
                "draft": draft,
                "status": "sent" if outcome == "delivered_in_app" else "approved",
                "approvedBy": user.get("id"),
                "approvedByName": user.get("name") or "Staff",
                "approvedAt": stamp,
                "deliveredAt": stamp if outcome == "delivered_in_app" else None,
                "deliveryOutcome": outcome,
            }},
        )
        refreshed = await db.nt_client_comms.find_one({"id": comm_id}, {"_id": 0})
        await add_audit(user.get("name") or "Staff", f"Client message approved · {row.get('appointmentRef')}", comm_id)
        return {"comm": public(refreshed)}

    @router.post("/{comm_id}/reject")
    async def reject(comm_id: str, request: Request):
        user = await viewer(request)
        if not has_role(user, "owner", "manager", "desk"):
            raise HTTPException(403, "Reception or manager approval is required")
        row = await db.nt_client_comms.find_one({"id": comm_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Draft not found")
        stamp = _now()
        await db.nt_client_comms.update_one(
            {"id": comm_id},
            {"$set": {"status": "rejected", "approvedBy": user.get("id"), "approvedAt": stamp, "deliveryOutcome": "rejected"}},
        )
        refreshed = await db.nt_client_comms.find_one({"id": comm_id}, {"_id": 0})
        return {"comm": public(refreshed)}

    return router
