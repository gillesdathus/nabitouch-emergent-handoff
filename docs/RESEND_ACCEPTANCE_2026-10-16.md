# Resend integration and acceptance — 16 October 2026

**PASS: real read-only provider/domain/DNS verification. BLOCKED: real send,
inbox receipt and genuine webhook acceptance. No real email has been sent.**
Stripe and Mapbox acceptance evidence is preserved; those provider cases were not
repeated. PR #1 remains draft. No deployment, merge, DNS change, production data
operation, live-payment configuration change or customer notification occurred.

## Actual provider and DNS evidence

The owner saved a server API key and signing secret in ignored
`backend/.env.resend.local`. Read-only GET requests to Resend domains/webhooks
returned HTTP 200. No email-list/content API or application production endpoint
was queried.

- Domain `nabitouch.com`: provider status **verified**, sending capability enabled,
  receiving disabled, region us-east-1. This is account capability, not application
  activation or owner approval of a particular sender/message.
- DKIM: provider TXT selector `resend._domainkey.nabitouch.com` is **verified**;
  actual public DNS exactly matches the provider record. The public key itself
  is omitted from the report.
- SPF: provider CNAMEs `rsend.nabitouch.com` and `send.nabitouch.com` are both
  **verified** and exactly match actual public DNS. The root SPF separately uses
  Hostinger; it was not replaced or merged. Provider-returned records, rather
  than guessed legacy SPF/MX values, were compared.
- DMARC: actual `_dmarc.nabitouch.com` TXT is `v=DMARC1; p=none`. A policy exists
  but is monitoring-only; quarantine/reject enforcement is not claimed. DNS
  verification alone does not prove delivered-message SPF/DKIM/DMARC alignment;
  that requires the authorized message's actual received headers.
- An existing enabled Resend webhook points to
  `https://nabitouch.com/api/notifications/resend`, subscribed to email.delivered,
  email.bounced and email.complained. The saved signing secret matches this
  endpoint's provider metadata in memory. **This is not verification of a genuine
  event signature.** The endpoint was neither contacted nor changed.

The existing callback's environment has not been confirmed as isolated staging.
Since sending an email may automatically emit events to enabled account webhooks,
do not send while this could reach production. Identify a safe account/team and
callback arrangement first; do not disable or repoint the existing endpoint
without separate explicit authorization. No VPS/DNS/HTTPS availability is assumed.

## Implementation retained and completed

The existing emailer, Tide/lagoon templates, Mongo outbox, lease/retry worker and
signature-verified callback remain the architecture.

- Resend now receives branded HTML and corresponding plain text. Booking,
  cancellation/reschedule, invoice/receipt templates retain their existing business
  content. Email reminder intents reuse existing 24-hour/2-hour reminder windows,
  stay behind EMAIL_REMINDERS_ENABLED=false, and deduplicate by appointment state.
  Review invitations now use the durable appointment-linked outbox instead of an
  inline send. Generic billing-update mail also respects INVOICE_EMAIL_ENABLED
  and uses the outbox rather than silently sending on every billing change.
- EMAIL_ACCEPTANCE_MODE requires exact EMAIL_ALLOWED_RECIPIENTS and
  EMAIL_APPROVED_SENDERS matches and NOTIFICATION_WORKER_ENABLED=false. Neither a
  wildcard nor EMAIL_TEST_RECIPIENT redirection bypasses the original-recipient
  check. Redirection no longer includes the original person's mailbox in the
  subject. Saving a credential does not authorize a send or enable a worker.
- The owner-only `/api/ops/email/test` uses one fixed reviewed message. In acceptance
  it requires a stable Idempotency-Key and inserts a durable test intent. Manual
  processing claims only that notification ID; it cannot drain other queued mail.
  Reusing the same key returns its existing result rather than resending.
- Retries keep the same provider key. The stored envelope fingerprint detects
  changed recipient/content/configuration without storing message bodies; changed
  messages require review. Uncertain retries after 23 hours fail closed rather
  than outliving Resend's documented 24-hour key retention. Legacy uncertain rows
  use their older creation time conservatively and may need operator review.
- Signed receipts are journaled using only event/provider IDs, type, status and
  timestamps, with 90-day expiry. No raw recipient/body/clinical payload is stored
  there. A receipt arriving before provider acceptance is preserved and reconciled
  after its outbox row gets the provider ID. Periodic repair can finish pending
  reconciliation after a database/worker failure without another send.
- Delivered time is written only from verified receipt processing. Replayed
  events do not replace it. Bounce/complaint/failure/suppression remain visible in
  owner failure reporting and cannot be downgraded by a late delivered/delayed
  event. An API acceptance response alone does not prove delivery or inbox receipt.
- Raw-body Svix HMAC verification retains timestamp tolerance, constant-time
  signature comparison and multiple v1 signatures; invalid/empty base64 secrets
  fail closed. Genuine signature acceptance remains untested until a safe real
  callback is available.
- No clinical notes, intake responses, consent signatures or private address notes
  enter the whitelisted templates. Sentinel regressions cover eight required
  message types in both rendered HTML and generated plain text. Provider error
  logs contain status codes, not raw response bodies or credentials.

The local Resend file still has EMAIL_PROVIDER=disabled, the worker disabled and
empty recipient/sender allowlists. All automated lifecycle, reminder, invoice,
statement, review, SMS and push delivery flags stay disabled. Existing Stripe and
Mapbox local environments were not changed to enable email.

## Reviewable first-message proposal — NOT SENT

Sender candidate: `Nabitouch <bookings@nabitouch.com>`; reply-to candidate:
`info@nabitouch.com`. These are existing configured identities, **not yet explicitly
approved by the owner**. Recipient: **not selected/authorized**.

Subject: **Nabitouch email test**

Main body: “Hi there, This is a controlled Nabitouch transactional email test.
No action is needed. This message contains no appointment or health information.”

The existing branded frame adds Nabitouch's tagline, support/account links,
Edmonton timezone note and no-password/card-details notice. HTML/plain-text preview
files and a rendered screenshot are in ignored test_reports; the screenshot was
visually reviewed. The proposed first send contains no real or synthetic visit data.

Before sending, the owner must explicitly name and approve the inbox, sender and
this exact message. A reply saying only “saved” has been treated as credential
provisioning, not send approval. Separate authorization is required for subsequent
booking/reminder/cancellation/reschedule/invoice/receipt/review test messages or
Resend's documented bounce simulator. Nothing sends automatically after approval.

## Acceptance procedure and prerequisites

1. Confirm whether the existing callback is production. Provide an approved
   isolated HTTPS test callback/account arrangement and its own secret. Do not
   route test events into production or reuse an unrelated endpoint secret. A
   separately authorized tunnel could serve a local test application; none was
   provisioned here.
2. Obtain explicit inbox/sender/message approval, then set exactly that recipient
   in EMAIL_ALLOWED_RECIPIENTS and EMAIL_TEST_RECIPIENT and the approved sender in
   EMAIL_APPROVED_SENDERS. Use a separate synthetic acceptance database, no worker,
   and no automated flags. Keep payments disabled in this isolated Resend phase.
3. Use the read-only staging preflight's `--resend-test` only for the separately
   approved configuration. It requires one recipient, sender approval, worker off,
   test credentials and all automatic flags off. It neither sends nor grants
   authorization and cannot verify callback isolation or domain ownership.
4. Submit the fixed owner test once with one stable key. Record redacted provider
   email ID, outbox ID, HTTP result, timestamps and template version. Repeating the
   same operation must leave provider and outbox counts unchanged. Never generate
   a replacement key just because an API response timed out.
5. Retrieve that authorized email's provider status; independently confirm actual
   inbox receipt and received authentication headers through an approved mailbox
   or owner observation. Provider delivered status alone is not inbox verification.
6. Verify the genuine signed delivered webhook, endpoint-specific secret, raw-body
   signature result, journal and notification status. Replay through the provider
   where supported and demonstrate no duplicate send/state downgrade. Locally
   re-signed fixtures are automated evidence only, not genuine event delivery.
7. If separately approved, send to Resend's documented `bounced@resend.dev` simulator
   with its own exact approval/key. Distinguish a provider-generated simulation
   from a real human inbox bounce. Do not use a real customer's mailbox to induce
   failure or spam complaints. Provider outages remain synthetic fault injection.
8. Review every transactional template in the owner's inbox only under separate
   message approvals. Keep all automated switches off; no acceptance result
   authorizes production notification activation.

Implementation tests run only with mock providers and isolated Mongo. Final local
validation: **240 backend passed / five skipped**, **29 additional outage passes**
and **eight staging-preflight cases passed**. Sixteen new isolated Resend cases
cover recipient/sender restrictions, plaintext, template privacy, reminders,
review queuing, stable test intent, payload/window protection, early/duplicate/
out-of-order receipts and receipt repair. The actual pushed-candidate CI result
is reported on Draft PR #1 after completion;
no passing regression is presented as real email delivery acceptance.

References: [Resend signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests),
[idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys),
[domain records](https://resend.com/docs/api-reference/domains/get-domain),
[documented test recipients](https://resend.com/changelog/sending-test-emails).
Next device phase: [Firebase Android physical-device plan](FIREBASE_ANDROID_ACCEPTANCE.md).
