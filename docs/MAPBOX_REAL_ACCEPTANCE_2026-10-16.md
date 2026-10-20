# Real Mapbox acceptance — 16 October 2026

**PASS for the local provider and application checks below. Physical navigation,
background GPS and Hostinger staging acceptance remain BLOCKED / NOT RUN.** This
extends the earlier [readiness audit](MAPBOX_ACCEPTANCE_2026-10-16.md), whose missing
credential blocker is now resolved locally. No staging deployment is implied.

The owner securely supplied distinct server/browser public-scope tokens and then
explicitly confirmed storage eligibility/billing and authorized permanent geocoding
for synthetic acceptance. Only ignored local env files were updated. No token,
credential, full provider payload or precise coordinate is committed. All provider
calls used actual Mapbox HTTPS APIs; none of the acceptance results below came
from the QA runner's mock transport.

## Isolation and method

A separate local Mapbox Docker Compose project has its own Mongo replica and Redis,
with a fresh `nabitouch_mapbox_acceptance_…` database. The real application API is
loopback-only on port 18084; React/Vite is on localhost:18085 with /api proxying to
that API. The existing Stripe acceptance stack and its financial records were not
modified. PAYMENT_MODE=disabled, card checkout false, EMAIL_PROVIDER=disabled and
all customer delivery flags false. No live charge or production data was accessed.

Public civic/commercial addresses were used as synthetic visit locations. Only
synthetic clients, practitioner credentials and appointments were provisioned in
this new database. Fixture credential approval is not evidence of any real
practitioner's registration or insurance. No clinical questionnaire was collected.
Protected operator helpers/evidence remain ignored under test_reports.

The initial calls used permanent=false and no cache/persistence. At 19:22 UTC,
actual autocomplete returned three features and a real driving-traffic route
returned 12,924 metres / 1,528 seconds. After owner confirmation, the opt-in
`scripts/mapbox_provider_smoke.py` completed with genuine autocomplete,
selected-ID resolution, Toronto resolution and directions. Temporary/permanent
smokes used independently selected public endpoints; their route totals are not
an assertion that different requests must have identical distances.

## Provider and browser outcomes

- **PASS — server API access and separation.** Both saved tokens are public-scope
  pk. tokens and distinct. A server public-scope token is supported; it remains
  server-side. Existing guards still reject a secret sk. browser token and reuse
  of one token for both roles. No account/token settings were changed. Dashboard
  URL restrictions and future staging-host allowance need operator verification.
- **PASS — real browser token access.** A fresh isolated Chrome context was
  verified at about:blank, then at the exact localhost:18085 frontend origin.
  Its direct fetch of the application's actual Mapbox light-v11 style returned
  HTTP 200, style version 8 with sources. This is browser style access, not proof
  of physical GPS or full trip-map rendering.
- **PASS — address autocomplete and confirmation.** The actual booking UI queried
  Mapbox through the real backend, selected an 8882 170 Street NW suggestion,
  confirmed provider postcode T5T 4J2, displayed the $15.00 fee, and enabled
  Continue. The screenshot was visually reviewed: existing Tide/lagoon styling
  is preserved. The previous unverified browser session was not reused.
- **PASS — postcode and explicit confirmation.** The real downtown address
  resolved with T5J 1A7. Submitting that postcode for the west address produced
  accepted=false / confidence=review. An otherwise valid address with
  clientConfirmed=false also remained unaccepted. This verifies Mapbox postcode
  matching and syntax, not independent Canada Post delivery certification.
- **PASS — service area.** Downtown resolved 0.58 radial km from the configured
  center, fee $0; west Edmonton resolved 8.93 km, inner-ring fee $15. A genuine
  Leduc civic location at 1 Alexandra Park resolved 31.92 km away and was rejected.
  Toronto resolved 2,705.61 km away and was rejected. Existing enabled radii remain
  6 / 14 / 25 km with flat fees 0 / 15 / 30; no business fee policy was changed.
- **PASS — provider substitution review.** The historical Leduc sample query
  (4950 Gateway Boulevard) actually returned an Edmonton match, rather than a
  reliable Leduc location. Existing confidence review prevented confirmation.
  This prompted an additional safeguard: a changed city or civic number now
  explicitly requires review even if the provider otherwise reports a strong
  match. A genuine selected Edmonton ID paired with a Leduc label returned
  accepted=false / confidence=review. Two new isolated regressions cover this.

## Booking, routing and financial outcomes

- **PASS — quote/booking amount authority.** Two synthetic 60-minute Swedish
  visits were booked through the owner-authenticated application API: downtown
  at 09:00 and west Edmonton at 11:30. The west request deliberately supplied
  downtown coordinates, central zone, zero fee and a false total/discount.
  The application retained Mapbox's west coordinates, z-inner and the correct
  pricing: treatment $120 + travel $15 + GST $6.75 = **$141.75**. Quote and saved
  appointment agree. The downtown travel fee remains zero.
- **PASS — actual directions/ETA.** The authenticated practitioner route API
  fetched driving-traffic and produced a 27-minute leg (depart 10:15, arrive
  10:42) between the stored synthetic locations. The real ETA service separately
  returned 13.61 km / 27 minutes, provider=mapbox-traffic, confirmed=false, with
  route geometry present. No fake GPS positions or confirmed arrival are claimed.
- **PASS — travel-time scheduling.** A 10:15 west appointment following a 09:00
  60-minute downtown visit was rejected with HTTP 409. Route-aware recommendations
  exclude that slot and, after the two accepted bookings, include 13:30 and later
  sufficiently spaced slots. No route warning exists for the accepted 11:30 visit.
  Recommendations/route display use actual provider travel time; final booking
  rechecks the existing conservative adjacent-travel guard. The owner's cleanup,
  setup and travel buffers remain 15 / 10 / 10 minutes. Current traffic on a
  future booking date is an estimate, not a guaranteed future journey duration.
- **PASS — navigation URL generation only.** The authenticated route output
  generated destination-specific Google Maps handoff links. Existing native
  Google/Apple/Waze handoff code is retained. **Physical launch/navigation is
  BLOCKED / NOT RUN** until an approved test device/build is available.
- **PASS — no unintended delivery or payment.** Notification, SMS and push
  accepted/sending/sent/delivered counts are zero; payment ledger count is zero in
  this Mapbox database. The prior real Stripe scenarios were not repeated.

## Failure handling and automated validation

During repeated setup requests the application's normal address lookup limiter
returned actual HTTP 429. Its window was allowed to reset naturally; limits were
not bypassed. This is application-limit evidence, **not a real Mapbox quota
exhaustion test**. We did not deliberately exhaust provider quotas or cause a real
outage. Timeout/503/provider-429 cooldown, fallback ETA and conservative scheduling
are validated by explicitly synthetic automated fault injection.

Final local backend run: **224 passed / five skipped**, including the two new
city/civic-number regressions and retained Stripe async coverage. The five ordinary
CI skips remain unchanged, including the live-Mapbox test: these real checks ran
separately in an unmocked application and are not retroactively counted as CI.
Frontend implementation is unchanged from the preceding 70-test/build pass; the
actual hosted local booking browser check above adds genuine provider evidence.
The pushed candidate's GitHub Actions result is recorded on Draft PR #1 after
completion, separately from local verification.

## Remaining gates and recommendation

Proceed with the next authorized browser/device/staging phase; **no release or
deployment approval** follows from these local results. Required next:

- Authorized physical Android device/build/signing identity for external navigation,
  permission denial, background/locked-screen GPS, reconnection and stop/expiry.
  Desktop URL generation and browser token access do not replace these checks.
- Provisioned, separately approved Hostinger staging hostname/HTTPS and isolated
  Compose services. Validate staging token origin restrictions and edge/container
  log redaction; the backend filter cannot sanitize Nginx/Hostinger logs.
- Dedicated Stripe sandbox HTTPS callback, endpoint-specific signing secret and
  native event redelivery against matching staging fixtures. Cards and Link where
  applicable remain the initial scope; delayed provider cases stay deferred.
- Separately authorized Resend test inbox/sender and Firebase project/device
  acceptance. All delivery stays disabled until that authorization.
- Existing security/recovery gates: historical credential reuse/rotation review,
  unpatched build-tool braces advisory allowance, image/OS scans and key custody.

See [provider activation handoff](PROVIDER_ACTIVATION_STAGING.md). No VPS, DNS,
deployment, merge, live payment or customer notification was performed.
