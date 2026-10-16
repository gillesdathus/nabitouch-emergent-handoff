"""Test helper: records a confirmed intake and signed session consent so legacy lifecycle tests can start treatment."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
_db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def ensure_session_ready(aid):
    appt = _db.nt_appointments.find_one({"id": aid}) or {}
    client_id = appt.get("clientId")
    now = datetime.now(timezone.utc).isoformat()
    last = list(_db.nt_intake.find({"clientId": client_id}).sort("version", -1).limit(1))
    version = (last[0]["version"] if last else 0) + 1
    _db.nt_intake.insert_one({"id": f"in-test-{aid}-{version}", "clientId": client_id, "version": version, "at": now, "baseline": True,
                              "source": "test-fixture", "conditions": ["None of these"], "pregnancy": "Not applicable",
                              "emergencyName": "Test Contact", "emergencyPhone": "7805550100"})
    _db.nt_intake_confirmations.insert_one({"id": f"inc-test-{aid}-{version}", "appointmentId": aid, "clientId": client_id, "at": now,
                                            "intakeVersion": version, "changed": False, "changedFields": [], "answers": {}})
    _db.nt_session_consents.insert_one({"id": f"scn-test-{aid}-{version}", "appointmentId": aid, "clientId": client_id, "at": now,
                                        "typedName": "Test Client", "restrictions": {"avoidAreas": [], "pressureMax": "firm", "draping": "standard"},
                                        "intakeVersion": version, "method": "test-fixture"})
