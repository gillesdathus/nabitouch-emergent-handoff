"""Open service coverage: municipality is not an eligibility gate."""
from pricing import (
    OPEN_ZONE, VERIFIED_DESTINATION_EXCEPTIONS, assess_coverage, launch_service_coverage,
    quote, service_coverage, zone_travel,
)

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
    "ardrossan": {"lat": 53.591591, "lng": -113.073364},  # rural Range Road — ~28 km
}

ARDROSSAN_MAPBOX = VERIFIED_DESTINATION_EXCEPTIONS[0]["mapboxId"]


def test_launch_defaults_are_open_without_travel_fees():
    cov = launch_service_coverage()
    assert cov["mode"] == "open"
    assert cov["radiusKm"] == 25
    assert cov["travelFeesEnabled"] is False
    assert cov["municipalityIds"] == []
    assert cov["customMunicipalities"] == []
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
    tight = {"center": CENTER, "serviceCoverage": {"mode": "radius", "radiusKm": 20, "verifiedDestinationExceptions": False}}
    _, _, spruce_ok = assess_coverage(SAMPLES["spruce"], ZONES, tight)
    assert spruce_ok is False
    wide = {"center": CENTER, "serviceCoverage": {"mode": "radius", "radiusKm": 40}}
    zone, _, spruce_ok = assess_coverage(SAMPLES["spruce"], ZONES, wide)
    assert spruce_ok is True and zone is not None


def test_verified_ardrossan_exception_under_radius_mode():
    """Production radius (~25 km) rejects Ardrossan unless the verified exception applies."""
    settings = {
        "center": CENTER,
        "serviceCoverage": {"mode": "radius", "radiusKm": 25, "verifiedDestinationExceptions": True},
    }
    zone, km, ok = assess_coverage(
        SAMPLES["ardrossan"], ZONES, settings, mapbox_id=ARDROSSAN_MAPBOX,
    )
    assert km > 25
    assert ok is True and zone is not None
    assert zone.get("destinationExceptionId") == "strathcona-53337-range-road-215"

    denied = {
        "center": CENTER,
        "serviceCoverage": {"mode": "radius", "radiusKm": 25, "verifiedDestinationExceptions": False},
    }
    _, _, blocked = assess_coverage(SAMPLES["ardrossan"], ZONES, denied, mapbox_id=ARDROSSAN_MAPBOX)
    assert blocked is False

    # Unrelated far address still rejected — exception is not a global bypass.
    _, _, spruce_ok = assess_coverage(SAMPLES["spruce"], ZONES, settings)
    assert spruce_ok is False


def test_owner_destination_exception_is_configurable():
    settings = {
        "center": CENTER,
        "serviceCoverage": {
            "mode": "radius",
            "radiusKm": 25,
            "verifiedDestinationExceptions": False,
            "destinationExceptions": [{
                "id": "custom-spruce",
                "lat": SAMPLES["spruce"]["lat"],
                "lng": SAMPLES["spruce"]["lng"],
                "radiusKm": 1,
                "line": "400 Calahoo Rd, Spruce Grove, AB",
            }],
        },
    }
    zone, _, ok = assess_coverage(SAMPLES["spruce"], ZONES, settings)
    assert ok is True and zone is not None
    _, _, edmonton_ok = assess_coverage(SAMPLES["edmonton"], ZONES, settings)
    assert edmonton_ok is True
    _, _, leduc_ok = assess_coverage(SAMPLES["leduc"], ZONES, settings)
    assert leduc_ok is False


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
