"""Post-deploy smoke for Client Management 2.0 against a live API.

Requires:
  REACT_APP_BACKEND_URL  (e.g. https://nabitouch.com)
  OWNER_EMAIL / OWNER_PASSWORD

Creates a synthetic client, edits contact + identity, checks history, then leaves
the synthetic record (no destructive deletes of production clients).
"""
from __future__ import annotations

import os
import sys
import uuid

import requests


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def main() -> int:
    base = _required("REACT_APP_BACKEND_URL").rstrip("/")
    api = base + "/api" if not base.endswith("/api") else base
    email = _required("OWNER_EMAIL")
    password = _required("OWNER_PASSWORD")

    s = requests.Session()
    login = s.post(f"{api}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert login.status_code == 200, login.text
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf

    health = s.get(f"{api}/health", timeout=15)
    assert health.status_code == 200 and health.json().get("mongo") == "ok"

    token = uuid.uuid4().hex[:8]
    created = s.post(
        f"{api}/clients",
        json={
            "firstName": "Synth",
            "lastName": f"Verify{token}",
            "phone": f"780555{token[:4]}",
            "addresses": [
                {
                    "line": "53337 Rge Rd 215, Ardrossan, AB T8E 2B2",
                    "label": "Home",
                    "purpose": "home",
                    "postal": "T8E 2B2",
                }
            ],
        },
        timeout=30,
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body.get("email") == ""
    assert "Range Road 215" in body["addresses"][0]["line"], body
    cid = body["id"]
    print("created", cid)

    patched = s.patch(
        f"{api}/clients/{cid}",
        json={"preferredName": "Syn", "altPhone": "780-555-0002", "phone": "780-555-4242"},
        timeout=30,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["altPhone"] == "780-555-0002"

    denied_identity = s.patch(f"{api}/clients/{cid}", json={"firstName": "Nope"}, timeout=30)
    assert denied_identity.status_code == 400, denied_identity.text

    identity = s.patch(
        f"{api}/clients/{cid}",
        json={
            "firstName": "Synthetic",
            "_identityCorrection": {
                "method": "verbal_confirmed",
                "reason": "Post-deploy verify spelling",
            },
        },
        timeout=30,
    )
    assert identity.status_code == 200, identity.text
    assert identity.json()["firstName"] == "Synthetic"

    ws = s.get(f"{api}/clients/{cid}/workspace", timeout=30)
    assert ws.status_code == 200, ws.text
    access = ws.json()["access"]
    assert access.get("editProfile") is True
    assert ws.json()["client"]["preferredName"] == "Syn"

    history = s.get(f"{api}/clients/{cid}/profile-history", timeout=30)
    assert history.status_code == 200, history.text
    assert any(row.get("identity") for row in history.json().get("history") or [])

    geo = s.post(f"{api}/geo/check", json={"line": "53337 Rge Rd 215"}, timeout=30)
    assert geo.status_code == 200, geo.text
    assert geo.json().get("eligible") is True
    assert "Range Road 215" in (geo.json().get("line") or "")

    print("VERIFY_OK", cid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
