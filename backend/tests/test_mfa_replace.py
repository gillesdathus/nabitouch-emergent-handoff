"""Authenticator replacement, recovery regeneration, and security status (unit, FakeDb)."""
import hashlib
import os
import re
from datetime import datetime, timedelta, timezone
from copy import deepcopy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "unit-test-jwt-secret-key-32b-min")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("DEMO_MODE", "false")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("APP_URL", "http://localhost:3000")

from auth import build_auth, hash_pw, MFA_REPLACE_PENDING_MIN  # noqa: E402
from totp import totp  # noqa: E402


class _UpdateResult:
    def __init__(self, matched=0, modified=0):
        self.matched_count = matched
        self.modified_count = modified


class FakeColl:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def _match(self, row, query):
        for key, expected in (query or {}).items():
            if key == "$or":
                if not any(self._match(row, clause) for clause in expected):
                    return False
                continue
            actual = row.get(key)
            if isinstance(expected, dict):
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$in" in expected and actual not in expected["$in"]:
                    return False
            elif actual != expected:
                return False
        return True

    def _apply(self, row, update):
        out = deepcopy(row)
        for key, value in (update.get("$set") or {}).items():
            out[key] = value
        for key in (update.get("$unset") or {}):
            out.pop(key, None)
        for key, value in (update.get("$pull") or {}).items():
            current = out.get(key) or []
            out[key] = [item for item in current if item != value]
        return out

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if self._match(row, query):
                doc = deepcopy(row)
                if projection:
                    if 0 in projection.values():
                        for key, flag in projection.items():
                            if flag == 0:
                                doc.pop(key, None)
                    else:
                        doc = {key: doc.get(key) for key in projection if projection.get(key)}
                        if "_id" not in projection:
                            doc.pop("_id", None)
                return doc
        return None

    async def insert_one(self, doc):
        self.rows.append(deepcopy(doc))
        return type("R", (), {"inserted_id": doc.get("id") or doc.get("sid")})()

    async def update_one(self, query, update, upsert=False):
        for index, row in enumerate(self.rows):
            if self._match(row, query):
                self.rows[index] = self._apply(row, update)
                return _UpdateResult(1, 1)
        if upsert:
            base = deepcopy(query)
            base.update(update.get("$set") or {})
            self.rows.append(base)
            return _UpdateResult(0, 1)
        return _UpdateResult(0, 0)

    async def update_many(self, query, update):
        matched = modified = 0
        for index, row in enumerate(self.rows):
            if self._match(row, query):
                matched += 1
                next_row = self._apply(row, update)
                if next_row != row:
                    modified += 1
                self.rows[index] = next_row
        return _UpdateResult(matched, modified)

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if self._match(row, query):
                self.rows.pop(index)
                return _UpdateResult(1, 1)
        return _UpdateResult(0, 0)

    async def delete_many(self, query):
        keep, removed = [], 0
        for row in self.rows:
            if self._match(row, query):
                removed += 1
            else:
                keep.append(row)
        self.rows = keep
        return _UpdateResult(removed, removed)

    async def count_documents(self, query):
        return sum(1 for row in self.rows if self._match(row, query))

    async def create_index(self, *_args, **_kwargs):
        return "ok"

    def find(self, query=None, projection=None):
        matched = [deepcopy(row) for row in self.rows if self._match(row, query or {})]
        class Cursor:
            async def to_list(self, _n):
                return matched
        return Cursor()


class FakeDb(dict):
    def __getattr__(self, name):
        return self[name]

    def __getitem__(self, name):
        if name not in self:
            dict.__setitem__(self, name, FakeColl())
        return dict.__getitem__(self, name)


def _recovery_hash(code):
    return hashlib.sha256(str(code).strip().lower().encode()).hexdigest()


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "unit-test-jwt-secret-key-32b-min")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEMO_MODE", "false")
    secret = "JBSWY3DPEHPK3PXP"
    recovery = ["aaaa1111", "bbbb2222", "cccc3333", "dddd4444", "eeee5555", "ffff6666", "gggg7777", "hhhh8888"]
    user = {
        "id": "u-owner",
        "email": "owner@example.com",
        "name": "Owner",
        "role": "owner",
        "password_hash": hash_pw("CurrentPass1"),
        "demo": False,
    }
    db = FakeDb()
    db["nt_users"] = FakeColl([user])
    db["nt_mfa"] = FakeColl([{
        "userId": user["id"],
        "secret": secret,
        "enabled": True,
        "lastCounter": -1,
        "recoveryHashes": [_recovery_hash(code) for code in recovery],
    }])
    db["nt_settings"] = FakeColl([{"id": "app", "mfaEnforcePrivileged": True}])
    db["nt_sessions"] = FakeColl()
    db["nt_login_attempts"] = FakeColl()
    db["nt_devices"] = FakeColl()
    audits = []

    async def add_audit(who, action, detail=None):
        audits.append({"who": who, "action": action, "detail": detail})

    def coll(name):
        return db[f"nt_{name}" if not name.startswith("nt_") else name]

    router, _user_from, _require, _seed = build_auth(db, coll, add_audit)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    return {
        "client": client,
        "db": db,
        "secret": secret,
        "recovery": recovery,
        "audits": audits,
        "user": user,
    }


def _login_mfa(h, *, via="recovery"):
    """Sign in with MFA. Default uses a recovery code so the live TOTP remains usable in the same window."""
    client = h["client"]
    started = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "CurrentPass1"})
    assert started.status_code == 200
    body = started.json()
    assert body.get("mfaRequired") is True
    challenge = body["challenge"]
    if via == "recovery":
        code = h["recovery"].pop(0)
    else:
        code = totp(h["secret"])
    verified = client.post("/api/auth/mfa/verify", json={"challenge": challenge, "code": code})
    assert verified.status_code == 200
    assert verified.cookies.get("access_token")
    client.headers["X-CSRF-Token"] = verified.cookies.get("csrf_token") or ""
    return verified


def test_mfa_login_and_single_use_recovery(harness):
    h = harness
    client = h["client"]
    started = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "CurrentPass1"})
    assert started.json()["mfaRequired"] is True
    challenge = started.json()["challenge"]
    code = h["recovery"][0]
    accepted = client.post("/api/auth/mfa/verify", json={"challenge": challenge, "code": code})
    assert accepted.status_code == 200
    client.cookies.clear()
    again = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "CurrentPass1"})
    rejected = client.post("/api/auth/mfa/verify", json={"challenge": again.json()["challenge"], "code": code})
    assert rejected.status_code == 401


def test_security_requires_auth(harness):
    assert harness["client"].get("/api/auth/security").status_code == 401


def test_replace_success_invalidates_old_secret_and_recovery(harness):
    h = harness
    client = h["client"]
    _login_mfa(h)
    status = client.get("/api/auth/security")
    assert status.status_code == 200
    assert status.json()["mfaEnabled"] is True
    assert status.json()["mfaEnforced"] is True
    assert status.json()["sessionMfaVerified"] is True

    started = client.post("/api/auth/mfa/replace/start", json={"code": totp(h["secret"])})
    assert started.status_code == 200
    assert started.headers.get("Cache-Control") == "no-store"
    setup = started.json()
    assert setup["secret"] != h["secret"]
    assert len(setup["recoveryCodes"]) == 8
    assert "secret" in setup and "otpauth" in setup
    pending = h["db"]["nt_mfa"].rows[0]
    assert pending["secret"] == h["secret"]
    assert pending["pendingSecret"] == setup["secret"]
    assert pending["enabled"] is True

    wrong = "000000" if totp(setup["secret"]) != "000000" else "111111"
    failed = client.post("/api/auth/mfa/replace/confirm", json={"code": wrong})
    assert failed.status_code == 400
    assert h["db"]["nt_mfa"].rows[0]["secret"] == h["secret"]

    confirmed = client.post("/api/auth/mfa/replace/confirm", json={"code": totp(setup["secret"])})
    assert confirmed.status_code == 200
    assert confirmed.json()["replaced"] is True
    stored = h["db"]["nt_mfa"].rows[0]
    assert stored["secret"] == setup["secret"]
    assert "pendingSecret" not in stored
    assert stored["recoveryHashes"] == [_recovery_hash(code) for code in setup["recoveryCodes"]]
    assert any(item["action"] == "Authenticator replaced" for item in h["audits"])

    client.cookies.clear()
    client.headers.pop("X-CSRF-Token", None)
    login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "CurrentPass1"})
    challenge = login.json()["challenge"]
    assert client.post("/api/auth/mfa/verify", json={"challenge": challenge, "code": totp(h["secret"])}).status_code == 401
    # Clear replay protection so the same 30s window can prove the new secret works after replacement.
    h["db"]["nt_mfa"].rows[0]["lastCounter"] = -1
    login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "CurrentPass1"})
    assert client.post("/api/auth/mfa/verify", json={"challenge": login.json()["challenge"], "code": totp(setup["secret"])}).status_code == 200
    client.cookies.clear()
    login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "CurrentPass1"})
    assert client.post("/api/auth/mfa/verify", json={"challenge": login.json()["challenge"], "code": h["recovery"][0]}).status_code == 401


def test_interrupted_replace_keeps_old_authenticator(harness):
    h = harness
    client = h["client"]
    _login_mfa(h)
    started = client.post("/api/auth/mfa/replace/start", json={"code": totp(h["secret"])})
    assert started.status_code == 200
    cancelled = client.post("/api/auth/mfa/replace/cancel", json={})
    assert cancelled.status_code == 200
    stored = h["db"]["nt_mfa"].rows[0]
    assert stored["secret"] == h["secret"]
    assert "pendingSecret" not in stored
    client.cookies.clear()
    login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "CurrentPass1"})
    # Start consumed the current TOTP window; a leftover recovery code proves the old enrollment remains.
    assert client.post("/api/auth/mfa/verify", json={"challenge": login.json()["challenge"], "code": h["recovery"][0]}).status_code == 200


def test_expired_pending_replace_is_cleared(harness):
    h = harness
    client = h["client"]
    _login_mfa(h)
    started = client.post("/api/auth/mfa/replace/start", json={"code": totp(h["secret"])})
    assert started.status_code == 200
    expired = (datetime.now(timezone.utc) - timedelta(minutes=MFA_REPLACE_PENDING_MIN + 1)).isoformat()
    h["db"]["nt_mfa"].rows[0]["pendingCreatedAt"] = expired
    refused = client.post("/api/auth/mfa/replace/confirm", json={"code": totp(started.json()["secret"])})
    assert refused.status_code == 400
    status = client.get("/api/auth/security")
    assert status.json()["replacePending"] is False
    assert "pendingSecret" not in h["db"]["nt_mfa"].rows[0]
    assert h["db"]["nt_mfa"].rows[0]["secret"] == h["secret"]


def test_disable_blocked_when_enforcement_on(harness):
    h = harness
    client = h["client"]
    _login_mfa(h)
    blocked = client.post("/api/auth/mfa/disable", json={"code": totp(h["secret"])})
    assert blocked.status_code == 409
    assert h["db"]["nt_mfa"].rows[0]["enabled"] is True
    assert client.get("/api/auth/security").json()["mfaEnforced"] is True


def test_recovery_regenerate_requires_code_and_shows_once(harness, capsys):
    h = harness
    client = h["client"]
    _login_mfa(h)
    old = list(h["db"]["nt_mfa"].rows[0]["recoveryHashes"])
    regen = client.post("/api/auth/mfa/recovery/regenerate", json={"code": totp(h["secret"])})
    assert regen.status_code == 200
    codes = regen.json()["recoveryCodes"]
    assert len(codes) == 8
    assert h["db"]["nt_mfa"].rows[0]["recoveryHashes"] != old
    assert h["db"]["nt_mfa"].rows[0]["recoveryHashes"] == [_recovery_hash(code) for code in codes]
    captured = capsys.readouterr()
    for code in codes:
        assert code not in captured.out
        assert code not in captured.err
    assert not re.search(r"\b[0-9a-f]{8}\b", captured.out)


def test_client_cannot_start_replace(harness):
    h = harness
    client = h["client"]
    client_user = {
        "id": "u-client",
        "email": "client@example.com",
        "name": "Client",
        "role": "client",
        "password_hash": hash_pw("ClientPass1"),
        "demo": False,
    }
    h["db"]["nt_users"].rows.append(client_user)
    signed = client.post("/api/auth/login", json={"email": "client@example.com", "password": "ClientPass1"})
    assert signed.status_code == 200
    client.headers["X-CSRF-Token"] = signed.cookies.get("csrf_token") or ""
    status = client.get("/api/auth/security")
    assert status.status_code == 200
    assert status.json()["mfaEnforced"] is False
    refused = client.post("/api/auth/mfa/replace/start", json={"code": "123456"})
    assert refused.status_code == 403
