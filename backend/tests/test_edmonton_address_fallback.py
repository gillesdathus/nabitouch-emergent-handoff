"""Edmonton GIS fallback for new civic addresses Mapbox misses."""
import asyncio
from unittest.mock import AsyncMock

import pytest

from addresses import classify, client_address_message, parse_civic
from edmonton_geo import (
    civic_suggestion_compatible,
    looks_like_edmonton_civic,
    strip_for_edmonton_query,
)
from geo import Geocoder


CRYSTALLINA = "6805 176A Avenue NW, Edmonton, AB T5Z 0Y2, Canada"
CRYSTALLINA_HIT = {
    "id": "edmonton:6805-176a-avenue-nw-edmonton",
    "line": "6805 176a Avenue NW, Edmonton",
    "area": "Crystallina Nera East",
    "lat": 53.639658,
    "lng": -113.444838,
    "provider": "edmonton",
    "postal": "",
    "matchConfidence": "exact",
    "score": 100,
    "addrType": "PointAddress",
}


def test_parse_preserves_alphanumeric_street_suffix_variants():
    for line in (
        "6805 176A Avenue NW, Edmonton, AB T5Z 0Y2",
        "6805 176A Ave NW, Edmonton, AB",
        "6805 176a Avenue NW, Edmonton",
    ):
        parsed = parse_civic(line)
        assert parsed["number"] == "6805"
        assert parsed["street"].casefold() == "176a"
        assert parsed["direction"] == "NW"


def test_edmonton_query_strips_postal_province_country():
    assert strip_for_edmonton_query(CRYSTALLINA) == "6805 176A Avenue NW, Edmonton"
    assert looks_like_edmonton_civic(CRYSTALLINA) is True
    assert looks_like_edmonton_civic("53337 Rge Rd 215, Ardrossan") is False


def test_suggestion_filter_rejects_wrong_house_number():
    assert civic_suggestion_compatible(
        "6805 176A Avenue NW, Edmonton",
        "176a 2 Avenue, Winfield, Alberta T0C 2X0, Canada",
    ) is False
    assert civic_suggestion_compatible(
        "6805 176A Avenue NW, Edmonton",
        "6805 176a Avenue NW, Edmonton",
    ) is True


def test_edmonton_provider_classifies_with_supplied_postal():
    assessed = classify(CRYSTALLINA_HIT, CRYSTALLINA, "T5Z 0Y2")
    assert assessed["confidence"] == "address"
    assert assessed["postalStatus"] == "supplied"
    assert assessed["civic"]["number"] == "6805"
    assert assessed["civic"]["street"].casefold() == "176a"


def test_street_substitution_still_requires_review():
    hit = {**CRYSTALLINA_HIT, "line": "6805 176 Avenue NW, Edmonton", "provider": "mapbox"}
    assessed = classify(hit, CRYSTALLINA, "T5Z 0Y2")
    assert assessed["confidence"] == "review"
    assert assessed["reviewReason"] == "street_mismatch"
    assert "exact match" in client_address_message(assessed).lower() or "review" in client_address_message(assessed).lower()


def test_postal_conflict_message_is_plain_language():
    hit = {**CRYSTALLINA_HIT, "postal": "T5Z 0Y2", "line": CRYSTALLINA, "provider": "mapbox"}
    assessed = classify(hit, CRYSTALLINA, "T5S 1A1")
    assert assessed["postalStatus"] == "conflict"
    assert "postal" in client_address_message(assessed).lower()


def test_suggest_falls_back_to_edmonton_when_mapbox_is_empty_or_mismatched(monkeypatch):
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.synthetic-only")
    monkeypatch.setenv("MAPBOX_PERMANENT_GEOCODING", "false")
    geo = Geocoder()
    calls = []

    async def fetch(url, params):
        calls.append(params)
        # Pretend Mapbox only returns a Winfield near-miss.
        return {
            "features": [{
                "geometry": {"coordinates": [-114.4, 53.0]},
                "properties": {
                    "mapbox_id": "winfield-bad",
                    "full_address": "176a 2 Avenue, Winfield, Alberta T0C 2X0, Canada",
                    "context": {"place": {"name": "Winfield"}, "postcode": {"name": "T0C 2X0"}},
                    "match_code": {"confidence": "high"},
                },
            }]
        }

    geo.fetch = fetch
    monkeypatch.setattr(
        "geo.edmonton_find",
        AsyncMock(return_value=[dict(CRYSTALLINA_HIT)]),
    )

    hits = asyncio.run(geo.suggest("6805 176A Avenue NW, Edmonton, AB T5Z 0Y2", "test-client"))
    assert calls, "Mapbox should still be attempted first"
    assert hits and hits[0]["provider"] == "edmonton"
    assert "6805" in hits[0]["line"]
    assert "176a" in hits[0]["line"].casefold()


def test_resolve_uses_edmonton_place_id_without_mapbox_storage(monkeypatch):
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.synthetic-only")
    monkeypatch.setenv("MAPBOX_PERMANENT_GEOCODING", "false")
    geo = Geocoder()
    monkeypatch.setattr(
        "geo.edmonton_resolve",
        AsyncMock(return_value=dict(CRYSTALLINA_HIT)),
    )
    hit = asyncio.run(geo.resolve(
        line=CRYSTALLINA,
        mapbox_id=CRYSTALLINA_HIT["id"],
        persist=True,
    ))
    assert hit["provider"] == "edmonton"
    assert hit["lat"] == pytest.approx(53.639658, abs=1e-5)


def test_bbox_retry_then_edmonton_when_mapbox_returns_nothing(monkeypatch):
    monkeypatch.setenv("MAPBOX_TOKEN", "pk.synthetic-only")
    geo = Geocoder()
    calls = []

    async def fetch(url, params):
        calls.append("bbox" in params)
        return {"features": []}

    geo.fetch = fetch
    monkeypatch.setattr(
        "geo.edmonton_find",
        AsyncMock(return_value=[dict(CRYSTALLINA_HIT)]),
    )
    hits = asyncio.run(geo.suggest("6805 176A Ave NW, Edmonton", "client"))
    assert calls == [True, False], "first call uses bbox; second retries without bbox"
    assert hits[0]["id"].startswith("edmonton:")
