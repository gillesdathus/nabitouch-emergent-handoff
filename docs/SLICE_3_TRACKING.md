# Slice 3 — Live tracking

This note describes how Nabitouch shares a practitioner's position during one appointment. It is an engineering record. It is not a certification under PIPEDA, Alberta's Personal Information Protection Act, or any other privacy law.

## What is collected

A precise location is collected only after the assigned practitioner chooses **Start location sharing** for an appointment that is already on the way. The browser asks for permission. Updates continue only while that page stays open and the phone allows location. A locked phone or a browser that suspends the page can pause updates. Nabitouch does not promise background tracking.

The server keeps one latest position for that appointment in Redis. It does not keep a trail of where the practitioner has been, and it does not write GPS coordinates into MongoDB. The practitioner's home or base address is not included in the client or guest view.

Sharing stops when the practitioner arrives, stops it manually, pauses it, or when the appointment is cancelled or reassigned. The Redis key also expires on its own.

## Who can see it

- The assigned practitioner can start, pause, stop, and publish a position for that appointment only.
- The client on the appointment can see the live position while sharing is on.
- A guest booking receives one link, valid for two hours, for that appointment only. The raw token is shown once. Redis stores a hash of it. Arrival, cancellation, reassignment, and interruption delete it.
- The owner can see the operational position for an active shared trip.
- Reception sees an ETA by default. A precise position is included only when the reception permission `viewLocations` is on. Turning that permission off hides coordinates on the next read.
- Another practitioner, another client, and a logged-out visitor cannot read or change the session.

An estimate from Mapbox, or a straight-line fallback when Mapbox is unavailable, is labeled as an estimate. It is not a promised arrival time.

## Redis keys

All keys use the prefix `nt:trk:` and expire. Redis is not a location archive.

| Key | Contents | TTL |
| --- | --- | --- |
| `nt:trk:fix:{appointmentId}` | One hash: monotonic `seq` and the latest fix | 120 seconds, refreshed on an accepted fix, a heartbeat, or a resume |
| `nt:trk:ev` | Short event list. Payloads do not include coordinates or a route | 900 seconds, capped at 200 events |
| `nt:trk:ch:{appointmentId}` | Pub/sub wake-up with a cursor and event type only | none (no payload retained) |
| `nt:trk:cap:{sha256}` | Guest capability: appointment id only | 7200 seconds |
| `nt:trk:caps:{appointmentId}` | Set of capability hashes so they can be revoked together | 7200 seconds |
| `nt:trk:eta:{appointmentId}` | Last route summary used to avoid repeat Mapbox calls | 45 seconds |
| `nt:trk:gs:{sha256}` | Browser session for a guest link. The cookie is not the capability token | 1800 seconds |
| `nt:trk:gss:{appointmentId}` | Browser-session hashes so a revoke clears them | 7200 seconds |
| `nt:trk:rl:{bucket}` | Rate-limit counter | 60 seconds |

A Lua compare-and-set stores a fix only when its sequence number is newer. Duplicate and older updates are rejected. Reassignment and cancellation delete the fix and the guest capability before the appointment record changes.

## API

Authenticated routes use the existing session cookie or bearer token. Guest routes use the capability token in the path. Do not log that path.

- `POST /api/tracking/sessions/{id}/start` — assigned practitioner, status `en_route`
- `POST /api/tracking/sessions/{id}/stop`
- `POST /api/tracking/sessions/{id}/pause` and `/resume`
- `POST /api/tracking/sessions/{id}/heartbeat`
- `POST /api/tracking/sessions/{id}/locations` — one fix; rejected when paused, stale, inaccurate, out of order, or not the assigned practitioner
- `GET /api/tracking/sessions/{id}` — authorized view. `position` is present only while sharing is live
- `GET /api/tracking/sessions/{id}/stream` — Server-Sent Events for an authorized participant. The server checks the session again as the appointment changes
- `POST /api/tracking/guest/open` — body `{token}`. Sets an httpOnly cookie and returns the view. The token is not placed in the URL.
- `GET /api/tracking/guest/session` and `/stream` — the same view for that cookie
- `GET /api/tracking/active` — owner and reception
- `GET /api/tracking/events` — no coordinates in the stored events

Session JSON includes `phase`, an ETA when allowed, and `confirmedArrival: false`.

| Phase | Meaning | Precise position |
| --- | --- | --- |
| `live` | Sharing is on and the latest signal is fresh | included |
| `stale` | Sharing is on and the latest signal is older than 30 seconds | last point only |
| `expired` | Sharing is on and the Redis session has lapsed | omitted |
| `stopped` | The practitioner stopped sharing while still on the way | omitted |
| `unavailable` | The trip is on the way and sharing has not started | omitted |
| `paused` | Sharing is paused | omitted |
| `arrived` | The practitioner marked arrival | omitted |
| `completed` | The visit has moved past arrival | omitted |
| `ended` | The appointment was cancelled or marked a no-show | omitted |

## Guest links, logs, and caches

The page address is `/track#…`. The fragment is not sent to the server, so an access log of the HTML request does not contain the capability. The browser then posts the token once. Later reads use the httpOnly cookie. Tracking responses send `Cache-Control: no-store`, `Pragma: no-cache`, and `Referrer-Policy: no-referrer`. The guest map is drawn locally and does not call Mapbox.

A reverse proxy in front of Nabitouch should do the same, and it should not write the raw request target for tracking routes into an access log:

```nginx
map $request_uri $nabitouch_request {
    ~*^/api/tracking/guest/  $request_method /api/tracking/guest/ [redacted];
    default                  $request;
}
log_format nabitouch '$remote_addr - $remote_user [$time_local] '
                     '"$nabitouch_request" $status $body_bytes_sent';
server {
    # Use this format for the public site. Do not log $http_cookie or $request_body.
    access_log /var/log/nginx/access.log nabitouch;
    add_header Referrer-Policy "no-referrer" always;
    location /track { add_header Cache-Control "no-store" always; }
    location /api/tracking/ {
        proxy_pass http://nabitouch;
        add_header Cache-Control "no-store" always;
        add_header Referrer-Policy "no-referrer" always;
    }
}
```

The application also rewrites any leftover `/api/tracking/guest/{capability}` path in the Uvicorn access record. Do not add a debug logger that prints request bodies.

## Redis authentication, TLS, and limits

Production `REDIS_URL` must use `rediss://` and include a password. Development may use a local `redis://` instance without TLS. The app does not fall back to memory when Redis is down: precise-location reads and writes return 503, and a new booking still completes. Appointment transitions still save. Reassignment does not commit a new practitioner when the tracking session cannot be revoked.

Rate limits, each per minute: 20 sharing starts for a practitioner, 40 location updates for an appointment, and 30 guest reads for an IP address.

## What is not stored

An accepted GPS fix is not copied onto the appointment document, into an audit action, or into the tracking event ring. Logs pass through a filter that removes `lat` and `lng` values and long token strings. A demo seed may mark one trip as sharing in development. In production that flag is forced off unless the assigned practitioner started sharing.

## Alberta and Canadian privacy

Precise location is personal information. Nabitouch uses it for the limited purpose of showing that a practitioner is travelling to a booked visit. Collection starts only when that practitioner turns sharing on. The information is kept for the length of the trip, then the ephemeral key expires or is deleted. It is not added to the treatment record.

Access is limited to the people involved in that visit and to staff whose role still includes that operational need. Reception can be limited to an ETA without a precise point. A guest link is appointment-scoped and short-lived.

This design is meant to support a privacy review. It does not by itself mean the clinic complies with PIPEDA or Alberta PIPA. A review still has to cover consent wording, retention of the rest of the client record, access requests, and the hosting agreement.

## Required environment

Production startup requires `REDIS_URL` with `rediss://` and a password. Development and tests need a Redis URL as well whenever tracking or appointment transitions run. `MAPBOX_TOKEN` remains optional; without it, ETAs are straight-line estimates. Do not put a secret Mapbox token in the frontend.
