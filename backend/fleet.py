"""Security Shield™ Stage 2 — fleet vehicles and practitioner assignment.

Vehicle identification only. No dispatch logistics. Does not enable DOCUMENT_UPLOADS_ENABLED.
Professional liability insurance stays on nt_credentials (kind=liability).
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pymongo import ReturnDocument

from config import security_shield_fleet_enabled
from media import process_image, sniff
from rbac import has_role, require_roles
from shield import assert_driving_docs_ok

TZ = ZoneInfo("America/Edmonton")
VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
PLATE_RE = re.compile(r"^[A-Z0-9][A-Z0-9 \-]{1,14}$")
STATUSES = ("active", "unavailable", "archived")
ASSIGN_KINDS = ("primary", "temporary")
EDITABLE = (
    "vin", "make", "model", "year", "trim", "color", "licensePlate",
    "registrationJurisdiction", "description", "status", "unavailableReason",
)
NHTSA = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json"
PHOTO_LONGEST = 1600
log = logging.getLogger(__name__)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def today_local():
    return datetime.now(TZ).date().isoformat()


def _clip(value, limit=120):
    return str(value or "").strip()[:limit]


def _require_fleet():
    if not security_shield_fleet_enabled():
        raise HTTPException(403, "Security Shield fleet is turned off")


def normalize_vin(raw):
    vin = re.sub(r"[^A-Za-z0-9]", "", str(raw or "")).upper()
    if not vin:
        return ""
    if len(vin) != 17 or not VIN_RE.match(vin):
        raise HTTPException(400, "Enter a valid 17-character VIN (letters I, O, and Q are not used)")
    return vin


def normalize_plate(raw):
    plate = re.sub(r"\s+", " ", str(raw or "").strip().upper())
    if not plate:
        return ""
    if not PLATE_RE.match(plate):
        raise HTTPException(400, "Enter a valid license plate")
    return plate


def normalize_year(raw):
    if raw in (None, ""):
        return None
    try:
        year = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "Enter a valid model year") from None
    if year < 1980 or year > datetime.now(TZ).year + 1:
        raise HTTPException(400, "Enter a realistic model year")
    return year


def public_vehicle(row: dict) -> dict:
    """Client-safe vehicle identity. Never includes VIN or document fields."""
    if not row:
        return None
    photos = row.get("photos") or []
    return {
        "id": row.get("id"),
        "make": row.get("make") or "",
        "model": row.get("model") or "",
        "year": row.get("year"),
        "trim": row.get("trim") or "",
        "color": row.get("color") or "",
        "licensePlate": row.get("licensePlate") or "",
        "description": row.get("description") or "",
        "photoIds": [p.get("id") for p in photos if p.get("id")],
        "label": vehicle_label(row),
    }


def vehicle_label(row: dict) -> str:
    parts = [str(row.get("year") or "").strip(), row.get("make") or "", row.get("model") or ""]
    base = " ".join(p for p in parts if p).strip() or "Vehicle"
    color = (row.get("color") or "").strip()
    plate = (row.get("licensePlate") or "").strip()
    bits = [base]
    if color:
        bits.append(color)
    if plate:
        bits.append(plate)
    return " · ".join(bits)


def staff_vehicle(row: dict, assignment: Optional[dict] = None) -> dict:
    out = {k: v for k, v in row.items() if k != "photos"}
    out["photos"] = [
        {"id": p.get("id"), "caption": p.get("caption") or "", "at": p.get("at"), "contentType": p.get("contentType")}
        for p in (row.get("photos") or [])
    ]
    out["label"] = vehicle_label(row)
    out["public"] = public_vehicle(row)
    if assignment:
        out["assignment"] = {
            "id": assignment.get("id"),
            "kind": assignment.get("kind"),
            "practitionerId": assignment.get("practitionerId"),
            "effectiveFrom": assignment.get("effectiveFrom"),
            "effectiveTo": assignment.get("effectiveTo"),
            "appointmentId": assignment.get("appointmentId"),
            "note": assignment.get("note") or "",
            "at": assignment.get("at"),
        }
    return out


async def ensure_fleet(db):
    await db.nt_vehicles.create_index("id", unique=True)
    await db.nt_vehicles.create_index([("status", 1), ("updatedAt", -1)])
    await db.nt_vehicles.create_index("licensePlate")
    await db.nt_vehicle_assignments.create_index("id", unique=True)
    await db.nt_vehicle_assignments.create_index([("vehicleId", 1), ("at", -1)])
    await db.nt_vehicle_assignments.create_index([("practitionerId", 1), ("endedAt", 1), ("kind", 1)])
    await db.nt_vehicle_media.create_index("id", unique=True)
    await db.nt_vehicle_media.create_index("vehicleId")


async def decode_vin_nhtsa(vin: str) -> dict:
    """NHTSA vPIC decode. Does not supply color, plate, insurance, or registration."""
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(NHTSA.format(vin=vin))
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        log.warning("VIN decode unavailable: %s", type(exc).__name__)
        return {
            "ok": False,
            "error": "VIN lookup is temporarily unavailable. Enter make, model, and year manually.",
            "source": "nhtsa",
            "vin": vin,
        }
    results = (payload or {}).get("Results") or []
    row = results[0] if results else {}
    error_code = str(row.get("ErrorCode") or "")
    # 0 = success; 1–7 often still return useful fields with warnings
    make = _clip(row.get("Make"), 60)
    model = _clip(row.get("Model"), 60)
    trim = _clip(row.get("Trim") or row.get("Series"), 60)
    year_raw = row.get("ModelYear")
    year = None
    try:
        if year_raw:
            year = int(str(year_raw)[:4])
    except ValueError:
        year = None
    if not make and not model and not year:
        return {
            "ok": False,
            "error": "That VIN could not be decoded. Check the number or enter details manually.",
            "source": "nhtsa",
            "vin": vin,
            "errorCode": error_code,
            "errorText": _clip(row.get("ErrorText"), 200),
        }
    return {
        "ok": True,
        "source": "nhtsa",
        "vin": vin,
        "make": make,
        "model": model,
        "year": year,
        "trim": trim,
        "bodyClass": _clip(row.get("BodyClass"), 80),
        "vehicleType": _clip(row.get("VehicleType"), 80),
        "errorCode": error_code,
        "errorText": _clip(row.get("ErrorText"), 200),
        "note": "Color, license plate, insurance, and registration are not provided by VIN decode.",
    }


def build_fleet_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api/fleet")

    async def actor(request: Request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def manager(request: Request):
        user = await actor(request)
        _require_fleet()
        require_roles(user, "owner", "manager")
        return user

    async def staff_or_self(request: Request):
        user = await actor(request)
        _require_fleet()
        if has_role(user, "owner", "manager"):
            return user
        if user.get("role") == "practitioner" and user.get("subject"):
            return user
        raise HTTPException(403, "Fleet access is limited to owners, managers, and practitioners")

    async def body_of(request: Request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        return data if isinstance(data, dict) else {}

    async def get_vehicle(vehicle_id: str):
        row = await db.nt_vehicles.find_one({"id": vehicle_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Vehicle not found")
        return row

    async def active_assignment(vehicle_id: str = None, practitioner_id: str = None, kind: str = None):
        query = {"endedAt": None}
        if vehicle_id:
            query["vehicleId"] = vehicle_id
        if practitioner_id:
            query["practitionerId"] = practitioner_id
        if kind:
            query["kind"] = kind
        return await db.nt_vehicle_assignments.find_one(query, {"_id": 0}, sort=[("at", -1)])

    async def end_assignment(assignment: dict, user, reason: str):
        if not assignment or assignment.get("endedAt"):
            return
        await db.nt_vehicle_assignments.update_one(
            {"id": assignment["id"], "endedAt": None},
            {"$set": {"endedAt": now_iso(), "endedBy": user.get("name"), "endReason": _clip(reason, 120)}},
        )

    def parse_vehicle_fields(body: dict, *, creating: bool):
        fields = {}
        if "vin" in body or creating:
            vin = body.get("vin")
            fields["vin"] = normalize_vin(vin) if vin not in (None, "") else ""
        if "licensePlate" in body or creating:
            fields["licensePlate"] = normalize_plate(body.get("licensePlate")) if body.get("licensePlate") else ""
        if "year" in body or creating:
            fields["year"] = normalize_year(body.get("year"))
        for key in ("make", "model", "trim", "color", "registrationJurisdiction", "description", "unavailableReason"):
            if key in body or creating:
                limit = 200 if key == "description" else 80
                fields[key] = _clip(body.get(key), limit)
        if "status" in body or creating:
            status = body.get("status") or "active"
            if status not in STATUSES:
                raise HTTPException(400, "Choose an active, unavailable, or archived status")
            fields["status"] = status
        if fields.get("status") != "unavailable":
            fields["unavailableReason"] = fields.get("unavailableReason") or ""
        if fields.get("status") == "unavailable" and not fields.get("unavailableReason") and creating:
            fields["unavailableReason"] = "Marked unavailable"
        if creating and not fields.get("make") and not fields.get("model") and not fields.get("vin"):
            raise HTTPException(400, "Enter a VIN to decode, or provide make and model")
        return fields

    async def stamp_upcoming_appointments(practitioner_id: str, vehicle: dict, user, notice: bool):
        """Record which vehicle is assigned to upcoming mobile visits and notify when identity changes."""
        from messaging import record_trip_notice

        today = today_local()
        query = {
            "practitionerId": practitioner_id,
            "date": {"$gte": today},
            "status": {"$in": ["requested", "confirmed", "assigned", "preparing", "en_route"]},
            "locationType": {"$ne": "clinic"},
        }
        async for appt in coll("appointments").find(query, {"_id": 0}):
            prev = (appt.get("vehiclePublic") or {}).get("id")
            snap = public_vehicle(vehicle)
            event = {
                "id": "ev-" + uuid.uuid4().hex[:10],
                "type": "vehicle_assigned",
                "at": now_iso(),
                "actor": user.get("name") or "staff",
                "vehicleId": vehicle.get("id"),
                "label": snap.get("label"),
            }
            update = {
                "vehicleId": vehicle.get("id"),
                "vehiclePublic": snap,
            }
            await coll("appointments").update_one(
                {"id": appt["id"]},
                {"$set": update, "$push": {"events": event}},
            )
            if notice and prev and prev != vehicle.get("id"):
                await record_trip_notice(db, appt, "vehicle_changed", reason=snap.get("label") or "")

    @r.get("/status")
    async def fleet_status(request: Request):
        user = await actor(request)
        enabled = security_shield_fleet_enabled()
        if not enabled:
            return {"enabled": False, "role": user.get("role")}
        return {"enabled": True, "role": user.get("role"), "canManage": has_role(user, "owner", "manager")}

    @r.post("/vin-decode")
    async def vin_decode(request: Request):
        await manager(request)
        body = await body_of(request)
        vin = normalize_vin(body.get("vin"))
        result = await decode_vin_nhtsa(vin)
        return result

    @r.get("/vehicles")
    async def list_vehicles(request: Request, include_archived: bool = False):
        user = await staff_or_self(request)
        query = {}
        if not include_archived:
            query["status"] = {"$ne": "archived"}
        if user.get("role") == "practitioner" and not has_role(user, "owner", "manager"):
            assignment = await active_assignment(practitioner_id=user["subject"])
            if not assignment:
                return {"vehicles": [], "enabled": True}
            query["id"] = assignment["vehicleId"]
        rows = await db.nt_vehicles.find(query, {"_id": 0}).sort("updatedAt", -1).to_list(200)
        out = []
        for row in rows:
            assignment = await active_assignment(vehicle_id=row["id"])
            out.append(staff_vehicle(row, assignment))
        return {"vehicles": out, "enabled": True}

    @r.get("/vehicles/{vehicle_id}")
    async def get_one(vehicle_id: str, request: Request):
        user = await staff_or_self(request)
        row = await get_vehicle(vehicle_id)
        assignment = await active_assignment(vehicle_id=vehicle_id)
        if user.get("role") == "practitioner" and not has_role(user, "owner", "manager"):
            if not assignment or assignment.get("practitionerId") != user.get("subject"):
                raise HTTPException(403, "You can only view your assigned vehicle")
        return staff_vehicle(row, assignment)

    @r.post("/vehicles")
    async def create_vehicle(request: Request):
        user = await manager(request)
        body = await body_of(request)
        fields = parse_vehicle_fields(body, creating=True)
        vin_meta = None
        if fields.get("vin") and body.get("applyVinDecode") is not False:
            decoded = await decode_vin_nhtsa(fields["vin"])
            vin_meta = {k: decoded.get(k) for k in ("ok", "source", "error", "errorCode", "errorText", "note", "bodyClass", "vehicleType") if decoded.get(k) is not None}
            vin_meta["at"] = now_iso()
            if decoded.get("ok"):
                for key in ("make", "model", "year", "trim"):
                    if not fields.get(key) and decoded.get(key) not in (None, ""):
                        fields[key] = decoded[key]
                vin_meta["applied"] = True
            else:
                vin_meta["applied"] = False
        if body.get("manualOverride"):
            if vin_meta is None:
                vin_meta = {}
            vin_meta["manualOverride"] = True
        stamp = now_iso()
        row = {
            "id": "veh-" + uuid.uuid4().hex[:12],
            **{k: fields.get(k) for k in EDITABLE},
            "photos": [],
            "vinDecode": vin_meta,
            "createdAt": stamp,
            "updatedAt": stamp,
            "createdBy": user.get("name"),
            "archivedAt": stamp if fields.get("status") == "archived" else None,
        }
        await db.nt_vehicles.insert_one(dict(row))
        await add_audit(user.get("name") or "staff", f"Fleet vehicle added: {vehicle_label(row)}", None)
        row.pop("_id", None)
        return staff_vehicle(row)

    @r.patch("/vehicles/{vehicle_id}")
    async def update_vehicle(vehicle_id: str, request: Request):
        user = await manager(request)
        row = await get_vehicle(vehicle_id)
        body = await body_of(request)
        fields = parse_vehicle_fields(body, creating=False)
        if body.get("vin") and body.get("applyVinDecode"):
            decoded = await decode_vin_nhtsa(fields.get("vin") or row.get("vin") or "")
            meta = {k: decoded.get(k) for k in ("ok", "source", "error", "errorCode", "errorText", "note") if decoded.get(k) is not None}
            meta["at"] = now_iso()
            meta["applied"] = bool(decoded.get("ok"))
            if decoded.get("ok"):
                for key in ("make", "model", "year", "trim"):
                    if key not in body and decoded.get(key) not in (None, ""):
                        fields[key] = decoded[key]
            fields["vinDecode"] = {**(row.get("vinDecode") or {}), **meta}
        if body.get("manualOverride"):
            fields["vinDecode"] = {**(fields.get("vinDecode") or row.get("vinDecode") or {}), "manualOverride": True, "at": now_iso()}
        if fields.get("status") == "archived" and row.get("status") != "archived":
            fields["archivedAt"] = now_iso()
            current = await active_assignment(vehicle_id=vehicle_id)
            await end_assignment(current, user, "vehicle archived")
        fields["updatedAt"] = now_iso()
        updated = await db.nt_vehicles.find_one_and_update(
            {"id": vehicle_id},
            {"$set": fields},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        await add_audit(user.get("name") or "staff", f"Fleet vehicle updated: {vehicle_label(updated)}", None)
        assignment = await active_assignment(vehicle_id=vehicle_id)
        if assignment and any(k in fields for k in ("make", "model", "year", "color", "licensePlate", "description", "photos")):
            await stamp_upcoming_appointments(assignment["practitionerId"], updated, user, notice=True)
        return staff_vehicle(updated, assignment)

    @r.post("/vehicles/{vehicle_id}/archive")
    async def archive_vehicle(vehicle_id: str, request: Request):
        user = await manager(request)
        row = await get_vehicle(vehicle_id)
        if row.get("status") == "archived":
            return staff_vehicle(row, await active_assignment(vehicle_id=vehicle_id))
        current = await active_assignment(vehicle_id=vehicle_id)
        await end_assignment(current, user, "vehicle archived")
        updated = await db.nt_vehicles.find_one_and_update(
            {"id": vehicle_id},
            {"$set": {"status": "archived", "archivedAt": now_iso(), "updatedAt": now_iso()}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        await add_audit(user.get("name") or "staff", f"Fleet vehicle archived: {vehicle_label(updated)}", None)
        return staff_vehicle(updated)

    @r.post("/vehicles/{vehicle_id}/assign")
    async def assign_vehicle(vehicle_id: str, request: Request):
        user = await manager(request)
        vehicle = await get_vehicle(vehicle_id)
        if vehicle.get("status") == "archived":
            raise HTTPException(409, "Restore or create another vehicle — archived vehicles cannot be assigned")
        if vehicle.get("status") == "unavailable":
            raise HTTPException(409, "This vehicle is marked unavailable for operational use")
        body = await body_of(request)
        practitioner_id = _clip(body.get("practitionerId"), 80)
        await assert_driving_docs_ok(db, practitioner_id=practitioner_id, vehicle_id=vehicle_id, action="assign this vehicle")
        if not practitioner_id:
            raise HTTPException(400, "Choose a practitioner")
        person = await coll("practitioners").find_one({"id": practitioner_id}, {"_id": 0, "id": 1, "name": 1})
        if not person:
            raise HTTPException(404, "Practitioner not found")
        kind = body.get("kind") or "primary"
        if kind not in ASSIGN_KINDS:
            raise HTTPException(400, "Choose a primary or temporary assignment")
        effective_from = _clip(body.get("effectiveFrom"), 10) or today_local()
        effective_to = _clip(body.get("effectiveTo"), 10) or None
        appointment_id = _clip(body.get("appointmentId"), 40) or None
        note = _clip(body.get("note"), 200)
        # One active primary per practitioner; one active assignment per vehicle.
        prior_vehicle = await active_assignment(vehicle_id=vehicle_id)
        await end_assignment(prior_vehicle, user, "reassigned")
        prior_primary = None
        if kind == "primary":
            prior_primary = await active_assignment(practitioner_id=practitioner_id, kind="primary")
            await end_assignment(prior_primary, user, "primary vehicle changed")
        row = {
            "id": "va-" + uuid.uuid4().hex[:12],
            "vehicleId": vehicle_id,
            "practitionerId": practitioner_id,
            "kind": kind,
            "effectiveFrom": effective_from,
            "effectiveTo": effective_to,
            "appointmentId": appointment_id,
            "note": note,
            "assignedBy": user.get("name"),
            "at": now_iso(),
            "endedAt": None,
            "endedBy": None,
            "endReason": None,
        }
        await db.nt_vehicle_assignments.insert_one(dict(row))
        row.pop("_id", None)
        if appointment_id:
            appt = await coll("appointments").find_one({"id": appointment_id}, {"_id": 0})
            if appt:
                snap = public_vehicle(vehicle)
                await coll("appointments").update_one(
                    {"id": appointment_id},
                    {
                        "$set": {"vehicleId": vehicle_id, "vehiclePublic": snap},
                        "$push": {"events": {
                            "id": "ev-" + uuid.uuid4().hex[:10],
                            "type": "vehicle_assigned",
                            "at": now_iso(),
                            "actor": user.get("name") or "staff",
                            "vehicleId": vehicle_id,
                            "label": snap.get("label"),
                            "kind": kind,
                        }},
                    },
                )
        changed = bool(prior_primary) if kind == "primary" else bool(prior_vehicle)
        await stamp_upcoming_appointments(practitioner_id, vehicle, user, notice=changed)
        await add_audit(
            user.get("name") or "staff",
            f"Fleet assigned {vehicle_label(vehicle)} → {person.get('name')} ({kind})",
            appointment_id,
        )
        return {"assignment": row, "vehicle": staff_vehicle(vehicle, row)}

    @r.get("/vehicles/{vehicle_id}/assignments")
    async def assignment_history(vehicle_id: str, request: Request):
        await manager(request)
        await get_vehicle(vehicle_id)
        rows = await db.nt_vehicle_assignments.find({"vehicleId": vehicle_id}, {"_id": 0}).sort("at", -1).to_list(100)
        return {"assignments": rows}

    @r.get("/practitioners/{practitioner_id}/vehicle")
    async def practitioner_vehicle(practitioner_id: str, request: Request):
        user = await staff_or_self(request)
        if user.get("role") == "practitioner" and user.get("subject") != practitioner_id and not has_role(user, "owner", "manager"):
            raise HTTPException(403, "You can only view your own vehicle")
        assignment = await active_assignment(practitioner_id=practitioner_id)
        if not assignment:
            return {"vehicle": None, "assignment": None, "unavailable": True}
        vehicle = await get_vehicle(assignment["vehicleId"])
        if vehicle.get("status") in ("archived", "unavailable"):
            return {
                "vehicle": staff_vehicle(vehicle, assignment),
                "assignment": assignment,
                "unavailable": True,
                "reason": "archived" if vehicle.get("status") == "archived" else "unavailable",
            }
        return {"vehicle": staff_vehicle(vehicle, assignment), "assignment": assignment, "unavailable": False}

    @r.get("/mine")
    async def my_vehicle(request: Request):
        user = await staff_or_self(request)
        if not user.get("subject"):
            raise HTTPException(403, "No practitioner profile is linked to this account")
        return await practitioner_vehicle(user["subject"], request)

    @r.post("/vehicles/{vehicle_id}/photos")
    async def add_photo(vehicle_id: str, request: Request, upload: UploadFile = File(...), caption: str = Form("")):
        """Vehicle identification photos. Independent of DOCUMENT_UPLOADS_ENABLED (clinical/insurance files)."""
        user = await manager(request)
        await get_vehicle(vehicle_id)
        raw = await upload.read()
        if sniff(raw) is None:
            raise HTTPException(400, "Upload a JPEG, PNG, or WebP photo of the actual vehicle")
        processed = process_image(raw, PHOTO_LONGEST)
        photo_id = "vph-" + uuid.uuid4().hex[:16]
        stamp = now_iso()
        await db.nt_vehicle_media.insert_one({
            "id": photo_id,
            "vehicleId": vehicle_id,
            "bytes": processed["data"],
            "contentType": processed["contentType"],
            "caption": _clip(caption, 80),
            "uploadedBy": user.get("name"),
            "at": stamp,
        })
        meta = {"id": photo_id, "caption": _clip(caption, 80), "at": stamp, "contentType": processed["contentType"]}
        updated = await db.nt_vehicles.find_one_and_update(
            {"id": vehicle_id},
            {"$push": {"photos": meta}, "$set": {"updatedAt": stamp}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        await add_audit(user.get("name") or "staff", f"Fleet vehicle photo added: {vehicle_id}", None)
        assignment = await active_assignment(vehicle_id=vehicle_id)
        if assignment:
            await stamp_upcoming_appointments(assignment["practitionerId"], updated, user, notice=False)
        return staff_vehicle(updated, assignment)

    @r.get("/photos/{photo_id}")
    async def get_photo(photo_id: str, request: Request, appointmentId: str = ""):
        user = await actor(request)
        _require_fleet()
        media = await db.nt_vehicle_media.find_one({"id": photo_id})
        if not media:
            raise HTTPException(404, "Photo not found")
        vehicle = await get_vehicle(media["vehicleId"])
        if has_role(user, "owner", "manager"):
            pass
        elif user.get("role") == "practitioner" and user.get("subject"):
            assignment = await active_assignment(vehicle_id=vehicle["id"])
            if not assignment or assignment.get("practitionerId") != user.get("subject"):
                raise HTTPException(403, "Not permitted")
        elif user.get("role") == "client" and user.get("subject") and appointmentId:
            appt = await coll("appointments").find_one({"id": appointmentId}, {"_id": 0, "clientId": 1, "vehiclePublic": 1})
            allowed = (appt or {}).get("clientId") == user.get("subject") and photo_id in ((appt.get("vehiclePublic") or {}).get("photoIds") or [])
            if not allowed:
                raise HTTPException(403, "Not permitted")
        else:
            raise HTTPException(403, "Not permitted")
        return Response(
            content=bytes(media["bytes"]),
            media_type=media.get("contentType") or "image/jpeg",
            headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
        )

    @r.delete("/vehicles/{vehicle_id}/photos/{photo_id}")
    async def remove_photo(vehicle_id: str, photo_id: str, request: Request):
        user = await manager(request)
        await get_vehicle(vehicle_id)
        await db.nt_vehicle_media.delete_one({"id": photo_id, "vehicleId": vehicle_id})
        updated = await db.nt_vehicles.find_one_and_update(
            {"id": vehicle_id},
            {"$pull": {"photos": {"id": photo_id}}, "$set": {"updatedAt": now_iso()}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        await add_audit(user.get("name") or "staff", f"Fleet vehicle photo removed: {vehicle_id}", None)
        return staff_vehicle(updated, await active_assignment(vehicle_id=vehicle_id))

    return r
