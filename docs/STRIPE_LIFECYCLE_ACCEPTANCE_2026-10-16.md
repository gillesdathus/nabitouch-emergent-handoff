# Stripe lifecycle acceptance — 16 October 2026

**PASS for the card scenarios below; BLOCKED for overall Stripe acceptance.**
This extends the [earlier deposit evidence](STRIPE_SANDBOX_ACCEPTANCE_2026-10-16.md)
from commit `4a4eb113906a3e05e1c1db4e731cd8bcc1ea2d3f`. The original deposit was
not repeated. All provider objects were independently retrieved from Stripe's
real test API with `livemode=false`. No deployment, live payment, production data
access, customer notification, VPS/DNS change or merge occurred. PR #1 stays draft.

## Browser return repair — PASS

The previous local APP_URL pointed at the API-only server, which returned
`{"detail":"Not Found"}` for React routes. Both generated Checkout success_url
and cancel_url now resolve to the frontend route
`/me/billing/payment-result?session_id={CHECKOUT_SESSION_ID}`. Actual newly created
Stripe Sessions were retrieved to verify both URLs. Local frontend origin is
`http://localhost:18083`, proxying `/api` to `http://127.0.0.1:18082`.

The page uses the existing Tide/lagoon components and styling. Authenticated
backend verification alone determines confirmed, pending, failed, cancelled,
partially refunded or refunded status. Network/provider errors produce a visible
temporarily-unavailable state with retry. Session ownership is checked by the
backend; responses contain only status and monetary amounts, not clinical data.
Neither URL outcome hints nor a provider-paid GET can settle the ledger. A paid
checkout without its matching ledger entry fails verification. Old billing
return links forward to the new page without trusting `card=cancel`.

Returning from Stripe does not itself expire a Session. An explicit authenticated
"Cancel this checkout" action verifies expiry with Stripe, while the genuine
signed expiry event performs payment-review updates. The appointment is retained.

Browser checks used fresh isolated Playwright Chrome contexts, verified first at
about:blank and then at the exact Stripe origin/session path. The previous
unverified Chrome session was not reused. Real full-payment, 3DS and final-balance
redirects reached the working frontend page. Confirmed, partial/full refund,
declined and cancellation pages were observed. A deliberately interrupted status
request showed unavailable, then recovered to confirmed on retry; this is UI
fault injection, not delayed-provider acceptance. The actual result screenshot
was visually reviewed; screenshots and full provider URLs remain ignored.

## Genuine provider scenarios

All amounts below are CAD cents; identifiers are redacted suffixes.

- **Full appointment payment — PASS.** Session `cs_test_…YEWFyo`, complete/paid,
  amount 10,080; PaymentIntent `pi_…OcEnB2` succeeded; Charge `ch_…OjEwiT`
  paid; completion event `evt_…vD9uwn` processed/settled. Invoice NT-INV-00003
  initially had one payment, 10,080 received and zero balance; appointment paid.
- **Declined card — PASS.** Session `cs_test_…3icDAB`, open/unpaid; PaymentIntent
  `pi_…lIstyQ` requires_payment_method with insufficient_funds; failed Charge
  `ch_…qMvEAQ`, paid=false. Genuine failure event `evt_…nmKIRH` processed,
  not settled. NT-INV-00004 retains 10,080 due and zero payment records; the
  appointment remains confirmed/payment_required. The authenticated result page
  displays failure. A failed attempt does not make the still-retryable Session paid.
- **3D Secure authentication — PASS.** Session `cs_test_…eS4bAn` initially
  awaited authentication. Stripe's actual test issuer challenge was completed;
  PaymentIntent `pi_…gfAW7z` succeeded, Charge `ch_…cUfT33` paid, amount 10,080.
  Charge evidence records authentication_flow=challenge, result=authenticated,
  version=2.1.0. Completion `evt_…tOwg9j` settled once. NT-INV-00005 has one
  payment, zero balance and a paid appointment. Published Stripe test cards only
  were used; no card details are stored in Git or this report.
- **Abandoned/expired checkout — PASS.** Session `cs_test_…P7540Z` was left
  unpaid, then explicitly cancelled through the new authenticated browser action.
  Stripe reports expired/unpaid, no PaymentIntent or charge; genuine expiry
  `evt_…EFPp43` processed. NT-INV-00006 has zero payments, 10,080 due, and its
  appointment remains confirmed with payment review. The earlier naturally expired
  deposit Session `cs_test_…1g1UDz` / event `evt_…JzOM4h` remains separate
  historical evidence. No artificial async event is counted as expiry evidence.
- **Delayed success — BLOCKED. Delayed failure — BLOCKED.** Actual active/default
  payment-method configuration allows card and Link. ACSS debit, SEPA debit and
  BACS debit are unavailable/off; US bank account is absent. No suitable supported
  asynchronous method is available in this Canadian test environment. We did not
  enable methods or fabricate provider outcomes. Synthetic handler regressions
  cover async/out-of-order behavior but do not satisfy external acceptance.
- **Partial refund — PASS.** For the full-payment invoice, real Stripe refund
  `re_…gw77Ci` succeeded for 1,000. Genuine refund.created `evt_…C9Y6Lp` and
  refund.updated `evt_…5QWHbW` reconciled one refund row. Net received became
  9,080, balance 1,000; appointment and result page reflected the partial refund.
- **Full remaining refund / cancellation — PASS.** The application cancelled the
  appointment, retained its actual 9,080 received, and rejected new checkout with
  HTTP 409. Refund `re_…IflzPp` succeeded for 9,080; events `evt_…E1Fxor` and
  `evt_…NUCwri` reconciled the second refund. Total refund is 10,080, net zero.
  Refund alone leaves the issued invoice debt visible; an explicit owner void
  closes that debt. A discovered stale appointment balance after void was fixed:
  NT-INV-00003 is now voided, balance zero; appointment remains cancelled,
  paymentDue=refunded, paid=0, refunded=10,080, remaining=0. The browser shows
  "Payment refunded" and zero invoice balance.
- **Duplicate submissions/events — PASS for application idempotency.** Two
  concurrent real checkout requests returned HTTP 200 and the same decline-case
  Session; checkout count stayed one. A repeated 1,000 refund request returned the
  same provider refund; Stripe still lists exactly two refunds. Two locally
  re-signed replays each of genuine completion `evt_…vD9uwn` and genuine refund
  `evt_…C9Y6Lp` returned 200/200 with identical ledger rows and balances. Distinct
  genuine refund.created/updated/charge.refunded deliveries also did not duplicate
  refunds. Local re-signing is explicitly **not Stripe-native redelivery**.

## Deposit-to-balance and financial regression — PASS

The original 2,520 deposit on NT-INV-00002 was reused. One actual final-balance
Session `cs_test_…Samc5L` collected 7,560: PaymentIntent `pi_…l5arQx`, Charge
`ch_…4vxMis`, completion `evt_…ykc0bP`, all succeeded/paid/settled as appropriate.
Exactly two principal payments total 10,080; invoice balance and appointment
remaining are zero. A further one-cent checkout was rejected with HTTP 400.

The server-priced fixture is treatment 10,000 minus discount 1,400 plus travel
1,000 plus GST 480 = 10,080. Deposit was 25%=2,520. These amounts were verified
against provider totals, invoices, appointments and the append-only ledger.
Existing package-credit amount/ledger regressions pass locally; new package sale
and refund acceptance remain deliberately blocked and are not claimed here.

Final isolated-database report reconciliation:

- Four capture rows total 30,240: original deposit 2,520, remaining balance 7,560,
  full payment 10,080 and 3DS payment 10,080. Exactly two refund rows total 10,080.
- Collections: client payments $302.40, refunds $100.80, **net $201.60**, six
  transactions. Earnings independently shows **$201.60 collected**.
- Outstanding: $302.40 across three unpaid invoices, including the earlier unpaid
  fixture NT-INV-00001 and the decline/expired fixtures. These are intentionally
  unpaid synthetic debt, not missing provider captures.
- Revenue is invoice-based: $504.00 invoiced, $480.00 net of GST, $24.00 GST,
  $70.00 discounts, five nonvoid invoices; $100.80 voided excluded. These are not
  cash, Stripe payout or fee reports. Practitioner earnings rules likewise are
  accrual-based; no bank payout or fee reconciliation is claimed.
- No provider event remains in processing/retry. Actual Stripe refund API lists
  exactly 1,000 + 9,080 succeeded, matching the ledger.

## Webhook authenticity and notifications

The configured signing secret was compared in memory with the active forwarding
listener's secret and matched. Original CLI delivery logs record HTTP 200 for all
completion, decline, expiry and refund events listed above. The application
verified raw-body signatures before journaling/settlement; retrieved Stripe event
types and IDs match the application journal. Full event payloads, secrets, URLs,
test card values and full identifiers remain outside Git in ignored local files.

EMAIL_PROVIDER=disabled and all customer email/SMS/push switches stayed false.
Notification, SMS and push accepted/sending/sent/delivered counts remain zero.
No receipt address was configured by the application. Resend testing is separate.

## Regression validation and next gates

Final local isolated backend run: **210 passed / five skipped**. Frontend:
**70 passed / 19 files**, production build passed. The cancellation test assertion
was corrected to inspect the expiry POST rather than its subsequent read-only GET;
the final rerun has no failures. The five existing skips remain: one live Mapbox
check, three optional absent Deep Tissue 5-pack catalogue/credit checks, and one
generic hosted booking flow whose QA environment intentionally lacks credentials.
The formerly excluded Git-dependent secret-file check runs and passes. Provider
evidence above is separate from these synthetic regressions. Remote CI status is
reported on PR #1 after the pushed candidate actually finishes.

**Overall recommendation: BLOCKED / NO GO for complete Stripe acceptance or release.**
Required next: owner-approved eligible asynchronous sandbox payment method for CAD,
its real Checkout success and failure transactions, signed async events, and full
invoice/appointment/ledger/report reconciliation. For native redelivery, provide an
approved publicly reachable HTTPS test webhook endpoint and its own securely
provisioned endpoint signing secret; do not reuse the CLI secret there. No VPS,
DNS or HTTPS provisioning is assumed or authorized by this work.

Hostinger staging SPA must serve index.html for frontend routes, proxy /api to
FastAPI, and use its HTTPS frontend APP_URL/CORS origin. See existing
[Hostinger provisioning guide](HOSTINGER_STAGING_PROVISIONING.md); local validation
does not constitute staging deployment acceptance. New-plan reconciliation,
separately authorized Resend, full booking E2E, physical Android, image/OS scans,
recovery/key custody, historical credential reuse/rotation review and the exact
unpatched build-tool braces advisory allowance remain release gates.
