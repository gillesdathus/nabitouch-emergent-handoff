"""Public practitioner profiles. Credential approval and booking availability stay separate."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 &/',.\-]{1,79}$")
VISIBILITY = ("draft", "published", "hidden")
OWNER_FIELDS = {"name", "designation", "bio", "experience", "qualifications", "specialties", "profileVisibility", "displayOrder", "slug"}
SELF_FIELDS = {"name", "designation", "bio", "experience", "qualifications", "specialties"}
HIDDEN = {"base", "licenseExpiry", "insuranceExpiry", "photoMediaId"}


def profile_visibility(person):
    """A missing flag follows onboarding. Approved demo profiles stay published."""
    if not person:
        return "draft"
    value = person.get("profileVisibility")
    if value in VISIBILITY:
        return value
    status = person.get("onboardingStatus")
    if status in ("draft", "pending"):
        return "draft"
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


def person_booking_block(person, service, credentials=None):
    """Why this practitioner cannot take this booking. None means the profile is eligible."""
    if not person:
        return "That practitioner is not available"
    if profile_visibility(person) != "published":
        return "That practitioner is not available"
    if person.get("available") is False or person.get("bookable") is False:
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


def present_practitioner(person, role):
    view = dict(person or {})
    view["slug"] = practitioner_slug(person)
    view["profileVisibility"] = profile_visibility(person)
    view["designation"] = person.get("designation") or ""
    view["experience"] = person.get("experience") or ""
    view["qualifications"] = list(person.get("qualifications") or [])
    view["displayOrder"] = int(person.get("displayOrder") or 100)
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
    return changes


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
    return present_practitioner(person, role)


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
    before = {key: person.get(key) for key in changes}
    after = dict(changes)
    audit = _audit(user, f"Practitioner profile updated: {person.get('name')}", person["id"], list(changes), before, after)

    async def write(session):
        opts = {"session": session} if session is not None else {}
        if "slug" in changes:
            clash = await db.nt_practitioners.find_one({"slug": changes["slug"], "id": {"$ne": person["id"]}}, {"_id": 1}, **opts)
            if clash:
                raise HTTPException(409, "A profile with that slug already exists")
        updated = await db.nt_practitioners.find_one_and_update(
            {"id": person["id"]}, {"$set": changes}, projection={"_id": 0}, return_document=ReturnDocument.AFTER, **opts,
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
    return present_practitioner(updated, user.get("role"))
