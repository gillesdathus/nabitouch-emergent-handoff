# Booking confirmation notifications

Booking emails use `nt_notifications`. That collection is separate from billing notices in `nt_notices`. Redis does not store the intent.

| State | Meaning |
|---|---|
| queued | A `pending` or `retryable-failed` row exists, or a `processing` row still holds a lease. The booking response does not wait for the provider. |
| provider accepted | The provider API returned an id. The row status is `sent`, `providerAcceptedAt` is set, and the audit line is `{ref} confirmation email sent`. |
| delivered | `deliveredAt` is set from a delivery receipt. Nothing in this app sets it from provider acceptance. |
| failed | `retryable-failed` waits for the next attempt. `permanently-failed` stops. `cancelled` means there was no usable recipient, including `@example.com`. |

A crash after the provider accepts the message and before the row is updated can send a second copy. The mock provider and the Emergent provider do not take an idempotency key for that gap. Atomic claims and leases stop two workers from sending the same unacknowledged row at the same time. An expired lease is claimed again.

The owner operations view is `GET /api/notifications/operations` and the owner dashboard card. It shows the booking reference, status, and error code. It does not include the message body, clinical notes, or insurance details.

## Resend

The launch provider is Resend. `EMAIL_FROM` is `Nabitouch <bookings@nabitouch.com>`. That address works only after Resend shows the domain `nabitouch.com` as verified. Add the DNS records Resend displays for that domain, and do not send until those records are in place.

`send_email` posts to `https://api.resend.com/emails` with the API key in the Authorization header. Booking mail passes the notification id as `Idempotency-Key`. A crash after Resend accepts the message and before the row is updated can still duplicate a send outside Resend's idempotency window. `sent` still means provider acceptance. `deliveredAt` stays empty until a receipt.

Resend signs receipts with Svix. The webhook URL is `https://nabitouch.com/api/notifications/resend`. Before the public site is switched, Nginx forwards only that path to the new API. Every other request on `nabitouch.com` stays on the current site. The endpoint checks `svix-id`, `svix-timestamp` within five minutes, and `svix-signature` against `RESEND_WEBHOOK_SECRET`. A bad signature is rejected and does not change a row. `email.delivered` sets `deliveredAt`. `email.bounced` and `email.complained` record that status and do not mark the row delivered. An empty webhook secret makes the endpoint refuse the call.

## Smoke test, not executed

After deployment approval, and only then:

1. Confirm the domain is verified and `EMAIL_FROM` is allowed.
2. Book a synthetic visit whose client email is `info@nabitouch.com`.
3. Confirm the outbox row reaches `sent` with a provider id, and the audit line says the confirmation email was sent.
4. Confirm the message arrives at `info@nabitouch.com`. A synthetic `NT-TEST2` confirmation to that address was accepted and delivered. Do not resend the earlier `admin@nabitouch.com` message.
5. Confirm a signed delivery webhook sets `deliveredAt`. An unsigned POST must be rejected. The receipt path can be checked before cutover because only `/api/notifications/resend` is forwarded to the new API.

Do not run this test during configuration preparation. `EMAIL_TEST_RECIPIENT` does not trigger a send.
