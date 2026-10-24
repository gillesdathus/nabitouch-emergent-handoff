"""Open service coverage: municipality is not an eligibility gate."""
from pricing import OPEN_ZONE, assess_coverage, launch_service_coverage, quote, service_coverage, zone_travel

CENTER = {"lat": 53.5461, "lng": -113.4938}
ZONES = [
    {"id": "z-central", "name": "Central Edmonton", "radiusKm": 6, "fee": 0, "enabled": True},
    {"id": "z-inner", "name": "Inner ring", "radiusKm": 14, "fee": 15, "enabled": True},
    {"id": "z-outer", "name": "Outer ring & suburbs", "radiusKm": 25, "fee": 30, "enabled": True},
]

SAMPLES = {
    "edmonton": {"lat": 53.5435, "lng": -113.499},       # downtown
    "spruce": {"lat": 53.5452, "lng": -113.9104},         # Spruce Grove — outside 25 km rings
    "stalbert": {"lat": 53.6305, "lng": -113.6256},
    "sherwood": {"lat": 53.5413, "lng": -113.2958},
    "leduc": {"lat": 53.2594, "lng": -113.5492},          # outside 25 km rings
    "wetaskiwin": {"lat": 52.9694, "lng": -113.3769},     # outside listed municipalities
}


def test_launch_defaults_are_open_without_travel_fees():
    cov = launch_service_coverage()
    assert cov == {"mode": "open", "radiusKm": 25, "travelFeesEnabled": False}
    assert service_coverage({})["mode"] == "open"
    assert service_coverage({})["travelFeesEnabled"] is False


def test_open_coverage_accepts_metro_and_farther_addresses():
    settings = {"center": CENTER, "serviceCoverage": {"mode": "open"}}
    for name, point in SAMPLES.items():
        zone, _km, eligible = assess_coverage(point, ZONES, settings)
        assert eligible is True, name
        assert zone is not None, name
    spruce_zone, spruce_km, _ = assess_coverage(SAMPLES["spruce"], ZONES, settings)
    assert spruce_km > 25
    assert spruce_zone["id"] == OPEN_ZONE["id"]


def test_zones_mode_still_rejects_outside_rings():
    settings = {"center": CENTER, "serviceCoverage": {"mode": "zones"}}
    ok, _, yes = assess_coverage(SAMPLES["edmonton"], ZONES, settings)
    assert yes and ok["id"] == "z-central"
    zone, _, eligible = assess_coverage(SAMPLES["spruce"], ZONES, settings)
    assert eligible is False and zone is None
    zone, _, eligible = assess_coverage(SAMPLES["leduc"], ZONES, settings)
    assert eligible is False and zone is None


def test_radius_mode_uses_configured_radius():
    tight = {"center": CENTER, "serviceCoverage": {"mode": "radius", "radiusKm": 20}}
    _, _, spruce_ok = assess_coverage(SAMPLES["spruce"], ZONES, tight)
    assert spruce_ok is False
    wide = {"center": CENTER, "serviceCoverage": {"mode": "radius", "radiusKm": 40}}
    zone, _, spruce_ok = assess_coverage(SAMPLES["spruce"], ZONES, wide)
    assert spruce_ok is True and zone is not None


def test_travel_fees_disabled_by_default_in_quotes():
    settings = {"gst": 0.05, "addons": [], "serviceCoverage": launch_service_coverage()}
    priced = quote(
        service={"slug": "swedish", "prices": {"60": 120}, "taxable": True},
        duration=60, addons=[], zone={"id": "z-inner", "fee": 15, "perKm": 0},
        client=None, promotions=[], settings=settings, location_type="home", km=10,
    )
    assert priced["travel"] == 0
    assert priced["total"] == 126.0
    enabled = {**settings, "serviceCoverage": {**launch_service_coverage(), "travelFeesEnabled": True}}
    with_fees = quote(
        service={"slug": "swedish", "prices": {"60": 120}, "taxable": True},
        duration=60, addons=[], zone={"id": "z-inner", "fee": 15, "perKm": 0},
        client=None, promotions=[], settings=enabled, location_type="home", km=10,
    )
    assert with_fees["travel"] == 15
    assert zone_travel({"fee": 15}, 10, "home", settings) == 0
    assert zone_travel({"fee": 15}, 10, "home", enabled) == 15
