# Issue a fresh winback invite to sarah for the booking review UI check
import sys; sys.path.insert(0, "/app/backend/tests")
from test_m7_10_safety_plans_native_winback import *
o = login(OWNER)
r = o.post(f"{API}/winback/invites", json={"clientId": "c-sarah"}); print(r.status_code, r.text[:150])
