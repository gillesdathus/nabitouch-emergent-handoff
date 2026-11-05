"""City of Edmonton civic address locator fallback.

Mapbox often lags new Edmonton construction. The City of Edmonton Address Locator
is authoritative for in-city PointAddress matches and returns WGS84 when outSR=4326.
Rural / non-Edmonton destinations stay on Mapbox.
"""
from __future__ import annotations

import re
from urllib.parse import urlencode

import httpx

from addresses import POSTAL, normalize_rural_query, parse_civic

LOCATOR = (
    "https://gis.edmonton.ca/site1/rest/services/Geocoder/"
    "CoE_Address_Locator/GeocodeServer/findAddressCandidates"
)
PROVIDER = "edmonton"
ID_PREFIX = "edmonton:"
POINT_TYPES = {"PointAddress", "Subaddress"}
MIN_POINT_SCORE = 90.0
# Other municipalities must not be forced through the City of Edmonton locator.
_OTHER_CITY = re.compile(
    r"\b(Ardrossan|Sherwood\s+Park|St\.?\s*Albert|Spruce\s+Grove|Leduc|Beaumont|"
    r"Fort\s+Saskatchewan|Stony\s+Plain|Devon|Morinville|Gibbons|Calmar|Winfield|"
    r"Wetaskiwin|Camrose|Red\s+Deer|Calgary)\b",
    re.I,
)


def edmonton_place_id(line: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(line or "").casefold()).strip("-")
    return f"{ID_PREFIX}{slug[:120]}"


def strip_for_edmonton_query(line: str) -> str:
    """Edmonton GIS rejects queries that include province/postal/country tails."""
    text = normalize_rural_query(line)
    if not text:
        return ""
    text = POSTAL.sub(" ", text)
    text = re.sub(r",?\s*\bCanada\b\.?", " ", text, flags=re.I)
    text = re.sub(r",?\s*\bAlberta\b\.?", " ", text, flags=re.I)
    text = re.sub(r",?\s*\bAB\b\.?", " ", text, flags=re.I)
    parts = [part.strip(" ,") for part in text.split(",") if part.strip(" ,")]
    if not parts:
        return ""
    head = parts[0]
    city = parts[1] if len(parts) > 1 else ""
    if city and "edmonton" in city.casefold():
        return f"{head}, Edmonton"
    if any("edmonton" in part.casefold() for part in parts[1:]):
        return f"{head}, Edmonton"
    return head


def looks_like_edmonton_civic(line: str) -> bool:
    """True for Edmonton-style civic searches that the CoE locator can help with."""
    text = normalize_rural_query(line)
    if len(text) < 5:
        return False
    if _OTHER_CITY.search(text):
        return False
    if "edmonton" in text.casefold():
        return bool(parse_civic(text).get("number"))
    civic = parse_civic(text)
    # Numbered Edmonton grid streets carry a cardinal direction (NW/NE/SW/SE).
    return bool(civic.get("number") and civic.get("direction") and civic.get("type"))


def _candidate_hit(candidate: dict) -> dict | None:
    attrs = candidate.get("attributes") or {}
    location = candidate.get("location") or {}
    try:
        lng = float(location.get("x"))
        lat = float(location.get("y"))
        score = float(candidate.get("score") if candidate.get("score") is not None else attrs.get("Score") or 0)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    addr_type = str(attrs.get("Addr_type") or "")
    label = (
        candidate.get("address")
        or attrs.get("LongLabel")
        or attrs.get("Match_addr")
        or attrs.get("Place_addr")
        or ""
    )
    label = " ".join(str(label).split())
    if not label:
        return None
    if "edmonton" not in label.casefold():
        label = f"{label}, Edmonton"
    postal = str(attrs.get("Postal") or "").strip()
    area = str(attrs.get("Nbrhd") or attrs.get("City") or "Edmonton").strip() or "Edmonton"
    # PointAddress is precise; StreetName / other types are only approximate cues.
    if addr_type in POINT_TYPES and score >= MIN_POINT_SCORE:
        confidence = "exact"
    elif score >= 70:
        confidence = "medium"
    else:
        confidence = "low"
    return {
        "id": edmonton_place_id(label),
        "line": label,
        "area": area.title() if area.isupper() else area,
        "lat": lat,
        "lng": lng,
        "provider": PROVIDER,
        "postal": postal,
        "matchConfidence": confidence,
        "score": score,
        "addrType": addr_type,
    }


def civic_suggestion_compatible(query: str, hit_line: str) -> bool:
    """Drop autocomplete hits that change the house number the client typed."""
    requested = parse_civic(normalize_rural_query(query))
    civic = parse_civic(hit_line or "")
    req_num = str(requested.get("number") or "").casefold()
    hit_num = str(civic.get("number") or "").casefold()
    if req_num and hit_num and req_num != hit_num:
        return False
    return True


async def find_candidates(query: str, *, limit: int = 5) -> list:
    text = strip_for_edmonton_query(query)
    if len(text) < 5:
        return []
    params = {
        "SingleLine": text,
        "f": "json",
        "outSR": 4326,
        "maxLocations": max(1, min(int(limit), 5)),
        "outFields": "Match_addr,LongLabel,AddNum,StName,StType,StDir,City,Postal,Addr_type,Score,Nbrhd",
    }
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            response = await client.get(LOCATOR, params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError, TypeError):
        return []
    hits = []
    for candidate in payload.get("candidates") or []:
        hit = _candidate_hit(candidate)
        if not hit:
            continue
        if not civic_suggestion_compatible(query, hit["line"]):
            continue
        # Only surface precise PointAddress rows in autocomplete / resolve.
        if hit.get("addrType") not in POINT_TYPES or hit.get("score", 0) < MIN_POINT_SCORE:
            continue
        hits.append(hit)
        if len(hits) >= limit:
            break
    return hits


async def resolve_place(line: str = "", place_id: str = "") -> dict | None:
    """Resolve an Edmonton place id or civic line to a precise PointAddress hit."""
    place_id = str(place_id or "")
    if place_id.startswith(ID_PREFIX):
        # Re-query from the slug-derived street text when possible; fall back to line.
        slug = place_id[len(ID_PREFIX):].replace("-", " ")
        query = line or slug
    else:
        query = line
    hits = await find_candidates(query, limit=3)
    if not hits:
        return None
    if place_id.startswith(ID_PREFIX):
        exact = next((item for item in hits if item["id"] == place_id), None)
        if exact:
            return exact
    return hits[0]


def debug_url(query: str) -> str:
    """Test helper — never logs tokens (Edmonton GIS is public)."""
    return f"{LOCATOR}?{urlencode({'SingleLine': strip_for_edmonton_query(query), 'f': 'json', 'outSR': 4326})}"
