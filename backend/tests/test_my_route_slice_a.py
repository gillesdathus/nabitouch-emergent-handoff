"""Slice A — My Route route-stop contract, preview privacy, departure math."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from availability import (
    leave_by_minutes,
    navigation_location_type,
    preview_route_from_origin,
    route_location_type,
    scheduling_rules,
)
from pricing import minutes


def test_route_location_type_never_invents_home():
    assert route_location_type({"locationType": "home"}) == "home"
    assert route_location_type({"locationType": "hotel"}) == "hotel"
    assert route_location_type({"locationType": "clinic"}) == "clinic"
    assert route_location_type({}) is None
    assert route_location_type({"locationType": ""}) is None
    assert route_location_type(None) is None


def test_navigation_location_type_treats_missing_as_mobile_not_clinic():
    assert navigation_location_type({}) == "home"
    assert navigation_location_type({"locationType": "office"}) == "office"
    assert navigation_location_type({"locationType": "clinic"}) == "clinic"


def test_leave_by_avoids_double_counting_cleanup():
    rules = scheduling_rules({"scheduling": {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 10}})
    # Appointment at 14:00, 25 min drive → leave by 13:15 (not subtracting cleanup).
    leave = leave_by_minutes(minutes("14:00"), 25, rules)
    assert leave == minutes("13:15")


def test_can_manage_includes_manager_role():
    from availability import can_manage
    assert can_manage({"role": "manager", "subject": "u-mgr"}, "p-any", {}) is True
    assert can_manage({"role": "owner", "roles": ["owner", "manager"]}, "p-any", {}) is True


@pytest.mark.asyncio
async def test_preview_does_not_persist_origin_or_start_trip(monkeypatch):
    appt = {
        "id": "a-1",
        "ref": "NT-1",
        "practitionerId": "p-1",
        "date": "2026-06-16",
        "time": "14:00",
        "duration": 60,
        "status": "assigned",
        "locationType": "home",
        "address": {"lat": 53.54, "lng": -113.5, "line": "123 Client St"},
    }
    settings = {"scheduling": {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 10}, "receptionPerms": {}}

    class Coll:
        def __init__(self, name):
            self.name = name

        async def find_one(self, query, *_a, **_k):
            if self.name == "settings":
                return {"id": "app", **settings}
            if self.name == "appointments":
                return appt if query.get("id") == "a-1" else None
            return None

    def coll(name):
        return Coll(name)

    db = MagicMock()
    monkeypatch.setattr(
        "availability.mapbox_leg",
        AsyncMock(return_value={"minutes": 22, "provider": "mapbox-traffic", "km": 8.4}),
    )

    body = await preview_route_from_origin(
        db, coll, "p-1",
        {"role": "practitioner", "subject": "p-1"},
        {"lat": 53.52, "lng": -113.62},
        "a-1",
    )
    assert body["persisted"] is False
    assert body["tripStarted"] is False
    assert body["sharing"] is False
    assert body["statusUnchanged"] is True
    assert body["minutes"] == 22
    assert body["km"] == 8.4
    assert "origin" not in body
    assert body["depart"] == "13:18"
    assert body["trafficAware"] is True


@pytest.mark.asyncio
async def test_preview_rejects_foreign_appointment():
    class Coll:
        def __init__(self, name):
            self.name = name

        async def find_one(self, query, *_a, **_k):
            if self.name == "settings":
                return {"id": "app", "receptionPerms": {}}
            if self.name == "appointments" and query.get("id") == "a-x":
                return {
                    "id": "a-x", "practitionerId": "p-other", "status": "assigned",
                    "locationType": "home", "time": "10:00",
                    "address": {"lat": 53.5, "lng": -113.5},
                }
            return None

    def coll(name):
        return Coll(name)

    with pytest.raises(HTTPException) as exc:
        await preview_route_from_origin(
            MagicMock(), coll, "p-1",
            {"role": "practitioner", "subject": "p-1"},
            {"lat": 53.52, "lng": -113.62},
            "a-x",
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_build_route_includes_location_type_and_hides_address_for_desk(monkeypatch):
    from availability import build_route

    appts = [
        {
            "id": "a1", "ref": "NT-1", "practitionerId": "p-1", "date": "2026-06-16",
            "time": "10:00", "duration": 60, "status": "assigned", "locationType": "home",
            "serviceSlug": "swedish",
            "address": {"lat": 53.54, "lng": -113.5, "line": "Secret 1", "zoneName": "Central"},
        },
        {
            "id": "a2", "ref": "NT-2", "practitionerId": "p-1", "date": "2026-06-16",
            "time": "13:00", "duration": 60, "status": "assigned", "locationType": "hotel",
            "serviceSlug": "swedish",
            "address": {"lat": 53.55, "lng": -113.51, "line": "Secret 2", "zoneName": "Downtown"},
        },
        {
            "id": "a3", "ref": "NT-3", "practitionerId": "p-1", "date": "2026-06-16",
            "time": "16:00", "duration": 60, "status": "cancelled", "locationType": "home",
            "address": {"lat": 53.56, "lng": -113.52, "line": "Cancelled"},
        },
        {
            "id": "a4", "ref": "NT-4", "practitionerId": "p-1", "date": "2026-06-16",
            "time": "17:00", "duration": 60, "status": "assigned",
            # Missing locationType — must still appear; type must not be invented as home on the stop.
            "serviceSlug": "swedish",
            "address": {"lat": 53.57, "lng": -113.53, "line": "Legacy mobile", "zoneName": "West"},
        },
    ]

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, *_a, **_k):
            return list(self.rows)

    class Coll:
        def __init__(self, name):
            self.name = name

        def find(self, query, *_a, **_k):
            if self.name == "appointments":
                return Cursor([a for a in appts if a["practitionerId"] == query.get("practitionerId") and a["date"] == query.get("date")])
            return Cursor([])

        async def find_one(self, query, *_a, **_k):
            if self.name == "practitioners":
                return {"id": "p-1", "name": "Pro"}
            if self.name == "settings":
                return {"id": "app", "scheduling": {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 10}, "receptionPerms": {}}
            return None

    def coll(name):
        return Coll(name)

    db = MagicMock()
    db.nt_schedules = MagicMock()
    db.nt_schedules.find_one = AsyncMock(return_value={"acceptingBookings": True, "weekly": []})

    monkeypatch.setattr(
        "availability.mapbox_leg",
        AsyncMock(return_value={"minutes": 20, "provider": "mapbox", "km": 7.2}),
    )
    monkeypatch.setattr("availability.gap_suggestions", lambda *_a, **_k: [])
    monkeypatch.setattr("availability.propose_order", lambda *_a, **_k: None)

    pro = await build_route(db, coll, "p-1", "2026-06-16", {"role": "practitioner", "subject": "p-1"})
    ids = [row["stop"]["id"] for row in pro["stops"]]
    assert ids == ["a1", "a2", "a4"]
    assert pro["stops"][0]["stop"]["locationType"] == "home"
    assert pro["stops"][1]["stop"]["locationType"] == "hotel"
    assert "locationType" not in pro["stops"][2]["stop"]
    assert pro["stops"][0]["stop"]["addressLine"] == "Secret 1"
    assert pro["stops"][1]["leg"]["km"] == 7.2
    assert pro["stops"][1]["leg"]["minutes"] == 20

    desk = await build_route(db, coll, "p-1", "2026-06-16", {"role": "desk", "subject": "desk-1"}, include_address=True)
    assert "addressLine" not in desk["stops"][0]["stop"]
    assert "position" not in desk["stops"][0]["stop"]
    assert desk["stops"][0]["stop"].get("locationType") == "home"
