# Hostinger provider activation handoff — preparation only

Use the [existing Hostinger Docker Compose guide](HOSTINGER_STAGING_PROVISIONING.md).
This document authorizes no VPS/DNS changes, deployment or provider activation.
The VPS, hostname and HTTPS endpoint are not assumed to exist. Keep PR #1 draft.

## Prerequisites for a later authorized staging phase

- Record the approved candidate SHA/images, isolated Mongo/Redis destinations,
  staging-only encryption/JWT/owner secrets and recovery custody. No production
  dataset or volume may be attached. Establish health, backup and rollback checks
  from the hosting guide before exposing a callback.
- Confirm a dedicated staging hostname, valid HTTPS certificate and trusted proxy
  setup. APP_URL/CORS and the public frontend API origin must match that HTTPS
  origin. SPA fallback must serve payment-result routes; /api must reach FastAPI.
- Keep customer email/SMS/push, imports and gift cards disabled. No live Stripe
  key or real customer identity is permitted. Restrict tester/admin routes; only
  necessary signed provider callbacks bypass tester access restrictions.
- Review edge/container log formats: omit address query strings, tokens, cookies,
  raw webhook bodies and clinical records. The backend log filter does not sanitize
  Hostinger or Nginx logs. Confirm access, expiry and deletion for test evidence.

## Mapbox

Provision independent least-privilege server and URL-restricted pk. browser tokens
outside Git. Confirm Geocoding permanent-result eligibility before setting
MAPBOX_PERMANENT_GEOCODING=true. Only the browser token enters the frontend build.
Use `preflight.py --api-env <protected-api-env> --frontend-env <protected-frontend-env>
--mapbox-test` (add --stripe-test only for that explicitly authorized sandbox phase).
Preflight is read-only and cannot prove token validity, origin restrictions or
storage rights. Execute the real acceptance sequence in
[Mapbox readiness](MAPBOX_ACCEPTANCE_2026-10-16.md), then revoke obsolete tokens.

## Dedicated Stripe HTTPS callback and native redelivery

After separate endpoint/provisioning authorization, configure the intended Nabitouch
sandbox endpoint `https://<approved-staging-host>/api/billing/stripe/webhook`.
Subscribe to checkout.session.completed, checkout.session.expired,
checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
payment_intent.payment_failed, refund.created, refund.updated, refund.failed and
charge.refunded. Async handlers stay subscribed/covered although delayed methods
are outside initial launch scope. Do not enable extra methods solely for tests.

Store this endpoint's own signing secret as STRIPE_WEBHOOK_SECRET; a local CLI
listener secret belongs to that listener and must not be substituted. Keep the
server key test-only and PAYMENT_MODE=test. Retrieve existing genuine card evidence
without repeating successful charges merely to populate a report.

For native redelivery, select an actual event applicable to the **staging fixture**,
use Stripe's supported resend to that endpoint, and verify provider HTTP 2xx,
application signature verification and journal delivery count. Compare invoice,
appointment, payment/refund counts, balances and financial reports before/after;
all financial values must remain unchanged on duplicate delivery. Local events
reference a different isolated database: never resend them into an unprepared
staging database and claim settlement. If a new staging fixture is necessary,
create it only in that authorized sandbox phase. Record redacted event/session/PI
IDs and timestamps. Preserve retry errors and reconcile before any sign-off.

## Resend and Firebase — later, separately authorized

Resend needs an approved verified sender domain, protected API/signing credentials,
and one explicitly authorized test inbox. Prepare test-recipient redirection and
signed delivery/bounce checks. Keep EMAIL_PROVIDER=disabled and delivery switches
false until that phase is authorized; preflight deliberately rejects active Resend.

Firebase needs a dedicated staging project, appropriate Android app/package and
signing identity, protected server credentials and a physical test device. Prepare
token registration/refresh/removal, foreground/background notification and logout
tests. Keep PUSH_ENABLED=false/PUSH_DRY_RUN=true until separately authorized.
Never bundle service-account credentials or send notifications to customers.

## Stop and rollback

On a signature, privacy, settlement, health or destination mismatch, stop the
acceptance run, disable the affected staging integration, preserve redacted
evidence and follow the hosting rollback checklist. Restore approved staging
images/configuration only; do not drop databases or replay unverified financial
operations. Revocation/rotation and staging changes require their appropriate
authorization. No production rollback or deployment is part of this handoff.
