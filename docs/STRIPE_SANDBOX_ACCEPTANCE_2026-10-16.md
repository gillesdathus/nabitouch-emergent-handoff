# Real Stripe sandbox deposit acceptance — 16 October 2026

Historical deposit snapshot: subsequent balance collection, refunds and the repaired
frontend return are recorded in the [lifecycle report](STRIPE_LIFECYCLE_ACCEPTANCE_2026-10-16.md).
The original deposit evidence and amounts below describe their original observation.

**PASS for one real deposit payment and application-side settlement.** Full
Stripe lifecycle/release acceptance remains incomplete. Evidence checked at
09:40 MDT (15:40 UTC) against implementation commit
`bf09e318b4daa2d9fe194d21517892031b229dee` on
`feature/codex-production-readiness`. PR #1 remains draft.

## Environment and scope

The owner-provided server key was authenticated against the **nabitouch** Canadian
Stripe test account; the retrieved Session, event and Charge all have
`livemode=false`. A fresh local Mongo replica/Redis/application stack uses a
synthetic acceptance database, loopback API port 18082 and real outbound Stripe
HTTPS. Stripe CLI forwards actual test events to `/api/stripe/webhook`.

The application signing secret was compared with the **active CLI listener's**
secret and matched. The unrelated Dashboard signing secret was not used. Secret
values, raw event payloads, full provider identifiers, Checkout URLs and card
details are excluded from this report and Git. Operator evidence remains in the
ignored `test_reports` directory; credentials remain in ignored local env files.

The appointment/client fixture is synthetic and its quote comes from the existing
server pricing function. Staff draft/issue and Checkout creation used the real
application APIs. This verifies the invoice payment path; it does not certify
browser booking, Mapbox, Hostinger deployment or physical Android behavior.

## Provider evidence

- Original Session: `cs_test_…1g1UDz`, **expired / unpaid**, CAD 2,520 cents; no
  PaymentIntent/charge. Its actual `checkout.session.expired` event
  `evt_…JzOM4h` was confirmed through Stripe's event API and processed by the
  application. The CLI delivery log records HTTP **200**.
- Exactly one replacement Session was created for the same invoice with a
  different Stripe idempotency key: `cs_test_…Y4FEOx`.
- The owner manually completed that actual hosted Checkout using Stripe's
  published test-card flow. Stripe independently reports the replacement
  **complete / paid**, CAD **2,520 cents**.
- PaymentIntent: `pi_…ocUSgH`, **succeeded**, amount received **2,520 cents**.
- Charge: `ch_…dcGJwN`, **paid=true**, amount **2,520 cents**, currency **cad**.
  Its PaymentIntent matches both the provider PaymentIntent and ledger reference.
  The Charge has no receipt email configured.
- Completion event: `evt_…EXqhmx`, type `checkout.session.completed`. It was
  retrieved independently from Stripe's event API and matches the paid Session.
  Nabitouch's event journal records **processed / settled=true**.
- The active CLI log independently records HTTP **200** for that original
  completion event. The production webhook code verifies raw-body HMAC and
  timestamp before writing the journal or settling the ledger.

The real API initially rejected an invalid beta header. The local fix moved
`integration_identifier` into the Checkout create form and kept Stripe-Version
as `2026-08-26.dahlia`. It was regression-tested, committed and pushed as the
implementation commit above before the owner completed payment.

## Invoice, appointment, ledger and reports

Invoice **NT-INV-00002**, identifier ending `c122e6`, belongs to the synthetic
appointment ending `8c65c6`. The persisted server quote is:

- Treatment: **10,000 cents**.
- Approved synthetic discount: **1,400 cents**.
- Travel: **1,000 cents**.
- Taxable subtotal: **9,600 cents**; GST 5%: **480 cents**.
- Invoice total: **10,080 cents**; configured 25% deposit: **2,520 cents**.

Exactly **one** `client_payment` ledger record exists, `led_…a970a0`, method
Stripe, amount **2,520 cents**, tied to this Session and PaymentIntent. The
invoice is **partially_paid**, received **2,520**, balance **7,560 cents**.

The appointment remains **confirmed**. Its paymentDue is **partially_paid**,
paidCents **2,520**, remainingCents **7,560**, refundedCents **0**, prepaid=false.
The deposit was not mistaken for full payment or an appointment cancellation.

The collections report shows **one transaction / $25.20 net collected**. The
invoice's earnings row shows **$25.20 collected / $75.60 balance**. The isolated
database also contains an earlier unpaid fixture from the initially rejected
Checkout request: aggregate invoiced **$201.60** and outstanding **$176.40**
include that fixture. These aggregate totals are distinct from this invoice's
$100.80 total / $75.60 balance. Existing invoice-based GST/revenue and commission
rules are unchanged; these reports are not Stripe net-payout/fee reconciliation.

## Signature rejection and duplicate-processing result

After the genuine signed delivery had settled the payment, the same real event
was retrieved from Stripe and **re-signed locally with the active listener
secret**. This is application replay testing, **not Stripe-native redelivery**.

- Invalid signature: HTTP **400**, rejected.
- Two correctly signed replays: HTTP **200 / 200**, settled=true.
- Event delivery count: **1 → 3**.
- Payment ledger count: **1 → 1**.
- Received/balance: **2,520 / 7,560 cents**, unchanged.

Thus genuine external payment/webhook acceptance and local duplicate-processing
testing are separately evidenced. No synthetic transaction substituted for the
real paid Session.

## Customer delivery and browser return

EMAIL_PROVIDER=disabled; invoice/lifecycle/statement email, review invites, SMS
and push flags remain false; PUSH_DRY_RUN=true. Application email/SMS/push rows
with sent, sending, delivered or provider-accepted markers: **zero**. The actual
Stripe Charge's receipt_email is absent.

The browser displayed `{"detail":"Not Found"}` after payment because this local
harness uses an API-only origin for APP_URL and does not serve the React billing
route there. Stripe and the signed webhook independently proved payment success.
This return-page UX is **not accepted**. A later browser E2E run must use the
frontend origin with correct SPA routing and API proxy, such as the prepared
Hostinger configuration. No browser automation was resumed in an unverified
Chrome state.

## Validation and remaining gates

The three-file API correction passed **26 targeted regressions**. Actual
[GitHub Actions run #5 succeeded](https://github.com/gillesdathus/nabitouch-emergent-handoff/actions/runs/38923727893)
for the implementation commit: **206 backend passed / five skipped**, **29 ETA
outage passes**, **60 frontend passed**, successful frontend/runtime builds,
six preflight cases and clean Python audit. The known frontend braces warning
and historical credential-rotation review remain open.

**Recommendation:** PASS for this single deposit/backend webhook/reconciliation
case; **NO GO for full Stripe lifecycle acceptance or release**. Remaining real
scenarios include full payment, decline, required authentication, delayed
settlement/failure and refunds/cancellation reconciliation. Stripe-native event
redelivery needs an approved reachable endpoint. New plan purchase/refund credit
reconciliation, correct frontend return/browser E2E, separate Resend delivery
authorization, physical Android validation and other documented release gates
remain outstanding. The original five generic QA skips remain explicit in
[the implementation QA report](CODEX_STRIPE_QA_2026-10-16.md).

No live charge, production-data access, customer notification, merge, staging or
production deployment, VPS or DNS change was performed.
