"""Isolated provider-contract regressions; never external Mapbox acceptance."""
import asyncio
import logging

import httpx
import pytest

from addresses import classify
from geo import Geocoder, ProviderError, RateLimit, _feature
from redact import AccessPathRedact, RedactLogFilter
from tracking import MapboxDirections


def feature(confidence="exact"):
    return {"geometry": {"coordinates": [-113.49, 53.54]}, "properties": {
        "mapbox_id": "provider-address", "full_address": "10150 104 St NW, Edmonton, AB",
        "context": {"postcode": {"name": "T5J 2R4"}}, "match_code": {"confidence": confidence}}}


@pytest.mark.parametrize("postal", ["T5S 1A1", "junk T5J 2R4", "V5J 2R4"])
def test_provider_postcode_and_strict_alberta_input_require_review(postal):
    hit = _feature(feature())
    assert classify(hit, hit["line"], postal)["confidence"] == "review"
    assert classify(hit, hit["line"], "t5j2r4")["postalStatus"] == "match"


def test_low_confidence_and_invalid_provider_coordinates_are_not_verified():
    hit = _feature(feature("low"))
    assert classify(hit, hit["line"], "T5J 2R4")["confidence"] == "review"
    bad = feature(); bad["geometry"]["coordinates"] = [float("nan"), 53]
    assert _feature(bad) is None


def test_temporary_geocodes_are_not_cached_or_used_for_stored_visits(monkeypatch):
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.synthetic-only")
    monkeypatch.setenv("MAPBOX_PERMANENT_GEOCODING", "false")
    geo = Geocoder(); calls = []
    async def fetch(url, params):
        calls.append(params); return {"features": [feature()]}
    geo.fetch = fetch
    async def run():
        await geo.suggest("10150", "synthetic")
        await geo.suggest("10150", "synthetic")
        assert len(calls) == 2 and all(p["permanent"] == "false" for p in calls)
        assert geo.cache == {}
        with pytest.raises(ProviderError, match="storage configuration"):
            await geo.resolve(line="10150 104 St NW, Edmonton")
    asyncio.run(run())


def test_confirmation_resolves_selected_id_with_storage_permission(monkeypatch):
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.synthetic-only")
    monkeypatch.setenv("MAPBOX_PERMANENT_GEOCODING", "true")
    geo = Geocoder()
    async def fetch(url, params):
        assert params["q"] == "provider-address" and params["permanent"] == "true"
        assert params["autocomplete"] == "false"
        return {"features": [feature()]}
    geo.fetch = fetch
    assert asyncio.run(geo.resolve(line="untrusted edited label", mapbox_id="provider-address"))["provider"] == "mapbox"


@pytest.mark.parametrize("failure", [429, 503, "timeout"])
def test_geocoder_outages_are_safe_and_rate_limit_has_cooldown(monkeypatch, failure):
    calls = []
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params):
            calls.append(url)
            if failure == "timeout": raise httpx.ReadTimeout("private request details")
            return httpx.Response(failure, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    geo = Geocoder()
    async def run():
        for _ in range(2):
            with pytest.raises(ProviderError) as caught:
                await geo.fetch("https://api.mapbox.com/private-address", {"access_token": "sk.private"})
            assert "private" not in str(caught.value)
        assert len(calls) == (1 if failure == 429 else 2)
    asyncio.run(run())


def test_eta_cache_is_invalidated_when_destination_changes(monkeypatch):
    import tracking
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.synthetic-only")
    async def cached(_): return None
    async def save(*args): pass
    monkeypatch.setattr(tracking, "cache_get", cached)
    monkeypatch.setattr(tracking, "cache_set", save)
    directions = MapboxDirections(); calls = []
    async def fetch(profile, origin, dest, token):
        calls.append(dest); return {"distance": 4200, "duration": 540, "geometry": {"coordinates": []}}
    directions._fetch = fetch
    async def run():
        origin = {"lat": 53.54, "lng": -113.5}
        dest = {"lat": 53.55, "lng": -113.49}
        await directions.eta("same-trip", origin, dest)
        await directions.eta("same-trip", origin, dest)
        await directions.eta("same-trip", origin, {**dest, "lng": -113.6})
        assert len(calls) == 2
    asyncio.run(run())


def test_mapbox_request_and_address_search_logging_are_redacted():
    record = logging.LogRecord("httpx", logging.INFO, "", 0,
        'GET https://api.mapbox.com/directions/v5/-113.49,53.54?access_token=pk.secret', (), None)
    RedactLogFilter().filter(record)
    assert "pk.secret" not in record.msg and "53.54" not in record.msg
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s %s %s %s %s",
        ("local", "GET", "/api/geo/suggest?q=private+address", "1.1", 200), None)
    AccessPathRedact().filter(record)
    assert record.args[2] == "/api/geo/suggest"


def test_directions_quota_error_stops_repeated_profile_requests(monkeypatch):
    calls = []
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, params):
            calls.append(url)
            return httpx.Response(429, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    directions = MapboxDirections()
    async def run():
        for profile in ("driving-traffic", "driving"):
            with pytest.raises(RuntimeError, match="unavailable"):
                await directions._fetch(profile, {"lat": 53.54, "lng": -113.5}, {"lat": 53.55, "lng": -113.49}, "sk.private")
        assert len(calls) == 1
    asyncio.run(run())
