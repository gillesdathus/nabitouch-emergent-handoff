# Nabitouch master readiness checkpoint — 16 October 2026

**Staging foundation: PASS. Production release: BLOCKED / NO GO.** This is a
checkpoint, not completion of the master implementation request. Draft PR #1 is
unmerged. Application deployed from `97fde6f383505c54ced07823c3d2f012afd118c8`;
its actual [GitHub Actions run #11 passed](https://github.com/gillesdathus/nabitouch-emergent-handoff/actions/runs/38971721699).
The subsequent operational-helper/report commit does not replace those app images.

## Authorization and production protection

The owner authorized isolated staging and created its DNS records. Preflight
stopped on unsafe production credential permissions as instructed. The owner then
explicitly authorized the exact repair: the root-owned regular nonsymlink files
`/opt/nt-next/backend/.env` and `.nt-m1.env` changed from `0666` to `0600`, and the
containing directory from `0777` to `0755`. File inode/device/size/mtime stayed
unchanged. No credential contents were read during this repair. No production
secret value was printed, rotated or committed; production services were not restarted.
Historical possible exposure still requires a separate credential rotation review.

No merge, production deployment, production database query, production webhook
change, live payment, customer notification, campaign activation or app publication
occurred. Emergent's approved frontend source and Tide/lagoon identity are unchanged.

## Infrastructure and staging — PASS for the verified foundation

Deployed on Hostinger `srv1393944`, `187.77.204.131`:

- Frontend: **https://staging.nabitouch.com/**.
- Protected API readiness: **https://api-staging.nabitouch.com/api/health**.
- Browser API: same-origin **https://staging.nabitouch.com/api**; APP_URL and CORS
  use the frontend origin. API-host root intentionally returns 404.
- Dedicated callback routes prepared at
  `https://api-staging.nabitouch.com/api/notifications/resend` and
  `https://api-staging.nabitouch.com/api/billing/stripe/webhook`.
  They are not registered with providers and their signing credentials are absent.
- Four healthy containers: `nabitouch-staging-api-1`, `-web-1`, `-mongo-1`, `-redis-1`.
  All use `unless-stopped`; all four recovered healthy after an intentional
  staging-only restart. Existing authenticated browser sessions remained valid.
- Only web publishes a host port, `127.0.0.1:18081`. Mongo, Redis and API have no
  published ports. Separate `nabitouch-staging_edge` and internal
  `nabitouch-staging_data` networks; neither joins a production network.
- Mongo volume `nabitouch-staging_staging-mongo`; database `nabitouch_staging`,
  writable `rs0` primary. App user has only readWrite on that database. Redis uses
  its own authenticated TLS service, CA/key/ACL and bounded no-eviction cache.
- JWT/field keys, Mongo credentials/destination and Redis credentials/destination
  are independently generated and distinct from production (compared in memory).
  Secrets live in `/etc/nabitouch-staging`, outside source/Git. Recovery directories
  are root-only; files are root-private or narrowly group-readable for Mongo,
  Redis or Nginx. No production volume or patient dataset was mounted/copied.
- Both DNS A records resolve to the VPS from workstation and VPS. A separate
  Let's Encrypt certificate covers both names, expires **14 January 2027**.
  Certbot reconfiguration simulated renewal successfully and saved a staging-only
  deploy hook that tests Nginx before reload. Existing production certs/settings
  were not replaced. The existing unrelated Nginx IPv6 protocol-options warning
  remains; configuration validation passed.

Host baseline: two CPUs, 7,940 MiB RAM, no swap, approximately 66.5 GiB free disk,
30 existing containers. Final observed headroom: 3,364 MiB available RAM; load
averages approximately 0.99 / 0.97 / 0.93. Image import produced a temporary load
spike; builds ran locally. Before API start, measured aggregate container CPU was
0.28 cores and available RAM 3,509 MiB. These snapshots are not load/stress sign-off.

Resource ceilings: API 768 MiB/0.50 CPU; web 128 MiB/0.15 CPU; Mongo 768 MiB/0.40
CPU with 256 MiB WiredTiger cache; Redis 192 MiB/0.15 CPU with 96 MiB cache limit.
Total ceilings 1,856 MiB/1.20 CPUs. Docker logs rotate at 2 × 5 MiB per service.
A Redis host overcommit warning was observed; no shared-host sysctl was changed.
Redis persistence is disabled: its ephemeral tracking/cache state is not backed up
as financial data. Database/ledger state is persistent in Mongo.

Actual app image identities on the VPS:

- API: `sha256:06164f4fcd72cf19754c4c43643685aa6d72faf1403176054ce58d29b614b8e6`.
- Web: `sha256:81539493165a6ce2f2b9fa44bf7fb8f184850c0df9985c471b6371b9355e9eed`.

Both have `:97fde6f` tags. Transferred image-archive SHA-256 matched before import:
`cd2d839f69b2cb6cc0e4cb6b745e3a5dcc6420b3f2b9531c817c540aea4f1404`.
Only committed staging configuration was transferred; ignored env files were not
baked into images. API-image inspection found no `.env`/`.env.*` file.

## Authentication, privacy and production noninterference — PASS within tested scope

Actual HTTPS checks proved:

- Unauthenticated readiness requests on both hosts return 401 at the Basic gate.
  Successful gate authentication exposes frontend/API only; app login/MFA remains
  separately required for owner operations.
- Frontend `/`, `/pro` and `/me/billing/payment-result` serve the SPA. Real fresh
  headless Chrome navigation to `/owner` loaded authenticated `/api/auth/me` and
  `/api/state` at desktop 1,365 px and mobile 390 px without horizontal overflow.
  External assets/providers were blocked for this smoke check: it is not Mapbox
  provider acceptance or comprehensive browser E2E.
- Synthetic staging owner login, Secure/HttpOnly session cookies, CSRF rejection
  despite a Basic Authorization header, TOTP enrollment/verification and privileged
  MFA enforcement passed. A pending MFA login cannot read owner operations and
  receives only the ordinary public catalogue view. The first test incorrectly
  expected the public catalogue itself to require login; the corrected protected
  endpoint and catalogue privacy assertions passed.
- Explicit credentialed frontend CORS works; an unapproved origin is rejected.
  Native Bearer mode needs a separately compatible gate before Android acceptance.
- `PAYMENT_MODE=disabled`, checkout false; all email lifecycle/reminder/invoice/
  statement/review delivery, workers, SMS and push off; push dry-run true. No
  Stripe/Resend/Firebase delivery credentials are loaded. Demo login is disabled.
- No clients, appointments or SOAP notes were seeded. The synthetic owner is not
  a production customer. Staging credentials, TOTP URI and recovery codes are in
  ignored `backend/.env.staging-access.local`, restricted to owner/SYSTEM on the
  workstation. Never paste its contents into chat, a PR or a screenshot.
- A harmless query canary was absent from the dedicated edge and web/API container
  logs. Access logs omit URL/query/IP/Authorization; Uvicorn access logs are off.
  Nginx error logging is suppressed to avoid raw-URL leakage. This specific check
  does not certify every future code path; monitor health/status/latency separately.

All pre-existing Nginx configuration file hashes remained unchanged; only a new
staging vhost was added. Six existing Nabitouch production container/image/start
identities stayed unchanged, their health checks remained healthy, production API
Mongo/Redis readiness stayed ok, and https://nabitouch.com returned HTTP 200 after
staging deployment/restart. No production database records or logs were inspected.

### Final staging credential-custody correction

A final permission audit caught four new staging configuration/access files at
0644 after an interrupted provisioning step. The agent corrected all four to
root-only 0600, replaced the staging owner/gateway passwords, JWT/field keys,
Mongo app password and Redis password, revoked old synthetic owner sessions/MFA,
and re-enrolled MFA. Only staging services were reloaded. All HTTPS, cookie,
CORS/CSRF, MFA, disabled-email and fresh browser tests passed again. Final exact
secret-file mode audit and production noninterference checks passed. No evidence
of actual access by another host account was investigated or claimed.

Initial staging field key remains root-private for initial backup recovery and
synthetic compatibility; production keys were unchanged. The new local ignored
access file contains the final credentials/MFA details. Encrypted backup execution
also passed with the replacement Mongo credentials. No recovery key was exported.

## Backup and recovery — on-host restore PASS; off-host restore BLOCKED

`deploy/staging/backup.py` is guarded to the staging database, container label,
network and named volume. It uses a private temporary Mongo utility config rather
than credential-bearing argv, encrypts with authenticated AES-256-GCM and cleans
only its temporary plaintext files. No production source or destructive retention
operation exists. Keys are separate from archives in root-private recovery custody.

An actual encrypted staging backup was decrypted/restored into a **new recovery
database in the same isolated staging Mongo container**. Counts matched across
**77 collections / 30 documents**. That is genuine on-host restoration, not an
off-host disaster-recovery claim. The encrypted archive was separately copied to
the owner workstation; its SHA-256 matched:
`e22c9b28e380b7711ddfd43bf73abdbb38ccae5dc2ed3e909b6cbd2b54c289d8`.
No plaintext dump or recovery key left the VPS in that transfer.

The installed helper was manually run successfully and scheduled daily at 03:17
UTC (21:17 Edmonton during daylight saving / 20:17 during standard time). Cron mail
is disabled. Logs are root-private and backup retention is not automatically
purged. Scheduled execution has not yet occurred. Automated off-host copy, owner
password-manager/recovery custody, retention monitoring and off-host restore remain
open. Automatic approval review rejected the specific recovery-key egress request;
separate explicit owner authorization is pending. No rejected action was retried.

Redis initially failed TLS directory traversal because umask tightened the new
staging directory; its mode was corrected to 0750 with the Redis group and private
key 0640. Mongo replica initiation was retried after first-volume initialization
finished. Both services then became healthy. No shared-host setting was changed.

## Resend — exact preview approved; genuine delivery BLOCKED

Owner approved HTML SHA-256
`5300e580b1536f55edbcafb4abb2dc9e29cc7c6b0fc6be8a3282e5491a9bea3b`.
Subject **Nabitouch — Email Delivery Test**; originally approved sender
`Nabitouch <bookings@nabitouch.com>`; recipient `info@nabitouch.com`.
`render_resend_preview.py` reproduces HTML/plain text in ignored `test_reports/`.
The old candidate was preserved. One responsive Tide/lagoon shell replaces nested
branding; requested body/slogan remain, login/timezone text removed. Desktop/mobile
preview rendered without overflow at 760/390 CSS pixels. No mail client/inbox
receipt is claimed. Acceptance guards require the exact approved HTML/subject,
approved inbox/sender, disabled worker and independently verified provider isolation.

Production callback remains `https://nabitouch.com/api/notifications/resend`, enabled
for delivered/bounced/complained, routed to `nt-next-api` / `nabitouch_prod`.
Its older deployed handler writes `nt_notifications` without a durable event
journal. The staging application now includes the newer journal and replay/early/
out-of-order receipt handling, but has no Resend key/signing secret or subscription.
No genuine event or signature acceptance has been performed on staging.

[Resend's webhook API](https://resend.com/docs/api-reference/webhooks/create-webhook)
does not document a domain/API-key filter. Its [domain ownership documentation](https://resend.com/docs/knowledge-base/domain-already-registered)
says a domain can be active on only one account at a time. A second callback or
sending key in production's boundary therefore does not establish isolation.
Do not claim/move production's root domain to create a staging account. A separate
team/account with a separately verified staging subdomain/sender requires the
owner's sender decision, provider access and staging DNS verification. That decision
is pending. No test email, send API, provider replay or production webhook change
ran. SPF/DKIM verification and monitoring-only DMARC evidence remain preserved.

## Remaining master phases

- **Stripe: PASS for preserved real local card lifecycle; staging BLOCKED.**
  `STRIPE_LIFECYCLE_ACCEPTANCE_2026-10-16.md` retains actual deposit/full/final-
  balance/decline/3DS/expiry/refund/reconciliation results. No unnecessary provider
  reruns. Initial scope cards/Link where applicable; delayed-method provider tests
  DEFERRED, not passed. Dedicated sandbox endpoint/secret, native redelivery and
  new campaign-discounted settlement still require their acceptance phase.
- **Mapbox: PASS for preserved genuine local evidence; staging BLOCKED.**
  The owner-supplied server token was found to equal production's token. Independent
  application/database secrets are proven, but Mapbox provider-token separation is
  not. No staging Mapbox calls were made. A separate server token and browser token
  restricted to staging are requested before real staging acceptance. Production
  token was not modified. Browser address/routing/ETA/travel/logging acceptance
  remains; conservative outage coverage passed in isolated regression tests.
- **Healing Experience campaign: NOT IMPLEMENTED / NOT RUN.** Existing flash
  campaign/incentives, identity/history, booking/slot locks, session care/consent,
  ledger/outbox/report modules were inspected for reuse. They do not implement
  `NB-FREE-INTRO-001`. This remains later in the owner's ordered plan, after
  staging and provider acceptance. Campaign remains uncreated/inactive.
- **Firebase Android: BLOCKED / NOT RUN on device.** Existing package
  `com.nabitouch.practitioner`; dedicated staging project/config, protected server
  credential, approved signing identity, physical device and a native-compatible
  access gateway are required. Push off/dry-run; Apple/iOS deferred.
- **Clinical workflows: isolated regression coverage PASS; complete staging
  operational E2E NOT RUN.** No production patient records or actual treatment
  data used. Clinical safety and per-visit consent must also cover the campaign.
- **Financial integrity: preserved local provider and isolated transaction tests
  PASS; campaign/staging reconciliation NOT RUN.** No live payment activation.
- **Security/privacy: permissions corrected; broader release gate BLOCKED.**
  Historical credential reuse/rotation review, prior permission-exposure assessment,
  container/OS scanning, braces advisory allowance expiring 15 November 2026 and
  Canadian privacy/data-handling review remain. CI is not regulatory sign-off.
- **Monitoring/support: PARTIAL / BLOCKED for release.** Health/resource/log limits,
  renewal and local encrypted backup schedule are deployed; alert ownership,
  external monitoring, stress testing, scheduled recovery/copy and full operational
  response remain unverified. No automated customer messaging is enabled.

## Campaign implementation contract for the later phase

Configurable draft defaults: Nabitouch Healing Experience / NB-FREE-INTRO-001;
10 minutes, clinic only, 30 sessions, new clients, once/person; completed free
session issues a nontransferable, single-use, nonstackable 20% treatment-base
reward for an eligible >=60-minute paid visit within 14 days. All durations,
limits, dates, locations, practitioners/services, discount components and
cancellation/no-show rules must be owner-configurable. Defaults do not authorize
activation. No discount on tax/travel/gift cards by implication.

Reuse authenticated CRM plus phone/history checks, audited duplicate exceptions,
independent unticked marketing consent, existing intake/per-visit consent and
availability/buffers. Capacity/identity reservations and reward redemption need
transactional safeguards and bounded recovery. Booking alone cannot issue a
reward; cancellation/no-show/fraud/incomplete treatment issue none. Quotes must
apply discount before tax and reconcile through invoices, Stripe, refunds and
reports. Existing WELCOME20/package/rewards must not stack. Report completed
cash receipts separately from booked/projected revenue, deduplicate registration
metrics, and leave all outbound campaign messaging disabled.

Implement the landing/registration/booking and owner control/reporting interfaces,
then verify concurrency, eligibility, identity, consent, completion/expiry/double
redemption, cancellation, tax/travel/refunds, and one genuine discounted sandbox
settlement. No campaign acceptance result is claimed at this checkpoint.

## Local and actual remote validation

Local: **242 backend passed / five skipped**, including the Git-dependent check;
**29 outage regressions**, **27 targeted email/outbox tests**, **70 frontend tests**,
successful safe-origin build, **eight preflight cases** and **four backup isolation
refusal tests**. Local Nginx syntax test
and real staging Compose preflight/health passed. Current secret exclusions/history
scan passed, retaining warnings about credential-document exposure in two old commits.

Actual GitHub Actions **run #11 SUCCESS for 97fde6f**, all configuration/backend/
frontend jobs successful: 242 backend / five skips, 29 outage, 70 frontend/build,
clean Python audit and runtime image imports. Five skips remain the separately
covered live Mapbox case, three optional absent Deep Tissue 5-pack cases and the
generic hosted-checkout-configured flow; see prior CI review for names. Git check
runs. Local tests are not substituted for remote CI.

Actual [run #12 also passed for operational/helper commit 00a166d](https://github.com/gillesdathus/nabitouch-emergent-handoff/actions/runs/38974273337),
including the four new backup-isolation refusal tests in the configuration job.
Later documentation-only checkpoint CI is reported separately on Draft PR #1.

An initial reused-container targeted run had three login failures because another
synthetic server already occupied the port. A fresh QA stack passed all cases.
The first frontend build hit sandbox file-read restrictions; the authorized rerun
passed. Existing Vite/Recharts/chunk warnings remain. Final PR evidence reports
subsequent report/helper commit CI separately from deployed application SHA.
