"""Checkout disabled-feature gate must return 503 before authentication."""
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import billing


@pytest.fixture
def checkout_app(monkeypatch):
    auth_calls = {"n": 0}

    async def actor(_request):
        auth_calls["n"] += 1
        raise HTTPException(401, "Not authenticated")

    async def audit(*_args):
        pass

    @asynccontextmanager
    async def lifespan(_app):
        yield

    app = FastAPI(lifespan=lifespan)
    # db/coll are unused on the disabled-checkout short-circuit path.
    app.include_router(billing.build_billing_router(object(), lambda _name: object(), audit, actor))
    with TestClient(app) as client:
        yield client, auth_calls, monkeypatch


def test_disabled_checkout_returns_503_without_auth(checkout_app):
    client, auth_calls, monkeypatch = checkout_app
    monkeypatch.setenv("STRIPE_CARD_CHECKOUT_ENABLED", "false")
    response = client.post("/api/invoices/none/checkout", json={})
    assert response.status_code == 503
    assert "turned off" in response.text
    assert auth_calls["n"] == 0


def test_enabled_checkout_still_requires_authentication(checkout_app):
    client, auth_calls, monkeypatch = checkout_app
    monkeypatch.setenv("STRIPE_CARD_CHECKOUT_ENABLED", "true")
    response = client.post("/api/invoices/none/checkout", json={})
    assert response.status_code == 401
    assert "Not authenticated" in response.text
    assert auth_calls["n"] == 1
