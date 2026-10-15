"""Practitioner profiles stay separate from credential approval and booking eligibility."""
import asyncio
import io
import os
import uuid

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from PIL import Image

from profiles import person_booking_block

ADDRESS = {
    "line": "10150 104 St NW, Edmonton, AB",
    "mapboxId": "local-downtown",
    "postal": "T5J 2R4",
    "clientConfirmed": True,
    "lat": 53.5461,
    "lng": -113.4938,
}


def _api():
    base = os.environ.get("REACT_APP_BACKEND_URL")
    if not base:
        pytest.skip("API fixture is not running")
    return base.rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def _owner():
    response = requests.post(f"{_api()}/auth/login", json={"email": os.environ["OWNER_EMAIL"], "password": os.environ["OWNER_PASSWORD"]}, timeout=20)
    assert response.status_code == 200, response.text
    user = response.json()
    return {"Authorization": f"Bearer {response.cookies.get('access_token')}"}, user["id"]


def test_published_profile_does_not_bypass_credentials_or_service_assignment():
    service = {"slug": "swedish", "enabled": True, "mobile": True, "prices": {"60": 120}}
    published = {"id": "p-test", "available": True, "specialties": ["swedish"], "profileVisibility": "published"}
    assert person_booking_block(published, service, []) is None
    assert person_booking_block({**published, "profileVisibility": "hidden"}, service, []) == "That practitioner is not available"
    assert person_booking_block({**published, "profileVisibility": "draft"}, service, []) == "That practitioner is not available"
    assert "does not offer" in person_booking_block(published, {**service, "slug": "prenatal"}, [])
    approved = {**published, "onboardingStatus": "approved"}
    assert "Registration" in person_booking_block(approved, service, [])


def test_owner_can_publish_a_profile_without_making_it_bookable_and_a_selected_practitioner_is_checked():
    api = _api()
    owner, owner_id = _owner()
    maya = _login("maya.demo@example.com", os.environ["DEMO_PASSWORD"])
    liam = _login("liam.demo@example.com", os.environ["DEMO_PASSWORD"])
    sarah = _login("sarah.demo@example.com", os.environ["DEMO_PASSWORD"])
    state = requests.get(f"{api}/state", headers=owner, timeout=30).json()
    person = next(row for row in state["practitioners"] if row["id"] == "p-maya")
    original_bio = person.get("bio") or ""
    email = f"profile-{uuid.uuid4().hex}@example.com"
    try:
        denied = requests.put(f"{api}/practitioners/p-liam/profile", headers=maya, json={"bio": "Maya must not edit Liam."}, timeout=20)
        assert denied.status_code == 403, denied.text
        client_denied = requests.put(f"{api}/practitioners/p-maya/profile", headers=sarah, json={"bio": "A client must not edit this."}, timeout=20)
        assert client_denied.status_code == 403, client_denied.text
        sensitive = requests.put(
            f"{api}/practitioners/p-maya/profile",
            headers=maya,
            json={"bio": original_bio, "profileVisibility": "hidden", "onboardingStatus": "approved", "_actor": "Browser"},
            timeout=20,
        )
        assert sensitive.status_code == 400, sensitive.text
        saved = requests.put(
            f"{api}/practitioners/p-maya/profile",
            headers=owner,
            json={"bio": "Maya offers mobile massage for this profile test.", "designation": "Registered massage therapist", "profileVisibility": "published", "displayOrder": 2, "_actor": "Browser"},
            timeout=20,
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["designation"] == "Registered massage therapist"
        assert saved.json()["profileVisibility"] == "published"
        public = requests.get(f"{api}/practitioners/maya-chen", timeout=20)
        assert public.status_code == 200, public.text
        assert public.json()["name"] == "Maya Chen"
        assert "licenseExpiry" not in public.json()
        hidden = requests.put(f"{api}/practitioners/p-maya/profile", headers=owner, json={"profileVisibility": "hidden"}, timeout=20)
        assert hidden.status_code == 200, hidden.text
        assert requests.get(f"{api}/practitioners/maya-chen", timeout=20).status_code == 404
        assert requests.get(f"{api}/practitioners/p-maya", headers=maya, timeout=20).status_code == 200
        visitors = requests.get(f"{api}/state", timeout=30)
        assert all(row["id"] != "p-maya" for row in visitors.json()["practitioners"])
        blocked = requests.post(f"{api}/bookings/quote", json=_visit(email, "swedish", "p-maya"), timeout=30)
        assert blocked.status_code == 409, blocked.text
        shown = requests.put(f"{api}/practitioners/p-maya/profile", headers=owner, json={"profileVisibility": "published", "available": True}, timeout=20)
        assert shown.status_code == 400, shown.text
        requests.put(f"{api}/practitioners/p-maya/profile", headers=owner, json={"profileVisibility": "published"}, timeout=20)
        wrong = requests.post(f"{api}/bookings/quote", json=_visit(email, "prenatal", "p-maya"), timeout=30)
        assert wrong.status_code == 409, wrong.text
        assert "does not offer" in wrong.text
        booked = requests.post(f"{api}/bookings", json=_visit(email, "swedish", "p-maya"), timeout=30)
        assert booked.status_code == 200, booked.text
        assert booked.json()["appointment"]["practitionerId"] == "p-maya"
        self_edit = requests.put(f"{api}/practitioners/p-maya/profile", headers=maya, json={"experience": "Mobile visits across Edmonton."}, timeout=20)
        assert self_edit.status_code == 200, self_edit.text
        assert self_edit.json()["experience"] == "Mobile visits across Edmonton."
        other = requests.put(f"{api}/practitioners/p-maya/profile", headers=liam, json={"bio": "Liam must not edit Maya."}, timeout=20)
        assert other.status_code == 403, other.text
    finally:
        requests.put(
            f"{api}/practitioners/p-maya/profile",
            headers=owner,
            json={"bio": original_bio, "designation": person.get("designation") or "Massage therapist", "experience": person.get("experience") or "Mobile massage in Edmonton.", "profileVisibility": "published", "displayOrder": person.get("displayOrder") or 100},
            timeout=20,
        )
        _remove_guest(email)


def test_preview_is_not_public_or_bookable_until_publish():
    api = _api()
    owner, owner_id = _owner()
    slug = f"preview-{uuid.uuid4().hex[:8]}"
    created = requests.post(f"{api}/services", headers=owner, json={
        "name": f"Preview {slug[-4:]}",
        "slug": slug,
        "short": "A treatment prepared before it is public.",
        "description": "This row exists only to prove preview is not bookable.",
        "benefits": ["May support a publication check"],
        "goals": ["Publication coverage"],
        "category": "specialty",
        "prices": {"60": 90},
        "mobile": True,
        "clinic": False,
        "prep": ["Arrive ready for the visit."],
        "prepMinutes": 0,
        "taxable": True,
        "enabled": True,
    }, timeout=20)
    assert created.status_code == 200, created.text
    try:
        preview = requests.post(f"{api}/services/{slug}/preview", headers=owner, json={"_actor": "Browser"}, timeout=20)
        assert preview.status_code == 200, preview.text
        assert preview.json()["publication"] == "preview"
        assert preview.json()["enabled"] is False
        assert requests.get(f"{api}/services/{slug}", timeout=20).status_code == 404
        owner_view = requests.get(f"{api}/services/{slug}", headers=owner, timeout=20)
        assert owner_view.status_code == 200, owner_view.text
        quoted = requests.post(f"{api}/bookings/quote", json=_visit(f"{slug}@example.com", slug, None), timeout=30)
        assert quoted.status_code == 400, quoted.text
        published = requests.post(f"{api}/services/{slug}/publish", headers=owner, timeout=20)
        assert published.status_code == 200, published.text
        assert requests.get(f"{api}/services/{slug}", timeout=20).status_code == 200
        drafted = requests.post(f"{api}/services/{slug}/draft", headers=owner, timeout=20)
        assert drafted.status_code == 200, drafted.text
        assert requests.get(f"{api}/services/{slug}", timeout=20).status_code == 404
        state = requests.get(f"{api}/state", headers=owner, timeout=30)
        audit = [row for row in state.json()["audit"] if row.get("entityId") == slug and str(row.get("action") or "").startswith("Service prepared for preview")]
        assert audit
        assert audit[0]["actorId"] == owner_id
        assert "Browser" not in audit[0]["action"]
    finally:
        requests.delete(f"{api}/services/{slug}", headers=owner, timeout=20)


def test_hiding_a_profile_removes_public_photo_access():
    api = _api()
    owner, _owner_id = _owner()
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), (20, 90, 160)).save(buffer, format="JPEG")
    uploaded = requests.post(f"{api}/practitioners/p-maya/photo", headers=owner, files={"upload": ("photo.jpg", buffer.getvalue(), "image/jpeg")}, timeout=20)
    assert uploaded.status_code == 200, uploaded.text
    pointer = uploaded.json()["photo"]
    try:
        assert requests.get(f"{api}{pointer[4:]}", timeout=20).status_code == 200
        hidden = requests.put(f"{api}/practitioners/p-maya/profile", headers=owner, json={"profileVisibility": "hidden"}, timeout=20)
        assert hidden.status_code == 200, hidden.text
        private = requests.get(f"{api}{pointer[4:]}", timeout=20)
        assert private.status_code == 404
        assert "no-store" in requests.get(f"{api}{pointer[4:]}", headers=owner, timeout=20).headers.get("Cache-Control", "")
        shown = requests.put(f"{api}/practitioners/p-maya/profile", headers=owner, json={"profileVisibility": "published"}, timeout=20)
        assert shown.status_code == 200, shown.text
        assert requests.get(f"{api}{pointer[4:]}", timeout=20).status_code == 200
    finally:
        requests.put(f"{api}/practitioners/p-maya/profile", headers=owner, json={"profileVisibility": "published"}, timeout=20)
        requests.delete(f"{api}/practitioners/p-maya/photo", headers=owner, timeout=20)


def test_orphan_media_can_be_detected_and_restored_from_a_copy():
    url = os.environ.get("MONGO_URL")
    name = os.environ.get("DB_NAME")
    if not url or not name:
        pytest.skip("database is not configured")

    async def run():
        from media import orphan_media_ids
        client = AsyncIOMotorClient(url)
        db = client[name]
        media_id = f"media-orphan-{uuid.uuid4().hex}"
        try:
            await db.nt_media.insert_one({"id": media_id, "kind": "practitioner", "subjectId": "missing-practitioner", "bytes": b"backup-bytes", "contentType": "image/jpeg", "public": False})
            assert media_id in await orphan_media_ids(db)
            backup = await db.nt_media.find_one({"id": media_id}, {"_id": 0})
            await db.nt_media.delete_one({"id": media_id})
            assert media_id not in await orphan_media_ids(db)
            await db.nt_media.insert_one(backup)
            restored = await db.nt_media.find_one({"id": media_id}, {"_id": 0})
            assert bytes(restored["bytes"]) == b"backup-bytes"
        finally:
            await db.nt_media.delete_one({"id": media_id})
            client.close()

    asyncio.run(run())


def _visit(email, slug, practitioner_id):
    token = uuid.uuid4().hex
    body = {
        "source": "online",
        "client": {"firstName": "Profile", "lastName": "Guest", "email": email, "phone": f"7804{int(token[:6], 16) % 1000000:06d}"},
        "appointment": {
            "serviceSlug": slug,
            "duration": 60,
            "date": f"2027-06-{10 + (int(token[:2], 16) % 18):02d}",
            "time": "09:30",
            "locationType": "home",
            "paymentMethod": "self",
            "address": ADDRESS,
        },
    }
    if practitioner_id:
        body["practitionerId"] = practitioner_id
    return body


def _remove_guest(email):
    url = os.environ.get("MONGO_URL")
    name = os.environ.get("DB_NAME")
    if not url or not name:
        return

    async def run():
        client = AsyncIOMotorClient(url)
        db = client[name]
        people = await db.nt_clients.find({"email": email}, {"_id": 0, "id": 1}).to_list(5)
        ids = [row["id"] for row in people if row.get("id")]
        appointments = await db.nt_appointments.find({"clientId": {"$in": ids}}, {"_id": 0, "id": 1}).to_list(20) if ids else []
        appointment_ids = [row["id"] for row in appointments if row.get("id")]
        if appointment_ids:
            await db.nt_slot_locks.delete_many({"appointmentId": {"$in": appointment_ids}})
            await db.nt_invoices.delete_many({"appointmentId": {"$in": appointment_ids}})
            await db.nt_appointments.delete_many({"id": {"$in": appointment_ids}})
        if ids:
            await db.nt_clients.delete_many({"id": {"$in": ids}})
            await db.nt_welcome_claims.delete_many({"key": {"$in": [f"client:{item}" for item in ids] + [f"email:{email}"]}})
        client.close()

    asyncio.run(run())
