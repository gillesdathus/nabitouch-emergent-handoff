# Owner guide

Sign in with the owner account. Demo buttons appear only when demo mode is on, which production refuses.

- **Payments** shows collected amounts, outstanding balances, and historical import. Card payment is confirmed only after the bank notice.
- **Credentials** records association, registration, liability insurance, membership, municipal licence, or another requirement. A new row stays unverified until you choose Mark verified. Reminders use 60, 30, 14, and 7 days unless you change `credentialReminderDays` on settings.
- **Services** can be marked taxable or exempt. The default remains the clinic GST rate. Confirm the tax treatment with your accountant before relying on it.
- **Promos** are marketing. Sending a promotional notice fails when the client has not opted in, and the message cannot include clinical details.
- Refunds, credential verification, and clinical export ask for an authenticator code when privileged MFA is turned on.
- Reconciliation compares the stored invoice balance with the ledger. Repair updates the stored balance from the ledger and keeps every ledger line.

Historical spreadsheet import uses the Nabitouch column list. An authentic Noterro export was not available, so source compatibility stays unverified.
