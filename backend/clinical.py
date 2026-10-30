"""Clinical records that stay separate from the ledger: amendments, intake, consent, and credentials."""
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from fieldcrypto import open_tree, seal_tree
from rbac import has_strict_role
from staff_identity import (
    can_administer_credentials,
    can_review_clinical_compliance,
    is_treating_clinician,
)

TZ = ZoneInfo("America/Edmonton")
INTAKE_FIELDS = ("allergies", "medications", "concerns", "preferences", "contraindications")
AMENDMENT_FIELDS = (
    "subjective", "objective", "assessment", "plan", "treatmentPerformed",
    "clientResponse", "homeCare", "followUp", "contraindications",
)
CONSENT_KINDS = ("treatment", "informed", "mobile")
CREDENTIAL_KINDS = ("association", "registration", "liability", "membership", "municipal", "cpr", "other")


def _today():
    return datetime.now(TZ).date()


def _clip(value, limit=500):
    return str(value or "").strip()[:limit]


async def ensure_clinical(db):
    await db.nt_soap_amendments.create_index("id", unique=True)
    await db.nt_intake.create_index("id", unique=True)
    await db.nt_consents.create_index("id", unique=True)
    await db.nt_credentials.create_index("id", unique=True)
    await db.nt_snippets.create_index("id", unique=True)
    await db.nt_mfa.create_index("userId", unique=True)


async def clear_clinical(db):
    for name in ("nt_soap_amendments", "nt_intake", "nt_consents", "nt_credentials", "nt_snippets", "nt_clinical_access", "nt_mfa"):
        await db[name].delete_many({})


def build_clinical_router(db, coll, add_audit, user_from):
    r = APIRouter(prefix="/api")

    async def actor(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def log_access(user, action, subject_id):
        await db.nt_clinical_access.insert_one({
            "id": "acc-" + uuid.uuid4().hex[:12],
            "at": datetime.now(TZ).isoformat(),
            "actorId": user.get("id"),
            "action": action,
            "subjectId": subject_id,
        })

    async def clinical(request, appt_id):
        user = await actor(request)
        appt = await coll("appointments").find_one({"id": appt_id}, {"_id": 0})
        if not appt or not is_treating_clinician(user, appt):
            raise HTTPException(403, "Clinical notes restricted to the treating practitioner")
        return user, appt

    async def step_up(user):
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        if not settings.get("requireMfaForPrivileged") and not settings.get("mfaEnforcePrivileged"):
            return
        session = await db.nt_sessions.find_one({"sid": user.get("sid")}) if user.get("sid") else None
        if not session or not session.get("mfaAt"):
            raise HTTPException(403, "Confirm your authenticator before this action")

    @r.get("/soap/{appt_id}")
    async def read_soap(appt_id: str, request: Request):
        user, _appt = await clinical(request, appt_id)
        note = open_tree(await coll("soap").find_one({"appointmentId": appt_id}, {"_id": 0}))
        amendments = [open_tree(row) for row in await db.nt_soap_amendments.find({"appointmentId": appt_id}, {"_id": 0}).sort("at", 1).to_list(50)]
        await log_access(user, "soap_read", appt_id)
        return {"note": note, "amendments": amendments}

    @r.post("/soap/{appt_id}/amendments")
    async def amend_soap(appt_id: str, request: Request):
        user, _appt = await clinical(request, appt_id)
        note = await coll("soap").find_one({"appointmentId": appt_id}, {"_id": 0})
        if not note or note.get("status") != "signed":
            raise HTTPException(409, "Amendments are recorded after a note is signed")
        body = await request.json()
        reason = _clip(body.get("reason"), 240)
        if len(reason) < 3:
            raise HTTPException(400, "An amendment needs a reason")
        fields = {key: _clip(body.get(key)) for key in AMENDMENT_FIELDS if _clip(body.get(key))}
        if not fields:
            raise HTTPException(400, "Add the correction to record")
        row = {
            "id": "amd-" + uuid.uuid4().hex[:12],
            "appointmentId": appt_id,
            "authorId": user.get("id"),
            "authorName": user.get("name"),
            "at": datetime.now(TZ).isoformat(),
            "reason": reason,
            "fields": fields,
        }
        await db.nt_soap_amendments.insert_one(seal_tree(dict(row)))
        await log_access(user, "soap_amend", appt_id)
        await add_audit(user.get("name") or "practitioner", f"SOAP amendment recorded for {appt_id}", appt_id)
        stored = await coll("soap").find_one({"appointmentId": appt_id}, {"_id": 0})
        return {"note": stored, "amendment": {k: v for k, v in row.items() if k != "_id"}}

    @r.get("/clinical/snippets")
    async def list_snippets(request: Request):
        user = await actor(request)
        if not has_strict_role(user, "practitioner") or not user.get("subject"):
            raise HTTPException(403, "Not permitted")
        rows = await db.nt_snippets.find({"practitionerId": user.get("subject")}, {"_id": 0}).to_list(100)
        return rows

    @r.post("/clinical/snippets")
    async def create_snippet(request: Request):
        user = await actor(request)
        if not has_strict_role(user, "practitioner") or not user.get("subject"):
            raise HTTPException(403, "Snippets belong to the practitioner who writes them")
        body = await request.json()
        label, text = _clip(body.get("label"), 80), _clip(body.get("text"), 240)
        if len(label) < 2 or len(text) < 2:
            raise HTTPException(400, "A snippet needs a label and text")
        row = {"id": "snip-" + uuid.uuid4().hex[:10], "practitionerId": user.get("subject"), "label": label, "text": text}
        await db.nt_snippets.insert_one(dict(row))
        return row

    @r.post("/intake")
    async def submit_intake(request: Request):
        user = await actor(request)
        if user["role"] != "client":
            raise HTTPException(403, "Clients submit their own intake")
        body = await request.json()
        fields = {key: _clip(body.get(key)) for key in INTAKE_FIELDS}
        if not any(fields.values()):
            raise HTTPException(400, "Add the health details you want on file")
        from session_care import append_intake
        row = await append_intake(db, user["subject"], {**fields, "source": "quick-update"}, carry=True)
        await log_access(user, "intake_submit", user["subject"])
        return {k: v for k, v in row.items() if k != "_id"}

    async def intake_visible(user, client_id):
        if user.get("role") == "client" and user.get("subject") == client_id:
            return True
        # Full intake is a care record. Business owners and reception use precautions only.
        if has_strict_role(user, "practitioner") and user.get("subject"):
            visit = await coll("appointments").find_one(
                {"clientId": client_id, "practitionerId": user.get("subject")}, {"_id": 1},
            )
            return bool(visit)
        return False

    @r.get("/intake/{client_id}")
    async def read_intake(client_id: str, request: Request):
        user = await actor(request)
        if not await intake_visible(user, client_id):
            raise HTTPException(403, "Intake is limited to the client and the treating practitioner")
        rows = [open_tree(row) for row in await db.nt_intake.find({"clientId": client_id}, {"_id": 0}).sort("version", 1).to_list(50)]
        await log_access(user, "intake_read", client_id)
        return rows

    @r.get("/intake/{client_id}/precautions")
    async def precautions(client_id: str, request: Request):
        user = await actor(request)
        if user["role"] == "desk":
            rows = await db.nt_intake.find({"clientId": client_id}, {"_id": 0}).sort("version", -1).to_list(1)
            latest = open_tree(rows[0]) if rows else None
            return {"allergies": (latest or {}).get("allergies") or "", "contraindications": (latest or {}).get("contraindications") or ""}
        if not await intake_visible(user, client_id):
            raise HTTPException(403, "Not permitted")
        rows = await db.nt_intake.find({"clientId": client_id}, {"_id": 0}).sort("version", -1).to_list(1)
        latest = open_tree(rows[0]) if rows else None
        return {"allergies": (latest or {}).get("allergies") or "", "contraindications": (latest or {}).get("contraindications") or ""}

    @r.get("/consents")
    async def list_consents(request: Request):
        user = await actor(request)
        if user.get("role") == "client":
            query = {"clientId": user.get("subject")}
        elif has_strict_role(user, "practitioner") and user.get("subject"):
            query = {"practitionerVisible": True, "clientId": {"$in": await _client_ids(user)}}
        else:
            raise HTTPException(403, "Not permitted")
        return await db.nt_consents.find(query, {"_id": 0}).sort("at", 1).to_list(100)

    async def _client_ids(user):
        rows = await coll("appointments").find({"practitionerId": user.get("subject")}, {"clientId": 1}).to_list(200)
        return list({row.get("clientId") for row in rows if row.get("clientId")})

    @r.post("/consents")
    async def record_consent(request: Request):
        user = await actor(request)
        if user["role"] != "client":
            raise HTTPException(403, "The client records their own consent")
        body = await request.json()
        kind = body.get("kind")
        if kind not in CONSENT_KINDS or body.get("acknowledged") is not True:
            raise HTTPException(400, "Choose the consent and acknowledge it")
        row = {
            "id": "con-" + uuid.uuid4().hex[:12],
            "clientId": user["subject"],
            "kind": kind,
            "version": _clip(body.get("version") or "2026-1", 40),
            "acknowledged": True,
            "at": datetime.now(TZ).isoformat(),
            "withdrawnAt": None,
            "practitionerVisible": True,
            "appointmentId": _clip(body.get("appointmentId"), 40) or None,
        }
        await db.nt_consents.insert_one(dict(row))
        return {k: v for k, v in row.items() if k != "_id"}

    @r.post("/consents/{consent_id}/withdraw")
    async def withdraw_consent(consent_id: str, request: Request):
        user = await actor(request)
        if user["role"] != "client":
            raise HTTPException(403, "The client withdraws their own consent")
        updated = await db.nt_consents.find_one_and_update(
            {"id": consent_id, "clientId": user["subject"], "withdrawnAt": None},
            {"$set": {"withdrawnAt": datetime.now(TZ).isoformat()}},
        )
        if not updated:
            raise HTTPException(404, "Consent not found")
        return {"withdrawn": True}

    @r.get("/credentials")
    async def list_credentials(request: Request):
        user = await actor(request)
        if has_strict_role(user, "owner"):
            return await db.nt_credentials.find({}, {"_id": 0}).to_list(200)
        if has_strict_role(user, "practitioner") and user.get("subject"):
            return await db.nt_credentials.find({"practitionerId": user["subject"]}, {"_id": 0}).to_list(50)
        raise HTTPException(403, "Credential review is limited to the owner and the treating practitioner")

    @r.post("/credentials")
    async def add_credential(request: Request):
        user = await actor(request)
        body = await request.json()
        practitioner_id = body.get("practitionerId")
        if has_strict_role(user, "owner"):
            if not practitioner_id:
                raise HTTPException(400, "Choose the practitioner and credential")
        elif has_strict_role(user, "practitioner"):
            practitioner_id = user.get("subject")
            if not practitioner_id or (body.get("practitionerId") and body.get("practitionerId") != practitioner_id):
                raise HTTPException(403, "You can only add credentials for your own profile")
        else:
            raise HTTPException(403, "Only the owner or the practitioner may record credentials")
        if not can_administer_credentials(user):
            raise HTTPException(403, "Only the owner or the practitioner may record credentials")
        if body.get("kind") not in CREDENTIAL_KINDS or not practitioner_id:
            raise HTTPException(400, "Choose the practitioner and credential")
        from onboarding import acceptable_identifier, expiry_date
        if not acceptable_identifier(body.get("identifier")):
            raise HTTPException(400, "Enter the real registration or policy number. A placeholder is not accepted.")
        if expiry_date(body.get("expiresOn")) is None:
            raise HTTPException(400, "Enter the expiry date")
        effective = body.get("effectiveOn")
        if effective and expiry_date(effective) is None:
            raise HTTPException(400, "Enter a valid effective date")
        row = {
            "id": "cred-" + uuid.uuid4().hex[:12],
            "practitionerId": practitioner_id,
            "kind": body["kind"],
            "identifier": _clip(body.get("identifier"), 80),
            "issuingAuthority": _clip(body.get("issuingAuthority"), 120),
            "province": _clip(body.get("province"), 40),
            "provider": _clip(body.get("provider"), 120),
            "effectiveOn": _clip(effective, 10) if effective else None,
            "expiresOn": _clip(body.get("expiresOn"), 10),
            "documentNote": _clip(body.get("documentNote"), 200),
            "status": "uploaded",
            "verifiedAt": None,
            "verifiedBy": None,
            "submittedBy": user.get("name"),
            "at": datetime.now(TZ).isoformat(),
        }
        await db.nt_credentials.insert_one(dict(row))
        await add_audit(user.get("name") or "staff", f"Credential uploaded: {row['kind']} for {practitioner_id}", None)
        row.pop("_id", None)
        return row

    @r.post("/credentials/{credential_id}/verify")
    async def verify_credential(credential_id: str, request: Request):
        user = await actor(request)
        if not has_strict_role(user, "owner"):
            raise HTTPException(403, "Only the owner verifies a credential")
        await step_up(user)
        from onboarding import acceptable_identifier
        existing = await db.nt_credentials.find_one({"id": credential_id}, {"_id": 0, "identifier": 1})
        if not existing:
            raise HTTPException(404, "Credential not found")
        if not acceptable_identifier(existing.get("identifier")):
            raise HTTPException(400, "A placeholder number cannot be verified")
        updated = await db.nt_credentials.find_one_and_update(
            {"id": credential_id},
            {"$set": {"status": "verified", "verifiedAt": datetime.now(TZ).isoformat(), "verifiedBy": user.get("name")}},
        )
        if not updated:
            raise HTTPException(404, "Credential not found")
        return {"verified": True}

    @r.get("/credentials/reminders")
    async def credential_reminders(request: Request):
        user = await actor(request)
        if not has_strict_role(user, "owner"):
            raise HTTPException(403, "Only the owner reviews renewal reminders")
        settings = await coll("settings").find_one({"id": "app"}, {"_id": 0}) or {}
        windows = settings.get("credentialReminderDays") or [60, 30, 14, 7]
        horizon = _today() + timedelta(days=max(int(day) for day in windows))
        due = []
        async for row in db.nt_credentials.find({}, {"_id": 0}):
            try:
                expires = datetime.strptime(row.get("expiresOn") or "", "%Y-%m-%d").date()
            except ValueError:
                continue
            if expires <= horizon:
                due.append({**row, "verified": row.get("status") == "verified"})
        return {"windows": windows, "due": due}

    @r.get("/appointments/{appt_id}/mobile-brief")
    async def mobile_brief(appt_id: str, request: Request):
        user, appt = await clinical(request, appt_id)
        service = await coll("services").find_one({"slug": appt.get("serviceSlug")}, {"_id": 0, "name": 1, "equipment": 1}) or {}
        rows = await db.nt_intake.find({"clientId": appt.get("clientId")}, {"_id": 0}).sort("version", -1).to_list(1)
        latest = open_tree(rows[0]) if rows else None
        from session_care import session_status
        readiness = await session_status(db, appt)
        address = appt.get("address") or {}
        await log_access(user, "mobile_brief", appt_id)
        return {
            "locationType": appt.get("locationType"),
            "addressLine": address.get("line") or "",
            "accessNotes": address.get("notes") or "",
            "equipment": service.get("equipment") or [],
            "serviceName": service.get("name") or "",
            "precautions": {"allergies": (latest or {}).get("allergies") or "", "contraindications": (latest or {}).get("contraindications") or ""},
            "consentOnFile": readiness["consentState"] == "signed",
            "intakeState": readiness["intakeState"],
            "restrictions": (readiness["consent"] or {}).get("restrictions"),
            "sharing": bool((appt.get("trip") or {}).get("sharing")),
        }

    @r.post("/notices/marketing")
    async def marketing_notice(request: Request):
        user = await actor(request)
        if not has_strict_role(user, "owner"):
            raise HTTPException(403, "Only the owner sends promotional messages")
        body = await request.json()
        client = await coll("clients").find_one({"id": body.get("clientId")}, {"_id": 0, "marketingConsent": 1})
        if not client or not client.get("marketingConsent"):
            raise HTTPException(403, "This client has not agreed to promotional messages")
        text = _clip(body.get("body"), 240)
        lowered = text.lower()
        if any(word in lowered for word in ("soap", "diagnosis", "contraindication", "medication")):
            raise HTTPException(400, "Promotional messages cannot include clinical details")
        if len(text) < 3:
            raise HTTPException(400, "Write the message")
        row = {
            "id": "ntc-" + uuid.uuid4().hex[:12],
            "dedupeKey": "marketing:" + uuid.uuid4().hex[:16],
            "recipientId": body["clientId"],
            "channel": "marketing",
            "kind": "promotion",
            "title": "A note from Nabitouch",
            "body": text,
            "at": datetime.now(TZ).isoformat(),
        }
        await db.nt_notices.insert_one(dict(row))
        return {"sent": True}

    @r.get("/notices/marketing")
    async def my_marketing(request: Request):
        user = await actor(request)
        if user["role"] != "client":
            raise HTTPException(403, "Not permitted")
        rows = await db.nt_notices.find({"recipientId": user.get("subject"), "channel": "marketing"}, {"_id": 0, "dedupeKey": 0}).to_list(20)
        return rows

    @r.get("/clinical/export/{client_id}")
    async def export_clinical(client_id: str, request: Request):
        user = await actor(request)
        if not can_review_clinical_compliance(user):
            raise HTTPException(403, "Clinical export is limited to the owner")
        await step_up(user)
        notes = await coll("soap").find({"clientId": client_id}, {"_id": 0, "appointmentId": 1, "status": 1, "signedAt": 1}).to_list(100)
        intake = [open_tree(row) for row in await db.nt_intake.find({"clientId": client_id}, {"_id": 0}).sort("version", 1).to_list(50)]
        consents = await db.nt_consents.find({"clientId": client_id}, {"_id": 0}).to_list(50)
        confirmations = [open_tree(row) for row in await db.nt_intake_confirmations.find({"clientId": client_id}, {"_id": 0}).sort("at", 1).to_list(500)]
        session_consents = [open_tree(row) for row in await db.nt_session_consents.find({"clientId": client_id}, {"_id": 0, "signature": 0}).sort("at", 1).to_list(500)]
        withdrawals = [open_tree(row) for row in await db.nt_consent_events.find({"clientId": client_id}, {"_id": 0}).sort("at", 1).to_list(500)]
        await log_access(user, "clinical_export", client_id)
        return JSONResponse({"notes": notes, "intake": intake, "consents": consents, "intakeConfirmations": confirmations,
                             "sessionConsents": session_consents, "consentWithdrawals": withdrawals}, headers={"Cache-Control": "no-store"})

    @r.get("/clinical/access")
    async def access_log(request: Request):
        user = await actor(request)
        if not can_review_clinical_compliance(user):
            raise HTTPException(403, "Only the owner reviews clinical access")
        rows = await db.nt_clinical_access.find({}, {"_id": 0}).sort("at", -1).to_list(50)
        return rows

    return r
