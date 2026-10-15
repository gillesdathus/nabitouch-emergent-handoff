# Nabitouch Live — Phase 1: GPS Integration Foundation

## 1. Existing architecture review
- **Frontend**: React (JavaScript) PWA with four role shells. Shared state comes from `DemoStore`, which polls `/api/state` every 2.5 s.
- **Backend**: FastAPI + MongoDB acting as a mock server. It holds a single appointment lifecycle (`server.apply_transition`) with a `trip` sub-document, plus `payments.py` as the Stripe/insurer mock adapter.
- **Existing simulated tracking**:
  - `lib/domain.tripState()` replays a Bezier route over about 150 s (it acts as the mock RouteProvider and ETAService).
  - `components/LiveMap.jsx` draws a stylised SVG map with pan and zoom.
  - `LiveTrack.jsx` is the client view; `ops/Dispatch.jsx` is the owner/reception board.
- **Authentication and permissions**: demo role bar only. Receptionist permissions live in `settings.receptionPerms`. Before Phase 1 they were enforced in the frontend only.

## 2. Gap analysis

| Need | Before | Phase 1 |
|---|---|---|
| Server-side tracking API with authorization | none | `backend/tracking.py` (`/api/tracking/*`) |
| Location ingest validation | none | Checks: ownership, active trip, seq order, clock skew, accuracy |
| Event contracts | none | 12 typed events, versioned, server-timestamped (`/api/tracking/contracts`) |
| Stale / connection state | none | `ageSec`/`stale` per session; Dispatch shows live/stale signal |
| Provider boundaries | logic tied to UI | `lib/tracking/providers.js` + Python Protocols |
| Tests | none | `backend/tests/test_tracking.py` |

**Decision**: keep FastAPI and do not add a Node.js/TypeScript service yet. A second backend would duplicate the appointment and permission model. The interfaces below map one-to-one to a later Node/Socket.IO service if you want to scale out.

## 3. Tracking architecture

```
Practitioner app ──LocationProvider──▶ POST /tracking/sessions/{appt}/locations
   (sim | browser GPS | Capacitor bg)        │ validate (auth ↔ appointment, en_route, seq, skew, accuracy)
                                              ▼
                     LocationStore (latest fix only, in-memory → Redis TTL)
                     ETAService ◀─ RouteProvider (mock → Mapbox Directions, server-side)
                                              ▼
                     RealtimeTransport (ring buffer + poll → Socket.IO rooms per appointment)
                                              ▼
            Client (own appointment, en_route only) · Owner (all) · Reception (per permission)
Lifecycle transitions (single model) ──on_transition──▶ events + drop precise fix + NotificationService
```

**Interfaces (`backend/tracking.py`)**

| Interface | Mock implementation (Phase 1) | Production boundary |
|---|---|---|
| `RouteProvider` | `MockRouteProvider` | Mapbox Directions `driving-traffic` |
| `ETAService` | `MockETAService` | Directions duration, refreshed on deviation; Matrix API for assignment |
| `LocationStore` | `InMemoryLocationStore` | Redis (TTL 2 min) |
| `RealtimeTransport` | `InMemoryTransport` | Socket.IO with JWT handshake and per-appointment rooms |
| `NotificationService` | `LogNotificationService` | Web Push / APNs / FCM |
| `LocationAuthorizationService` | role + appointment + permission checks, made on every request | same checks, server-side |
| `GeofenceService` | existing zone radius check | PostGIS polygons (`ST_Contains`) |
| `LocationProvider` (frontend) | `simulated`, `browser` | Capacitor plugin |

Revoking a permission takes effect on the next request.

## 4. Event model
- **Event types**: `trip.started`, `location.updated`, `eta.updated`, `trip.delayed`, `practitioner.arrived`, `tracking.paused`, `tracking.resumed`, `tracking.stopped`, `session.started`, `session.ended`, `practitioner.departed`, `visit.completed`.
- **Fields**: `{id, type, version:1, appointmentId, practitionerId, serverTime, payload, audience}`.
- **Server rules**:
  - `serverTime` is always set by the server.
  - Appointment ownership is looked up on the server; the client's claim is never trusted.
  - Location fixes are accepted only while `status=en_route` and `trip.sharing=true`.
  - Thresholds: fixes older than 120 s are stale; accuracy worse than 150 m is "poor" unless the fix is flagged approximate; a fix with no update for more than 30 s marks the session stale.
  - Out-of-order fixes (seq ≤ last) are rejected.

## 5. GPS rules implemented / prepared
- **Update rate**: one fix every 5 s during active travel (`TRACKING_RULES.intervalMs`).
- **Error codes**: denied, unavailable, timeout and approximate are surfaced through `onError`.
- **Offline**: the app keeps only the latest unsent fix and sends it again when the connection returns.
- **When tracking stops**: the latest fix is dropped as soon as the visit leaves `en_route`, including arrival, cancellation and interruption.
- **No tracking** during treatment or off duty. Off-duty practitioners are excluded from the active list.
- **App closed unexpectedly**: the session goes stale after 30 s and Dispatch shows a "Signal stale" indicator.

## 6. Mapbox preparation
- **Settings in `.env`, not in code**: `REACT_APP_TRACKING_MODE` (`simulated` by default) and `REACT_APP_MAPBOX_PUBLIC_TOKEN` (URL-restricted public token).
- **Secret token**: Mapbox Directions and Matrix calls must be proxied by the backend, using a server-side `MAPBOX_SECRET_TOKEN`.
- **Not active yet**: `mapboxRouteProvider` is a stub until you approve.
- **Map rendering swap**: replace the `LiveMap` internals with Mapbox GL JS (`mapbox-gl`). Keep the same props (markers, routes, destinations) so pages don't change.

## 7. Permission integration
- **Reception permissions**: viewLocations, viewEta, viewAddresses, assign, createBooking (manage schedules), viewHistory. These are now enforced in the tracking API: session view, active list and event stream.
- **Still frontend-only**: the remaining REST endpoints (generic PATCH, bookings, payments). Phase 2 must add JWT authentication and server-side RBAC to every endpoint.

## 8. Capacitor migration plan (practitioner app)
1. Wrap the existing practitioner PWA with Capacitor 6 (iOS and Android shells). The same React build is reused.
2. Implement `LocationProvider` with a background plugin.

**Candidate plugins (not installed):**

| Plugin | Licence / cost | Strengths | Trade-offs |
|---|---|---|---|
| Transistorsoft `capacitor-background-geolocation` | commercial (Android release licence) | best battery motion detection, geofencing, offline SQLite queue, HTTP batching | licence cost |
| `@capacitor-community/background-geolocation` | MIT | simple | weaker battery handling; no geofencing |
| `@capgo/background-geolocation` | open source | alternative | smaller community |

3. **Permissions**: request "While Using" first and "Always" only if needed. Show a clear purpose string ("Shares your location with your client only during work trips"). Android needs a foreground-service notification during trips.
4. **App store**: Apple requires location to be essential to the feature; Google Play needs the background location declaration and a review video.
5. **Native geofencing** on the client address triggers an "arrival suggested" prompt. The practitioner still confirms "I've Arrived".

## 9. Security and privacy (design)
- **Tokens**: short-lived (≤ 2 h) tracking tokens scoped to one appointment.
- **Transport**: TLS/WSS only.
- **Audit**: trip start and stop are written to the audit log.
- **Retention**: no precise GPS history. Only the latest fix is kept (TTL), plus arrival/departure timestamps on the appointment. Trip summaries are retained per the retention policy.
- **Compliance**: Canadian PIPEDA and Alberta PIPA/HIA review is required before live use. The client address is health-adjacent data, so it needs encryption at rest.

## 10. External services needed (estimates; check current pricing)
- **Mapbox**: GL JS map loads, Directions and Matrix, with a usage cap. At a small scale this is likely within the free tier.
- **Hosting**: PostgreSQL + PostGIS (managed) and Redis (managed, small).
- **Notifications and monitoring**: push via FCM/APNs (free) and Sentry (free or team tier).
- **Native tracking**: an Apple Developer account (USD 99/yr), Google Play (USD 25 once), and an optional commercial background-geolocation licence.

## 11. Phase 2 requirements: live test with one practitioner in Edmonton
- **Approvals**: approve and create a Mapbox account, issue a URL-restricted public token, and set the secret token server-side.
- **Authentication**: real sign-in for the practitioner and test client (JWT plus MFA). Server-side RBAC on all endpoints.
- **Live mode**: set `REACT_APP_TRACKING_MODE=live` (foreground browser GPS, screen on) and test drives in Edmonton.
- **Infrastructure**: WebSocket transport, Redis store, and a backend Mapbox Directions proxy with caching (recalculate on deviation over 150 m or every 60 s).
- **People and process**: written practitioner consent, a privacy notice and a data-retention policy.
- **Monitoring**: Sentry, plus tracking metrics (fix rate, stale count, ETA error).
