# Nabitouch — Slice 0 audit

_Audit date: 2026-10-10. Branch: `feature/production-hardening`. No application code was changed. `main` was not committed to, merged, or deployed. No production database was contacted._

This document is the verified baseline for production hardening. Historical docs (`docs/HANDOFF_CURSOR.md`, `memory/PRD.md`, `plan/plan.md`, `docs/TRACKING_PHASE1.md`, `test_result.md`, `test_reports/`) were treated as evidence, then checked against the source and a local run. Where they disagree, this audit follows the code and the local run.

Companion documents:

- `docs/SECURITY_FINDINGS.md` — authorization, credential, and privacy findings
- `docs/INTEGRATIONS_MATRIX.md` — external services and rollout state
- `docs/PRODUCTION_ROADMAP.md` — slices 1–7, blockers, and credentials the owner must supply

## 1. Repository baseline

| Item | Value |
|---|---|
| Remote | `https://github.com/gillesdathus/nabitouch-mobile` |
| Starting `origin/main` | `55931fb278d6df933ffa173de1c1c0d66bd51a49` |
| Brief's reference SHA | `121dba1a706d285105c46c88dfe7839a44c2c285` (ancestor of HEAD, not current HEAD) |
| Delta after the reference SHA | `docs/HANDOFF_CURSOR.md` added, `.emergent/emergent.yml` image tag updated |
| Working branch | `feature/production-hardening`, created from `55931fb` |
| Unauthenticated GitHub API | HTTP 404. Visibility was not confirmed. Treat the git history as exposed to everyone with clone access. |

HEAD commit message is Emergent's "Auto-generated changes" (2026-10-10 23:48:57 +0000). The handoff narrative that matches the code is `docs/HANDOFF_CURSOR.md`. `plan/plan.md` still says there is no real authentication and that practitioner location is never shared. `memory/PRD.md` still says authentication is the demo role bar in its "Simulated" section, then later describes JWT. `docs/TRACKING_PHASE1.md` still says Mapbox routing is a stub and that REST authorization is frontend-only. Those three files are stale. The server now has JWT checks, a Mapbox Directions client, and a live-GPS trial flag.

## 2. What was run

Host toolchain: Node v24.19.0, npm 11.17.0, Corepack, Yarn 1.22.22 via Corepack, Docker 29.6.2. Python and MongoDB are not installed on the host. There is no `backend/.env`, `frontend/.env`, Docker Compose file, CI workflow, or `.env.example` in the repository.

### Frontend

`corepack yarn@1.22.22 install` completed (no `yarn.lock` was in the repo; Yarn created one locally and it is not part of this commit).

`yarn test --watchAll=false --passWithNoTests` exited 0: **No tests found**. There are no `*.test.js` / `*.spec.js` files under `frontend/src`.

`yarn build` (`craco build`) exited 0: **Compiled successfully.** Largest gzip chunks: 521.34 kB (`616.*.chunk.js`), 202.37 kB (`main.*.js`). A search of `frontend/build` found no Mapbox public or secret token prefixes. `REACT_APP_MAPBOX_PUBLIC_TOKEN` was unset, so this build does not prove the live map. The Emergent dev overlay is not required for the production build.

The first Yarn attempt inside the sandbox retried on network errors and was stopped. A retry outside the sandbox used the already-fetched `node_modules`.

### Backend

`pip install -r backend/requirements.txt` **fails** on public PyPI:

`emergentintegrations==0.2.2` has no public distribution. Application modules do not import it. The local API was installed from the same file with that single line removed, inside a throwaway `python:3.12` container.

MongoDB was a throwaway `mongo:7` container with **no authentication**, bound to localhost only for the audit, then removed. Database name `nabitouch_slice0`. Credentials in that container were newly generated and are not the passwords stored in git. `DEMO_MODE=true` was set only so the current demo paths could be observed. The container published port 27017 without auth for the duration of the run and was destroyed afterward. It was not a production database.

`GET /api/` returned the demo server message. Uvicorn logged application startup complete.

`pytest tests -n 0 --tb=line -q` against `http://127.0.0.1:8001` (not the Emergent preview):

**7 failed, 27 passed, 1 skipped, 18 errors in 10.50 seconds.**

`pytest.ini` adds `-n 2 --dist loadscope`. That setting was overridden with `-n 0`. The default would run modules that share one database, and that call `POST /api/demo/reset`, in parallel.

| Result | Where | Why |
|---|---|---|
| 18 errors | `backend/tests/backend_test.py` (entire module) | Session fixture logs in, then `POST /api/demo/reset` returned **401**. Login itself returned 200. |
| 2 failed | `test_client_registration.py` | Register returned 200, then cookie-authenticated `/api/auth/me` returned 401. Booking with a client id and no usable session returned 403 `Sign in to book for an existing profile`. |
| 2 failed | `test_password_reset.py` | `POST /api/auth/forgot-password` for a known address returned **502**. The Emergent email proxy rejected the local key. |
| 3 failed | `test_tracking.py` | `accepted` was false on a valid fix; later stale and poor-accuracy cases returned `out_of_order`. `POST /api/demo/reset` does not clear the process-local location store, and earlier tests in the same process ingest fixes for `a-101`. Sequence is checked before staleness. |
| 1 skipped | `test_live_gps_and_email.py` | Real-email case skips when `delivered@resend.dev` is not already registered. The other tests in that module were not in the failure list. |
| 27 passed | Remaining cases | Includes unauthenticated rejection, wrong-practitioner tracking rejection, public `/api/state` hiding clients and SOAP, receptionist SOAP denial, payment ownership checks, and the live-GPS trial file except the skipped email case. |

These tests were **not** run against `https://tidewell-hub.preview.emergentagent.com`. `backend_test.py`, `test_client_registration.py`, and `test_live_gps_and_email.py` default to that host, and `backend_test.py` calls `POST /api/demo/reset` on it. Running the suite with an unset `REACT_APP_BACKEND_URL` would reset that environment.

### Local probes (throwaway data only)

Bearer tokens were used after confirming the cookie jar does not authenticate over HTTP.

| Probe | Result |
|---|---|
| Login | 200. Cookie present in the client jar. Next `GET /api/auth/me` using only that jar: **401**. Same token as `Authorization: Bearer`: **200**. |
| `POST /api/demo/reset` with the cookie jar | **401** |
| `POST /api/auth/demo-login` `{"role":"owner"}` with `DEMO_MODE=true` | **200**, role `owner`, no password |
| Anonymous `GET /api/state` | 0 clients, 0 SOAP notes, 0 plans, 0 gift cards, 14 appointments reduced to `id`, `date`, `time`, `duration`, `practitionerId`, `status`. Full `settings` document (GST, clinic placeholder, receptionist permission map, revenue trend). Practitioner documents include `base` coordinates. |
| Receptionist `GET /api/state` | 6 clients, 3 insurance rows, 14 appointments with addresses, 0 SOAP notes. Seed permissions do not hide insurance or addresses on this route. |
| Client booking with `pricing.total = 1.0` and `discount = 99` | **200**. Stored total `1.0`, stored discount `99`. |
| Two concurrent bookings, same practitioner, same slot | Both **200**. Two appointments stored. |
| Welcome promotion redemptions after ineligible client bookings that sent `promoId` | Counter moved from the seed value 37 to **40** (limit 500). No eligibility check. |
| Assigned practitioner `POST /appointments/{id}/event` with `set.pricing.total = 0` and `set.paymentStatus = fully_paid` | **200**. Stored total 0 and status `fully_paid`. |
| Same `set` as the client | **403** |
| Receptionist `PATCH /appointments/{id}` `{"status":"completed"}` | **200**. Status became `completed` without the transition table. |
| Client `PATCH` of appointment pricing | **403** |
| Client creates a PaymentIntent then calls `POST /payments/{id}/webhook` `outcome=succeeded` | Intent **200** for `126.0`. Webhook **200**. `paymentStatus` became `fully_paid`. |
| Owner `PATCH /soap/soap-090` `{"status":"draft"}` on a signed note | **200**, status `draft`. Treating practitioner could then `PUT` the note again (**200**). |

## 3. How to read the feature classes

| Class | Meaning in this audit |
|---|---|
| Implemented & Verified | Behavior checked in this session against the local API or the production bundle. |
| Implemented but Unverified | Present in code, and in several cases reported passing on the Emergent preview in `test_reports/iteration_1` through `iteration_7`. Not re-proven here. |
| Simulated | A labeled stand-in. It must not be described as the real provider. |
| Incomplete | Started, or only enforced in the browser. |
| Blocked | Needs an owner decision, a credential, or a provider that does not work outside Emergent. |

## 4. Feature inventory

| Feature | Class | Notes |
|---|---|---|
| Four role shells, brand layout, `data-testid`s, reduced-motion wrapper | Implemented but Unverified | UI was not exercised in a browser this session. `MotionConfig reducedMotion="user"` is in `App.js`. No automated accessibility test exists. |
| Client booking wizard, zones, GST line, welcome-offer copy | Implemented but Unverified | `quote()` in `frontend/src/lib/domain.js` implements the rules. The server does not. Local probe stored a client-supplied total. |
| Server-side price, promo, GST, zone, and conflict checks | Incomplete | See security findings F-04 and F-05. |
| Idempotent booking creation | Incomplete | No idempotency key. Reference numbers use `count + 1100`. |
| Guest checkout and in-booking registration | Implemented but Unverified | Registration returns 200. Cookie session does not survive plain HTTP (verified). Duplicate email 409 is implemented and was not in the failure list. |
| JWT login, 15-minute access token, 7-day refresh, bcrypt, per-email lockout | Implemented but Unverified | Login and bearer `/me` verified. Lockout tests were not in the failure list. Refresh reuse, logout revocation, and MFA were not verified because MFA does not exist. |
| httpOnly session cookies on plain HTTP | Incomplete | Verified broken for follow-up requests. `Secure` + `SameSite=None` requires HTTPS. |
| Forgot / reset password | Blocked outside Emergent | Token hashing, expiry, and single-use are implemented. Sending the link depends on `emailer.py`. Known-email request returned 502 locally. |
| Demo role bar and `POST /api/auth/demo-login` | Implemented & Verified | With `DEMO_MODE=true`, owner login without a password returned 200. |
| Staff creation by owner | Implemented but Unverified | `POST /api/auth/staff` is owner-only in code. Not called in this run. |
| Owner "Switch to Practitioner View" | Implemented but Unverified | UI-only (`shells.jsx`, `DemoStore.jsx`). The JWT role stays `owner`, so server privileges are not reduced. |
| `GET /api/state` polling every 2.5 s | Implemented & Verified | Anonymous and receptionist shapes probed. Owner snapshot is unfiltered in code. |
| Generic `POST /api/{name}` and `PATCH /api/{name}/{id}` | Implemented & Verified as overly broad | Receptionist status patch and owner SOAP un-sign verified. |
| Appointment transition table | Implemented but Unverified | Table exists and is bypassed by receptionist PATCH (verified) and by `event` `set` (verified). |
| SOAP draft, sign, and signed-note lock on `PUT /soap` | Incomplete | `PUT` rejects `status=signed`. Generic owner `PATCH /soap/{id}` cleared that lock (verified). No amendment record. |
| Treatment plans | Implemented but Unverified | Practitioner may create plans. No clinical audit of reads. |
| Insurance profile form and demo OCR | Simulated | Card image stays in component state (`hasCardImage` boolean only). OCR fills sample values and says so. Not an insurer check. |
| Insurance / client settlement math | Implemented but Unverified | `settle()` never treats an unconfirmed insurer amount as cash. The regression module that covers it did not run. A client can still force `fully_paid` through the simulated webhook (verified). |
| Stripe PaymentIntents, cash, refunds, claims | Simulated | No Stripe SDK, no signature check. Webhook is an ordinary authenticated route. |
| Mapbox GL street map | Implemented but Unverified | Renders only when `REACT_APP_MAPBOX_PUBLIC_TOKEN` is set. This build had no token. Historical iteration 6–7 reports say tiles worked on the preview. |
| Mapbox driving-traffic ETA | Implemented but Unverified | `MapboxDirections` in `backend/tracking.py`. Empty token or any exception falls back to the straight-line estimate. Fallback is labeled `mock` / "estimated ETA" in `LiveTrack.jsx`, not as live traffic. No automated directions test. Not called in this run. |
| Address autocomplete and geocoding | Simulated | `SAMPLE_ADDRESSES` in `domain.js`. No Mapbox Geocoding call. |
| One-practitioner live GPS trial | Implemented but Unverified | Flag `settings.liveGpsPractitionerId`. Trial tests were not in the failure list. Foreground browser GPS only. |
| GPS for every other practitioner | Simulated | `tripState()` Bezier replay. |
| Multi-practitioner live tracking | Incomplete | One id in settings. Location store and event bus are process-local. |
| Tracking authorization (assigned practitioner, `en_route` only, client sees own trip) | Implemented & Verified for the cases that passed | Wrong practitioner, missing auth, public state, receptionist SOAP denial, and stop-on-arrival session view passed. In-process sequence contamination failed three cases. |
| Realtime transport | Incomplete | Poll only. No WebSocket. |
| Background / screen-off GPS | Incomplete | Not implemented. Plugin comparison exists only in `docs/TRACKING_PHASE1.md`. |
| Booking confirmation email | Blocked outside Emergent | Background task after `POST /api/bookings`. Skips `@example.com`. Confirmation screen still says nothing is sent. |
| Password-reset email | Blocked outside Emergent | Verified 502 without a usable Emergent key. |
| En-route, late, arrived, reschedule, and cancel notifications | Simulated | `LogNotificationService` appends to an in-memory deque. Arrival is the only transition that notifies. No queue, consent check, or SMS. |
| PWA shell and service worker | Implemented but Unverified | Handoff says the worker caches the shell only. Not re-tested. |
| Demo seed and `POST /api/demo/reset` | Implemented & Verified | Reset route exists. Any signed-in role may call it when `DEMO_MODE=true` (code). Cookie call returned 401 on HTTP before role was checked. |
| Health, indexes, backups, CI, monitoring | Incomplete | `GET /api/` does not check MongoDB. Only `nt_users.email` (unique) and `nt_login_attempts.identifier` are indexed. |
| Alberta / Canadian privacy program | Incomplete | No encryption-at-rest design, retention job, deletion workflow, or read audit. Legal notes are in `docs/SECURITY_FINDINGS.md`. This audit is not a compliance certification. |

## 5. Documentation drift to fix later

Do not rewrite product copy in Slice 0. These contradictions should be corrected when the matching slice lands:

- Booking confirmation (`frontend/src/pages/client/Booking.jsx`) says a confirmation email is not sent. `send_booking_email` does send one when the address is not `@example.com`.
- `frontend/src/lib/api.js` still comments that tracking uses a demo auth header. `trackingIngest` ignores the extra argument `useTrackingPublisher` passes. Authorization is the JWT.
- `frontend/src/lib/tracking/providers.js` `mapboxRouteProvider` still throws. Server-side `MapboxDirections` is the live path.
- GST row is hardcoded as "GST (5%)" in the booking breakdown. `quote()` uses `settings.gst`.
- Booking email dates use `%-d` and `%-I`. Those directives are not valid on Windows CPython. The local API ran on Linux, so this was not executed on the Windows host.

## 6. Slice 0 conclusion

The prototype is a working four-role demo with real password login, a single-practitioner GPS trial, and simulated money, insurance adjudication, geocoding, and notifications. It is not safe to point at real patients, real cards, or a public origin.

The P0 gaps to fix in Slice 1, after this audit is reviewed, are listed in `docs/SECURITY_FINDINGS.md` (F-01 through F-08) and sequenced in `docs/PRODUCTION_ROADMAP.md`.

Slice 1 has not been started.
