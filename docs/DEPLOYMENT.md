# Deployment

The current release candidate and the private-deployment procedure are in `docs/PRODUCTION_RELEASE_RUNBOOK.md`. That document does not authorize deployment.

This repository is not deployed from these instructions. Production deployment needs a separate approval from the Nabitouch owner. Configuration preparation does not create `/etc/nabitouch-next.env` on the VPS and does not change Nginx.

## What this environment proved

- The API runs from `backend/` with Uvicorn.
- MongoDB holds clients, appointments, the ledger, clinical records, and sessions.
- Redis holds live tracking state. Billing notices may publish there and still succeed if Redis is down.
- The React app is a static build. `REACT_APP_BACKEND_URL` is fixed at build time.
- Demo sign-in is refused when `APP_ENV=production`.

## What is not configured here

No production host, DNS name, TLS certificate, Stripe live or test key, email provider, or Mapbox token was available in this workspace. Do not point this build at a production database.

## Release steps, after approval

1. Rotate the credentials listed in `docs/SECRET_ROTATION.md`.
2. Run MongoDB as a replica set. When the server reports a replica set, a payment commits the ledger line, the invoice balance, and the operation journal in one transaction. A standalone server keeps the journal in `docs/BACKUP_RESTORE.md` and cannot make those three writes atomic.
3. Create Redis with `rediss://` and a password.
4. Set the variables in `docs/ENVIRONMENT.md`.
5. Build the frontend with the public API origin.
6. Serve the API behind HTTPS. Keep `COOKIE_SECURE=true`.
7. Register the Stripe webhook from `docs/STRIPE_WEBHOOK.md` only after a test secret exists.
8. Restore a backup onto a disposable database and compare invoice counts before the first live write.
9. Open `GET /api/health` from the monitor. It returns mongo and redis state and no secrets.
10. Keep a rollback build and the previous database backup until the owner accepts the release.

## DNS and TLS

- Publish the site and the API on names you control.
- Install a certificate and redirect HTTP to HTTPS.
- Set `COOKIE_SECURE=true` and `CORS_ORIGINS` to the exact site origin.
- Confirm email links use `https://` and `APP_URL`.
- Open the Stripe webhook URL only after the test endpoint shows a verified signature.

## Rollback

Stop the new API process, start the previous build, and restore the database backup taken immediately before the release if a migration wrote data. Do not delete ledger lines to undo a release. Historical imports roll back by appending reversal lines.
