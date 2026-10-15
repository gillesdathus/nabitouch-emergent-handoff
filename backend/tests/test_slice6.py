"""Slice 6 — health and owner operations status stay free of secrets."""
import json
import os

import requests


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def test_health_and_ops_status_do_not_expose_secrets():
    health = requests.get(f"{API}/health", timeout=20)
    assert health.status_code == 200, health.text
    body = health.json()
    assert body["mongo"] == "ok" and body["redis"] == "ok" and body["status"] == "ok"
    dumped = json.dumps(body).lower()
    assert "mongodb://" not in dumped and "redis://" not in dumped and "password" not in dumped
    guest = requests.get(f"{API}/ops/status", timeout=20)
    assert guest.status_code == 401
    signed = requests.post(f"{API}/auth/login", json={"email": _required("OWNER_EMAIL"), "password": _required("OWNER_PASSWORD")}, timeout=20)
    owner = {"Authorization": f"Bearer {signed.cookies.get('access_token')}"}
    ops = requests.get(f"{API}/ops/status", headers=owner, timeout=20)
    assert ops.status_code == 200, ops.text
    ops_body = ops.json()
    assert ops_body["transactionMode"] == ("replica-set" if ops_body["replicaSet"] else "standalone-journal")
    sarah = requests.post(f"{API}/auth/login", json={"email": "sarah.demo@example.com", "password": _required("DEMO_PASSWORD")}, timeout=20)
    hidden = requests.get(f"{API}/ops/status", headers={"Authorization": f"Bearer {sarah.cookies.get('access_token')}"}, timeout=20)
    assert hidden.status_code == 403
