"""Owner-managed municipality coverage for the Edmonton CMA and nearby Alberta CSDs.

Identifiers use Statistics Canada Standard Geographical Classification (SGC) 2021
census subdivision (CSD) codes. Boundaries are simplified axis-aligned coverage
boxes ordered so cities/towns resolve before containing municipal districts.

Sherwood Park is a community inside Strathcona County (CSD 4811052), not a CSD.
Source: StatCan SGC 2021 variant for CMA 48835 Edmonton.
"""
from __future__ import annotations

import math
import re
from typing import Any

# (south, west, north, east) — WGS84 degrees. Cities/towns before counties.
_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    # East edge kept west of Sherwood Park so Strathcona County owns that community.
    "4811061": (53.395, -113.715, 53.676, -113.318),  # Edmonton
    "4811062": (53.598, -113.690, 53.675, -113.560),  # St. Albert
    "4811049": (53.515, -113.960, 53.575, -113.850),  # Spruce Grove
    "4811048": (53.500, -114.050, 53.565, -113.960),  # Stony Plain
    "4811016": (53.235, -113.600, 53.305, -113.480),  # Leduc
    "4811013": (53.330, -113.455, 53.385, -113.375),  # Beaumont
    "4811056": (53.680, -113.270, 53.750, -113.150),  # Fort Saskatchewan
    "4811018": (53.340, -113.760, 53.385, -113.690),  # Devon
    "4811068": (53.780, -113.680, 53.825, -113.610),  # Morinville
    "4811064": (53.820, -113.350, 53.850, -113.310),  # Gibbons
    "4811066": (53.820, -113.430, 53.850, -113.390),  # Bon Accord
    "4811069": (53.930, -113.620, 53.960, -113.570),  # Legal
    "4811019": (53.250, -113.830, 53.285, -113.780),  # Calmar
    "4810066": (53.735, -112.950, 53.760, -112.910),  # Bruderheim
    "4811065": (53.930, -113.140, 53.970, -113.080),  # Redwater
    "4811046": (53.515, -114.150, 53.535, -114.120),  # Spring Lake
    "4811021": (53.220, -114.070, 53.245, -114.030),  # Thorsby
    "4811024": (53.175, -114.300, 53.200, -114.260),  # Warburg
    "4811052": (53.400, -113.317, 53.720, -112.850),  # Strathcona County (incl. Sherwood Park)
    "4811034": (53.350, -115.200, 53.750, -113.850),  # Parkland County
    "4811012": (53.100, -114.200, 53.400, -113.200),  # Leduc County (excludes Wetaskiwin)
    "4811059": (53.650, -114.100, 54.100, -113.100),  # Sturgeon County
    "4811804": (53.480, -113.820, 53.560, -113.720),  # Enoch Cree Nation
}

_MATCH_ORDER = [
    "4811061", "4811062", "4811049", "4811048", "4811016", "4811013",
    "4811056", "4811018", "4811068", "4811064", "4811066", "4811069",
    "4811019", "4810066", "4811065", "4811046", "4811021", "4811024",
    "4811804", "4811052", "4811034", "4811012", "4811059",
]

CATALOGUE: list[dict[str, Any]] = [
    {"id": "4811061", "name": "Edmonton", "type": "City", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811062", "name": "St. Albert", "type": "City", "region": "Edmonton CMA", "aliases": ["St Albert"]},
    {"id": "4811049", "name": "Spruce Grove", "type": "City", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811048", "name": "Stony Plain", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811016", "name": "Leduc", "type": "City", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811013", "name": "Beaumont", "type": "City", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811056", "name": "Fort Saskatchewan", "type": "City", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811018", "name": "Devon", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811068", "name": "Morinville", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {
        "id": "4811052",
        "name": "Strathcona County",
        "type": "Specialized municipality",
        "region": "Edmonton CMA",
        "aliases": ["Sherwood Park"],
        "communities": ["Sherwood Park"],
        "note": "Sherwood Park is a community within Strathcona County, not a separate municipality.",
    },
    {"id": "4811034", "name": "Parkland County", "type": "Municipal district", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811012", "name": "Leduc County", "type": "Municipal district", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811059", "name": "Sturgeon County", "type": "Municipal district", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811064", "name": "Gibbons", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811066", "name": "Bon Accord", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811069", "name": "Legal", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811019", "name": "Calmar", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4810066", "name": "Bruderheim", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811065", "name": "Redwater", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811046", "name": "Spring Lake", "type": "Village", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811021", "name": "Thorsby", "type": "Town", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811024", "name": "Warburg", "type": "Village", "region": "Edmonton CMA", "aliases": []},
    {"id": "4811804", "name": "Enoch Cree Nation", "type": "Indian reserve", "region": "Edmonton CMA", "aliases": ["Enoch"]},
]

_BY_ID = {row["id"]: row for row in CATALOGUE}


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def catalogue_public() -> list[dict[str, Any]]:
    """Owner selector payload — identifiers and labels only (no raw geometry)."""
    rows = []
    for item in CATALOGUE:
        rows.append({
            "id": item["id"],
            "csdUid": item["id"],
            "name": item["name"],
            "type": item["type"],
            "region": item.get("region") or "",
            "aliases": list(item.get("aliases") or []),
            "communities": list(item.get("communities") or []),
            "note": item.get("note") or "",
            "source": "statcan_sgc_2021",
        })
    return rows


def known_municipality_ids() -> set[str]:
    return set(_BY_ID)


def municipality_by_id(muni_id: str) -> dict[str, Any] | None:
    row = _BY_ID.get(str(muni_id or ""))
    return dict(row) if row else None


def _in_box(lat: float, lng: float, box: tuple[float, float, float, float]) -> bool:
    south, west, north, east = box
    return south <= lat <= north and west <= lng <= east


def _haversine_km(a: dict, b: dict) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, [a["lat"], a["lng"], b["lat"], b["lng"]])
    hav = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(hav))


def resolve_municipality(point: dict, custom: list | None = None, place_hint: str = "") -> dict[str, Any] | None:
    """Return the covering municipality for a geocoded point."""
    try:
        lat = float(point["lat"])
        lng = float(point["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng):
        return None

    for muni_id in _MATCH_ORDER:
        box = _BOUNDS.get(muni_id)
        if not box or muni_id not in _BY_ID:
            continue
        if _in_box(lat, lng, box):
            row = dict(_BY_ID[muni_id])
            hint = _norm(place_hint)
            communities = [_norm(c) for c in (row.get("communities") or []) + (row.get("aliases") or [])]
            if hint and hint in communities:
                row["matchedCommunity"] = place_hint
            row["match"] = "csd_bounds"
            return row

    for item in custom or []:
        if not isinstance(item, dict):
            continue
        try:
            clat = float(item["lat"])
            clng = float(item["lng"])
            radius = float(item.get("radiusKm") if item.get("radiusKm") is not None else 12)
        except (KeyError, TypeError, ValueError):
            continue
        if radius < 0:
            continue
        km = _haversine_km({"lat": lat, "lng": lng}, {"lat": clat, "lng": clng})
        if km <= radius:
            return {
                "id": str(item.get("id") or ""),
                "name": str(item.get("name") or "Custom location"),
                "type": "Custom",
                "match": "custom_radius",
                "mapboxId": item.get("mapboxId") or "",
                "csdUid": item.get("csdUid") or "",
            }
    return None


def municipality_selected(muni: dict | None, selected_ids: list | set) -> bool:
    if not muni:
        return False
    allowed = {str(x) for x in (selected_ids or []) if x}
    if not allowed:
        return False
    mid = str(muni.get("id") or "")
    if mid in allowed:
        return True
    csd = str(muni.get("csdUid") or "")
    return bool(csd and csd in allowed)


def normalize_custom_municipalities(raw) -> list[dict[str, Any]]:
    rows = []
    if not isinstance(raw, list):
        return rows
    for item in raw[:40]:
        if not isinstance(item, dict):
            continue
        name = " ".join(str(item.get("name") or "").split())[:80]
        mapbox_id = str(item.get("mapboxId") or "")[:120]
        try:
            lat = float(item["lat"])
            lng = float(item["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        try:
            radius = float(item.get("radiusKm") if item.get("radiusKm") is not None else 12)
        except (TypeError, ValueError):
            radius = 12.0
        radius = max(1.0, min(80.0, radius))
        mid = str(item.get("id") or mapbox_id or f"custom:{name}:{lat:.4f}:{lng:.4f}")[:160]
        csd = str(item.get("csdUid") or "").strip()
        if csd and csd not in known_municipality_ids() and not csd.startswith("custom"):
            if not re.fullmatch(r"\d{7}", csd):
                csd = ""
        rows.append({
            "id": mid,
            "name": name or "Custom location",
            "mapboxId": mapbox_id,
            "lat": lat,
            "lng": lng,
            "radiusKm": radius,
            "csdUid": csd,
            "source": str(item.get("source") or "mapbox_place")[:40],
        })
    return rows


def normalize_municipality_ids(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    known = known_municipality_ids()
    out = []
    seen = set()
    for item in raw:
        mid = str(item or "").strip()
        if not mid or mid in seen:
            continue
        if mid in known or re.fullmatch(r"\d{7}", mid) or mid.startswith("custom:"):
            seen.add(mid)
            out.append(mid)
    return out[:80]
