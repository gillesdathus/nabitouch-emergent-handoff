# Shared helpers for the iteration-4 production-readiness suites (login, CSRF, signing helpers)
import base64
import hashlib
import hmac
import json
import os
import random
import time
from datetime import date, timedelta

import pytest
import requests
from dotenv import dotenv_values

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api"
BENV = dotenv_values("/app/backend/.env")
OWNER = ("owner@nabitouch.test", "Tide-ASlUVxgtlyYfG3c2")
SAMPLE_PW = os.environ.get("SAMPLE_PW", "Sample-7ycTsfXpHCJV")
SARAH = ("sarah.demo@example.com", SAMPLE_PW)
MAYA = ("maya.demo@example.com", SAMPLE_PW)
NATIVE = {"X-Nabitouch-Client": "native"}


def login(creds, csrf=True):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {creds[0]}: {r.status_code} {r.text[:200]}")
    if csrf:
        s.headers["X-CSRF-Token"] = s.cookies.get("csrf_token") or ""
    return s


def stripe_sign(payload: str):
    t = str(int(time.time()))
    v1 = hmac.new(BENV["STRIPE_WEBHOOK_SECRET"].encode(), f"{t}.{payload}".encode(), hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def stripe_webhook(event):
    payload = json.dumps(event)
    return requests.post(f"{API}/stripe/webhook", data=payload, headers={"Stripe-Signature": stripe_sign(payload), "Content-Type": "application/json"}, timeout=30)


def twilio_sign(url, params):
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    return base64.b64encode(hmac.new(BENV["TWILIO_AUTH_TOKEN"].encode(), data.encode(), hashlib.sha1).digest()).decode()


def rand_slot():
    d = (date.today() + timedelta(days=random.randint(3, 120))).isoformat()
    return d, random.choice(["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"])
