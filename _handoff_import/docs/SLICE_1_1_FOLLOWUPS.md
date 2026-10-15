# Nabitouch — work still required after Slice 1.1

_Written for the owner review before Slice 2. This is an engineering agenda. It is not a privacy certification, a legal opinion, or a claim that the application meets PIPA, PIPEDA, HIA, or CASL._

Slice 1.1 does not change the security controls landed in `91358ca`. It adds regression tests and this record.

## Credential rotation

Do this before any shared or production deploy. Do not paste the old values into tickets, chat, or new files.

These names were committed as usable fallbacks or sample commands, and they remain in git history even where the current files no longer contain them:

| Location | What to rotate | Current tree |
|---|---|---|
| `auth_testing.md` history | Owner password, and any JWT signed while that password was current | Sample password removed in Slice 1 |
| `backend/tests/backend_test.py`, `test_tracking.py`, `test_live_gps_and_email.py`, `test_client_registration.py` history | Owner password and demo password | Fallback defaults removed in Slice 1 |
| `backend/tests/test_password_reset.py` | The sandbox mailbox password, if that mailbox password was reused anywhere else | The test still chooses a password for a user it creates |
| `test_reports/iteration_7.json` | Demo password and the sandbox mailbox password, if reused | Still in the current tree |

Also rotate, if they were ever set on the Emergent preview or any shared host: `JWT_SECRET`, `EMERGENT_EMAIL_KEY`, `MAPBOX_TOKEN`, `REACT_APP_MAPBOX_PUBLIC_TOKEN`, and the preview MongoDB password.

Rotation order:

1. Set new values only in the host environment or a secret store. Keep them out of git.
2. Restart every API process so new sessions use the new `JWT_SECRET`. Logout and password reset now revoke sessions, but tokens signed with the old secret stay valid until that secret is gone.
3. Change the owner password in the database by a normal reset after the new `OWNER_PASSWORD` is in the environment. Startup no longer overwrites an existing hash, so changing only the environment variable does not change the stored owner password.
4. Replace the demo password the same way for any preview database that still has the old demo users.
5. Revoke the old Mapbox and email keys in those vendors' dashboards.
6. Treat a history rewrite as a separate decision. Rotation is required even if the old commits stay in the repository.

## Clinical privacy, encryption, and retention

Still not built, and not claimed:

- Signed SOAP notes cannot be reverted to draft. An amendment is not yet a new document with a reason and the previous version. There is no read audit when a note is included in `/api/state`.
- Insurance member and policy identifiers are still plaintext fields on `nt_clients`. Card images are not stored today. Nothing in Slice 1.1 encrypts them.
- Marketing consent is a boolean. There is no privacy-notice version and no export or deletion workflow.
- Retention and deletion wait on counsel and the professional college. Do not add a deletion job until that period is written down.
- Desk users still do not receive SOAP, including when `receptionPerms.clinical` is turned on. That flag does not grant chart access.

## Tracking architecture

The current behavior, which Slice 3 should replace rather than silently change:

- One in-process store holds the latest fix for an active trip. Demo reset clears it. Ending or restarting a trip drops that fix and removes `location.updated` and `eta.updated` from the in-memory event buffer.
- Precise tracks are not written to MongoDB. That should stay true unless the owner approves a retention decision in writing.
- The store is not shared across processes and has no TTL beyond process lifetime. A second worker, or a restart, drops or splits live trips.
- Mapbox Directions remains the road ETA for the one-practitioner trial. The public token must stay out of server logs, and the secret token must stay out of the frontend bundle.
- The unused `role:subject` tracking header stays unused.

## Payments and email

- `/payments/{id}/webhook` rejects every caller until a signed Stripe webhook exists.
- `/payments/{id}/simulate` works only when the process is not production and `PAYMENT_MODE=simulated`.
- `EMAIL_PROVIDER=mock` records a message id for tests. `EMAIL_PROVIDER=emergent` can still send through the old HTTP proxy outside production. Production startup refuses that provider. The unused `emergentintegrations` package is already removed.
