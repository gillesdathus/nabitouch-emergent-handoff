"""Password-reset public responses must not reveal account existence on mail failure."""
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import auth


class FakeColl:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(k) == v for k, v in query.items()):
                return dict(row)
        return None

    async def count_documents(self, query):
        return 0

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return None

    async def update_many(self, *a, **k):
        return None

    async def delete_one(self, *a, **k):
        return None


class FakeDb(dict):
    def __getitem__(self, key):
        if key not in self:
            self[key] = FakeColl()
        return dict.__getitem__(self, key)


@pytest.fixture
def forgot_client(monkeypatch):
    monkeypatch.setenv("APP_URL", "https://nabitouch.com")
    monkeypatch.setenv("EMAIL_FROM_NAME", "Nabitouch")
    monkeypatch.setenv("JWT_SECRET", "unit-test-jwt-secret")
    monkeypatch.setattr(auth, "preview_local_reset", lambda: False)

    known = {
        "id": "u-known",
        "email": "known@example.com",
        "name": "Known",
        "role": "client",
        "password_hash": "x",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    db = FakeDb()
    db["nt_users"] = FakeColl([known])
    db["nt_password_resets"] = FakeColl()
    db["nt_login_attempts"] = FakeColl()
    db["nt_sessions"] = FakeColl()

    async def add_audit(*_a, **_k):
        return None

    router, _user_from, _require, _seed = auth.build_auth(db, {"clients": FakeColl()}, add_audit)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app), known


def test_unknown_and_known_delivery_failure_look_alike(forgot_client, monkeypatch):
    client, known = forgot_client

    async def boom(**_kwargs):
        raise HTTPException(502, "Failed to send email")

    monkeypatch.setattr(auth, "send_email", boom)

    unknown = client.post("/api/auth/forgot-password", json={"email": "missing@example.com"})
    known_resp = client.post("/api/auth/forgot-password", json={"email": known["email"]})

    assert unknown.status_code == 200
    assert known_resp.status_code == 200
    assert unknown.json().get("ok") is True
    assert known_resp.json().get("ok") is True
    assert "message" in unknown.json() and "message" in known_resp.json()
    assert unknown.json()["message"] == known_resp.json()["message"]
    assert "token" not in known_resp.json()
    assert "previewResetToken" not in known_resp.json()
