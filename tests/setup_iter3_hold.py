# Creates a safety_hold visit from 'arrived' to check the stepper, and checks siblings of a-e3947893
import sys; sys.path.insert(0, "/app/backend/tests")
from test_m7_10_safety_plans_native_winback import *
o, c, p = login(OWNER), login(CLIENT), login(PRO)
evs = o.get(f"{API}/safety/events").json()["events"]
print("open for a-e3947893:", [(e["kind"], e["status"]) for e in evs if e["appointmentId"] == "a-e3947893"])
print("status a-e3947893:", get_appt(o, "a-e3947893")["status"])
b = book(c).json()["appointment"]["id"]; to_en_route(o, b); drive(o, b, ["arrived"])
p.post(f"{API}/appointments/{b}/safety/checkin")
h = p.post(f"{API}/appointments/{b}/incidents", json={"kind": "unsafe", "action": "cannot_proceed", "note": "TEST_ arrived hold"})
print("HOLD2", b, h.status_code, h.text[:200])
