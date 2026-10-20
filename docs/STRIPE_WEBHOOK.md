# Stripe webhook

Card money is recorded only after `checkout.session.completed` or `checkout.session.async_payment_succeeded` with a valid signature, `payment_status=paid`, and an `amount_total` matching the stored checkout charge. The payment must fit the outstanding invoice balance. The return URL reports `confirmed: false`.

## Not verified against Stripe

No `sk_test_` key or webhook secret was available in this workspace. `GET /api/billing/stripe/status` returns `externalVerification: not-run`. Local tests cover signature checks, expiry, amount mismatch, replay, and a second session that must not overpay. They do not call `api.stripe.com`.

## When a test key exists

1. Set `STRIPE_SECRET_KEY` to a key that starts with `sk_test_`. A live key returns 503.
2. Set `STRIPE_WEBHOOK_SECRET` from the Stripe endpoint, or from `stripe listen` in a sandbox.
3. Point the endpoint at `POST /api/billing/stripe/webhook`.
4. Send paid and unpaid `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, a duplicate event, an out-of-order `payment_intent` event, and a session whose amount does not match the stored checkout charge.
5. Confirm the ledger gained one client payment and the invoice balance matches. Confirm an expired session does not.

Do not enable live payments from this document. That needs a separate owner decision.

On 15 October 2026, signed synthetic events reproduced and then verified a fix for premature settlement of unpaid Checkout completion and ignored delayed success. These tests insert a synthetic pending checkout and exercise the actual webhook and ledger; they do not create a session with Stripe. See `backend/tests/test_checkout_reconciliation.py`. This follows Stripe's [Checkout payment status guidance](https://docs.stripe.com/payments/checkout/fulfill-orders).
