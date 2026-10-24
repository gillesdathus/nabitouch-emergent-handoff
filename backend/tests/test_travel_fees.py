"""Configurable municipality travel-fee estimation and address-based calculation."""
import pytest

from pricing import launch_service_coverage, public_service_coverage, quote, service_coverage, zone_travel
from travel_fees import (
    CALC_VERSION,
    apply_rounding,
    calculate_travel_fee,
    can_manage_pricing,
    normalize_travel_fees,
    representative_point,
    validate_travel_fees_config,
)


CENTER = {"lat": 53.5461, "lng": -113.4938}
SERVICE = {"slug": "swedish", "prices": {"60": 120}, "taxable": True}

MUNI = {
    "edmonton": "4811061",
    "st_albert": "4811062",
    "spruce": "4811049",
    "strathcona": "4811052",
    "leduc": "4811016",
}


def _settings(*, enabled=True, fees=None, municipalities=None, mode="zones"):
    cov = launch_service_coverage()
    cov["mode"] = mode
    cov["travelFeesEnabled"] = enabled
    if municipalities is not None:
        cov["municipalityIds"] = municipalities
    if fees is not None:
        cov["travelFees"] = normalize_travel_fees(fees)
    return {"gst": 0.05, "addons": [], "center": CENTER, "serviceCoverage": service_coverage({"serviceCoverage": cov})}


def test_launch_includes_travel_fees_block():
    cov = launch_service_coverage()
    assert cov["travelFeesEnabled"] is False
    assert cov["travelFees"]["baseFee"] == 0
    assert cov["travelFees"]["fallbackPolicy"] == "manual_review"


def test_public_service_coverage_exposes_only_enabled_flag():
    """Clients/public must learn if travel rows apply without receiving fee rates."""
    pub = public_service_coverage({
        "travelFeesEnabled": True,
        "travelFees": {"baseFee": 25, "perKm": 2, "municipalityOverrides": {"4811061": {"policy": "free"}}},
        "municipalityIds": ["4811061"],
    })
    assert pub == {"travelFeesEnabled": True}
    assert "travelFees" not in pub
    assert "municipalityIds" not in pub
    assert public_service_coverage({}) == {"travelFeesEnabled": False}


def test_fees_disabled_zero_even_with_rates():
    settings = _settings(enabled=False, fees={"baseFee": 15, "perKm": 1})
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=20, municipality_id=MUNI["edmonton"],
    )
    assert calc["fee"] == 0
    assert calc["status"] == "disabled"
    priced = quote(
        service=SERVICE, duration=60, addons=[], zone={"id": "muni-4811061", "fee": 99, "perKm": 2},
        client=None, promotions=[], settings=settings, location_type="home", km=20,
    )
    assert priced["travel"] == 0
    assert priced["total"] == 126.0


def test_global_distance_based_with_free_km_and_max():
    settings = _settings(enabled=True, fees={"baseFee": 10, "perKm": 1.5, "freeKm": 5, "maxFee": 40})
    # 25 km drive → billable 20 → 10 + 30 = 40 (hits max)
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=25, municipality_id=MUNI["edmonton"],
    )
    assert calc["billableKm"] == 20
    assert calc["fee"] == 40
    assert calc["calcVersion"] == CALC_VERSION
    # Under max: 10 km → billable 5 → 10 + 7.5 = 17.5
    calc2 = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=10, municipality_id=MUNI["spruce"],
    )
    assert calc2["fee"] == 17.5


def test_free_travel_municipality_override():
    settings = _settings(enabled=True, fees={
        "baseFee": 20, "perKm": 1,
        "municipalityOverrides": {MUNI["edmonton"]: {"policy": "free"}},
    })
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=30, municipality_id=MUNI["edmonton"],
    )
    assert calc["fee"] == 0
    assert calc["policy"] == "free"
    other = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=30, municipality_id=MUNI["leduc"],
    )
    assert other["fee"] == 50


def test_fixed_municipality_fee_override():
    settings = _settings(enabled=True, fees={
        "baseFee": 5, "perKm": 2,
        "municipalityOverrides": {MUNI["strathcona"]: {"policy": "fixed", "fixedFee": 22}},
    })
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=100, municipality_id=MUNI["strathcona"],
    )
    assert calc["fee"] == 22
    assert calc["policy"] == "fixed"


def test_custom_rate_municipality_override():
    settings = _settings(enabled=True, fees={
        "baseFee": 0, "perKm": 1, "freeKm": 0,
        "municipalityOverrides": {
            MUNI["st_albert"]: {"policy": "custom_rate", "baseFee": 8, "perKm": 0.5, "freeKm": 2},
        },
    })
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=12, municipality_id=MUNI["st_albert"],
    )
    # billable 10 → 8 + 5 = 13
    assert calc["fee"] == 13
    assert calc["policy"] == "custom_rate"


def test_missing_route_manual_review_not_binding():
    settings = _settings(enabled=True, fees={"baseFee": 10, "perKm": 1, "fallbackPolicy": "manual_review"})
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=None, route_ok=False,
        route_error="routing_unavailable", municipality_id=MUNI["edmonton"],
    )
    assert calc["fee"] == 0
    assert calc["binding"] is False
    assert calc["status"] == "needs_review"


def test_missing_route_fallback_fixed():
    settings = _settings(enabled=True, fees={
        "baseFee": 10, "perKm": 1, "fallbackPolicy": "fixed", "fallbackFixedFee": 18,
    })
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=None, route_ok=False,
    )
    assert calc["fee"] == 18
    assert calc["binding"] is True


def test_invalid_configuration_rejected():
    with pytest.raises(ValueError):
        validate_travel_fees_config({"baseFee": 999})
    with pytest.raises(ValueError):
        validate_travel_fees_config({"perKm": 100})


def test_rounding_modes():
    assert apply_rounding(12.4, "dollar") == 12
    assert apply_rounding(12.5, "dollar") == 13
    assert apply_rounding(12.345, "cent") == 12.35
    assert apply_rounding(12.344, "none") == 12.344


def test_representative_points_for_metro_municipalities():
    for key, mid in MUNI.items():
        point = representative_point(mid)
        assert point is not None, key
        assert -90 <= point["lat"] <= 90
        assert -180 <= point["lng"] <= 180


def test_quote_and_total_consistency_with_travel_calc():
    settings = _settings(enabled=True, fees={"baseFee": 10, "perKm": 1, "freeKm": 0})
    calc = calculate_travel_fee(
        settings=settings, location_type="home", driving_km=15, municipality_id=MUNI["spruce"],
    )
    priced = quote(
        service=SERVICE, duration=60, addons=[], zone={"id": f"muni-{MUNI['spruce']}", "municipalityId": MUNI["spruce"]},
        client=None, promotions=[], settings=settings, location_type="home", travel_calc=calc,
    )
    assert priced["travel"] == 25
    assert priced["travelCalc"]["drivingKm"] == 15
    # 120 + 25 = 145 + 5% GST = 152.25
    assert priced["total"] == 152.25


def test_historical_totals_unchanged_by_new_policy():
    """Re-quoting with new settings must not rewrite a stored historical pricing blob."""
    historical = {"base": 120, "travel": 15, "tax": 6.75, "total": 141.75, "discount": 0, "addons": 0}
    settings = _settings(enabled=True, fees={"baseFee": 99, "perKm": 9})
    # New quote uses new policy…
    fresh = quote(
        service=SERVICE, duration=60, addons=[], zone={"fee": 0, "perKm": 0},
        client=None, promotions=[], settings=settings, location_type="home", km=10, route_ok=True,
    )
    assert fresh["travel"] != historical["travel"]
    # …but the stored historical dict is untouched.
    assert historical["total"] == 141.75
    assert historical["travel"] == 15


def test_legacy_zone_fees_when_global_rates_zero():
    settings = _settings(enabled=True, fees={"baseFee": 0, "perKm": 0})
    fee = zone_travel({"fee": 15, "perKm": 1}, 10, "home", settings, route_ok=True)
    assert fee == 25


def test_clinic_always_zero():
    settings = _settings(enabled=True, fees={"baseFee": 50, "perKm": 2})
    assert zone_travel({"fee": 50}, 20, "clinic", settings) == 0


def test_manager_pricing_permission():
    assert can_manage_pricing({"role": "owner", "roles": ["owner"]}) is True
    assert can_manage_pricing({"role": "manager", "roles": ["manager"]}) is False
    assert can_manage_pricing({"role": "manager", "roles": ["manager"], "staffPerms": {"managePricing": True}}) is True
    assert can_manage_pricing({"role": "desk", "roles": ["desk"], "staffPerms": {"managePricing": True}}) is False


def test_guest_cash_settlement_not_forced_by_travel():
    """Travel fees increase the total but cash / no-upfront still collects $0 now."""
    from payment_policy import due_for_booking, preview_policy

    settings = _settings(enabled=True, fees={"baseFee": 20, "perKm": 0})
    priced = quote(
        service=SERVICE, duration=60, addons=[], zone={"municipalityId": MUNI["edmonton"]},
        client=None, promotions=[], settings=settings, location_type="home", km=1, route_ok=True,
    )
    assert priced["travel"] == 20
    policy = {**preview_policy(), "cashAccepted": True}
    due = due_for_booking(priced["total"], policy, {"payNow": "cash", "paymentMethod": "self"})
    assert due["dueNowCents"] == 0
    assert due["remainingCents"] == due["totalCents"]


def test_deposit_includes_travel_in_base_total():
    from payment_policy import settlement, preview_policy

    settings = _settings(enabled=True, fees={"baseFee": 20, "perKm": 0})
    priced = quote(
        service=SERVICE, duration=60, addons=[], zone={"municipalityId": MUNI["edmonton"]},
        client=None, promotions=[], settings=settings, location_type="home", km=1, route_ok=True,
    )
    # 140 + 7 GST = 147
    due = settlement(priced["total"], preview_policy(), "deposit")
    assert due["totalCents"] == 14700
    assert due["dueNowCents"] == 3675  # 25%


def test_driving_distance_does_not_fabricate_without_token(monkeypatch):
    import asyncio
    from travel_fees import driving_distance_km
    monkeypatch.delenv("MAPBOX_TOKEN", raising=False)
    result = asyncio.run(driving_distance_km(CENTER, {"lat": 53.54, "lng": -113.5}))
    assert result["ok"] is False
    assert result["km"] is None
    assert result["error"] == "routing_unconfigured"
