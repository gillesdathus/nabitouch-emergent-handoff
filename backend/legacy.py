"""Legacy patient staging. Records stay out of active clients until a verified link.

The October 2026 read-only inspection of nabi_touch found field names and counts
only. This module does not connect to that database unless LEGACY_MONGO_URL is
set and the owner confirms a backup. Imports in tests use synthetic records.
"""
import hashlib
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile
from pymongo.errors import DuplicateKeyError

from auth import check_pw, hash_pw, present, token, write_auth_cookies, REFRESH_DAYS
from documents import ScannerUnavailable, assess
from emailer import send_email
from fieldcrypto import open_bytes, open_tree, seal_bytes, seal_tree
from html import escape

logger = logging.getLogger(__name__)

SOURCE_DATABASE = "nabi_touch"
INVOICE_MESSAGE = "No historical invoices found in the source system."
STATUSES = (
    "imported", "needs_contact_review", "ready_to_invite", "invited",
    "invitation_expired", "onboarding_in_progress", "submitted", "needs_review", "activated",
)
PROFILE_KEYS = (
    "firstName", "lastName", "email", "phone", "address", "dateOfBirth", "gender",
    "occupation", "emergencyName", "emergencyPhone", "allergies", "medications",
    "healthConcerns", "intakeNotes", "preferredPressure", "pregnancyStatus",
    "referredBy", "insuranceProvider", "insurancePolicy", "noterroId", "sourceChannel",
    "legacyConsentSigned",
)
FIELD_MAP = {
    "id": "sourceId",
    "first_name": "firstName",
    "last_name": "lastName",
    "email": "email",
    "phone": "phone",
    "address": "address",
    "date_of_birth": "dateOfBirth",
    "gender": "gender",
    "occupation": "occupation",
    "emergency_contact_name": "emergencyName",
    "emergency_contact_phone": "emergencyPhone",
    "allergies": "allergies",
    "medications": "medications",
    "health_concerns": "healthConcerns",
    "intake_notes": "intakeNotes",
    "preferred_pressure": "preferredPressure",
    "pregnancy_status": "pregnancyStatus",
    "referred_by": "referredBy",
    "insurance_provider": "insuranceProvider",
    "insurance_policy_number": "insurancePolicy",
    "noterro_id": "noterroId",
    "source": "sourceChannel",
    "consent_signed": "legacyConsentSigned",
}
# Counts from the read-only inspection. No values.
SCHEMA_FINDINGS = {
    "database": SOURCE_DATABASE,
    "inspectedAt": "2026-10-12",
    "patients": 17,
    "mediaAssets": 18,
    "mediaLinkedToPatients": False,
    "users": 1,
    "importJobs": 1,
    "soapNotes": 0,
    "medicalFlags": 0,
    "invoiceCollections": [],
    "invoiceFieldsOnPatients": [],
    "uploads": {"files": 19, "inspectedContents": False},
    "invoicesMessage": INVOICE_MESSAGE,
    "fieldMap": FIELD_MAP,
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _clip(value, limit=240):
    return str(value or "").strip()[:limit]


def _digest(value):
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    if not text:
        return None
    return hashlib.sha256(text.encode()).hexdigest()


def _phone_key(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) < 7:
        return None
    return hashlib.sha256(digits.encode()).hexdigest()


def map_patient(raw):
    if not isinstance(raw, dict):
        raise HTTPException(400, "Each source record must be an object")
    profile = {}
    for source_key, dest in FIELD_MAP.items():
        if source_key not in raw or source_key == "id":
            continue
        value = raw.get(source_key)
        if isinstance(value, bool):
            profile[dest] = "yes" if value else "no"
        elif value is not None:
            profile[dest] = _clip(value, 2000)
    source_id = _clip(raw.get("id") or raw.get("sourceId"), 80)
    if not source_id:
        raise HTTPException(400, "A source record needs an id")
    embedded = [key for key in raw if re.search(r"invoice|payment|balance|receipt", key, re.I)]
    return source_id, profile, embedded


def _status_for(profile, duplicate):
    if not profile.get("email") and not profile.get("phone"):
        return "needs_contact_review"
    if duplicate:
        return "imported"
    return "imported"


def _public_list_row(row, profile):
    return {
        "id": row["id"],
        "sourceId": row["sourceId"],
        "sourceDatabase": row["sourceDatabase"],
        "batchId": row["batchId"],
        "status": row["status"],
        "firstName": profile.get("firstName") or "",
        "lastName": profile.get("lastName") or "",
        "email": profile.get("email") or "",
        "phone": profile.get("phone") or "",
        "address": profile.get("address") or "",
        "hasEmail": row.get("hasEmail"),
        "hasPhone": row.get("hasPhone"),
        "contactComplete": bool(row.get("hasEmail") or row.get("hasPhone")),
        "duplicateOf": row.get("duplicateOf"),
        "clientId": row.get("clientId"),
        "importedAt": row.get("createdAt"),
        "invoiceCount": row.get("invoiceCount") or 0,
        "fileCount": row.get("fileCount") or 0,
        "notes": row.get("notes") or "",
    }


async def ensure_legacy(db):
    await db.nt_legacy_patients.create_index("id", unique=True)
    await db.nt_legacy_patients.create_index("sourceKey", unique=True)
    await db.nt_legacy_patients.create_index("batchId")
    await db.nt_legacy_patients.create_index("clientId", sparse=True)
    await db.nt_legacy_invoices.create_index("id", unique=True)
    await db.nt_legacy_invoices.create_index("sourceKey", unique=True)
    await db.nt_legacy_batches.create_index("id", unique=True)
    await db.nt_legacy_events.create_index("id", unique=True)
    await db.nt_legacy_invitations.create_index("id", unique=True)
    await db.nt_legacy_invitations.create_index("tokenHash", unique=True)
    await db.nt_legacy_onboarding.create_index("patientId", unique=True)
    await db.nt_legacy_files.create_index("id", unique=True)


async def clear_legacy(db):
    for name in ("nt_legacy_patients", "nt_legacy_invoices", "nt_legacy_batches", "nt_legacy_events", "nt_legacy_invitations", "nt_legacy_onboarding", "nt_legacy_files"):
        await db[name].delete_many({})


def invitation_message(link):
    """Email body is a link only. No clinical, insurance, or contact details."""
    safe = escape(link)
    subject = "Set up your Nabitouch account"
    html = f"<p>Use this private link to set up your Nabitouch account. It expires and can be used once.</p><p><a href=\"{safe}\">{safe}</a></p>"
    return subject, html


def _token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _invite_link(raw):
    base = (os.environ.get("APP_URL") or "").rstrip("/")
    return f"{base}/welcome#{raw}"


def secrets_token():
    return secrets.token_urlsafe(32)


async def _load_invite(db, raw):
    token = str(raw or "").strip()
    if not token:
        raise HTTPException(404, "Invitation not found")
    row = await db.nt_legacy_invitations.find_one({"tokenHash": _token_hash(token)}, {"_id": 0})
    if not row or row.get("revokedAt"):
        raise HTTPException(410 if row else 404, "This invitation is no longer valid")
    if row.get("usedAt"):
        raise HTTPException(410, "This invitation has already been used")
    if row.get("expiresAt", "") < now_iso():
        await db.nt_legacy_patients.update_one({"id": row["patientId"], "status": "invited"}, {"$set": {"status": "invitation_expired"}})
        raise HTTPException(410, "This invitation has expired")
    return row


def build_legacy_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api/legacy")

    async def owner(request: Request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        if user.get("role") != "owner":
            raise HTTPException(403, "Legacy records are limited to the owner")
        return user

    async def audit(actor, action, record_id=None):
        await db.nt_legacy_events.insert_one({
            "id": "lev-" + uuid.uuid4().hex[:12],
            "at": now_iso(),
            "actor": actor,
            "action": action,
            "recordId": record_id,
        })
        await add_audit(actor, action, None)

    async def open_row(row):
        profile = open_tree(row.get("profile") or {})
        view = _public_list_row(row, profile)
        view["profile"] = profile
        view["legacyConsentSigned"] = profile.get("legacyConsentSigned")
        view["consentCopied"] = False
        return view

    @r.get("/schema")
    async def schema(request: Request):
        await owner(request)
        return SCHEMA_FINDINGS

    @r.get("/summary")
    async def summary(request: Request):
        await owner(request)
        counts = {}
        for status in STATUSES:
            counts[status] = await db.nt_legacy_patients.count_documents({"status": status})
        return {"counts": counts, "invoicesMessage": INVOICE_MESSAGE}

    @r.get("/patients")
    async def list_patients(request: Request, q: str = "", status: str = "", sort: str = "importedAt", page: int = 1, pageSize: int = 25):
        await owner(request)
        query = {}
        if status in STATUSES:
            query["status"] = status
        size = min(max(pageSize, 1), 50)
        skip = max(page - 1, 0) * size
        rows = await db.nt_legacy_patients.find(query, {"_id": 0}).to_list(500)
        opened = []
        needle = q.strip().lower()
        for row in rows:
            profile = open_tree(row.get("profile") or {})
            item = _public_list_row(row, profile)
            if needle:
                hay = " ".join([item["firstName"], item["lastName"], item["email"], item["phone"], item["sourceId"], item["address"]]).lower()
                if needle not in hay:
                    continue
            opened.append(item)
        reverse = sort.startswith("-")
        key = sort[1:] if reverse else sort
        if key not in ("importedAt", "lastName", "status", "sourceId"):
            key = "importedAt"
        opened.sort(key=lambda item: (item.get("lastName") if key == "lastName" else item.get(key) or ""), reverse=reverse or key == "importedAt")
        total = len(opened)
        return {"total": total, "page": page, "pageSize": size, "items": opened[skip:skip + size], "invoicesMessage": INVOICE_MESSAGE}

    @r.get("/patients/{record_id}")
    async def read_patient(record_id: str, request: Request):
        await owner(request)
        row = await db.nt_legacy_patients.find_one({"id": record_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Legacy record not found")
        view = await open_row(row)
        invoices = await db.nt_legacy_invoices.find({"patientId": record_id}, {"_id": 0, "sourceKey": 0}).to_list(100)
        view["invoices"] = invoices
        view["invoicesMessage"] = None if invoices else INVOICE_MESSAGE
        view["events"] = await db.nt_legacy_events.find({"recordId": record_id}, {"_id": 0}).sort("at", 1).to_list(100)
        return view

    @r.patch("/patients/{record_id}")
    async def review_patient(record_id: str, request: Request):
        user = await owner(request)
        row = await db.nt_legacy_patients.find_one({"id": record_id})
        if not row:
            raise HTTPException(404, "Legacy record not found")
        body = await request.json()
        updates = {"updatedAt": now_iso()}
        if "notes" in body:
            updates["notes"] = _clip(body.get("notes"), 1000)
        if body.get("status") == "ready_to_invite" and row["status"] in ("imported", "needs_contact_review"):
            profile = open_tree(row.get("profile") or {})
            if not profile.get("email") and not profile.get("phone"):
                raise HTTPException(400, "Add a phone or email before this record can be invited")
            updates["status"] = "ready_to_invite"
        contact = body.get("contact") if isinstance(body.get("contact"), dict) else None
        if contact:
            profile = open_tree(row.get("profile") or {})
            for key in ("email", "phone", "address", "firstName", "lastName"):
                if key in contact:
                    profile[key] = _clip(contact.get(key), 240)
            updates["profile"] = seal_tree(profile)
            updates["hasEmail"] = bool(profile.get("email"))
            updates["hasPhone"] = bool(profile.get("phone"))
            updates["emailKey"] = _digest(profile.get("email"))
            updates["phoneKey"] = _phone_key(profile.get("phone"))
            if row["status"] == "needs_contact_review" and (updates["hasEmail"] or updates["hasPhone"]):
                updates["status"] = "imported"
        await db.nt_legacy_patients.update_one({"id": record_id}, {"$set": updates})
        await audit(user["email"], "legacy_review", record_id)
        return await read_patient(record_id, request)

    @r.post("/import/preview")
    async def preview(request: Request):
        from config import legacy_patient_import_enabled
        if not legacy_patient_import_enabled():
            raise HTTPException(403, "Patient import is turned off")
        await owner(request)
        body = await request.json()
        _authorized(body)
        records = body.get("records") or []
        report = await _prepare(db, records, body.get("invoices") or [], dry=True)
        report["dryRun"] = True
        return report

    @r.post("/import")
    async def run_import(request: Request):
        from config import legacy_patient_import_enabled
        if not legacy_patient_import_enabled():
            raise HTTPException(403, "Patient import is turned off")
        user = await owner(request)
        body = await request.json()
        _authorized(body)
        if body.get("source") == "configured":
            records, invoices = await _read_source()
        else:
            records = body.get("records") or []
            invoices = body.get("invoices") or []
        report = await _prepare(db, records, invoices, dry=False, actor=user["email"])
        logger.info("legacy import batch received=%s imported=%s", report["received"], report["imported"])
        return report

    @r.get("/batches/{batch_id}")
    async def batch_report(batch_id: str, request: Request):
        await owner(request)
        row = await db.nt_legacy_batches.find_one({"id": batch_id}, {"_id": 0})
        if not row:
            raise HTTPException(404, "Import batch not found")
        return row

    @r.post("/batches/{batch_id}/rollback")
    async def rollback(batch_id: str, request: Request):
        user = await owner(request)
        batch = await db.nt_legacy_batches.find_one({"id": batch_id})
        if not batch:
            raise HTTPException(404, "Import batch not found")
        if batch.get("rolledBack"):
            return {"rolledBack": True, "removed": 0}
        linked = await db.nt_legacy_patients.count_documents({
            "batchId": batch_id,
            "$or": [{"clientId": {"$ne": None}}, {"status": {"$in": ["invited", "onboarding_in_progress", "submitted", "needs_review", "activated", "invitation_expired"]}}],
        })
        if linked:
            raise HTTPException(409, "This batch has linked or invited records and was not removed")
        removed = await db.nt_legacy_patients.delete_many({"batchId": batch_id})
        await db.nt_legacy_invoices.delete_many({"batchId": batch_id})
        await db.nt_legacy_batches.update_one({"id": batch_id}, {"$set": {"rolledBack": True, "rolledBackAt": now_iso()}})
        await audit(user["email"], "legacy_rollback", batch_id)
        return {"rolledBack": True, "removed": removed.deleted_count}

    async def _issue(user, row, corrected_email=None):
        if row["status"] not in ("imported", "ready_to_invite", "invited", "invitation_expired"):
            raise HTTPException(409, "This record cannot be invited in its current state")
        profile = open_tree(row.get("profile") or {})
        if corrected_email:
            profile["email"] = _clip(corrected_email, 240).lower()
            await db.nt_legacy_patients.update_one({"id": row["id"]}, {"$set": {
                "profile": seal_tree(profile), "hasEmail": bool(profile.get("email")),
                "emailKey": _digest(profile.get("email")), "updatedAt": now_iso(),
            }})
        if not profile.get("email") and not profile.get("phone"):
            raise HTTPException(400, "Add a phone or email before sending an invitation")
        recent = await db.nt_legacy_invitations.count_documents({
            "patientId": row["id"],
            "createdAt": {"$gt": (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()},
        })
        if recent:
            raise HTTPException(429, "Wait before sending another invitation for this record")
        raw = secrets_token()
        invite_id = "liv-" + uuid.uuid4().hex[:12]
        expires = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()
        link = _invite_link(raw)
        subject, html = invitation_message(link)
        delivery = "manual"
        if profile.get("email"):
            message_id = await send_email(to=profile["email"], subject=subject, html=html)
            delivery = "sent" if message_id else "not-sent"
        await db.nt_legacy_invitations.update_many(
            {"patientId": row["id"], "usedAt": None, "revokedAt": None},
            {"$set": {"revokedAt": now_iso()}},
        )
        await db.nt_legacy_invitations.insert_one({
            "id": invite_id, "patientId": row["id"], "tokenHash": _token_hash(raw),
            "createdAt": now_iso(), "expiresAt": expires, "usedAt": None, "revokedAt": None,
            "delivery": delivery, "createdBy": user["email"],
        })
        await db.nt_legacy_patients.update_one({"id": row["id"]}, {"$set": {"status": "invited", "updatedAt": now_iso()}})
        await audit(user["email"], "legacy_invite", row["id"])
        return {"id": invite_id, "delivery": delivery, "expiresAt": expires, "link": link, "patientId": row["id"]}

    @r.post("/patients/{record_id}/invite")
    async def invite_one(record_id: str, request: Request):
        user = await owner(request)
        row = await db.nt_legacy_patients.find_one({"id": record_id})
        if not row:
            raise HTTPException(404, "Legacy record not found")
        body = await request.json()
        return await _issue(user, row, body.get("email"))

    @r.post("/invitations/preview")
    async def preview_invites(request: Request):
        await owner(request)
        body = await request.json()
        ids = body.get("ids") or []
        ready, blocked = [], []
        for record_id in ids:
            row = await db.nt_legacy_patients.find_one({"id": record_id}, {"_id": 0, "id": 1, "status": 1, "hasEmail": 1, "hasPhone": 1})
            if row and row["status"] in ("imported", "ready_to_invite", "invitation_expired") and (row.get("hasEmail") or row.get("hasPhone")):
                ready.append(record_id)
            else:
                blocked.append(record_id)
        return {"ready": ready, "blocked": blocked, "willSend": False}

    @r.post("/invitations/send")
    async def send_invites(request: Request):
        user = await owner(request)
        body = await request.json()
        if body.get("confirm") is not True:
            raise HTTPException(400, "Confirm the batch before invitations are sent")
        sent = []
        for record_id in body.get("ids") or []:
            row = await db.nt_legacy_patients.find_one({"id": record_id})
            if not row:
                continue
            sent.append(await _issue(user, row))
        return {"sent": [{"id": item["id"], "patientId": item["patientId"], "delivery": item["delivery"]} for item in sent]}

    @r.post("/invitations/{invite_id}/revoke")
    async def revoke_invite(invite_id: str, request: Request):
        user = await owner(request)
        updated = await db.nt_legacy_invitations.find_one_and_update(
            {"id": invite_id, "usedAt": None, "revokedAt": None},
            {"$set": {"revokedAt": now_iso()}},
        )
        if not updated:
            raise HTTPException(404, "Invitation not found")
        await audit(user["email"], "legacy_invite_revoke", updated["patientId"])
        return {"revoked": True}

    @r.post("/invitations/open")
    async def open_invite(request: Request):
        body = await request.json()
        row = await _load_invite(db, body.get("token") or "")
        return {"valid": True, "expiresAt": row["expiresAt"]}

    @r.post("/invitations/verify")
    async def verify_invite(request: Request, response: Response):
        body = await request.json()
        invite = await _load_invite(db, body.get("token") or "")
        patient = await db.nt_legacy_patients.find_one({"id": invite["patientId"]})
        profile = open_tree(patient.get("profile") or {})
        last = _clip(body.get("lastName"), 80).casefold()
        dob = _clip(body.get("dateOfBirth"), 20)
        if last != str(profile.get("lastName") or "").casefold() or dob != str(profile.get("dateOfBirth") or ""):
            raise HTTPException(401, "Those details do not match this invitation")
        email = _clip(body.get("email"), 240).lower()
        password = str(body.get("password") or "")
        if "@" not in email or len(password) < 8:
            raise HTTPException(400, "Enter an email and a password of at least 8 characters")
        users = db["nt_users"]
        existing = await users.find_one({"email": email})
        if existing and existing.get("role") != "client":
            raise HTTPException(409, "That email cannot be linked to a client account")
        if existing and not check_pw(password, existing["password_hash"]):
            raise HTTPException(401, "Those details do not match this invitation")
        other = await db.nt_legacy_patients.find_one({"clientId": existing["subject"]} if existing else {"clientId": "__none__"}, {"_id": 0, "id": 1})
        if existing and other and other["id"] != patient["id"]:
            raise HTTPException(409, "That account is already linked to a different legacy record")
        if patient.get("clientId") and (not existing or existing.get("subject") != patient["clientId"]):
            raise HTTPException(409, "This legacy record is already linked")
        if not existing:
            client_id = f"c-{uuid.uuid4().hex[:8]}"
            created = now_iso()
            client = {
                "id": client_id, "firstName": profile.get("firstName") or "", "lastName": profile.get("lastName") or "",
                "email": email, "phone": profile.get("phone") or "", "dob": profile.get("dateOfBirth") or "",
                "marketingConsent": False, "addresses": [], "insurance": [], "favorites": [],
                "preferredPractitioners": [], "language": "English", "hasProfile": False, "loyaltyPoints": 0,
                "onlineBookings": 0, "createdAt": created,
            }
            await coll("clients").insert_one(dict(client))
            user_row = {
                "id": str(uuid.uuid4()), "email": email, "password_hash": hash_pw(password),
                "name": f"{client['firstName']} {client['lastName']}".strip(), "role": "client",
                "subject": client_id, "createdAt": created,
            }
            await users.insert_one(dict(user_row))
        else:
            user_row = existing
            client_id = existing["subject"]
        if await db.nt_legacy_patients.find_one({"clientId": client_id, "id": {"$ne": patient["id"]}}):
            raise HTTPException(409, "That account is already linked to a different legacy record")
        await db.nt_legacy_patients.update_one({"id": patient["id"]}, {"$set": {
            "clientId": client_id, "status": "onboarding_in_progress", "updatedAt": now_iso(),
        }})
        await db.nt_legacy_invitations.update_one({"id": invite["id"]}, {"$set": {"usedAt": now_iso()}})
        sid, csrf, jti = secrets_token(), secrets_token(), secrets_token()
        now = datetime.now(timezone.utc)
        await db.nt_sessions.insert_one({
            "sid": sid, "userId": user_row["id"], "csrf": csrf, "refreshJti": jti, "revoked": False,
            "createdAt": now.isoformat(), "expiresAt": (now + timedelta(days=REFRESH_DAYS)).isoformat(),
        })
        write_auth_cookies(response, token(user_row["id"], "access", sid), token(user_row["id"], "refresh", sid, jti), csrf)
        await db.nt_legacy_events.insert_one({
            "id": "lev-" + uuid.uuid4().hex[:12], "at": now_iso(), "actor": email,
            "action": "legacy_linked", "recordId": patient["id"],
        })
        presented = await present(user_row, coll)
        draft = {
            "personal": {
                "firstName": profile.get("firstName") or "",
                "lastName": profile.get("lastName") or "",
                "preferredName": "",
                "phone": profile.get("phone") or "",
                "email": email,
                "dateOfBirth": profile.get("dateOfBirth") or "",
                "language": "English",
            },
            "emergency": {"name": "", "phone": ""},
            "address": {"line": profile.get("address") or "", "confirmed": False},
            "health": {},
            "insurance": [],
            "consents": {},
        }
        await db.nt_legacy_onboarding.update_one(
            {"patientId": patient["id"]},
            {"$setOnInsert": {"id": "lob-" + uuid.uuid4().hex[:12], "patientId": patient["id"], "clientId": client_id, "step": 2, "draft": seal_tree(draft), "createdAt": now_iso()}},
            upsert=True,
        )
        return {"linked": True, "status": "onboarding_in_progress", "user": presented}

    @r.post("/patients/{record_id}/link")
    async def link_patient(record_id: str, request: Request):
        user = await owner(request)
        body = await request.json()
        client_id = _clip(body.get("clientId"), 40)
        row = await db.nt_legacy_patients.find_one({"id": record_id})
        if not row or not client_id:
            raise HTTPException(404, "Legacy record not found")
        client = await coll("clients").find_one({"id": client_id}, {"_id": 0, "id": 1})
        if not client:
            raise HTTPException(404, "Client not found")
        other = await db.nt_legacy_patients.find_one({"clientId": client_id, "id": {"$ne": record_id}}, {"_id": 0, "id": 1})
        if other or (row.get("clientId") and row["clientId"] != client_id):
            raise HTTPException(409, "That account is already linked to a different legacy record")
        await db.nt_legacy_patients.update_one({"id": record_id}, {"$set": {"clientId": client_id, "status": "needs_review", "updatedAt": now_iso()}})
        await audit(user["email"], "legacy_manual_link", record_id)
        return {"linked": True, "status": "needs_review"}

    async def _mine(request: Request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        row = await db.nt_legacy_patients.find_one({"clientId": user.get("subject")})
        if not row:
            raise HTTPException(404, "No legacy onboarding is linked to this account")
        return user, row

    @r.get("/onboarding")
    async def read_onboarding(request: Request):
        _user, patient = await _mine(request)
        draft_row = await db.nt_legacy_onboarding.find_one({"patientId": patient["id"]}, {"_id": 0})
        draft = open_tree((draft_row or {}).get("draft") or {})
        return {"step": (draft_row or {}).get("step") or 2, "status": patient["status"], "draft": draft}

    @r.patch("/onboarding")
    async def save_onboarding(request: Request):
        user, patient = await _mine(request)
        if patient["status"] not in ("onboarding_in_progress", "needs_review"):
            raise HTTPException(409, "Onboarding can no longer be edited")
        body = await request.json()
        current = await db.nt_legacy_onboarding.find_one({"patientId": patient["id"]})
        draft = open_tree((current or {}).get("draft") or {})
        for key in ("personal", "emergency", "address", "health"):
            if isinstance(body.get(key), dict):
                draft[key] = body[key]
        if isinstance(body.get("insurance"), list):
            draft["insurance"] = body["insurance"][:6]
        if isinstance(body.get("consents"), dict):
            draft["consents"] = body["consents"]
        step = int(body.get("step") or (current or {}).get("step") or 2)
        await db.nt_legacy_onboarding.update_one(
            {"patientId": patient["id"]},
            {"$set": {"draft": seal_tree(draft), "step": step, "updatedAt": now_iso(), "clientId": user["subject"]}},
            upsert=True,
        )
        return {"saved": True, "step": step}

    @r.post("/onboarding/documents")
    async def upload_document(request: Request, upload: UploadFile = File(...), side: str = "front"):
        from config import document_uploads_enabled
        if not document_uploads_enabled():
            raise HTTPException(403, "Document uploads are turned off")
        user, patient = await _mine(request)
        data = await upload.read()
        if len(data) > 8_000_000:
            raise HTTPException(413, "That file is too large")
        if side not in ("front", "back", "other"):
            side = "other"
        result = "rejected"
        try:
            result = assess(data)
        except ScannerUnavailable:
            result = "quarantined"
        released = result == "clean"
        file_id = "lfile-" + uuid.uuid4().hex[:12]
        await db.nt_legacy_files.insert_one({
            "id": file_id, "patientId": patient["id"], "clientId": user["subject"],
            "side": side, "name": _clip(upload.filename, 80), "scanStatus": "clean" if released else "quarantined",
            "scanDetail": result, "bytes": seal_bytes(data), "createdAt": now_iso(),
        })
        await db.nt_legacy_patients.update_one({"id": patient["id"]}, {"$inc": {"fileCount": 1}})
        return {"id": file_id, "scanStatus": "clean" if released else "quarantined", "released": released}

    @r.post("/onboarding/documents/{file_id}/scan")
    async def scan_document(file_id: str, request: Request):
        _user, patient = await _mine(request)
        row = await db.nt_legacy_files.find_one({"id": file_id, "patientId": patient["id"]})
        if not row:
            raise HTTPException(404, "Document not found")
        try:
            result = assess(open_bytes(row["bytes"]))
        except ScannerUnavailable as exc:
            raise HTTPException(503, "Malware scanning is unavailable. The file stays in quarantine.") from exc
        status = "clean" if result == "clean" else "quarantined"
        await db.nt_legacy_files.update_one({"id": file_id}, {"$set": {"scanStatus": status, "scanDetail": result}})
        return {"scanStatus": status, "released": status == "clean"}

    @r.get("/onboarding/documents/{file_id}")
    async def download_document(file_id: str, request: Request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        row = await db.nt_legacy_files.find_one({"id": file_id})
        if not row:
            raise HTTPException(404, "Document not found")
        allowed = user.get("role") == "owner" or user.get("subject") == row.get("clientId")
        if not allowed:
            raise HTTPException(403, "You cannot open this document")
        if row.get("scanStatus") != "clean":
            raise HTTPException(409, "This document stays in quarantine until a malware scan marks it clean")
        from fastapi.responses import Response as Raw
        return Raw(open_bytes(row["bytes"]), media_type="application/octet-stream")

    @r.delete("/onboarding/documents/{file_id}")
    async def remove_document(file_id: str, request: Request):
        _user, patient = await _mine(request)
        removed = await db.nt_legacy_files.delete_one({"id": file_id, "patientId": patient["id"], "scanStatus": {"$ne": "clean"}})
        if not removed.deleted_count:
            found = await db.nt_legacy_files.find_one({"id": file_id, "patientId": patient["id"]})
            if found and found.get("scanStatus") == "clean":
                await db.nt_legacy_files.delete_one({"id": file_id})
            elif not found:
                raise HTTPException(404, "Document not found")
        return {"removed": True}

    @r.post("/onboarding/submit")
    async def submit_onboarding(request: Request):
        user, patient = await _mine(request)
        body = await request.json()
        current = await db.nt_legacy_onboarding.find_one({"patientId": patient["id"]})
        draft = open_tree((current or {}).get("draft") or {})
        if isinstance(body.get("draft"), dict):
            draft.update(body["draft"])
        consents = draft.get("consents") or {}
        if consents.get("treatment") is not True or consents.get("privacy") is not True:
            raise HTTPException(400, "Privacy and treatment consent are required")
        version = _clip((body.get("version") or "2026-1"), 40)
        if patient["status"] in ("submitted", "needs_review"):
            await db.nt_consents.insert_one({
                "id": "con-" + uuid.uuid4().hex[:12], "clientId": user["subject"], "kind": "treatment",
                "version": version, "acknowledged": True, "at": now_iso(), "withdrawnAt": None,
                "practitionerVisible": True, "appointmentId": None, "legacyRecordId": patient["id"],
            })
            return {"status": patient["status"], "consentVersion": version, "intakeVersion": None}
        if patient["status"] != "onboarding_in_progress":
            raise HTTPException(409, "Onboarding can no longer be edited")
        health = draft.get("health") or {}
        if not any(str(health.get(key) or "").strip() for key in ("allergies", "medications", "concerns", "contraindications")):
            raise HTTPException(400, "Health intake is incomplete")
        health = draft.get("health") or {}
        intake_version = await db.nt_intake.count_documents({"clientId": user["subject"]}) + 1
        intake = {
            "id": "in-" + uuid.uuid4().hex[:12], "clientId": user["subject"], "version": intake_version,
            "allergies": _clip(health.get("allergies"), 2000), "medications": _clip(health.get("medications"), 2000),
            "concerns": _clip(health.get("concerns"), 2000), "preferences": _clip(health.get("preferences"), 2000),
            "contraindications": _clip(health.get("contraindications"), 2000), "at": now_iso(),
        }
        await db.nt_intake.insert_one(seal_tree(dict(intake)))
        for kind in ("treatment", "informed"):
            await db.nt_consents.insert_one({
                "id": "con-" + uuid.uuid4().hex[:12], "clientId": user["subject"], "kind": kind,
                "version": version, "acknowledged": True, "at": now_iso(), "withdrawnAt": None,
                "practitionerVisible": True, "appointmentId": None, "legacyRecordId": patient["id"],
            })
        await db.nt_legacy_events.insert_one({
            "id": "lev-" + uuid.uuid4().hex[:12], "at": now_iso(), "actor": user["email"],
            "action": "legacy_consent", "recordId": patient["id"], "version": version,
            "privacy": True, "marketing": bool(consents.get("marketing")),
        })
        files = await db.nt_legacy_files.count_documents({"patientId": patient["id"], "scanStatus": {"$ne": "clean"}})
        status = "needs_review" if files else "submitted"
        await db.nt_legacy_patients.update_one({"id": patient["id"]}, {"$set": {"status": status, "updatedAt": now_iso()}})
        if consents.get("marketing") is True:
            await coll("clients").update_one({"id": user["subject"]}, {"$set": {"marketingConsent": True}})
        return {"status": status, "intakeVersion": intake_version, "consentVersion": version}

    @r.post("/patients/{record_id}/activate")
    async def activate(record_id: str, request: Request):
        user = await owner(request)
        row = await db.nt_legacy_patients.find_one({"id": record_id})
        if not row or row["status"] not in ("submitted", "needs_review"):
            raise HTTPException(409, "This record is not ready to activate")
        await db.nt_legacy_patients.update_one({"id": record_id}, {"$set": {"status": "activated", "updatedAt": now_iso()}})
        await audit(user["email"], "legacy_activate", record_id)
        ledger = await db.nt_ledger.count_documents({"clientId": row.get("clientId")})
        return {"status": "activated", "ledgerLinesForClient": ledger}

    return r


def _authorized(body):
    if body.get("backupConfirmed") is not True or body.get("authorize") is not True:
        raise HTTPException(403, "Backup confirmation and owner authorization are required")


async def _read_source():
    url = (os.environ.get("LEGACY_MONGO_URL") or "").strip()
    name = (os.environ.get("LEGACY_DB_NAME") or "").strip()
    if not url or not name:
        raise HTTPException(409, "Legacy source is not configured")
    from motor.motor_asyncio import AsyncIOMotorClient
    source = AsyncIOMotorClient(url, serverSelectionTimeoutMS=4000)
    try:
        names = await source[name].list_collection_names()
        if any(re.search(r"invoice|payment|ledger", item, re.I) for item in names):
            raise HTTPException(409, "Source invoice collections need an approved field map before they can be read")
        rows = await source[name].patients.find({}, {"_id": 0}).to_list(5000)
    finally:
        source.close()
    return rows, []


async def _prepare(db, records, invoices, dry, actor="owner"):
    ledger_before = await db.nt_ledger.count_documents({})
    batch_id = "lb-" + uuid.uuid4().hex[:12]
    imported = 0
    skipped = 0
    duplicates = 0
    needs_contact = 0
    embedded = []
    seen = set()
    prepared = []
    for raw in records:
        source_id, profile, extra = map_patient(raw)
        embedded.extend(extra)
        if source_id in seen:
            skipped += 1
            continue
        seen.add(source_id)
        source_key = f"{SOURCE_DATABASE}:{source_id}"
        existing = await db.nt_legacy_patients.find_one({"sourceKey": source_key}, {"_id": 0, "id": 1})
        if existing:
            skipped += 1
            continue
        email_key = _digest(profile.get("email"))
        phone_key = _phone_key(profile.get("phone"))
        identity = _digest("|".join([profile.get("lastName") or "", profile.get("dateOfBirth") or ""]))
        duplicate_of = None
        ors = []
        if email_key:
            ors.append({"emailKey": email_key})
        if phone_key:
            ors.append({"phoneKey": phone_key})
        if identity and profile.get("lastName") and profile.get("dateOfBirth"):
            ors.append({"identityKey": identity})
        if ors:
            prior = await db.nt_legacy_patients.find_one({"$or": ors}, {"_id": 0, "id": 1})
            if not prior:
                for item in prepared:
                    if email_key and item.get("emailKey") == email_key:
                        prior = item
                        break
                    if phone_key and item.get("phoneKey") == phone_key:
                        prior = item
                        break
                    if identity and item.get("identityKey") == identity:
                        prior = item
                        break
            if prior:
                duplicate_of = prior["id"]
                duplicates += 1
        status = _status_for(profile, duplicate_of)
        if status == "needs_contact_review":
            needs_contact += 1
        prepared.append({
            "id": "leg-" + uuid.uuid4().hex[:12],
            "sourceDatabase": SOURCE_DATABASE,
            "sourceId": source_id,
            "sourceKey": source_key,
            "batchId": batch_id,
            "status": status,
            "hasEmail": bool(profile.get("email")),
            "hasPhone": bool(profile.get("phone")),
            "emailKey": email_key,
            "phoneKey": phone_key,
            "identityKey": identity,
            "duplicateOf": duplicate_of,
            "clientId": None,
            "notes": "",
            "invoiceCount": 0,
            "fileCount": 0,
            "profile": seal_tree(profile),
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
        })
        imported += 1
    invoice_rows = []
    for raw in invoices or []:
        if not isinstance(raw, dict) or not raw.get("number") or raw.get("totalCents") is None:
            continue
        source_id = _clip(raw.get("sourceId"), 80)
        patient_source = _clip(raw.get("sourcePatientId"), 80)
        if not source_id or not patient_source:
            continue
        invoice_rows.append({
            "id": "linv-" + uuid.uuid4().hex[:12],
            "sourceKey": f"{SOURCE_DATABASE}:invoice:{source_id}",
            "sourceId": source_id,
            "sourcePatientId": patient_source,
            "batchId": batch_id,
            "number": _clip(raw.get("number"), 40),
            "issuedOn": _clip(raw.get("issuedOn"), 40),
            "currency": _clip(raw.get("currency") or "CAD", 8),
            "totalCents": int(raw.get("totalCents")),
            "state": _clip(raw.get("state") or "unknown", 40),
            "service": _clip(raw.get("service"), 240),
            "countsAsRevenue": False,
            "ledgerPosted": False,
            "patientId": None,
        })
    if not dry and prepared:
        await db.nt_legacy_patients.insert_many(prepared)
        by_source = {row["sourceId"]: row["id"] for row in prepared}
        stored_invoices = []
        for invoice in invoice_rows:
            patient_id = by_source.get(invoice["sourcePatientId"])
            if not patient_id:
                continue
            invoice["patientId"] = patient_id
            stored_invoices.append(invoice)
        if stored_invoices:
            try:
                await db.nt_legacy_invoices.insert_many(stored_invoices)
            except DuplicateKeyError:
                pass
            for invoice in stored_invoices:
                await db.nt_legacy_patients.update_one({"id": invoice["patientId"]}, {"$inc": {"invoiceCount": 1}})
        await db.nt_legacy_batches.insert_one({
            "id": batch_id,
            "at": now_iso(),
            "actor": actor,
            "received": len(records),
            "imported": imported,
            "skipped": skipped,
            "duplicates": duplicates,
            "needsContactReview": needs_contact,
            "invoicesImported": len(stored_invoices) if prepared else 0,
            "invoicesFoundInSource": bool(invoice_rows),
            "embeddedInvoiceFields": sorted(set(embedded)),
            "ledgerBefore": ledger_before,
            "ledgerAfter": await db.nt_ledger.count_documents({}),
            "rolledBack": False,
            "message": None if invoice_rows else INVOICE_MESSAGE,
        })
        await db.nt_legacy_events.insert_one({
            "id": "lev-" + uuid.uuid4().hex[:12], "at": now_iso(), "actor": actor,
            "action": "legacy_import", "recordId": batch_id,
        })
    ledger_after = await db.nt_ledger.count_documents({})
    return {
        "batchId": batch_id if not dry and prepared else None,
        "dryRun": dry,
        "received": len(records),
        "imported": imported,
        "skipped": skipped,
        "duplicates": duplicates,
        "needsContactReview": needs_contact,
        "invoicesPrepared": len(invoice_rows),
        "invoicesFoundInSource": bool(invoice_rows),
        "embeddedInvoiceFields": sorted(set(embedded)),
        "ledgerPostings": ledger_after - ledger_before,
        "message": None if invoice_rows else INVOICE_MESSAGE,
    }
