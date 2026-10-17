# Shared helpers for the iteration-4 production-readiness suites (login, CSRF, signing helpers)
import base64
import hashlib
import hmac
import json
import os
import random
import time
from datetime import date, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values


def _backend_env():
    if os.environ.get("PYTHON_DOTENV_DISABLED") == "1":
        return {}
    candidates = [Path("/app/backend/.env"), Path(__file__).resolve().parents[1] / ".env"]
    for path in candidates:
        if path.is_file():
            return dotenv_values(path)
    return {}


def _need(name, *aliases):
    """Isolated suites read secrets from the environment. They are not stored in source."""
    file_env = _backend_env()
    for source in (os.environ, file_env):
        for key in (name, *aliases):
            value = (source.get(key) or "").strip()
            if value:
                return value
    raise RuntimeError(f"{name} must be set for isolated tests")


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env").get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL must be set for isolated tests")
API = f"{BASE_URL}/api"
BENV = {**_backend_env(), **os.environ}
OWNER = (_need("OWNER_EMAIL"), _need("OWNER_PASSWORD"))
SAMPLE_PW = _need("DEMO_PASSWORD", "SAMPLE_PW")
SARAH = ("sarah.demo@example.com", SAMPLE_PW)
MAYA = ("maya.demo@example.com", SAMPLE_PW)
NATIVE = {"X-Nabitouch-Client": "native"}


def login(creds, csrf=True):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=20)
    if r.status_code != 200:
        pytest.fail(f"fixture login failed: HTTP {r.status_code}")
    if csrf:
        s.headers["X-CSRF-Token"] = s.cookies.get("csrf_token") or ""
    return s


def stripe_sign(payload: str):
    t = str(int(time.time()))
    v1 = hmac.new(BENV["STRIPE_WEBHOOK_SECRET"].encode(), f"{t}.{payload}".encode(), hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def stripe_webhook(event):
    # PAYMENT_MODE=test requires event.livemode is False (not omitted).
    # Callers may still set livemode=True to assert live-event rejection.
    body = dict(event)
    if "livemode" not in body:
        body["livemode"] = False
    payload = json.dumps(body)
    return requests.post(f"{API}/stripe/webhook", data=payload, headers={"Stripe-Signature": stripe_sign(payload), "Content-Type": "application/json"}, timeout=30)


def twilio_sign(url, params):
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    return base64.b64encode(hmac.new(BENV["TWILIO_AUTH_TOKEN"].encode(), data.encode(), hashlib.sha1).digest()).decode()


def rand_slot():
    d = (date.today() + timedelta(days=random.randint(3, 120))).isoformat()
    return d, random.choice(["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"])
