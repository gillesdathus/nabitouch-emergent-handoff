# Iteration 5 retests: statement lock (FIX 2), plans money format, plan nudge, today's visit for maya (readiness) - run with -n 0
import re
import threading
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests

from t1_common import API, MAYA, OWNER, SARAH, login

PW = "T1-Iter5-Qa-2026!"
MONEY = re.compile(r"^-?\$\d{1,3}(,\d{3})*\.\d{2}$")
STATE = {}


@pytest.fixture(scope="module")
def owner():
    return login(OWNER)


@pytest.fixture(scope="module")
def sarah():
    return login(SARAH)


@pytest.fixture(scope="module")
def maya():
    return login(MAYA)


# ---- FIX 2: per-practitioner statement lock
class TestStatementLock:
    def test_concurrent_create_one_statement(self, owner):
        body = {"start": "2027-01-01", "end": "2027-06-30", "practitionerId": "p-maya"}
        out = []

        def go():
            out.append(owner.post(f"{API}/finance/statements", json=body, timeout=40))
        ts = [threading.Thread(target=go) for _ in range(3)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        codes = sorted(r.status_code for r in out)
        print("codes", codes, [r.text[:120] for r in out])
        if codes == [404, 404, 404]:
            pytest.skip("no invoiced visits for maya in 2027 H1")
        assert codes.count(200) == 1 and codes.count(409) == 2, codes
        created = next(r for r in out if r.status_code == 200).json()
        assert len(created) == 1 and created[0]["practitionerId"] == "p-maya" and created[0]["status"] == "draft"
        rows = [s for s in owner.get(f"{API}/finance/statements", timeout=30).json() if s.get("practitionerId") == "p-maya" and s.get("start") == "2027-01-01"]
        assert len(rows) == 1, rows
        # sequential retry is 409 (overlap)
        assert owner.post(f"{API}/finance/statements", json=body, timeout=40).status_code == 409
        d = owner.delete(f"{API}/finance/statements/{created[0]['id']}", timeout=30)
        assert d.status_code in (200, 204), d.text


# ---- MINOR: plans money display
class TestPlansMoney:
    def test_plans_report_kpis_formatted(self, owner):
        r = owner.get(f"{API}/finance/reports/plans", params={"start": "2025-01-01", "end": "2027-12-31"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        kpis = r.json().get("kpis") or []
        print(kpis)
        vals = [k[1] if isinstance(k, (list, tuple)) else k.get("value") for k in kpis]
        money_vals = [v for v in vals if isinstance(v, str) and "$" in v]
        assert money_vals and all(MONEY.match(v) for v in money_vals), money_vals


# ---- PLAN NUDGE: fresh client with a completed swedish 60 visit and no credits
class TestNudge:
    def test_nudge_after_completed_visit(self, owner):
        email = f"test_nudge_{uuid.uuid4().hex[:6]}@example.com"
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={"email": email, "password": PW, "firstName": "TEST", "lastName": "Nudge", "phone": "780-555-0142",
                                                 "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True}, timeout=20)
        assert r.status_code in (200, 201), r.text[:200]
        c = login((email, PW))
        assert c.get(f"{API}/plans/nudge", timeout=20).json()["nudge"] is None
        cid = c.get(f"{API}/auth/me", timeout=20).json().get("subject") or c.get(f"{API}/auth/me", timeout=20).json().get("user", {}).get("subject")
        addr = {"label": "Home", "line": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.499, "clientConfirmed": True}
        aid = None
        for i in range(30):
            d = (datetime.now(ZoneInfo("America/Edmonton")).date() + timedelta(days=5 + i)).isoformat()
            body = {"source": "online", "practitionerId": "p-maya", "idempotencyKey": "TEST_" + uuid.uuid4().hex[:10], "appointment": {
                "serviceSlug": "swedish", "duration": 60, "date": d, "time": "11:00", "locationType": "home", "paymentMethod": "self", "address": addr}}
            b = c.post(f"{API}/bookings", json=body, timeout=40)
            if b.status_code == 200:
                aid = b.json()["appointment"]["id"]
                break
            print(b.status_code, b.text[:120])
        assert aid, "could not book"
        st = owner.get(f"{API}/state", timeout=40).json()
        a = next(x for x in st["appointments"] if x["id"] == aid)
        path = (["assigned"] if a["status"] == "requested" else []) + ["en_route", "arrived", "in_session", "session_ended", "leaving", "completed"]
        for to in path:
            t = owner.post(f"{API}/appointments/{aid}/transition", json={"to": to}, timeout=30)
            assert t.status_code == 200, f"{to} {t.text[:200]}"
        n = c.get(f"{API}/plans/nudge", timeout=20).json()["nudge"]
        print(n, cid)
        assert n and n["saving"]["cents"] > 0 and n["visitId"] == aid and MONEY.match(n["saving"]["display"])
        STATE["nudge_client"] = (email, PW)


# ---- TODAY visit for maya / sarah readiness
class TestTodayVisit:
    def test_create_today_and_ready(self, owner, sarah, maya):
        now = datetime.now(ZoneInfo("America/Edmonton"))
        today = now.date().isoformat()
        aid = None
        # Evening in Edmonton: today's slots are closed, so book a free future slot and move it to today in Mongo (test setup only).
        slots = [((now.date() + timedelta(days=d)).isoformat(), t) for d in range(1, 40) for t in ("09:00", "12:00", "16:00")]
        for day, t in slots:
            body = {"source": "reception", "practitionerId": "p-maya", "client": {"id": "c-sarah"}, "idempotencyKey": "TEST_" + uuid.uuid4().hex[:10],
                    "appointment": {"serviceSlug": "swedish", "duration": 60, "date": day, "time": t, "locationType": "home", "paymentMethod": "self",
                                    "addressId": "ad-sarah", "address": {"label": "Home", "line": "10150 104 St NW, Edmonton, AB", "lat": 53.5435, "lng": -113.499, "id": "ad-sarah", "clientConfirmed": True}}}
            b = owner.post(f"{API}/bookings", json=body, timeout=40)
            if b.status_code == 200:
                aid = b.json()["appointment"]["id"]
                break
            print(t, b.status_code, b.text[:150])
        assert aid, "could not book a visit for today"
        from t1_common import BENV
        from pymongo import MongoClient
        MongoClient(BENV["MONGO_URL"])[BENV["DB_NAME"]].nt_appointments.update_one({"id": aid}, {"$set": {"date": today, "time": "21:30"}})
        a = next(x for x in owner.get(f"{API}/state", timeout=40).json()["appointments"] if x["id"] == aid)
        path = {"requested": ["confirmed", "assigned", "preparing"], "confirmed": ["assigned", "preparing"], "assigned": ["preparing"]}.get(a["status"], [])
        for to in path:
            t = owner.post(f"{API}/appointments/{aid}/transition", json={"to": to}, timeout=30)
            assert t.status_code == 200, f"{to} {t.text[:200]}"
        r = sarah.put(f"{API}/appointments/{aid}/readiness", json={"items": {k: True for k in ("space", "paths", "pets", "entry", "safe", "service")}}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        t = owner.post(f"{API}/appointments/{aid}/transition", json={"to": "en_route"}, timeout=30)
        assert t.status_code == 200, t.text[:200]
        ma = next(x for x in maya.get(f"{API}/state", timeout=40).json()["appointments"] if x["id"] == aid)
        print("TODAY_AID", aid, ma.get("status"), ma.get("readiness"))
        assert ma["status"] == "en_route" and ma["date"] == today
        with open("/tmp/today_aid.txt", "w") as f:
            f.write(aid)
