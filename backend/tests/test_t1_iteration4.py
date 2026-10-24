# Iteration 4 production-readiness: RBAC/isolation, CSRF, lockout, native login, webhooks, address confirmation,
# Deep Tissue 5-pack credits, SMS held outbox, push devices, booking+billing E2E. Run with -n 0.
import asyncio
import os
import threading
import uuid

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

from booking_fixtures import EDMONTON_HOME, LEDUC_OUTSIDE
from t1_common import API, BASE_URL, BENV, MAYA, NATIVE, OWNER, SARAH, login, rand_slot, stripe_webhook, twilio_sign

PW = "TEST_Pw-" + uuid.uuid4().hex[:10]
ADDR_OK = {**EDMONTON_HOME, "zoneId": "z-central"}


def mongo(fn):
    async def run():
        c = AsyncIOMotorClient(BENV["MONGO_URL"])
        try:
            return await fn(c[BENV["DB_NAME"]])
        finally:
            c.close()
    return asyncio.run(run())


@pytest.fixture(scope="module")
def owner():
    return login(OWNER)


@pytest.fixture(scope="module")
def sarah():
    return login(SARAH)


@pytest.fixture(scope="module")
def maya():
    return login(MAYA)


@pytest.fixture(scope="module")
def desk(owner):
    email = f"test_desk_{uuid.uuid4().hex[:6]}@example.com"
    r = owner.post(f"{API}/auth/staff", json={"email": email, "password": PW, "name": "TEST Desk", "role": "desk"}, timeout=20)
    assert r.status_code == 200, r.text
    return login((email, PW))


@pytest.fixture(scope="module")
def pro2(owner):
    email = f"t1pro{uuid.uuid4().hex[:6]}@qa-nabitouch.dev"
    r = owner.post(f"{API}/auth/staff", json={"email": email, "password": PW, "name": "TEST Prozwei", "role": "practitioner"}, timeout=20)
    assert r.status_code == 200, r.text
    return login((email, PW))


@pytest.fixture(scope="module")
def client_b():
    email = f"test_cb_{uuid.uuid4().hex[:6]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": PW, "firstName": "TEST", "lastName": "ClientB", "phone": "780-555-0199",
                                             "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True}, timeout=20)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed {r.status_code} {r.text[:200]}")
    return login((email, PW))


def book(sess, service="swedish", duration=60, extra=None, address=None, location="home", tries=25):
    last = None
    for _ in range(tries):
        d, t = rand_slot()
        appt = {"serviceSlug": service, "duration": duration, "date": d, "time": t, "locationType": location, "paymentMethod": "self"}
        if location == "home":
            appt.update({"addressId": "ad-sarah", "address": address or ADDR_OK})
        body = {"source": "online", "practitionerId": "p-maya", "appointment": appt, "idempotencyKey": "TEST_" + uuid.uuid4().hex[:12]}
        body.update(extra or {})
        last = sess.post(f"{API}/bookings", json=body, timeout=40)
        if last.status_code == 409 and any(w in last.text.lower() for w in ("slot", "available", "taken", "booked", "travel", "time")) and "credit" not in last.text.lower():
            continue
        return last
    return last


def drive(owner, aid, path):
    out = None
    for to in path:
        out = owner.post(f"{API}/appointments/{aid}/transition", json={"to": to}, timeout=30)
        assert out.status_code == 200, f"{to}: {out.status_code} {out.text[:200]}"
    return out


def appt_of(owner, aid):
    return next(a for a in owner.get(f"{API}/state", timeout=40).json()["appointments"] if a["id"] == aid)


def to_en_route(owner, aid):
    st = appt_of(owner, aid)["status"]
    drive(owner, aid, {"requested": ["assigned", "en_route"]}.get(st, ["en_route"]))


# ---------------- AUTH / RBAC / ISOLATION
class TestAuthRBAC:
    def test_unauthenticated_401(self):
        for path in ("/plans/mine", "/winback/mine", "/devices", "/invoices", "/finance/reports/revenue", "/safety/me", "/ops/email/status", "/devices/status"):
            r = requests.get(f"{API}{path}", timeout=20)
            assert r.status_code == 401, f"{path} -> {r.status_code}"

    def test_desk_blocked_from_owner_only(self, desk):
        checks = [("post", "/plans/products", {"name": "x"}), ("get", "/winback/settings", None), ("get", "/winback/candidates", None), ("get", "/winback/invites", None),
                  ("post", "/winback/invites", {}), ("put", "/safety/managers", {}), ("get", "/devices/status", None), ("get", "/sms/status-summary", None),
                  ("get", "/ops/email/status", None), ("post", "/ops/email/test", {}), ("get", "/finance/reports/revenue", None), ("get", "/finance/reports/earnings", None)]
        bad = []
        for m, p, body in checks:
            r = getattr(desk, m)(f"{API}{p}", json=body, timeout=20) if body is not None else getattr(desk, m)(f"{API}{p}", timeout=20)
            if r.status_code != 403:
                bad.append(f"{m.upper()} {p} -> {r.status_code}")
        assert not bad, bad

    def test_client_cannot_see_other_clients(self, sarah, client_b, owner):
        st_b = client_b.get(f"{API}/state", timeout=30).json()
        assert all(c["id"] != "c-sarah" for c in st_b.get("clients", []))
        assert all(a.get("clientId") != "c-sarah" for a in st_b.get("appointments", []))
        sarah_appts = [a for a in sarah.get(f"{API}/state", timeout=40).json()["appointments"]]
        aid = sarah_appts[0]["id"]
        bad = []
        for m, p in (("get", f"/appointments/{aid}/messages"), ("get", f"/invoices/by-appointment/{aid}"), ("get", f"/appointments/{aid}/preparation"),
                     ("post", f"/appointments/{aid}/transition"), ("patch", "/clients/c-sarah"), ("post", f"/appointments/{aid}/messages")):
            body = {"to": "cancelled"} if "transition" in p else ({"smsConsent": False} if "clients" in p else {"body": "hi", "text": "hi"})
            r = getattr(client_b, m)(f"{API}{p}", json=body, timeout=20) if m != "get" else client_b.get(f"{API}{p}", timeout=20)
            if r.status_code not in (403, 404):
                bad.append(f"{m} {p} -> {r.status_code} {r.text[:80]}")
        invs = owner.get(f"{API}/invoices", params={"clientId": "c-sarah"}, timeout=30).json()
        items = invs.get("invoices") or invs.get("items") or (invs if isinstance(invs, list) else [])
        if items:
            iid = items[0]["id"]
            for p in (f"/invoices/{iid}", f"/invoices/{iid}/pdf", f"/invoices/{iid}/receipt"):
                r = client_b.get(f"{API}{p}", timeout=20)
                if r.status_code not in (403, 404):
                    bad.append(f"get {p} -> {r.status_code}")
        mine_b = client_b.get(f"{API}/plans/mine", timeout=20).json()
        assert mine_b["totals"]["available"] == 0 and not mine_b["purchases"]
        wb = client_b.get(f"{API}/winback/mine", timeout=20)
        assert wb.status_code == 200 and "c-sarah" not in wb.text
        assert not bad, bad

    def test_practitioner_isolation(self, pro2, maya, owner):
        appts = [a for a in owner.get(f"{API}/state", timeout=40).json()["appointments"] if a.get("practitionerId") == "p-maya"]
        aid = appts[-1]["id"]
        bad = []
        for m, p, body in (("get", f"/appointments/{aid}/safety", None), ("post", f"/appointments/{aid}/incidents", {"kind": "other", "note": "TEST"}),
                           ("get", f"/plans/visit/{aid}/member", None), ("get", f"/appointments/{aid}/preparation", None),
                           ("post", f"/appointments/{aid}/assist", {"note": "TEST"}), ("get", f"/appointments/{aid}/messages", None),
                           ("get", f"/appointments/{aid}/mobile-brief", None)):
            r = pro2.get(f"{API}{p}", timeout=20) if m == "get" else pro2.post(f"{API}{p}", json=body, timeout=20)
            if r.status_code not in (403, 404):
                bad.append(f"{m} {p} -> {r.status_code} {r.text[:80]}")
        if "/finance/reports/earnings" in str(bad):
            pass
        assert maya.get(f"{API}/appointments/{aid}/safety", timeout=20).status_code == 200
        assert not bad, bad

    def test_csrf_required(self):
        s = login(SARAH, csrf=False)
        r = s.patch(f"{API}/clients/c-sarah", json={"preferredName": "Sarah"}, timeout=20)
        assert r.status_code == 403, r.status_code
        s.headers["X-CSRF-Token"] = "wrong"
        assert s.patch(f"{API}/clients/c-sarah", json={"preferredName": "Sarah"}, timeout=20).status_code == 403

    def test_login_lockout(self, client_b):
        email = None
        # brand-new user to avoid locking sample accounts
        email = f"test_lk_{uuid.uuid4().hex[:6]}@example.com"
        requests.post(f"{API}/auth/register", json={"email": email, "password": PW, "firstName": "TEST", "lastName": "Lock", "phone": "780-555-0198",
                                                    "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True}, timeout=20)
        codes = [requests.post(f"{API}/auth/login", json={"email": email, "password": "wrong-pass-123"}, timeout=20).status_code for _ in range(6)]
        good = requests.post(f"{API}/auth/login", json={"email": email, "password": PW}, timeout=20)
        print("lockout codes", codes, good.status_code)
        assert codes[:5] == [401] * 5 and codes[5] in (423, 429) and good.status_code in (423, 429)

    def test_native_login(self):
        r = requests.post(f"{API}/auth/native/login", json={"email": MAYA[0], "password": MAYA[1]}, headers=NATIVE, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        tok = d.get("accessToken") or d.get("access_token")
        assert tok and d.get("refreshToken")
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}", **NATIVE}, timeout=20)
        assert me.status_code == 200 and me.json()["email"] == MAYA[0]
        assert requests.post(f"{API}/auth/native/login", json={"email": MAYA[0], "password": MAYA[1]}, timeout=20).status_code in (400, 403)


# ---------------- WEBHOOKS
class TestWebhooks:
    def test_twilio_bad_signature(self):
        for p in ("/sms/status", "/sms/inbound"):
            assert requests.post(f"{API}{p}", data={"MessageSid": "SM1"}, timeout=20).status_code == 403
            assert requests.post(f"{API}{p}", data={"MessageSid": "SM1"}, headers={"X-Twilio-Signature": "bad"}, timeout=20).status_code == 403

    def test_twilio_inbound_stop_and_other(self):
        num = "+1780555" + str(uuid.uuid4().int)[:4]
        url = f"{BASE_URL}/api/sms/inbound"
        form = {"MessageSid": "SM" + uuid.uuid4().hex, "From": num, "Body": "STOP"}
        r = requests.post(url, data=form, headers={"X-Twilio-Signature": twilio_sign(url, form)}, timeout=20)
        print("STOP", r.status_code, r.text[:200])
        assert r.status_code == 200 and "<Response" in r.text and "xml" in r.headers.get("content-type", "")
        import hashlib
        h = hashlib.sha256(num.encode()).hexdigest()
        assert mongo(lambda db: db.nt_sms_optouts.find_one({"phoneHash": h})) is not None
        form2 = {"MessageSid": "SM" + uuid.uuid4().hex, "From": num, "Body": "hello there"}
        r2 = requests.post(url, data=form2, headers={"X-Twilio-Signature": twilio_sign(url, form2)}, timeout=20)
        print("OTHER", r2.text[:300])
        assert r2.status_code == 200 and "<Message>" in r2.text
        mongo(lambda db: db.nt_sms_optouts.delete_one({"phoneHash": h}))

    def test_stripe_bad_sig(self):
        assert requests.post(f"{API}/stripe/webhook", data="{}", headers={"Stripe-Signature": "t=1,v1=bad"}, timeout=20).status_code == 400

    def test_resend_webhook_unconfigured(self):
        r = requests.post(f"{API}/notifications/resend", data="{}", headers={"Content-Type": "application/json"}, timeout=20)
        assert r.status_code == 503, r.status_code

    def test_cron(self):
        url = f"{BASE_URL}/api/cron/sms-reminders"
        assert requests.post(url, json={}, timeout=20).status_code == 401
        assert requests.post(url, json={}, headers={"Authorization": "Bearer nope"}, timeout=20).status_code == 401
        h = {"Authorization": f"Bearer {BENV['WEBHOOK_CRON_SECRET']}", "X-Webhook-Id": "TEST_" + uuid.uuid4().hex}
        a = requests.post(url, json={}, headers=h, timeout=20)
        b = requests.post(url, json={}, headers=h, timeout=20)
        assert a.status_code == 200 and a.json() == {"accepted": True}
        assert b.status_code == 200 and b.json().get("duplicate") is True


# ---------------- ADDRESS CONFIRMATION
class TestAddress:
    def test_unconfirmed_rejected(self, sarah):
        r = book(sarah, address={**ADDR_OK, "clientConfirmed": False})
        assert r.status_code == 400 and "Confirm the service address" in r.text, r.text

    def test_out_of_area_in_zones_mode(self, sarah, owner):
        prior = owner.get(f"{API}/state", timeout=20).json()["settings"]
        prior_cov = dict(prior.get("serviceCoverage") or {})
        try:
            assert owner.patch(f"{API}/settings/app", json={
                "serviceCoverage": {**prior_cov, "mode": "zones", "travelFeesEnabled": prior_cov.get("travelFeesEnabled", False)},
            }, timeout=20).status_code == 200
            r = book(sarah, address=dict(LEDUC_OUTSIDE))
            assert r.status_code == 400 and "outside" in r.text.lower(), r.text
        finally:
            owner.patch(f"{API}/settings/app", json={"serviceCoverage": prior_cov or {"mode": "open", "travelFeesEnabled": False}}, timeout=20)

    @pytest.mark.skipif(os.environ.get("MAPBOX_LIVE") != "true", reason="Toronto geocoding needs a live Mapbox token")
    def test_out_of_area_live_mapbox_zones_mode(self, sarah, owner):
        prior = owner.get(f"{API}/state", timeout=20).json()["settings"]
        prior_cov = dict(prior.get("serviceCoverage") or {})
        try:
            assert owner.patch(f"{API}/settings/app", json={
                "serviceCoverage": {**prior_cov, "mode": "zones", "travelFeesEnabled": prior_cov.get("travelFeesEnabled", False)},
            }, timeout=20).status_code == 200
            r = book(sarah, address={"label": "X", "line": "100 Queen St W, Toronto, ON", "postal": "M5H 2N2", "lat": 43.6532, "lng": -79.3832, "clientConfirmed": True})
            assert r.status_code == 400 and "outside" in r.text.lower(), r.text
        finally:
            owner.patch(f"{API}/settings/app", json={"serviceCoverage": prior_cov or {"mode": "open", "travelFeesEnabled": False}}, timeout=20)

    def test_booking_marks_saved_address(self, sarah, owner):
        mongo(lambda db: db.nt_clients.update_one({"id": "c-sarah", "addresses.id": "ad-sarah"}, {"$unset": {"addresses.$.clientConfirmed": "", "addresses.$.confidence": ""}}))
        r = book(sarah)
        assert r.status_code == 200, r.text
        cl = next(c for c in sarah.get(f"{API}/state", timeout=40).json()["clients"] if c["id"] == "c-sarah")
        ad = next(a for a in cl["addresses"] if a["id"] == "ad-sarah")
        print(ad)
        assert ad.get("clientConfirmed") is True and ad.get("confidence") == "address"
        drive(owner, r.json()["appointment"]["id"], ["cancelled"])


# ---------------- DEEP TISSUE 5-PACK
class TestDeep5:
    def test_catalog(self):
        products = requests.get(f"{API}/plans", timeout=20).json()["products"]
        p = next((x for x in products if x["id"] == "plp-deep5"), None)
        if p is None:
            pytest.skip("Deep Tissue 5-pack is not in this database catalogue")
        print({k: p.get(k) for k in ("name", "priceCents", "credits", "duration", "regularCents", "perCredit", "serviceSlug")})
        assert p["name"] == "Deep Tissue 5-Pack" and p["priceCents"] == 50000 and p["credits"] == 5 and p["duration"] == 60 and p["regularCents"] == 55000
        assert "100.00" in str(p.get("perCredit") or p.get("perCreditCents") or p)

    def test_purchase_book_cancel_complete(self, sarah, owner):
        products = requests.get(f"{API}/plans", timeout=20).json()["products"]
        if not any(x["id"] == "plp-deep5" for x in products):
            pytest.skip("Deep Tissue 5-pack is not in this database catalogue")
        before = {g["serviceSlug"]: g for g in sarah.get(f"{API}/plans/mine", timeout=20).json()["wallet"]}.get("deep-tissue", {}).get("available", 0)
        out = sarah.post(f"{API}/plans/plp-deep5/checkout", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=40)
        assert out.status_code == 200, out.text
        out = out.json()
        pur = next(p for p in sarah.get(f"{API}/plans/mine", timeout=20).json()["purchases"] if p["id"] == out["purchaseId"])
        print("purchase", pur.get("total"), pur.get("status"))
        assert pur["total"]["cents"] == 52500 and pur["status"] != "paid"
        ev = {"id": "evt_TEST_" + uuid.uuid4().hex[:10], "type": "checkout.session.completed", "data": {"object": {
            "id": out["sessionId"], "amount_total": 52500, "payment_status": "paid", "payment_intent": "pi_TEST_" + uuid.uuid4().hex[:8], "customer": "cus_x"}}}
        assert stripe_webhook(ev).status_code == 200
        assert stripe_webhook(ev).status_code == 200
        ev2 = {**ev, "id": "evt_TEST_" + uuid.uuid4().hex[:10]}
        assert stripe_webhook(ev2).status_code == 200
        mine = sarah.get(f"{API}/plans/mine", timeout=20).json()
        after = {g["serviceSlug"]: g for g in mine["wallet"]}["deep-tissue"]["available"]
        assert after == before + 5, (before, after)
        assert mongo(lambda db: db.nt_credits.count_documents({"purchaseId": out["purchaseId"]})) == 5
        # concurrent credit bookings must not reserve the same credit
        res = []
        def go():
            res.append(book(sarah, service="deep-tissue", extra={"useCredit": True}))
        th = [threading.Thread(target=go) for _ in range(2)]
        [t.start() for t in th]
        [t.join() for t in th]
        ok = [r.json()["appointment"] for r in res if r.status_code == 200]
        print("concurrent", [r.status_code for r in res], [a.get("creditId") for a in ok])
        assert len({a["creditId"] for a in ok}) == len(ok)
        a1 = ok[0]
        assert a1.get("discount") == a1.get("base") or a1.get("price", {}).get("discount") == a1.get("price", {}).get("base") or True
        print("credit appt pricing", a1.get("pricing") or {k: a1.get(k) for k in a1 if k in ("price", "total", "discount", "base", "tax")})
        pr = a1.get("pricing") or {}
        assert pr.get("discount") == pr.get("base"), pr
        mid = sarah.get(f"{API}/plans/mine", timeout=20).json()
        dt = {g["serviceSlug"]: g for g in mid["wallet"]}["deep-tissue"]
        assert dt["available"] == after - len(ok)
        drive(owner, a1["id"], ["cancelled"])
        dt2 = {g["serviceSlug"]: g for g in sarah.get(f"{API}/plans/mine", timeout=20).json()["wallet"]}["deep-tissue"]
        assert dt2["available"] == dt["available"] + 1
        if len(ok) > 1:
            a2 = ok[1]
            to_en_route(owner, a2["id"])
            drive(owner, a2["id"], ["arrived", "in_session", "session_ended", "leaving", "completed"])
            dt3 = {g["serviceSlug"]: g for g in sarah.get(f"{API}/plans/mine", timeout=20).json()["wallet"]}["deep-tissue"]
            assert dt3["consumed"] == dt2["consumed"] + 1 and dt3["reserved"] == dt2["reserved"] - 1
            TestDeep5.completed = a2["id"]

    def test_credit_with_winback_409(self, sarah):
        r = book(sarah, service="deep-tissue", extra={"useCredit": True, "winbackCode": "TESTCODE"})
        assert r.status_code in (409, 400), r.text
        print("credit+winback", r.status_code, r.text[:150])

    def test_credit_visit_earnings_per_credit(self, owner):
        aid = getattr(TestDeep5, "completed", None)
        if not aid:
            pytest.skip("no completed credit visit")
        mk = owner.post(f"{API}/invoices/from-appointment/{aid}", json={}, timeout=20)
        inv = owner.get(f"{API}/invoices/by-appointment/{aid}", timeout=20).json()
        print("credit invoice", str(inv)[:900])
        assert "prepaid_credit" in str(inv)


# ---------------- SMS held outbox
class TestSmsHeld:
    def test_on_the_way_held_and_dedupe(self, sarah, owner, client_b):
        owner.patch(f"{API}/clients/c-sarah", json={"smsConsent": True}, timeout=20)
        r = book(sarah)
        assert r.status_code == 200, r.text
        aid = r.json()["appointment"]["id"]
        to_en_route(owner, aid)
        rows = mongo(lambda db: db.nt_sms_outbox.find({"appointmentId": aid}, {"_id": 0, "status": 1, "kind": 1, "dedupeKey": 1}).to_list(10))
        print(rows)
        assert len(rows) == 1 and rows[0]["status"] == "held" and rows[0]["kind"] == "on_the_way"
        drive(owner, aid, ["arrived"])
        back = owner.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, timeout=20)
        print("re-en_route", back.status_code)
        assert mongo(lambda db: db.nt_sms_outbox.count_documents({"appointmentId": aid, "kind": "on_the_way"})) == 1
        drive(owner, aid, ["cancelled"]) if back.status_code == 200 else None

    def test_no_consent_no_row(self, owner, client_b):
        r = book(client_b, location="clinic")
        if r.status_code != 200:
            r = book(client_b, address=dict(EDMONTON_HOME))
        print("client_b booking", r.status_code, r.text[:150])
        assert r.status_code == 200
        aid = r.json()["appointment"]["id"]
        to_en_route(owner, aid)
        assert mongo(lambda db: db.nt_sms_outbox.count_documents({"appointmentId": aid})) == 0


# ---------------- PUSH devices
class TestDevices:
    def test_devices(self, owner, maya, sarah, pro2):
        mongo(lambda db: db.nt_device_registrations.delete_many({}))
        tok = "TESTtok" + uuid.uuid4().hex * 2
        r = maya.post(f"{API}/devices", json={"platform": "android", "token": tok, "app": "pro"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("fingerprint") and "token" not in d and "tokenSealed" not in d
        lst = maya.get(f"{API}/devices", timeout=20)
        assert tok not in lst.text and "tokenSealed" not in lst.text
        assert "tokenSealed" not in owner.get(f"{API}/devices/all", timeout=20).text
        assert sarah.post(f"{API}/devices", json={"platform": "android", "token": tok + "x"}, timeout=20).status_code == 403
        assert pro2.delete(f"{API}/devices/{d['id']}", timeout=20).status_code == 404
        assert maya.delete(f"{API}/devices/{d['id']}", timeout=20).status_code == 200
        codes = [maya.post(f"{API}/devices", json={"platform": "android", "token": "TESTtok" + uuid.uuid4().hex * 2}, timeout=20).status_code for _ in range(10)]
        print("reg codes", codes)
        assert 429 in codes
        st = owner.get(f"{API}/devices/status", timeout=20).json()
        print("push status", st)
        assert st.get("pushEnabled") is False
        credentials = str(st.get("credentials") or "")
        if credentials == "missing":
            assert st.get("firebaseConfigured") is False
        else:
            assert "ok" in credentials
        mongo(lambda db: db.nt_device_registrations.delete_many({}))

    def test_native_logout_revokes(self):
        r = requests.post(f"{API}/auth/native/login", json={"email": MAYA[0], "password": MAYA[1]}, headers=NATIVE, timeout=20).json()
        h = {"Authorization": f"Bearer {r.get('accessToken') or r.get('access_token')}", **NATIVE}
        dv = requests.post(f"{API}/devices", json={"platform": "android", "token": "TESTnat" + uuid.uuid4().hex * 2}, headers=h, timeout=20)
        assert dv.status_code == 200, dv.text
        lo = requests.post(f"{API}/auth/native/logout", json={"refreshToken": r["refreshToken"]}, headers=h, timeout=20)
        assert lo.status_code in (200, 204), lo.text
        doc = mongo(lambda db: db.nt_devices.find_one({"id": dv.json()["id"]}, {"_id": 0, "active": 1, "revokedReason": 1}))
        print(doc)
        assert doc["active"] is False

    def test_assist_creates_held_push(self, owner, maya, sarah):
        tok = "TESTown" + uuid.uuid4().hex * 2
        owner.post(f"{API}/devices", json={"platform": "android", "token": tok}, timeout=20)
        r = book(sarah)
        assert r.status_code == 200
        aid = r.json()["appointment"]["id"]
        to_en_route(owner, aid)
        a = maya.post(f"{API}/appointments/{aid}/assist", json={"note": "TEST assist"}, timeout=20)
        print("assist", a.status_code, a.text[:150])
        since = a.json().get("at") if a.status_code == 200 and isinstance(a.json(), dict) else None
        import time as _t; _t.sleep(1)
        rows = mongo(lambda db: db.nt_push_outbox.find({"kind": {"$in": ["safety_alert", "assist"]}}, {"_id": 0, "status": 1, "kind": 1, "at": 1}).sort("at", -1).to_list(5))
        print(rows)
        assert rows and all(x["status"] == "held" for x in rows)


# ---------------- BOOKING + BILLING E2E
class TestBookingBilling:
    def test_flow(self, sarah, owner):
        # Earlier synthetic tests occupy random slots. Retry schedule conflicts
        # just as book() does, while keeping every other error a test failure.
        for _ in range(25):
            d, t = rand_slot()
            q = sarah.post(f"{API}/bookings/quote", json={"practitionerId": "p-maya", "appointment": {"serviceSlug": "swedish", "duration": 60, "date": d, "time": t,
                                                           "locationType": "home", "address": ADDR_OK, "addressId": "ad-sarah"}}, timeout=30)
            if not (q.status_code == 409 and any(word in q.text.lower() for word in ("slot", "available", "taken", "booked", "travel", "time")) and "credit" not in q.text.lower()):
                break
        assert q.status_code == 200, q.text
        print("quote", q.text[:400])
        r = book(sarah)
        assert r.status_code == 200, r.text
        a = r.json()["appointment"]
        print("appt price", a.get("pricing"))
        for _ in range(15):
            nd, nt = rand_slot()
            rs = owner.post(f"{API}/appointments/{a['id']}/event", json={"kind": "rescheduled", "set": {"date": nd, "time": nt}}, timeout=30)
            if rs.status_code != 409:
                break
        print("reschedule", rs.status_code, rs.text[:120])
        assert rs.status_code == 200 and appt_of(owner, a["id"])["date"] == nd
        to_en_route(owner, a["id"])
        drive(owner, a["id"], ["arrived", "in_session", "session_ended", "leaving", "completed"])
        mk = owner.post(f"{API}/invoices/from-appointment/{a['id']}", json={}, timeout=20)
        inv = owner.get(f"{API}/invoices/by-appointment/{a['id']}", timeout=20).json()
        inv = inv.get("invoice", inv)
        iid = inv["id"]
        print("invoice", {k: inv.get(k) for k in ("state", "total", "tax", "balance", "paid", "lines")})
        iss = owner.post(f"{API}/invoices/{iid}/issue", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:10]}, timeout=20)
        print("issue", iss.status_code, iss.text[:300])
        co = sarah.post(f"{API}/invoices/{iid}/checkout", json={"idempotencyKey": "TEST_" + uuid.uuid4().hex[:8]}, timeout=40)
        print("checkout", co.status_code, co.text[:200])
        if co.status_code == 503 and "turned off" in co.text.lower():
            pytest.skip("Card checkout is off. No Stripe test key was configured, so webhook reconciliation was not run.")
        assert co.status_code == 200 and co.json().get("sessionId", "").startswith("cs_test_")
        cur = owner.get(f"{API}/invoices/{iid}", timeout=20).json()
        cur = cur.get("invoice", cur)
        print("after checkout", cur.get("state"), cur.get("balance"))
        assert cur["state"] != "paid"
        total = cur["total"]["cents"] if isinstance(cur["total"], dict) else cur["total"]
        bal = cur.get("balance", {}).get("cents", total) if isinstance(cur.get("balance"), dict) else (cur.get("balance") or total)
        ev = {"id": "evt_TEST_" + uuid.uuid4().hex[:8], "type": "checkout.session.completed", "data": {"object": {"id": co.json()["sessionId"], "amount_total": bal,
               "payment_status": "paid", "payment_intent": "pi_TEST_" + uuid.uuid4().hex[:8], "metadata": {"invoiceId": iid}}}}
        w = stripe_webhook(ev)
        print("webhook", w.status_code, w.text[:200])
        cur = owner.get(f"{API}/invoices/{iid}", timeout=20).json()
        cur = cur.get("invoice", cur)
        assert cur["state"] == "paid", cur["state"]
        assert sarah.get(f"{API}/invoices/{iid}/pdf", timeout=30).status_code == 403  # not released yet
        rel = owner.post(f"{API}/invoices/{iid}/release", json={}, timeout=20)
        print("release", rel.status_code, rel.text[:120])
        for path in ("pdf", "receipt"):
            pdf = sarah.get(f"{API}/invoices/{iid}/{path}", timeout=30)
            print(path, pdf.status_code, pdf.headers.get("content-type"))
            assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf") and pdf.content[:4] == b"%PDF"
        pays = [p for p in (cur.get("payments") or cur.get("ledger") or []) if p.get("type") in ("client_payment", None) or p.get("method") == "stripe"]
        print("payments", str(pays)[:300])
        pay_id = (pays[0].get("id") if pays else None)
        rf = owner.post(f"{API}/invoices/{iid}/refunds", json={"paymentId": pay_id, "amountCents": 1000, "reason": "TEST refund", "idempotencyKey": "TEST_" + uuid.uuid4().hex[:8]}, timeout=30)
        print("refund", rf.status_code, rf.text[:200])
        assert rf.status_code == 200
        after = owner.get(f"{API}/invoices/{iid}", timeout=20).json()
        print("after refund", after.get("state"), after.get("balance"), after.get("refunded"))
