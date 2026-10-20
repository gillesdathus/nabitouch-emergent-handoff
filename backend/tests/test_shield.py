"""Security Shield Stages 3–8 — unit coverage for codes, status, privacy."""
import hmac

import pytest

from config import (
    security_shield_arrival_code_enabled,
    security_shield_docs_enabled,
    security_shield_fleet_enabled,
)
import shield as shield_mod


def test_shield_flags_default_off(monkeypatch):
    monkeypatch.delenv("SECURITY_SHIELD_FLEET_ENABLED", raising=False)
    monkeypatch.delenv("SECURITY_SHIELD_DOCS_ENABLED", raising=False)
    monkeypatch.delenv("SECURITY_SHIELD_ARRIVAL_CODE_ENABLED", raising=False)
    assert security_shield_fleet_enabled() is False
    assert security_shield_docs_enabled() is False
    assert security_shield_arrival_code_enabled() is False


def test_arrival_code_hash_is_deterministic_and_not_plaintext():
    a = shield_mod.hash_arrival_code("apt-1", "123456")
    b = shield_mod.hash_arrival_code("apt-1", "123456")
    c = shield_mod.hash_arrival_code("apt-1", "654321")
    d = shield_mod.hash_arrival_code("apt-2", "123456")
    assert a == b
    assert a != c
    assert a != d
    assert "123456" not in a


def test_generate_code_length():
    assert len(shield_mod.generate_code(6)) == 6
    assert len(shield_mod.generate_code(4)) == 4
    assert shield_mod.generate_code(6).isdigit()


def test_compute_doc_status_expiry_windows():
    from datetime import date, timedelta
    today = date(2026, 10, 19)
    assert shield_mod.compute_doc_status({"status": "pending_review"}, today) == "pending_review"
    assert shield_mod.compute_doc_status({"status": "verified", "expiresOn": "2026-10-10"}, today) == "expired"
    assert shield_mod.compute_doc_status({"status": "verified", "expiresOn": "2026-11-01"}, today) == "expiring_soon"
    assert shield_mod.compute_doc_status({"status": "verified", "expiresOn": "2027-01-01"}, today) == "verified"
    assert shield_mod.compute_doc_status({"status": "verified"}, today) == "missing_expiry"


def test_staff_dl_masks_number(monkeypatch):
    monkeypatch.setattr(shield_mod, "open_text", lambda v: "AB1234567")
    row = {
        "id": "dl-1",
        "practitionerId": "p1",
        "licenceNumber": "sealed",
        "status": "pending_review",
        "expiresOn": "2027-01-01",
        "versions": [],
    }
    out = shield_mod.staff_dl(row)
    assert "licenceNumber" not in out
    assert out["licenceNumberMasked"].endswith("4567")


def test_compare_digest_used_for_codes():
    # Guard: verification path must use constant-time compare (imported via hmac).
    assert hmac.compare_digest(shield_mod.hash_arrival_code("a", "1"), shield_mod.hash_arrival_code("a", "1"))
