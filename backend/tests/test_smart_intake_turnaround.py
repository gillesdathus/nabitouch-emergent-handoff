# Smart intake + session consent gating + smart session timer / turnaround (iteration 9)
import hashlib
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests
from pymongo import MongoClient

from booking_fixtures import EDMONTON_HOME, book_appointment
from t1_common import API, BENV, MAYA, OWNER, SAMPLE_PW, SARAH, login

pytestmark = pytest.mark.real_consent
DB = MongoClient(BENV["MONGO_URL"])[BENV["DB_NAME"]]
TZ = ZoneInfo("America/Edmonton")
SIG = "data:image/png;base64," + "iVBORw0KGgo" * 60
ADDR = dict(EDMONTON_HOME)
S = {}


@pytest.fixture(scope="module")
def owner():
    return login(OWNER)


@pytest.fixture(scope="module")
def sarah():
    return login(SARAH)


@pytest.fixture(scope="module")
def maya():
    return login(MAYA)


def book(owner, slug="swedish", day_offset=(20, 200), times=("09:00", "12:00", "16:00"), practitioner=None):
    """Reception booking helper. Prefers demo seed ids when present; otherwise uses bookable staff."""
    return book_appointment(
        owner, API, slug=slug, day_offset=day_offset, times=times, practitioner=practitioner, address=ADDR,
    )


def to_arrived(owner, aid):
    a = DB.nt_appointments.find_one({"id": aid})
    path = (["assigned"] if a["status"] == "requested" else []) + ["en_route", "arrived"]
    for to in path:
        r = owner.post(f"{API}/appointments/{aid}/transition", json={"to": to}, timeout=30)
        assert r.status_code == 200, f"{to} {r.text[:200]}"


def start(sess, aid):
    return sess.post(f"{API}/appointments/{aid}/transition", json={"to": "in_session", "_noAutoConsent": True}, timeout=30)


def baseline_body(**kw):
    body = {"conditions": ["None of these"], "pregnancy": "Not applicable", "emergencyName": "TEST Contact", "emergencyPhone": "780-555-0100",
            "allergies": "none", "medications": "none"}
    body.update(kw)
    return body


def make_ready(sarah, aid, restrictions=None):
    r = sarah.post(f"{API}/sessions/{aid}/intake-confirm", json={"changed": False, "answers": {"unwell": "no"}}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    text = r.json()["consentText"]
    r = sarah.post(f"{API}/sessions/{aid}/consent", json={
        "acknowledgements": {k: True for k in ("explained", "withdraw", "draping", "accurate")}, "typedName": "Sarah Demo", "signature": SIG,
        "textHash": hashlib.sha256(text.encode()).hexdigest(),
        "restrictions": restrictions or {"avoidAreas": ["neck"], "pressureMax": "medium", "draping": "extra", "sensitiveAreas": False, "notes": "TEST"}}, timeout=20)
    assert r.status_code == 200, r.text[:200]
    return r.json()


def clear_test_next():
    # earlier runs leave TEST bookings on today's p-maya schedule; retire them so 'next' is deterministic (test data only)
    DB.nt_appointments.update_many({"practitionerId": "p-maya", "idempotencyKey": {"$regex": "^c-sarah:TEST_"}, "status": {"$in": ["confirmed", "assigned", "preparing"]},
                                    "date": datetime.now(TZ).date().isoformat()}, {"$set": {"status": "cancelled"}})


def end_if_active():
    # make sure p-maya has no in_session left over from earlier runs
    for a in DB.nt_appointments.find({"practitionerId": "p-maya", "status": "in_session"}):
        DB.nt_appointments.update_one({"id": a["id"]}, {"$set": {"status": "soap_pending"}})


# ---- Intake & readiness
class TestIntakeConsent:
    def test_setup(self, owner):
        end_if_active()
        S["a1"] = book(owner)["id"]
        to_arrived(owner, S["a1"])

    def test_baseline_validation(self, sarah, maya):
        assert maya.post(f"{API}/intake/baseline", json=baseline_body(), timeout=20).status_code == 403
        assert sarah.post(f"{API}/intake/baseline", json=baseline_body(conditions=[]), timeout=20).status_code == 400
        assert sarah.post(f"{API}/intake/baseline", json=baseline_body(pregnancy=""), timeout=20).status_code == 400
        assert sarah.post(f"{API}/intake/baseline", json=baseline_body(emergencyPhone="78055"), timeout=20).status_code == 400
        assert sarah.post(f"{API}/intake/baseline", json=baseline_body(emergencyName=""), timeout=20).status_code == 400

    def test_baseline_appends_version(self, sarah):
        before = DB.nt_intake.count_documents({"clientId": "c-sarah"})
        r = sarah.post(f"{API}/intake/baseline", json=baseline_body(), timeout=20)
        assert r.status_code == 200, r.text
        assert DB.nt_intake.count_documents({"clientId": "c-sarah"}) == before + 1
        S["v"] = r.json()["version"]

    def test_baseline_with_appt_requires_answers(self, sarah):
        r = sarah.post(f"{API}/intake/baseline", json=baseline_body(appointmentId=S["a1"]), timeout=20)
        assert r.status_code == 400  # unwell yes/no missing

    def test_readiness_states(self, sarah, maya, owner):
        r = sarah.get(f"{API}/sessions/{S['a1']}/readiness", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["intake"]["state"] == "confirm_needed" and d["consent"]["state"] == "missing" and d["ready"] is False
        assert any(q["id"] == "unwell" for q in d["questions"]) and d.get("consentText")
        for s in (maya, owner):
            x = s.get(f"{API}/sessions/{S['a1']}/readiness", timeout=20)
            assert x.status_code == 200 and x.json()["intake"]["state"] == "confirm_needed" and "consentText" not in x.json()

    def test_other_client_403(self):
        email = f"test_intake_{uuid.uuid4().hex[:6]}@example.com"
        pw = SAMPLE_PW
        requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "firstName": "TEST", "lastName": "Other", "phone": "780-555-0143",
                                                    "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True}, timeout=20)
        c = login((email, pw))
        assert c.get(f"{API}/sessions/{S['a1']}/readiness", timeout=20).status_code == 403

    def test_start_blocked_before_ready(self, maya):
        r = start(maya, S["a1"])
        assert r.status_code == 409 and "intake" in r.text.lower()

    def test_consent_requires_confirmed_intake(self, sarah):
        r = sarah.post(f"{API}/sessions/{S['a1']}/consent", json={"typedName": "Sarah"}, timeout=20)
        assert r.status_code == 409

    def test_confirm_changed_no_change_400(self, sarah):
        latest = DB.nt_intake.find_one({"clientId": "c-sarah"}, sort=[("version", -1)])
        r = sarah.post(f"{API}/sessions/{S['a1']}/intake-confirm", json={"changed": True, "updates": {}, "answers": {"unwell": "no"}}, timeout=20)
        assert r.status_code == 400
        assert DB.nt_intake.find_one({"clientId": "c-sarah"}, sort=[("version", -1)])["version"] == latest["version"]

    def test_confirm_changed_creates_version(self, sarah):
        latest = DB.nt_intake.find_one({"clientId": "c-sarah"}, sort=[("version", -1)])["version"]
        r = sarah.post(f"{API}/sessions/{S['a1']}/intake-confirm", json={"changed": True, "updates": {"allergies": "TEST nuts " + uuid.uuid4().hex[:4]},
                                                                           "answers": {"unwell": "no"}}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["intake"]["state"] == "confirmed" and d["intake"]["version"] == latest + 1 and d["intake"]["changedFields"] == ["allergies"]

    def test_confirm_unchanged_no_new_version(self, sarah):
        latest = DB.nt_intake.find_one({"clientId": "c-sarah"}, sort=[("version", -1)])["version"]
        r = sarah.post(f"{API}/sessions/{S['a1']}/intake-confirm", json={"changed": False, "answers": {"unwell": "no"}}, timeout=20)
        assert r.status_code == 200 and r.json()["intake"]["version"] == latest

    def test_consent_validation(self, sarah):
        text = sarah.get(f"{API}/sessions/{S['a1']}/readiness", timeout=20).json()["consentText"]
        h = hashlib.sha256(text.encode()).hexdigest()
        acks = {k: True for k in ("explained", "withdraw", "draping", "accurate")}
        good = {"acknowledgements": acks, "typedName": "Sarah Demo", "signature": SIG, "textHash": h, "restrictions": {"pressureMax": "light", "draping": "clothed"}}
        url = f"{API}/sessions/{S['a1']}/consent"
        assert sarah.post(url, json={**good, "acknowledgements": {**acks, "accurate": False}}, timeout=20).status_code == 400
        assert sarah.post(url, json={**good, "typedName": "Sa"}, timeout=20).status_code == 400
        assert sarah.post(url, json={**good, "signature": "data:image/png;base64,AAA"}, timeout=20).status_code == 400
        assert sarah.post(url, json={**good, "textHash": "deadbeef"}, timeout=20).status_code == 409
        assert sarah.post(url, json={**good, "restrictions": {"pressureMax": "extreme"}}, timeout=20).status_code == 400

    def test_consent_sign_and_start(self, sarah, maya):
        d = make_ready(sarah, S["a1"])
        assert d["consent"]["state"] == "signed" and d["ready"] is True
        assert d["restrictions"]["pressureMax"] == "medium" and d["restrictions"]["avoidAreas"] == ["neck"]
        assert "signature" not in (d["consent"]["record"] or {})
        r = start(maya, S["a1"])
        assert r.status_code == 200, r.text[:200]
        s = r.json()["session"]
        assert s["startedAt"] and s["bookedMin"] == 60 and s["scheduledEndAt"]

    def test_overlap_blocked(self, owner, sarah, maya):
        S["a2"] = book(owner)["id"]
        to_arrived(owner, S["a2"])
        make_ready(sarah, S["a2"])
        r = start(maya, S["a2"])
        assert r.status_code == 409 and "in progress" in r.text

    def test_timer_snapshot_and_pause(self, maya):
        t = maya.get(f"{API}/appointments/{S['a1']}/turnaround", timeout=20)
        assert t.status_code == 200
        tr = t.json()["treatment"]
        assert t.json()["serverNow"] and tr["remainingSec"] <= 3600 and tr["overtime"] is False and tr["paused"] is False
        assert maya.post(f"{API}/appointments/{S['a1']}/session/pause", json={"reason": "x"}, timeout=20).status_code == 400
        p = maya.post(f"{API}/appointments/{S['a1']}/session/pause", json={"reason": "TEST water break"}, timeout=20)
        assert p.status_code == 200 and p.json()["treatment"]["paused"] is True
        import time
        time.sleep(2)
        r = maya.post(f"{API}/appointments/{S['a1']}/session/resume", json={}, timeout=20)
        assert r.status_code == 200 and r.json()["treatment"]["paused"] is False and r.json()["treatment"]["pausedMs"] >= 1500

    def test_withdraw_interrupts_and_requires_new_consent(self, sarah, maya):
        assert maya.post(f"{API}/sessions/{S['a1']}/consent/withdraw", json={"reason": "x"}, timeout=20).status_code == 400
        r = maya.post(f"{API}/sessions/{S['a1']}/consent/withdraw", json={"reason": "TEST client asked to stop"}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert r.json()["consent"]["state"] == "withdrawn" and r.json()["withdrawals"][-1]["duringSession"] is True
        a = DB.nt_appointments.find_one({"id": S["a1"]})
        assert a["status"] == "interrupted" and a["timer"].get("pausedAt")
        r = start(maya, S["a1"])
        assert r.status_code == 409 and "consent" in r.text.lower()
        # new signature only (intake still confirmed)
        text = sarah.get(f"{API}/sessions/{S['a1']}/readiness", timeout=20).json()["consentText"]
        c = sarah.post(f"{API}/sessions/{S['a1']}/consent", json={"acknowledgements": {k: True for k in ("explained", "withdraw", "draping", "accurate")},
                       "typedName": "Sarah Demo", "signature": SIG, "textHash": hashlib.sha256(text.encode()).hexdigest()}, timeout=20)
        assert c.status_code == 200, c.text[:200]
        r = start(maya, S["a1"])
        assert r.status_code == 200, r.text[:200]
        assert r.json()["session"]["startedAt"] == a["session"]["startedAt"]  # timer not reset

    def test_soap_consent_ref(self, maya):
        r = maya.put(f"{API}/soap/{S['a1']}", json={"s": "TEST", "o": "", "a": "", "p": ""}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        ref = r.json().get("consentRef")
        assert ref and ref["restrictions"]["pressureMax"] == "firm"  # latest consent had default restrictions

    def test_idempotent_transition(self, maya):
        op = "TEST-op-" + uuid.uuid4().hex[:8]
        r1 = maya.post(f"{API}/appointments/{S['a1']}/transition", json={"to": "session_ended", "opId": op}, timeout=30)
        assert r1.status_code == 200, r1.text[:200]
        assert r1.json()["status"] == "soap_pending"
        n = len(DB.nt_appointments.find_one({"id": S["a1"]})["events"])
        r2 = maya.post(f"{API}/appointments/{S['a1']}/transition", json={"to": "session_ended", "opId": op}, timeout=30)
        assert r2.status_code == 200, r2.text[:200]
        assert len(DB.nt_appointments.find_one({"id": S["a1"]})["events"]) == n

    def test_session_end_fields(self, maya):
        a = DB.nt_appointments.find_one({"id": S["a1"]})
        s, c = a["session"], a["cleanup"]
        assert s["actualMin"] is not None and s["earlyMin"] > 0 and "overtimeMin" in s
        assert c["bufferMin"] == 15 and c["source"] == "mobile" and c["completedAt"] is None and a["opsStatus"] == "cleanup_in_progress"

    def test_ready_idempotent(self, maya):
        r1 = maya.post(f"{API}/appointments/{S['a1']}/turnaround/ready", json={"checklist": ["linens", "sanitize"], "opId": "TEST-r-" + uuid.uuid4().hex[:6]}, timeout=20)
        assert r1.status_code == 200
        c1 = r1.json()["cleanup"]
        r2 = maya.post(f"{API}/appointments/{S['a1']}/turnaround/ready", json={}, timeout=20)
        assert c1["completedAt"] and r2.json()["cleanup"]["completedAt"] == c1["completedAt"]
        assert r1.json()["opsStatus"] == "ready_next" and c1["actualMin"] is not None and "overrunMin" in c1

    def test_export_has_history(self, owner):
        r = owner.get(f"{API}/clinical/export/c-sarah", timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["intakeConfirmations"] and d["sessionConsents"] and d["consentWithdrawals"]
        assert all("signature" not in row for row in d["sessionConsents"])


    # ---- Config, overrides, next booking, ops board, report (same class: shares p-maya state, loadscope pins it to one worker)
    def test_config_permissions_and_validation(self, owner, maya):
        S["cfg"] = DB.nt_settings.find_one({"id": "app"}, {"_id": 0, "turnaround": 1}).get("turnaround")
        assert maya.get(f"{API}/turnaround/config", timeout=20).status_code == 200
        assert maya.put(f"{API}/turnaround/config", json={"clinicCleanupMin": 12}, timeout=20).status_code == 403
        assert owner.put(f"{API}/turnaround/config", json={"clinicCleanupMin": 121}, timeout=20).status_code == 400
        assert owner.put(f"{API}/turnaround/config", json={"byService": {"swedish": -1}}, timeout=20).status_code == 400
        r = owner.put(f"{API}/turnaround/config", json={"byPractitioner": {"p-maya": 25}}, timeout=20)
        assert r.status_code == 200 and r.json()["byPractitioner"]["p-maya"] == 25

    def test_practitioner_override_and_appointment_override(self, owner, sarah, maya):
        aid = S["a2"]
        assert start(maya, aid).status_code == 200
        e = maya.post(f"{API}/appointments/{aid}/transition", json={"to": "session_ended"}, timeout=30)
        assert e.status_code == 200
        c = DB.nt_appointments.find_one({"id": aid})["cleanup"]
        assert c["bufferMin"] == 25 and c["source"] == "practitioner"
        assert maya.put(f"{API}/appointments/{aid}/turnaround/cleanup", json={"minutes": 30}, timeout=20).status_code == 403
        assert owner.put(f"{API}/appointments/{aid}/turnaround/cleanup", json={"minutes": 500}, timeout=20).status_code == 400
        r = owner.put(f"{API}/appointments/{aid}/turnaround/cleanup", json={"minutes": 30}, timeout=20)
        assert r.status_code == 200 and r.json()["cleanup"]["bufferMin"] == 30 and r.json()["cleanup"]["source"] == "appointment"
        maya.post(f"{API}/appointments/{aid}/turnaround/ready", json={}, timeout=20)

    def test_restore_config(self, owner):
        DB.nt_settings.update_one({"id": "app"}, {"$set": {"turnaround": S.get("cfg") or {}}} if S.get("cfg") else {"$unset": {"turnaround": ""}})
        assert owner.get(f"{API}/turnaround/config", timeout=20).json()["byPractitioner"].get("p-maya") is None

    def test_next_booking_at_risk_alert(self, owner, sarah, maya):
        end_if_active()
        clear_test_next()
        first = book(owner, times=("09:00",))
        now = datetime.now(TZ)
        today = now.date().isoformat()
        # second booking: another free slot, then both moved to today (test setup only)
        second = book(owner, times=("13:00", "14:00", "15:00"))
        # Keep both synthetic visits on today's schedule, including around midnight.
        # A +40 minute clock wrapped into tomorrow while retaining today's date.
        minute = now.hour * 60 + now.minute
        first_minute, next_minute = max(0, minute - 1), max(1, minute)
        t1 = f"{first_minute // 60:02d}:{first_minute % 60:02d}"
        t2 = f"{next_minute // 60:02d}:{next_minute % 60:02d}"
        DB.nt_appointments.update_one({"id": first["id"]}, {"$set": {"date": today, "time": t1}})
        DB.nt_appointments.update_one({"id": second["id"]}, {"$set": {"date": today, "time": t2, "status": "confirmed"}})
        S["n1"], S["n2"] = first["id"], second["id"]
        to_arrived(owner, first["id"])
        make_ready(sarah, first["id"])
        assert start(maya, first["id"]).status_code == 200
        t = maya.get(f"{API}/appointments/{first['id']}/turnaround", timeout=30)
        assert t.status_code == 200
        nxt = t.json()["next"]
        print("NEXT", nxt)
        assert nxt and nxt["id"] == second["id"]
        assert nxt["state"] in ("at_risk", "running_late")
        assert (nxt["travelKnown"] and nxt["travelProvider"] in ("mapbox", "mapbox-traffic", "same-stop") and isinstance(nxt["travelMin"], (int, float))) or \
               (nxt["travelKnown"] is False and nxt["travelMin"] is None and nxt["travelProvider"] == "unavailable")
        assert nxt["departBy"] and isinstance(nxt["bufferMin"], (int, float))
        maya.get(f"{API}/appointments/{first['id']}/turnaround", timeout=30)
        assert DB.nt_ops_alerts.count_documents({"appointmentId": first["id"], "kind": nxt["state"]}) == 1  # deduped

    def test_ops_board_permissions_and_ack(self, owner, sarah, maya):
        assert maya.get(f"{API}/ops/turnaround", timeout=20).status_code == 403
        assert sarah.get(f"{API}/ops/turnaround", timeout=20).status_code == 403
        b = owner.get(f"{API}/ops/turnaround", timeout=30)
        assert b.status_code == 200
        d = b.json()
        entry = next(p for p in d["practitioners"] if p["practitionerId"] == "p-maya")
        assert entry["appointmentId"] == S["n1"] and entry["state"] in ("in_session", "treatment_overtime")
        assert "intake" not in str(entry).lower() and "allerg" not in str(d).lower()
        alert = next(a for a in d["alerts"] if a["appointmentId"] == S["n1"])
        r = owner.post(f"{API}/ops/turnaround/alerts/{alert['id']}/ack", json={}, timeout=20)
        assert r.status_code == 200 and r.json()["acknowledged"] is True
        assert owner.post(f"{API}/ops/turnaround/alerts/{alert['id']}/ack", json={}, timeout=20).status_code == 404

    def test_escalate(self, maya):
        assert maya.post(f"{API}/appointments/{S['n1']}/turnaround/escalate", json={"kind": "bogus"}, timeout=20).status_code == 400
        for kind in ("adjustment", "reception"):
            r = maya.post(f"{API}/appointments/{S['n1']}/turnaround/escalate", json={"kind": kind, "note": "TEST"}, timeout=20)
            assert r.status_code == 200 and r.json()["kind"] == kind and r.json()["nextAppointmentId"] == S["n2"]
        # never auto-reschedules
        n2 = DB.nt_appointments.find_one({"id": S["n2"]})
        assert n2["status"] == "confirmed"

    def test_finish_and_report(self, owner, maya):
        maya.post(f"{API}/appointments/{S['n1']}/transition", json={"to": "session_ended"}, timeout=30)
        maya.post(f"{API}/appointments/{S['n1']}/turnaround/ready", json={}, timeout=20)
        assert maya.get(f"{API}/reports/turnaround", timeout=20).status_code == 403
        today = datetime.now(TZ).date().isoformat()
        r = owner.get(f"{API}/reports/turnaround", params={"start": today, "end": today, "practitionerId": "p-maya"}, timeout=30)
        assert r.status_code == 200
        s = r.json()["summary"]
        for k in ("sessions", "avgBookedMin", "avgActualMin", "overtimeCount", "avgCleanupMin", "cleanupOverruns", "onTimeStarts", "lateStarts", "travelDelays", "conflicts"):
            assert k in s, k
        assert s["sessions"] >= 1 and s["conflicts"] >= 1
        assert any(v["id"] == S["n1"] for v in r.json()["visits"])
        clear_test_next()

    def test_booking_engine_respects_cleanup_buffer(self, owner):
        # booking an adjacent slot fails once p-maya's cleanup buffer is 120 and succeeds again after restore
        first = book(owner, day_offset=(150, 300), times=("09:00",))
        day = first["date"]
        body = lambda: {"source": "reception", "practitionerId": "p-maya", "client": {"id": "c-sarah"}, "idempotencyKey": "TEST_" + uuid.uuid4().hex[:10],
                        "appointment": {"serviceSlug": "swedish", "duration": 60, "date": day, "time": "11:00", "locationType": "home", "paymentMethod": "self",
                                        "addressId": "ad-sarah", "address": ADDR}}
        cfg = DB.nt_settings.find_one({"id": "app"}, {"_id": 0, "turnaround": 1}).get("turnaround")
        try:
            assert owner.put(f"{API}/turnaround/config", json={"byPractitioner": {"p-maya": 120}}, timeout=20).status_code == 200
            blocked = owner.post(f"{API}/bookings", json=body(), timeout=40)
            print("blocked", blocked.status_code, blocked.text[:150])
            assert blocked.status_code in (400, 409)
        finally:
            DB.nt_settings.update_one({"id": "app"}, {"$set": {"turnaround": cfg}} if cfg else {"$unset": {"turnaround": ""}})
        ok = owner.post(f"{API}/bookings", json=body(), timeout=40)
        print("ok", ok.status_code, ok.text[:150])
        assert ok.status_code == 200
        for a in (first["id"], ok.json()["appointment"]["id"]):
            DB.nt_appointments.update_one({"id": a}, {"$set": {"status": "cancelled"}})
            DB.nt_slot_locks.delete_many({"appointmentId": a})
