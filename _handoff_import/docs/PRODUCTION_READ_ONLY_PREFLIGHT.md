# Read-only production preflight

14 October 2026, inspected at `2026-10-14T19:29:37Z`. This was inspection only. Nothing on the host was created, changed, restarted, dumped, or deployed.

## Identity

| Item | Value |
| --- | --- |
| Branch | `feature/frontend-vite-security-migration` |
| HEAD | `4195888330a844594e3be64c24e7df69a7264b5d` |
| Release candidate | `20c101cb5b1d4d9d1e8c9918b0c198dcd47645bd` |
| Expected deployed API | `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f` |
| Host | `srv1393944`, Ubuntu 24.04.4 LTS, kernel `6.8.0-107-generic` |
| Docker | client and server `29.4.0` |

`20c101c` and `4195888` are ancestors of HEAD. HEAD is `4195888`. The candidate is not the running image.

The public site and the private API are different stacks. Counts below are `nabitouch_prod` on `nt-next`. They are not the isolated preview database and they are not the older public site's database.

## Infrastructure

| Container | State | Image | Host binding |
| --- | --- | --- | --- |
| `nt-next-api` | running, healthy, 18 hours | `nt-next-api:local` | `127.0.0.1:8011` → 8000 |
| `nt-next-mongo` | running, no healthcheck | `mongo:7` | none |
| `nt-next-redis` | running, no healthcheck | `redis:7-alpine` | none |
| `nt-next-enroll` | running, no published ports | `nginx:alpine` | none |
| `nabitouch_frontend` | running, healthy | `nabitouch-rmt-frontend` | `127.0.0.1:8080` → 80 |
| `nabitouch_backend` | running, healthy, user `appuser` | `nabitouch-rmt-backend` | none |
| `nabitouch_mongo` | running, healthy | `mongo:7` | none |

`nt-next-clamav` is not running. `nt-next-enroll` is not in `deploy/docker-compose.hostinger.yml`. It was left running.

Running API image id `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465`, also tagged `nt-next-api:9aca5eccdc3c`. That matches the recorded baseline. The candidate image is not on the host.

Restart policy for the private API, MongoDB, and Redis is `unless-stopped`. None of those three is privileged. None has a read-only root filesystem. The API runs as the image default user. Memory limits are 512 MiB for the API, 512 MiB for MongoDB, and 128 MiB for Redis. Logs are json-file, 10 MiB, 3 files.

`GET http://127.0.0.1:8011/api/health` returned `status` ok, `mongo` ok, `redis` ok, `documentUploads` false, `cardCheckout` false.

Disk: 96 GiB, 30 GiB used, 67 GiB available. Memory: 7940 MiB total, about 3.5 GiB available, no swap. The host also runs other applications.

`/opt/nt-next` exists and is not a git checkout, so the on-disk source SHA was not readable. The image digest is the identity evidence.

## Database compatibility

Database name confirmed as `nabitouch_prod`. Replica set name `rs0`. Queries were counts, index lists, and bounded aggregations. No writes and no index builds.

| Collection | Estimated documents |
| --- | --- |
| `nt_services` | 10 |
| `nt_practitioners` | collection absent |
| `nt_media` | collection absent |
| `nt_promotions` | collection absent |
| `nt_appointments` | 0 |
| `nt_invoices` | 0 |
| `nt_files` | 0 |
| `nt_users` | 1 |
| `nt_mfa` | 1 |
| `nt_settings` | 1 |

`dbStats`: 44 collections, 56 objects, data size 20,145 bytes, storage size 598,016 bytes, index size 991,232 bytes.

Service index today: `_id_` only. Practitioner and media indexes do not exist because those collections do not exist. None of the five candidate indexes is present, and none conflicts with an existing definition.

| Check | Result |
| --- | --- |
| Duplicate service ids | 0 |
| Duplicate service slugs | 0 |
| Missing or empty service slugs | 0 |
| Duplicate practitioner slugs | no collection |
| Services with `publication` | 0 |
| Services with `enabled: true` and no publication | 10 |
| Services with `imgMediaId` | 0 |
| `p-nabitu-kahindo` | 0 |

A later boot of the candidate can create `service_id_unique` and `service_slug_unique` on these 10 rows. `service_slug_unique` is not sparse, and no second missing slug is present. `practitioner_slug_unique` and the media indexes would be created on empty collections. That boot would write indexes. It was not done.

Those 10 services have no `publication` field. The candidate treats an enabled, non-archived service without that field as published. They are not published on the current public site, because that site still uses the older stack.

## Business configuration

All of this is `nabitouch_prod`, not the preview database and not the older public database.

| Item | Observed |
| --- | --- |
| WELCOME20 | `promo-welcome` is absent. It was not inserted |
| Cancellation policy | no `cancellationPolicy` or `cancellationFee` on the settings document |
| Clinic booking | `clinic.enabled` is false and the address is empty, so clinic booking is refused |
| Mobile booking | `mobileEnabled` is unset. The API refuses mobile booking only when that value is false |
| Service catalogue | 10 enabled services, no publication field, no uploaded photo |
| GST | stored `0.05` |
| Cash | `cashEnabled` true |
| Practitioners | no practitioner collection, so no verified active practitioner in this database |
| Scheduling buffers | unset. Application defaults remain 10, 15, 10, and 90 minutes |
| Document uploads | environment `false`; health reports false |
| Card checkout | environment `false`; health reports false |
| Legacy import | environment `false` |
| Rewards, referrals, NabiDerm | no rewards document |
| Owner MFA flag | `mfaEnforcePrivileged` true, and one `nt_mfa` document exists |

`APP_ENV` is production, `DEMO_MODE` is false, `DB_NAME` is `nabitouch_prod`, the API origin and CORS use https, Redis uses `rediss://`, the field encryption key is set, and Sentry is unset. The server Mapbox value is present and uses a `pk.` prefix. The value was not printed.

The older public site was not queried for clients, notes, or practitioners.

## Backup

`/root/nabitouch-next-backups` exists and is the only Nabitouch backup directory found. No backup cron was found in the root crontab or `/etc/cron.d`, `/etc/cron.daily`, or `/etc/crontab`. No checksum sidecar was found.

| File | Mode | Size | Time |
| --- | --- | --- | --- |
| `nabitouch_prod-20261013.archive.gz` | 600 | 9,372 bytes | 13 Oct 2026 14:45 UTC |
| `nabitouch_prod-before-cleanup-20261013.archive.gz` | 600 | 11,026 bytes | 13 Oct 2026 15:28 UTC |
| `nabitouch_prod-launch-20261013.archive.gz.aesgcm` | 600 | 9,974 bytes | 13 Oct 2026 15:40 UTC |

The first two archives are not encrypted by filename. They were not opened. Root-only error logs from that cleanup sit in the same directory and were not opened. A fresh backup was not taken.

The MongoDB volume is 325 MiB. Logical data is about 20 KiB, which matches the small archives already there. The older public uploads volume is 50 MiB and the older public database volume is 505 MiB. Those are not `nt_media`. The new media collection does not exist. New catalogue photos would be BSON inside `nabitouch_prod`.

Estimate, not a measurement of a new dump: a gzip archive of the current private database is on the order of 10–50 KiB. A copy of the MongoDB volume is about 325 MiB. Keeping the older uploads volume as a separate archive adds about 50 MiB. Free space is 67 GiB, so capacity is not the blocker. Encryption, a checksum, and a restore into a new database name still are.

After a later authorization, and only then:

1. Export `MONGO_URL` and confirm the database name is `nabitouch_prod`.
2. `mongodump` to a new file outside the API container, then encrypt it. Keep `FIELD_ENCRYPTION_KEY` separate.
3. Record SHA-256 beside the ciphertext, not inside the archive.
4. `mongorestore` into a new database name. Compare collection counts, service count, and index names. Drop only that restore database.
5. Do not restore over `nabitouch_prod` without a second confirmation.

## Rollback

| Artifact | Result |
| --- | --- |
| Running API image | present, `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465` |
| Rollback image `nt-next-api:rollback-0081eac25d1e` | present, `sha256:0081eac25d1edc251fb45d46ac8351008fffad0afbe5fe87eb9882f59745f7b6` |
| Private env file | present as the API `env_file`; values were not printed |
| New static frontend tree | `/var/www/nabitouch` and `/var/www/nabitouch-next` do not exist |
| Current public frontend | container `nabitouch_frontend`, not a directory backup |
| New media volume | none. Future photos are inside the MongoDB volume |
| Older uploads | volume `nabitouch-rmt_uploads`, 50 MiB |

The documented rollback image is on this host. It was not started. A static rollback directory for the candidate frontend does not exist because that frontend has not been installed. Recovery steps remain in `docs/BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md` and `docs/BACKUP_RESTORE.md`.

## Exposure

- `nt-next-api` is bound to localhost only. MongoDB and Redis have no host port binding.
- Public `nabitouch.com` on 443 sends `/` to `127.0.0.1:8080`. A public `GET /api/health` returned the old shape, `{"status":"ok","db":"up",...}`, matching `127.0.0.1:8080`. It did not return the private API's `documentUploads` field.
- One public exception: `location = /api/notifications/resend` proxies to `127.0.0.1:8011`.
- TLS for `nabitouch.com` terminates at Nginx with the existing certificate. Ports 80 and 443 listen on all interfaces. `8443` listens on localhost only.
- Restricted flags are false in the environment and on the private health response.
- Containers are not privileged. Their root filesystems are writable. The API process user is the image default.
- Secrets are mounted by env file and by the read-only Redis certificate volume. Sentry is unset. Container logs rotate at 10 MiB by 3 files.
- Two unencrypted database archives and unopened cleanup logs remain under `/root/nabitouch-next-backups`.

No credentials, tokens, or client records were printed. No login, scan, or exploit was attempted.

## Gates

| Gate | Result |
| --- | --- |
| Running baseline identity | PASS |
| Database index compatibility | PASS |
| Available rollback image | PASS |
| Backup prerequisites | BLOCKED |
| Restricted-feature configuration | PASS |
| Private network isolation | PASS |
| Owner MFA readiness | NOT VERIFIED |
| Business configuration readiness | FAIL |

PASS means the read-only evidence matched the gate. It does not authorize a deploy.

Backup is blocked because retention is not scheduled, checksum sidecars were not found, plaintext archives remain, and a fresh encrypted backup was intentionally not taken. Owner MFA is not verified because the flag and one MFA document do not prove a live authenticator login. Business configuration fails because the approved WELCOME20 promotion, practitioner records, cancellation policy, and scheduling buffers are not in `nabitouch_prod`.

## Later deployment prerequisites

Do not run these until the owner authorizes that deploy.

1. Accept candidate `20c101c` from checkout `4195888` or a later documentation-only descendant. The running image must still be `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465` at the start.
2. Decide publication for the 10 enabled services before any new frontend is routed. Missing `publication` means published.
3. Authorize any insert of `promo-welcome`, practitioners, or scheduling values separately. This preflight does not insert them.
4. Take the encrypted backup and checksum steps above. Restore to a new database name and compare counts.
5. Remove or encrypt the plaintext archives only under a separate instruction. Do not delete them as part of boot.
6. Build the candidate image on an isolated builder. Tag it with the checkout SHA. Keep the current digest and `nt-next-api:rollback-0081eac25d1e`.
7. Start that image only against the private stack, with the three restricted flags false, `DEMO_MODE` false, and Redis on `rediss://`.
8. Read `127.0.0.1:8011/api/health`. Require mongo and redis ok and both feature flags false.
9. Complete an owner MFA login on that stack before any Nginx or DNS change.
10. Leave `nabitouch.com` on `127.0.0.1:8080` unless a later decision says otherwise. Leave public booking off.

Rollback, if that later deploy fails: start `nt-next-api:rollback-0081eac25d1e` or the `9aca5eccdc3c` image with the same env file. Leave indexes and `nabitouch_prod` in place. There is no candidate static tree to swap back yet.

## Recommendation

Private deployment is **NO-GO**. Public launch is **NO-GO**.

The running baseline, the rollback image, localhost binding, restricted flags, and the current service rows are compatible with a later attempt. That attempt still needs an owner decision, a fresh encrypted backup, a checked owner MFA login, and an explicit choice about WELCOME20, practitioners, and service publication.
