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
        AsyncMock(return_value={
            "available": True,
            "minutes": 22,
            "provider": "mapbox-traffic",
            "km": 8.4,
            "durationSec": 1320,
            "distanceM": 8400,
            "geometry": {"type": "LineString", "coordinates": [[-113.62, 53.52], [-113.5, 53.54]]},
            "route": [{"lng": -113.62, "lat": 53.52}, {"lng": -113.5, "lat": 53.54}],
            "estimateType": "traffic-aware",
            "routingProvider": "mapbox",
        }),
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
    assert body["available"] is True
    assert body["minutes"] == 22
    assert body["km"] == 8.4
    assert body["durationSec"] == 1320
    assert body["geometry"]["type"] == "LineString"
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
        AsyncMock(return_value={
            "available": True,
            "minutes": 20,
            "provider": "mapbox",
            "km": 7.2,
            "durationSec": 1200,
            "distanceM": 7200,
            "geometry": {"type": "LineString", "coordinates": [[-113.5, 53.54], [-113.51, 53.55]]},
            "route": [{"lng": -113.5, "lat": 53.54}, {"lng": -113.51, "lat": 53.55}],
            "estimateType": "standard",
            "routingProvider": "mapbox",
        }),
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
    assert pro["stops"][1]["leg"]["available"] is True
    assert pro["stops"][1]["leg"]["geometry"]["type"] == "LineString"
    assert pro["stops"][1]["leg"]["durationSec"] == 1200
    assert pro["stops"][1]["leg"]["routingProvider"] == "mapbox"

    desk = await build_route(db, coll, "p-1", "2026-06-16", {"role": "desk", "subject": "desk-1"}, include_address=True)
    assert "addressLine" not in desk["stops"][0]["stop"]
    assert "position" not in desk["stops"][0]["stop"]
    assert desk["stops"][0]["stop"].get("locationType") == "home"


# Realistic Mapbox Directions v5 shape (geometries=geojson, overview=full).
REALISTIC_MAPBOX_ROUTE = {
    "distance": 15240.3,
    "duration": 1442.1,
    "geometry": {
        "type": "LineString",
        "coordinates": [
            [-113.4938, 53.5461],
            [-113.4901, 53.5461],
            [-113.4901, 53.5498],
            [-113.4855, 53.5498],
            [-113.4855, 53.5532],
            [-113.4802, 53.5532],
        ],
    },
    "legs": [{"distance": 15240.3, "duration": 1442.1, "steps": []}],
    "weight_name": "routability",
    "weight": 1442.1,
}


@pytest.mark.asyncio
async def test_mapbox_leg_returns_geometry_duration_distance(monkeypatch):
    import os
    from availability import mapbox_leg
    from tracking import DIRECTIONS

    previous = os.environ.get("MAPBOX_TOKEN")
    os.environ["MAPBOX_TOKEN"] = "pk.test-slice-a-route"
    calls = []

    async def fetch(profile, origin, dest, token):
        calls.append(profile)
        assert token == "pk.test-slice-a-route"
        assert origin == {"lat": 53.5461, "lng": -113.4938}
        assert dest == {"lat": 53.5532, "lng": -113.4802}
        if profile == "driving-traffic":
            return dict(REALISTIC_MAPBOX_ROUTE)
        raise AssertionError("driving-traffic should succeed")

    monkeypatch.setattr(DIRECTIONS, "_fetch", fetch)
    try:
        leg = await mapbox_leg(
            {"lat": 53.5461, "lng": -113.4938},
            {"lat": 53.5532, "lng": -113.4802},
        )
    finally:
        if previous is None:
            os.environ.pop("MAPBOX_TOKEN", None)
        else:
            os.environ["MAPBOX_TOKEN"] = previous

    assert calls == ["driving-traffic"]
    assert leg["available"] is True
    assert leg["provider"] == "mapbox-traffic"
    assert leg["estimateType"] == "traffic-aware"
    assert leg["routingProvider"] == "mapbox"
    assert leg["durationSec"] == 1442
    assert leg["distanceM"] == 15240
    assert leg["minutes"] == 25
    assert leg["km"] == 15.2
    assert leg["geometry"]["type"] == "LineString"
    assert leg["geometry"]["coordinates"][0] == [-113.4938, 53.5461]
    assert len(leg["geometry"]["coordinates"]) == 6
    # Stair-step road path — not a single straight segment.
    assert leg["geometry"]["coordinates"] != [
        [-113.4938, 53.5461],
        [-113.4802, 53.5532],
    ]
    assert len(leg["route"]) == 6
    assert leg["route"][0] == {"lat": 53.5461, "lng": -113.4938}


@pytest.mark.asyncio
async def test_mapbox_leg_unavailable_has_no_fake_road_geometry(monkeypatch):
    import os
    from availability import mapbox_leg
    from tracking import DIRECTIONS

    previous = os.environ.get("MAPBOX_TOKEN")
    os.environ["MAPBOX_TOKEN"] = "pk.test-slice-a-fail"

    async def fetch(*_a, **_k):
        raise RuntimeError("directions unavailable")

    monkeypatch.setattr(DIRECTIONS, "_fetch", fetch)
    try:
        leg = await mapbox_leg(
            {"lat": 53.5461, "lng": -113.4938},
            {"lat": 53.5532, "lng": -113.4802},
        )
    finally:
        if previous is None:
            os.environ.pop("MAPBOX_TOKEN", None)
        else:
            os.environ["MAPBOX_TOKEN"] = previous

    assert leg["available"] is False
    assert leg["provider"] == "unavailable"
    assert leg["geometry"] is None
    assert leg["route"] is None
    assert leg["km"] is None
    assert leg["durationSec"] is None


@pytest.mark.asyncio
async def test_build_route_marks_unavailable_leg_without_haversine_km(monkeypatch):
    from availability import build_route

    appts = [
        {
            "id": "a1", "ref": "NT-1", "practitionerId": "p-1", "date": "2026-06-16",
            "time": "10:00", "duration": 60, "status": "assigned", "locationType": "home",
            "address": {"lat": 53.54, "lng": -113.5, "line": "A", "zoneName": "Central"},
        },
        {
            "id": "a2", "ref": "NT-2", "practitionerId": "p-1", "date": "2026-06-16",
            "time": "13:00", "duration": 60, "status": "assigned", "locationType": "home",
            "address": {"lat": 53.55, "lng": -113.51, "line": "B", "zoneName": "Downtown"},
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
                return Cursor(appts)
            return Cursor([])

        async def find_one(self, query, *_a, **_k):
            if self.name == "practitioners":
                return {"id": "p-1", "name": "Pro"}
            if self.name == "settings":
                return {"id": "app", "scheduling": {"setupMin": 10, "cleanupMin": 15, "travelBufferMin": 10}}
            return None

    db = MagicMock()
    db.nt_schedules = MagicMock()
    db.nt_schedules.find_one = AsyncMock(return_value={"acceptingBookings": True, "weekly": []})
    monkeypatch.setattr(
        "availability.mapbox_leg",
        AsyncMock(return_value={
            "available": False,
            "minutes": 40,
            "provider": "unavailable",
            "km": None,
            "durationSec": None,
            "distanceM": None,
            "geometry": None,
            "route": None,
            "estimateType": None,
            "routingProvider": "mapbox",
        }),
    )
    monkeypatch.setattr("availability.gap_suggestions", lambda *_a, **_k: [])
    monkeypatch.setattr("availability.propose_order", lambda *_a, **_k: None)

    pro = await build_route(db, Coll, "p-1", "2026-06-16", {"role": "practitioner", "subject": "p-1"})
    leg = pro["stops"][1]["leg"]
    assert leg["available"] is False
    assert leg["message"] == "Driving ETA unavailable"
    assert leg["km"] is None
    assert leg["geometry"] is None
    assert leg["minutes"] is None
    assert pro["stops"][0]["stop"]["addressLine"] == "A"
    assert pro["summary"]["travelMin"] == 0
