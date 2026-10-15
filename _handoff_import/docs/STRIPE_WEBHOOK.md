# Stripe webhook

Card money is recorded only after `checkout.session.completed` with a valid signature and an `amount_total` that matches the outstanding balance. The return URL reports `confirmed: false`.

## Not verified against Stripe

No `sk_test_` key or webhook secret was available in this workspace. `GET /api/billing/stripe/status` returns `externalVerification: not-run`. Local tests cover signature checks, expiry, amount mismatch, replay, and a second session that must not overpay. They do not call `api.stripe.com`.

## When a test key exists

1. Set `STRIPE_SECRET_KEY` to a key that starts with `sk_test_`. A live key returns 503.
2. Set `STRIPE_WEBHOOK_SECRET` from the Stripe endpoint, or from `stripe listen` in a sandbox.
3. Point the endpoint at `POST /api/billing/stripe/webhook`.
4. Send `checkout.session.completed`, `checkout.session.expired`, a duplicate event, an out-of-order `payment_intent` event, and a session whose amount does not match the invoice.
5. Confirm the ledger gained one client payment and the invoice balance matches. Confirm an expired session does not.

Do not enable live payments from this document. That needs a separate owner decision.
