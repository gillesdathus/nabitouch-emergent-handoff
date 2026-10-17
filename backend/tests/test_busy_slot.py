from server import busy_slot


def test_incomplete_appointment_is_not_a_public_busy_block():
    assert busy_slot({"id": "a-partial"}) is None
    assert busy_slot({"id": "a-dated", "date": "2026-10-21", "status": "confirmed"}) is None


def test_complete_appointment_stays_on_the_public_calendar():
    slot = busy_slot({"id": "a-ready", "date": "2026-10-21", "time": "10:00", "duration": 60, "status": "requested"})
    assert slot["time"] == "10:00"
    assert slot["duration"] == 60
    assert slot["practitionerId"] is None
