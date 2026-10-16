# Stripe sandbox integration and acceptance

Latest: [card lifecycle and return UX acceptance](STRIPE_LIFECYCLE_ACCEPTANCE_2026-10-16.md)
passes full payment, 3DS, decline, expiry, refunds and deposit-to-balance collection.
Delayed success/failure remain BLOCKED. Overall Stripe acceptance is incomplete.

Historical status: **one real deposit/backend settlement accepted** on 16 October 2026;
full lifecycle acceptance remains incomplete. The owner-provided Nabitouch test
key and real CLI forwarding verified a paid CAD $25.20 Checkout, succeeded
PaymentIntent/Charge and signed webhook settlement. See the redacted
[real acceptance evidence](STRIPE_SANDBOX_ACCEPTANCE_2026-10-16.md), including
local replay testing and the local frontend-return limitation. No approved
public staging endpoint is assumed. No VPS, DNS, HTTPS, production data or
customer delivery was changed.

## Implemented invoice flow

The existing pricing, payment policy, append-only invoice ledger, appointment
paymentDue projection and financial reports remain the source of truth.
An authorized staff member drafts and issues the server-priced appointment
invoice before the customer opens Checkout. Guest payment authentication and
automatic invoice issuance are not introduced by this change.

- `POST /api/invoices/{invoiceId}/checkout` creates actual Stripe-hosted payment
  Sessions through Stripe's HTTPS API when PAYMENT_MODE=test. Integer CAD cents
  come from the issued invoice and policy, including its existing GST, travel,
  discounts and prepaid-credit calculation. Insurance is not treated as money
  received. Tips are separate from invoice principal.
- A durable checkout reservation and deterministic Stripe Idempotency-Key are
  shared by concurrent submissions/retries for the same invoice version. An open
  request with different amount/tip returns 409. After expiry, the server must
  verify the previous Session is expired before starting its next generation.
  Uncertain creation beyond expiry requires operator reconciliation.
- The default client deposit is preserved when no amount is supplied; the former
  insurance-share cap accidentally replaced it with the full balance. A cancelled
  visit cannot start a new Checkout, but an already-started payment still records
  its real outcome and stays subject to owner refund review.
- Both browser return endpoints are read-only. They display the state recorded
  by a signed webhook and cannot record a payment, including plan returns.
- Raw-body HMAC verification accepts rotated v1 signatures and enforces a
  five-minute timestamp tolerance. Live events/keys are rejected. Checkout
  completion requires paid status, correct CAD amount and payment reference.
  Unpaid completion waits for async success; expiry/async failure sends the
  existing booking to payment review without releasing the appointment.
  Late success cannot reopen a cancelled visit or be undone by a late expiry.
- Success records Session, PaymentIntent and event references on the ledger and
  checkout. Financial mutations use the existing transactional/journal mutator.
  Replay uses the Session/refund identity, not event identity. Follow-up updates
  are repairable by retry after a partial failure. Unknown Checkout/capture and
  conflicting financial updates return non-2xx so Stripe can retry.
- A safe event journal stores IDs, type, retry status and delivery counts; it
  does not store raw Stripe payloads, emails, card data or credentials.
- Owner invoice refunds call Stripe with a durable operation key. The API
  response does not change the ledger. Only signed successful refund events do.
  Pending/failed refunds do not reduce collected money. Out-of-order refunds
  await capture. Dashboard refunds also reconcile via refund.created/updated
  and charge.refunded (complete paginated refund list). Invoice principal is
  refunded first; any remaining provider refund reverses captured tips, once.
- `/api/billing/reconciliation` links invoice, Session, PaymentIntent and ledger,
  exposes retry counts and preserves externalVerification=not-run. This is a
  local ledger diagnostic, not proof of provider acceptance.
- Earnings now uses the already-net ledger received amount; it previously
  subtracted refunds twice. Collections and invoice projections remain net.
- Sandbox startup requires disabled email/SMS/push flags. Billing notifications
  are also suppressed in test mode. Do not enable Resend as part of this phase.
  Disable Stripe Dashboard automatic test receipts and use synthetic identities.

## Deliberately blocked paths

The historical plan refund code changes credits before confirming a provider
refund. New wellness-plan purchases/subscriptions and plan refunds therefore
fail closed in PAYMENT_MODE=test until per-credit refund reservation and signed
refund reconciliation are implemented and accepted. Existing package credits
still reduce the appointment quote; this is distinct from selling/refunding a
new package. The optional Deep Tissue 5-pack catalogue is not auto-seeded.
Gift cards remain disabled. The legacy simulated appointment refund route cannot
act on provider payments. Historical Stripe ledger rows lacking PaymentIntent
references require secure operator reconciliation before a refund.

## Required configuration and access

1. Identify the intended **Nabitouch dedicated sandbox** and account owner. Do
   not select the currently connected live account for payment calls. Provision
   a server-only sandbox key (`sk_test_` or appropriately permitted `rk_test_`)
   using a protected environment/secret file. For local forwarding, authenticate
   `stripe login` to that intended test account and inspect `stripe whoami
   --format json` without printing keys. Never use `stripe config --list`.
2. Prepare the isolated Hostinger environment using
   [HOSTINGER_STAGING_PROVISIONING.md](HOSTINGER_STAGING_PROVISIONING.md).
   Actual VPS, domain, DNS and HTTPS provisioning require separate authorization
   and are not assumed complete. Use only synthetic staging MongoDB data and
   authenticated Redis. Confirm real Mapbox configuration if exercising booking
   address validation rather than using already-confirmed synthetic bookings.
3. Merge [stripe-test.env.example](../deploy/staging/stripe-test.env.example)
   into the protected full api.env outside the repository. Use PAYMENT_MODE=test,
   enable only card checkout, keep every customer delivery provider disabled.
   Leave all secrets out of frontend builds, Compose output and PR attachments.
4. In the sandbox, register `https://<approved-staging-host>/api/stripe/webhook`
   (alias `/api/billing/stripe/webhook`) and install that endpoint's whsec signing
   secret server-side. Keep the webhook public to Stripe POST requests with raw
   body and Stripe-Signature intact; do not put it behind browser/CSRF auth.
   Existing application user APIs remain authenticated. Use a single endpoint
   to avoid unnecessary alias duplicates. Sync server time.
5. Subscribe to checkout.session.completed, checkout.session.expired,
   checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
   payment_intent.payment_failed, refund.created, refund.updated, refund.failed,
   charge.refunded. Invoice/membership events are not acceptance for the blocked
   new-plan flow. Keep the endpoint/API version aligned with the gateway's
   2026-08-26.dahlia version; integration identifier is Nabitouch-specific.
6. A public VPS endpoint is not required for **local** provider verification if
   the approved sandbox CLI can forward real events to the local API:
   `stripe listen --forward-to http://127.0.0.1:8000/api/stripe/webhook`.
   Use the listener-specific signing secret; it differs from a Dashboard endpoint
   secret. This needs authenticated sandbox access and a separately configured
   non-mocked local application with outbound Stripe connectivity. The disposable
   qa_runner intentionally removes provider credentials and is NOT that app.
   CLI-triggered fixture events alone do not prove an app-created Checkout works.
7. Validate without printing values:
   `python deploy/staging/preflight.py --api-env <protected-api.env> --frontend-env <protected-frontend.env> --stripe-test`.
   Initial preflight without --stripe-test still forbids Stripe credentials and
   enabled checkout. A passing preflight is not deployment authorization.

## Genuine provider acceptance procedure

The linked acceptance report verifies one deposit and real signed completion,
original expiry, local replay and signature rejection. Other scenarios below
remain pending, including correct browser return UX and real refunds.

Use synthetic customers with synthetic addresses and no production data. Have
staff issue each invoice, then use its authenticated Nabitouch Checkout action;
complete the **returned hosted URL** using Stripe test cards. Never send raw
card details through Nabitouch or save them in logs. Official test cards:
[Stripe testing](https://docs.stripe.com/testing). Test successful payment,
insufficient-funds decline, and required authentication using that reference.

For each scenario record UTC time, Git SHA, sandbox context, redacted invoice /
appointment IDs, Session `cs_test_…<last6>`, PaymentIntent `pi_…<last6>`, event
`evt_…<last6>`, optional refund `re_…<last6>`, expected/actual integer CAD cents,
provider status, webhook delivery HTTP status, and ledger/report comparison.
Store full event payloads and full customer details outside Git; never include
keys, signing secrets, cookies or card details in evidence. No identifiers below
have been invented as provider evidence.

- Deposit: confirm exactly the configured server deposit, GST-inclusive quote,
  one payment ledger row, remaining balance, appointment paymentDue and report.
- Full payment: confirm total outstanding principal plus separately selected tip;
  one ledger payment and one tip, zero invoice balance, matching PaymentIntent.
- Decline and authentication: decline must leave invoice unpaid; closing 3DS must
  not settle; complete required authentication and wait for the signed webhook.
- Abandonment/expiry: abandon and expire the actual Session via sandbox Dashboard
  or API. Confirm payment review and no automatic calendar release. A browser
  cancel link alone is not a provider expiration event.
- Duplicate submission: two concurrent app requests must produce the same Session
  and one external payment. A different amount on that open attempt is refused.
- Replay: resend an actual delivered event from Stripe Dashboard/CLI. Confirm
  delivery count increases and ledger, tips and financial totals stay unchanged.
- Delayed settlement: use an eligible sandbox asynchronous payment method, if
  available for this CAD account. Confirm unpaid completion is pending and only
  async success settles. If the account has no eligible method, record this
  scenario as BLOCKED; synthetic events cannot replace external acceptance.
- Refund: initiate an owner partial/full invoice refund and a Dashboard refund.
  Await real signed events, replay them, compare provider refunded amount, ledger
  net collected, appointment paid/refunded/remaining amounts, collections,
  earnings and refunds reports. Cancel an appointment before late payment and
  before refund; cancellation must not itself assert money was refunded, reopen
  the visit, or trigger automatic cancellation fees/notifications.
- Invoice integrity: repeat with approved discount, travel fee, GST and existing
  package credit. Verify the persisted server quote and outstanding balance;
  browser total/tax/discount tampering must not change the Session amount.

## Reconciliation and rollback gates

Synthetic regression example: deposit 2,520 cents, signed refund 1,000 cents,
net collected 1,520 cents, invoice balance 8,560 cents on a 10,080-cent invoice.
Provider acceptance must independently establish the same relationships using
real sandbox objects. Tips never count as treatment/GST revenue. Stripe fees,
payouts and bank settlement are outside the existing gross collections report;
do not label that report a Stripe net-payout reconciliation.
Revenue/GST reports remain invoice-based; this change does not introduce tax
credit notes or alter practitioner commission rules. Net collections and refunds
must be reconciled separately from invoiced revenue and amounts paid out.

Before any later authorized deployment: record release SHA/images and protected
config version, make a synthetic-data backup and verify restore, check API/DB/
Redis health, inspect webhook pending/retry queue and invoice reconciliation.
If payment errors occur, disable card checkout first, retain event/operation
journals, preserve webhook handling while investigating captured funds, and
restore the previous API/web image only after confirming webhook compatibility.
Do not replay/refund uncertain payments under a fresh operation key. Do not
restore an old database over newer payment events; reconcile money first using
the existing [rollback guide](BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md).

Release recommendation: **PASS for the evidenced single deposit/backend case;
NO GO for full Stripe lifecycle acceptance or production** until every applicable
genuine transaction/webhook scenario and browser return above are verified.
The local sandbox credentials/listener have now been verified; a public staging
endpoint remains unprovisioned. New plan payment/refund
reconciliation remains a separate implementation prerequisite. Resend, browser
E2E and Android physical-device acceptance follow with separate provider access
and notification authorization; iOS/APNs remain deferred.

References: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment),
[webhook security and delivery](https://docs.stripe.com/webhooks),
[idempotency](https://docs.stripe.com/api/idempotent_requests),
[refund events](https://docs.stripe.com/refunds).
