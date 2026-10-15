# Hostinger replacement plan

Checkpoint `de03b4fc2273bebcd35bc45eab8d760bb38a92b2` on `feature/production-hardening`.

This plan does not change the live site. The compose file, Dockerfile, and environment template were not started. Read-only SSH on 12 October 2026 confirmed the host below. No services were restarted and no client records were read.

## What the public internet shows

| Check | Result |
|---|---|
| `nabitouch.com` A | `187.77.204.131` |
| `www.nabitouch.com` A | `187.77.204.131` |
| DNS SOA | `ns1.dns-parking.com`, administrator `dns.hostinger.com`, serial `2026100801` |
| HTTP | `301` to `https://nabitouch.com/` |
| HTTPS | `200`, `Server: nginx/1.24.0 (Ubuntu)` |
| TLS | Let's Encrypt `CN=YE1`, subject `CN=nabitouch.com`, valid 20 August 2026 through 18 November 2026 |
| Homepage | Static Vite shell titled “Nabitouch RMT”, HTML last modified 3 October 2026, script `/assets/index-CkzFTUuU.js` (602,355 bytes) |
| `GET /api/health` | `{"status":"ok","db":"up",...}` |
| `GET /api/` | `{"name":"NabiTouch API","status":"ok"}` |
| `GET /api/auth/config` | `404` |

The live API is not this repository. This app's health payload reports mongo and redis, and `/api/auth/config` exists. The live health payload reports `db` and does not expose `/api/auth/config`.

From this network, TCP `22`, `80`, and `443` accepted a connection. `3000`, `8000`, `8080`, `8443`, `27017`, `6379`, `3306`, and `5432` did not. On the host those database ports exist only inside Docker or on `127.0.0.1`.

## Host inventory (12 October 2026)

Ubuntu 24.04.4 LTS, kernel `6.8.0-107-generic`, hostname `srv1393944`, uptime 178 days. 2 vCPU (AMD EPYC 9354P slice), 7.8 GiB RAM, about 3.5 GiB available at the sample, load about 0.7, no swap. Root disk 96 GiB, 32 GiB used, 65 GiB free. UFW is active: default deny incoming, allow `22`, `80`, and `443` only. Host Nginx listens on `80` and `443`. Thirteen sites share this Nginx. `127.0.0.1:8011` was free. `127.0.0.1:3011` is already Sem Ayiti staging.

The live site is Compose project `nabitouch-rmt` in `/var/www/apps/nabitouch-rmt`. Nginx proxies `nabitouch.com` and `www.nabitouch.com` to `127.0.0.1:8080` (`nabitouch_frontend`). That container proxies `/api/` and `/uploads/` to `nabitouch_backend:8001` on the private network `nabitouch-rmt_nabitouch_network`. MongoDB `nabitouch_mongo` is not published on the host. The database name is `nabi_touch`. There is no Redis in this stack. The certificate in use is `/etc/letsencrypt/live/nabitouch.com/`, expiring 19 November 2026 (37 days). No Nabitouch mongodump was found under `/opt/backups`, `/root/backups`, or `/var/backups`.

`nabi_touch` holds 17 patients, 18 media assets, 1 user, 1 import job, and CMS rows (services, FAQs, testimonials). `soap_notes` and `medical_flags` exist and are empty. The uploads volume is 50 MiB and 19 files. The Mongo volume is 505 MiB. This schema is not the new app's `nt_*` collections. Keep the volume and take an off-server dump before any cutover.

A second, older stack named `nabitu` listens only on `127.0.0.1:3002` and `127.0.0.1:3102`, with Mongo on `127.0.0.1:27018`. Its database `nabitouch` is CMS and intake-definition data (1 user, no `patients` collection). It is not the vhost behind `nabitouch.com`. Leave it in place until the owner archives it.

Other resident data engines: Felicy Hair MySQL, Kwalitee Mongo, DG Creator staging Mongo, Sem Ayiti Postgres (prod and staging), DG Solutions Postgres, Redis, and MinIO. None of those volumes belong to Nabitouch.

## Coexistence

An isolated `nt-next` stack on `127.0.0.1:8011`, with MongoDB and Redis unpublished, fits the free disk and the free loopback port. Budget about 700 MiB without ClamAV. ClamAV should stay off until a later sample shows at least 1.5 GiB still available, because this host has no swap and an OOM kill can hit any of the other sites. Do not reuse ports `3000`–`3021`, `3102`, `8080`, or `27018`. Do not attach to `nabitouch-rmt_nabitouch_network`.

## Read-only discovery commands

Run these on the VPS over SSH. They do not restart services or write data. Paste the summaries back without dumping documents, passwords, or tokens.

```bash
uname -a
cat /etc/os-release
nproc
free -h
swapon --show
df -hT
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker compose ls
docker volume ls
docker network ls
ss -lntup
sudo ufw status verbose || sudo iptables -S
sudo nginx -T
sudo certbot certificates || sudo ls -l /etc/letsencrypt/live
ls -la /var/www /opt /srv /home
crontab -l
sudo ls /etc/cron.* /etc/cron.d
```

Database inventory, still read-only. Stop if the database is not the one you expect.

```bash
# Replace the container name from docker ps. Do not print document bodies.
docker exec <old-mongo-or-api> printenv | awk -F= '/MONGO|DATABASE|DB_/ {print $1}'
# Then, inside mongosh against that database only:
db.getName()
db.getCollectionNames()
db.getCollectionNames().forEach(c => print(c + " " + db.getCollection(c).estimatedDocumentCount()))
```

Count names such as clients, users, appointments, payments, invoices, insurance, soap, intake, and files. A count above zero means the collection is kept. Do not copy the database to a laptop.

## Backup inventory before any new container starts

1. Record `docker ps`, `docker volume ls`, and `nginx -T` into a file on the VPS, outside the web root.
2. Dump the live database with `mongodump` or the engine that `docker ps` actually shows. Store the archive off the VPS. If the data is in SQLite or Postgres instead, use that engine's dump. The public health check only proves a database is up.
3. Copy the current web root (`/var/www/...` or wherever `nginx -T` says `root` is) and the Nginx site file to the same off-server location.
4. Copy `/etc/letsencrypt` or confirm the certificate can be reissued. It expires 18 November 2026.
5. Confirm a restore of the dump onto a new database name on the same engine, compare counts, then drop that restore database. Do not restore over the live database.

## Old application recovery

Keep the current Nginx site file as `nabitouch.com.active`. Keep the current web root and the database volume. Rollback is copying that site file back and `nginx -t && systemctl reload nginx`. Do not delete the old containers, volumes, or web root during preparation or during the first day after cutover.

## Next stack

Files, not started:

- `deploy/docker-compose.hostinger.yml` — project `nt-next`, containers `nt-next-api`, `nt-next-mongo`, `nt-next-redis`, `nt-next-clamav`, network `nt-next`, volumes `nt-next-mongo` and `nt-next-redis-certs`. API port `127.0.0.1:8011` only.
- `deploy/Dockerfile.api` — Python 3.12 image for the API.
- `deploy/env.hostinger.example` — production switches. `APP_ENV=production`, `DEMO_MODE=false`, `COOKIE_SECURE=true`, `CORS_ORIGINS` and `APP_URL` are `https://nabitouch.com`. Demo password is not required. Stripe keys stay empty. `sk_live_` is refused by the API.

After the owner approves a deploy, and only then:

1. Create `/etc/nabitouch-next.env` from the example. Generate `JWT_SECRET`, the Mongo password, the Redis password, and `FIELD_ENCRYPTION_KEY` on the server. Keep a second copy of the encryption key off the server. A backup cannot be read without it.
2. Create a private CA and Redis certificate and place them in the `nt-next-redis-certs` volume. `APP_ENV=production` refuses `redis://`.
3. `docker compose -f deploy/docker-compose.hostinger.yml --env-file /etc/nabitouch-next.env up -d` from a checkout of this branch. Then initiate the replica set and create the `ntnext` user. `GET http://127.0.0.1:8011/api/health` must report mongo and redis ok. Do not point Nginx at `8011` yet.
4. Build the frontend on a workstation with `REACT_APP_BACKEND_URL=https://nabitouch.com` and `REACT_APP_MAPBOX_PUBLIC_TOKEN` set to the public token. Copy the build to a new directory such as `/var/www/nabitouch-next`. Do not replace the live root.

Leave `CLAMAV_HOST` empty until `nt-next-clamav` answers on port 3310. Until then, scanned release of uploads does not happen and files stay in quarantine. Set `CLAMAV_HOST=clamav` only after a scan connection succeeds.

Stripe webhooks stay on the old upstream until cutover. After cutover, the endpoint is `POST https://nabitouch.com/api/billing/stripe/webhook`. Register a test endpoint only. Do not put `sk_live_` in the environment.

## Data preservation

`nabi_touch` contains 17 patients, 18 media assets, and 19 uploaded files. `soap_notes` is empty. There is no appointments, invoices, or insurance collection in that database. The records stay on the VPS. Copy them only after an off-server archive exists and the owner approves a field map. The older `nabitu` database has no `patients` collection; keep it until the owner archives that stack.

Do not restore that dump into `nabitouch_prod`. The live API shape does not match this app's `nt_*` collections. The preservation path is:

1. Off-server archive of the dump and the current web root.
2. A written inventory of collection names and counts.
3. A field map, approved by the owner, before any row is copied into the new database.
4. Imports run against a copy, then counts and a handful of non-sensitive identifiers are compared. Clinical text and member numbers stay encrypted under `FIELD_ENCRYPTION_KEY`.
5. The original database and volume stay in place after cutover until the owner accepts the archive.

No production data is copied into development.

## Cutover

Do this only after the owner approves replacement, any data migration, the Nginx change, and credential activation.

1. Fresh backup, as above.
2. Confirm `http://127.0.0.1:8011/api/health` from the VPS.
3. Copy the live Nginx site to `nabitouch.com.active`.
Proposed new routing, not applied:

- Static files for the new build from a new directory such as `/var/www/nabitouch-next`.
- `location /api/` proxies to `http://127.0.0.1:8011`, which is the API only.
- `127.0.0.1:8011` is not a frontend.

Memory caps in `deploy/docker-compose.hostinger.yml`: API 512 MiB, MongoDB 512 MiB, Redis 128 MiB. ClamAV is in the `scan` profile at 768 MiB and is not part of a default start. Leave it off while available memory is under 1.5 GiB. Uploads then stay in quarantine, which is a launch blocker if malware scanning is required.

Rollback remains the saved Nginx site file pointing `proxy_pass` back at `127.0.0.1:8080`. Old containers and the `nabitouch-rmt` volumes stay.
5. `sudo nginx -t && sudo systemctl reload nginx`.
6. Run the acceptance list below against `https://nabitouch.com`.

DNS does not need to change for this cutover. It already points at this VPS.

## Rollback

```bash
sudo cp /etc/nginx/sites-available/nabitouch.com.active /etc/nginx/sites-available/nabitouch.com
sudo nginx -t && sudo systemctl reload nginx
```

Use the real site-file path from `nginx -T`. The old web root and old database must still be there. Roll back Nginx first. Stop `nt-next` only if it is interfering. Do not drop the old volume to “finish” a rollback.

## Acceptance, after an approved deploy

- Public home loads from the new build, and the old Vite asset `/assets/index-CkzFTUuU.js` is no longer the document shell.
- A booking can be created and seen by the assigned practitioner.
- Client, practitioner, receptionist, and owner each sign in with their own role and cannot open another role's clinical notes.
- SOAP save, sign, and amendment keep the signed text.
- Intake is versioned and receptionist precautions omit the medication narrative.
- An insurance claim and a quarantined upload cannot be downloaded until a scan passes.
- An issued invoice takes one cash or test-mode card posting and does not double-post on a repeated idempotency key.
- A tracking session exists only while the practitioner is travelling to that appointment.
- Stripe test webhook signature, duplicate delivery, amount mismatch, and expiry behave as in `docs/STRIPE_WEBHOOK.md`. Live keys stay off.
- With `mfaEnforcePrivileged` still off, staff can enroll. Turning it on without an authenticator session returns 403. After it is on, demo sign-in is already refused because `DEMO_MODE` cannot be true in production.
- `GET /api/health` shows mongo and redis, and the body contains no secrets.
- A dump of `nabitouch_prod` restores to a second database name with matching counts, then that second database is dropped. The encryption key is required to read restored clinical fields.

## Staging budget and watch points

`deploy/docker-compose.hostinger.yml` is the inactive `nt-next` project. It was not started on the VPS. `127.0.0.1:8011` is the API only. A prepared Nginx file, `deploy/nginx.staging.not-active.conf`, shows how a future cutover would serve the built frontend and proxy `/api/` to that port. Do not copy it into `sites-enabled`. Live routing stays `nabitouch.com` → `127.0.0.1:8080`.

Memory caps: API 512 MiB, MongoDB 512 MiB, Redis 128 MiB. MongoDB's WiredTiger cache is capped at 0.25 GiB so the 512 MiB limit is not immediately overrun by the default cache formula. That cap makes 512 MiB workable for this data size, and it is still tight: connections, the journal, and a compact can push the container to its limit. There is no swap on this host, so an over-limit container can be killed. Do not add swap and do not start the ClamAV profile without a separate check that about 1.5 GiB remains free.

Watch without installing an agent:

```bash
docker stats --no-stream nt-next-api nt-next-mongo nt-next-redis
docker inspect nt-next-api nt-next-mongo nt-next-redis --format '{{.Name}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
df -h /
dmesg -T | grep -i 'out of memory' | tail
```

Frontend overhead is the static files Nginx would serve. The production build's main bundle is about 186 kB gzip and the Mapbox chunk is about 521 kB gzip. Nginx worker memory for that static site is small next to the API cap. Measure it on the host after an approved start; do not guess a second container into the 512 MiB API budget.

## Launch configuration

Prepared on `feature/production-hardening`. Not deployed. The live site remains `nabitouch.com` → `127.0.0.1:8080`.

| Decision | Setting |
|---|---|
| Owner address | `OWNER_EMAIL=info@nabitouch.com`. One owner account uses that login. Do not create a second owner |
| Mail | `EMAIL_PROVIDER=resend`, from `Nabitouch <bookings@nabitouch.com>`, reply-to and smoke recipient `info@nabitouch.com` |
| Documents | `DOCUMENT_UPLOADS_ENABLED=false`. Upload routes return 403 before storing a file. Typed insurance details still save. Credential text records are not files |
| Cards | `STRIPE_CARD_CHECKOUT_ENABLED=false`. Checkout and card intents return 503 and do not create a session or a paid state. Cash and e-Transfer stay. Owner-issued gift-card records do not call Stripe |
| Imports | `LEGACY_PATIENT_IMPORT_ENABLED=false` |
| Host | `HOSTING_STRATEGY=shared-vps`. ClamAV stays off. Caps remain 512 / 512 / 128 MiB. WiredTiger cache remains 0.25 GiB |

A fresh production database loads services, zones, message templates, and settings. It does not load clients, appointments, notes, practitioners, or gift cards. `docs/BACKUP_RESTORE.md` describes the local encrypted archive of the old data. That archive has not been taken.

### Mapbox checklist

Do not call Mapbox until the tokens exist. Local fixtures are not production verification.

| Use | Token | API |
|---|---|---|
| Address search and reverse geocode | `MAPBOX_TOKEN` on the API (`nabitouch-backend-prod`) | Geocoding v6, `country=ca`, `types=address`, Edmonton proximity and bounding box |
| Travel time and route line | Same backend token | Directions v5, `driving-traffic`, then `driving` if traffic is unavailable |
| Map display | `REACT_APP_MAPBOX_PUBLIC_TOKEN` (`nabitouch-frontend-prod`) at frontend build time | Mapbox GL style `mapbox/light-v11`. URL-restrict this token to `https://nabitouch.com` and `https://www.nabitouch.com` |

`nabitouch-backend-prod` is a public-scope `pk.` token with no URL restriction. Geocoding v6 and Directions v5 do not need a secret `sk.` scope. `nabitouch-frontend-prod` is the only token that enters the browser build. It belongs in `/etc/nabitouch-next.frontend.env`, not in `/etc/nabitouch-next.env`. The two tokens must be different. An `sk.` token must not be stored in the frontend file.

Canadian postal codes, Edmonton directions NW/NE/SW/SE, address confidence, and arrival pins are applied in `backend/addresses.py` after a geocode result. A missing or conflicting postal code stays in review. An arrival pin more than 0.15 km from the civic point does not rewrite the street.

Synthetic check, after tokens exist and before cutover:

1. Search `10150 104 St NW, Edmonton`. Expect a civic address, postal `T5J 2R4`, and the central zone.
2. Confirm the same street with postal `T5J 2R4` and `clientConfirmed=true`.
3. Submit `10150 104 Ave NW` and confirm it does not resolve as the Street address.
4. Submit a Leduc address and confirm it is outside the service area.
5. Request a route between downtown and Sherwood Park and confirm a duration comes back from Directions.
6. Confirm the browser bundle contains the public token prefix only.

### Rollback

If a later cutover fails, point Nginx back at `127.0.0.1:8080` and reload. Leave `nabitouch-rmt` running until that check passes. Stop only `nt-next` containers. Do not prune shared networks or volumes. Do not delete the old database.

### Still required before deployment

- Run `deploy/provision-production-secrets.sh` as root on the VPS and confirm the off-server recovery copy. Then run `deploy/validate-production-secrets.py` and resolve every `PENDING` Resend and Mapbox line.
- Verify `nabitouch.com` in Resend and restrict the Mapbox public token to that origin.
- Run the synthetic Mapbox checks and the email smoke test. Neither has been run.
- Take the encrypted local archive and complete its restore count check.
- Record the Alberta retention decision before any destruction of that archive.
- Enroll the owner authenticator and store recovery codes off the server before turning enforcement on.
- Keep card checkout and document uploads off.
- Owner approval to start Compose and to change Nginx.
- Certificate renewal before 19 November 2026.
