"""Unauthorized users cannot update municipality coverage settings."""
import os

import pytest
import requests


def _required(name):
    value = os.environ.get(name)
    if not value:
        pytest.skip(f"{name} is required")
    return value


API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


@pytest.mark.skipif(not os.environ.get("REACT_APP_BACKEND_URL"), reason="live API URL required")
def test_guest_cannot_list_or_patch_municipality_coverage():
    listed = requests.get(f"{API}/geo/municipalities", timeout=20)
    assert listed.status_code in (401, 403), listed.text
    patched = requests.patch(f"{API}/settings/app", json={
        "serviceCoverage": {"mode": "zones", "municipalityIds": ["4811061"]},
    }, timeout=20)
    assert patched.status_code in (401, 403), patched.text


@pytest.mark.skipif(not os.environ.get("REACT_APP_BACKEND_URL"), reason="live API URL required")
def test_client_cannot_patch_municipality_coverage():
    email = os.environ.get("CLIENT_EMAIL")
    password = os.environ.get("CLIENT_PASSWORD")
    if not email or not password:
        pytest.skip("CLIENT_EMAIL/CLIENT_PASSWORD required")
    session = requests.Session()
    login = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert login.status_code == 200, login.text
    patched = session.patch(f"{API}/settings/app", json={
        "serviceCoverage": {"mode": "zones", "municipalityIds": ["4811061"]},
    }, timeout=20)
    assert patched.status_code in (401, 403), patched.text
