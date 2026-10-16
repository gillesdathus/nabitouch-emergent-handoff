# Hostinger VPS staging provisioning — preparation only

Hostinger VPS with Docker Compose was explicitly selected for this phase. **No VPS was accessed and nothing was provisioned or deployed.** The VPS identity/IP, whether it is dedicated or shared, staging DNS name, tester access CIDRs and deployment authorization are still required. Do not infer authorization from the commands below.

The new project is `nabitouch-staging`; it uses its own Mongo volume, authenticated staging-only users, replica set, TLS Redis and network. It does not join the existing `nt-next`/production networks or reference their volumes. Only the web container publishes a loopback port, default `127.0.0.1:18081`. HTTPS is a separate, reviewed host Nginx vhost. Existing production Nginx/DNS are never replaced by this guide.

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

Have the authorized operator review `deploy/staging/nginx-https.example.conf`. Replace the placeholder hostname, certificate paths and documentation-only CIDR. Confirm the loopback port is free and use a new staging vhost. Test with `nginx -t` before an authorized reload; do not replace production site files or bind a new container to ports 80/443. Keep tester/VPN access restrictions until a separate exposure decision.

The Stripe and Resend callback locations bypass the tester CIDR gate because provider callbacks cannot join the tester VPN. Their application signature checks must remain enforced; configure actual provider endpoints only in the authorized external-test phase. Do not expose generic admin/API routes publicly. Confirm HTTPS, cookie security, origin behavior, owner MFA, request limits, access/error-log redaction and both health layers. No public booking cutover follows from staging health.

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

- [ ] Before any authorized change, record prior staging image digests, configuration version, volume names, counts and indexes, and take an encrypted staging-only backup. Hold field keys separately; verify an off-host copy and restoration/decryption into a new staging recovery database.
- [ ] Record the currently active staging vhost and tester restriction configuration. Identify an operator who can stop the candidate and restore the prior staging images/vhost without touching production.
- [ ] If health/authentication/payment/privacy acceptance fails, disable the staging vhost/candidate and preserve evidence; restore prior staging images/configuration. Do not automatically drop indexes or overwrite the database.
- [ ] If recovery is needed, restore to a new staging database, reconcile intervening synthetic transactions and obtain separate cutover authorization. Do not use `down -v`, `--drop`, a production namespace or a production volume in staging rollback instructions.
- [ ] Recheck HTTPS, owner MFA, both health layers, booking/card/delivery guards and data counts after rollback. Record what actually ran and the resulting image/configuration identities.

Current recommendation remains NO-GO for release. This guide and Compose file are prepared and statically validated; no Hostinger staging stack, TLS setup or rollback was executed.
