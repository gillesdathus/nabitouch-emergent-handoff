#!/usr/bin/env python3
"""Live public API slot probe for Nabitu weekly windows. No booking created."""
import json
import urllib.error
import urllib.request

BASE = "https://nabitouch.com/api"
MAPBOX = "dXJuOm1ieGFkcjpmNzUzNzZiMC03OTVlLTQ3YmMtYTJlOS01ZDA4YmY2Yjg1MTU"
ADDR = {
    "line": "53337 Range Road 215, Ardrossan, Alberta T8E 2B2, Canada",
    "lat": 53.591591,
    "lng": -113.073364,
    "mapboxId": MAPBOX,
    "postal": "T8E 2B2",
    "clientConfirmed": True,
    "confidence": "address",
}

# Next matching weekly windows after the P0 date (America/Edmonton).
# Tuesday=1 09:00-21:00, Saturday=5 18:00-21:00, Sunday=6 18:00-21:00.
DAYS = (
    ("2026-11-10", "Tuesday", "09:00", "21:00"),
    ("2026-11-07", "Saturday", "18:00", "21:00"),
    ("2026-11-08", "Sunday", "18:00", "21:00"),
)


def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"detail": raw}


def main():
    code, confirm = post(
        "/geo/confirm",
        {
            "line": ADDR["line"],
            "mapboxId": MAPBOX,
            "postal": "T8E 2B2",
            "clientConfirmed": True,
        },
    )
    print(
        "CONFIRM",
        code,
        {
            key: confirm.get(key)
            for key in (
                "eligible",
                "accepted",
                "confidence",
                "km",
                "travel",
                "travelFeesEnabled",
                "line",
                "zone",
            )
        },
    )
    if not (isinstance(confirm, dict) and confirm.get("accepted") and confirm.get("eligible")):
        raise SystemExit("address not accepted")

    address = {
        **ADDR,
        "line": confirm.get("line") or ADDR["line"],
        "lat": confirm.get("lat") or ADDR["lat"],
        "lng": confirm.get("lng") or ADDR["lng"],
        "mapboxId": confirm.get("mapboxId") or MAPBOX,
        "confidence": confirm.get("confidence") or "address",
        "clientConfirmed": True,
    }

    ready = True
    for day, label, window_start, window_end in DAYS:
        code, body = post(
            "/availability/recommendations",
            {
                "serviceSlug": "swedish",
                "duration": 60,
                "date": day,
                "locationType": "home",
                "address": address,
            },
        )
        times = [row.get("time") for row in (body.get("slots") or [])]
        in_window = [t for t in times if t and window_start <= t < window_end]
        print(
            "REC",
            label,
            day,
            code,
            {
                "count": len(times),
                "inWindow": len(in_window),
                "window": f"{window_start}-{window_end}",
                "first": times[:8],
                "last": times[-5:],
                "travelFee": body.get("travelFee"),
                "zone": body.get("zone"),
                "note": body.get("unavailableNote") or "",
                "practitionerId": body.get("practitionerId"),
            },
        )
        if code != 200 or not in_window:
            ready = False

    print("SLOTS_READY", ready)
    if not ready:
        raise SystemExit("eligible slots missing for one or more weekly windows")


if __name__ == "__main__":
    main()
