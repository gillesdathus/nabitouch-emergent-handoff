# Iteration 7 retest: statement target=all skips a busy-locked practitioner; winback 'Deleted client'; 'Running late' preset label
from datetime import datetime, timezone

from dotenv import dotenv_values
from pymongo import MongoClient

from t1_common import API, OWNER, MAYA, login

BENV = dotenv_values("/app/backend/.env")
DB = MongoClient(BENV["MONGO_URL"])[BENV["DB_NAME"]]
START, END = "2026-08-01", "2026-08-31"


# Finance statements: busy lock for one practitioner -> skipped, others created
class TestStatementsAllWithLock:
    def test_busy_lock_skips_one(self):
        s = login(OWNER)
        # Clean any stale non-maya rows for the window (maya already has a covering statement)
        for x in s.get(f"{API}/finance/statements", timeout=20).json():
            if x["start"] == START and x["end"] == END and x.get("practitionerId") != "p-maya":
                s.delete(f"{API}/finance/statements/{x['id']}", timeout=20)
        DB.nt_statement_locks.delete_many({"id": "p-liam"})
        DB.nt_statement_locks.insert_one({"id": "p-liam", "at": datetime.now(timezone.utc)})
        created_ids = []
        try:
            r = s.post(f"{API}/finance/statements", json={"practitionerId": "all", "start": START, "end": END}, timeout=60)
            print("status", r.status_code, r.text[:600], dict(r.headers))
            assert r.status_code == 200, r.text
            data = r.json()
            rows = data if isinstance(data, list) else (data.get("created") or data.get("statements") or [])
            created_ids = [x["id"] for x in rows]
            pids = {x["practitionerId"] for x in rows}
            assert "p-liam" not in pids
            assert {"p-jordan", "p-priya"} <= pids, pids
            # liam's lock must not be removed by the request that skipped it
            assert DB.nt_statement_locks.find_one({"id": "p-liam"}) is not None
            # skipped must be reported somewhere to the caller
            txt = r.text + " ".join(f"{k}:{v}" for k, v in r.headers.items())
            assert "Liam" in txt or "p-liam" in txt or "skipped" in txt.lower(), "skipped practitioner not listed in response"
        finally:
            DB.nt_statement_locks.delete_many({"id": "p-liam"})
            for x in s.get(f"{API}/finance/statements", timeout=20).json():
                if x["start"] == START and x["end"] == END and x.get("practitionerId") != "p-maya":
                    s.delete(f"{API}/finance/statements/{x['id']}", timeout=20)
            left = [x for x in s.get(f"{API}/finance/statements", timeout=20).json() if x["start"] == START and x["end"] == END]
            assert not left


# Winback: deleted client fallback
class TestWinbackDeleted:
    def test_deleted_client_name(self):
        s = login(OWNER)
        rows = s.get(f"{API}/winback/invites", timeout=20).json()
        assert all(x["clientName"] for x in rows)
        ids = {c["id"] for c in DB.nt_clients.find({}, {"id": 1})}
        orphan = [x for x in rows if x["clientId"] not in ids]
        assert orphan, "expected BACK-A2BPZV orphan (c-test-wb5)"
        print("orphans", [(x["code"] if "code" in x else x["id"], x["clientName"]) for x in orphan])
        for x in orphan:
            assert x["clientName"] == "Deleted client"


# Messaging: late preset label
class TestLatePreset:
    def test_label(self):
        s = login(MAYA)
        p = {x["id"]: x for x in s.get(f"{API}/messages/presets", timeout=20).json()["presets"]}
        assert p["late"]["label"] == "Running late"
        assert "{minutes}" in p["late"]["body"]
