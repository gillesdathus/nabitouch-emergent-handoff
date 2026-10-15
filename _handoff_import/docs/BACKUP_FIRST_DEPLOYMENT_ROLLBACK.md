# Backup-first deployment and rollback

This runbook is not authorized for execution. It does not replace `docs/PRODUCTION_RELEASE_RUNBOOK.md`, which was left uncommitted and was not edited. Do not rebuild from `/opt/nt-next`. Do not start a new API container against `nabitouch_prod` until the owner authorizes a backup and the deploy.

## What is deployed now

Private API baseline `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f`. Last recorded image `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465`, tagged `nt-next-api:9aca5eccdc3c` and `nt-next-api:local`. Rollback image already on the host: commit `35c9082`, `sha256:0081eac25d1edc251fb45d46ac8351008fffad0afbe5fe87eb9882f59745f7b6`, tag `nt-next-api:rollback-0081eac25d1e`. No new image was built tonight.

## Database compatibility

The catalogue code adds unique indexes `service_id_unique`, `service_slug_unique`, sparse `practitioner_slug_unique`, `media_id_unique`, `media_subject`, and uses `audit_id_unique` for the audit rollback. It also adds publication fields, profile fields, and the `nt_media` collection. Those changes are additive. Rolling the API image back does not drop indexes, fields, media rows, or audit rows.

A read-only preflight, when later authorized, should record collection counts, the index names above, and whether `p-nabitu-kahindo` and `promo-welcome` are absent, before any new process connects. Do not run that preflight until the owner asks. This overnight run used only `nabitouch_preview_validate` and throwaway replica databases.

## Local backup drill already completed

An isolated `mongodump` of `nabitouch_preview_validate` was restored to `nabitouch_restore_probe` and then dropped. That drill happened before the browser bookings below.

| Check | Source | Restore |
| --- | ---: | ---: |
| Collections | 54 | 54, none missing |
| `nt_services` | 10 | 10 |
| `nt_practitioners` | 4 | 4 |
| `nt_media` | 1 | 1 |
| `nt_appointments` | 14 | 14 |
| `nt_invoices` | 0 | 0 |
| `nt_audit` | 4 | 4 |

The restored media document matched the probe bytes and stayed private. Restored indexes included `service_id_unique`, `service_slug_unique`, sparse `practitioner_slug_unique`, `media_id_unique`, and `media_subject`. The archive was removed from the Mongo container. Production was not dumped or restored.

Later browser work added preview appointments `NT-2033` and `NT-2034` and one draft invoice. Those rows were not in the backup above.

## Authorized sequence, later

1. Confirm the owner has approved the exact source SHA and a new image tag. Tonight's working tree is not that approval.
2. Take a fresh `mongodump` of `nabitouch_prod` to storage outside the application container. Keep `FIELD_ENCRYPTION_KEY` separate from the archive.
3. Restore that archive to a new database name and compare counts and index names. Drop only the restore database.
4. Recreate the private API container from the new image, still pointed at the private stack, with document uploads and card checkout left off.
5. Confirm health, owner MFA, and that public booking is still gated before any DNS or Nginx change.

## Rollback

Point the private API container back at `nt-next-api:rollback-0081eac25d1e` or the `9aca5ec` image, using the existing environment. Do not drop `nabitouch_prod`. If the new process already created indexes or `nt_media`, leave them. They do not change historical appointment prices. A failed catalogue write rolls back its own service and audit insert; it does not roll back an earlier backup.

If the new image mis-prices a booking, stop the new container, restore the previous image, and restore the database only from the backup taken in step 2 into a reviewed database. Do not restore over `nabitouch_prod` without a second owner confirmation.
