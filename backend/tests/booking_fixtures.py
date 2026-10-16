"""Synthetic Edmonton bookings for isolated tests.

These addresses match the sample catalog in geo.py. They include a postal code
so classify() can accept them. They do not skip zone checks, confirmation, or
the postal rules. Live Mapbox calls stay behind MAPBOX_LIVE=true.
"""

EDMONTON_HOME = {
    "label": "Home",
    "line": "10150 104 St NW, Edmonton, AB T5J 1A7, Canada",
    "postal": "T5J 1A7",
    "mapboxId": "local-downtown",
    "lat": 53.5435,
    "lng": -113.499,
    "id": "ad-sarah",
    "clientConfirmed": True,
}

LEDUC_OUTSIDE = {
    "label": "Outside",
    "line": "4950 Gateway Blvd, Leduc, AB",
    "postal": "T9E 0A1",
    "mapboxId": "local-leduc",
    "lat": 53.2594,
    "lng": -113.5492,
    "clientConfirmed": True,
}
