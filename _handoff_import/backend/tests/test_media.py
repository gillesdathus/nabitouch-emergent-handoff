"""Public catalogue and profile photos stay separate from document uploads."""
import io
import os
import uuid
from pathlib import Path

import pytest
import requests
from fastapi import HTTPException
from PIL import Image

import media
from config import document_uploads_enabled

MARKER = b"nt-photo-secret-marker"
ROOT = Path(__file__).resolve().parents[1]


def _api():
    base = os.environ.get("REACT_APP_BACKEND_URL")
    if not base:
        pytest.skip("API fixture is not running")
    return base.rstrip("/") + "/api"


def _login(email, password):
    response = requests.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    if response.json().get("mfaRequired"):
        pytest.skip("This fixture requires an authenticator before that sign-in")
    token = response.cookies.get("access_token")
    assert token
    return {"Authorization": f"Bearer {token}"}


def _owner():
    return _login(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])


def _jpeg(width=80, height=48, extra=b"", marker=False):
    image = Image.new("RGB", (width, height), (12, 80, 160))
    buf = io.BytesIO()
    kwargs = {"format": "JPEG", "quality": 85}
    if marker:
        exif = image.getexif()
        exif[0x010F] = MARKER.decode()
        kwargs["exif"] = exif
    image.save(buf, **kwargs)
    return buf.getvalue() + extra


def _png():
    image = Image.new("RGBA", (64, 40), (20, 40, 80, 128))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _files(payload, name="../../evil.svg"):
    return {"upload": (name, payload, "image/jpeg")}


def _body(slug):
    return {
        "name": f"Photo {slug}",
        "slug": slug,
        "short": "A private catalogue row for a photo test.",
        "description": "This treatment exists only so a photo can be uploaded and removed.",
        "benefits": ["May support a focused photo check"],
        "goals": ["Photo coverage"],
        "category": "specialty",
        "prices": {"60": 80},
        "mobile": True,
        "clinic": False,
        "prep": ["Arrive ready for the visit."],
        "prepMinutes": 10,
        "taxable": True,
        "enabled": True,
    }


def _catalogue_images():
    rows = requests.get(f"{_api()}/services", timeout=20)
    assert rows.status_code == 200, rows.text
    return {row["id"]: row.get("img") for row in rows.json()}


def test_unsafe_and_oversized_bytes_are_rejected():
    with pytest.raises(HTTPException) as svg:
        media.process_image(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 800)
    assert svg.value.status_code == 400
    assert "JPEG" in svg.value.detail
    with pytest.raises(HTTPException) as html:
        media.process_image(b"<html><script>alert(1)</script></html>", 800)
    assert html.value.status_code == 400
    with pytest.raises(HTTPException) as pdf:
        media.process_image(b"%PDF-1.7\n1 0 obj", 800)
    assert pdf.value.status_code == 400
    with pytest.raises(HTTPException) as gif:
        media.process_image(b"GIF89a" + b"\x00" * 20, 800)
    assert gif.value.status_code == 400
    with pytest.raises(HTTPException) as tiny:
        media.process_image(_jpeg(20, 40), 800)
    assert tiny.value.detail == "This photo is too small"
    with pytest.raises(HTTPException) as empty:
        media.process_image(b"", 800)
    assert empty.value.detail == "Choose a photo"


def test_reencode_strips_metadata_and_limits_size(monkeypatch):
    processed = media.process_image(_jpeg(900, 400, extra=b"<script>alert(1)</script>", marker=True), 160)
    assert media.sniff(processed["data"]) in ("webp", "jpeg")
    assert MARKER not in processed["data"]
    assert b"<script" not in processed["data"]
    assert processed["width"] <= 160
    assert processed["height"] <= 160
    assert processed["thumb"]
    png = media.process_image(_png(), 800)
    assert media.sniff(png["data"]) in ("webp", "jpeg")
    original_limit = media.MAX_BYTES
    monkeypatch.setattr(media, "MAX_BYTES", 30)
    with pytest.raises(HTTPException) as oversized:
        media.process_image(b"\xff\xd8\xff" + b"0" * 40, 800)
    assert oversized.value.detail == "This photo is too large"
    monkeypatch.setattr(media, "MAX_BYTES", original_limit)
    monkeypatch.setattr(media, "MAX_PIXELS", 100)
    with pytest.raises(HTTPException) as bomb:
        media.process_image(_jpeg(40, 40), 800)
    assert bomb.value.status_code == 400


def test_visibility_and_permissions_follow_the_subject():
    assert media.can_manage_service_photo({"role": "owner"}) is True
    assert media.can_manage_service_photo({"role": "practitioner", "subject": "p-maya"}) is False
    assert media.can_manage_service_photo({"role": "client", "subject": "c-sarah"}) is False
    assert media.can_manage_practitioner_photo({"role": "owner"}, "p-maya") is True
    assert media.can_manage_practitioner_photo({"role": "practitioner", "subject": "p-maya"}, "p-maya") is True
    assert media.can_manage_practitioner_photo({"role": "practitioner", "subject": "p-liam"}, "p-maya") is False
    assert media.can_manage_practitioner_photo({"role": "desk"}, "p-maya") is False
    assert media.practitioner_photo_public({"onboardingStatus": "approved"}) is True
    assert media.practitioner_photo_public({}) is True
    assert media.practitioner_photo_public({"onboardingStatus": "draft"}) is False
    assert media.practitioner_photo_public({"onboardingStatus": "pending"}) is False
    private = {"public": False, "kind": "service", "subjectId": "swedish"}
    assert media.can_view_media(None, private) is False
    assert media.can_view_media({"role": "owner"}, private) is True
    assert media.can_view_media({"role": "practitioner", "subject": "swedish"}, private) is False
    profile = {"public": False, "kind": "practitioner", "subjectId": "p-maya"}
    assert media.can_view_media({"role": "practitioner", "subject": "p-maya"}, profile) is True
    assert media.can_view_media({"role": "practitioner", "subject": "p-liam"}, profile) is False
    assert media.can_view_media(None, {"public": True, "kind": "service"}) is True


def test_photo_storage_does_not_use_document_uploads(monkeypatch):
    source = (ROOT / "media.py").read_text(encoding="utf-8")
    billing = (ROOT / "billing.py").read_text(encoding="utf-8")
    server = (ROOT / "server.py").read_text(encoding="utf-8")
    assert "document_uploads_enabled" not in source
    assert "nt_files" not in source
    assert "os.remove" not in source
    assert "unlink" not in source
    assert "document_uploads_enabled()" in billing
    assert "Document uploads are turned off" in server
    monkeypatch.setenv("DOCUMENT_UPLOADS_ENABLED", "false")
    assert document_uploads_enabled() is False
    monkeypatch.setenv("DOCUMENT_UPLOADS_ENABLED", "true")
    assert document_uploads_enabled() is True


def test_service_photo_visibility_replace_and_removal():
    api = _api()
    owner = _owner()
    sarah = _login("sarah.demo@example.com", os.environ["DEMO_PASSWORD"])
    before = _catalogue_images()
    slug = f"photo-{uuid.uuid4().hex[:8]}"
    created = requests.post(f"{api}/services", headers=owner, json=_body(slug), timeout=20)
    assert created.status_code == 200, created.text
    version = created.json()["version"]
    media_ids = []
    try:
        denied = requests.post(f"{api}/services/{slug}/photo", files=_files(_jpeg()), timeout=20)
        assert denied.status_code == 401
        client = requests.post(f"{api}/services/{slug}/photo", headers=sarah, files=_files(_jpeg()), timeout=20)
        assert client.status_code == 403
        forged = requests.patch(f"{api}/services/{slug}", headers=owner, json={"img": "/api/media/media-" + "a" * 32, "version": version}, timeout=20)
        assert forged.status_code == 400
        assert "img" in forged.text
        builtin = requests.delete(f"{api}/services/swedish/photo", headers=owner, timeout=20)
        assert builtin.status_code == 400
        assert "built-in" in builtin.text
        svg = requests.post(f"{api}/services/{slug}/photo", headers=owner, files=_files(b"<svg><script>alert(1)</script></svg>"), timeout=20)
        assert svg.status_code == 400
        huge = b"\xff\xd8\xff" + b"0" * (media.MAX_BYTES - 2)
        oversized = requests.post(f"{api}/services/{slug}/photo", headers=owner, files=_files(huge, "big.jpg"), timeout=60)
        assert oversized.status_code == 400
        uploaded = requests.post(f"{api}/services/{slug}/photo", headers=owner, files=_files(_jpeg(marker=True), "portrait.jpg"), timeout=20)
        assert uploaded.status_code == 200, uploaded.text
        pointer = uploaded.json()["img"]
        assert pointer.startswith("/api/media/media-")
        media_ids.append(pointer.rsplit("/", 1)[-1])
        public = requests.get(f"{api}{pointer[4:]}", timeout=20)
        assert public.status_code == 200
        assert public.headers["X-Content-Type-Options"] == "nosniff"
        assert "no-store" in public.headers["Cache-Control"]
        assert 'filename="photo.' in public.headers["Content-Disposition"]
        assert "portrait" not in public.headers["Content-Disposition"]
        assert "evil" not in public.headers["Content-Disposition"]
        assert MARKER not in public.content
        assert b"<script" not in public.content
        assert media.sniff(public.content) in ("webp", "jpeg")
        thumb = requests.get(f"{api}{pointer[4:]}", params={"size": "thumb"}, timeout=20)
        assert thumb.status_code == 200
        assert media.sniff(thumb.content) in ("webp", "jpeg")
        assert requests.get(f"{api}{pointer[4:]}", params={"size": "original"}, timeout=20).status_code == 400
        assert requests.get(f"{api}/media/..%2F..%2Fetc%2Fpasswd", timeout=20).status_code == 404
        me = requests.get(f"{api}/auth/me", headers=owner, timeout=20)
        state = requests.get(f"{api}/state", headers=owner, timeout=30)
        assert state.status_code == 200
        assert MARKER not in state.content
        photo_audit = [
            row for row in state.json()["audit"]
            if row.get("entityId") == slug and str(row.get("action") or "").startswith("Service photo replaced:")
        ]
        assert photo_audit
        assert photo_audit[0]["actor"] == me.json()["name"]
        assert photo_audit[0]["actorId"] == me.json()["id"]
        assert photo_audit[0]["changed"] == ["img"]
        assert photo_audit[0]["before"]["img"] == ""
        assert photo_audit[0]["after"]["img"] == pointer
        assert len(photo_audit[0]["after"]["img"]) < 80
        hidden = requests.patch(f"{api}/services/{slug}", headers=owner, json={"enabled": False, "version": version}, timeout=20)
        assert hidden.status_code == 200, hidden.text
        assert requests.get(f"{api}{pointer[4:]}", timeout=20).status_code == 404
        owner_view = requests.get(f"{api}{pointer[4:]}", headers=owner, timeout=20)
        assert owner_view.status_code == 200
        shown = requests.patch(f"{api}/services/{slug}", headers=owner, json={"enabled": True, "version": hidden.json()["version"]}, timeout=20)
        assert shown.status_code == 200, shown.text
        assert requests.get(f"{api}{pointer[4:]}", timeout=20).status_code == 200
        archived = requests.post(f"{api}/services/{slug}/archive", headers=owner, timeout=20)
        assert archived.status_code == 200, archived.text
        assert requests.get(f"{api}{pointer[4:]}", timeout=20).status_code == 404
        restored = requests.post(f"{api}/services/{slug}/restore", headers=owner, timeout=20)
        assert restored.status_code == 200, restored.text
        assert requests.get(f"{api}{pointer[4:]}", timeout=20).status_code == 200
        replaced = requests.post(f"{api}/services/{slug}/photo", headers=owner, files=_files(_png(), "next.png"), timeout=20)
        assert replaced.status_code == 200, replaced.text
        media_ids.append(replaced.json()["img"].rsplit("/", 1)[-1])
        assert requests.get(f"{api}/media/{media_ids[0]}", timeout=20).status_code == 404
        removed = requests.delete(f"{api}/services/{slug}/photo", headers=owner, timeout=20)
        assert removed.status_code == 200, removed.text
        assert removed.json()["img"] == ""
        assert requests.get(f"{api}/media/{media_ids[-1]}", headers=owner, timeout=20).status_code == 404
    finally:
        requests.delete(f"{api}/services/{slug}", headers=owner, timeout=20)
        for media_id in media_ids:
            assert requests.get(f"{api}/media/{media_id}", headers=owner, timeout=20).status_code == 404
        after = _catalogue_images()
        for service_id, img in before.items():
            assert after.get(service_id) == img


def test_practitioner_photo_and_gallery_permissions():
    api = _api()
    owner = _owner()
    sarah = _login("sarah.demo@example.com", os.environ["DEMO_PASSWORD"])
    maya = _login("maya.demo@example.com", os.environ["DEMO_PASSWORD"])
    desk = _login("reception.demo@example.com", os.environ["DEMO_PASSWORD"])
    state = requests.get(f"{api}/state", headers=owner, timeout=30)
    person = next(row for row in state.json()["practitioners"] if row["id"] == "p-maya")
    if str(person.get("photo") or "").startswith("/api/media/"):
        requests.delete(f"{api}/practitioners/p-maya/photo", headers=owner, timeout=20)
    for item in person.get("gallery") or []:
        if str(item.get("id") or "").startswith("media-"):
            requests.delete(f"{api}/practitioners/p-maya/gallery/{item['id']}", headers=owner, timeout=20)
    added = []
    try:
        blocked = requests.patch(f"{api}/practitioners/p-maya", headers=owner, json={"photo": "/api/media/media-" + "b" * 32}, timeout=20)
        assert blocked.status_code == 400
        assert requests.post(f"{api}/practitioners/p-maya/photo", files=_files(_jpeg()), timeout=20).status_code == 401
        assert requests.post(f"{api}/practitioners/p-maya/photo", headers=sarah, files=_files(_jpeg()), timeout=20).status_code == 403
        assert requests.post(f"{api}/practitioners/p-maya/photo", headers=desk, files=_files(_jpeg()), timeout=20).status_code == 403
        assert requests.post(f"{api}/practitioners/p-liam/photo", headers=maya, files=_files(_jpeg()), timeout=20).status_code == 403
        uploaded = requests.post(f"{api}/practitioners/p-maya/photo", headers=maya, files=_files(_jpeg(marker=True)), timeout=20)
        assert uploaded.status_code == 200, uploaded.text
        pointer = uploaded.json()["photo"]
        added.append(pointer.rsplit("/", 1)[-1])
        assert requests.get(f"{api}{pointer[4:]}", timeout=20).status_code == 200
        for _ in range(6):
            gallery = requests.post(f"{api}/practitioners/p-maya/gallery", headers=owner, files=_files(_jpeg(48, 48)), timeout=20)
            assert gallery.status_code == 200, gallery.text
            added.append(gallery.json()["gallery"][-1]["id"])
        extra = requests.post(f"{api}/practitioners/p-maya/gallery", headers=owner, files=_files(_jpeg(48, 48)), timeout=20)
        assert extra.status_code == 400
        assert "6" in extra.text
        public_gallery = requests.get(f"{api}/media/{added[-1]}", timeout=20)
        assert public_gallery.status_code == 200
        removed = requests.delete(f"{api}/practitioners/p-maya/gallery/{added[-1]}", headers=maya, timeout=20)
        assert removed.status_code == 200, removed.text
        assert requests.get(f"{api}/media/{added[-1]}", timeout=20).status_code == 404
        added.pop()
        cleared = requests.delete(f"{api}/practitioners/p-maya/photo", headers=owner, timeout=20)
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["photo"] == ""
        assert requests.get(f"{api}/media/{added[0]}", headers=owner, timeout=20).status_code == 404
    finally:
        requests.delete(f"{api}/practitioners/p-maya/photo", headers=owner, timeout=20)
        for media_id in added[1:]:
            requests.delete(f"{api}/practitioners/p-maya/gallery/{media_id}", headers=owner, timeout=20)
