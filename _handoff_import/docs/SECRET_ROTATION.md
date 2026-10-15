# Secret rotation

`docs/SECURITY_FINDINGS.md` records passwords that remain in git history, including `origin/main`. This document does not repeat those values.

Rotate these before any production use, even if the current development database is disposable:

- Owner password, and any session minted while a committed password was the live one
- Demo password, if a shared host ever used it
- `JWT_SECRET`
- `MONGO_URL` username and password
- `MAPBOX_TOKEN` and `REACT_APP_MAPBOX_PUBLIC_TOKEN`, if they were placed on a shared preview
- `EMERGENT_EMAIL_KEY`, if that provider was used
- The Resend sandbox password, if it was reused outside the tests
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, when they exist

After rotation, restart the API so old refresh cookies fail, and confirm `POST /api/auth/demo-login` returns 404 in production. Do not paste the old values into tickets or new tests.

This file is the procedure. It does not perform the rotation. Live provider credentials stay where they are until the owner authorizes a change.

## Procedure

Do these one system at a time. Confirm the application signs in and reads a known record before moving to the next item.

1. **Owner password.** Create a new password in the host's secret store. Update `OWNER_PASSWORD`, restart the API, and sign in. Sign out everywhere so older sessions are revoked. Retire the password that appeared in git history.
2. **Demo password.** Use it only on a development database. If a shared preview ever used the committed demo password, replace `DEMO_PASSWORD` and restart. Production must keep `DEMO_MODE` off, which already makes demo sign-in return 404.
3. **JWT secret.** Generate a new value of at least 16 characters. Set `JWT_SECRET` and restart. Every existing access and refresh cookie becomes invalid. Staff with an authenticator sign in again and enter a current code.
4. **Database.** Create a new MongoDB user with access to this database only. Put the new URL in `MONGO_URL`, restart, and confirm `GET /api/health` reports mongo ok. Then delete the previous database user.
5. **Email.** If `EMERGENT_EMAIL_KEY` or a Resend key was ever used outside this repository, revoke it in that provider and issue a new key. The launch provider is Resend. Put `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` only in `/etc/nabitouch-next.env`, mode `600`, owner root. Leave `EMAIL_PROVIDER=resend` only after the `nabitouch.com` domain is verified in Resend.
6. **Mapbox.** In the Mapbox account, create a replacement backend token and a replacement browser token. The backend token can be a public-scope `pk.` token with no URL restriction. Update `MAPBOX_TOKEN` and `REACT_APP_MAPBOX_PUBLIC_TOKEN`, rebuild the frontend, and revoke the old tokens in Mapbox.
7. **Stripe.** When test or live keys exist, roll them in the Stripe dashboard and update `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` together. Do not switch on `sk_live_` as part of this procedure.
8. **Field encryption key.** Generate 32 random bytes and store them as url-safe base64 in `FIELD_ENCRYPTION_KEY`. To rotate, move the current key to `FIELD_ENCRYPTION_KEY_PREVIOUS`, set the new key, and re-save each protected record so it is sealed with the new key. Remove the previous key only after those reads succeed. A backup made while a key was active cannot be read without that key.
9. **File scanner.** If `CLAMAV_HOST` is used, rotate any scanner credentials in that service's own store. An unreachable scanner must leave files in quarantine.

Staff authenticator enrollment is a separate step and has to finish before `mfaEnforcePrivileged` is turned on. See `docs/MFA_ENROLLMENT.md`.
