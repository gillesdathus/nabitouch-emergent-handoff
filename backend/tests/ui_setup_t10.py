# Iteration 10 UI setup: two arrived + consent-ready appointments for p-maya (TEST bookings)
import sys
from test_smart_intake_turnaround import book, end_if_active, make_ready, to_arrived
from t1_common import login, OWNER, SARAH
o, s = login(OWNER), login(SARAH)
end_if_active()
from test_smart_intake_turnaround import baseline_body, API
assert s.post(f"{API}/intake/baseline", json=baseline_body(), timeout=20).status_code == 200
for _ in range(int(sys.argv[1]) if len(sys.argv) > 1 else 2):
    a = book(o)
    to_arrived(o, a["id"])
    make_ready(s, a["id"])
    print(a["id"], a["ref"])
