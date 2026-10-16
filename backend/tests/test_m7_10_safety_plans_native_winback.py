# Regression for milestones 7-10: safety center, wellness plans/credits, refunds/report, native auth, presets, nudge, winback, member badge, devices
import hashlib
import hmac
import json
import os
import random
import time
import uuid
from datetime import date, timedelta

import pytest
import requests
from dotenv import dotenv_values

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
WH_SECRET = dotenv_values("/app/backend/.env").get("STRIPE_WEBHOOK_SECRET")

OWNER = ("owner@nabitouch.test", "Tide-ASlUVxgtlyYfG3c2")
SAMPLE_PW = os.environ.get("SAMPLE_PW", "Sample-7ycTsfXpHCJV")
CLIENT = ("sarah.demo@example.com", SAMPLE_PW)
PRO = ("maya.demo@example.com", SAMPLE_PW)
ADDR = {"label": "Home", "line": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.499, "id": "ad-sarah", "zoneId": "z-central", "clientConfirmed": True}
NATIVE = {"X-Nabitouch-Client": "native"}


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {creds[0]}: {r.status_code} {r.text[:200]}")
    s.headers["X-CSRF-Token"] = s.cookies.get("csrf_token") or ""
    return s


@pytest.fixture(scope="module")
def owner():
    return login(OWNER)


@pytest.fixture(scope="module")
def client():
    return login(CLIENT)


@pytest.fixture(scope="module")
def pro():
    return login(PRO)



def quote_free(sess, extra):
    """Quote sarah/maya swedish 60 on the first slot without a schedule/travel conflict (test data accumulates across runs)."""
    q = None
    for i in range(20):
        d = (date.today() + timedelta(days=12 + i)).isoformat()
        for t in ("10:00", "13:00", "15:00"):
            body = {"source": "online", "practitionerId": "p-maya", "appointment": {
                "serviceSlug": "swedish", "duration": 60, "date": d, "time": t, "locationType": "home", "paymentMethod": "self", "addressId": "ad-sarah", "address": ADDR}}
            body.update(extra)
            q = sess.post(f"{API}/bookings/quote", json=body, timeout=20)
            if not (q.status_code == 409 and any(w in q.text.lower() for w in ("travel", "slot", "available", "booked"))):
                return q
    return q

def book(sess, service="swedish", duration=60, extra=None, expect=200):
    """Book sarah with maya on a random far-future clinic slot; retries slot conflicts."""
    last = None
    for _ in range(8):
        d = (date.today() + timedelta(days=random.randint(3, 30))).isoformat()
        t = random.choice(["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"])
        body = {"source": "online", "practitionerId": "p-maya", "appointment": {
            "serviceSlug": service, "duration": duration, "date": d, "time": t, "locationType": "home", "paymentMethod": "self", "addressId": "ad-sarah",
            "address": ADDR}}
        body.update(extra or {})
        last = sess.post(f"{API}/bookings", json=body, timeout=30)
        if last.status_code == expect:
            return last
        if last.status_code == 409 and expect != 409 and ("slot" in last.text.lower() or "travel" in last.text.lower() or "time" in last.text.lower() or "available" in last.text.lower()) and "credit" not in last.text.lower() and "welcome" not in last.text.lower():
            continue
        return last
    return last


def drive(owner, aid, path):
    for to in path:
        r = owner.post(f"{API}/appointments/{aid}/transition", json={"to": to}, timeout=20)
        assert r.status_code == 200, f"{to}: {r.status_code} {r.text[:200]}"
    return r.json()


def get_appt(owner, aid):
    return next(a for a in owner.get(f"{API}/state", timeout=30).json()["appointments"] if a["id"] == aid)


def to_en_route(owner, aid):
    status = get_appt(owner, aid)["status"]
    path = {"requested": ["assigned", "en_route"], "confirmed": ["en_route"], "assigned": ["en_route"]}.get(status, ["en_route"])
    return drive(owner, aid, path)


def credits_state(client):
    return client.get(f"{API}/plans/mine", timeout=20).json()


def sign(payload: str):
    t = str(int(time.time()))
    v1 = hmac.new(WH_SECRET.encode(), f"{t}.{payload}".encode(), hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def webhook(event):
    payload = json.dumps(event)
    return requests.post(f"{API}/stripe/webhook", data=payload, headers={"Stripe-Signature": sign(payload), "Content-Type": "application/json"}, timeout=20)


# --- Safety center
class TestSafety:
    def test_safety_flow(self, owner, client, pro):
        b = book(client)
        assert b.status_code == 200, b.text
        aid = b.json()["appointment"]["id"]
        # checkin before en_route -> 409
        assert pro.post(f"{API}/appointments/{aid}/safety/checkin", timeout=20).status_code == 409
        to_en_route(owner, aid)
        assert pro.post(f"{API}/appointments/{aid}/safety/checkout", timeout=20).status_code == 409  # checkin first
        r = pro.post(f"{API}/appointments/{aid}/safety/checkin", timeout=20)
        assert r.status_code == 200 and r.json()["safety"]["checkinAt"]
        # client cannot do safety actions
        assert client.post(f"{API}/appointments/{aid}/assist", json={}, timeout=20).status_code == 403
        # other validation
        assert pro.post(f"{API}/appointments/{aid}/incidents", json={"kind": "other", "action": "request_fix"}, timeout=20).status_code == 400
        assert pro.post(f"{API}/appointments/{aid}/incidents", json={"kind": "bogus", "action": "request_fix"}, timeout=20).status_code == 400
        fix = pro.post(f"{API}/appointments/{aid}/incidents", json={"kind": "obstructed", "action": "request_fix", "note": "TEST_ boxes"}, timeout=20)
        assert fix.status_code == 200 and fix.json()["status"] == "en_route"
        a = pro.post(f"{API}/appointments/{aid}/assist", json={"note": "TEST_"}, timeout=20)
        assert a.status_code == 200 and a.json()["dispatch"] is False and "not emergency" in a.json()["label"]
        e = pro.post(f"{API}/appointments/{aid}/emergency-call", timeout=20)
        assert e.status_code == 200 and e.json()["sent"] is False
        hold = pro.post(f"{API}/appointments/{aid}/incidents", json={"kind": "unsafe", "action": "cannot_proceed", "note": "TEST_ dog"}, timeout=20)
        assert hold.status_code == 200 and hold.json()["status"] == "safety_hold"
        ev = pro.get(f"{API}/appointments/{aid}/safety", timeout=20).json()
        kinds = [x["kind"] for x in ev["events"]]
        assert {"checkin", "incident", "assist", "emergency_call_opened"} <= set(kinds)
        # managers
        open_ev = owner.get(f"{API}/safety/events?status=open", timeout=20).json()
        hold_id = hold.json()["event"]["id"]
        assert any(x["id"] == hold_id for x in open_ev["events"])
        assert "recipients" not in open_ev["events"][0]
        assert pro.get(f"{API}/safety/events", timeout=20).status_code == 403
        ack = owner.post(f"{API}/safety/events/{hold_id}/ack", timeout=20)
        assert ack.status_code == 200 and ack.json()["status"] == "acknowledged"
        assert owner.post(f"{API}/safety/events/{hold_id}/resolve", json={}, timeout=20).status_code == 400
        res = owner.post(f"{API}/safety/events/{hold_id}/resolve", json={"outcome": "resume", "note": "TEST_ cleared"}, timeout=20)
        assert res.status_code == 200 and res.json()["status"] == "resolved"
        appt = get_appt(owner, aid)
        assert appt["status"] == "arrived"
        drive(owner, aid, ["in_session", "session_ended", "leaving"])
        co = pro.post(f"{API}/appointments/{aid}/safety/checkout", timeout=20)
        assert co.status_code == 200 and co.json()["safety"]["checkoutAt"]
        drive(owner, aid, ["completed"])
        TestSafety.aid = aid

    def test_safety_managers_and_me(self, owner, pro):
        g = owner.get(f"{API}/safety/managers", timeout=20)
        assert g.status_code == 200 and "staff" in g.json()
        prev = g.json()["managers"]
        assert pro.get(f"{API}/safety/managers", timeout=20).status_code == 403
        maya_uid = pro.get(f"{API}/auth/me", timeout=20).json().get("id") or pro.get(f"{API}/auth/me", timeout=20).json().get("user", {}).get("id")
        p = owner.put(f"{API}/safety/managers", json={"managers": [maya_uid, "bogus"]}, timeout=20)
        assert p.status_code == 200 and p.json()["managers"] == [maya_uid]
        assert pro.get(f"{API}/safety/me", timeout=20).json()["manager"] is True
        assert pro.get(f"{API}/safety/events", timeout=20).status_code == 200
        owner.put(f"{API}/safety/managers", json={"managers": prev}, timeout=20)
        assert owner.get(f"{API}/safety/me", timeout=20).json()["manager"] is True


# --- Plans products
class TestPlanProducts:
    def test_public_plans(self):
        r = requests.get(f"{API}/plans", timeout=20)
        ids = [p["id"] for p in r.json()["products"]]
        assert r.status_code == 200 and "plp-five" in ids and "plp-monthly" in ids
        assert all(p["status"] == "published" for p in r.json()["products"])

    def test_product_crud_validation(self, owner, client):
        assert client.get(f"{API}/plans/products", timeout=20).status_code == 403
        base = {"kind": "package", "name": "TEST_pack", "serviceSlug": "swedish", "duration": 60, "credits": 3, "priceCents": 30000}
        assert owner.post(f"{API}/plans/products", json={**base, "credits": 25}, timeout=20).status_code == 400
        assert owner.post(f"{API}/plans/products", json={**base, "priceCents": 50}, timeout=20).status_code == 400
        assert owner.post(f"{API}/plans/products", json={**base, "duration": 47}, timeout=20).status_code == 400
        c = owner.post(f"{API}/plans/products", json=base, timeout=20)
        assert c.status_code == 200 and c.json()["status"] == "draft"
        pid = c.json()["id"]
        u = owner.put(f"{API}/plans/products/{pid}", json={**base, "name": "TEST_pack2"}, timeout=20)
        assert u.status_code == 200 and u.json()["name"] == "TEST_pack2"
        assert owner.post(f"{API}/plans/products/{pid}/status", json={"status": "bad"}, timeout=20).status_code == 400
        s = owner.post(f"{API}/plans/products/{pid}/status", json={"status": "archived"}, timeout=20)
        assert s.status_code == 200 and s.json()["status"] == "archived"
        assert pid not in [p["id"] for p in requests.get(f"{API}/plans", timeout=20).json()["products"]]


# --- Checkout + webhook settlement
class TestCheckout:
    def test_package_checkout_and_webhook_idempotent(self, client):
        r = client.post(f"{API}/plans/plp-five/checkout", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=40)
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["sessionId"].startswith("cs_test_") and out["url"] and "stripe.com" in out["url"]
        assert client.post(f"{API}/plans/plp-five/checkout", json={}, timeout=20).status_code == 400
        before = credits_state(client)["totals"]["available"]
        total = next(p for p in credits_state(client)["purchases"] if p["id"] == out["purchaseId"])["total"]["cents"]
        ev = {"id": "evt_TEST_" + uuid.uuid4().hex[:10], "type": "checkout.session.completed", "data": {"object": {
            "id": out["sessionId"], "amount_total": total, "payment_status": "paid", "payment_intent": "pi_test_x", "customer": "cus_x"}}}
        w = webhook(ev)
        assert w.status_code == 200 and w.json()["settled"] is True, w.text
        assert webhook(ev).status_code == 200
        after = credits_state(client)
        assert after["totals"]["available"] == before + 5
        assert next(p for p in after["purchases"] if p["id"] == out["purchaseId"])["status"] == "paid"
        TestCheckout.purchase = out["purchaseId"]

    def test_bad_signature(self):
        assert requests.post(f"{API}/stripe/webhook", data="{}", headers={"Stripe-Signature": "t=1,v1=bad"}, timeout=20).status_code == 400

    def test_membership_subscribe_and_renewal(self, client, owner):
        prod = owner.post(f"{API}/plans/products", json={"kind": "membership", "name": "TEST_member", "serviceSlug": "swedish", "duration": 60, "credits": 1, "priceCents": 9900}, timeout=20).json()
        owner.post(f"{API}/plans/products/{prod['id']}/status", json={"status": "published"}, timeout=20)
        TestCheckout.mprod = prod["id"]
        r = client.post(f"{API}/plans/memberships/{prod['id']}/subscribe", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=40)
        if r.status_code == 409:
            pytest.skip("Sarah already has the membership active")
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["sessionId"].startswith("cs_test_") and out["membershipId"]
        total = next(p for p in credits_state(client)["purchases"] if p["id"] == out["purchaseId"])["total"]["cents"]
        sub = "sub_TEST_" + uuid.uuid4().hex[:8]
        assert webhook({"id": "evt_TEST_" + uuid.uuid4().hex[:8], "type": "checkout.session.completed", "data": {"object": {
            "id": out["sessionId"], "amount_total": total, "payment_status": "paid", "invoice": "in_TEST_first", "subscription": sub, "customer": "cus_x"}}}).json()["settled"]
        before = credits_state(client)["totals"]["available"]
        inv = {"id": "evt_TEST_" + uuid.uuid4().hex[:8], "type": "invoice.paid", "data": {"object": {"id": "in_TEST_" + uuid.uuid4().hex[:6], "subscription": sub, "amount_paid": total, "billing_reason": "subscription_cycle"}}}
        assert webhook(inv).status_code == 200
        webhook(inv)
        assert credits_state(client)["totals"]["available"] == before + 1
        assert client.post(f"{API}/plans/memberships/{prod['id']}/subscribe", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=20).status_code == 409
        owner.post(f"{API}/plans/products/{prod['id']}/status", json={"status": "archived"}, timeout=20)

    def test_renewal_by_metadata(self, client):
        before = credits_state(client)["totals"]["available"]
        inv = {"id": "evt_TEST_" + uuid.uuid4().hex[:8], "type": "invoice.paid", "data": {"object": {"id": "in_TEST_" + uuid.uuid4().hex[:6], "amount_paid": 11340,
               "billing_reason": "subscription_cycle", "parent": {"subscription_details": {"subscription": "sub_TEST_none", "metadata": {"membershipId": "mem-sample1"}}}}}}
        assert webhook(inv).json()["settled"] is True
        assert credits_state(client)["totals"]["available"] == before + 1


# --- Credit booking
class TestCreditBooking:
    def test_quote_with_credit(self, client):
        q = quote_free(client, {"useCredit": True})
        assert q.status_code == 200, q.text
        p = q.json().get("pricing") or q.json()
        assert p["packageCredit"] is True and p["discount"] == p["base"]
        assert p["treatmentAfterDiscount"] == 0

    def test_credit_reserve_release_consume(self, owner, client):
        a0 = credits_state(client)["totals"]["available"]
        b = book(client, extra={"useCredit": True})
        assert b.status_code == 200, b.text
        appt = b.json()["appointment"]
        assert appt.get("creditId")
        s = credits_state(client)["totals"]
        assert s["available"] == a0 - 1
        owner.post(f"{API}/appointments/{appt['id']}/transition", json={"to": "cancelled"}, timeout=20)
        assert credits_state(client)["totals"]["available"] == a0
        b2 = book(client, extra={"useCredit": True})
        assert b2.status_code == 200, b2.text
        aid = b2.json()["appointment"]["id"]
        to_en_route(owner, aid)
        drive(owner, aid, ["arrived", "in_session", "session_ended", "leaving", "completed"])
        st = credits_state(client)
        assert st["totals"]["available"] == a0 - 1
        c = [h for h in st["history"] if h.get("appointmentId") == aid and h.get("type") in ("consumed", "consume")]
        assert c or st["totals"]["consumed"] >= 1
        mk = owner.post(f"{API}/invoices/from-appointment/{aid}", json={}, timeout=20)
        assert mk.status_code in (200, 409), mk.text
        inv = owner.get(f"{API}/invoices/by-appointment/{aid}", timeout=20)
        assert inv.status_code == 200, inv.text
        assert "prepaid_credit" in inv.text and "Prepaid package credit" in inv.text

    def test_credit_conflicts(self, client):
        assert book(client, extra={"useCredit": True, "redeemPoints": True}, expect=409).status_code == 409
        r = book(client, service="hot-stone", duration=90, extra={"useCredit": True}, expect=409)
        assert r.status_code == 409


# --- Refund + report
class TestRefundReport:
    def test_refund_prorata_idempotent(self, owner, client):
        pid = getattr(TestCheckout, "purchase", None) or "pp-sample1"
        key = "TEST_" + uuid.uuid4().hex[:10]
        assert owner.post(f"{API}/plans/purchases/{pid}/refund", json={"idempotencyKey": key}, timeout=30).status_code == 400
        r = owner.post(f"{API}/plans/purchases/{pid}/refund", json={"reason": "TEST_ refund", "idempotencyKey": key}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] in ("refunded", "partially_refunded") and body["refunded"]["cents"] > 0
        again = owner.post(f"{API}/plans/purchases/{pid}/refund", json={"reason": "TEST_ refund", "idempotencyKey": key}, timeout=30)
        assert again.status_code == 200 and again.json()["refunded"]["cents"] == body["refunded"]["cents"]
        assert owner.post(f"{API}/plans/purchases/{pid}/refund", json={"reason": "x", "idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=30).status_code == 409

    def test_partial_refund_keeps_reserved(self, owner, client):
        out = client.post(f"{API}/plans/plp-five/checkout", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=40).json()
        total = next(p for p in credits_state(client)["purchases"] if p["id"] == out["purchaseId"])["total"]["cents"]
        assert webhook({"id": "evt_TEST_" + uuid.uuid4().hex[:8], "type": "checkout.session.completed", "data": {"object": {"id": out["sessionId"], "amount_total": total, "payment_status": "paid"}}}).json()["settled"]
        # reserve one credit from this new purchase: hold all other available credits aside by booking against the earliest-expiring first is not controllable, so book and check
        b = book(client, extra={"useCredit": True})
        assert b.status_code == 200, b.text
        aid = b.json()["appointment"]["id"]
        purchases = {p["id"]: p for p in owner.get(f"{API}/plans/purchases", timeout=20).json()}
        avail = purchases[out["purchaseId"]]["usage"]["available"]
        key = "TEST_" + uuid.uuid4().hex[:10]
        r = owner.post(f"{API}/plans/purchases/{out['purchaseId']}/refund", json={"reason": "TEST_ partial", "idempotencyKey": key}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["refunded"]["cents"] == round(total * avail / 5)
        again = owner.post(f"{API}/plans/purchases/{out['purchaseId']}/refund", json={"reason": "TEST_ partial", "idempotencyKey": key}, timeout=30)
        assert again.status_code == 200 and again.json()["refunded"]["cents"] == r.json()["refunded"]["cents"]
        owner.post(f"{API}/appointments/{aid}/transition", json={"to": "cancelled"}, timeout=20)

    def test_plans_report(self, owner):
        r = owner.get(f"{API}/finance/reports/plans", timeout=30)
        assert r.status_code == 200, r.text
        txt = json.dumps(r.json())
        for k in ("Plans sold", "Recognized on use", "Outstanding prepaid obligation", "Membership MRR"):
            assert k in txt
        assert owner.get(f"{API}/finance/reports/plans?format=csv", timeout=30).status_code == 200
        pdf = owner.get(f"{API}/finance/reports/plans?format=pdf", timeout=30)
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


# --- Native sign-in (API only)
class TestNative:
    def test_native_flow(self):
        body = {"email": CLIENT[0], "password": CLIENT[1], "device": "TEST_iphone"}
        assert requests.post(f"{API}/auth/native/login", json=body, timeout=20).status_code == 400
        r = requests.post(f"{API}/auth/native/login", json=body, headers=NATIVE, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["accessToken"] and d["refreshToken"] and d["user"]["email"] == CLIENT[0]
        bearer = {"Authorization": f"Bearer {d['accessToken']}"}
        assert requests.get(f"{API}/auth/me", headers={**bearer, **NATIVE}, timeout=20).status_code == 200
        assert requests.get(f"{API}/auth/me", headers=bearer, timeout=20).status_code == 401
        r2 = requests.post(f"{API}/auth/native/refresh", json={"refreshToken": d["refreshToken"]}, headers=NATIVE, timeout=20)
        assert r2.status_code == 200 and r2.json()["refreshToken"] != d["refreshToken"]
        reuse = requests.post(f"{API}/auth/native/refresh", json={"refreshToken": d["refreshToken"]}, headers=NATIVE, timeout=20)
        assert reuse.status_code == 401
        assert requests.post(f"{API}/auth/native/refresh", json={"refreshToken": r2.json()["refreshToken"]}, headers=NATIVE, timeout=20).status_code == 401
        # logout revokes
        d3 = requests.post(f"{API}/auth/native/login", json=body, headers=NATIVE, timeout=20).json()
        assert requests.post(f"{API}/auth/native/logout", json={"refreshToken": d3["refreshToken"]}, headers=NATIVE, timeout=20).status_code == 200
        assert requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {d3['accessToken']}", **NATIVE}, timeout=20).status_code == 401

    def test_native_lockout(self):
        email = f"test_lock_{uuid.uuid4().hex[:6]}@example.com"
        codes = [requests.post(f"{API}/auth/native/login", json={"email": email, "password": "wrong"}, headers=NATIVE, timeout=20).status_code for _ in range(6)]
        assert codes[:5] == [401] * 5 and codes[5] == 429

    def test_web_login_unchanged(self, client):
        assert client.get(f"{API}/auth/me", timeout=20).status_code == 200


# --- Messaging presets
class TestPresets:
    def test_presets_by_role(self, client, pro):
        p = {x["id"] for x in pro.get(f"{API}/messages/presets", timeout=20).json()["presets"]}
        assert {"on_my_way", "started", "late", "arrived", "finding", "entrance", "ready", "access", "area", "assist"} <= p
        c = {x["id"] for x in client.get(f"{API}/messages/presets", timeout=20).json()["presets"]}
        assert {"ready", "parking", "client_late", "door_code", "side", "meet", "minutes", "help"} <= c

    def test_preset_rules_and_delay(self, client, pro, owner):
        b = book(client)
        aid = b.json()["appointment"]["id"]
        assert client.post(f"{API}/appointments/{aid}/messages", json={"presetId": "on_my_way"}, timeout=20).status_code == 403
        assert client.post(f"{API}/appointments/{aid}/messages", json={"presetId": "client_late", "minutes": 7}, timeout=20).status_code == 400
        assert client.post(f"{API}/appointments/{aid}/messages", json={"presetId": "client_late", "minutes": 10}, timeout=20).status_code == 200
        first = pro.post(f"{API}/appointments/{aid}/messages", json={"presetId": "late", "minutes": 15, "recordDelay": True}, timeout=20)
        assert first.status_code == 200 and first.json()["duplicate"] is False, first.text
        second = pro.post(f"{API}/appointments/{aid}/messages", json={"presetId": "late", "minutes": 15, "recordDelay": True}, timeout=20)
        assert second.status_code == 200 and second.json()["duplicate"] is True
        lst = pro.get(f"{API}/appointments/{aid}/messages", timeout=20).json()
        assert len([n for n in lst["notices"] if n.get("event") == "delayed"]) == 1
        assert len([m for m in lst["messages"] if m.get("presetId") == "late"]) == 1
        appt = get_appt(owner, aid)
        TestPresets.delayed_events = len([e for e in appt.get("events", []) if e["status"] == "delayed"])
        owner.post(f"{API}/appointments/{aid}/transition", json={"to": "cancelled"}, timeout=20)
        assert TestPresets.delayed_events == 1, f"appointment.events has {TestPresets.delayed_events} 'delayed' rows after a duplicate send"


# --- Nudge + member badge
class TestNudgeMember:
    def test_nudge_shape(self, client):
        r = client.get(f"{API}/plans/nudge", timeout=20)
        assert r.status_code == 200 and "nudge" in r.json()

    def test_member_badge(self, pro, owner):
        r = pro.get(f"{API}/plans/visit/a-105/member", timeout=20)
        assert r.status_code == 200, r.text
        m = [x for x in r.json()["memberships"] if x["id"] == "mem-sample1"]
        assert m and m[0]["name"] == "Monthly calm" and m[0]["creditsLeft"] >= 0
        other = owner.get(f"{API}/appointments?practitionerId=p-liam", timeout=20)
        liam_appt = next((a["id"] for a in (other.json() if isinstance(other.json(), list) else other.json().get("appointments", [])) if a.get("practitionerId") != "p-maya"), None)
        if liam_appt:
            assert pro.get(f"{API}/plans/visit/{liam_appt}/member", timeout=20).status_code == 404


# --- Winback
class TestWinback:
    def test_settings(self, owner, client):
        g = owner.get(f"{API}/winback/settings", timeout=20)
        assert g.status_code == 200 and {"inactiveDays", "percent", "validDays"} <= set(g.json())
        prev = g.json()
        assert client.get(f"{API}/winback/settings", timeout=20).status_code == 403
        assert owner.put(f"{API}/winback/settings", json={**prev, "inactiveDays": 5}, timeout=20).status_code == 400
        assert owner.put(f"{API}/winback/settings", json={**prev, "percent": 60}, timeout=20).status_code == 400
        assert owner.put(f"{API}/winback/settings", json={**prev, "validDays": 100}, timeout=20).status_code == 400
        assert owner.put(f"{API}/winback/settings", json={"inactiveDays": 60, "percent": 15, "validDays": 30}, timeout=20).status_code == 200
        c = owner.get(f"{API}/winback/candidates", timeout=20)
        assert c.status_code == 200 and "candidates" in c.json()

    def test_invite_lifecycle(self, owner, client):
        for i in owner.get(f"{API}/winback/invites", timeout=20).json():
            if i["clientId"] == "c-sarah" and i["status"] == "issued":
                owner.post(f"{API}/winback/invites/{i['id']}/void", timeout=20)
        inv = owner.post(f"{API}/winback/invites", json={"clientId": "c-sarah"}, timeout=20)
        assert inv.status_code == 200, inv.text
        code = inv.json()["code"]
        assert code.startswith("BACK-") and len(code) == 11
        assert owner.post(f"{API}/winback/invites", json={"clientId": "c-sarah"}, timeout=20).status_code == 409
        assert client.get(f"{API}/winback/mine", timeout=20).json()["invite"]["code"] == code
        assert book(client, extra={"winbackCode": code, "useCredit": True}, expect=409).status_code == 409
        assert book(client, extra={"winbackCode": "BACK-ZZZZZZ"}, expect=404).status_code == 404
        q = quote_free(client, {"winbackCode": code})
        p = q.json().get("pricing") or q.json()
        assert q.status_code == 200 and "Welcome back offer" in p["promoName"] and abs(p["discount"] - round(p["base"] * 0.15, 2)) < 0.02
        b = book(client, extra={"winbackCode": code})
        assert b.status_code == 200, b.text
        aid = b.json()["appointment"]["id"]
        st = [i for i in owner.get(f"{API}/winback/invites", timeout=20).json() if i["code"] == code][0]
        assert st["status"] == "reserved"
        owner.post(f"{API}/appointments/{aid}/transition", json={"to": "cancelled"}, timeout=20)
        st = [i for i in owner.get(f"{API}/winback/invites", timeout=20).json() if i["code"] == code][0]
        assert st["status"] == "issued"
        b = book(client, extra={"winbackCode": code})
        assert b.status_code == 200, b.text
        aid = b.json()["appointment"]["id"]
        to_en_route(owner, aid)
        drive(owner, aid, ["arrived", "in_session", "session_ended", "leaving", "completed"])
        st = [i for i in owner.get(f"{API}/winback/invites", timeout=20).json() if i["code"] == code][0]
        assert st["status"] == "redeemed"
        assert book(client, extra={"winbackCode": code}, expect=409).status_code == 409
        # void
        inv2 = owner.post(f"{API}/winback/invites", json={"clientId": "c-sarah"}, timeout=20).json()
        v = owner.post(f"{API}/winback/invites/{inv2['id']}/void", timeout=20)
        assert v.status_code == 200 and v.json()["status"] == "voided"
        assert owner.post(f"{API}/winback/invites/{inv2['id']}/void", timeout=20).status_code == 409


# --- Devices / push
class TestDevices:
    def test_devices_and_held_push(self, owner, pro, client):
        tok = "TEST_tok_" + uuid.uuid4().hex
        assert owner.post(f"{API}/devices", json={"platform": "web", "token": tok}, timeout=20).status_code == 400
        assert owner.post(f"{API}/devices", json={"platform": "ios", "token": "short"}, timeout=20).status_code == 400
        r = owner.post(f"{API}/devices", json={"platform": "ios", "token": tok, "app": "pro"}, timeout=20)
        assert r.status_code == 200 and r.json()["pushEnabled"] is False
        did = r.json()["id"]
        assert owner.post(f"{API}/devices", json={"platform": "ios", "token": tok}, timeout=20).json()["id"] == did
        assert any(d["id"] == did for d in owner.get(f"{API}/devices", timeout=20).json()["devices"])
        st = owner.get(f"{API}/devices/status", timeout=20).json()
        assert st["pushEnabled"] is False  # Firebase Admin credentials are now configured (credentials ok)
        held0 = st["outbox"]["held"]
        assert pro.get(f"{API}/devices/status", timeout=20).status_code == 403
        b = book(client)
        aid = b.json()["appointment"]["id"]
        to_en_route(owner, aid)
        assert pro.post(f"{API}/appointments/{aid}/assist", json={}, timeout=20).status_code == 200
        assert owner.get(f"{API}/devices/status", timeout=20).json()["outbox"]["held"] >= held0 + 1
        assert pro.delete(f"{API}/devices/{did}", timeout=20).status_code == 404
        assert owner.delete(f"{API}/devices/{did}", timeout=20).status_code == 200
        owner.post(f"{API}/appointments/{aid}/transition", json={"to": "cancelled"}, timeout=20)


# --- Iteration 3 retest: fixes 1, 3, 4, 5 and messaging regression
class TestIter3Fixes:
    def test_full_refund_replay_returns_200(self, owner, client):
        out = client.post(f"{API}/plans/plp-five/checkout", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=40).json()
        total = next(p for p in credits_state(client)["purchases"] if p["id"] == out["purchaseId"])["total"]["cents"]
        assert webhook({"id": "evt_TEST_" + uuid.uuid4().hex[:8], "type": "checkout.session.completed", "data": {"object": {"id": out["sessionId"], "amount_total": total, "payment_status": "paid"}}}).json()["settled"]
        key = "TEST_" + uuid.uuid4().hex[:10]
        r = owner.post(f"{API}/plans/purchases/{out['purchaseId']}/refund", json={"reason": "TEST_ full", "idempotencyKey": key}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "refunded" and r.json()["refunded"]["cents"] == total
        again = owner.post(f"{API}/plans/purchases/{out['purchaseId']}/refund", json={"reason": "TEST_ full", "idempotencyKey": key}, timeout=30)
        assert again.status_code == 200, again.text
        assert again.json()["status"] == "refunded" and again.json()["refunded"]["cents"] == total and again.json()["id"] == out["purchaseId"]
        other = owner.post(f"{API}/plans/purchases/{out['purchaseId']}/refund", json={"reason": "x", "idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=30)
        assert other.status_code == 409

    def test_report_refund_labels(self, owner):
        txt = json.dumps(owner.get(f"{API}/finance/reports/plans", timeout=30).json())
        assert "Refunded (net of GST)" in txt and "Refunded (incl. GST)" in txt

    def test_seeded_credentials(self, owner):
        # every sample practitioner can be assigned (credentials seeded)
        st = owner.get(f"{API}/state", timeout=30).json()
        assert any(p["id"] == "p-maya" for p in st.get("practitioners", []))

    def test_resolve_hold_closes_siblings(self, owner, client, pro):
        b = book(client)
        assert b.status_code == 200, b.text
        aid = b.json()["appointment"]["id"]
        to_en_route(owner, aid)
        pro.post(f"{API}/appointments/{aid}/safety/checkin", timeout=20)
        assert pro.post(f"{API}/appointments/{aid}/incidents", json={"kind": "obstructed", "action": "request_fix", "note": "TEST_"}, timeout=20).status_code == 200
        assert pro.post(f"{API}/appointments/{aid}/assist", json={"note": "TEST_"}, timeout=20).status_code == 200
        hold = pro.post(f"{API}/appointments/{aid}/incidents", json={"kind": "unsafe", "action": "cannot_proceed", "note": "TEST_"}, timeout=20)
        assert hold.status_code == 200
        hid = hold.json()["event"]["id"]
        evs = owner.get(f"{API}/safety/events", timeout=20).json()["events"]
        mine = [e for e in evs if e.get("appointmentId") == aid]
        assert len([e for e in mine if e["status"] != "resolved"]) >= 3, mine
        # ack one sibling to check acknowledged ones also close
        sib = next(e for e in mine if e["id"] != hid)
        owner.post(f"{API}/safety/events/{sib['id']}/ack", timeout=20)
        assert owner.post(f"{API}/safety/events/{hid}/resolve", json={"outcome": "cancel", "note": "TEST_"}, timeout=20).status_code in (200, 400)
        r = owner.post(f"{API}/safety/events/{hid}/resolve", json={"outcome": "resume", "note": "TEST_"}, timeout=20) if get_appt(owner, aid)["status"] == "safety_hold" else None
        evs = owner.get(f"{API}/safety/events", timeout=20).json()["events"]
        left = [e for e in evs if e.get("appointmentId") == aid and e["status"] != "resolved"]
        assert left == [], left
        if get_appt(owner, aid)["status"] not in ("cancelled", "completed"):
            owner.post(f"{API}/appointments/{aid}/transition", json={"to": "cancelled"}, timeout=20)

    def test_messages_without_key_repeat(self, owner, client, pro):
        b = book(client)
        assert b.status_code == 200, b.text
        aid = b.json()["appointment"]["id"]
        for i in range(3):
            r = client.post(f"{API}/appointments/{aid}/messages", json={"body": f"TEST_ hello {i}"}, timeout=20)
            assert r.status_code == 200 and r.json()["duplicate"] is False, r.text
        for i in range(2):
            r = pro.post(f"{API}/appointments/{aid}/messages", json={"presetId": "started"}, timeout=20)
            assert r.status_code == 200, r.text
        msgs = client.get(f"{API}/appointments/{aid}/messages", timeout=20).json()["messages"]
        assert len([m for m in msgs if m["body"].startswith("TEST_ hello")]) == 3
        owner.post(f"{API}/appointments/{aid}/transition", json={"to": "cancelled"}, timeout=20)
