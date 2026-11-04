"""Public practitioner profiles. Credential approval and booking availability stay separate."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 &/',.\-]{1,79}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
VISIBILITY = ("draft", "published", "hidden")
OWNER_FIELDS = {
    "name", "designation", "bio", "experience", "qualifications", "specialties",
    "profileVisibility", "displayOrder", "slug",
    "historicalCompletedTreatments", "historicalCountAsOf", "historicalCountSource",
    "yearsOfExperience",
}
SELF_FIELDS = {"name", "designation", "bio", "experience", "qualifications", "specialties"}
HIDDEN = {
    "base",
    "licenseExpiry",
    "insuranceExpiry",
    "photoMediaId",
    "credentialAttestations",
    "credentialBookingOverrides",
    "historicalTreatmentCountSource",
    "historicalCountAudit",
    "historicalCountUpdatedAt",
    "historicalCountUpdatedBy",
}

# Owner-supplied contractor + mobile ranges recovered from production (2026-10-31).
# Public estimate 1650 = contractor mid (~1389, rounded 1400) + mobile mid (~256).
CONTRACTOR_CLIENTS_RANGE = (200, 305)
CONTRACTOR_VISITS_PER_CLIENT_RANGE = (5, 6)
CONTRACTOR_TREATMENT_ESTIMATE_MID = 1389
MOBILE_MASSAGE_PATIENTS = 57
MOBILE_VISITS_PER_CLIENT_RANGE = (4, 5)
MOBILE_TREATMENT_ESTIMATE_MID = 256
CONTRACTOR_HISTORICAL_TREATMENT_COUNT = 1650

# Genuinely finished visits only. Cancelled / incomplete / in-progress do not count.
CAREER_COMPLETED_STATUSES = frozenset({"completed", "processing", "closed"})


def profile_visibility(person):
    """A missing flag follows onboarding. Approved demo profiles stay published.

    Invited / incomplete staff drafts must never default to a public therapist listing.
    """
    if not person:
        return "draft"
    value = person.get("profileVisibility")
    if value in VISIBILITY:
        return value
    status = person.get("onboardingStatus")
    if status in ("draft", "pending", "invited"):
        return "draft"
    if person.get("listingEligible") is False or person.get("archivedReason"):
        return "hidden"
    return "published"


def profile_media_public(person):
    status = (person or {}).get("onboardingStatus") or "approved"
    return profile_visibility(person) == "published" and status == "approved"


def practitioner_slug(person):
    stored = (person or {}).get("slug")
    if isinstance(stored, str) and SLUG_RE.match(stored):
        return stored
    text = re.sub(r"[^a-z0-9]+", "-", str((person or {}).get("name") or "").lower()).strip("-")
    return text or "practitioner"


def can_edit_profile(user, person):
    if not user or not person:
        return False
    if user.get("role") == "owner":
        return True
    return user.get("role") == "practitioner" and user.get("subject") == person.get("id")


def public_therapist_listing_eligible(person):
    """Public directory / booking selection: active therapist profiles only, never staff orphans."""
    if not person:
        return False
    if person.get("listingEligible") is False or person.get("archivedReason"):
        return False
    if profile_visibility(person) != "published":
        return False
    if person.get("available") is False or person.get("bookable") is False:
        return False
    status = person.get("onboardingStatus")
    return status in (None, "approved")


def person_booking_block(person, service, credentials=None):
    """Why this practitioner cannot take this booking. None means the profile is eligible."""
    if not person:
        return "That practitioner is not available"
    if not public_therapist_listing_eligible(person):
        return "That practitioner is not available"
    status = person.get("onboardingStatus")
    if status and status != "approved":
        return "That practitioner is not available"
    from availability import qualified
    if service is not None and not qualified(person, service):
        return "That practitioner does not offer this service"
    if status == "approved":
        from onboarding import assignment_credential_problem
        problem = assignment_credential_problem(person, credentials or [])
        if problem:
            return problem
    return None


def _positive_int_or_none(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
        return value if value >= 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def resolved_historical_completed(person):
    """Prefer the persistent experience field; fall back to the production alias."""
    primary = _positive_int_or_none((person or {}).get("historicalCompletedTreatments"))
    if primary is not None:
        return primary
    return _positive_int_or_none((person or {}).get("historicalTreatmentCount"))


def resolved_historical_as_of(person):
    value = (person or {}).get("historicalCountAsOf")
    if isinstance(value, str) and DATE_RE.match(value.strip()):
        return value.strip()
    source = (person or {}).get("historicalTreatmentCountSource")
    if isinstance(source, dict):
        set_at = source.get("setAt")
        if isinstance(set_at, str) and len(set_at) >= 10 and DATE_RE.match(set_at[:10]):
            return set_at[:10]
    return None


def resolved_historical_source(person):
    value = (person or {}).get("historicalCountSource")
    if isinstance(value, str) and value.strip():
        return " ".join(value.split())
    source = (person or {}).get("historicalTreatmentCountSource")
    if isinstance(source, dict):
        note = source.get("note")
        if isinstance(note, str) and note.strip():
            return " ".join(note.split())
        method = source.get("method")
        if isinstance(method, str) and method.strip():
            return method.strip()
    return None


def count_eligible_completed_appointments(appointments, practitioner_id, as_of=None):
    """Count finished Nabitouch visits after the historical baseline (exclusive).

    Excludes cancelled / incomplete statuses and duplicate ids. Appointments on or
    before historicalCountAsOf are assumed covered by the historical total.
    """
    if not practitioner_id:
        return 0
    seen = set()
    total = 0
    for row in appointments or []:
        if not isinstance(row, dict):
            continue
        if row.get("practitionerId") != practitioner_id:
            continue
        status = row.get("status")
        if status not in CAREER_COMPLETED_STATUSES:
            continue
        appt_id = row.get("id")
        if appt_id:
            if appt_id in seen:
                continue
            seen.add(appt_id)
        day = str(row.get("date") or "")[:10]
        if as_of:
            if not DATE_RE.match(day) or day <= as_of:
                continue
        total += 1
    return total


def career_completed_treatments(person, appointments=None):
    historical = resolved_historical_completed(person)
    if historical is None:
        return None
    as_of = resolved_historical_as_of(person)
    # Without a baseline date, return historical only — never invent system increments.
    system = 0
    if as_of:
        system = count_eligible_completed_appointments(appointments, (person or {}).get("id"), as_of)
    return historical + system


def present_practitioner(person, role, appointments=None):
    view = dict(person or {})
    view["slug"] = practitioner_slug(person)
    view["profileVisibility"] = profile_visibility(person)
    view["designation"] = person.get("designation") or ""
    view["experience"] = person.get("experience") or ""
    view["qualifications"] = list(person.get("qualifications") or [])
    view["displayOrder"] = int(person.get("displayOrder") or 100)

    historical = resolved_historical_completed(person)
    as_of = resolved_historical_as_of(person)
    source = resolved_historical_source(person)
    view["historicalCompletedTreatments"] = historical
    view["historicalTreatmentCount"] = historical  # production / hotfix alias
    view["historicalCountAsOf"] = as_of
    view["historicalCountSource"] = source
    view["careerCompletedTreatments"] = career_completed_treatments(person, appointments)
    view["treatmentsOffered"] = len(list(person.get("specialties") or []))
    years = _positive_int_or_none(person.get("yearsOfExperience"))
    view["yearsOfExperience"] = years

    if role != "owner":
        view = {key: value for key, value in view.items() if key not in HIDDEN}
    return view


def visible_profile(person, role, subject):
    from availability import visible_to
    if not visible_to(person, role, subject):
        return False
    if role in ("owner", "desk") or (role == "practitioner" and person.get("id") == subject):
        return True
    return profile_visibility(person) == "published"


def _optional(value, label, limit):
    text = " ".join(str(value or "").split())
    if len(text) > limit:
        raise HTTPException(400, f"{label} is not valid")
    return text


def _text(value, label, limit):
    text = " ".join(str(value or "").split())
    if not text or len(text) > limit:
        raise HTTPException(400, f"{label} is not valid")
    return text


def _phrases(value, label):
    if isinstance(value, str):
        value = [line.strip() for line in value.split("\n")]
    if not isinstance(value, list):
        raise HTTPException(400, f"{label} are not valid")
    items = [" ".join(str(item).split()) for item in value if str(item).strip()]
    if len(items) > 8 or any(len(item) > 80 for item in items):
        raise HTTPException(400, f"{label} are not valid")
    return items


def _changes(user, person, payload, known_slugs):
    if not isinstance(payload, dict):
        raise HTTPException(400, "Profile details are not valid")
    payload = {key: value for key, value in payload.items() if key not in {"_actor", "_audit"}}
    allowed = OWNER_FIELDS if user.get("role") == "owner" else SELF_FIELDS
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(400, "Fields not permitted: " + ", ".join(sorted(unknown)))
    if not payload:
        raise HTTPException(400, "No permitted fields")
    changes = {}
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not NAME_RE.match(name):
            raise HTTPException(400, "Name is not valid")
        changes["name"] = name
    if "designation" in payload:
        changes["designation"] = _optional(payload["designation"], "Designation", 80)
    if "bio" in payload:
        changes["bio"] = _text(payload["bio"], "Biography", 600)
    if "experience" in payload:
        changes["experience"] = _optional(payload["experience"], "Experience", 400)
    if "qualifications" in payload:
        changes["qualifications"] = _phrases(payload["qualifications"], "Qualifications")
    if "specialties" in payload:
        slugs = payload["specialties"]
        if not isinstance(slugs, list):
            raise HTTPException(400, "Choose services from the catalogue")
        cleaned = []
        for slug in slugs:
            if slug not in known_slugs or slug in cleaned:
                raise HTTPException(400, "Choose services from the catalogue")
            cleaned.append(slug)
        changes["specialties"] = cleaned
    if "profileVisibility" in payload:
        if payload["profileVisibility"] not in VISIBILITY:
            raise HTTPException(400, "Choose draft, published, or hidden")
        changes["profileVisibility"] = payload["profileVisibility"]
    if "displayOrder" in payload:
        order = payload["displayOrder"]
        if isinstance(order, bool) or not isinstance(order, int) or order < 0 or order > 999:
            raise HTTPException(400, "Display order is not valid")
        changes["displayOrder"] = order
    if "slug" in payload:
        slug = str(payload["slug"] or "").strip().lower()
        if not SLUG_RE.match(slug):
            raise HTTPException(400, "Slug is not valid")
        changes["slug"] = slug
    if "historicalCompletedTreatments" in payload:
        count = payload["historicalCompletedTreatments"]
        if isinstance(count, bool) or not isinstance(count, int) or count < 0 or count > 500000:
            raise HTTPException(400, "Historical treatment count is not valid")
        changes["historicalCompletedTreatments"] = count
        # Keep production alias in sync so older hotfixes and ops scripts stay coherent.
        changes["historicalTreatmentCount"] = count
    if "historicalCountAsOf" in payload:
        as_of = str(payload["historicalCountAsOf"] or "").strip()
        if as_of and not DATE_RE.match(as_of):
            raise HTTPException(400, "Historical count date is not valid")
        changes["historicalCountAsOf"] = as_of or None
    if "historicalCountSource" in payload:
        changes["historicalCountSource"] = _optional(payload["historicalCountSource"], "Historical count source", 500)
    if "yearsOfExperience" in payload:
        years = payload["yearsOfExperience"]
        if years in (None, ""):
            changes["yearsOfExperience"] = None
        elif isinstance(years, bool) or not isinstance(years, int) or years < 0 or years > 80:
            raise HTTPException(400, "Years of experience is not valid")
        else:
            changes["yearsOfExperience"] = years
    return changes


def _experience_audit_entry(user, person, changes):
    keys = (
        "historicalCompletedTreatments",
        "historicalCountAsOf",
        "historicalCountSource",
        "yearsOfExperience",
    )
    touched = [key for key in keys if key in changes]
    if not touched:
        return None
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "at": now,
        "actor": user.get("name") or "Owner",
        "actorId": user.get("id"),
        "before": {
            "historicalCompletedTreatments": resolved_historical_completed(person),
            "historicalCountAsOf": resolved_historical_as_of(person),
            "historicalCountSource": resolved_historical_source(person),
            "yearsOfExperience": _positive_int_or_none(person.get("yearsOfExperience")),
        },
        "after": {
            "historicalCompletedTreatments": changes.get(
                "historicalCompletedTreatments", resolved_historical_completed(person)
            ),
            "historicalCountAsOf": changes.get("historicalCountAsOf", resolved_historical_as_of(person)),
            "historicalCountSource": changes.get("historicalCountSource", resolved_historical_source(person)),
            "yearsOfExperience": changes.get(
                "yearsOfExperience", _positive_int_or_none(person.get("yearsOfExperience"))
            ),
        },
    }


def _audit(user, action, entity_id, changed, before, after):
    return {
        "id": str(uuid.uuid4()),
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": user.get("name") or "Owner",
        "actorId": user.get("id"),
        "action": action,
        "appointmentId": None,
        "entity": "practitioner",
        "entityId": entity_id,
        "changed": list(changed),
        "before": before,
        "after": after,
    }


async def ensure_profile_indexes(db):
    await db.nt_practitioners.create_index("slug", unique=True, sparse=True, name="practitioner_slug_unique")


async def load_career_appointment_rows(db, practitioner_id, as_of=None):
    """Load finished visits used for career totals (not the public state appointment feed)."""
    if not practitioner_id:
        return []
    query = {
        "practitionerId": practitioner_id,
        "status": {"$in": list(CAREER_COMPLETED_STATUSES)},
    }
    if as_of and DATE_RE.match(as_of):
        query["date"] = {"$gt": as_of}
    return await db.nt_appointments.find(
        query,
        {"_id": 0, "id": 1, "practitionerId": 1, "status": 1, "date": 1},
    ).to_list(10000)


async def find_practitioner(db, key):
    person = await db.nt_practitioners.find_one({"$or": [{"id": key}, {"slug": key}]}, {"_id": 0})
    if person:
        return person
    people = await db.nt_practitioners.find({}, {"_id": 0}).to_list(100)
    matches = [row for row in people if practitioner_slug(row) == key]
    return matches[0] if len(matches) == 1 else None


async def read_profile(db, user, key):
    person = await find_practitioner(db, key)
    role = user.get("role") if user else None
    subject = user.get("subject") if user else None
    if not person or not visible_profile(person, role, subject):
        raise HTTPException(404, "Practitioner not found")
    as_of = resolved_historical_as_of(person)
    appointments = await load_career_appointment_rows(db, person.get("id"), as_of)
    return present_practitioner(person, role, appointments)


async def update_profile(db, user, practitioner_id, payload):
    person = await db.nt_practitioners.find_one({"id": practitioner_id}, {"_id": 0})
    if not person:
        raise HTTPException(404, "Practitioner not found")
    if not can_edit_profile(user, person):
        raise HTTPException(403, "Not permitted")
    known = {row.get("slug") for row in await db.nt_services.find({}, {"_id": 0, "slug": 1}).to_list(200)}
    changes = _changes(user, person, payload, known)
    if "slug" in changes and changes["slug"] != person.get("slug"):
        taken = await db.nt_practitioners.find_one({"slug": changes["slug"], "id": {"$ne": person["id"]}}, {"_id": 1})
        if taken:
            raise HTTPException(409, "A profile with that slug already exists")
    experience_entry = _experience_audit_entry(user, person, changes)
    if experience_entry:
        now = experience_entry["at"]
        changes["historicalCountUpdatedAt"] = now
        changes["historicalCountUpdatedBy"] = {
            "id": user.get("id"),
            "name": user.get("name") or "Owner",
        }
    before = {key: person.get(key) for key in changes}
    after = dict(changes)
    audit = _audit(user, f"Practitioner profile updated: {person.get('name')}", person["id"], list(changes), before, after)

    async def write(session):
        opts = {"session": session} if session is not None else {}
        if "slug" in changes:
            clash = await db.nt_practitioners.find_one({"slug": changes["slug"], "id": {"$ne": person["id"]}}, {"_id": 1}, **opts)
            if clash:
                raise HTTPException(409, "A profile with that slug already exists")
        update_doc = {"$set": changes}
        if experience_entry:
            update_doc["$push"] = {
                "historicalCountAudit": {
                    "$each": [experience_entry],
                    "$slice": -50,
                }
            }
        updated = await db.nt_practitioners.find_one_and_update(
            {"id": person["id"]}, update_doc, projection={"_id": 0}, return_document=ReturnDocument.AFTER, **opts,
        )
        if not updated:
            raise HTTPException(404, "Practitioner not found")
        from media import sync_practitioner_visibility
        await sync_practitioner_visibility(db, person["id"], profile_media_public(updated), session)
        return updated

    replica = (await db.command("hello")).get("setName")
    try:
        if replica:
            async with await db.client.start_session() as session:
                async with session.start_transaction():
                    updated = await write(session)
                    await db.nt_audit.insert_one(dict(audit), session=session)
        else:
            updated = await write(None)
            await db.nt_audit.insert_one(dict(audit))
    except DuplicateKeyError:
        raise HTTPException(409, "A profile with that slug already exists") from None
    as_of = resolved_historical_as_of(updated)
    appointments = await load_career_appointment_rows(db, updated.get("id"), as_of)
    return present_practitioner(updated, user.get("role"), appointments)
