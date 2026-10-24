"""Owner-managed municipality coverage for zones mode."""
from municipalities import resolve_municipality
from pricing import OPEN_ZONE, assess_coverage, launch_service_coverage, quote, service_coverage

CENTER = {"lat": 53.5461, "lng": -113.4938}
ZONES = [
    {"id": "z-central", "name": "Central Edmonton", "radiusKm": 6, "fee": 0, "enabled": True},
    {"id": "z-inner", "name": "Inner ring", "radiusKm": 14, "fee": 15, "enabled": True},
    {"id": "z-outer", "name": "Outer ring & suburbs", "radiusKm": 25, "fee": 30, "enabled": True},
]

SAMPLES = {
    "edmonton": {"lat": 53.5435, "lng": -113.499},
    "spruce": {"lat": 53.5452, "lng": -113.9104},
    "sherwood": {"lat": 53.5413, "lng": -113.2958},
    "leduc": {"lat": 53.2594, "lng": -113.5492},
    "wetaskiwin": {"lat": 52.9694, "lng": -113.3769},
}


def test_launch_defaults_include_empty_municipality_lists():
    cov = launch_service_coverage()
    assert cov["mode"] == "open"
    assert cov["travelFeesEnabled"] is False
    assert cov["municipalityIds"] == []
    assert cov["customMunicipalities"] == []


def test_sherwood_park_resolves_to_strathcona_county():
    muni = resolve_municipality(SAMPLES["sherwood"], place_hint="Sherwood Park")
    assert muni is not None
    assert muni["id"] == "4811052"
    assert muni["name"] == "Strathcona County"


def test_edmonton_and_spruce_grove_resolve():
    assert resolve_municipality(SAMPLES["edmonton"])["id"] == "4811061"
    assert resolve_municipality(SAMPLES["spruce"])["id"] == "4811049"


def test_zones_municipality_selection_gates_eligibility():
    settings = {
        "center": CENTER,
        "serviceCoverage": {
            "mode": "zones",
            "municipalityIds": ["4811061", "4811049"],
            "travelFeesEnabled": False,
        },
    }
    zone, _, ok = assess_coverage(SAMPLES["edmonton"], ZONES, settings)
    assert ok and zone is not None
    zone, _, ok = assess_coverage(SAMPLES["spruce"], ZONES, settings)
    assert ok and zone is not None
    # Strathcona / Sherwood Park not selected
    zone, _, ok = assess_coverage(SAMPLES["sherwood"], ZONES, settings, place_hint="Sherwood Park")
    assert ok is False and zone is None
    # Unselected city rejected only under restricted coverage
    zone, _, ok = assess_coverage(SAMPLES["leduc"], ZONES, settings)
    assert ok is False


def test_strathcona_selection_covers_sherwood_park():
    settings = {
        "center": CENTER,
        "serviceCoverage": {"mode": "zones", "municipalityIds": ["4811052"]},
    }
    zone, _, ok = assess_coverage(SAMPLES["sherwood"], ZONES, settings, place_hint="Sherwood Park")
    assert ok is True
    assert zone["municipalityId"] == "4811052" or zone["id"].startswith("muni-")


def test_open_coverage_ignores_municipality_selection():
    settings = {
        "center": CENTER,
        "serviceCoverage": {
            "mode": "open",
            "municipalityIds": ["4811061"],
            "travelFeesEnabled": False,
        },
    }
    for name, point in SAMPLES.items():
        zone, _, ok = assess_coverage(point, ZONES, settings)
        assert ok is True, name
        assert zone is not None


def test_legacy_rings_still_apply_when_no_municipalities_configured():
    settings = {"center": CENTER, "serviceCoverage": {"mode": "zones", "municipalityIds": []}}
    ok_zone, _, yes = assess_coverage(SAMPLES["edmonton"], ZONES, settings)
    assert yes and ok_zone["id"] == "z-central"
    zone, _, eligible = assess_coverage(SAMPLES["spruce"], ZONES, settings)
    assert eligible is False and zone is None


def test_travel_fees_remain_off_under_municipality_zones():
    settings = {
        "gst": 0.05,
        "addons": [],
        "serviceCoverage": service_coverage({
            "serviceCoverage": {
                "mode": "zones",
                "municipalityIds": ["4811061"],
                "travelFeesEnabled": False,
            },
        }),
    }
    priced = quote(
        service={"slug": "swedish", "prices": {"60": 120}, "taxable": True},
        duration=60, addons=[], zone={"id": "muni-4811061", "fee": 15, "perKm": 0},
        client=None, promotions=[], settings=settings, location_type="home", km=10,
    )
    assert priced["travel"] == 0


def test_custom_municipality_radius_eligibility():
    settings = {
        "center": CENTER,
        "serviceCoverage": {
            "mode": "zones",
            "municipalityIds": [],
            "customMunicipalities": [{
                "id": "custom:wetaskiwin",
                "name": "Wetaskiwin",
                "lat": 52.9694,
                "lng": -113.3769,
                "radiusKm": 10,
                "source": "mapbox_place",
            }],
        },
    }
    zone, _, ok = assess_coverage(SAMPLES["wetaskiwin"], ZONES, settings)
    assert ok is True
    assert zone is not None
    zone, _, ok = assess_coverage(SAMPLES["edmonton"], ZONES, settings)
    assert ok is False
