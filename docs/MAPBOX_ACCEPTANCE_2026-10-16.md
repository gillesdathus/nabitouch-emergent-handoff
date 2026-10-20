# Mapbox integration readiness — 16 October 2026

Latest: [real provider and local browser/application acceptance](MAPBOX_REAL_ACCEPTANCE_2026-10-16.md)
resolves the local credential blocker and records genuine Mapbox outcomes after
the owner authorized synthetic permanent geocoding. Device/staging gates remain.
The readiness observations below are the earlier snapshot at commit ab094744.

**Historical external acceptance: BLOCKED / NOT RUN.** No Mapbox server or browser token was
found in the normal local env-file locations or process environment. No real
Mapbox geocoding/directions transaction is claimed. The safe example smoke command
returned BLOCKED before any provider call. Synthetic tests below are separate.
No VPS, DNS, deployment, production data, live payment or customer delivery changed.

## Initial payment scope

The owner selected supported card payments and Link where applicable. Existing
[genuine card evidence](STRIPE_LIFECYCLE_ACCEPTANCE_2026-10-16.md), including deposit,
final balance, full payment, challenge authentication, decline, expiry and refunds,
is retained. Successful payments were not repeated in this phase. Link availability
is not a separate completed Link browser transaction. Delayed provider success and
failure tests are **DEFERRED / outside initial scope**, not passed. Do not activate
ACSS, SEPA, BACS, US bank or another delayed method merely to run optional tests.
Secure signed async handlers and automated regressions remain unchanged.
Stripe-native event redelivery remains a staging acceptance item.

## Existing architecture and changes

- AddressPicker debounces requests to backend `/api/geo/suggest`, `/check` and
  `/confirm`. Geocoder uses real Mapbox Geocoding v6 forward/reverse HTTPS when
  configured; the running application does not silently substitute sample results.
  Old asynchronous suggestions are now ignored after query changes/unmount.
- Confirmation now resolves the selected Mapbox ID instead of re-searching an
  editable label. Provider coordinates remain authoritative over client-supplied
  coordinates. Structured provider postcode is used even when absent from its
  display label. Invalid/nonfinite provider coordinates are discarded.
- A supplied postcode must be a complete Canadian postcode with Alberta T prefix.
  Mismatch with the provider postcode or low/medium provider confidence requires
  review. Postal syntax alone is not proof of an Edmonton address: existing
  owner-configured geographic zones and explicit client confirmation still decide
  eligibility. Nearby municipalities are subject to the same approved zones;
  do not substitute a guessed Edmonton-only polygon or postal-prefix boundary.
- Travel fees retain the existing server-owned zone flat/per-km rule, based on
  radial distance from the configured center, not Mapbox road distance. Clinic
  visits have no mobile fee. Quote/booking recomputes rather than trusting client
  zone, distance, fee, discount or total. No fee policy was changed.
- Practitioner trip ETA uses driving-traffic then driving; an unavailable provider
  produces a clearly labelled straight-line estimate, never confirmed arrival.
  Cache reuse now requires the same destination, not just a nearby origin.
  Schedule travel/cleanup conflicts and turnaround reuse the existing road-time
  helper; provider outage retains conservative nonzero travel or unavailable
  turnaround recommendations. Current traffic is not a future travel guarantee.
- Geocoding and routing retain bounded six-second HTTP timeouts. A provider 429
  now suppresses repeated requests for 60 seconds; Directions authentication
  errors also cool down. Geocoding has per-caller limits. No quota-exhaustion load
  test or fabricated live rate-limit result was performed.
- Existing Google/Apple/Waze handoff uses coordinates/address via the practitioner
  visit screen and native AppLauncher. This opens navigation externally; it is
  not an embedded Mapbox turn-by-turn navigation implementation or proof that a
  phone started navigation. Physical Android handoff remains NOT RUN.

## Storage, tokens and privacy

Mapbox's [Geocoding v6 documentation](https://docs.mapbox.com/api/search/geocoding/)
distinguishes temporary results (no caching) from permanent results (storage
allowed subject to account eligibility). Temporary searches now bypass the server
cache. Stored visit confirmation/reverse lookup fail closed unless the operator
sets `MAPBOX_PERMANENT_GEOCODING=true` after confirming account permission/billing;
requests then explicitly send permanent=true. This is an operational prerequisite,
not permission to alter provider account settings. The QA runner enables it only
for synthetic transport; it cannot certify account rights.

Keep MAPBOX_TOKEN server-only, least-privilege and separate from the browser's
URL-restricted pk. token REACT_APP_MAPBOX_PUBLIC_TOKEN. Existing build/runtime
guards reject secret browser tokens and reuse of one token for both roles. Public
tokens are visible in the browser bundle; server secrets must never be build args.
HTTP geocoding query strings are removed from application access logs; full Mapbox
URLs are redacted on provider logging records, including coordinate paths and
access_token. Provider failure messages do not expose request URLs. Review reverse
proxy logs separately before staging: default Nginx request logs may retain query
addresses. Do not enable raw HTTP debug logging or archive provider payloads.

## Automated validation

Final local validation: **222 backend passed / five skipped**, **29 additional
travel-outage passes**, **70 frontend passed / 19 files**, successful frontend
production build, and **seven staging preflight cases passed**. The safe example
provider-smoke invocation correctly remained BLOCKED and made no Mapbox request.

Twelve new isolated regressions cover postal mismatch/invalid input, confidence,
invalid coordinates, temporary storage, selected-ID confirmation, timeout/503/429,
quota cooldown, destination cache invalidation and privacy-safe logging. Existing
quote/mobile-address/scheduling/payment-policy tests and async Stripe regressions
are retained. Final test counts and actual remote CI run are reported on Draft
PR #1. Frontend has 70 passing tests and its production build succeeds with the
safe example origin; existing Recharts chunk warnings remain for browser review.
Seven staging preflight cases pass, including the new Mapbox phase guard.

No automated mock result is counted as external acceptance. The existing live
Mapbox test remains skipped in ordinary CI; the three optional Deep Tissue 5-pack
skips and generic hosted-booking skip remain distinct from provider acceptance.

## Exact next requirements and acceptance sequence

1. Securely provision backend/.env.mapbox.local with MAPBOX_TOKEN and, after
   confirming eligibility, MAPBOX_PERMANENT_GEOCODING=true. Use
   `backend/env.mapbox.example`. Provide its path, never values in chat.
2. Provision a distinct public token in frontend/.env.mapbox.local, using
   `frontend/env.mapbox.example`, restricted to approved local/staging origins.
   These named secret files are not automatically loaded by this custom Vite
   environment: the operator must explicitly inject the public variable at build
   or dev startup and load the server file into the isolated acceptance process.
   Do not source backend secrets into the frontend build.
3. In the existing API Python environment, opt into real contract smoke with
   `python scripts/mapbox_provider_smoke.py --env-file backend/.env.mapbox.local`.
   This calls actual geocoding and directions for public civic/commercial locations,
   prints coarse distances/durations only and touches no database. It is not full
   browser/booking acceptance. Never run the mock-installing QA server for this.
4. Start a separate synthetic acceptance application/database with real Mapbox
   transport, delivery disabled and sample catalogue false. Use a fresh verified
   browser context. Confirm Edmonton suggestions, chosen address/postcode,
   mismatched postcode review, out-of-zone Leduc/Toronto rejection and explicit
   confirmation; then verify the exact owner zone fee in quote and booking while
   attempting client fee/coordinate tampering.
5. Verify real driving-traffic/driving route geometry and positive duration between
   public endpoints; reconcile ETA displayed to the practitioner/client. Check
   a tight inter-visit slot is rejected and a sufficiently spaced slot accepted
   using actual provider duration plus existing cleanup policy. Record rounded
   distance/duration, status, timestamp and candidate SHA without patient data.
6. Exercise timeout/outage/429 via isolated fault injection, labelled as such;
   retain mocks in CI. Do not intentionally exhaust the real account quota.
   Verify no zero-travel false availability and no cached route to an old address.
7. Physically verify Google/Apple/Waze handoff on the applicable supported device,
   permissions, background GPS, stop/expiry and reconnection. Do not equate a URL
   opening or desktop browser route with real navigation/device acceptance.

Recommendation: proceed with credential provisioning and controlled Mapbox
acceptance. Card scope evidence remains accepted; release remains gated by real
Mapbox/browser/device checks, staging native webhook redelivery and independent
security/recovery/notification requirements. No hosting change is authorized.
