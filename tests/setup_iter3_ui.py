# Setup data for iteration 3 UI checks: en_route visit + safety_hold visit
import sys; sys.path.insert(0, "/app/backend/tests")
from test_m7_10_safety_plans_native_winback import *
o, c, p = login(OWNER), login(CLIENT), login(PRO)
a = book(c).json()["appointment"]["id"]; to_en_route(o, a)
b = book(c).json()["appointment"]["id"]; to_en_route(o, b)
p.post(f"{API}/appointments/{b}/safety/checkin")
p.post(f"{API}/appointments/{b}/assist", json={"note": "TEST_"})
h = p.post(f"{API}/appointments/{b}/incidents", json={"kind": "unsafe", "action": "cannot_proceed", "note": "TEST_ ui"}).json()
print("ENROUTE", a, "HOLD", b, "HOLDEV", h["event"]["id"])
print("MEMBERSHIPS", [(m["id"], m["status"], m.get("currentPeriodEnd")) for m in credits_state(c).get("memberships", [])])
