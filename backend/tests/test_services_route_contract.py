"""Public service catalogue route contract used by ops probes and optional clients."""
from pathlib import Path


def test_server_defines_get_services_route():
    text = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    assert '@api.get("/services")' in text
    assert "async def services_catalogue" in text


def test_catalogue_public_filter_exported():
    from catalog import catalogue_public, list_services

    assert callable(catalogue_public)
    assert callable(list_services)
