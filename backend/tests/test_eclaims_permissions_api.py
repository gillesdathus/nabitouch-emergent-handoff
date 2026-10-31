"""Owner-only eClaims grant management — normalization and immediate revocation."""
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import billing


class _Users:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None):
        return _Cursor(self.rows)

    async def find_one(self, query, projection=None):
        subject = query.get("subject")
        for row in self.rows:
            if row.get("subject") == subject:
                return dict(row)
        return None


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._i >= len(self.rows):
            raise StopAsyncIteration
        row = self.rows[self._i]
        self._i += 1
        return dict(row)


class _Settings:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, query, projection=None):
        return dict(self.doc)

    async def update_one(self, query, update, upsert=False):
        sets = (update or {}).get("$set") or {}
        self.doc.update(sets)
        return None


@pytest.fixture
def perms_app(monkeypatch):
    settings_doc = {"id": "app", "receptionPerms": {"eclaimsView": True}, "eclaimsPractitionerGrants": {}}
    users = _Users([
        {"id": "u-maya", "name": "Maya Chen", "email": "maya@example.com", "subject": "p-maya", "role": "practitioner", "roles": ["practitioner"], "status": "active"},
    ])
    settings_coll = _Settings(settings_doc)
    audits = []

    def coll(name):
        if name == "users":
            return users
        if name == "settings":
            return settings_coll
        raise AssertionError(name)

    async def add_audit(actor, action, appt_id=None, *, actor_id=None):
        audits.append({"actor": actor, "action": action, "actor_id": actor_id})

    async def user_from(request):
        role = request.headers.get("x-fixture-role", "owner")
        if role == "anon":
            return None
        return {
            "id": "u-" + role,
            "role": role,
            "roles": [role],
            "name": role.title(),
            "subject": "p-maya" if role == "practitioner" else None,
        }

    @asynccontextmanager
    async def lifespan(_app):
        yield

    app = FastAPI(lifespan=lifespan)
    app.include_router(billing.build_billing_router(object(), coll, add_audit, user_from))
    with TestClient(app) as client:
        yield client, settings_doc, audits


def test_owner_lists_and_sets_practitioner_grants(perms_app):
    client, settings_doc, audits = perms_app
    listed = client.get("/api/billing/eclaims/permissions", headers={"x-fixture-role": "owner"})
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["manager"]["canManagePermissions"] is False
    assert body["practitioners"][0]["subject"] == "p-maya"
    assert body["practitioners"][0]["grants"] == []

    saved = client.put(
        "/api/billing/eclaims/permissions/p-maya",
        headers={"x-fixture-role": "owner"},
        json={"flags": {"view": True, "submit": True, "viewSensitive": False, "allTreatments": False}},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["grants"] == ["view", "submit"]
    assert settings_doc["eclaimsPractitionerGrants"]["p-maya"] == ["view", "submit"]
    assert audits and "eClaims permissions" in audits[-1]["action"]


def test_clearing_view_revokes_dependents_immediately(perms_app):
    client, settings_doc, audits = perms_app
    settings_doc["eclaimsPractitionerGrants"]["p-maya"] = ["view", "submit", "view_sensitive", "all"]
    cleared = client.put(
        "/api/billing/eclaims/permissions/p-maya",
        headers={"x-fixture-role": "owner"},
        json={"flags": {"view": False, "submit": True, "viewSensitive": True, "allTreatments": True}},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["grants"] == []
    assert "p-maya" not in settings_doc["eclaimsPractitionerGrants"]
    assert "revoked" in audits[-1]["action"].lower()


def test_submit_without_view_normalizes_to_include_view(perms_app):
    client, settings_doc, _audits = perms_app
    saved = client.put(
        "/api/billing/eclaims/permissions/p-maya",
        headers={"x-fixture-role": "owner"},
        json={"grants": ["submit"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["grants"] == ["view", "submit"]
    assert settings_doc["eclaimsPractitionerGrants"]["p-maya"] == ["view", "submit"]


def test_manager_and_practitioner_cannot_manage_grants(perms_app):
    client, _settings_doc, _audits = perms_app
    for role in ("manager", "practitioner", "desk"):
        denied = client.put(
            "/api/billing/eclaims/permissions/p-maya",
            headers={"x-fixture-role": role},
            json={"flags": {"view": True}},
        )
        assert denied.status_code == 403, role
        listed = client.get("/api/billing/eclaims/permissions", headers={"x-fixture-role": role})
        assert listed.status_code == 403, role
