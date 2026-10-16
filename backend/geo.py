"""Address search for Edmonton mobile visits.

Mapbox is called only when MAPBOX_TOKEN is set. Results stay in memory for a few
minutes and are not written to MongoDB. The booking stores the address the client
chose, which is the visit location, not a geocoding archive.
"""
import os
import time
from urllib.parse import urlencode

import httpx

EDMONTON = (-113.4938, 53.5461)
BBOX = "-114.2,53.15,-112.8,53.8"
FORWARD = "https://api.mapbox.com/search/geocode/v6/forward"
REVERSE = "https://api.mapbox.com/search/geocode/v6/reverse"
CACHE_SECONDS = 600
SUGGEST_LIMIT = 40
CHECK_LIMIT = 20

# Same Edmonton-area samples the booking demo used before geocoding. Leduc sits outside the 25 km outer zone.
LOCAL = [
    {"id": "local-downtown", "line": "10150 104 St NW, Edmonton, AB", "area": "Downtown", "lat": 53.5435, "lng": -113.499},
    {"id": "local-downtown-2", "line": "10222 102 St NW, Edmonton, AB", "area": "Downtown", "lat": 53.5445, "lng": -113.4935},
    {"id": "local-garneau", "line": "11135 83 Ave NW, Edmonton, AB", "area": "Garneau", "lat": 53.519, "lng": -113.517},
    {"id": "local-strathcona", "line": "9620 83 Ave NW, Edmonton, AB", "area": "Strathcona", "lat": 53.518, "lng": -113.473},
    {"id": "local-westmount", "line": "12520 102 Ave NW, Edmonton, AB", "area": "Westmount", "lat": 53.5431, "lng": -113.5363},
    {"id": "local-terwillegar", "line": "5320 Terwillegar Blvd NW, Edmonton, AB", "area": "Terwillegar", "lat": 53.462, "lng": -113.585},
    {"id": "local-west-ed", "line": "8882 170 St NW, Edmonton, AB", "area": "West Edmonton", "lat": 53.5225, "lng": -113.6235},
    {"id": "local-clareview", "line": "13650 50 St NW, Edmonton, AB", "area": "Clareview", "lat": 53.6015, "lng": -113.4135},
    {"id": "local-sherwood", "line": "2020 Sherwood Dr, Sherwood Park, AB", "area": "Sherwood Park", "lat": 53.5413, "lng": -113.2958},
    {"id": "local-stalbert", "line": "1 St Anne St, St. Albert, AB", "area": "St. Albert", "lat": 53.6305, "lng": -113.6256},
    {"id": "local-leduc", "line": "4950 Gateway Blvd, Leduc, AB", "area": "Leduc", "lat": 53.2594, "lng": -113.5492},
]


class GeocodeError(Exception):
    """The address could not be resolved. Safe to show to the client."""


class ProviderError(Exception):
    """Mapbox failed or refused. The message must not include the token or the request URL."""


class RateLimit(ProviderError):
    pass


def allow(bucket, key, limit, window=60):
    now = time.time()
    hits = [stamp for stamp in bucket.get(key, []) if now - stamp < window]
    if len(hits) >= limit:
        bucket[key] = hits
        return False
    hits.append(now)
    bucket[key] = hits
    if len(bucket) > 5000:
        bucket.clear()
    return True


def _token():
    return os.environ.get("MAPBOX_TOKEN") or ""


def sample_catalog():
    """Isolated tests may opt into the Edmonton samples. The running app does not."""
    return os.environ.get("GEO_SAMPLE_CATALOG") == "true" and os.environ.get("APP_ENV", "development").strip().lower() != "production"


MAPBOX_REQUIRED = "Address search needs a Mapbox token. Add MAPBOX_TOKEN to this environment. Sample addresses are not offered."


def _norm(value):
    return " ".join(str(value or "").lower().split())


def _local_by_id(place_id):
    return next((dict(item) for item in LOCAL if item["id"] == place_id), None)


def _local_match(line):
    key = _norm(line)
    if not key:
        return None
    exact = next((item for item in LOCAL if _norm(item["line"]) == key), None)
    if exact:
        return dict(exact)
    partial = [item for item in LOCAL if key in _norm(item["line"]) or key in _norm(item["area"])]
    if len(partial) == 1:
        return dict(partial[0])
    return None


def _feature(feature):
    props = feature.get("properties") or {}
    coords = (feature.get("geometry") or {}).get("coordinates") or [None, None]
    label = props.get("full_address") or props.get("name") or ""
    place = ((props.get("context") or {}).get("place") or {}).get("name") or ""
    if coords[0] is None or not label:
        return None
    return {"id": props.get("mapbox_id") or label, "line": label, "area": place, "lng": float(coords[0]), "lat": float(coords[1]), "provider": "mapbox"}


class Geocoder:
    def __init__(self):
        self.cache = {}
        self.bucket = {}

    def reset(self):
        self.cache.clear()
        self.bucket.clear()

    def _cached(self, key):
        hit = self.cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
        return None

    def _store(self, key, value):
        self.cache[key] = (time.time() + CACHE_SECONDS, value)
        if len(self.cache) > 500:
            self.cache.clear()
            self.cache[key] = (time.time() + CACHE_SECONDS, value)

    async def fetch(self, url, params):
        try:
            async with httpx.AsyncClient(timeout=6) as client:
                response = await client.get(url, params=params)
        except httpx.HTTPError as exc:
            raise ProviderError("Address search is unavailable right now. Try again shortly.") from exc
        if response.status_code in (401, 403, 429):
            raise ProviderError("Address search is unavailable right now. Try again shortly.")
        try:
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Address search is unavailable right now. Try again shortly.") from exc

    async def suggest(self, query, client_key):
        text = " ".join(str(query or "").split())
        if len(text) < 3:
            return []
        if not allow(self.bucket, f"suggest:{client_key}", SUGGEST_LIMIT):
            raise RateLimit("Too many address lookups. Wait a moment and try again.")
        cached = self._cached(("suggest", _norm(text)))
        if cached is not None:
            return cached
        if not _token():
            if not sample_catalog():
                raise ProviderError(MAPBOX_REQUIRED)
            key = _norm(text)
            hits = [dict(item, provider="local") for item in LOCAL if key in _norm(item["line"]) or key in _norm(item["area"])]
            hits.sort(key=lambda item: (0 if "Edmonton" in item["line"] else 1, item["line"]))
            self._store(("suggest", key), hits[:5])
            return hits[:5]
        payload = await self.fetch(FORWARD, {
            "q": text, "access_token": _token(), "country": "ca", "types": "address", "limit": 5,
            "proximity": f"{EDMONTON[0]},{EDMONTON[1]}", "bbox": BBOX, "autocomplete": "true",
        })
        hits = [item for item in (_feature(feature) for feature in payload.get("features") or []) if item]
        self._store(("suggest", _norm(text)), hits)
        return hits

    async def resolve(self, line="", mapbox_id="", point=None):
        """Return the coordinates used for zone and fee decisions. Client coordinates lose when a place resolves."""
        place_id = str(mapbox_id or "")
        if place_id.startswith("local-") and sample_catalog():
            hit = _local_by_id(place_id)
            if not hit:
                raise GeocodeError("That address could not be found. Choose a suggestion or enter the street and city.")
            hit["provider"] = "local"
            return hit
        text = " ".join(str(line or "").split())
        if _token() and (place_id or text):
            cached = self._cached(("resolve", place_id or _norm(text)))
            if cached:
                return cached
            params = {"access_token": _token(), "country": "ca", "types": "address", "limit": 1, "proximity": f"{EDMONTON[0]},{EDMONTON[1]}"}
            if place_id and not text:
                params["q"] = place_id
            else:
                params["q"] = text
            payload = await self.fetch(FORWARD, params)
            hits = [item for item in (_feature(feature) for feature in payload.get("features") or []) if item]
            if not hits:
                raise GeocodeError("We couldn't find that address. Check the street and city, or pick a suggestion.")
            self._store(("resolve", place_id or _norm(text)), hits[0])
            return hits[0]
        if sample_catalog():
            local = _local_by_id(place_id) if place_id else None
            local = local or _local_match(text)
            if local:
                local["provider"] = "local"
                return local
        if not _token():
            raise ProviderError(MAPBOX_REQUIRED)
        if point and point.get("lat") is not None and point.get("lng") is not None:
            return {"id": "", "line": text or "Pinned location", "area": "", "lat": float(point["lat"]), "lng": float(point["lng"]), "provider": "device"}
        raise GeocodeError("We couldn't find that address. Pick a suggestion, or enter the street and city.")

    async def reverse(self, lat, lng):
        if not _token():
            raise ProviderError(MAPBOX_REQUIRED)
        payload = await self.fetch(REVERSE, {"longitude": lng, "latitude": lat, "access_token": _token(), "types": "address", "limit": 1})
        hits = [item for item in (_feature(feature) for feature in payload.get("features") or []) if item]
        if not hits:
            raise GeocodeError("We couldn't place that location on a street address.")
        return hits[0]


GEO = Geocoder()


def debug_url(url, params):
    """Used only by tests to prove tokens are not required in logged URLs. Not called from request handlers."""
    safe = {key: value for key, value in params.items() if key != "access_token"}
    return f"{url}?{urlencode(safe)}"
