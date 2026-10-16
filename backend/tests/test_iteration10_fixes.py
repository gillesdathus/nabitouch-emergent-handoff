# Iteration 10 retest: interrupted->leaving, atomic opId/overlap, intake versioning, ops alert expiry, report start buckets
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from t1_common import API, SAMPLE_PW
from test_smart_intake_turnaround import DB, TZ, baseline_body, book, end_if_active, make_ready, owner, sarah, maya, start, to_arrived  # noqa: F401, F811

pytestmark = pytest.mark.real_consent
S = {}


class TestIteration10:
    # Fix 2: End Visit & Leave after a consent withdrawal records the session end and starts cleanup
    def test_interrupted_to_leaving(self, owner, sarah, maya):  # noqa: F811
        end_if_active()
        aid = book(owner)["id"]
        S["leave"] = aid
        to_arrived(owner, aid)
        make_ready(sarah, aid)
        r = start(maya, aid)
        assert r.status_code == 200, r.text[:200]
        r = maya.post(f"{API}/sessions/{aid}/consent/withdraw", json={"reason": "TEST client asked to stop"}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert DB.nt_appointments.find_one({"id": aid})["status"] == "interrupted"
        assert start(maya, aid).status_code == 409  # resume stays gated
        r = maya.post(f"{API}/appointments/{aid}/transition", json={"to": "leaving"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        a = r.json()
        assert a["status"] == "leaving"
        assert a["session"].get("endedAt") and a["session"].get("actualMin") is not None
        assert a.get("cleanup") and a["cleanup"].get("startedAt")
        snap = maya.get(f"{API}/appointments/{aid}/turnaround", timeout=20).json()
        assert snap.get("cleanup"), snap

    # LOW: opId replay returns current appointment, only one in_session event
    def test_opid_replay(self, owner, sarah, maya):  # noqa: F811
        end_if_active()
        aid = book(owner)["id"]
        to_arrived(owner, aid)
        make_ready(sarah, aid)
        op = "TEST-op-" + uuid.uuid4().hex[:8]
        body = {"to": "in_session", "opId": op}
        r1 = maya.post(f"{API}/appointments/{aid}/transition", json=body, timeout=30)
        r2 = maya.post(f"{API}/appointments/{aid}/transition", json=body, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200, (r1.text[:200], r2.text[:200])
        a = DB.nt_appointments.find_one({"id": aid})
        assert a["status"] == "in_session"
        assert sum(1 for e in a["events"] if e["status"] == "in_session") == 1
        assert a["opIds"].count(op) == 1
        S["active"] = aid

    # LOW: concurrent starts by the same practitioner -> exactly one wins (unique partial index)
    def test_parallel_starts_one_wins(self, owner, sarah, maya):  # noqa: F811
        DB.nt_appointments.update_one({"id": S["active"]}, {"$set": {"status": "soap_pending"}})
        end_if_active()
        ids = []
        for _ in range(2):
            aid = book(owner)["id"]
            to_arrived(owner, aid)
            make_ready(sarah, aid)
            ids.append(aid)
        out = {}
        barrier = threading.Barrier(2)

        def go(aid):
            barrier.wait()
            out[aid] = start(maya, aid).status_code
        th = [threading.Thread(target=go, args=(a,)) for a in ids]
        [t.start() for t in th]
        [t.join() for t in th]
        assert sorted(out.values()) == [200, 409], out
        assert DB.nt_appointments.count_documents({"practitionerId": "p-maya", "status": "in_session"}) == 1
        end_if_active()

    # LOW: concurrent baselines get unique, contiguous versions
    def test_intake_versions_unique(self, sarah):  # noqa: F811
        before = (DB.nt_intake.find_one({"clientId": "c-sarah"}, sort=[("version", -1)]) or {}).get("version", 0)
        codes = []

        def go():
            codes.append(sarah.post(f"{API}/intake/baseline", json=baseline_body(), timeout=30).status_code)
        th = [threading.Thread(target=go) for _ in range(4)]
        [t.start() for t in th]
        [t.join() for t in th]
        assert all(c in (200, 409) for c in codes), codes
        vs = [r["version"] for r in DB.nt_intake.find({"clientId": "c-sarah", "version": {"$gt": before}})]
        assert len(vs) == len(set(vs)) == codes.count(200)

    # Other intake writer (POST /api/intake) must not 500 when versions are not contiguous
    def test_legacy_intake_endpoint_with_gap(self, sarah):  # noqa: F811
        top = DB.nt_intake.find_one({"clientId": "c-sarah"}, sort=[("version", -1)])["version"]
        count = DB.nt_intake.count_documents({"clientId": "c-sarah"})
        r = sarah.post(f"{API}/intake", json={"allergies": "TEST none"}, timeout=20)
        print("POST /api/intake", r.status_code, r.text[:200], "max", top, "count", count)
        assert r.status_code != 500

    # MEDIUM: board resolves stale alerts and lists only today's
    def test_ops_alerts_expire(self, owner):  # noqa: F811
        old = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        now = datetime.now(timezone.utc).isoformat()
        cancelled_row = DB.nt_appointments.find_one({"status": "cancelled"}, {"id": 1})
        if not cancelled_row:
            cancelled = "a-TEST-can-" + uuid.uuid4().hex[:8]
            DB.nt_appointments.insert_one({"id": cancelled, "status": "cancelled", "ref": "TEST-CAN", "practitionerId": "p-maya", "date": "2000-01-01", "time": "09:00", "duration": 60, "locationType": "home"})
        else:
            cancelled = cancelled_row["id"]
        rows = {
            "old": {"at": old, "kind": "reception", "nextAppointmentId": None},
            "dead_next": {"at": now, "kind": "at_risk", "nextAppointmentId": cancelled},
            "fresh": {"at": now, "kind": "reception", "nextAppointmentId": None},
        }
        for k, v in rows.items():
            DB.nt_ops_alerts.insert_one({"id": f"opa-TEST-{k}-{uuid.uuid4().hex[:6]}", "dedupeKey": "TEST:" + uuid.uuid4().hex, "status": "open",
                                         "practitionerId": "p-maya", "ref": "TEST", **v})
            S[k] = DB.nt_ops_alerts.find_one({"dedupeKey": {"$regex": "^TEST:"}, "kind": v["kind"], "at": v["at"]}, sort=[("_id", -1)])["id"]
        r = owner.get(f"{API}/ops/turnaround", timeout=30)
        assert r.status_code == 200
        listed = {a["id"] for a in r.json()["alerts"]}
        assert S["old"] not in listed and S["dead_next"] not in listed and S["fresh"] in listed
        assert DB.nt_ops_alerts.find_one({"id": S["old"]})["status"] == "resolved"
        assert DB.nt_ops_alerts.find_one({"id": S["dead_next"]})["status"] == "resolved"
        assert DB.nt_ops_alerts.find_one({"id": S["fresh"]})["status"] == "open"
        DB.nt_ops_alerts.delete_many({"dedupeKey": {"$regex": "^TEST:"}})

    # LOW: report buckets -15..+5 on time, < -15 early, > 5 late
    def test_report_start_buckets(self, owner):  # noqa: F811
        day = "2099-01-0" + str(1 + uuid.uuid4().int % 8)
        DB.nt_appointments.delete_many({"ref": "TEST-RPT"})
        for i, d in enumerate([-30, -10, 0, 5, 12]):
            DB.nt_appointments.insert_one({"id": f"a-TEST-rpt-{i}", "ref": "TEST-RPT", "practitionerId": "p-test-rpt", "date": day, "status": "completed",
                                           "session": {"startedAt": "2099-01-01T10:00:00+00:00", "startDelayMin": d}})
        r = owner.get(f"{API}/reports/turnaround", params={"start": day, "end": day, "practitionerId": "p-test-rpt"}, timeout=30)
        DB.nt_appointments.delete_many({"ref": "TEST-RPT"})
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        tot = body.get("totals") or body.get("summary") or body
        print(tot)
        assert tot["onTimeStarts"] == 3 and tot["earlyStarts"] == 1 and tot["lateStarts"] == 1


# Code review probe: POST /api/intake (clinical.py) still uses count_documents+1 and collides with the unique index if versions have a gap
def test_clinical_intake_version_gap_probe():
    import requests
    from t1_common import login
    email = f"test_gap_{uuid.uuid4().hex[:6]}@example.com"
    pw = SAMPLE_PW
    requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "firstName": "TEST", "lastName": "Gap", "phone": "780-555-0144",
                                                "acceptTerms": True, "termsAccepted": True, "privacyAccepted": True}, timeout=20)
    c = login((email, pw))
    me = c.get(f"{API}/auth/me", timeout=20).json()
    cid = (me.get("user") or me).get("subject") or (me.get("user") or me).get("clientId")
    assert cid, me
    DB.nt_intake.insert_one({"id": f"in-TEST-gap-{uuid.uuid4().hex[:6]}", "clientId": cid, "version": 2, "at": datetime.now(timezone.utc).isoformat()})
    r = c.post(f"{API}/intake", json={"allergies": "TEST none"}, timeout=20)
    print("gap probe", r.status_code, r.text[:200])
    assert r.status_code != 500
