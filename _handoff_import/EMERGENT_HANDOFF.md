# Emergent import record

This repository is a sanitized snapshot for Emergent. It is not the Nabitouch source repository, and it does not contain that repository's history.

The source repository, its branches, and its history were not committed to, pushed, merged, or rewritten. Nothing in this import was deployed.

## Source revision

| Item | Value |
| --- | --- |
| Repository | https://github.com/gillesdathus/nabitouch-mobile |
| Branch | `feature/emergent-frontend-integration` |
| Commit | `d86f911e7168c33abf9c929ca37cb8dbf26574e7` |
| Subject | Record the frontend handoff so a redesign can keep the existing backend. |
| Commit time | 2026-10-14 22:47:22 -0600 |

The source history was not copied. Earlier revisions contain credential material that has since been rotated, so this repository starts as a new `main` branch.

## Uncommitted source work included

These files were present in the source working tree and were not committed there. Their working-tree contents are in this import.

New files:

- `backend/messaging.py` — appointment messages, inbox, and the message stream
- `backend/sms.py` — SMS readiness only; delivery stays disabled
- `frontend/src/components/Conversation.jsx`
- `frontend/src/components/tide.jsx`
- `frontend/src/pages/client/Intake.jsx`
- `frontend/src/pages/messages/Thread.jsx`
- `frontend/src/pages/practitioner/NativeNav.jsx`

Modified files:

- `backend/config.py` — `EMAIL_LIFECYCLE_ENABLED`, off unless set
- `backend/notifications.py` — cancellation, reschedule, and assignment outbox
- `backend/server.py` — messaging router, channel status, trip notices, lifecycle mail
- `frontend/src/App.js` — intake, message threads, native navigation, owner messages
- `frontend/src/lib/api.js` — message and channel client
- `frontend/src/lib/navigation.js` and `frontend/src/lib/navigation.test.js`
- `frontend/src/lib/tracking/providers.js` and `frontend/src/lib/tracking/useTrackingPublisher.js`
- `frontend/src/index.css`, `frontend/tailwind.config.js`, `frontend/src/components/brand.jsx`, `frontend/src/components/shells.jsx`, `frontend/src/components/LiveTrack.jsx`, `frontend/src/components/ops/VisualCalendar.jsx`
- Client pages: Booking, BookingSteps, Contact, GuestTrack, Home, InsurancePage, Me, Offers, PractitionerProfile, Practitioners, ProfileForm, Rewards, ServiceDetail, Services
- Operations and owner pages: Dispatch, Credentials, Dashboard, Manage, Permissions, Promos, RewardsAdmin, Schedule, TrainingCenter, Zones
- Practitioner pages: Availability, DailyRoute, Profile, Soap, Today, Visit
- Reception pages: Desk, Messages
- `frontend/src/pages/training/Workspace.jsx`

## Included application

- React and Vite frontend in `frontend/`, with `frontend/package.json` and `frontend/yarn.lock`
- FastAPI backend in `backend/`, with `backend/requirements.txt`
- Billing in `backend/billing.py`, `backend/payments.py`, `backend/payment_policy.py`, and `frontend/src/lib/billing.js`
- Tracking in `backend/tracking.py`, `backend/tracking_store.py`, and `frontend/src/lib/tracking/`
- Notifications in `backend/notifications.py` and `backend/emailer.py`
- Stage 5 messaging in `backend/messaging.py` and `frontend/src/pages/messages/Thread.jsx`
- API contracts in `docs/lovable-handoff/API_CONTRACTS.md`. Stage 5 routes added after that document are `GET /api/messages/presets`, `GET /api/inbox`, `GET/POST /api/appointments/{id}/messages`, `POST /api/appointments/{id}/messages/read`, `GET /api/appointments/{id}/messages/stream`, and `GET /api/notifications/channels`
- Configuration examples: `backend/env.example`, `frontend/env.example`, `deploy/env.hostinger.example`, `deploy/docker-compose.example.yml`, `deploy/Caddyfile.example`
- Isolated training in `backend/training.py`, `frontend/src/pages/training/Workspace.jsx`, and `frontend/src/pages/owner/TrainingCenter.jsx`. Its fictional people, visits, and invoices are created only inside a training scenario and stay in the separate training database

There is no standalone migration directory. An empty operational database receives the launch catalogue on startup, and these helpers create indexes when the API starts: service, media, profile, billing, import, clinical, legacy, notification, and messaging.

## Operational data

With `DEMO_MODE` unset or `false`, an empty operational database loads the launch catalogue: services, zones, unpublished business settings, and one inactive practitioner draft. It does not load fictional clients, visits, clinical notes, gift cards, or revenue.

`DEMO_MODE=true` is refused when `APP_ENV=production`. Outside production it still loads the older fictional clinic and demo accounts. `backend/env.example` sets `DEMO_MODE=false`. Do not turn it on to populate the business database.

Two source behaviors were changed only in this import so that fictional clinic data is not the active dataset:

- `backend/server.py` uses `build_launch_seed()` unless `demo_mode()` is on. The source uses `build_seed()` whenever `APP_ENV` is not `production`.
- `backend/auth.py` creates the owner as Nabitouch Owner unless `demo_mode()` is on. The source uses the fictional owner persona whenever `APP_ENV` is not `production`.

`PAYMENT_MODE=simulated` in the example does not create visits or charges. Production ignores that mode. SMS delivery is hard off. Lifecycle email stays off until `EMAIL_LIFECYCLE_ENABLED` is set.

The training scenario seed in `backend/training.py` was not changed.

## Left out

Protected operations files, including the committed runbook and the committed secret-provisioning scripts:

- `docs/PRODUCTION_RELEASE_RUNBOOK.md`
- `deploy/provision-production-secrets.sh`
- `deploy/set-mapbox-tokens.sh`
- `deploy/apply-owner-password.py`
- `deploy/reset-owner-password.sh`
- `deploy/set-resend-credentials.sh`

The last three existed only as uncommitted source files and were not read into this import.

Also omitted:

- `.env` files, private keys, credential stores, and local databases. None were copied.
- `test_reports/` — generated test output that contained an owner password and a shared demo password
- `memory/PRD.md`, `plan/plan.md`, `design_guidelines.json`, and `test_result.md` — obsolete prototype notes, not the running application
- `.emergent/` and `.gitconfig` — platform metadata, not application source
- `memory/test_credentials.md` — not present in the source tree that was copied; do not recreate it

`docs/ENVIRONMENT.md` still names `deploy/provision-production-secrets.sh`. That script is intentionally absent. Create local secrets from `backend/env.example` instead.

Personal owner email addresses that appeared in `docs/HANDOFF_CURSOR.md` and `backend/tests/test_password_reset.py` were replaced with a reference to `OWNER_EMAIL`.

## Not ready for production

This import does not authorize a production deploy, a database restore, a secret change, or a public booking cutover. Do not run the Hostinger or private-release scripts against the live VPS from this repository.
