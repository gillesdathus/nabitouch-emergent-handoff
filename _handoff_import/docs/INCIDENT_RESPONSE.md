# Incident response

1. Stop the affected action. For a payment incident, leave the ledger in place and stop new checkouts.
2. Record the time, the role that reported it, and the appointment or invoice id. Do not copy clinical note text or precise GPS into the ticket.
3. If a secret was exposed, follow `docs/SECRET_ROTATION.md` and revoke sessions by restarting with a new `JWT_SECRET`.
4. If a backup is required, restore into a new database name first (`docs/BACKUP_RESTORE.md`).
5. Clinical corrections are amendments. Do not edit a signed note in place.
6. Tell the owner before any client message. Marketing messages are separate from billing notices and require marketing consent.
7. A privacy incident that may involve health information needs the clinic's own privacy contact and professional advice. This software record is not that notice.

## Rollback

Return to the previous application build. Restore the pre-change database only when the bad release wrote data you cannot correct with a ledger reversal or a clinical amendment.
