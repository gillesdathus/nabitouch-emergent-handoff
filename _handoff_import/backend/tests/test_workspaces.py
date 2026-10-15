"""Role homes come from the account, not from a page the browser asks to open."""
import os

import requests


def _required(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


API = _required("REACT_APP_BACKEND_URL").rstrip("/") + "/api"


def login(email, password):
    response = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert response.status_code == 200, response.text
    return response.json(), {"Authorization": f"Bearer {response.cookies.get('access_token')}"}


def test_each_account_receives_only_its_workspaces():
    sarah, _sarah_h = login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    maya, _maya_h = login("maya.demo@example.com", _required("DEMO_PASSWORD"))
    desk, _desk_h = login("reception.demo@example.com", _required("DEMO_PASSWORD"))
    owner, owner_h = login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    assert sarah["workspaces"] == ["client"]
    assert maya["workspaces"] == ["practitioner"]
    assert desk["workspaces"] == ["desk"]
    assert owner["workspaces"] == ["owner", "practitioner"]
    me = requests.get(f"{API}/auth/me", headers=owner_h, timeout=20)
    assert me.status_code == 200
    assert me.json()["workspaces"] == ["owner", "practitioner"]


def test_contact_messages_stay_with_the_owner():
    sent = requests.post(f"{API}/contact", json={"name": "Ada Visitor", "email": "ada.visitor@example.com", "message": "Do you come to the west end?"}, timeout=20)
    assert sent.status_code == 200, sent.text
    public = requests.get(f"{API}/state", timeout=20)
    assert public.status_code == 200
    assert "ada.visitor@example.com" not in public.text
    assert all("base" not in person for person in public.json()["practitioners"])
    _owner, owner_h = login(_required("OWNER_EMAIL"), _required("OWNER_PASSWORD"))
    owner_state = requests.get(f"{API}/state", headers=owner_h, timeout=20)
    assert any(item["email"] == "ada.visitor@example.com" for item in owner_state.json()["inquiries"])
    _desk, desk_h = login("reception.demo@example.com", _required("DEMO_PASSWORD"))
    desk_state = requests.get(f"{API}/state", headers=desk_h, timeout=20)
    assert "inquiries" not in desk_state.json()


def test_client_cannot_open_owner_settings(sarah_headers=None):
    _body, sarah = login("sarah.demo@example.com", _required("DEMO_PASSWORD"))
    denied = requests.patch(f"{API}/settings/app", headers=sarah, json={"gst": 0.05}, timeout=20)
    assert denied.status_code == 403
    _body, desk = login("reception.demo@example.com", _required("DEMO_PASSWORD"))
    desk_denied = requests.patch(f"{API}/zones/z-central", headers=desk, json={"fee": 0}, timeout=20)
    assert desk_denied.status_code == 403
