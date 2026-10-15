# Nabitouch — security findings (Slice 0)

_Audit date: 2026-10-10. Source of truth for severity and remediation. Evidence methods are marked on each finding._

No secret values are written here. Rotate the live credentials; do not look them up from git in order to keep using them.

Severity:

- **Critical** — unauthenticated or cross-role access to clinical, financial, or account takeover paths, or a secret already in git history.
- **High** — an authenticated user can change another party's money, clinical record, or schedule in a way the product does not intend.
- **Medium** — privacy or integrity weakness that needs a specific extra condition, or a defense that exists but is incomplete.
- **Low** — hardening that should land before production but is not, by itself, an exposed record.

"Verified" means a request was sent to the throwaway local API described in `docs/CURSOR_AUDIT.md`. "Code" means the path was read and not executed.

## Credential exposure

Plaintext account passwords are committed on `origin/main` and are present in history at least as far back as `c3d5fbf`. They are fallbacks, so they are used whenever the matching environment variable is unset.

| Location | What is committed | Rotation |
|---|---|---|
| `auth_testing.md` | Owner email plus a password in a sample `curl` | Owner password, and any JWT that was signed while that password was the live one |
| `backend/tests/backend_test.py` | Owner and demo password fallbacks | Owner password and demo password |
| `backend/tests/test_tracking.py` | Same owner and demo fallbacks | Same |
| `backend/tests/test_live_gps_and_email.py` | Same, plus a sandbox-account password | Same, plus that sandbox password if it was reused |
| `backend/tests/test_client_registration.py` | Owner password fallback | Owner password |
| `backend/tests/test_password_reset.py` | Passwords for the Resend sandbox user | That sandbox password if it was reused |
| `test_reports/iteration_7.json` | Narrative that repeats the demo password and a sandbox password | Same |

`memory/test_credentials.md` is gitignored and is not in this clone. `.env` files are gitignored. `git log` shows no committed `.env`. That does not make the passwords above harmless. Anyone who can clone the repository can attempt those logins. The unauthenticated GitHub API returned 404, so public-internet exposure was not proven. Rotate anyway.

Also rotate, if they have ever been set on the Emergent preview or any shared host:

- `JWT_SECRET` (sessions stay valid for 7 days and logout does not revoke them)
- `EMERGENT_EMAIL_KEY`
- `MAPBOX_TOKEN` and `REACT_APP_MAPBOX_PUBLIC_TOKEN`
- `MONGO_URL` credentials
- `OWNER_PASSWORD` even after a UI password change, because startup writes the environment password back (F-03)

Do not paste the old values into tickets, screenshots, or new tests.

## Findings

### F-01 — Critical — Demo login issues a real owner session

**Status:** Verified with `DEMO_MODE=true`.

`POST /api/auth/demo-login` (`backend/auth.py`) returns 404 only when `DEMO_MODE` is not `true`. Otherwise it selects the owner user, or a demo user by role, and sets the normal JWT cookies. No password is checked. A local call with `{"role":"owner"}` returned 200 and role `owner`.

`POST /api/demo/reset` allows every role, including `client`, while `DEMO_MODE=true`. With demo mode off, the owner can still wipe every `nt_*` collection.

Startup (`backend/auth.py` `seed`) creates the owner and the `*.demo@example.com` users whenever the process boots, and **replaces the stored password hash** when it does not match `OWNER_PASSWORD` / `DEMO_PASSWORD`. A reset-password change does not survive a restart of a seeded account.

**Remediation (Slice 1):** Fail startup if `DEMO_MODE=true` while a production flag is set. Remove demo-login, demo reset, and password re-seeding from any production process. Keep a separate preview configuration. Delete the committed fallbacks and require environment variables with no default passwords.

### F-02 — Critical — Credentialed CORS default is every origin

**Status:** Code. Local run set `CORS_ORIGINS` to the dev origin, so this default was not the configuration under test.

`backend/server.py` uses `allow_origin_regex=".*"` when `CORS_ORIGINS` is missing or `*`, with `allow_credentials=True`. Combined with `SameSite=None` cookies, a browser on any site can send the session and read the response. `GET /api/state` for an owner is the full clinical and payment snapshot.

**Remediation:** An explicit origin list. No wildcard with credentials. Prefer `SameSite=Lax` or `Strict` on the first-party site, or a CSRF token if a cross-site frontend is required.

### F-03 — Critical — Sessions are not bound to HTTPS in local use, and are not revocable

**Status:** Verified for the HTTP cookie failure. Revocation is code.

Cookies are `httponly`, `secure=True`, `samesite="none"`. Login against `http://127.0.0.1:8001` returned 200 and the jar contained the cookie. The following cookie-only `/api/auth/me` and `/api/demo/reset` returned 401. The same value as a Bearer token returned 200. That is why `backend_test.py` could not start.

Refresh (`POST /api/auth/refresh`) accepts any unexpired refresh JWT. It does not check that the user still exists. Logout only clears cookies. There is no server-side session id, rotation, or MFA. Access tokens last 15 minutes. Refresh tokens last 7 days. Password reset does not invalidate outstanding JWTs.

There is no login rate limit beyond five failures per email. Unknown emails skip bcrypt, so account existence is distinguishable by timing. Registration returns 409 when the email exists.

**Remediation:** HTTPS in every deployed environment. Server-side refresh rotation and revocation on logout and password reset. MFA for owner, receptionist, and practitioner before production clinical use. Uniform login timing. Stop printing provider error bodies that may contain addresses or tokens (`emailer.py`, Mapbox exception logs).

### F-04 — Critical — The server stores the client's price

**Status:** Verified.

`POST /api/bookings` (`backend/server.py` `create_booking`) copies `payload["appointment"]` and does not recompute `pricing`. A signed-in client booked `total: 1.0`, `discount: 99` and the stored appointment matched. `quote()` in `frontend/src/lib/domain.js` knows first-online eligibility, non-stacking, caps, zone fees, and GST. None of that runs on the server.

The same request may send `promoId`. The server increments `promotions.redemptions` with `$inc` and does not check eligibility, dates, stacking, or the limit. An ineligible client's bookings moved the welcome counter from 37 to 40.

`onlineBookings` is incremented for any existing client id, including staff bookings, before a promotion decision. `POST /api/auth/register` spreads `profile` after `loyaltyPoints` and `onlineBookings`, so a registrant can set those fields.

There is no idempotency key. Two concurrent creates for the same practitioner, date, and time both returned 200 and both were stored. Slot search (`slotsFor`) is client-side and uses the polled snapshot.

**Remediation (Slice 1):** One server function that loads service price, zone, GST, and promotions and writes that result only. Conditional, atomic redemption. Unique constraint or transaction for practitioner/interval conflicts. Ignore client totals. Idempotency key on create.

### F-05 — High — Generic writes and the event `set` bag bypass the lifecycle

**Status:** Verified.

`PATCH /api/{name}/{doc_id}` (`patch_doc`):

| Role | What the code allows |
|---|---|
| Owner | Any field on any of the 12 collections, including signed SOAP, settings, and audit |
| Receptionist | Any field on `appointments` and `clients`. Receptionist permission flags are not read |
| Practitioner | Any field on their own practitioner document; any field on their plans; appointment patches limited to `timer` |
| Client | Own client document except `loyaltyPoints` and `onlineBookings`; appointment patches limited to `feedback` |

Verified: receptionist `PATCH` set `status` to `completed` with no transition check. Owner `PATCH /soap/soap-090` set a signed note back to `draft`, after which the treating practitioner's `PUT /soap/a-090` succeeded. Client price patch returned 403.

`POST /api/appointments/{id}/event` merges `body.set` into the appointment for owner, receptionist, or the assigned practitioner. Verified: the assigned practitioner set `pricing.total` to 0 and `paymentStatus` to `fully_paid`. The client received 403 on that route.

`POST /api/{name}` lets the owner insert an arbitrary document into any collection, and a practitioner insert a plan.

Receptionist permission keys in `settings.receptionPerms` are enforced on tracking views and on some payment routes. They are not enforced on `/api/state`, generic patch, transitions, or booking. Verified: a receptionist snapshot contained 6 clients, 3 insurance rows, and 14 addresses, with SOAP correctly empty.

**Remediation:** Replace generic patch with named commands (assign, reschedule, cancel, set availability, save profile). Validate fields per command. Keep the transition table as the only status writer. Remove `set` or allowlist it. Enforce receptionist permissions on the server for every read and write, including `/api/state`.

### F-06 — High — The simulated card webhook marks a visit paid

**Status:** Verified. The charge is simulated; the bug is the trust boundary the real Stripe work must not inherit.

`POST /api/payments/{id}/webhook` calls `guard` with `need=None`, so the appointment's client is allowed. A client created an intent for `126.00` and then posted `outcome=succeeded`. Response 200, `paymentStatus=fully_paid`. There is no Stripe signature. Idempotency is "if status is no longer pending, return the document."

`settle()` itself does not count unconfirmed insurance as cash. That part of the design should be kept. Refund amounts are not capped to the captured amount (owner-only route; code).

**Remediation (Slice 5, design locked in Slice 1):** The client must not be able to settle a charge. Signature-verified webhooks, a separate endpoint, and stored event ids. Keep production charges off until the owner supplies keys and written approval.

### F-07 — High — Clinical records are mutable, broadly readable, and unaudited

**Status:** SOAP un-sign verified. Read scope is code, plus the receptionist snapshot probe.

- `PUT /api/soap/{id}` blocks when `status` is `signed`, but F-05 bypasses it.
- There is no amendment type, reason, or previous version.
- Sign records the practitioner name from the JWT and does not bind a snapshot hash.
- `GET /api/state` returns every SOAP note whose `clientId` is on any appointment of that practitioner, including notes written by someone else. It does not record the read.
- Desk users receive no SOAP (verified) even if `receptionPerms.clinical` is later turned on. The flag does nothing on this route.
- Clients receive other people's appointment ids, times, durations, practitioner ids, and statuses (anonymous probe: 14 rows, those fields only).
- Gift-card filtering matches the signed-in person's first name as a substring of purchaser or recipient.
- Practitioner `base` coordinates are in the anonymous snapshot (verified). Seed values are synthetic. A real home base would be disclosed the same way.
- Insurance member and policy identifiers are plaintext fields on `nt_clients`. Card pixels are not uploaded today. Nothing stops a later `PATCH` from storing an image on the client document.
- Logs: booking-email failures log the exception; Mapbox failures log the exception, and httpx error strings include the request URL. The Directions URL carries `access_token`.

**Remediation (Slice 6, with the write-path fixes in Slice 1):** Signed notes are immutable. Amendments are new documents. Read and write audit for SOAP, plans, insurance, and documents. Stop returning practitioner bases, full settings, and other clients' identifiers to anonymous and client callers. Field-level encryption or equivalent approved storage for policy and member identifiers before real cards are stored.

### F-08 — High — Live location rules are right on the session route and wrong on the event buffer

**Status:** Session stop-on-arrival passed in pytest. Buffer retention is code, and `test_events_scoped` expects `location.updated` events to remain readable by the owner.

Ingest accepts a fix only from the assigned practitioner or from the owner when `user.subject` is that practitioner, and only while `status=en_route` and `trip.sharing`. The latest fix is dropped from `InMemoryLocationStore` when the visit leaves `en_route`. The client session view requires `clientId` match and `en_route`.

`InMemoryTransport` keeps up to 500 events, including latitude and longitude, after arrival. `GET /api/tracking/events` still returns them to the owner and to audience members. `demo/reset` does not clear the store or the bus. Both structures are process-local, have no TTL, and disappear or split across workers on restart. That is the production gap in `docs/TRACKING_PHASE1.md`, still true in code.

`parse_auth` (the `role:subject` header parser) is unused by the router. The router uses the JWT. Do not revive the header parser.

**Remediation (Slice 3):** Shared store with a short TTL. Drop or redact coordinates when the trip ends. Do not put precise tracks in MongoDB unless the owner approves a retention decision in writing.

### F-09 — Medium — Anonymous and client snapshots over-share operations data

**Status:** Anonymous shape verified.

Anonymous `/api/state` returned the full settings document, including `receptionPerms` and `revenueTrend`, and practitioner `base`. Appointment rows were reduced as designed (no address). That reduction is the right idea and should be extended to settings and practitioner documents.

### F-10 — Medium — No encryption, retention, or consent record suitable for a clinic

**Status:** Code and deployment gap.

The audit database URL was `mongodb://` inside Docker, with no auth. The app does not configure field encryption. TLS for the API is a deployment responsibility; the cookie flags assume it. Marketing consent is a boolean. There is no privacy notice version, no record of who accepted it, and no deletion or export workflow. `POST /api/demo/reset` deletes collections with no retention hold.

Insurance card images are not stored (the wizard keeps them in memory and saves `hasCardImage`). Member identifiers are stored.

**Remediation:** TLS to clients and to MongoDB, encrypted disks, and a written decision on field encryption for insurance identifiers and SOAP text. Retention and deletion only after counsel and the professional college confirm the period. See the legal notes below.

### F-11 — Low — Dependency and supply-chain residue

**Status:** Install verified for the Emergent Python package. Frontend build verified without that package.

- `emergentintegrations==0.2.2` is not on public PyPI and is not imported.
- `boto3`, `pandas`, `numpy`, `jq`, `python-jose`, and `passlib` are not imported by application modules. `pyjwt` and `bcrypt` are the ones in use.
- Frontend devDependencies install `@emergentbase/overlay` and `@emergentbase/visual-edits` from `assets.emergent.sh`. Production `craco build` succeeded without requiring them at runtime. `craco.config.js` loads them only for the dev server.
- No `yarn.lock` is committed, so frontend installs are not reproducible.
- No dependency scanning or CI is configured.

## Route authorization matrix

Collections behind generic routes: `services`, `practitioners`, `clients`, `appointments`, `soap`, `plans`, `promotions`, `zones`, `giftcards`, `audit`, `templates`, `settings`.

| Route | Unauthenticated | Client | Practitioner | Receptionist | Owner |
|---|---|---|---|---|---|
| `GET /api/` | Open | Open | Open | Open | Open |
| `GET /api/state` | Catalogue, settings, practitioner bases, busy slots | Own records plus busy slots | Own visits, those clients, their SOAP by client id | Everything except SOAP | Everything |
| `POST /api/demo/reset` | 401 | Allowed if demo mode | Allowed if demo mode | Allowed if demo mode | Allowed |
| `POST /api/bookings` | Guest create, client-priced | Own client id, client-priced | Can create a new guest record | Can book for an existing id, client-priced | Same |
| `POST /api/appointments/{id}/transition` | 401 | 403 | Own visit | Any visit, permissions ignored | Any |
| `POST /api/appointments/{id}/event` | 401 | 403 | Own visit, arbitrary `set` | Any visit, arbitrary `set` | Any, arbitrary `set` |
| `PUT/POST /api/soap/{id}` | 401 | 403 | Treating practitioner; signed `PUT` blocked | 403 | Any visit; signed `PUT` blocked, generic PATCH is not |
| `POST /api/{name}` | 401 | 403 | `plans` only | 403 | Any collection |
| `PATCH /api/{name}/{id}` | 401 | Own profile; appointment `feedback` only | See F-05 | Appointments and clients, any field | Any field |
| `POST /api/payments/{id}/intent` and `/webhook` | 401 | Own visit, including webhook | 403 | If `managePayments` | Any |
| `POST /api/payments/{id}/cash` | 401 | 403 | 403 | If `managePayments` | Any |
| `POST /api/payments/{id}/refund` | 401 | 403 | 403 | 403 | Any |
| `POST /api/claims/{id}` | 401 | 403 | 403 | If `viewInsuranceStatus` | Any |
| `POST /api/tracking/sessions/{id}/locations` | 401 | 403 | Assigned, `en_route` only | 403 | Only if `subject` is the assigned practitioner |
| `GET /api/tracking/sessions/{id}` | 401 | Own visit while `en_route` | Own visit | `viewLocations` / `viewEta` | Any |
| `GET /api/tracking/active` | 401 | 403 | 403 | Same permission flags | Any |
| `GET /api/tracking/events` | 401 | Audience match; coordinates can remain after arrival | Audience match | Hides `location.updated` unless `viewLocations` | Any, including after arrival |
| `GET /api/tracking/contracts` | Open schema | Open | Open | Open | Open |
| `POST /api/auth/demo-login` | Open when demo mode | — | — | — | Returns the owner session |
| `POST /api/auth/staff` | 401 | 403 | 403 | 403 | Practitioner or receptionist only |
| `POST /api/auth/forgot-password` | Open, generic body; send path is Emergent | — | — | — | — |

Negative tests that exist today cover a subset of tracking, one cross-client payment case, public hiding of clients, and receptionist SOAP denial. They do not cover generic patch, `event` `set`, price trust, demo-login, CORS, SOAP un-sign, or receptionist reads of insurance. Slice 1 should add those as automated tests against fixtures, not against the preview host.

## Privacy obligations for counsel

This section is a review agenda. It is not a certification, an opinion that Nabitouch complies, or a determination of which statute applies.

Confirm with Alberta counsel before production:

1. **Alberta PIPA** (Personal Information Protection Act) is the usual private-sector statute for an Alberta business. It covers client and staff personal information: name, contact details, address, birthday, emergency contact, payment state, and employee records. Health-related information is sensitive and calls for stronger safeguards. Duties include identifying purposes, consent, limiting collection, reasonable safeguards, access, correction, and limited retention. A breach that creates a real risk of significant harm must be reported to the Alberta OIPC and to the affected people.

2. **PIPEDA** applies to federal works and to personal information that crosses provincial or national borders in the course of commercial activity. If hosting, email, maps, or payments are outside Alberta, counsel should decide whether PIPEDA, PIPA, or both govern the transfer, and what notice and contract terms are required.

3. **Alberta Health Information Act** applies to custodians and their affiliates. Massage therapists are not automatically custodians. Counsel must decide whether this clinic, or any practitioner, is a custodian or an affiliate. If HIA applies, SOAP notes and information that reveals someone received a health service (including a home-visit location during a treatment trip) are health information, with stricter rules on collection, disclosure, and storage outside Alberta. Do not assume HIA either applies or does not.

4. **Professional retention.** Confirm with the applicable college or association whether treatment records have a required retention period. Do not invent a number in the product. Until that decision exists, do not add a deletion job that could destroy records early, and do not leave `POST /api/demo/reset` available.

5. **CASL** applies to commercial electronic messages. Booking and password messages are different from marketing. Marketing consent is already a separate boolean. Keep the proof of consent (time, wording, version). Do not put diagnosis or treatment detail in SMS, email, or push text.

6. **Cross-border processors** already implied by the design: Mapbox, a future Stripe account, and a future Resend (or other) email account. Each needs a contract, a described purpose, and a decision about where data sits. The current Emergent email proxy is not a production processor.

7. **Safeguards the current build does not provide:** least-privilege clinical reads, immutable signed notes, encryption in transit as an application guarantee (deployment must terminate TLS), encryption at rest beyond whatever the host disk does, access audit, retention, and breach logging that avoids storing the personal information in the log line.

Implementation of Slices 1, 3, and 6 can support a later legal review. It will not, by itself, make the clinic compliant.
