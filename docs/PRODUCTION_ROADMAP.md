# Nabitouch — production roadmap

_Written at the end of Slice 0. Slice 1 does not start until the owner reviews this audit. Do not merge to `main`. Do not deploy. Do not point tests at the Emergent preview or at any database that contains real clients._

Starting commit for this branch: `55931fb278d6df933ffa173de1c1c0d66bd51a49` (`origin/main` at audit time).

The application stays React (JavaScript, Yarn), FastAPI, and MongoDB. Brand layout, motion, and `data-testid` values stay. Demo mode may remain for previews only, on a separate database, behind a flag that cannot be enabled in production.

## Blockers that are true before any slice

1. Rotate the owner password, the demo password, `JWT_SECRET`, the Emergent email key, Mapbox tokens, and any preview MongoDB password. Values are in git history. See `docs/SECURITY_FINDINGS.md`. Do not send the old values back to the repository.
2. Provide a non-production MongoDB with authentication and TLS, or accept local Docker for Slice 1 tests. This audit used a temporary unauthenticated container and deleted it.
3. Tell the team the production site origin when it exists. Do not invent a domain. `APP_URL` and CORS both need it. Until then, local and staging origins only.
4. Change the pytest defaults that target `https://lagoon-ui-refresh.preview.emergentagent.com` and call `POST /api/demo/reset` before anyone runs the suite on a new machine.
5. `pip install -r backend/requirements.txt` fails outside Emergent because `emergentintegrations==0.2.2` is not public. Slice 4 removes that pin after email tests pass. Until then, local installs must omit it deliberately and record that they did.

## Credentials and decisions by slice

| When | Needed from the owner | Not needed yet |
|---|---|---|
| Before Slice 1 is deployed anywhere shared | Rotated secrets above. `DEMO_MODE` policy. Staging MongoDB. Explicit CORS origins | Stripe, Resend, Capacitor, insurer |
| Slice 2 | Mapbox public token (URL-restricted) and secret token (Directions, and Geocoding if search is approved). A monthly budget | A new map vendor |
| Slice 3 | Approval to add Redis (or a named alternative). Consent copy for practitioners on the live trial. Decision to keep the one-practitioner trial until the new path is verified | Background-location plugin, Apple/Google accounts, unless a separate approval is given |
| Slice 4 | Choice of email provider (Resend is the candidate). Verified domain, from-address, `APP_URL` | SMS and push providers |
| Slice 5 | Stripe account, restricted keys, webhook secret, rules for partial payment, cash, and refunds. A separate written "charges may go live" approval | Insurer clearinghouse |
| Slice 6 | Counsel's view on PIPA vs HIA custodian status, retention period, and whether insurance images may be stored. See the legal notes in `docs/SECURITY_FINDINGS.md` | A claim that the app is certified |
| Slice 7 | Staging host, backup location, who receives alerts | A production domain, if it is still undecided |

## Slice 1 — P0 security and booking integrity

Entry: this audit accepted.

Implement:

- Production flag that refuses `DEMO_MODE`, demo-login, demo reset, and password re-seeding.
- Remove password fallbacks from tests and `auth_testing.md`. Tests read environment variables only.
- CORS allowlist. Cookie policy that works on the real HTTPS origin and does not use credentialed `*`.
- Server-side `quote` used by `POST /api/bookings`. Ignore client totals, discounts, tax, and travel fees. Enforce first-online eligibility, caps, non-stacking, zone fees, GST from settings, practitioner eligibility, and overlapping appointments. Atomic promotion redemption. Idempotency key.
- Delete generic field writes or reduce them to allowlisted commands. Remove appointment `set` on the event route. Receptionist permissions checked on the server for state, transitions, client records, and payments.
- Clients cannot write financial or clinical fields. Practitioners cannot write another practitioner's notes. Owner SOAP edits go through an explicit path, not a free patch.
- Signed SOAP cannot be moved back to draft through any route. Amendment API can wait for Slice 6, but the bypass closes in Slice 1.
- Webhook route rejects client callers even while Stripe is still simulated.
- Refresh revocation sketch (server-side id, logout and password reset invalidate it). MFA design recorded; implementation for owner and staff if the owner agrees it is in Slice 1 rather than Slice 6.
- Tests, all against fixtures: each role denied on the routes in the matrix; price tampering; two concurrent bookings for one slot; promo limit; SOAP un-sign denied.

Exit: those tests pass on the local stack. Preview host not used.

## Slice 2 — Mapbox completion

Keep Mapbox GL and the existing Directions client.

- Startup check: public token absent from the server env dump; secret token absent from the frontend bundle.
- Geocoding for Edmonton and the configured zones, with a manual pin correction.
- Zone fee comes from the server quote in Slice 1, using the confirmed coordinate.
- Directions: road geometry, traffic ETA, remaining distance, refresh on the existing 30 s / 250 m cache, recalculation after movement, labeled fallback (`estimated` or `unavailable`, never "live traffic" when the provider is `mock`).
- Tests with a mocked HTTP layer. No live Mapbox dependency in CI.

## Slice 3 — GPS foundation

The one-practitioner trial stays until the replacement passes the same tests.

- Feature flag for how many practitioners may publish `source=gps`.
- Redis (or the approved store) with a short TTL. No precise trail in MongoDB.
- Authenticated realtime channel scoped to one appointment. Polling remains as a fallback until the channel is verified.
- Sharing starts only on the practitioner's travel transition and stops on arrival, cancel, interrupt, or session start.
- Denied, offline, stale, and reconnect behavior covered by tests.
- Background location: a written comparison (the Phase 1 table updated with current licence and store rules) and no native plugin unless the owner approves a separate slice.

## Slice 4 — Email without Emergent

- Provider interface. Resend behind it if approved. A dev transport that records messages and does not send.
- Templates for booking confirmation, password reset, reschedule, cancel, en route, tracking link, arrived, and running more than 10 minutes late.
- Queue, retry, and idempotency. No clinical detail in the body.
- Honor marketing consent for promotional mail. Transactional mail still needs the correct `APP_URL`.
- Delete `EMERGENT_EMAIL_KEY` usage and the `emergentintegrations` pin after the new tests pass.
- Fix the confirmation screen so it does not say that email is skipped when a message was queued.
- Replace `%-d` / `%-I` with portable date formatting.

## Slice 5 — Stripe, still off in production

- PaymentIntents created on the server for the server-calculated payable amount.
- Stripe's supported UI. No raw card data on this API.
- Webhook signature verification and stored event ids.
- Cash, partial payment, refunds capped to the captured amount, receipts.
- Insurance approval remains distinct from insurer cash received (`settle()` already does this).
- `PAYMENTS_ENABLED` default false. The owner turns it on in a later change with keys present.

## Slice 6 — Clinical and insurance foundation

- Read audit and least-privilege queries for SOAP, plans, and insurance.
- Immutable signed notes and an amendment record.
- Insurance document storage with authorization on every download, or a continued decision that images are not stored.
- Retention and deletion hooks that refuse to run until the legal period is configured.
- Privacy and consent records (wording version, time, purpose).
- Log scrubbing for email, address, member id, and tokens.
- Update the counsel notes if the design changes. Still no compliance claim.

## Slice 7 — Cleanup and release mechanics

- Split `server.py` into routes, services, and repositories without behavior changes beyond Slices 1–6.
- Replace `/api/state` polling with scoped queries where a screen needs them.
- Remove unused Python and Emergent frontend packages from production installs.
- Commit a `yarn.lock`.
- Docker Compose for MongoDB and Redis for local and staging.
- `.env.example` with names only.
- Indexes and a backup/restore drill.
- Readiness that checks the database and does not require a secret.
- CI: the Slice 1–6 tests, frontend build, and dependency review. No live charges and no live patient data.
- Rollback steps for the chosen host, written only after the host is chosen.

## Out of scope until a separate approval

- Framework or database migration.
- Visual redesign.
- French localization.
- A real insurer submission API.
- A native app store release.
- Merging `feature/production-hardening` or deploying it.

## Suggested review of this audit

1. Confirm rotation of the credentials listed in `docs/SECURITY_FINDINGS.md` has been started.
2. Confirm Slice 1 may close generic `PATCH` and client-supplied prices even though today's preview relies on them.
3. Confirm demo-login may remain only on an isolated preview.
4. Reply with staging MongoDB (or approval to keep using local Docker) and the Mapbox token plan before Slice 2.
