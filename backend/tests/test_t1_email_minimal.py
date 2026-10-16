# Email (Resend test-inbox) minimal checks: status, one test send, one password reset. Sends 2 emails total.
import os

import pytest
import requests

from t1_common import API, OWNER, SARAH, login

SEND = os.environ.get("T1_SEND_EMAIL") == "1"


def test_email_status_owner():
    o = login(OWNER)
    r = o.get(f"{API}/ops/email/status", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    print(d)
    txt = str(d)
    assert "resend" in txt.lower()
    assert "Nabitouch <bookings@nabitouch.com>" in txt
    assert "info@nabitouch.com" in txt


def test_email_status_rbac():
    assert requests.get(f"{API}/ops/email/status", timeout=20).status_code == 401
    assert login(SARAH).get(f"{API}/ops/email/status", timeout=20).status_code == 403


@pytest.mark.skipif(not SEND, reason="set T1_SEND_EMAIL=1 to send")
def test_email_test_send():
    r = login(OWNER).post(f"{API}/ops/email/test", json={}, timeout=40)
    print(r.status_code, r.text[:300])
    assert r.status_code == 200 and r.json().get("sent") is True


@pytest.mark.skipif(not SEND, reason="set T1_SEND_EMAIL=1 to send")
def test_forgot_password_once():
    r = requests.post(f"{API}/auth/forgot-password", json={"email": SARAH[0]}, timeout=40)
    print(r.status_code, r.text[:300])
    assert r.status_code in (200, 202)
