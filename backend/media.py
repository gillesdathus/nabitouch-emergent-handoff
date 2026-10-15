"""Public catalogue and profile photos. These are not insurance or clinical files."""
import io
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 16_000_000
MIN_EDGE = 32
THUMB = 320
GALLERY_LIMIT = 6
LONGEST = {"service": 1600, "practitioner": 800, "gallery": 1200}
MEDIA_ID_RE = re.compile(r"^media-[a-f0-9]{32}$")
SUBJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$")
STATIC_PREFIX = "/img/"


def _webp_ready():
    try:
        probe = io.BytesIO()
        Image.new("RGB", (1, 1)).save(probe, format="WEBP")
        return True
    except Exception:
        return False


WEBP_READY = _webp_ready()


def sniff(raw):
    """Recognize a photo by its bytes. Filenames and browser types are ignored."""
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    if len(raw) >= 12 and raw[4:8] == b"ftyp" and (b"avif" in raw[8:32] or b"avis" in raw[8:32]):
        return "avif"
    return None


def _flatten(image):
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def _encode(image):
    buffer = io.BytesIO()
    try:
        image.info.clear()
    except Exception:
        pass
    if WEBP_READY:
        try:
            image.save(buffer, format="WEBP", quality=80, method=4)
            return buffer.getvalue(), "image/webp", "webp"
        except Exception:
            buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=82, optimize=True)
    return buffer.getvalue(), "image/jpeg", "jpg"


def process_image(raw, longest):
    """Resize, drop metadata, and re-encode. The original upload is not stored."""
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        raise HTTPException(400, "Choose a photo")
    if len(raw) > MAX_BYTES:
        raise HTTPException(400, "This photo is too large")
    kind = sniff(bytes(raw))
    if not kind:
        raise HTTPException(400, "Use a JPEG, PNG, or WebP photo")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(raw)) as opened:
            framed = ImageOps.exif_transpose(opened)
            framed.load()
            image = framed.copy()
    except Exception:
        if kind == "avif":
            raise HTTPException(400, "This photo format is not supported") from None
        raise HTTPException(400, "This photo could not be read") from None
    width, height = image.size
    if width < MIN_EDGE or height < MIN_EDGE:
        raise HTTPException(400, "This photo is too small")
    if width * height > MAX_PIXELS:
        raise HTTPException(400, "This photo is too large")
    image = _flatten(image)
    image.thumbnail((int(longest), int(longest)), Image.Resampling.LANCZOS)
    thumb = image.copy()
    thumb.thumbnail((THUMB, THUMB), Image.Resampling.LANCZOS)
    data, content_type, ext = _encode(image)
    thumb_bytes, _, _ = _encode(thumb)
    return {
        "data": data,
        "thumb": thumb_bytes,
        "contentType": content_type,
        "ext": ext,
        "width": image.width,
        "height": image.height,
    }


def can_manage_service_photo(user):
    return bool(user) and user.get("role") == "owner"


def can_manage_practitioner_photo(user, practitioner_id):
    if not user:
        return False
    if user.get("role") == "owner":
        return True
    return user.get("role") == "practitioner" and user.get("subject") == practitioner_id


def practitioner_photo_public(person):
    return ((person or {}).get("onboardingStatus") or "approved") == "approved"


def can_view_media(user, row):
    if not row:
        return False
    if row.get("public") is True:
        return True
    if not user:
        return False
    if user.get("role") == "owner":
        return True
    kind = row.get("kind")
    if kind in ("practitioner", "gallery") and user.get("role") == "practitioner" and user.get("subject") == row.get("subjectId"):
        return True
    return False


def _session(session):
    return {"session": session} if session is not None else {}


def _audit(user, action, entity, entity_id, changed, before, after):
    return {
        "id": str(uuid.uuid4()),
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": user.get("name") or "Owner",
        "actorId": user.get("id"),
        "action": action,
        "appointmentId": None,
        "entity": entity,
        "entityId": entity_id,
        "changed": list(changed),
        "before": before,
        "after": after,
    }


async def _commit(db, write, audit_doc):
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
        raise HTTPException(409, "This photo could not be saved") from None


async def ensure_media_indexes(db):
    await db.nt_media.create_index("id", unique=True, name="media_id_unique")
    await db.nt_media.create_index([("kind", 1), ("subjectId", 1)], name="media_subject")


async def sync_service_visibility(db, service, session=None):
    from catalog import catalogue_public

    if not service or not service.get("id"):
        return
    await db.nt_media.update_many(
        {"kind": "service", "subjectId": service["id"]},
        {"$set": {"public": catalogue_public(service)}},
        **_session(session),
    )


async def sync_practitioner_visibility(db, practitioner_id, public, session=None):
    opts = {"session": session} if session is not None else {}
    await db.nt_media.update_many(
        {"kind": {"$in": ["practitioner", "gallery"]}, "subjectId": practitioner_id},
        {"$set": {"public": bool(public)}},
        **opts,
    )


def _profile_public(person):
    from profiles import profile_media_public
    return profile_media_public(person)


async def orphan_media_ids(db):
    """Media whose service or practitioner record is gone."""
    services = {row.get("id") for row in await db.nt_services.find({}, {"_id": 0, "id": 1}).to_list(500)}
    people = {row.get("id") for row in await db.nt_practitioners.find({}, {"_id": 0, "id": 1}).to_list(200)}
    orphans = []
    async for row in db.nt_media.find({}, {"_id": 0, "id": 1, "kind": 1, "subjectId": 1}):
        kind = row.get("kind")
        subject = row.get("subjectId")
        if kind == "service" and subject not in services:
            orphans.append(row["id"])
        elif kind in ("practitioner", "gallery") and subject not in people:
            orphans.append(row["id"])
    return orphans


async def delete_subject_media(db, kind, subject_id, session=None):
    await db.nt_media.delete_many({"kind": kind, "subjectId": subject_id}, **_session(session))


def _static_photo(service):
    saved = service.get("imgStatic")
    if isinstance(saved, str) and saved.startswith(STATIC_PREFIX):
        return saved
    current = service.get("img") or ""
    if isinstance(current, str) and current.startswith(STATIC_PREFIX):
        return current
    return ""


def _new_media(kind, subject_id, public, processed, user):
    return {
        "id": "media-" + uuid.uuid4().hex,
        "kind": kind,
        "subjectId": subject_id,
        "public": bool(public),
        "contentType": processed["contentType"],
        "ext": processed["ext"],
        "width": processed["width"],
        "height": processed["height"],
        "data": processed["data"],
        "thumb": processed["thumb"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "createdBy": user.get("id"),
    }


def _subject(value):
    if not isinstance(value, str) or not SUBJECT_RE.match(value):
        raise HTTPException(404, "Photo not found")
    return value


async def replace_service_photo(db, user, service_id, raw):
    if not can_manage_service_photo(user):
        raise HTTPException(403, "Not permitted")
    service_id = _subject(service_id)
    current = await db.nt_services.find_one({"id": service_id}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Service not found")
    from catalog import catalogue_public

    processed = process_image(raw, LONGEST["service"])
    document = _new_media("service", service_id, catalogue_public(current), processed, user)
    static = _static_photo(current)
    previous = current.get("img") or ""
    old_id = current.get("imgMediaId") if str(previous).startswith("/api/media/") else None
    audit = _audit(
        user, f"Service photo replaced: {current.get('name')}", "service", service_id, ["img"],
        {"img": previous}, {"img": f"/api/media/{document['id']}"},
    )

    async def write(session):
        opts = _session(session)
        await db.nt_media.insert_one(dict(document), **opts)
        updated = await db.nt_services.find_one_and_update(
            {"id": service_id},
            {"$set": {"img": f"/api/media/{document['id']}", "imgMediaId": document["id"], "imgStatic": static}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
            **opts,
        )
        if not updated:
            raise HTTPException(404, "Service not found")
        if old_id:
            await db.nt_media.delete_one({"id": old_id}, **opts)
        return updated

    updated = await _commit(db, write, audit)
    return {"id": service_id, "img": updated.get("img"), "imgMediaId": updated.get("imgMediaId")}


async def remove_service_photo(db, user, service_id):
    if not can_manage_service_photo(user):
        raise HTTPException(403, "Not permitted")
    service_id = _subject(service_id)
    current = await db.nt_services.find_one({"id": service_id}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Service not found")
    previous = current.get("img") or ""
    media_id = current.get("imgMediaId")
    if not str(previous).startswith("/api/media/") or not media_id:
        raise HTTPException(400, "This service is using the built-in photo")
    restored = _static_photo(current)
    audit = _audit(
        user, f"Service photo removed: {current.get('name')}", "service", service_id, ["img"],
        {"img": previous}, {"img": restored},
    )

    async def write(session):
        opts = _session(session)
        updated = await db.nt_services.find_one_and_update(
            {"id": service_id, "imgMediaId": media_id},
            {"$set": {"img": restored}, "$unset": {"imgMediaId": ""}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
            **opts,
        )
        if not updated:
            raise HTTPException(409, "This service was changed. Refresh and try again.")
        await db.nt_media.delete_one({"id": media_id, "kind": "service", "subjectId": service_id}, **opts)
        return updated

    updated = await _commit(db, write, audit)
    return {"id": service_id, "img": updated.get("img")}


def _gallery_view(person):
    items = []
    for item in person.get("gallery") or []:
        if isinstance(item, dict) and MEDIA_ID_RE.match(str(item.get("id") or "")) and str(item.get("src") or "").startswith("/api/media/"):
            items.append({"id": item["id"], "src": item["src"]})
    return items


async def _practitioner(db, practitioner_id):
    practitioner_id = _subject(practitioner_id)
    person = await db.nt_practitioners.find_one({"id": practitioner_id}, {"_id": 0})
    if not person:
        raise HTTPException(404, "Practitioner not found")
    return person


async def replace_practitioner_photo(db, user, practitioner_id, raw):
    if not can_manage_practitioner_photo(user, practitioner_id):
        raise HTTPException(403, "Not permitted")
    person = await _practitioner(db, practitioner_id)
    processed = process_image(raw, LONGEST["practitioner"])
    document = _new_media("practitioner", person["id"], _profile_public(person), processed, user)
    previous = person.get("photo") or ""
    old_id = person.get("photoMediaId") if str(previous).startswith("/api/media/") else None
    audit = _audit(
        user, f"Practitioner photo replaced: {person.get('name')}", "practitioner", person["id"], ["photo"],
        {"photo": previous}, {"photo": f"/api/media/{document['id']}"},
    )

    async def write(session):
        opts = _session(session)
        await db.nt_media.insert_one(dict(document), **opts)
        updated = await db.nt_practitioners.find_one_and_update(
            {"id": person["id"]},
            {"$set": {"photo": f"/api/media/{document['id']}", "photoMediaId": document["id"]}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
            **opts,
        )
        if not updated:
            raise HTTPException(404, "Practitioner not found")
        if old_id:
            await db.nt_media.delete_one({"id": old_id, "kind": "practitioner"}, **opts)
        return updated

    updated = await _commit(db, write, audit)
    return {"id": person["id"], "photo": updated.get("photo"), "gallery": _gallery_view(updated)}


async def remove_practitioner_photo(db, user, practitioner_id):
    if not can_manage_practitioner_photo(user, practitioner_id):
        raise HTTPException(403, "Not permitted")
    person = await _practitioner(db, practitioner_id)
    previous = person.get("photo") or ""
    media_id = person.get("photoMediaId")
    if not str(previous).startswith("/api/media/") or not media_id:
        raise HTTPException(400, "This profile has no uploaded photo")
    audit = _audit(
        user, f"Practitioner photo removed: {person.get('name')}", "practitioner", person["id"], ["photo"],
        {"photo": previous}, {"photo": ""},
    )

    async def write(session):
        opts = _session(session)
        updated = await db.nt_practitioners.find_one_and_update(
            {"id": person["id"], "photoMediaId": media_id},
            {"$unset": {"photo": "", "photoMediaId": ""}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
            **opts,
        )
        if not updated:
            raise HTTPException(409, "This profile was changed. Refresh and try again.")
        await db.nt_media.delete_one({"id": media_id, "kind": "practitioner", "subjectId": person["id"]}, **opts)
        return updated

    updated = await _commit(db, write, audit)
    return {"id": person["id"], "photo": updated.get("photo") or "", "gallery": _gallery_view(updated)}


async def add_practitioner_gallery(db, user, practitioner_id, raw):
    if not can_manage_practitioner_photo(user, practitioner_id):
        raise HTTPException(403, "Not permitted")
    person = await _practitioner(db, practitioner_id)
    if len(person.get("gallery") or []) >= GALLERY_LIMIT:
        raise HTTPException(400, "A profile can have up to 6 gallery photos")
    processed = process_image(raw, LONGEST["gallery"])
    document = _new_media("gallery", person["id"], _profile_public(person), processed, user)
    item = {"id": document["id"], "src": f"/api/media/{document['id']}"}
    before = [entry.get("src") for entry in _gallery_view(person)]
    audit = _audit(
        user, f"Practitioner gallery photo added: {person.get('name')}", "practitioner", person["id"], ["gallery"],
        {"gallery": before}, {"gallery": before + [item["src"]]},
    )

    async def write(session):
        opts = _session(session)
        live = await db.nt_practitioners.find_one({"id": person["id"]}, {"_id": 0, "id": 1, "gallery": 1}, **opts)
        if live is None:
            raise HTTPException(404, "Practitioner not found")
        if len(live.get("gallery") or []) >= GALLERY_LIMIT:
            raise HTTPException(400, "A profile can have up to 6 gallery photos")
        await db.nt_media.insert_one(dict(document), **opts)
        updated = await db.nt_practitioners.find_one_and_update(
            {"id": person["id"]},
            {"$push": {"gallery": item}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
            **opts,
        )
        if not updated:
            raise HTTPException(404, "Practitioner not found")
        return updated

    updated = await _commit(db, write, audit)
    return {"id": person["id"], "photo": updated.get("photo") or "", "gallery": _gallery_view(updated)}


async def remove_practitioner_gallery(db, user, practitioner_id, media_id):
    if not can_manage_practitioner_photo(user, practitioner_id):
        raise HTTPException(403, "Not permitted")
    person = await _practitioner(db, practitioner_id)
    if not MEDIA_ID_RE.match(media_id or ""):
        raise HTTPException(404, "Photo not found")
    current = _gallery_view(person)
    if media_id not in {item["id"] for item in current}:
        raise HTTPException(404, "Photo not found")
    before = [item["src"] for item in current]
    after = [item["src"] for item in current if item["id"] != media_id]
    audit = _audit(
        user, f"Practitioner gallery photo removed: {person.get('name')}", "practitioner", person["id"], ["gallery"],
        {"gallery": before}, {"gallery": after},
    )

    async def write(session):
        opts = _session(session)
        updated = await db.nt_practitioners.find_one_and_update(
            {"id": person["id"], "gallery.id": media_id},
            {"$pull": {"gallery": {"id": media_id}}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
            **opts,
        )
        if not updated:
            raise HTTPException(404, "Photo not found")
        await db.nt_media.delete_one({"id": media_id, "kind": "gallery", "subjectId": person["id"]}, **opts)
        return updated

    updated = await _commit(db, write, audit)
    return {"id": person["id"], "photo": updated.get("photo") or "", "gallery": _gallery_view(updated)}


def build_media_router(db, user_from):
    router = APIRouter(prefix="/api")

    async def _user(request):
        user = await user_from(request)
        if not user:
            raise HTTPException(401, "Not authenticated")
        return user

    async def _raw(upload: UploadFile):
        return await upload.read(MAX_BYTES + 1)

    @router.post("/services/{service_id}/photo")
    async def post_service_photo(service_id: str, request: Request, upload: UploadFile = File(...)):
        user = await _user(request)
        return await replace_service_photo(db, user, service_id, await _raw(upload))

    @router.delete("/services/{service_id}/photo")
    async def delete_service_photo(service_id: str, request: Request):
        user = await _user(request)
        return await remove_service_photo(db, user, service_id)

    @router.post("/practitioners/{practitioner_id}/photo")
    async def post_practitioner_photo(practitioner_id: str, request: Request, upload: UploadFile = File(...)):
        user = await _user(request)
        return await replace_practitioner_photo(db, user, practitioner_id, await _raw(upload))

    @router.delete("/practitioners/{practitioner_id}/photo")
    async def delete_practitioner_photo(practitioner_id: str, request: Request):
        user = await _user(request)
        return await remove_practitioner_photo(db, user, practitioner_id)

    @router.post("/practitioners/{practitioner_id}/gallery")
    async def post_gallery(practitioner_id: str, request: Request, upload: UploadFile = File(...)):
        user = await _user(request)
        return await add_practitioner_gallery(db, user, practitioner_id, await _raw(upload))

    @router.delete("/practitioners/{practitioner_id}/gallery/{media_id}")
    async def delete_gallery(practitioner_id: str, media_id: str, request: Request):
        user = await _user(request)
        return await remove_practitioner_gallery(db, user, practitioner_id, media_id)

    @router.get("/media/{media_id}")
    async def read_media(media_id: str, request: Request, size: str = "full"):
        if not MEDIA_ID_RE.match(media_id):
            raise HTTPException(404, "Photo not found")
        if size not in ("full", "thumb"):
            raise HTTPException(400, "Choose a photo size")
        row = await db.nt_media.find_one({"id": media_id}, {"_id": 0})
        user = await user_from(request)
        if not can_view_media(user, row):
            raise HTTPException(404, "Photo not found")
        payload = row.get("thumb") if size == "thumb" else row.get("data")
        if not payload:
            raise HTTPException(404, "Photo not found")
        ext = "webp" if row.get("ext") == "webp" else "jpg"
        return Response(
            content=bytes(payload),
            media_type=row.get("contentType") or "image/jpeg",
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": f'inline; filename="photo.{ext}"',
            },
        )

    return router
