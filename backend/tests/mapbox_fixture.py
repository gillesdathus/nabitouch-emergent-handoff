"""Recorded Mapbox stand-in for isolated tests.

Test-only helper; application modules do not import it. Set MAPBOX_FIXTURE_MODE=recorded or
MAPBOX_FIXTURE_MODE=fail only on a disposable test process. Address validation
and service-area rules stay in geo.py and locate_visit.
"""
import os


def fixture_mode():
    if os.environ.get("APP_ENV", "").strip().lower() == "production":
        return ""
    mode = os.environ.get("MAPBOX_FIXTURE_MODE", "").strip().lower()
    if mode in ("recorded", "fail"):
        return mode
    return ""


def recorded_drive(origin, dest):
    """None means the fixture is off. A tuple is the stand-in route result."""
    mode = fixture_mode()
    if not mode:
        return None
    if mode == "fail" or not origin or not dest:
        return None, "unavailable"
    return 12, "mapbox"
