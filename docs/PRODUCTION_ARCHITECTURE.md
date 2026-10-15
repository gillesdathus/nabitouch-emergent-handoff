# Production architecture

This is a target layout for a later, approved deployment. Nothing in this document was applied to a live host. No hosting account, DNS zone, or TLS certificate was available in this workspace.

## Topology

```
Internet
  → HTTPS reverse proxy (TLS certificate, HTTP redirects to HTTPS)
      → static React build
      → API (Uvicorn, one process to start)
          → MongoDB replica set (private network only)
          → Redis with a password and TLS (private network only)
          → optional ClamAV (private network only)
```

The browser talks only to the site origin. `CORS_ORIGINS` is that origin. Cookies are `Secure` and `SameSite=lax`.

MongoDB, Redis, and ClamAV accept connections from the API only. They are not published to the internet. The API is not published except through the proxy.

Uploaded insurance and clinical files stay in MongoDB as encrypted bytes. They are not in a public bucket. A download is allowed only after the quarantine check in `docs/FIELD_ENCRYPTION.md`.

## Required resources

| Piece | Role |
|---|---|
| Reverse proxy | TLS termination and routing |
| API container or service | FastAPI from `backend/` |
| Static site | `frontend/build` |
| MongoDB replica set | Clients, ledger, clinical records, sessions, encrypted files. One primary and at least one secondary for the transaction path |
| Redis | Live tracking only. Authenticated `rediss://` |
| Secret store | `JWT_SECRET`, database URL, `FIELD_ENCRYPTION_KEY`, Mapbox, email, Stripe |
| ClamAV | Optional. When `CLAMAV_HOST` is set and the scanner is down, files stay in quarantine |
| Backup target | `mongodump` archives stored apart from the database and apart from the encryption key |
| Monitor | `GET /api/health` for mongo and redis. `GET /api/ops/status` for the owner, including pending financial operations |

`deploy/docker-compose.example.yml` is a starting layout with empty secrets. It was not started.

## Backups and recovery

Follow `docs/BACKUP_RESTORE.md`. Take a compressed archive daily, keep it off the database server, and keep the field-encryption key in the secret store. A restore without that key leaves insurance numbers, clinical text, and files unreadable.

Before the first production write, restore a copy into a new database name and compare collection counts. On 12 October 2026 a disposable standalone database was dumped and restored into a second database name: 521 documents restored, 0 failed. Counts matched for appointments (14), users (42), clients (6), and SOAP notes (2). The restore database was then dropped. That drill did not use a production database.

On a standalone MongoDB server, a crash between the ledger insert and the invoice update is repaired from the ledger. It is not atomic. Production should use the replica set so those writes commit together.

## Operating cost

No host has been chosen and no quote was requested, so this repository does not state a monthly price. The bill will be driven by the proxy, the API, a MongoDB replica set, a small Redis instance, backup storage, and optional ClamAV. Mapbox, email, and Stripe add usage charges only after those accounts exist. Confirm the current prices with the chosen vendors before launch.
