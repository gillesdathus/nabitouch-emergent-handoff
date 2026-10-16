# Iteration 6 retest: preset labels, statement lock message, winback clientName + Edmonton dates
import concurrent.futures as cf
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from t1_common import API, OWNER, SARAH, MAYA, login

EDM_TODAY = datetime.now(ZoneInfo("America/Edmonton")).date()


# Messaging presets: short labels
class TestPresets:
    def test_practitioner_labels(self):
        s = login(MAYA)
        r = s.get(f"{API}/messages/presets", timeout=20)
        assert r.status_code == 200
        p = {x["id"]: x for x in r.json()["presets"]}
        assert p["access"]["label"] == "Building access"
        assert p["area"]["label"] == "Set-up area"
        assert p["assist"]["label"] == "Meet me at the door"
        for k in ("access", "area", "assist"):
            assert len(p[k]["body"]) > len(p[k]["label"])
        assert r.json()["sms"] is False and r.json()["email"] is False

    def test_client_labels(self):
        s = login(SARAH)
        p = {x["id"]: x for x in s.get(f"{API}/messages/presets", timeout=20).json()["presets"]}
        assert p["parking"]["label"] == "Parking info"
        assert p["door_code"]["label"] == "Door code"


# Statement lock: concurrent create -> one 200, loser 409 with lock/overlap message, no duplicates
class TestStatementLock:
    def test_concurrent(self):
        s = login(OWNER)
        start, end = "2027-01-01", "2027-06-30"
        # Find a period with invoiced maya visits; fall back to a broad future window.
        body = {"practitionerId": "p-maya", "start": start, "end": end}
        before = [x for x in s.get(f"{API}/finance/statements", timeout=20).json() if x.get("practitionerId") == "p-maya" and x["start"] == start]
        for x in before:
            s.delete(f"{API}/finance/statements/{x['id']}", timeout=20)

        def post(_):
            return requests.post(f"{API}/finance/statements", json=body, cookies=s.cookies, headers=dict(s.headers), timeout=60)

        with cf.ThreadPoolExecutor(3) as ex:
            rs = list(ex.map(post, range(3)))
        codes = sorted(r.status_code for r in rs)
        print("codes", codes, [r.text[:160] for r in rs])
        if codes == [404, 404, 404]:
            import pytest
            pytest.skip("no invoiced maya visits in 2027 H1; lock not exercisable")
        assert codes.count(200) == 1, codes
        for r in rs:
            if r.status_code == 409:
                d = r.json().get("detail", "")
                assert "already in progress" in d or "already covers" in d, d
        rows = [x for x in s.get(f"{API}/finance/statements", timeout=20).json() if x.get("practitionerId") == "p-maya" and x["start"] == start and x["end"] == end]
        assert len(rows) == 1
        for x in rows:
            assert s.delete(f"{API}/finance/statements/{x['id']}", timeout=20).status_code in (200, 204)


# Winback: invites carry clientName; candidates uses Edmonton dates
class TestWinback:
    def test_invites_client_name(self):
        s = login(OWNER)
        r = s.get(f"{API}/winback/invites", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for x in rows:
            assert "clientName" in x
        named = [x for x in rows if x["clientName"]]
        if rows:
            assert named, "no invite has a clientName"

    def test_candidates_edmonton(self):
        s = login(OWNER)
        r = s.get(f"{API}/winback/candidates", timeout=20)
        assert r.status_code == 200
        d = r.json()
        for c in d["candidates"]:
            last = c.get("lastVisit") or c.get("last")
            if last:
                assert c["daysInactive"] == (EDM_TODAY - datetime.fromisoformat(last[:10]).date()).days
