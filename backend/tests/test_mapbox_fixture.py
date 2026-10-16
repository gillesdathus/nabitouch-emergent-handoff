"""The recorded route adapter never runs in production and never calls Mapbox."""
from auth import blocks_demo_account
from mapbox_fixture import fixture_mode, recorded_drive


def test_fixture_is_off_unless_explicit(monkeypatch):
    monkeypatch.delenv("MAPBOX_FIXTURE_MODE", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    assert fixture_mode() == ""
    assert recorded_drive({"lat": 53.54, "lng": -113.49}, {"lat": 53.52, "lng": -113.50}) is None


def test_production_ignores_the_fixture(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MAPBOX_FIXTURE_MODE", "recorded")
    assert fixture_mode() == ""
    assert recorded_drive({"lat": 53.54, "lng": -113.49}, {"lat": 53.52, "lng": -113.50}) is None


def test_recorded_route_and_failure(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("MAPBOX_FIXTURE_MODE", "recorded")
    assert recorded_drive({"lat": 53.54, "lng": -113.49}, {"lat": 53.52, "lng": -113.50}) == (12, "mapbox")
    monkeypatch.setenv("MAPBOX_FIXTURE_MODE", "fail")
    assert recorded_drive({"lat": 53.54, "lng": -113.49}, {"lat": 53.52, "lng": -113.50}) == (None, "unavailable")


def test_production_refuses_demo_accounts():
    assert blocks_demo_account({"demo": True}, True) is True
    assert blocks_demo_account({"demo": True}, False) is False
    assert blocks_demo_account({"demo": False}, True) is False
    assert blocks_demo_account(None, True) is False
