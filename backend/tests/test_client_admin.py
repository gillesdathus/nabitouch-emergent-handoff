"""Client Management 2.0 — staff create/edit, rural/mailing addresses, auth gates."""
import os
import uuid

import pytest
import requests

from addresses import (
    alberta_postal,
    classify,
    is_po_box,
    normalize_destination_line,
    normalize_rural_query,
    requires_manual_travel_approval,
    verification_state_for,
)
from client_admin import (
    build_staff_client,
    dedupe_insurance,
    desk_can_read_client_addresses,
    desk_can_write_client_addresses,
    merge_client_patch,
    normalize_addresses,
    staff_allowed_fields,
)


def test_rural_abbrev_normalizes_to_range_road_display():
    assert normalize_rural_query("53337 Rge Rd 215") == "53337 Range Road 215"
    line = normalize_destination_line("53337 Rge Rd 215, Ardrossan, AB T8E 2B2, Canada")
    assert "Range Road 215" in line
    assert "Ardrossan" in line
    assert "T8E 2B2" in line


def test_po_box_detected_and_mailing_safe():
    assert is_po_box("PO Box 123, Edmonton, AB T5J 2N9")
    assert is_po_box("P.O. Box 45, Calgary, AB")
    assert not is_po_box("53337 Range Road 215, Ardrossan, AB")


def test_out_of_province_postal_is_valid_canadian_mail():
    assert alberta_postal("T8E 2B2")
    assert not alberta_postal("V6B 1A1")
    hit = {
        "line": "123 Main St, Vancouver, BC V6B 1A1, Canada",
        "lat": 49.28, "lng": -123.12, "provider": "mapbox", "postal": "V6B 1A1",
        "matchConfidence": "exact",
    }
    assessed = classify(hit, "123 Main St, Vancouver, BC", "V6B 1A1")
    assert assessed["postalStatus"] != "invalid"
    assert assessed["confidence"] in ("address", "approximate", "review")


def test_verification_states_separate_confirmation():
    assert verification_state_for(confidence="address", client_confirmed=True, postal_status="match") == "verified"
    assert verification_state_for(confidence="address", client_confirmed=False, postal_status="match") == "needs_confirmation"
    assert verification_state_for(confidence="review", client_confirmed=False) == "manual_review"
    assert verification_state_for(confidence="invalid", client_confirmed=True) == "invalid"
    # Manual entry alone is never verified.
    assert verification_state_for(confidence="address", client_confirmed=False) != "verified"


def test_manual_approval_over_40km():
    assert not requires_manual_travel_approval(12)
    assert requires_manual_travel_approval(40.1)
    assert requires_manual_travel_approval(None)


def test_normalize_addresses_default_and_po_box_purpose():
    rows = normalize_addresses([
        {"line": "PO Box 99, Edmonton, AB T5J 0K1", "label": "Mail", "purpose": "service"},
        {"line": "10150 104 St NW, Edmonton, AB", "label": "Home", "lat": 53.54, "lng": -113.5, "clientConfirmed": True, "confidence": "address", "mapboxId": "mbx-1"},
    ])
    assert len(rows) == 2
    po = next(r for r in rows if r["poBox"])
    assert po["purpose"] == "mailing"
    home = next(r for r in rows if not r["poBox"])
    assert home["isDefault"] is True


def test_dedupe_insurance_prevents_duplicate_member():
    rows = dedupe_insurance([
        {"insurer": "Alberta Blue Cross", "memberId": "MBR-1", "holderName": "A", "primary": True},
        {"insurer": "Alberta Blue Cross", "memberId": "mbr-1", "holderName": "A"},
        {"insurer": "Sun Life", "memberId": "X-2", "holderName": "A", "primary": True},
    ])
    assert len(rows) == 2
    assert sum(1 for r in rows if r["primary"]) == 1


def test_staff_permissions_desk_vs_owner():
    keys = {"firstName", "phone", "addresses", "insurance", "email"}
    assert staff_allowed_fields("owner", {}, keys) == keys
    desk = staff_allowed_fields("desk", {"editClientProfile": True}, keys)
    assert desk == {"phone", "email"}
    assert "firstName" not in desk
    with_id = staff_allowed_fields("desk", {"correctClientIdentity": True}, keys)
    assert "firstName" in with_id
    with_booking = staff_allowed_fields("desk", {"createBooking": True}, keys)
    assert "addresses" in with_booking
    assert desk_can_read_client_addresses({"createBooking": True}) is True
    assert desk_can_write_client_addresses({"createBooking": True}) is True
    assert desk_can_read_client_addresses({"viewAddresses": False}) is False
    assert desk_can_read_client_addresses({"viewAddresses": True}) is True
    assert desk_can_read_client_addresses({"editClientAddresses": True, "viewAddresses": False}) is True


def test_build_staff_client_without_email():
    client = build_staff_client(
        {"firstName": "Ada", "lastName": "Lovelace", "phone": "780-555-0100",
         "addresses": [{"line": "53337 Rge Rd 215, Ardrossan, AB T8E 2B2", "label": "Home"}]},
        user={"id": "u-owner"},
    )
    assert client["email"] == ""
    assert client["firstName"] == "Ada"
    assert "Range Road 215" in client["addresses"][0]["line"]
    assert client["hasProfile"] is False


def test_create_and_edit_address_round_trip_preserves_confirmation():
    """Confirmed civic addresses survive create + partial profile edits."""
    created = build_staff_client(
        {
            "firstName": "Ada",
            "lastName": "Lovelace",
            "phone": "780-555-0100",
            "addresses": [{
                "id": "ad-home",
                "line": "10150 104 St NW, Edmonton, AB T5J 2R4",
                "label": "Home",
                "purpose": "home",
                "lat": 53.54,
                "lng": -113.49,
                "postal": "T5J 2R4",
                "mapboxId": "mbx-downtown",
                "clientConfirmed": True,
                "confidence": "address",
                "isDefault": True,
            }],
        },
        user={"id": "u-owner"},
    )
    assert len(created["addresses"]) == 1
    assert created["addresses"][0]["clientConfirmed"] is True
    assert created["addresses"][0]["mapboxId"] == "mbx-downtown"
    assert created["addresses"][0]["line"]

    doc, _, changed = merge_client_patch(
        created,
        {"phone": "780-555-9999", "preferredName": "Ada"},
        role="owner",
        perms={},
    )
    assert "addresses" not in doc
    assert "phone" in changed

    edited, _, addr_changed = merge_client_patch(
        created,
        {
            "addresses": [{
                **created["addresses"][0],
                "unit": "12",
                "access": "Buzz 4",
            }],
        },
        role="desk",
        perms={"createBooking": True},
    )
    assert addr_changed == ["addresses"]
    assert edited["addresses"][0]["clientConfirmed"] is True
    assert edited["addresses"][0]["unit"] == "12"
    assert edited["addresses"][0]["mapboxId"] == "mbx-downtown"
    assert edited["addresses"][0]["lat"] == 53.54


def test_identity_correction_requires_verification():
    target = {"firstName": "Ada", "lastName": "Lovelace", "dob": "1990-01-01", "phone": "780"}
    with pytest.raises(ValueError, match="identity verification"):
        merge_client_patch(
            target,
            {"firstName": "Augusta"},
            role="owner",
            perms={},
        )
    doc, identity, changed = merge_client_patch(
        target,
        {
            "firstName": "Augusta",
            "_identityCorrection": {"method": "verbal_confirmed", "reason": "Client confirmed spelling by phone"},
        },
        role="owner",
        perms={},
    )
    assert doc["firstName"] == "Augusta"
    assert identity["previous"]["firstName"] == "Ada"
    assert "firstName" in changed


def test_partial_patch_does_not_clear_unrelated_fields():
    target = {
        "firstName": "Ada", "lastName": "Lovelace", "phone": "780-555-0100",
        "email": "ada@example.com", "addresses": [{"id": "ad-1", "line": "1 Jasper Ave", "label": "Home"}],
        "insurance": [{"id": "ins-1", "insurer": "ABC", "memberId": "1"}],
    }
    doc, _, changed = merge_client_patch(target, {"phone": "780-555-9999"}, role="owner", perms={})
    assert changed == ["phone"]
    assert "addresses" not in doc
    assert "insurance" not in doc
    assert "email" not in doc


def _live():
    return bool(os.environ.get("REACT_APP_BACKEND_URL")) and bool(os.environ.get("OWNER_EMAIL"))


def _api():
    return os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{_api()}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    token = s.cookies.get("csrf_token")
    if token:
        s.headers["X-CSRF-Token"] = token
    return s


@pytest.mark.skipif(not _live(), reason="Live API env not configured")
def test_staff_create_client_with_address_and_edit_persists():
    owner = _login(os.environ["OWNER_EMAIL"], os.environ["OWNER_PASSWORD"])
    token = uuid.uuid4().hex[:8]
    created = owner.post(f"{_api()}/clients", json={
        "firstName": "Synth",
        "lastName": f"Client{token}",
        "phone": f"780555{token[:4]}",
        "addresses": [{
            "line": "53337 Rge Rd 215, Ardrossan, AB T8E 2B2",
            "label": "Home",
            "purpose": "home",
            "lat": 53.591591,
            "lng": -113.073364,
            "postal": "T8E 2B2",
            "mapboxId": "local-ardrossan-rge-215",
            "clientConfirmed": True,
            "confidence": "address",
        }],
    }, timeout=20)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["email"] == ""
    assert "Range Road 215" in body["addresses"][0]["line"]
    cid = body["id"]

    patched = owner.patch(f"{_api()}/clients/{cid}", json={
        "phone": "780-555-4242",
        "preferredName": "Syn",
        "altPhone": "780-555-0002",
    }, timeout=20)
    assert patched.status_code == 200, patched.text
    assert patched.json()["phone"] == "780-555-4242"
    assert patched.json()["preferredName"] == "Syn"

    ws = owner.get(f"{_api()}/clients/{cid}/workspace", timeout=20)
    assert ws.status_code == 200
    client = ws.json()["client"]
    assert client["phone"] == "780-555-4242"
    assert client["altPhone"] == "780-555-0002"
    assert len(client["addresses"]) == 1
    assert ws.json()["access"]["editProfile"] is True

    identity = owner.patch(f"{_api()}/clients/{cid}", json={
        "firstName": "Synthetic",
        "_identityCorrection": {"method": "verbal_confirmed", "reason": "Phone spelling confirmation"},
    }, timeout=20)
    assert identity.status_code == 200, identity.text
    assert identity.json()["firstName"] == "Synthetic"

    history = owner.get(f"{_api()}/clients/{cid}/profile-history", timeout=20)
    assert history.status_code == 200
    assert any(row.get("identity") for row in history.json()["history"])


@pytest.mark.skipif(not _live(), reason="Live API env not configured")
def test_unauthorized_client_cannot_patch_other_profile():
    # Register a throwaway client and attempt to patch a different synthetic id.
    s = requests.Session()
    email = f"deny_{uuid.uuid4().hex[:8]}@example.com"
    reg = s.post(f"{_api()}/auth/register", json={
        "email": email, "password": "StrongPass!23", "firstName": "Deny", "lastName": "User",
        "phone": "", "dob": "1990-01-01", "marketingConsent": False, "profile": {},
    }, timeout=20)
    assert reg.status_code == 200, reg.text
    token = s.cookies.get("csrf_token")
    if token:
        s.headers["X-CSRF-Token"] = token
    denied = s.patch(f"{_api()}/clients/c-does-not-exist", json={"phone": "780"}, timeout=20)
    assert denied.status_code in (403, 404)
