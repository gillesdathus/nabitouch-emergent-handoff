# Nabitouch: Project Report and Handoff (for Cursor)

_Last updated: 2026-10-10. Historical. The import record is `EMERGENT_HANDOFF.md`. Do not use this file as the current environment or credential source._

## 1. What this is
Nabitouch is a mobile-first PWA for a mobile massage therapy business in Edmonton, Canada. One React app holds four role-based experiences:
- **Client**: book, pay, add insurance, track the therapist live
- **Practitioner**: visit lifecycle, SOAP notes, live GPS
- **Owner/Admin** (`the OWNER_EMAIL address`): dispatch, revenue, staff, settings
- **Receptionist**: scheduling and coordination

The brand style uses breathing gradients, soft depth, generous spacing and Framer Motion.

**Rule from the client:** do NOT restart, regenerate, redesign or replace the project. Only extend it.

## 2. Stack
- **Frontend**: React (CRA + craco, JavaScript), Tailwind, shadcn/ui (`src/components/ui`), Framer Motion, lucide-react, mapbox-gl. Package manager: **yarn**.
- **Backend**: FastAPI (Python), Motor (MongoDB), httpx, bcrypt and PyJWT.
- **DB**: MongoDB. Every collection is prefixed `nt_`.
- **PWA**: `frontend/public/manifest.json` and `sw.js`. The service worker caches the app shell only; API data is never cached.

## 3. Run locally
```bash
# backend (port 8001). Every route is under /api
cd backend && pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
# frontend (port 3000)
cd frontend && yarn install && yarn start
```
- The frontend calls `REACT_APP_BACKEND_URL + /api/...`. Locally, set it to `http://localhost:8001`.
- Seed data loads automatically on startup when collections are empty (`backend/seed.py`).
- `POST /api/demo/reset` reseeds everything. **Never call it against real data.**

## 4. Environment variables
**backend/.env**

| Key | Purpose |
|---|---|
| MONGO_URL, DB_NAME | MongoDB connection |
| CORS_ORIGINS | Allowed origins (currently `*`; restrict this in production) |
| JWT_SECRET | Signs the access/refresh JWTs (httpOnly cookies) |
| OWNER_EMAIL / OWNER_PASSWORD | Seeded owner account (`the OWNER_EMAIL address`) |
| DEMO_PASSWORD | Password for the seeded demo accounts |
| DEMO_MODE | `true` shows the demo role bar and demo-login buttons. **Set it to `false` in production.** |
| EMERGENT_EMAIL_KEY | Emergent-managed Resend proxy. **It only works inside Emergent.** Outside Emergent, replace `emailer.send_email` with the official `resend` SDK and your own `RESEND_API_KEY` plus a verified sender domain. |
| EMAIL_FROM_NAME | Email sender name (`Nabitouch`) |
| APP_URL | Base URL used in email links. **Must be the live domain in production.** |
| MAPBOX_TOKEN | Server-side Mapbox Directions (driving-traffic ETAs) |

**frontend/.env**: `REACT_APP_BACKEND_URL`, `REACT_APP_MAPBOX_PUBLIC_TOKEN` (map tiles).

## 5. Code map
```
backend/
  server.py    generic CRUD (/api/{name}, /api/{name}/{id}) with role checks, /api/state (role-scoped snapshot),
               lifecycle transitions, SOAP save/sign, POST /api/bookings (+ background booking email)
  auth.py      JWT login/register/refresh/logout/me, per-email brute-force lockout (5 fails → 15 min),
               forgot/reset password, staff creation (owner only), demo-login (DEMO_MODE only)
  emailer.py   send_email() via the Emergent Resend proxy, with an HTML safety gate (no forms, https links only)
  payments.py  SIMULATED Stripe intent/webhook, cash, refund, insurer claim simulator, settle() balance maths
  tracking.py  Nabitouch Live: location ingest, sessions, /active dispatch feed, event bus (polling),
               MapboxDirections (real road + traffic ETA, cached per trip), mock ETA fallback
  seed.py      demo data (services, practitioners, clients, appointments, settings id="app")
  tests/       pytest suites (tracking, registration, password reset, live GPS + email)
frontend/src/
  App.js              routes (lazy). Shells per role in components/shells.jsx
  store/DemoStore.jsx global state: polls /api/state every 2.5 s, exposes {state, idx, api, run, me, role}
  lib/api.js          all HTTP calls (axios, withCredentials)
  lib/domain.js       status model, pricing/promo/GST rules, zones, tripState() simulation, permission keys
  lib/tracking/       contracts.js, providers.js (simulated vs browser GPS), useTrackingPublisher.js,
                      live.js (isLiveTrial, useLiveSession, applyLive)
  components/         LiveMap → MapboxLiveMap (if token) or simulated SVG map; LiveTrack (client tracker),
                      PaymentPanel, InsuranceWizard, AppointmentSheet, Splash, InstallCard, RoleBar
  pages/client|practitioner|owner|reception|ops (Dispatch shared by owner + desk), Login, ForgotPassword, ResetPassword
```

**Routes:**
- **Public and client**: `/`, `/login`, `/forgot-password`, `/reset-password`, `/services`, `/services/:slug`, `/book`, `/me`, `/me/profile`, `/me/insurance`
- **Practitioner**: `/pro`, `/pro/visit/:id`, `/pro/soap/:id`, `/pro/plans`
- **Owner**: `/owner` plus `/dispatch`, `/manage`, `/promos`, `/zones`, `/insights`, `/permissions`, `/payments`
- **Reception**: `/desk` plus `/dispatch`, `/clients`, `/verify`, `/messages`

**Collections:**
- **Demo data**: `nt_services`, `nt_practitioners`, `nt_clients`, `nt_appointments`, `nt_soap`, `nt_plans`, `nt_promotions`, `nt_zones`, `nt_giftcards`, `nt_audit`, `nt_templates`, `nt_settings`
- **Auth**: `nt_users`, `nt_login_attempts`, `nt_password_resets` (token stored as a SHA-256 hash; single-use; 30-minute expiry)

**Appointment status flow:** `requested → assigned → en_route → arrived → in_session → completed`, plus cancellation and interruption branches. See `domain.js` and `server.py` transition.

## 6. Done and verified (7 automated test runs, reports in `test_reports/iteration_1..7.json`)
- Full prototype for all 4 roles: booking, pricing, promos, insurance wizard, SOAP, plans, dispatch, payments UI, insights, audit
- Splash screen, install prompt card, fixed logo aspect ratio
- Real sign-in:
  - JWT cookies and per-email lockout
  - Owner creates staff; clients self-register during booking
  - Forgot/reset password by email
- Mapbox street maps (frontend token)
- **Live GPS trial**:
  - The owner picks one practitioner on Dispatch (`settings.liveGpsPractitionerId`). That practitioner's phone sends real browser GPS (`source: gps`) while the trip is active and the app is open.
  - The server rejects simulated fixes for that practitioner.
  - The client, practitioner and Dispatch views show a "Live GPS" badge.
- **Real road + traffic ETA**: Mapbox `driving-traffic`, refreshed every 30 s or 250 m, road geometry drawn on the map. Straight-line fallback if Mapbox fails. This part was checked manually with curl and a screenshot, not in an automated test run.
- **Booking confirmation email**: branded, sent in the background, skips `@example.com`, never blocks a booking.

## 7. Still SIMULATED / mocked
- **Stripe payments**: `payments.py` fakes intents and webhooks. No real charges.
- **Insurer adjudication / direct billing and OCR** of insurance cards
- **GPS for non-trial practitioners**: the `tripState()` bezier simulation in `domain.js`
- **Notifications** (`LogNotificationService`) are logged, not pushed. SMS/push are not implemented.
- **Realtime**: polling only (`/api/state` every 2.5 s, tracking every 5 s), no WebSockets
- **The tracking store and event bus live in memory** (`InMemoryLocationStore`, `InMemoryTransport`). They reset on backend restart and do not scale beyond one instance.
- Reception permissions are partly enforced on the client (`perm()` in DemoStore). The server-side checks are coarse (see `patch_doc` in `server.py`).

## 8. Remaining work (prioritized)
**P0: before going live**
1. Set `DEMO_MODE=false`, real `APP_URL`, a strong `JWT_SECRET`, and restrict `CORS_ORIGINS`. Remove or hide `/api/demo/*` and the demo-login route in production.
2. Email outside Emergent: switch `emailer.py` to the Resend SDK with a verified domain.
3. Fill in the business details still shown as placeholders: clinic address (`[Clinic address — to be supplied]`), real prices and service list, legal/consent text. **Do not invent them; ask the owner.**
4. Restrict the Mapbox tokens (URL restriction for the public token; a separate secret token for the server is recommended).

**P1**
5. Real Stripe (PaymentIntents + webhooks with signature verification), replacing the simulated flow in `payments.py` and `PaymentPanel.jsx`.
6. Move the tracking store and bus to Redis/Mongo, and use WebSockets/Socket.IO rooms per appointment instead of polling.
7. Native background geolocation (for example Capacitor + a background-geolocation plugin) so tracking keeps working with the screen off. Today the trial needs the app open in the foreground.
8. Running-late alerts: notify the client when the traffic ETA is more than 10 min past the scheduled time. "Therapist on the way" email/SMS when the trip starts (hook into `on_transition` in `tracking.py`).
9. Enforce all receptionist permissions server-side. Add an audit for every role-scoped read of clinical data.

**P2**
10. Insurer direct-billing integration and real OCR.
11. Split `DemoStore.jsx` into authenticated data hooks as more real data replaces seed data.
12. Push notifications (web push), SMS (Twilio), calendar sync.

## 9. Testing
- Read `OWNER_EMAIL`, `OWNER_PASSWORD`, and `DEMO_PASSWORD` from the environment. Do not store them in the repository.
- Demo accounts, when `DEMO_MODE=true`, use `*.demo@example.com`.
- Backend tests: `cd backend && pytest tests/`. They need the backend running. Some tests send real emails; use only `delivered@resend.dev`.
- Every interactive element has a `data-testid` (kebab-case). Keep that convention.
- Mock GPS in Playwright with `context.grant_permissions(['geolocation'])` and `context.set_geolocation({latitude, longitude})`.

## 10. Conventions
- Every backend route is prefixed with `/api`. Config comes only from `.env`, with no hardcoded fallbacks.
- Never return Mongo `_id`; queries use the `NO_ID` projection.
- Use timezone-aware UTC datetimes stored as ISO strings.
- Named exports for components, default exports for pages. Use the existing `nb-*` utility classes (`nb-card`, `nb-btn-primary`, `nb-input`, `nb-label`) and the brand tokens in `index.css`.
- Keep the calm, premium look: no redesigns.
