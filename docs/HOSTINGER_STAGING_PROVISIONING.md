# Hostinger VPS staging provisioning and operations

Hostinger VPS with Docker Compose was explicitly selected. The owner authorized isolated staging and created both A records. Preflight stopped on unsafe production credential permissions; the owner separately authorized their exact repair, which passed noninterference checks. **The isolated staging foundation is now deployed and verified.** See [actual deployment, tests, images and remaining gates](MASTER_READINESS_2026-10-16.md). The procedures below remain a rebuild/rollback runbook, not permission to repeat provisioning or to deploy production.

The deployed project is `nabitouch-staging`; it uses its own Mongo volume, authenticated staging-only users, replica set, TLS Redis and networks. It does not join the existing `nt-next`/production networks or reference their volumes. Only web publishes `127.0.0.1:18081`. HTTPS is a new, separate host Nginx vhost. Existing production Nginx files and routes remain unchanged.

The deployed Compose limits are API 768 MiB/0.50 CPU, Mongo 768 MiB/0.40 CPU
(256 MiB WiredTiger cache), Redis 192 MiB/0.15 CPU (96 MiB no-eviction cache),
and web 128 MiB/0.15 CPU: 1,856 MiB and 1.20 CPUs maximum in aggregate. These
are initial ceilings, not measured sufficient operating allocations. Build images
locally or in CI; do not load the shared VPS with builds. Observe host and existing
services before/after starting staging; stop staging on resource pressure or
production latency/health regression. No production tuning is authorized here.

The selected edge example uses Nginx Basic authentication on both tester entry
points. Create a staging-only htpasswd credential outside Git and deliver it using
the owner's secure channel. The browser frontend must use the **same-origin**
`https://staging.nabitouch.com/api` proxy (`REACT_APP_BACKEND_URL`/APP_URL/CORS all
`https://staging.nabitouch.com`), so the browser's Basic authentication cache and
the app's cookie/CSRF flow are shared. Basic auth does not replace app login/MFA.
`api-staging.nabitouch.com/api` is a second protected API entry for diagnostics;
only its two signed provider callbacks bypass the edge gate. Native Bearer mode
conflicts with Basic on the same Authorization header: a separately verified
native-compatible gateway will be required before physical-device acceptance.
Do not weaken the edge gate or point the native app at production.

Issue a **new** Let's Encrypt certificate with both staging names using the
existing supported Certbot tooling. Inspect current challenge/renewal support
without editing existing certificates/vhosts. A standalone challenge cannot bind
80/443 while production Nginx runs. Prefer a new staging-only HTTP challenge vhost
and webroot with a dry-run before issuance; preserve every production server
block and test the combined configuration before reload. Do not reuse the
production certificate private key. The proposed staging HTTP/DNS/TLS change
was subsequently authorized and executed after the separately approved production
permission repair; actual verification is recorded below and in the report.

The edge and container Nginx access logs contain method/status/size/latency only,
omitting URL, query, IP and Authorization; Nginx error logging is suppressed
because default errors can include complete sensitive URLs. Monitor container
health and status/latency counters instead, with explicit operator ownership and
alerts before release. Uvicorn access logs are disabled in the candidate image.
The deployed staging logs passed the harmless query-canary check recorded in the
report; this does not certify every future error/clinical-data path.

Current access details are in ignored `backend/.env.staging-access.local` on the
owner workstation (JSON, owner/SYSTEM ACL), including gateway credentials and
synthetic owner TOTP/recovery information. Import the staging TOTP URI in the
owner's authenticator securely; do not paste it into chat. App MFA enforcement is
enabled on staging. The API-host root returns 404 intentionally; use `/api/health`
after the Basic challenge. Browser API calls stay on the frontend origin.

The existing supplied Mapbox server token was found to be shared with production.
No staging provider calls were performed. Supply independent staging Mapbox
credentials and verify browser origin restrictions before acceptance. Do not
rotate production tokens or mistake independent Mongo/JWT secrets for complete
provider-token isolation. Stripe/Resend/Firebase credentials remain absent.

## Deployed operational checks and backup custody

The interrupted bootstrap initially left four new staging env/access files at
0644. Final audit corrected them to 0600 and replaced staging passwords, JWT/field
keys and database/cache credentials; synthetic owner sessions/MFA were revoked
and re-enrolled. Final permissions, authentication, browser and backup checks
passed. Use only the final local access file, not any earlier cached password or
MFA seed. Initial field key is retained privately for initial synthetic recovery;
production credentials were not rotated.

All four staging services are healthy and recovered after an intentional restart;
HTTPS, SPA fallbacks, owner login/MFA, same-origin browser authentication,
CORS/CSRF, database/Redis readiness and production noninterference passed.
Let's Encrypt covers both staging names through 14 January 2027. Certbot
reconfigure tested renewal and saved a staging-only Nginx validation/reload hook.
No production certificate configuration was changed.

`deploy/staging/backup.py` is installed as root-private
`/opt/nabitouch-staging/ops/backup.py`. It refuses non-staging Mongo destinations,
container/project/network/volume identities and unversioned encryption images.
It uses `/etc/nabitouch-staging/api.env` and `compose.env`, stores AES-256-GCM
ciphertext under `backups/`, and keeps AES/field recovery keys separately in
root-only `recovery/`. Its temporary plaintext files are removed after encryption.
`/etc/cron.d/nabitouch-staging-backup` schedules 03:17 UTC daily; MAILTO is empty,
logs root-private, and no destructive retention pruning exists. Schedule execution
has not yet occurred; automated off-host copy and alert/retention ownership remain.

One encrypted synthetic archive was restored into a new recovery database in the
same isolated staging Mongo container: all 77 collection counts / 30 documents
matched. An encrypted copy on the owner workstation has a matching checksum.
This is **not off-host restore verification**. Recovery-key egress was rejected
by automatic approval review pending explicit owner permission. Never export keys
as part of an unreviewed backup command or put them next to ciphertext in Git.
Production backups and patient records were not accessed.

On a rebuild, account for umask and container UIDs: Mongo keyfile 0400 owned by
the Mongo UID; Mongo secret files narrowly readable by that container group;
Redis TLS directory explicitly 0750 after creation, key 0640 with its group;
Nginx traversal only to its htpasswd file; API/access env files 0600. Read actual
image UIDs/GIDs; do not assume host and container group names mean the same thing.
Wait for first-volume Mongo initialization before replica initiation, then require
both data-service health checks before starting API/web. Do not delete a volume
to recover from a permission or initialization error.

## 1. Confirm the host and candidate before access

Obtain the exact Hostinger VPS, operating system, administrator access, hostname, staging domain and approved tester/VPN CIDRs. If shared with production, review free memory, disk, open ports and coexistence with the owner before any write. Do not inspect or copy production databases. Confirm which operator may create this separate project, install packages, issue certificates and add a staging vhost. Do not use existing production secrets or database names.

Use a supported Linux host with Docker Engine, Compose v2, Git, Nginx and certificate tooling installed from their official repositories. Installation is a later authorized host operation, not a CI step. Reserve space for image builds, the staging database and a synthetic backup. Image/OS vulnerability scans and resource sizing are prerequisites; Python/npm audits do not cover OS images.

## 2. Prepare a reviewed checkout and isolated secrets

After deployment authorization, create `/opt/nabitouch-staging/releases/<candidate-sha>` containing the reviewed source commit from `feature/codex-production-readiness`. Verify `git rev-parse HEAD` against the PR's exact reviewed candidate. Never build from an unreviewed branch tip. Use a read-only repository credential; do not copy a personal token into a Compose file or Docker layer.

Create `/etc/nabitouch-staging` outside the checkout with restrictive owner access. Copy the examples there as `api.env`, `frontend.env` and `compose.env`; fill values via a secure editor/secret manager, without printing them. The examples intentionally fail deployment preflight until real staging-only values are supplied.

Required files:

- `api.env`: start from `deploy/staging/api.env.example`. Supply independent owner/JWT/field keys, a staging owner identity, the actual HTTPS origin and Mapbox server token. Keep all delivery/card/import/upload/demo flags disabled. `DB_NAME` is exactly `nabitouch_staging`; the app Mongo user is `staging_app`, never the root user.
- `frontend.env`: only approved public frontend configuration. The API origin must exactly match `APP_URL`/CORS. A browser Mapbox token, if provided, must be public, distinct from the backend token and restricted to the staging origin. No server or payment credential belongs here.
- `mongo-root-password`, `mongo-app-password`, `mongo.key`: independent staging-only secrets. The app password must match the URL-encoded value in `api.env`. Determine the Mongo image's `mongodb` UID/GID, assign the keyfile to it and mode `0400`; parent directory permissions must permit the container to read the mounted file. Never reuse a production replica key.
- `redis-password`, `redis-users.acl`: set an authenticated default ACL user with the same password referenced in the URL-encoded `REDIS_URL`; no anonymous/no-password user. Keep ACL contents out of argv/logs.
- `redis-tls/{ca.crt,redis.crt,redis.key}`: a staging CA/server certificate with SAN `redis`, correct chain and readable permissions for the chosen Redis image. The API receives only the CA certificate, not Redis's private key. `REDIS_URL` must use `rediss://` and `/certs/ca.crt` verification; do not disable certificate checks.
- `https/{fullchain.pem,privkey.pem}`: a valid certificate for the actual staging hostname, issued/installed only with later DNS/certificate authorization.

Restrict env/password/private-key files to their owner and the specific container identity that needs them. Do not put secret values in Git, shell history, screenshots, tickets, PRs or build args. The field key must decode to 32 bytes; store its recovery copy separately from database backups.

## 3. Build images; validate without starting staging

For a reviewed candidate, after build authorization:

```bash
docker build -f deploy/Dockerfile.api -t "nabitouch-staging-api:$CANDIDATE_SHA" .
# Export only the two public values from the reviewed frontend.env; never source api.env.
docker build -f deploy/staging/Dockerfile.web \
  --build-arg REACT_APP_BACKEND_URL --build-arg REACT_APP_MAPBOX_PUBLIC_TOKEN \
  -t "nabitouch-staging-web:$CANDIDATE_SHA" .
python3 deploy/staging/preflight.py --api-env /etc/nabitouch-staging/api.env --frontend-env /etc/nabitouch-staging/frontend.env
docker compose --env-file /etc/nabitouch-staging/compose.env -f deploy/staging/compose.yml config --quiet
```

Record image digests and replace the image placeholders in `compose.env` with those immutable candidate images. The API installs only the hash-locked runtime dependencies; the web image compiles the frozen Yarn tree and contains only static output and Nginx configuration. `.dockerignore` excludes environment files, historical snapshots, health/test records, source credentials, Git, dependency caches and test reports. No secret is embedded in an image.

The preflight is read-only: it does not contact services, write configuration or deploy. It checks the initial disabled-integration state, exact HTTPS origins, staging database destinations, credential placeholders, encrypted Redis and application guards. It cannot prove DNS, TLS certificates, provider authorization, secret custody or matching password-file contents. Those require operator verification. Do not display expanded Compose configuration containing secrets; use `--quiet`.

## 4. Initialize only the new staging data services

**Only after explicit deployment authorization**, using the reviewed `compose.env` and this project's file:

```bash
docker compose --env-file /etc/nabitouch-staging/compose.env -f deploy/staging/compose.yml up -d mongo redis
docker compose --env-file /etc/nabitouch-staging/compose.env -f deploy/staging/compose.yml exec mongo mongosh --quiet /opt/init-replica.js
docker compose --env-file /etc/nabitouch-staging/compose.env -f deploy/staging/compose.yml up -d --wait mongo redis
docker compose --env-file /etc/nabitouch-staging/compose.env -f deploy/staging/compose.yml up -d --wait api web
```

Mongo's first-volume initialization creates the restricted app user; replica initiation is a separate explicit step. Health waits must not run before that step. If the volume already exists, initialization scripts do not rerun: stop and investigate the staging-only state rather than deleting data or changing production credentials. Never attach an existing production volume or restore production records.

Health checks require an authenticated writable Mongo primary, authenticated TLS Redis, and successful API Mongo/Redis checks; the web has `/healthz`. Check both the API dependency health and the static page, not just HTTP 200. The application launch seed contains no fictional patients/bookings and its practitioner draft is inactive; provision only synthetic acceptance accounts/catalogue configuration via supported owner administration and MFA enrollment.

## 5. Activate HTTPS and controlled tester access, later

Have the authorized operator review `deploy/staging/nginx-https.example.conf`. Configure the two staging hostnames, dedicated certificate paths and protected staging htpasswd file. Confirm the loopback port is free and use only the staging vhost. Test with `nginx -t` before reload; do not replace production site files or bind a new container to ports 80/443. Keep the tester authentication gate until a separate exposure decision.

The exact Stripe and Resend callback locations bypass the tester authentication gate because providers cannot supply tester credentials. Their application signature checks must remain enforced; configure actual provider endpoints only in their acceptance phase. Do not expose generic admin/API routes publicly. Confirm HTTPS, cookie security, origin behavior, owner MFA, request limits, access/error-log redaction and both health layers. No public booking cutover follows from staging health.

## 6. External acceptance handoff

Use the [provider activation handoff](PROVIDER_ACTIVATION_STAGING.md) for the
Mapbox configuration/storage gate, dedicated Stripe HTTPS endpoint/native resend,
and later separately authorized Resend/Firebase phases. No provider activation or
hosting changes follow automatically from passing local checks.

Follow `CODEX_STAGING_CHECKLIST.md`. Initial preflight deliberately rejects external credentials/enabled delivery; after acceptance authorization, separately review each staging configuration change rather than treating that initial guard as a validator for enabled integrations.

- Stripe: staging sandbox identity, supported test key, endpoint-specific webhook secret and reachable HTTPS callback; hosted deposit/full/decline/3DS/expiry/replay/reconciliation. Live payments remain prohibited.
- Resend: verified approved sender, webhook secret and the exact explicitly authorized test inbox; set redirection before enabling one controlled delivery. Do not use customer addresses or enable automatic customer mail.
- Mapbox/browser: real staging server/browser tokens and a connected browser; run desktop/mobile flows without the QA runner's mocks. Review existing Recharts warnings visually.
- Android: physical device/build/signing identity and dedicated Firebase project; confirm secure storage, FCM lifecycle, offline/background GPS and external navigation. Add only reviewed native CORS origins when that phase is authorized. iOS remains independently blocked.

The local QA runner always forces isolated mocks and is not a staging server. Do not use it for external-provider acceptance. Retain redacted evidence tied to commit/image/device identifiers, never health records or secret values.

## Rollback and recovery checklist

This is the first staging application release; there is no earlier approved
staging image to switch back to. For an acceptance failure, keep the staging TLS
and tester gate, stop only staging `api` and `web` with the exact Compose/env paths
below, and preserve Mongo/Redis volumes and evidence. A staging 502/503 during
containment is preferable to forwarding staging hostnames into production. Restore
the reviewed staging image/configuration only after the cause is understood.

```bash
docker compose --env-file /etc/nabitouch-staging/compose.env \
  -f /opt/nabitouch-staging/releases/97fde6f383505c54ced07823c3d2f012afd118c8/deploy/staging/compose.yml \
  stop api web
```

This containment command is documented, not executed as a release rollback. The
four-service restart and new-database restore tests were executed separately.
Never use `down -v`, remove the staging vhost into a production default route,
overwrite production Nginx files, or restore a recovery archive over the app DB.

- [ ] Before any authorized change, record prior staging image digests, configuration version, volume names, counts and indexes, and take an encrypted staging-only backup. Hold field keys separately; verify an off-host copy and restoration/decryption into a new staging recovery database.
- [ ] Record the currently active staging vhost and tester restriction configuration. Identify an operator who can stop the candidate and restore the prior staging images/vhost without touching production.
- [ ] If health/authentication/payment/privacy acceptance fails, disable the staging vhost/candidate and preserve evidence; restore prior staging images/configuration. Do not automatically drop indexes or overwrite the database.
- [ ] If recovery is needed, restore to a new staging database, reconcile intervening synthetic transactions and obtain separate cutover authorization. Do not use `down -v`, `--drop`, a production namespace or a production volume in staging rollback instructions.
- [ ] Recheck HTTPS, owner MFA, both health layers, booking/card/delivery guards and data counts after rollback. Record what actually ran and the resulting image/configuration identities.

Current recommendation remains NO-GO for production release. Staging deployment,
HTTPS/renewal, authentication, restart and on-host synthetic restore were executed
and passed. Provider isolation/acceptance, off-host recovery and the remaining
master release gates are recorded in the current report; a production cutover or
production rollback was not performed.
