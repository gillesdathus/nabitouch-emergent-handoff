"""Smart intake (full baseline + per-visit confirmation) and session-specific e-signed consent. Every record is append-only."""
import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from fieldcrypto import open_tree, seal_tree

CONSENT_VERSION = "session-2026-1"
CONSENT_TEXT = (
    "I consent to the massage therapy treatment booked for this visit. My therapist will explain the treatment plan, "
    "its expected benefits and possible risks, such as temporary soreness, bruising or light-headedness. I may ask questions, "
    "limit the areas treated, ask for a change in pressure or draping, or withdraw my consent at any time, and treatment will stop. "
    "Sensitive areas are treated only with my separate, explicit consent. I have shared accurate health information and "
    "understand massage therapy is not a substitute for medical care."
)
CONSENT_HASH = hashlib.sha256(CONSENT_TEXT.encode()).hexdigest()
ACKNOWLEDGEMENTS = {
    "explained": "The treatment, benefits and risks for this visit were explained to me",
    "withdraw": "I can change or withdraw my consent at any time",
    "draping": "I understand draping will be used and only the area being treated is uncovered",
    "accurate": "My health information is accurate and up to date",
}
TEXT_FIELDS = (
    "allergies", "medications", "concerns", "preferences", "contraindications", "surgeries", "physician",
    "pregnancy", "conditionsOther", "emergencyName", "emergencyPhone", "emergencyRelation",
)
UPDATE_FIELDS = ("allergies", "medications", "concerns", "contraindications", "surgeries", "pregnancy", "conditionsOther")
PRESSURE = ("light", "medium", "firm")
DRAPING = ("standard", "extra", "clothed")
PREP_STATUSES = ("requested", "confirmed", "assigned", "preparing", "en_route", "arrived", "interrupted", "safety_hold")
GENERAL_QUESTIONS = [
    {"id": "unwell", "label": "Do you have a fever, or do you feel unwell today?", "kind": "yesno"},
    {"id": "today", "label": "Anything your therapist should know about today?", "kind": "text"},
]
SERVICE_QUESTIONS = {
    "prenatal": [
        {"id": "weeks", "label": "How many weeks pregnant are you?", "kind": "text"},
        {"id": "highRisk", "label": "Has your care provider flagged this pregnancy as high-risk?", "kind": "yesno"},
        {"id": "providerOk", "label": "Has your care provider said massage is okay for you?", "kind": "yesno"},
    ],
    "hot-stone": [
        {"id": "heat", "label": "Are you sensitive to heat, or is sensation reduced anywhere?", "kind": "yesno"},
        {"id": "skin", "label": "Any sunburn, broken skin or rash today?", "kind": "yesno"},
    ],
    "deep-tissue": [
        {"id": "thinners", "label": "Do you take blood thinners or bruise easily?", "kind": "yesno"},
        {"id": "injury", "label": "Any new injury in the last 72 hours?", "kind": "yesno"},
    ],
    "sports": [
        {"id": "injury", "label": "Any new injury in the last 72 hours?", "kind": "yesno"},
        {"id": "event", "label": "Do you have an event or competition in the next 48 hours?", "kind": "yesno"},
    ],
    "senior": [
        {"id": "transfer", "label": "Do you need help getting on or off the table?", "kind": "yesno"},
        {"id": "fragile", "label": "Is your skin fragile or does it tear easily?", "kind": "yesno"},
    ],
    "foot-reflexology": [{"id": "feet", "label": "Any foot wounds, infection or circulation problems?", "kind": "yesno"}],
    "scalp": [{"id": "head", "label": "Any scalp sensitivity, headache or migraine today?", "kind": "yesno"}],
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _clip(value, limit=500):
    return str(value or "").strip()[:limit]


def questions_for(slug):
    return SERVICE_QUESTIONS.get(slug or "", []) + GENERAL_QUESTIONS


def _answers(slug, raw):
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for q in questions_for(slug):
        value = raw.get(q["id"])
        if q["kind"] == "yesno":
            if value not in ("yes", "no"):
                raise HTTPException(400, f"Answer: {q['label']}")
            out[q["id"]] = value
        elif _clip(value, 300):
            out[q["id"]] = _clip(value, 300)
    return out


def _restrictions(raw):
    raw = raw if isinstance(raw, dict) else {}
    pressure = raw.get("pressureMax") or "firm"
    draping = raw.get("draping") or "standard"
    if pressure not in PRESSURE or draping not in DRAPING:
        raise HTTPException(400, "Choose a pressure limit and draping preference")
    areas = [_clip(item, 40) for item in (raw.get("avoidAreas") or []) if _clip(item, 40)][:12]
    return {
        "avoidAreas": areas,
        "pressureMax": pressure,
        "draping": draping,
        "sensitiveAreas": raw.get("sensitiveAreas") is True,
        "notes": _clip(raw.get("notes"), 300),
    }


async def ensure_session_care(db):
    for name in ("nt_intake_confirmations", "nt_session_consents", "nt_consent_events"):
        await db[name].create_index("id", unique=True)
        await db[name].create_index([("appointmentId", 1), ("at", -1)])
    await ensure_intake_versions(db)


async def ensure_intake_versions(db):
    try:
        await db.nt_intake.create_index([("clientId", 1), ("version", 1)], unique=True, name="intake_version_unique")
    except Exception:
        pass


async def append_intake(db, client_id, fields):
    for _attempt in range(3):
        rows = await db.nt_intake.find({"clientId": client_id}, {"_id": 0, "version": 1}).sort("version", -1).to_list(1)
        version = (rows[0]["version"] if rows else 0) + 1
        row = {"id": "in-" + uuid.uuid4().hex[:12], "clientId": client_id, "version": version, "at": now_iso(), **fields}
        try:
            await db.nt_intake.insert_one(seal_tree(dict(row)))
            return row
        except DuplicateKeyError:
            continue
    raise HTTPException(409, "Another health update was saved at the same moment. Reload and try again.")


async def clear_session_care(db):
    for name in ("nt_intake_confirmations", "nt_session_consents", "nt_consent_events"):
        await db[name].delete_many({})


async def latest_intake(db, client_id):
    rows = await db.nt_intake.find({"clientId": client_id}, {"_id": 0}).sort("version", -1).to_list(1)
    return open_tree(rows[0]) if rows else None


async def _latest(db, name, appt_id):
    rows = await db[name].find({"appointmentId": appt_id}, {"_id": 0}).sort("at", -1).to_list(1)
    return open_tree(rows[0]) if rows else None


async def session_status(db, appt):
    intake = await latest_intake(db, appt.get("clientId"))
    confirmation = await _latest(db, "nt_intake_confirmations", appt["id"])
    consent = await _latest(db, "nt_session_consents", appt["id"])
    withdrawals = [open_tree(row) for row in await db.nt_consent_events.find({"appointmentId": appt["id"]}, {"_id": 0}).sort("at", 1).to_list(50)]
    last_withdrawal = withdrawals[-1] if withdrawals else None
    active = bool(consent) and (not last_withdrawal or last_withdrawal["at"] < consent["at"])
    if not intake:
        intake_state = "missing"
    elif not intake.get("baseline"):
        intake_state = "baseline_needed"
    elif confirmation and confirmation.get("intakeVersion") == intake.get("version"):
        intake_state = "confirmed"
    else:
        intake_state = "confirm_needed"
    consent_state = "signed" if active else ("withdrawn" if consent else "missing")
    return {
        "intake": intake, "confirmation": confirmation, "consent": consent if active else None,
        "lastConsent": consent, "withdrawals": withdrawals, "intakeState": intake_state, "consentState": consent_state,
        "ready": intake_state == "confirmed" and active,
    }


async def assert_session_ready(db, appt):
    status = await session_status(db, appt)
    if status["intakeState"] != "confirmed":
        raise HTTPException(409, "The client has not confirmed their health intake for this visit. Treatment cannot start yet.")
    if status["consentState"] != "signed":
        raise HTTPException(409, "Signed session consent is required before treatment starts.")


async def consent_snapshot(db, appt):
    status = await session_status(db, appt)
    consent = status["consent"]
    if not consent:
        return None
    return {"consentId": consent["id"], "signedAt": consent["at"], "restrictions": consent.get("restrictions") or {}}


def _public_consent(row, with_signature=False):
    if not row:
        return None
    keep = ("id", "at", "typedName", "version", "textHash", "restrictions", "acknowledgements", "intakeVersion", "signatureSha256")
    out = {key: row.get(key) for key in keep}
    if with_signature:
        out["signature"] = row.get("signature")
    return out


def build_session_care_router(db, coll, add_audit, user_from, apply_transition):
    r = APIRouter(prefix="/api")

    async def viewer(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def appointment_for(user, appt_id, roles=("client", "practitioner", "owner", "desk")):
        appt = await coll("appointments").find_one({"id": appt_id}, {"_id": 0})
        if not appt:
            raise HTTPException(404, "Appointment not found")
        role = user["role"]
        if role not in roles:
            raise HTTPException(403, "Not permitted")
        if role == "client" and appt.get("clientId") != user.get("subject"):
            raise HTTPException(403, "Not permitted")
        if role == "practitioner" and appt.get("practitionerId") != user.get("subject"):
            raise HTTPException(403, "Limited to the treating practitioner")
        return appt

    async def log(user, action, subject):
        await db.nt_clinical_access.insert_one({"id": "acc-" + uuid.uuid4().hex[:12], "at": now_iso(), "actorId": user.get("id"), "action": action, "subjectId": subject})

    async def shaped(user, appt):
        status = await session_status(db, appt)
        if user["role"] == "desk":
            return {"appointmentId": appt["id"], "ready": status["ready"], "intake": {"state": status["intakeState"]}, "consent": {"state": status["consentState"]}}
        intake, confirmation = status["intake"], status["confirmation"]
        body = {
            "appointmentId": appt["id"],
            "ready": status["ready"],
            "serviceSlug": appt.get("serviceSlug"),
            "questions": questions_for(appt.get("serviceSlug")),
            "intake": {
                "state": status["intakeState"],
                "version": (intake or {}).get("version"),
                "at": (intake or {}).get("at"),
                "latest": intake,
                "confirmedAt": (confirmation or {}).get("at"),
                "changed": (confirmation or {}).get("changed"),
                "changedFields": (confirmation or {}).get("changedFields") or [],
                "answers": (confirmation or {}).get("answers") or {},
            },
            "consent": {"state": status["consentState"], "record": _public_consent(status["consent"])},
            "withdrawals": [{key: row.get(key) for key in ("id", "at", "byRole", "byName", "reason", "duringSession")} for row in status["withdrawals"]],
            "restrictions": (status["consent"] or {}).get("restrictions"),
        }
        if user["role"] == "client":
            body["consentText"] = CONSENT_TEXT
            body["consentVersion"] = CONSENT_VERSION
            body["acknowledgements"] = ACKNOWLEDGEMENTS
        return body

    @r.get("/sessions/{appt_id}/readiness")
    async def readiness(appt_id: str, request: Request):
        user = await viewer(request)
        appt = await appointment_for(user, appt_id)
        if user["role"] in ("practitioner", "owner"):
            await log(user, "session_readiness_read", appt_id)
        return await shaped(user, appt)

    @r.post("/intake/baseline")
    async def baseline(request: Request):
        user = await viewer(request)
        if user["role"] != "client":
            raise HTTPException(403, "Clients submit their own health history")
        body = await request.json()
        fields = {key: _clip(body.get(key)) for key in TEXT_FIELDS}
        conditions = [_clip(item, 60) for item in (body.get("conditions") or []) if _clip(item, 60)][:20]
        if not conditions:
            raise HTTPException(400, "Tell us whether any of the listed conditions apply")
        if not fields["pregnancy"]:
            raise HTTPException(400, "Answer the pregnancy question")
        if len(fields["emergencyName"]) < 2 or len("".join(ch for ch in fields["emergencyPhone"] if ch.isdigit())) < 10:
            raise HTTPException(400, "Add an emergency contact name and a 10-digit phone number")
        appt = None
        if body.get("appointmentId"):
            appt = await appointment_for(user, _clip(body["appointmentId"], 60), ("client",))
        answers = _answers(appt.get("serviceSlug"), body.get("answers")) if appt else {}
        row = await append_intake(db, user["subject"], {"baseline": True, "source": "full-history", "conditions": conditions, **fields})
        version = row["version"]
        if appt:
            await db.nt_intake_confirmations.insert_one(seal_tree({
                "id": "inc-" + uuid.uuid4().hex[:12], "appointmentId": appt["id"], "clientId": user["subject"], "at": now_iso(),
                "intakeVersion": version, "changed": True, "changedFields": ["full-history"], "answers": answers, "firstVisit": True,
            }))
        await log(user, "intake_baseline", user["subject"])
        return {k: v for k, v in row.items() if k != "_id"}

    @r.post("/sessions/{appt_id}/intake-confirm")
    async def confirm_intake(appt_id: str, request: Request):
        user = await viewer(request)
        appt = await appointment_for(user, appt_id, ("client",))
        if appt.get("status") not in PREP_STATUSES:
            raise HTTPException(409, "This visit is no longer open for intake changes")
        latest = await latest_intake(db, user["subject"])
        if not latest or not latest.get("baseline"):
            raise HTTPException(409, "Complete your full health history first")
        body = await request.json()
        answers = _answers(appt.get("serviceSlug"), body.get("answers"))
        changed = body.get("changed") is True
        version = latest["version"]
        changed_fields = []
        if changed:
            updates = body.get("updates") if isinstance(body.get("updates"), dict) else {}
            merged = {key: latest.get(key) for key in TEXT_FIELDS}
            merged["conditions"] = latest.get("conditions") or []
            for key in UPDATE_FIELDS:
                if key in updates and _clip(updates[key]) != _clip(latest.get(key)):
                    merged[key] = _clip(updates[key])
                    changed_fields.append(key)
            if isinstance(updates.get("conditions"), list):
                conditions = [_clip(item, 60) for item in updates["conditions"] if _clip(item, 60)][:20]
                if conditions and conditions != (latest.get("conditions") or []):
                    merged["conditions"] = conditions
                    changed_fields.append("conditions")
            if not changed_fields:
                raise HTTPException(400, "Edit the details that changed, or confirm nothing changed")
            row = await append_intake(db, user["subject"], {"baseline": True, "source": "visit-update", "appointmentId": appt_id, **merged})
            version = row["version"]
        confirmation = {
            "id": "inc-" + uuid.uuid4().hex[:12], "appointmentId": appt_id, "clientId": user["subject"], "at": now_iso(),
            "intakeVersion": version, "changed": changed, "changedFields": changed_fields, "answers": answers, "firstVisit": False,
        }
        await db.nt_intake_confirmations.insert_one(seal_tree(dict(confirmation)))
        await log(user, "intake_confirm", appt_id)
        await add_audit(user.get("name") or "client", f"{appt.get('ref')} intake {'updated' if changed else 'confirmed unchanged'}", appt_id, actor_id=user.get("id"))
        return await shaped(user, appt)

    @r.post("/sessions/{appt_id}/consent")
    async def sign_consent(appt_id: str, request: Request):
        user = await viewer(request)
        appt = await appointment_for(user, appt_id, ("client",))
        if appt.get("status") not in PREP_STATUSES:
            raise HTTPException(409, "This visit is no longer open for consent")
        status = await session_status(db, appt)
        if status["intakeState"] != "confirmed":
            raise HTTPException(409, "Confirm your health intake for this visit first")
        body = await request.json()
        acks = body.get("acknowledgements") if isinstance(body.get("acknowledgements"), dict) else {}
        if any(acks.get(key) is not True for key in ACKNOWLEDGEMENTS):
            raise HTTPException(400, "Read and acknowledge each statement")
        typed = _clip(body.get("typedName"), 120)
        if len(typed) < 3:
            raise HTTPException(400, "Type your full name")
        signature = str(body.get("signature") or "")
        if not signature.startswith("data:image/png;base64,") or not 400 <= len(signature) <= 300000:
            raise HTTPException(400, "Draw your signature")
        if body.get("textHash") != CONSENT_HASH:
            raise HTTPException(409, "The consent text changed. Reload and read it again.")
        row = {
            "id": "scn-" + uuid.uuid4().hex[:12], "appointmentId": appt_id, "clientId": user["subject"],
            "practitionerId": appt.get("practitionerId"), "serviceSlug": appt.get("serviceSlug"), "at": now_iso(),
            "version": CONSENT_VERSION, "textHash": CONSENT_HASH, "typedName": typed, "signature": signature,
            "signatureSha256": hashlib.sha256(signature.encode()).hexdigest(), "acknowledgements": {key: True for key in ACKNOWLEDGEMENTS},
            "restrictions": _restrictions(body.get("restrictions")), "intakeVersion": status["intake"]["version"],
            "userAgent": _clip(request.headers.get("user-agent"), 200), "method": "e-signature",
        }
        await db.nt_session_consents.insert_one(seal_tree(dict(row)))
        await log(user, "session_consent_signed", appt_id)
        await add_audit(user.get("name") or "client", f"{appt.get('ref')} session consent e-signed", appt_id, actor_id=user.get("id"))
        return await shaped(user, appt)

    @r.post("/sessions/{appt_id}/consent/withdraw")
    async def withdraw(appt_id: str, request: Request):
        user = await viewer(request)
        appt = await appointment_for(user, appt_id, ("client", "practitioner", "owner"))
        status = await session_status(db, appt)
        if status["consentState"] != "signed":
            raise HTTPException(409, "There is no active consent to withdraw")
        body = await request.json()
        reason = _clip(body.get("reason"), 240)
        if user["role"] != "client" and len(reason) < 3:
            raise HTTPException(400, "Record what the client said")
        during = appt.get("status") == "in_session"
        row = {"id": "cwd-" + uuid.uuid4().hex[:12], "appointmentId": appt_id, "clientId": appt.get("clientId"), "at": now_iso(),
               "kind": "withdrawn", "consentId": status["consent"]["id"], "byRole": user["role"], "byName": user.get("name"),
               "byId": user.get("id"), "reason": reason or "Withdrawn by the client in the app", "duringSession": during}
        await db.nt_consent_events.insert_one(seal_tree(dict(row)))
        await log(user, "session_consent_withdrawn", appt_id)
        await add_audit(user.get("name") or user["role"], f"{appt.get('ref')} consent withdrawn{' during treatment' if during else ''}", appt_id, actor_id=user.get("id"))
        if during:
            appt = await apply_transition(appt, "interrupted", user.get("name") or user["role"], "Consent withdrawn. Treatment stopped.")
        return await shaped(user, appt)

    return r
