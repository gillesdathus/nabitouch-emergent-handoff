"""Owner catalogue for treatments. Audit text is written here, never taken from the browser."""
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from pricing import money

CATEGORIES = ("relaxation", "therapeutic", "gentle", "specialty")
STATIC_IMAGE = "/img/hero.jpg"
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 &/',.\-]{1,79}$")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TRACKED = (
    "name", "short", "description", "benefits", "goals", "category", "prices", "taxable",
    "mobile", "clinic", "prep", "prepMinutes", "enabled", "archived",
)
CREATE_FIELDS = {
    "name", "slug", "short", "description", "benefits", "goals", "category", "prices", "durations",
    "taxable", "mobile", "clinic", "prep", "prepMinutes", "enabled",
}
UPDATE_FIELDS = (CREATE_FIELDS - {"slug"}) | {"version"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def publication_state(service):
    """Draft and preview stay off the public catalogue. An archived row is never public."""
    if not service:
        return "draft"
    if service.get("archived") is True:
        return "archived"
    state = service.get("publication")
    if state in ("draft", "preview", "published"):
        return state
    if service.get("enabled") is False:
        return "draft"
    return "published"


def catalogue_public(service):
    """A public visitor may see and book only a published treatment."""
    return publication_state(service) == "published"


def booking_block_reason(service, duration, location):
    """Why this treatment cannot be quoted or booked. None means the catalogue row is eligible."""
    if publication_state(service) != "published":
        return "Choose a service"
    prices = service.get("prices") or {}
    if isinstance(duration, bool) or duration is None or duration == "":
        return "Choose a duration"
    if isinstance(duration, float):
        if not duration.is_integer():
            return "Choose a duration"
        key = str(int(duration))
    else:
        key = str(duration)
    if key not in prices:
        return "Choose a duration"
    price = prices[key]
    if isinstance(price, bool) or not isinstance(price, (int, float)) or price < 0:
        return "Choose a duration"
    if location == "clinic" and not service.get("clinic", True):
        return "This service is not offered in clinic"
    if location != "clinic" and not service.get("mobile", True):
        return "This service is not offered at home"
    return None


def _reject_unknown(payload, allowed):
    unknown = set(payload) - set(allowed)
    if unknown:
        raise HTTPException(400, "Fields not permitted: " + ", ".join(sorted(unknown)))


def _without_client_audit(payload):
    """Browser actor and audit text are not catalogue data."""
    if not isinstance(payload, dict):
        raise HTTPException(400, "Service details are not valid")
    body = dict(payload)
    body.pop("_actor", None)
    body.pop("_audit", None)
    return body


def _text(value, label, limit, *, required=True, multiline=False):
    if not isinstance(value, str):
        raise HTTPException(400, f"{label} is not valid")
    if any(ord(ch) < 32 and (not multiline or ch not in "\n\t") for ch in value):
        raise HTTPException(400, f"{label} is not valid")
    if (not multiline) and ("\n" in value or "\r" in value):
        raise HTTPException(400, f"{label} is not valid")
    text = value.strip()
    if multiline:
        text = "\n".join(line.rstrip() for line in text.splitlines()).strip()
    if required and not text:
        raise HTTPException(400, f"{label} is required")
    if len(text) > limit:
        raise HTTPException(400, f"{label} is too long")
    return text


def _phrases(value, label, *, max_items, item_limit):
    if not isinstance(value, list) or not value:
        raise HTTPException(400, f"{label} are required")
    if len(value) > max_items:
        raise HTTPException(400, f"Too many {label.lower()}")
    return [_text(item, label, item_limit) for item in value]


def _bool(value, label):
    if not isinstance(value, bool):
        raise HTTPException(400, f"{label} must be true or false")
    return value


def _name(value):
    text = _text(value, "Name", 80)
    if not NAME_RE.fullmatch(text):
        raise HTTPException(400, "Name is not valid")
    return text


def _slug(value):
    text = _text(value, "Slug", 60)
    if not SLUG_RE.fullmatch(text):
        raise HTTPException(400, "Slug is not valid")
    return text


def _category(value, required):
    if value is None or value == "":
        if required:
            raise HTTPException(400, "Category is required")
        return None
    if not isinstance(value, str) or value not in CATEGORIES:
        raise HTTPException(400, "Category is not valid")
    return value


def _minutes(value):
    if isinstance(value, bool) or not isinstance(value, int):
        raise HTTPException(400, "Preparation time must be whole minutes")
    if value < 0 or value > 180:
        raise HTTPException(400, "Preparation time must be between 0 and 180 minutes")
    return value


def _duration(value):
    if isinstance(value, bool) or isinstance(value, float):
        raise HTTPException(400, "Durations must be whole minutes")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str) and value.isdigit():
        number = int(value)
    else:
        raise HTTPException(400, "Durations must be whole minutes")
    if number < 15 or number > 240:
        raise HTTPException(400, "Durations must be between 15 and 240 minutes")
    return str(number)


def _price(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(400, "Prices must be zero or more")
    try:
        amount = Decimal(str(value))
    except Exception as exc:
        raise HTTPException(400, "Prices must be zero or more") from exc
    if amount < 0 or amount > Decimal("10000"):
        raise HTTPException(400, "Prices must be zero or more")
    if amount.quantize(Decimal("0.01")) != amount:
        raise HTTPException(400, "Prices use dollars and cents")
    number = money(value)
    if number == int(number):
        return int(number)
    return number


def normalize_prices(payload):
    """Accept a duration-to-price map or a list of duration rows. Duplicate durations are rejected."""
    raw = payload.get("prices")
    declared = payload.get("durations")
    declared_keys = None
    if declared is not None:
        if not isinstance(declared, list) or not declared:
            raise HTTPException(400, "Durations are not valid")
        declared_keys = [_duration(item) for item in declared]
        if len(declared_keys) != len(set(declared_keys)):
            raise HTTPException(400, "Duplicate durations")
    if isinstance(raw, list):
        prices = {}
        for row in raw:
            if not isinstance(row, dict):
                raise HTTPException(400, "Prices are not valid")
            key = _duration(row.get("duration"))
            if key in prices:
                raise HTTPException(400, "Duplicate durations")
            prices[key] = _price(row.get("price"))
    elif isinstance(raw, dict) and raw:
        prices = {}
        for key, price in raw.items():
            cleaned = _duration(key)
            if cleaned in prices:
                raise HTTPException(400, "Duplicate durations")
            prices[cleaned] = _price(price)
    else:
        raise HTTPException(400, "Prices are required")
    if not prices:
        raise HTTPException(400, "Prices are required")
    if declared_keys is not None and set(declared_keys) != set(prices):
        raise HTTPException(400, "Durations do not match prices")
    return prices


def _places(mobile, clinic):
    if mobile is not True and clinic is not True:
        raise HTTPException(400, "A service must be available at home or in clinic")


def build_new_service(payload):
    body = _without_client_audit(payload)
    _reject_unknown(body, CREATE_FIELDS)
    for field in ("name", "slug", "short", "description", "benefits", "goals", "category", "prices", "mobile", "clinic", "prep", "prepMinutes", "enabled"):
        if field not in body:
            raise HTTPException(400, "Missing required service details")
    mobile = _bool(body.get("mobile"), "Mobile availability")
    clinic = _bool(body.get("clinic"), "Clinic availability")
    _places(mobile, clinic)
    slug = _slug(body.get("slug"))
    taxable = _bool(body["taxable"], "Taxable status") if "taxable" in body else True
    return {
        "id": slug,
        "slug": slug,
        "name": _name(body.get("name")),
        "short": _text(body.get("short"), "Short description", 160),
        "description": _text(body.get("description"), "Description", 2000, multiline=True),
        "benefits": _phrases(body.get("benefits"), "Benefits", max_items=12, item_limit=160),
        "goals": _phrases(body.get("goals"), "Goals", max_items=12, item_limit=80),
        "category": _category(body.get("category"), True),
        "prices": normalize_prices(body),
        "img": "",
        "imgStatic": "",
        "mobile": mobile,
        "clinic": clinic,
        "enabled": _bool(body.get("enabled"), "Enabled status"),
        "prep": _phrases(body.get("prep"), "Preparation steps", max_items=8, item_limit=240),
        "prepMinutes": _minutes(body.get("prepMinutes")),
        "taxable": taxable,
        "archived": False,
        "version": 1,
    }


def build_changes(current, payload):
    body = _without_client_audit(payload)
    if "slug" in body:
        raise HTTPException(400, "Slug cannot be changed")
    if "version" in body:
        version = body["version"]
        if isinstance(version, bool) or not isinstance(version, int) or version < 0:
            raise HTTPException(400, "Version is not valid")
        if version != int(current.get("version") or 0):
            raise HTTPException(409, "This service was changed. Refresh and try again.")
    _reject_unknown(body, UPDATE_FIELDS)
    data = {key: value for key, value in body.items() if key != "version"}
    if not data:
        raise HTTPException(400, "No permitted fields")
    changes = {}
    if "name" in data:
        changes["name"] = _name(data["name"])
    if "short" in data:
        changes["short"] = _text(data["short"], "Short description", 160)
    if "description" in data:
        changes["description"] = _text(data["description"], "Description", 2000, multiline=True)
    if "benefits" in data:
        changes["benefits"] = _phrases(data["benefits"], "Benefits", max_items=12, item_limit=160)
    if "goals" in data:
        changes["goals"] = _phrases(data["goals"], "Goals", max_items=12, item_limit=80)
    if "category" in data:
        category = _category(data["category"], True)
        changes["category"] = category
    if "prices" in data or "durations" in data:
        probe = dict(data)
        if "prices" not in probe:
            probe["prices"] = current.get("prices") or {}
        changes["prices"] = normalize_prices(probe)
    if "taxable" in data:
        changes["taxable"] = _bool(data["taxable"], "Taxable status")
    if "mobile" in data:
        changes["mobile"] = _bool(data["mobile"], "Mobile availability")
    if "clinic" in data:
        changes["clinic"] = _bool(data["clinic"], "Clinic availability")
    if "prep" in data:
        changes["prep"] = _phrases(data["prep"], "Preparation steps", max_items=8, item_limit=240)
    if "prepMinutes" in data:
        changes["prepMinutes"] = _minutes(data["prepMinutes"])
    if "enabled" in data:
        changes["enabled"] = _bool(data["enabled"], "Enabled status")
    merged_mobile = changes.get("mobile", current.get("mobile", True))
    merged_clinic = changes.get("clinic", current.get("clinic", True))
    _places(merged_mobile is not False, merged_clinic is not False)
    if changes.get("enabled") is True and current.get("archived") is True:
        raise HTTPException(409, "Restore this service before making it bookable")
    effective = {key: value for key, value in changes.items() if current.get(key) != value}
    return effective


def _changed(before, after):
    keys, previous, current = [], {}, {}
    for key in TRACKED:
        if before.get(key) != after.get(key):
            keys.append(key)
            previous[key] = before.get(key)
            current[key] = after.get(key)
    return keys, previous, current


def _describe(current, merged, keys):
    name = merged.get("name") or current.get("name") or "Service"
    if keys == ["enabled"]:
        return f"Service deactivated: {name}" if merged.get("enabled") is False else f"Service activated: {name}"
    if keys == ["archived"]:
        return f"Service archived: {name}" if merged.get("archived") is True else f"Service restored: {name}"
    return f"Service updated: {name}"


def _audit(user, action, entity_id, changed, before, after):
    return {
        "id": str(uuid.uuid4()),
        "at": now_iso(),
        "actor": user.get("name") or "Owner",
        "actorId": user.get("id"),
        "action": action,
        "appointmentId": None,
        "entity": "service",
        "entityId": entity_id,
        "changed": list(changed),
        "before": before,
        "after": after,
    }


def _owner(user):
    if not user or user.get("role") != "owner":
        raise HTTPException(403, "Not permitted")


async def ensure_service_indexes(db):
    await db.nt_services.create_index("id", unique=True, name="service_id_unique")
    await db.nt_services.create_index("slug", unique=True, name="service_slug_unique")


async def commit_with_audit(db, write, audit_doc):
    """Write the catalogue row and its audit together when MongoDB transactions are available."""
    replica = (await db.command("hello")).get("setName")
    try:
        if replica:
            async with await db.client.start_session() as session:
                async with session.start_transaction():
                    result = await write(session)
                    if audit_doc is not None:
                        await db.nt_audit.insert_one(dict(audit_doc), session=session)
                    return result
        result = await write(None)
        if audit_doc is not None:
            await db.nt_audit.insert_one(dict(audit_doc))
        return result
    except DuplicateKeyError:
        raise HTTPException(409, "A service with that slug already exists") from None


def _session(session):
    return {"session": session} if session is not None else {}


async def _name_taken(db, name, ignore_id=None, session=None):
    query = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if ignore_id:
        query["id"] = {"$ne": ignore_id}
    return await db.nt_services.find_one(query, {"_id": 1}, **_session(session))


async def list_services(db, user):
    rows = await db.nt_services.find({}, {"_id": 0}).to_list(500)
    if user and user.get("role") == "owner":
        return rows
    return [row for row in rows if catalogue_public(row)]


async def read_service(db, user, service_id):
    row = await db.nt_services.find_one({"$or": [{"id": service_id}, {"slug": service_id}]}, {"_id": 0})
    if not row or (not (user and user.get("role") == "owner") and not catalogue_public(row)):
        raise HTTPException(404, "Service not found")
    return row


async def create_service(db, user, payload):
    _owner(user)
    document = build_new_service(payload)
    if await _name_taken(db, document["name"]):
        raise HTTPException(409, "A service with that name already exists")
    if await db.nt_services.find_one({"$or": [{"id": document["id"]}, {"slug": document["slug"]}]}, {"_id": 1}):
        raise HTTPException(409, "A service with that slug already exists")
    changed = ["name", "slug", "short", "description", "benefits", "goals", "category", "prices", "taxable", "mobile", "clinic", "prep", "prepMinutes", "enabled"]
    audit = _audit(user, f"Service created: {document['name']}", document["id"], changed, {}, {key: document[key] for key in changed})

    async def write(session):
        if await _name_taken(db, document["name"], session=session):
            raise HTTPException(409, "A service with that name already exists")
        stored = dict(document)
        await db.nt_services.insert_one(stored, session=session)
        stored.pop("_id", None)
        return stored

    return await commit_with_audit(db, write, audit)


def _match_version(current):
    if "version" in current:
        return {"id": current["id"], "version": current["version"]}
    return {"id": current["id"], "version": {"$exists": False}}


async def update_service(db, user, service_id, payload):
    _owner(user)
    current = await db.nt_services.find_one({"id": service_id}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Service not found")
    changes = build_changes(current, payload)
    if not changes:
        return current
    if "name" in changes and await _name_taken(db, changes["name"], service_id):
        raise HTTPException(409, "A service with that name already exists")
    merged = {**current, **changes}
    keys, previous, nxt = _changed(current, merged)
    if not keys:
        return current
    audit = _audit(user, _describe(current, merged, keys), service_id, keys, previous, nxt)
    new_version = int(current.get("version") or 0) + 1
    match = _match_version(current)

    async def write(session):
        if "name" in changes and await _name_taken(db, changes["name"], service_id, session):
            raise HTTPException(409, "A service with that name already exists")
        updated = await db.nt_services.find_one_and_update(
            match, {"$set": {**changes, "version": new_version}}, projection={"_id": 0},
            return_document=ReturnDocument.AFTER, session=session,
        )
        if not updated:
            raise HTTPException(409, "This service was changed. Refresh and try again.")
        from media import sync_service_visibility
        await sync_service_visibility(db, updated, session)
        return updated

    return await commit_with_audit(db, write, audit)


async def _set_archived(db, user, service_id, archived):
    _owner(user)
    current = await db.nt_services.find_one({"id": service_id}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Service not found")
    if (current.get("archived") is True) is archived:
        return current
    merged = {**current, "archived": archived}
    keys, previous, nxt = _changed(current, merged)
    audit = _audit(user, _describe(current, merged, keys), service_id, keys, previous, nxt)
    new_version = int(current.get("version") or 0) + 1
    match = _match_version(current)

    async def write(session):
        updated = await db.nt_services.find_one_and_update(
            match, {"$set": {"archived": archived, "version": new_version}}, projection={"_id": 0},
            return_document=ReturnDocument.AFTER, session=session,
        )
        if not updated:
            raise HTTPException(409, "This service was changed. Refresh and try again.")
        from media import sync_service_visibility
        await sync_service_visibility(db, updated, session)
        return updated

    return await commit_with_audit(db, write, audit)


async def archive_service(db, user, service_id):
    return await _set_archived(db, user, service_id, True)


async def restore_service(db, user, service_id):
    return await _set_archived(db, user, service_id, False)


def _publish_ready(service):
    missing = []
    if not str(service.get("name") or "").strip():
        missing.append("name")
    if not str(service.get("short") or "").strip() and not str(service.get("description") or "").strip():
        missing.append("description")
    if not service.get("prices"):
        missing.append("prices")
    return missing


async def _set_publication(db, user, service_id, state):
    _owner(user)
    current = await db.nt_services.find_one({"id": service_id}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Service not found")
    if current.get("archived") is True and state != "archived":
        raise HTTPException(409, "Restore this service before changing its publication state")
    if state == "published":
        missing = _publish_ready(current)
        if missing:
            raise HTTPException(400, "Add the required content before publishing: " + ", ".join(missing))
    enabled = state == "published"
    archived = state == "archived"
    labels = {"draft": "Service moved to draft", "preview": "Service prepared for preview", "published": "Service published", "archived": "Service archived"}
    merged = {**current, "publication": state, "enabled": enabled, "archived": archived}
    keys, previous, nxt = _changed(current, merged)
    audit = _audit(user, f"{labels[state]}: {current.get('name')}", service_id, ["publication", *keys], previous, {**nxt, "publication": state})
    new_version = int(current.get("version") or 0) + 1
    match = _match_version(current)

    async def write(session):
        updated = await db.nt_services.find_one_and_update(
            match,
            {"$set": {"publication": state, "enabled": enabled, "archived": archived, "version": new_version}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
            session=session,
        )
        if not updated:
            raise HTTPException(409, "This service was changed. Refresh and try again.")
        from media import sync_service_visibility
        await sync_service_visibility(db, updated, session)
        return updated

    return await commit_with_audit(db, write, audit)


async def preview_service(db, user, service_id):
    return await _set_publication(db, user, service_id, "preview")


async def publish_service(db, user, service_id):
    return await _set_publication(db, user, service_id, "published")


async def draft_service(db, user, service_id):
    return await _set_publication(db, user, service_id, "draft")


async def dependency_labels(db, service, session=None):
    slug = service.get("slug") or service.get("id")
    name = service.get("name")
    opts = _session(session)
    labels = []
    if await db.nt_appointments.count_documents({"serviceSlug": slug}, **opts):
        labels.append("appointments")
    invoice_or = [{"serviceSlug": slug}]
    if name:
        invoice_or.append({"service": name})
    if await db.nt_invoices.count_documents({"$or": invoice_or}, **opts):
        labels.append("invoices")
    if await db.nt_promotions.count_documents({"services": slug}, **opts):
        labels.append("promotions")
    if await db.nt_practitioners.count_documents({"specialties": slug}, **opts):
        labels.append("practitioners")
    if await db.nt_campaigns.count_documents({"serviceSlug": slug}, **opts):
        labels.append("campaigns")
    if await db.nt_opening_watches.count_documents({"serviceSlug": slug}, **opts):
        labels.append("opening watches")
    if await db.nt_recovery_cases.count_documents({"serviceSlug": slug}, **opts):
        labels.append("recovery cases")
    return labels


def _snapshot(service):
    keys = ("id", "slug", "name", "short", "description", "benefits", "goals", "category", "prices", "img", "taxable", "mobile", "clinic", "prep", "prepMinutes", "enabled", "archived")
    return {key: service.get(key) for key in keys if key in service}


async def delete_service(db, user, service_id):
    _owner(user)
    current = await db.nt_services.find_one({"id": service_id}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Service not found")
    labels = await dependency_labels(db, current)
    if labels:
        raise HTTPException(409, "This service cannot be deleted because it is referenced by " + ", ".join(labels))
    audit = _audit(user, f"Service deleted: {current.get('name')}", service_id, ["deleted"], _snapshot(current), {})
    match = _match_version(current)

    async def write(session):
        live = await dependency_labels(db, current, session)
        if live:
            raise HTTPException(409, "This service cannot be deleted because it is referenced by " + ", ".join(live))
        deleted = await db.nt_services.delete_one(match, session=session)
        if deleted.deleted_count != 1:
            raise HTTPException(409, "This service was changed. Refresh and try again.")
        from media import delete_subject_media
        await delete_subject_media(db, "service", service_id, session)
        return {"deleted": True, "id": service_id}

    return await commit_with_audit(db, write, audit)
