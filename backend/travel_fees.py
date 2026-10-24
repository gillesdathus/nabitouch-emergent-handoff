"""Configurable travel-fee policy nested under settings.serviceCoverage.

Calculation version 1 formula (distance-based):
  billable_km = max(0, driving_km - free_km)
  fee = base_fee + per_km * billable_km
  if max_fee is set: fee = min(fee, max_fee)
  apply rounding

Precedence (first match wins):
  1. travelFeesEnabled / travelFees.enabled is false → $0 (no routing)
  2. clinic / non-mobile visit → $0
  3. municipality override policy "free" → $0
  4. municipality override policy "fixed" → fixedFee
  5. municipality override policy "custom_rate" → override rates + distance
  6. global distance-based rates
  7. legacy ring zone.fee + zone.perKm when global rates are both zero

Driving distance is required for distance-based fees. Straight-line distance is never
substituted for a driving route. When routing is unavailable, apply the configured
fallback policy only.
"""
from __future__ import annotations

import logging
import math
import os
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import httpx

from municipalities import (
    CATALOGUE,
    municipality_by_id,
    normalize_custom_municipalities,
    normalize_municipality_ids,
    resolve_municipality,
)

log = logging.getLogger(__name__)

CALC_VERSION = 1
POLICIES = ("distance", "fixed", "custom_rate", "free")
ROUNDING = ("cent", "dollar", "none")
FALLBACKS = ("manual_review", "fixed", "zero")
DEPARTURE_MODES = ("clinic", "center", "custom")

DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/{profile}/{a};{b}"


def _money(value: float) -> float:
    from money import dollars, to_cents
    return dollars(to_cents(value))


def _finite_point(lat, lng) -> dict | None:
    try:
        la = float(lat)
        lo = float(lng)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(la) and math.isfinite(lo)):
        return None
    if not (-90 <= la <= 90 and -180 <= lo <= 180):
        return None
    return {"lat": la, "lng": lo}


def _nonneg(value, default=0.0) -> float:
    try:
        n = float(value if value is not None else default)
    except (TypeError, ValueError):
        n = float(default)
    if not math.isfinite(n) or n < 0:
        return 0.0
    return n


def _optional_nonneg(value):
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n) or n < 0:
        return None
    return n


def representative_point(muni_id: str) -> dict | None:
    """Documented representative location: centroid of the CSD coverage box."""
    from municipalities import _BOUNDS  # intentional: same module source of truth
    box = _BOUNDS.get(str(muni_id or ""))
    if not box:
        return None
    south, west, north, east = box
    return {"lat": round((south + north) / 2, 6), "lng": round((west + east) / 2, 6)}


def normalize_departure(raw, clinic=None, center=None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("mode") if raw.get("mode") in DEPARTURE_MODES else "clinic"
    point = _finite_point(raw.get("lat"), raw.get("lng"))
    line = " ".join(str(raw.get("line") or "").split())[:160]
    mapbox_id = str(raw.get("mapboxId") or "")[:120]
    out = {"mode": mode, "lat": None, "lng": None, "line": line, "mapboxId": mapbox_id}
    if mode == "custom" and point:
        out["lat"] = point["lat"]
        out["lng"] = point["lng"]
    return out


def resolve_departure(settings) -> dict:
    """Return {lat, lng, source, provisional} for fee routing."""
    settings = settings or {}
    cov = (settings.get("serviceCoverage") or {}) if isinstance(settings.get("serviceCoverage"), dict) else {}
    fees = cov.get("travelFees") if isinstance(cov.get("travelFees"), dict) else {}
    dep = fees.get("departure") if isinstance(fees.get("departure"), dict) else {}
    mode = dep.get("mode") if dep.get("mode") in DEPARTURE_MODES else "clinic"
    clinic = settings.get("clinic") or {}
    center = settings.get("center") or {}

    if mode == "custom":
        point = _finite_point(dep.get("lat"), dep.get("lng"))
        if point:
            return {**point, "source": "custom", "provisional": False, "line": dep.get("line") or ""}

    if mode in ("clinic", "custom"):
        if clinic.get("coordinatesVerified") and _finite_point(clinic.get("lat"), clinic.get("lng")):
            point = _finite_point(clinic.get("lat"), clinic.get("lng"))
            return {**point, "source": "clinic", "provisional": False, "line": clinic.get("address") or ""}

    point = _finite_point(center.get("lat"), center.get("lng"))
    if point:
        return {**point, "source": "center", "provisional": True, "line": "Service area center"}

    # Last resort documented clinic default (Edmonton downtown) — always provisional.
    return {"lat": 53.5461, "lng": -113.4938, "source": "default", "provisional": True, "line": "Default service center"}


def normalize_override(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    policy = raw.get("policy") if raw.get("policy") in POLICIES else "distance"
    out = {
        "policy": policy,
        "fixedFee": _optional_nonneg(raw.get("fixedFee")),
        "baseFee": _optional_nonneg(raw.get("baseFee")),
        "perKm": _optional_nonneg(raw.get("perKm")),
        "freeKm": _optional_nonneg(raw.get("freeKm")),
        "maxFee": _optional_nonneg(raw.get("maxFee")),
    }
    if policy == "fixed" and out["fixedFee"] is None:
        out["fixedFee"] = 0.0
    return out


def normalize_travel_fees(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    rounding = raw.get("rounding") if raw.get("rounding") in ROUNDING else "cent"
    fallback = raw.get("fallbackPolicy") if raw.get("fallbackPolicy") in FALLBACKS else "manual_review"
    overrides_in = raw.get("municipalityOverrides") if isinstance(raw.get("municipalityOverrides"), dict) else {}
    overrides = {}
    for key, value in list(overrides_in.items())[:80]:
        mid = str(key or "").strip()
        if not mid:
            continue
        norm = normalize_override(value)
        if norm:
            overrides[mid] = norm
    max_fee = _optional_nonneg(raw.get("maxFee"))
    return {
        "baseFee": _nonneg(raw.get("baseFee"), 0),
        "perKm": _nonneg(raw.get("perKm"), 0),
        "freeKm": _nonneg(raw.get("freeKm"), 0),
        "maxFee": max_fee,
        "rounding": rounding,
        "departure": normalize_departure(raw.get("departure")),
        "fallbackPolicy": fallback,
        "fallbackFixedFee": _nonneg(raw.get("fallbackFixedFee"), 0),
        "municipalityOverrides": overrides,
    }


def apply_rounding(amount: float, mode: str) -> float:
    if mode == "none":
        return float(amount)
    if mode == "dollar":
        return float(Decimal(str(amount)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return _money(amount)


def launch_travel_fees() -> dict:
    return normalize_travel_fees({
        "baseFee": 0,
        "perKm": 0,
        "freeKm": 0,
        "maxFee": None,
        "rounding": "cent",
        "departure": {"mode": "clinic"},
        "fallbackPolicy": "manual_review",
        "fallbackFixedFee": 0,
        "municipalityOverrides": {},
    })


async def driving_distance_km(origin: dict, dest: dict) -> dict:
    """Return driving distance from Mapbox Directions. Never fabricates a distance.

    Result: {ok, km, provider, error}
    """
    origin_pt = _finite_point(origin.get("lat"), origin.get("lng"))
    dest_pt = _finite_point(dest.get("lat"), dest.get("lng"))
    if not origin_pt or not dest_pt:
        return {"ok": False, "km": None, "provider": None, "error": "location_unresolved"}
    token = os.environ.get("MAPBOX_TOKEN") or ""
    if not token:
        return {"ok": False, "km": None, "provider": None, "error": "routing_unconfigured"}
    last_error = "routing_unavailable"
    async with httpx.AsyncClient(timeout=8) as client:
        for profile, label in (("driving", "mapbox-driving"), ("driving-traffic", "mapbox-traffic")):
            try:
                response = await client.get(
                    DIRECTIONS_URL.format(
                        profile=profile,
                        a=f"{origin_pt['lng']},{origin_pt['lat']}",
                        b=f"{dest_pt['lng']},{dest_pt['lat']}",
                    ),
                    params={"access_token": token, "overview": "false"},
                )
                if response.status_code in (401, 403, 429):
                    return {"ok": False, "km": None, "provider": None, "error": "routing_unavailable"}
                response.raise_for_status()
                routes = response.json().get("routes") or []
                if not routes:
                    last_error = "routing_empty"
                    continue
                km = round(float(routes[0]["distance"]) / 1000.0, 3)
                return {"ok": True, "km": km, "provider": label, "error": None}
            except Exception as exc:
                last_error = "routing_unavailable"
                log.warning("Travel-fee directions %s failed: %s", profile, exc)
    return {"ok": False, "km": None, "provider": None, "error": last_error}


def _cap_and_round(fee: float, max_fee, rounding: str) -> float:
    if max_fee is not None:
        fee = min(fee, float(max_fee))
    if fee < 0:
        fee = 0.0
    return apply_rounding(fee, rounding)


def calculate_travel_fee(
    *,
    settings,
    location_type: str,
    driving_km: float | None,
    municipality_id: str | None = None,
    zone: dict | None = None,
    route_ok: bool = True,
    route_error: str | None = None,
) -> dict:
    """Authoritative travel fee. Client-submitted amounts are ignored by callers."""
    from pricing import travel_fees_enabled

    result = {
        "fee": 0.0,
        "calcVersion": CALC_VERSION,
        "policy": "disabled",
        "status": "disabled",
        "drivingKm": None,
        "billableKm": None,
        "municipalityId": municipality_id,
        "binding": True,
        "estimated": False,
        "message": "",
        "routeError": route_error,
        "breakdown": {},
    }
    if location_type == "clinic":
        result.update(policy="clinic", status="clinic", message="In-clinic visits have no travel fee.")
        return result
    if not travel_fees_enabled(settings):
        result["message"] = "Travel fees are turned off."
        return result

    cov = (settings or {}).get("serviceCoverage") or {}
    fees = normalize_travel_fees(cov.get("travelFees"))
    rounding = fees["rounding"]
    override = None
    mid = str(municipality_id or "") or None
    if mid and mid in fees["municipalityOverrides"]:
        override = fees["municipalityOverrides"][mid]
    elif zone and zone.get("municipalityId"):
        mid = str(zone.get("municipalityId"))
        override = fees["municipalityOverrides"].get(mid)
        result["municipalityId"] = mid

    if override and override.get("policy") == "free":
        result.update(
            policy="free",
            status="ok",
            fee=0.0,
            binding=True,
            message="Travel is free for this municipality.",
            breakdown={"policy": "free"},
        )
        return result

    if override and override.get("policy") == "fixed":
        fee = _cap_and_round(float(override.get("fixedFee") or 0), override.get("maxFee", fees["maxFee"]), rounding)
        result.update(
            fee=fee,
            policy="fixed",
            status="ok",
            binding=True,
            message="Fixed municipality travel fee.",
            breakdown={"policy": "fixed", "fixedFee": fee},
        )
        return result

    # Distance-based (global or custom_rate). Requires a real driving route.
    if not route_ok or driving_km is None:
        fallback = fees["fallbackPolicy"]
        if fallback == "zero":
            result.update(
                policy="fallback_zero",
                status="route_unavailable",
                fee=0.0,
                binding=True,
                message="Driving route unavailable. Configured fallback: no travel fee.",
            )
            return result
        if fallback == "fixed":
            fee = _cap_and_round(fees["fallbackFixedFee"], fees["maxFee"], rounding)
            result.update(
                policy="fallback_fixed",
                status="route_unavailable",
                fee=fee,
                binding=True,
                message="Driving route unavailable. Configured fallback fixed fee applied.",
                breakdown={"fallbackFixedFee": fee},
            )
            return result
        result.update(
            policy="manual_review",
            status="needs_review",
            fee=0.0,
            binding=False,
            message="Driving route unavailable. Travel fee needs review before it is binding.",
        )
        return result

    km = float(driving_km)
    if override and override.get("policy") == "custom_rate":
        base = float(override["baseFee"] if override.get("baseFee") is not None else fees["baseFee"])
        per_km = float(override["perKm"] if override.get("perKm") is not None else fees["perKm"])
        free_km = float(override["freeKm"] if override.get("freeKm") is not None else fees["freeKm"])
        max_fee = override["maxFee"] if override.get("maxFee") is not None else fees["maxFee"]
        policy = "custom_rate"
    else:
        base = float(fees["baseFee"])
        per_km = float(fees["perKm"])
        free_km = float(fees["freeKm"])
        max_fee = fees["maxFee"]
        policy = "distance"
        # Legacy ring fees when the new global rates are unused.
        if base == 0 and per_km == 0 and zone:
            base = float(zone.get("fee") or 0)
            per_km = float(zone.get("perKm") or 0)
            if base or per_km:
                policy = "legacy_zone"

    billable = max(0.0, km - free_km)
    raw_fee = base + per_km * billable
    fee = _cap_and_round(raw_fee, max_fee, rounding)
    result.update(
        fee=fee,
        policy=policy,
        status="ok",
        drivingKm=round(km, 3),
        billableKm=round(billable, 3),
        binding=True,
        message="Travel fee from driving distance.",
        breakdown={
            "baseFee": base,
            "perKm": per_km,
            "freeKm": free_km,
            "maxFee": max_fee,
            "drivingKm": round(km, 3),
            "billableKm": round(billable, 3),
            "rounding": rounding,
        },
    )
    return result


async def quote_address_travel(*, settings, point, zone, location_type="home", place_hint="") -> dict:
    """Resolve municipality, obtain driving distance, and calculate the fee."""
    from pricing import travel_fees_enabled

    if location_type == "clinic" or not travel_fees_enabled(settings):
        return calculate_travel_fee(
            settings=settings, location_type=location_type or "home",
            driving_km=None, zone=zone, route_ok=True,
        )

    cov = (settings or {}).get("serviceCoverage") or {}
    custom = normalize_custom_municipalities(cov.get("customMunicipalities"))
    muni = resolve_municipality(point, custom=custom, place_hint=place_hint)
    muni_id = (muni or {}).get("id") or (zone or {}).get("municipalityId")
    departure = resolve_departure(settings)
    route = await driving_distance_km(departure, point)
    calc = calculate_travel_fee(
        settings=settings,
        location_type=location_type,
        driving_km=route["km"] if route["ok"] else None,
        municipality_id=muni_id,
        zone=zone,
        route_ok=bool(route["ok"]),
        route_error=route.get("error"),
    )
    calc["departure"] = {
        "lat": departure["lat"],
        "lng": departure["lng"],
        "source": departure["source"],
        "provisional": bool(departure.get("provisional")),
        "line": departure.get("line") or "",
    }
    calc["routeProvider"] = route.get("provider")
    calc["estimated"] = bool(departure.get("provisional")) and calc.get("status") == "ok"
    if calc["estimated"]:
        calc["message"] = (
            "Provisional travel fee — departure location is not a confirmed clinic base. "
            "Shown before confirmation; not labeled as an exact route charge."
        )
    if muni:
        calc["municipality"] = {"id": muni.get("id"), "name": muni.get("name"), "type": muni.get("type") or ""}
    return calc


async def municipality_fee_estimates(settings) -> list[dict]:
    """Estimated fees for each selected municipality (and custom places)."""
    from pricing import service_coverage, travel_fees_enabled

    cov = service_coverage(settings)
    fees_on = travel_fees_enabled(settings)
    selected = normalize_municipality_ids(cov.get("municipalityIds"))
    custom = normalize_custom_municipalities(cov.get("customMunicipalities"))
    departure = resolve_departure(settings)
    rows = []

    async def one(muni_id: str, name: str, point: dict | None, covered: bool, kind: str):
        row = {
            "municipalityId": muni_id,
            "name": name,
            "kind": kind,
            "covered": covered,
            "representative": point,
            "estimate": None,
            "status": "disabled" if not fees_on else ("unavailable" if not point else "pending"),
            "message": "Travel fees are off." if not fees_on else (
                "No representative location." if not point else "Estimate"
            ),
            "estimated": True,
            "disclaimer": "Estimate only — not a guaranteed charge for a specific address.",
        }
        if not fees_on or not point:
            rows.append(row)
            return
        route = await driving_distance_km(departure, point)
        if not route["ok"]:
            row.update(status="unavailable", message="Driving estimate unavailable from the routing provider.")
            rows.append(row)
            return
        calc = calculate_travel_fee(
            settings=settings,
            location_type="home",
            driving_km=route["km"],
            municipality_id=muni_id if kind == "catalogue" else None,
            zone={"municipalityId": muni_id} if kind == "catalogue" else None,
            route_ok=True,
        )
        row.update(
            status="ok",
            estimate=calc["fee"],
            drivingKm=calc.get("drivingKm"),
            policy=calc.get("policy"),
            message=f"Estimated fee ${calc['fee']:.2f} for ~{calc.get('drivingKm')} km driving.",
            calc=calc,
            routeProvider=route.get("provider"),
            departure={
                "source": departure["source"],
                "provisional": departure.get("provisional"),
                "line": departure.get("line") or "",
            },
        )
        rows.append(row)

    catalogue_ids = {r["id"] for r in CATALOGUE}
    for mid in selected:
        meta = municipality_by_id(mid) or {"id": mid, "name": mid}
        point = representative_point(mid) if mid in catalogue_ids else None
        await one(mid, meta.get("name") or mid, point, True, "catalogue")

    for item in custom:
        point = _finite_point(item.get("lat"), item.get("lng"))
        await one(item["id"], item.get("name") or "Custom", point, True, "custom")

    return rows


def travel_fee_settings_patch_allowed(incoming: dict, *, full_coverage: bool) -> dict:
    """Managers with pricing permission may only change travel-fee keys."""
    if full_coverage:
        return incoming
    allowed = {}
    if "travelFeesEnabled" in incoming:
        allowed["travelFeesEnabled"] = incoming["travelFeesEnabled"]
    if "travelFees" in incoming:
        allowed["travelFees"] = incoming["travelFees"]
    return allowed


def can_manage_pricing(user) -> bool:
    from rbac import has_strict_role, has_role
    if has_strict_role(user, "owner"):
        return True
    caps = user.get("capabilities") or []
    perms = user.get("staffPerms") or {}
    if has_role(user, "manager") and ("managePricing" in caps or perms.get("managePricing") is True):
        return True
    return False


def validate_travel_fees_config(fees: dict) -> None:
    """Raise ValueError on invalid owner configuration."""
    fees = normalize_travel_fees(fees)
    if fees["baseFee"] > 500:
        raise ValueError("Base travel fee cannot exceed $500")
    if fees["perKm"] > 50:
        raise ValueError("Per-kilometre fee cannot exceed $50")
    if fees["freeKm"] > 200:
        raise ValueError("Free travel distance cannot exceed 200 km")
    if fees["maxFee"] is not None and fees["maxFee"] > 1000:
        raise ValueError("Maximum travel fee cannot exceed $1000")
    if fees["fallbackPolicy"] == "fixed" and fees["fallbackFixedFee"] > 500:
        raise ValueError("Fallback fixed fee cannot exceed $500")
    for mid, ov in fees["municipalityOverrides"].items():
        if ov.get("fixedFee") is not None and ov["fixedFee"] > 500:
            raise ValueError(f"Fixed fee for {mid} cannot exceed $500")
        if ov.get("perKm") is not None and ov["perKm"] > 50:
            raise ValueError(f"Per-km rate for {mid} cannot exceed $50")
