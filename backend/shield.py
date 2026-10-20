"""Security Shield™ Stages 3–8 — driver credentials, vehicle docs, renewals, arrival codes, active visits.

Clinical DOCUMENT_UPLOADS_ENABLED stays untouched. Shield files use sealed private storage.
Denser GPS history and auto-enforcement on expiry are intentionally not activated.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pymongo import ReturnDocument

from config import (
    security_shield_arrival_code_enabled, security_shield_docs_enabled,
    security_shield_expiry_enforcement_enabled, security_shield_fleet_enabled,
    security_shield_safety_sampling_enabled,
)
from documents import assess, signature_ok
from fieldcrypto import open_bytes, open_text, seal, seal_bytes
from media import sniff
from rbac import has_role, require_roles

TZ = ZoneInfo("America/Edmonton")
log = logging.getLogger(__name__)

DL_STATES = ("not_submitted", "pending_review", "verified", "expiring_soon", "expired", "rejected")
DOC_TYPES = ("driver_licence", "vehicle_insurance", "vehicle_registration")
VEHICLE_DOC_TYPES = ("vehicle_insurance", "vehicle_registration")
REMINDER_DAYS = (60, 30, 14, 7, 0)
CODE_ATTEMPTS = 5
CODE_LOCK_MIN = 15
CODE_DIGITS_DEFAULT = 6

ASSIST_LABEL = (
    "In-app assistance alert to Nabitouch managers. This is not emergency-service dispatch. "
    "Call 911 in an emergency."
)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def today_local() -> date:
    return datetime.now(TZ).date()


def _clip(value, limit=120):
    return str(value or "").strip()[:limit]


def _require_docs():
    if not security_shield_docs_enabled():
        raise HTTPException(403, "Security Shield documents are turned off")


def _require_arrival():
    if not security_shield_arrival_code_enabled():
        raise HTTPException(403, "Arrival verification is turned off")


def _require_any_shield():
    if not (security_shield_fleet_enabled() or security_shield_docs_enabled() or security_shield_arrival_code_enabled()):
        raise HTTPException(403, "Security Shield is turned off")


def code_pepper():
    return (os.environ.get("SHIELD_CODE_PEPPER") or os.environ.get("JWT_SECRET") or "dev-shield-pepper").encode()


def hash_arrival_code(appt_id: str, code: str) -> str:
    raw = f"{appt_id}:{str(code).strip()}".encode()
    return hmac.new(code_pepper(), raw, hashlib.sha256).hexdigest()


def generate_code(digits: int = CODE_DIGITS_DEFAULT) -> str:
    digits = 4 if digits == 4 else 6
    upper = 10 ** digits
    return f"{secrets.randbelow(upper):0{digits}d}"


def parse_expiry(raw) -> Optional[date]:
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def compute_doc_status(row: dict, today: Optional[date] = None) -> str:
    """Derive dashboard status. Does not auto-disable practitioners."""
    base = row.get("status") or "pending_review"
    if base in ("not_submitted", "rejected", "pending_review"):
        return base
    expires = parse_expiry(row.get("expiresOn"))
    if expires is None:
        return "missing_expiry" if base == "verified" else base
    day = today or today_local()
    if expires < day:
        return "expired"
    if expires <= day + timedelta(days=30):
        return "expiring_soon"
    return "verified" if base == "verified" else base


def staff_dl(row: dict, *, reveal_number: bool = False) -> dict:
    out = {k: v for k, v in row.items() if k not in ("licenceNumber", "versions")}
    out["licenceNumberMasked"] = "••••" + open_text(row.get("licenceNumber") or "")[-4:] if row.get("licenceNumber") else ""
    if reveal_number:
        out["licenceNumber"] = open_text(row.get("licenceNumber") or "")
    out["dashboardStatus"] = compute_doc_status(row)
    versions = []
    for ver in row.get("versions") or []:
        versions.append({
            "id": ver.get("id"),
            "at": ver.get("at"),
            "status": ver.get("status"),
            "expiresOn": ver.get("expiresOn"),
            "fileId": ver.get("fileId"),
            "submittedBy": ver.get("submittedBy"),
            "verifiedBy": ver.get("verifiedBy"),
            "rejectReason": ver.get("rejectReason"),
        })
    out["versions"] = versions
    return out


def staff_vehicle_doc(row: dict, *, reveal_policy: bool = False) -> dict:
    out = {k: v for k, v in row.items() if k not in ("policyReference",)}
    if row.get("policyReference"):
        opened = open_text(row["policyReference"])
        out["policyReferenceMasked"] = "••••" + opened[-4:] if opened else ""
        if reveal_policy:
            out["policyReference"] = opened
    out["dashboardStatus"] = compute_doc_status(row)
    return out


async def ensure_shield(db):
    await db.nt_driver_credentials.create_index("id", unique=True)
    await db.nt_driver_credentials.create_index([("practitionerId", 1), ("status", 1)])
    await db.nt_vehicle_documents.create_index("id", unique=True)
    await db.nt_vehicle_documents.create_index([("vehicleId", 1), ("docType", 1)])
    await db.nt_shield_files.create_index("id", unique=True)
    await db.nt_shield_reminders.create_index([("subjectKey", 1), ("milestone", 1)], unique=True)
    await db.nt_shield_access.create_index([("at", -1)])


async def push_event(coll, appt_id: str, event: dict):
    event = {"id": event.get("id") or ("ev-" + uuid.uuid4().hex[:10]), "at": event.get("at") or now_iso(), **event}
    await coll("appointments").update_one({"id": appt_id}, {"$push": {"events": event}})
    return event


async def issue_arrival_code(coll, appt: dict, *, rotate: bool = False, digits: int = CODE_DIGITS_DEFAULT) -> Optional[str]:
    """Create or rotate a hashed arrival code. Returns plaintext once for authorized callers."""
    if not security_shield_arrival_code_enabled():
        return None
    if (appt or {}).get("locationType") == "clinic":
        return None
    existing = appt.get("arrivalCode") or {}
    if existing.get("codeHash") and not rotate and not existing.get("verifiedAt"):
        return None
    code = generate_code(digits)
    row = {
        "codeHash": hash_arrival_code(appt["id"], code),
        "digits": 4 if digits == 4 else 6,
        "issuedAt": now_iso(),
        "attempts": 0,
        "lockedUntil": None,
        "verifiedAt": None,
        "verifiedBy": None,
        "fallbackUsed": False,
    }
    await coll("appointments").update_one({"id": appt["id"]}, {"$set": {"arrivalCode": row}})
    await push_event(coll, appt["id"], {
        "type": "arrival_code_issued",
        "status": appt.get("status"),
        "actor": "system",
        "note": "Arrival verification code issued (hash only stored)",
    })
    return code


async def client_arrival_code_view(appt: dict) -> Optional[dict]:
    """Clients already hold the code via secure channel; we re-issue plaintext only through dedicated endpoint."""
    meta = appt.get("arrivalCode") or {}
    if not meta.get("codeHash"):
        return None
    return {
        "issued": True,
        "digits": meta.get("digits") or 6,
        "verified": bool(meta.get("verifiedAt")),
        "locked": bool(meta.get("lockedUntil") and meta["lockedUntil"] > now_iso()),
        "guidance": "Do not share this code until your therapist arrives. Check the therapist's identity and vehicle before providing it.",
        "disclaimer": "This code confirms the in-person appointment handoff. It is not definitive proof of a person's legal identity.",
    }


async def store_shield_file(db, *, owner_id: str, kind: str, upload: UploadFile, actor: str) -> dict:
    raw = await upload.read()
    if not signature_ok(raw) and sniff(raw) is None:
        raise HTTPException(400, "Upload a PDF, JPEG, or PNG document")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(400, "This file is too large")
    verdict = assess(raw)
    if verdict == "rejected":
        raise HTTPException(400, "That file type is not accepted")
    if verdict == "infected":
        raise HTTPException(400, "This file was rejected by the malware scanner")
    file_id = "shf-" + uuid.uuid4().hex[:16]
    sealed = seal_bytes(raw)
    row = {
        "id": file_id,
        "ownerId": owner_id,
        "kind": kind,
        "contentType": upload.content_type or "application/octet-stream",
        "filename": _clip(upload.filename, 120),
        "bytes": sealed,
        "scan": verdict,
        "uploadedBy": actor,
        "at": now_iso(),
    }
    await db.nt_shield_files.insert_one(dict(row))
    return {"id": file_id, "scan": verdict, "filename": row["filename"], "at": row["at"]}


async def run_renewal_scan(db, coll, add_audit=None):
    """Emit deduped renewal reminders. No sensitive numbers in message bodies."""
    if not security_shield_docs_enabled():
        return {"sent": 0, "skipped": True}
    today = today_local()
    sent = 0
    subjects = []

    async for row in db.nt_driver_credentials.find({}, {"_id": 0}):
        subjects.append(("driver_licence", row.get("id"), row.get("practitionerId"), row.get("expiresOn"), row.get("status"), row))

    async for row in db.nt_vehicle_documents.find({}, {"_id": 0}):
        subjects.append((row.get("docType"), row.get("id"), row.get("vehicleId"), row.get("expiresOn"), row.get("status"), row))

    for doc_type, doc_id, subject_id, expires_on, status, row in subjects:
        if status == "rejected":
            continue
        # Stop reminders once a newer verified version superseded this row
        if row.get("supersededBy"):
            continue
        expires = parse_expiry(expires_on)
        if expires is None:
            continue
        days_left = (expires - today).days
        for milestone in REMINDER_DAYS:
            if days_left != milestone:
                continue
            key = f"{doc_type}:{doc_id}:{milestone}"
            existing = await db.nt_shield_reminders.find_one({"subjectKey": key})
            if existing:
                continue
            notice = {
                "id": "srm-" + uuid.uuid4().hex[:12],
                "subjectKey": key,
                "docType": doc_type,
                "docId": doc_id,
                "subjectId": subject_id,
                "milestone": milestone,
                "channels": {"inApp": True, "email": False, "push": False},
                "body": (
                    f"A Security Shield document expires in {milestone} days."
                    if milestone > 0 else
                    "A Security Shield document expired today. Upload a renewed document for review."
                ),
                "sentAt": now_iso(),
                "deliveryStatus": "recorded",
            }
            try:
                await db.nt_shield_reminders.insert_one(dict(notice))
                sent += 1
                audience = ["owner"]
                if doc_type == "driver_licence" and row.get("practitionerId"):
                    audience.append(f"practitioner:{row.get('practitionerId')}")
                # Phase 8: fan out to Team Connect on-duty roster when configured.
                try:
                    from assist_requests import resolve_team_connect
                    settings = await db.nt_settings.find_one({"id": "app"}, {"_id": 0, "teamConnect": 1}) or {}
                    duty = resolve_team_connect(settings)
                    for uid in (duty.get("dutyPrimaryUserIds") or []) + (duty.get("dutyBackupUserIds") or []):
                        tag = f"user:{uid}"
                        if tag not in audience:
                            audience.append(tag)
                    if duty.get("dutyPrimaryUserIds") or duty.get("dutyBackupUserIds"):
                        audience.append("desk")
                except Exception:
                    log.exception("Team Connect shield audience failed")
                await db.nt_notifications.insert_one({
                    "id": "ntf-" + uuid.uuid4().hex[:12],
                    "kind": "shield_renewal",
                    "audience": audience,
                    "title": "Document renewal",
                    "body": notice["body"],
                    "at": now_iso(),
                    "read": False,
                    "teamConnect": True,
                    "href": "/owner/shield/renewals",
                })
            except Exception:
                log.exception("Shield reminder insert failed")
    return {"sent": sent, "at": now_iso()}


def build_shield_router(db, coll, add_audit, user_from, step_up=None):
    r = APIRouter(prefix="/api/shield")

    async def actor(request: Request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def manager(request: Request):
        user = await actor(request)
        require_roles(user, "owner", "manager")
        return user

    async def body_of(request: Request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        return data if isinstance(data, dict) else {}

    async def log_access(user, action, target_id, meta=None):
        await db.nt_shield_access.insert_one({
            "id": "sac-" + uuid.uuid4().hex[:12],
            "at": now_iso(),
            "actorId": user.get("id"),
            "actor": user.get("name"),
            "action": action,
            "targetId": target_id,
            "meta": meta or {},
        })

    # ---------- status ----------
    @r.get("/status")
    async def shield_status(request: Request):
        user = await actor(request)
        return {
            "fleet": security_shield_fleet_enabled(),
            "docs": security_shield_docs_enabled(),
            "arrivalCode": security_shield_arrival_code_enabled(),
            "role": user.get("role"),
            "canManage": has_role(user, "owner", "manager"),
        }

    # ---------- driver licence ----------
    @r.get("/driver-credentials")
    async def list_dl(request: Request):
        user = await actor(request)
        _require_docs()
        if has_role(user, "owner", "manager"):
            rows = await db.nt_driver_credentials.find({}, {"_id": 0}).to_list(200)
            return {"credentials": [staff_dl(x) for x in rows]}
        if user.get("role") == "practitioner" and user.get("subject"):
            rows = await db.nt_driver_credentials.find({"practitionerId": user["subject"]}, {"_id": 0}).to_list(20)
            return {"credentials": [staff_dl(x) for x in rows]}
        raise HTTPException(403, "Not permitted")

    @r.post("/driver-credentials")
    async def submit_dl(request: Request):
        user = await actor(request)
        _require_docs()
        body = await body_of(request)
        if has_role(user, "owner", "manager"):
            practitioner_id = _clip(body.get("practitionerId"), 80)
        elif user.get("role") == "practitioner":
            practitioner_id = user.get("subject")
        else:
            raise HTTPException(403, "Only practitioners or owners may submit a driver's licence")
        if not practitioner_id:
            raise HTTPException(400, "Choose a practitioner")
        number = _clip(body.get("licenceNumber"), 40)
        if len(number) < 4:
            raise HTTPException(400, "Enter the licence number")
        expires = parse_expiry(body.get("expiresOn"))
        if not expires:
            raise HTTPException(400, "Enter the expiration date")
        version = {
            "id": "dlv-" + uuid.uuid4().hex[:10],
            "at": now_iso(),
            "status": "pending_review",
            "expiresOn": expires.isoformat(),
            "submittedBy": user.get("name"),
            "fileId": body.get("fileId"),
            "jurisdiction": _clip(body.get("jurisdiction"), 40) or "AB",
            "licenceClass": _clip(body.get("licenceClass"), 20),
        }
        existing = await db.nt_driver_credentials.find_one({"practitionerId": practitioner_id}, {"_id": 0})
        stamp = now_iso()
        if existing:
            versions = list(existing.get("versions") or [])
            if existing.get("status") == "verified":
                versions.append({
                    "id": existing.get("currentVersionId") or ("dlv-prev-" + uuid.uuid4().hex[:8]),
                    "at": existing.get("verifiedAt") or existing.get("updatedAt"),
                    "status": "verified",
                    "expiresOn": existing.get("expiresOn"),
                    "submittedBy": existing.get("submittedBy"),
                    "verifiedBy": existing.get("verifiedBy"),
                    "fileId": existing.get("fileId"),
                    "superseded": True,
                })
            versions.append(version)
            updated = await db.nt_driver_credentials.find_one_and_update(
                {"id": existing["id"]},
                {"$set": {
                    "jurisdiction": version["jurisdiction"],
                    "licenceClass": version["licenceClass"],
                    "licenceNumber": seal(number),
                    "expiresOn": expires.isoformat(),
                    "status": "pending_review",
                    "fileId": body.get("fileId"),
                    "internalNotes": _clip(body.get("internalNotes"), 300) if has_role(user, "owner", "manager") else existing.get("internalNotes"),
                    "updatedAt": stamp,
                    "submittedBy": user.get("name"),
                    "currentVersionId": version["id"],
                    "versions": versions,
                    "verifiedAt": None,
                    "verifiedBy": None,
                    "rejectReason": None,
                }},
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0},
            )
            await add_audit(user.get("name") or "staff", f"Driver licence submitted for {practitioner_id}", None)
            return staff_dl(updated)

        row = {
            "id": "dl-" + uuid.uuid4().hex[:12],
            "practitionerId": practitioner_id,
            "jurisdiction": version["jurisdiction"],
            "licenceClass": version["licenceClass"],
            "licenceNumber": seal(number),
            "expiresOn": expires.isoformat(),
            "status": "pending_review",
            "fileId": body.get("fileId"),
            "internalNotes": _clip(body.get("internalNotes"), 300) if has_role(user, "owner", "manager") else "",
            "submittedBy": user.get("name"),
            "verifiedAt": None,
            "verifiedBy": None,
            "rejectReason": None,
            "currentVersionId": version["id"],
            "versions": [version],
            "createdAt": stamp,
            "updatedAt": stamp,
        }
        await db.nt_driver_credentials.insert_one(dict(row))
        await add_audit(user.get("name") or "staff", f"Driver licence submitted for {practitioner_id}", None)
        row.pop("_id", None)
        return staff_dl(row)

    @r.post("/driver-credentials/{cred_id}/verify")
    async def verify_dl(cred_id: str, request: Request):
        user = await manager(request)
        _require_docs()
        if step_up:
            await step_up(user)
        body = await body_of(request)
        approve = body.get("approve", True)
        reason = _clip(body.get("reason"), 300)
        if not approve and not reason:
            raise HTTPException(400, "Provide a rejection reason")
        stamp = now_iso()
        fields = {
            "status": "verified" if approve else "rejected",
            "verifiedAt": stamp if approve else None,
            "verifiedBy": user.get("name") if approve else None,
            "rejectReason": None if approve else reason,
            "updatedAt": stamp,
        }
        updated = await db.nt_driver_credentials.find_one_and_update(
            {"id": cred_id}, {"$set": fields}, return_document=ReturnDocument.AFTER, projection={"_id": 0},
        )
        if not updated:
            raise HTTPException(404, "Driver credential not found")
        await add_audit(user.get("name") or "owner", f"Driver licence {'verified' if approve else 'rejected'}: {cred_id}", None)
        return staff_dl(updated)

    # ---------- vehicle insurance / registration ----------
    @r.get("/vehicles/{vehicle_id}/documents")
    async def list_vehicle_docs(vehicle_id: str, request: Request):
        user = await actor(request)
        _require_docs()
        if not has_role(user, "owner", "manager"):
            raise HTTPException(403, "Only owners and managers review vehicle documents")
        rows = await db.nt_vehicle_documents.find({"vehicleId": vehicle_id}, {"_id": 0}).to_list(50)
        return {"documents": [staff_vehicle_doc(x) for x in rows]}

    @r.post("/vehicles/{vehicle_id}/documents")
    async def upsert_vehicle_doc(vehicle_id: str, request: Request):
        user = await manager(request)
        _require_docs()
        vehicle = await db.nt_vehicles.find_one({"id": vehicle_id}, {"_id": 0, "id": 1})
        if not vehicle:
            raise HTTPException(404, "Vehicle not found")
        body = await body_of(request)
        doc_type = body.get("docType")
        if doc_type not in VEHICLE_DOC_TYPES:
            raise HTTPException(400, "Choose vehicle_insurance or vehicle_registration")
        expires = parse_expiry(body.get("expiresOn"))
        stamp = now_iso()
        version = {
            "id": "vdv-" + uuid.uuid4().hex[:10],
            "at": stamp,
            "status": "pending_review",
            "expiresOn": expires.isoformat() if expires else None,
            "fileId": body.get("fileId"),
            "submittedBy": user.get("name"),
        }
        existing = await db.nt_vehicle_documents.find_one({"vehicleId": vehicle_id, "docType": doc_type, "supersededBy": {"$exists": False}}, {"_id": 0})
        payload = {
            "docType": doc_type,
            "vehicleId": vehicle_id,
            "provider": _clip(body.get("provider"), 120),
            "policyReference": seal(_clip(body.get("policyReference"), 80)) if body.get("policyReference") else None,
            "effectiveOn": _clip(body.get("effectiveOn"), 10) or None,
            "expiresOn": expires.isoformat() if expires else None,
            "jurisdiction": _clip(body.get("jurisdiction"), 40),
            "licensePlate": _clip(body.get("licensePlate"), 20).upper(),
            "fileId": body.get("fileId"),
            "status": "pending_review",
            "verifiedAt": None,
            "verifiedBy": None,
            "updatedAt": stamp,
            "submittedBy": user.get("name"),
        }
        if existing:
            history = list(existing.get("history") or []) + [{
                "id": existing.get("currentVersionId"),
                "at": existing.get("updatedAt"),
                "status": existing.get("status"),
                "expiresOn": existing.get("expiresOn"),
                "fileId": existing.get("fileId"),
                "superseded": True,
            }]
            history.append(version)
            payload["history"] = history
            payload["currentVersionId"] = version["id"]
            updated = await db.nt_vehicle_documents.find_one_and_update(
                {"id": existing["id"]}, {"$set": payload}, return_document=ReturnDocument.AFTER, projection={"_id": 0},
            )
            await add_audit(user.get("name") or "staff", f"Vehicle {doc_type} updated for {vehicle_id}", None)
            return staff_vehicle_doc(updated)

        row = {
            "id": "vd-" + uuid.uuid4().hex[:12],
            **payload,
            "history": [version],
            "currentVersionId": version["id"],
            "createdAt": stamp,
        }
        await db.nt_vehicle_documents.insert_one(dict(row))
        await add_audit(user.get("name") or "staff", f"Vehicle {doc_type} added for {vehicle_id}", None)
        row.pop("_id", None)
        return staff_vehicle_doc(row)

    @r.post("/vehicle-documents/{doc_id}/verify")
    async def verify_vehicle_doc(doc_id: str, request: Request):
        user = await manager(request)
        _require_docs()
        if step_up:
            await step_up(user)
        body = await body_of(request)
        approve = body.get("approve", True)
        reason = _clip(body.get("reason"), 300)
        stamp = now_iso()
        updated = await db.nt_vehicle_documents.find_one_and_update(
            {"id": doc_id},
            {"$set": {
                "status": "verified" if approve else "rejected",
                "verifiedAt": stamp if approve else None,
                "verifiedBy": user.get("name") if approve else None,
                "rejectReason": None if approve else reason,
                "updatedAt": stamp,
            }},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not updated:
            raise HTTPException(404, "Document not found")
        await add_audit(user.get("name") or "owner", f"Vehicle document {'verified' if approve else 'rejected'}: {doc_id}", None)
        return staff_vehicle_doc(updated)

    # ---------- file upload / download ----------
    @r.post("/files")
    async def upload_file(request: Request, upload: UploadFile = File(...), kind: str = Form("shield"), ownerId: str = Form("")):
        user = await actor(request)
        _require_docs()
        if not has_role(user, "owner", "manager") and user.get("role") != "practitioner":
            raise HTTPException(403, "Not permitted")
        owner = ownerId or user.get("subject") or user.get("id")
        meta = await store_shield_file(db, owner_id=owner, kind=_clip(kind, 40), upload=upload, actor=user.get("name") or "staff")
        await log_access(user, "shield_file_upload", meta["id"], {"kind": kind})
        return meta

    @r.get("/files/{file_id}")
    async def download_file(file_id: str, request: Request):
        user = await actor(request)
        _require_docs()
        if not has_role(user, "owner", "manager"):
            raise HTTPException(403, "Document download is limited to owners and managers")
        row = await db.nt_shield_files.find_one({"id": file_id})
        if not row:
            raise HTTPException(404, "File not found")
        await log_access(user, "shield_file_download", file_id)
        await add_audit(user.get("name") or "staff", f"Shield document downloaded: {file_id}", None)
        return Response(
            content=open_bytes(row["bytes"]),
            media_type=row.get("contentType") or "application/octet-stream",
            headers={"Cache-Control": "private, no-store", "Content-Disposition": f'attachment; filename="{row.get("filename") or "document"}"'},
        )

    # ---------- renewals dashboard ----------
    @r.get("/renewals")
    async def renewals(request: Request, practitionerId: str = "", vehicleId: str = "", docType: str = "", status: str = ""):
        await manager(request)
        _require_docs()
        items = []
        async for row in db.nt_driver_credentials.find({}, {"_id": 0}):
            dash = compute_doc_status(row)
            items.append({
                "id": row["id"], "docType": "driver_licence", "practitionerId": row.get("practitionerId"),
                "expiresOn": row.get("expiresOn"), "status": row.get("status"), "dashboardStatus": dash,
                "label": "Driver's licence",
            })
        async for row in db.nt_vehicle_documents.find({}, {"_id": 0}):
            dash = compute_doc_status(row)
            items.append({
                "id": row["id"], "docType": row.get("docType"), "vehicleId": row.get("vehicleId"),
                "expiresOn": row.get("expiresOn"), "status": row.get("status"), "dashboardStatus": dash,
                "label": "Auto insurance" if row.get("docType") == "vehicle_insurance" else "Vehicle registration",
            })
        if practitionerId:
            items = [x for x in items if x.get("practitionerId") == practitionerId]
        if vehicleId:
            items = [x for x in items if x.get("vehicleId") == vehicleId]
        if docType:
            items = [x for x in items if x.get("docType") == docType]
        if status:
            items = [x for x in items if x.get("dashboardStatus") == status]
        return {"items": items, "windows": list(REMINDER_DAYS)}

    @r.post("/renewals/scan")
    async def renewals_scan(request: Request):
        await manager(request)
        return await run_renewal_scan(db, coll, add_audit)

    # ---------- arrival codes ----------
    @r.get("/appointments/{aid}/arrival-code")
    async def get_arrival_code(aid: str, request: Request):
        """Client-only plaintext reveal. Practitioners never receive the code via GET."""
        user = await actor(request)
        _require_arrival()
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        if user.get("role") != "client" or appt.get("clientId") != user.get("subject"):
            raise HTTPException(403, "Only the client for this visit can view the arrival code")
        meta = appt.get("arrivalCode") or {}
        if not meta.get("codeHash"):
            code = await issue_arrival_code(coll, appt)
            if not code:
                return {"issued": False}
            await coll("appointments").update_one({"id": aid}, {"$set": {"arrivalCode.clientDisplay": seal(code)}})
            return {
                "issued": True,
                "code": code,
                "digits": 6,
                "verified": False,
                "guidance": "Do not share this code until your therapist arrives. Check the therapist's identity and vehicle before providing it.",
                "disclaimer": "This code confirms the in-person appointment handoff. It is not definitive proof of a person's legal identity.",
            }
        # Plaintext is not stored — re-issue only if never verified and client needs display after first issue.
        # For returning clients, rotate is avoided; we store a sealed display copy for the client only.
        display = meta.get("clientDisplay")
        code = open_text(display) if display else None
        if not code and not meta.get("verifiedAt"):
            code = await issue_arrival_code(coll, appt, rotate=True)
            if code:
                await coll("appointments").update_one(
                    {"id": aid},
                    {"$set": {"arrivalCode.clientDisplay": seal(code)}},
                )
        view = await client_arrival_code_view({**appt, "arrivalCode": {**(appt.get("arrivalCode") or {}), "clientDisplay": seal(code) if code else display}})
        if code:
            view["code"] = code
        return view

    @r.post("/appointments/{aid}/arrival-code/verify")
    async def verify_arrival_code(aid: str, request: Request):
        user = await actor(request)
        _require_arrival()
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        is_pro = user.get("role") == "practitioner" and appt.get("practitionerId") == user.get("subject")
        is_owner_pro = has_role(user, "owner", "manager") and appt.get("practitionerId") == user.get("subject")
        if not (is_pro or is_owner_pro or has_role(user, "owner", "manager")):
            raise HTTPException(403, "Only the assigned practitioner may verify the arrival code")
        if appt.get("status") not in ("arrived", "en_route", "preparing"):
            raise HTTPException(409, "Verify the code after you have arrived")
        meta = dict(appt.get("arrivalCode") or {})
        if not meta.get("codeHash"):
            raise HTTPException(409, "No arrival code is active for this visit")
        if meta.get("verifiedAt"):
            raise HTTPException(409, "This visit was already verified")
        if meta.get("lockedUntil") and meta["lockedUntil"] > now_iso():
            raise HTTPException(429, "Too many attempts. Try again later or ask the office for a fallback.")
        body = await body_of(request)
        submitted = str(body.get("code") or "").strip()
        # Never log plaintext codes
        if not submitted.isdigit() or len(submitted) not in (4, 6):
            raise HTTPException(400, "Enter the verification code")
        ok = hmac.compare_digest(hash_arrival_code(aid, submitted), meta["codeHash"])
        if not ok:
            attempts = int(meta.get("attempts") or 0) + 1
            patch = {"arrivalCode.attempts": attempts}
            if attempts >= CODE_ATTEMPTS:
                lock_until = (datetime.now(timezone.utc) + timedelta(minutes=CODE_LOCK_MIN)).isoformat()
                patch["arrivalCode.lockedUntil"] = lock_until
            await coll("appointments").update_one({"id": aid}, {"$set": patch})
            await push_event(coll, aid, {
                "type": "arrival_code_failed",
                "status": appt.get("status"),
                "actor": user.get("name") or "practitioner",
                "note": f"Verification failed (attempt {attempts})",
            })
            raise HTTPException(400, "That code does not match. Ask the client again.")
        stamp = now_iso()
        await coll("appointments").update_one({"id": aid}, {"$set": {
            "arrivalCode.verifiedAt": stamp,
            "arrivalCode.verifiedBy": user.get("name"),
            "arrivalCode.attempts": 0,
            "arrivalCode.lockedUntil": None,
            "arrivalCode.clientDisplay": None,
            "clientVerifiedAt": stamp,
        }})
        await push_event(coll, aid, {
            "type": "arrival_code_verified",
            "status": appt.get("status"),
            "actor": user.get("name") or "practitioner",
            "note": "Client verification succeeded",
        })
        await add_audit(user.get("name") or "practitioner", f"{appt.get('ref')} arrival code verified", aid)
        return {"verified": True, "at": stamp}

    @r.post("/appointments/{aid}/arrival-code/fallback")
    async def arrival_fallback(aid: str, request: Request):
        user = await manager(request)
        _require_arrival()
        if step_up:
            await step_up(user)
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        code = await issue_arrival_code(coll, appt, rotate=True)
        await coll("appointments").update_one({"id": aid}, {"$set": {
            "arrivalCode.clientDisplay": seal(code),
            "arrivalCode.fallbackUsed": True,
            "arrivalCode.attempts": 0,
            "arrivalCode.lockedUntil": None,
            "arrivalCode.verifiedAt": None,
        }})
        await push_event(coll, aid, {
            "type": "arrival_code_fallback",
            "status": appt.get("status"),
            "actor": user.get("name") or "owner",
            "note": "Authorized fallback code issued",
        })
        await add_audit(user.get("name") or "owner", f"{appt.get('ref')} arrival code fallback", aid)
        await log_access(user, "arrival_code_fallback", aid)
        return {
            "code": code,
            "guidance": "Share this code with the client only through a verified channel. Do not post it in open chat logs.",
        }

    @r.get("/appointments/{aid}/arrival-code/status")
    async def arrival_status(aid: str, request: Request):
        """Practitioner-safe status — never includes the plaintext code."""
        user = await actor(request)
        _require_arrival()
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0, "arrivalCode": 1, "practitionerId": 1, "clientId": 1, "status": 1, "clientVerifiedAt": 1})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        allowed = (
            has_role(user, "owner", "manager")
            or (user.get("role") == "practitioner" and appt.get("practitionerId") == user.get("subject"))
            or (user.get("role") == "client" and appt.get("clientId") == user.get("subject"))
        )
        if not allowed:
            raise HTTPException(403, "Not permitted")
        meta = appt.get("arrivalCode") or {}
        return {
            "issued": bool(meta.get("codeHash")),
            "verified": bool(meta.get("verifiedAt") or appt.get("clientVerifiedAt")),
            "locked": bool(meta.get("lockedUntil") and meta["lockedUntil"] > now_iso()),
            "attempts": meta.get("attempts") or 0,
            "digits": meta.get("digits") or 6,
            "requiredForTreatment": security_shield_arrival_code_enabled(),
        }

    # ---------- timeline + active visits (Stages 7–8) ----------
    @r.get("/appointments/{aid}/timeline")
    async def ops_timeline(aid: str, request: Request):
        user = await actor(request)
        _require_any_shield()
        if not has_role(user, "owner", "manager", "desk"):
            raise HTTPException(403, "Timeline is limited to authorized staff")
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        await log_access(user, "ops_timeline_view", aid)
        events = []
        for e in appt.get("events") or []:
            events.append({
                "at": e.get("at"),
                "actor": e.get("actor"),
                "type": e.get("type") or e.get("status") or "lifecycle",
                "status": e.get("status"),
                "note": e.get("note") or e.get("label"),
                "vehicleId": e.get("vehicleId"),
                "kind": e.get("kind"),
                "observed": e.get("type") in ("gps_fix", "eta_calculated", "eta_refreshed"),
            })
        return {
            "appointmentId": aid,
            "ref": appt.get("ref"),
            "events": events,
            "vehiclePublic": appt.get("vehiclePublic"),
            "clientVerifiedAt": appt.get("clientVerifiedAt"),
            "note": "Five-minute ETA updates are not continuous evidence of every road or stop. Clinical notes are not included.",
        }

    @r.get("/active-visits")
    async def active_visits(request: Request):
        user = await actor(request)
        _require_any_shield()
        if not has_role(user, "owner", "manager") and user.get("id") not in (
            (await db.nt_settings.find_one({"id": "app"}, {"_id": 0, "safetyManagers": 1}) or {}).get("safetyManagers") or []
        ):
            if user["role"] != "owner":
                raise HTTPException(403, "Active visit safety view is restricted")
        today = today_local().isoformat()
        rows = await coll("appointments").find({
            "date": today,
            "status": {"$in": ["preparing", "en_route", "arrived", "in_session", "interrupted", "safety_hold"]},
            "locationType": {"$ne": "clinic"},
        }, {"_id": 0}).to_list(100)
        from tracking_store import TrackingUnavailable, read_fix, read_safety_samples
        out = []
        for appt in rows:
            last = None
            samples = []
            try:
                fix = await read_fix(appt["id"])
                if fix and "lat" in fix:
                    last = {"lat": fix["lat"], "lng": fix["lng"], "at": fix.get("serverTime"), "accuracy": fix.get("accuracy")}
                if security_shield_safety_sampling_enabled():
                    samples = await read_safety_samples(appt["id"])
            except TrackingUnavailable:
                pass
            except Exception:
                pass
            out.append({
                "id": appt["id"],
                "ref": appt.get("ref"),
                "status": appt.get("status"),
                "practitionerId": appt.get("practitionerId"),
                "vehiclePublic": appt.get("vehiclePublic"),
                "destination": (appt.get("address") or {}).get("line") if has_role(user, "owner", "manager") else None,
                "travelSharing": bool((appt.get("trip") or {}).get("sharing")),
                "lastKnown": last,
                "safetySamples": samples,
                "safetySampling": bool((appt.get("trip") or {}).get("safetySampling")),
                "clientVerifiedAt": appt.get("clientVerifiedAt"),
                "assistLabel": ASSIST_LABEL,
            })
        return {
            "visits": out,
            "assistLabel": ASSIST_LABEL,
            "disclaimer": "Assistance alerts notify designated contacts. This is not guaranteed emergency-service dispatch.",
            "samplingNote": "Safety breadcrumbs are opt-in, capped, and short-lived. Five-minute ETA updates are not continuous road evidence.",
        }

    @r.post("/appointments/{aid}/safety-sampling")
    async def toggle_safety_sampling(aid: str, request: Request):
        """Practitioner opt-in disclosed safety location sampling during active travel."""
        user = await actor(request)
        if not security_shield_safety_sampling_enabled():
            raise HTTPException(403, "Safety location sampling is turned off")
        appt = await coll("appointments").find_one({"id": aid}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        allowed = (
            has_role(user, "owner", "manager")
            or (user.get("role") == "practitioner" and appt.get("practitionerId") == user.get("subject"))
        )
        if not allowed:
            raise HTTPException(403, "Not permitted")
        if appt.get("status") != "en_route":
            raise HTTPException(409, "Safety sampling is only available while On My Way")
        body = await body_of(request)
        enabled = bool(body.get("enabled"))
        trip = {**(appt.get("trip") or {}), "safetySampling": enabled}
        await coll("appointments").update_one({"id": aid}, {"$set": {"trip": trip}})
        await push_event(coll, aid, {
            "type": "safety_sampling_" + ("on" if enabled else "off"),
            "status": "en_route",
            "actor": user.get("name") or "practitioner",
            "note": "Opt-in safety location sampling " + ("enabled" if enabled else "disabled"),
        })
        await add_audit(user.get("name") or "staff", f"{appt.get('ref')} safety sampling {'on' if enabled else 'off'}", aid)
        return {
            "enabled": enabled,
            "disclosure": "This stores a short, temporary breadcrumb trail for authorized safety review only. Live ETA still refreshes at most every five minutes. This is not continuous tracking or emergency dispatch.",
        }

    return r


async def assert_arrival_verified_for_treatment(appt: dict):
    if not security_shield_arrival_code_enabled():
        return
    if (appt or {}).get("locationType") == "clinic":
        return
    meta = appt.get("arrivalCode") or {}
    if meta.get("verifiedAt") or appt.get("clientVerifiedAt"):
        return
    if not meta.get("codeHash"):
        return  # code never issued — do not block legacy visits mid-flight without a code
    raise HTTPException(409, "Enter the client's arrival verification code before starting treatment")


async def ensure_arrival_code_on_booking(coll, appt: dict):
    if not security_shield_arrival_code_enabled():
        return
    if (appt or {}).get("locationType") == "clinic":
        return
    if (appt.get("arrivalCode") or {}).get("codeHash"):
        return
    code = await issue_arrival_code(coll, appt)
    if code:
        await coll("appointments").update_one({"id": appt["id"]}, {"$set": {"arrivalCode.clientDisplay": seal(code)}})


async def assert_driving_docs_ok(db, *, practitioner_id: str = None, vehicle_id: str = None, action: str = "proceed"):
    """Approved expiry enforcement: block operational use when verified driving docs are expired.

    Does not cancel appointments or disable practitioner accounts.
    """
    if not security_shield_expiry_enforcement_enabled() or not security_shield_docs_enabled():
        return
    today = today_local()
    if practitioner_id:
        row = await db.nt_driver_credentials.find_one({"practitionerId": practitioner_id}, {"_id": 0})
        if row and compute_doc_status(row, today) == "expired":
            raise HTTPException(
                409,
                f"Cannot {action}: the practitioner's driver's licence is expired. Upload a renewed licence for review.",
            )
    if vehicle_id:
        async for doc in db.nt_vehicle_documents.find({"vehicleId": vehicle_id, "status": "verified"}, {"_id": 0}):
            if compute_doc_status(doc, today) == "expired":
                label = "auto insurance" if doc.get("docType") == "vehicle_insurance" else "registration"
                raise HTTPException(409, f"Cannot {action}: vehicle {label} is expired. Renew and verify the document first.")
