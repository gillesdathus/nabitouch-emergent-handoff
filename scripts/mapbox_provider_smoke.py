"""Opt-in REAL Mapbox contract smoke; no database, booking, delivery or payment.

Run in the API Python environment with --env-file pointing to a protected local
Mapbox-only env file. Output is coarse evidence, never tokens/addresses/coordinates.
This does not certify application booking, browser or physical navigation.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


async def run():
    from geo import Geocoder, permanent_geocoding
    from tracking import MapboxDirections
    token = os.environ.get("MAPBOX_TOKEN", "")
    if not token.startswith(("pk.", "sk.")) or not permanent_geocoding():
        print("BLOCKED: Mapbox server token and confirmed permanent-geocoding permission required")
        return 2
    geo = Geocoder()
    # Public civic/commercial locations, never a customer or practitioner's home.
    suggestions = await geo.suggest("1 Sir Winston Churchill Square, Edmonton", "operator-smoke")
    assert suggestions and all(x["provider"] == "mapbox" for x in suggestions)
    origin = await geo.resolve(mapbox_id=suggestions[0]["id"])
    dest = await geo.resolve(line="8882 170 Street NW, Edmonton, Alberta")
    outside = await geo.resolve(line="100 Queen Street West, Toronto, Ontario")
    route = await MapboxDirections()._fetch("driving-traffic", origin, dest, token)
    assert route["distance"] > 0 and route["duration"] > 0 and route["geometry"]["coordinates"]
    assert 53 < origin["lat"] < 54 and 43 < outside["lat"] < 45
    print(json.dumps({"provider": "mapbox", "externalCalls": "genuine HTTPS",
        "autocomplete": "PASS", "selectedIdResolution": "PASS", "outsideCityResolution": "PASS",
        "directions": "PASS", "distanceMetres": round(route["distance"]),
        "durationSeconds": round(route["duration"]),
        "applicationBookingBrowserNavigationAcceptance": "NOT RUN"}))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True)
    args = parser.parse_args()
    from dotenv import dotenv_values
    values = dotenv_values(args.env_file)
    for key in ("MAPBOX_TOKEN", "MAPBOX_PERMANENT_GEOCODING"):
        os.environ[key] = values.get(key) or ""
    os.environ["GEO_SAMPLE_CATALOG"] = "false"
    try:
        return asyncio.run(run())
    except Exception:
        # HTTP exception repr/tracebacks can contain full token-bearing URLs.
        print("FAIL: real Mapbox smoke did not complete; inspect provider access/configuration securely")
        return 1


if __name__ == "__main__":
    sys.exit(main())
