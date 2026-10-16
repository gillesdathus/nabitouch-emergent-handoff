import asyncio

import pytest
from geo import Geocoder, ProviderError


def test_local_id_cannot_replace_production_geocoding(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("GEO_SAMPLE_CATALOG", "true")
    monkeypatch.delenv("MAPBOX_TOKEN", raising=False)
    with pytest.raises(ProviderError):
        asyncio.run(Geocoder().resolve(mapbox_id="local-downtown"))
    with pytest.raises(ProviderError):
        asyncio.run(Geocoder().suggest("Edmonton", "qa"))


def test_sample_id_is_available_only_with_explicit_nonproduction_opt_in(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("MAPBOX_TOKEN", raising=False)
    monkeypatch.delenv("GEO_SAMPLE_CATALOG", raising=False)
    with pytest.raises(ProviderError):
        asyncio.run(Geocoder().resolve(mapbox_id="local-downtown"))
    monkeypatch.setenv("GEO_SAMPLE_CATALOG", "true")
    assert asyncio.run(Geocoder().resolve(mapbox_id="local-downtown"))["provider"] == "local"
