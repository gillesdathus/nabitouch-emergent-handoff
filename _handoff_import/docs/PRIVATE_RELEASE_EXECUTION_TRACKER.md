# Private release execution tracker

14 October 2026. This file is the execution record. It does not authorize a backup, a deploy, or a business-data change.

## Release source

| Item | SHA |
| --- | --- |
| Branch | `feature/frontend-vite-security-migration` |
| Frozen checkout | `6f67bcd23767d366942b2d3848a1f336f1fd06a8` |
| Application code | `20c101cb5b1d4d9d1e8c9918b0c198dcd47645bd` |
| Running private API | `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f` |

Commits from `20c101c` through `6f67bcd` are documentation only. Build the API and the frontend from the frozen checkout, or from a later commit on this branch only when `git diff --name-only 6f67bcd -- backend frontend` is empty. The guarded scripts in `deploy/private-release/` exit before any production action unless the confirmation variable named in each script is set to `yes`.

Running image that must still be present at the start of a later deploy: `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465` (`nt-next-api:local` and `nt-next-api:9aca5eccdc3c`). Rollback image that must be kept: `sha256:0081eac25d1edc251fb45d46ac8351008fffad0afbe5fe87eb9882f59745f7b6` (`nt-next-api:rollback-0081eac25d1e`).

## Milestones

| Milestone | Status | Evidence | Authorization |
| --- | --- | --- | --- |
| A. Execution package | COMPLETE | This tracker, the manifest deployment-source section, and `deploy/private-release/` | Local work allowed |
| B. Owner MFA | BLOCKED | At `2026-10-14T23:02:32Z` the established tunnel on `https://127.0.0.1:9443/` returned the owner authenticator page, HTTP 200, and the private health document. Public port 8443 was closed. Login, challenge, session, and logout were not performed | Owner must finish the browser steps |
| C. Encrypted backup | PREPARED — NOT EXECUTED | `docs/STAGE_C_BACKUP_RESTORE_REVIEW.md`. Oplog streaming backup, isolated replay, and off-host copy are prepared. Off-host destination is not configured. Backup, transfer, and restore were not run | Separate approval. Off-host copy is BLOCKED until a destination is named |
| D. Private deployment | PENDING | Commands in `deploy/private-release/deploy-private-api.sh` and `stage-frontend-static.sh`. Not run | Separate approval |
| E. Private acceptance | PENDING | Checklist below. Not started | After deployment |
| F. Business preparation | COMPLETE | Prepared values below. Not written to `nabitouch_prod` | Local preparation allowed |

## A. Commands

Run the scripts on the private host as root, from a checkout of the frozen source. They refuse to run until the named variable is `yes`. They do not print secrets, reload Nginx, or delete existing archives.

### Encrypted backup

Not run. The operator procedure is `docs/STAGE_C_BACKUP_RESTORE_REVIEW.md`. `deploy/private-release/backup-encrypted.sh` streams `mongodump --oplog` into AES-256-GCM and stores only the ciphertext, a SHA-256 file, and a secret-free manifest. It refuses write-quiescence mode, an oplog window under 3600 seconds, and any database outside `admin`, `local`, `config`, and `nabitouch_prod`.

### Off-host copy

BLOCKED. No destination is configured. `deploy/private-release/transfer-encrypted-backup.sh` refuses to run until `OFFHOST_DESTINATION` is an SSH directory that is not this host. It copies the ciphertext, the checksum, and the manifest.

### Isolated restore check

Not run. An oplog archive is restored only by `deploy/private-release/restore-oplog-isolated.sh` onto an `nt-restore-*` mongod with no network. `deploy/private-release/verify-isolated-restore.sh` refuses that manifest so it cannot replay onto `nt-next-mongo`. Removal of the throwaway mongod is `deploy/private-release/remove-isolated-mongo.sh`.

### Frontend static files

`CONFIRM_FRONTEND_STAGE=yes deploy/private-release/stage-frontend-static.sh <previous-tree> <new-build>`

The script tars the previous tree into `/root/nabitouch-next-backups/` and copies the new build to `/var/www/nabitouch-next`. It does not edit or reload Nginx. There is no `/var/www/nabitouch-next` today. The public site remains the `nabitouch_frontend` container on `127.0.0.1:8080`. Rollback is extracting that tar back over the staging directory, still without an Nginx change.

Before a later cutover, also record `docker image inspect nabitouch_frontend --format '{{.Id}}'`.

### API image

`CONFIRM_PRIVATE_DEPLOY=yes deploy/private-release/deploy-private-api.sh`

The script checks the frozen git SHA, refuses `/opt/nt-next`, checks the running and rollback image ids, checks that public `/` still proxies to `127.0.0.1:8080`, rechecks duplicate service ids and slugs, builds `nt-next-api:<frozen sha>`, and recreates only the `api` service with `docker compose up -d --no-deps api`. It does not insert promotions or practitioners. On a failed health check it tags `nt-next-api:9aca5eccdc3c` back to `nt-next-api:local` and recreates the API service the same way.

Local frontend build, before that script, from the frozen checkout:

```text
REACT_APP_BACKEND_URL=https://nabitouch.com
REACT_APP_MAPBOX_PUBLIC_TOKEN=<owner-supplied pk. token>
REACT_APP_TRACKING_MODE=simulated
corepack yarn build
```

Do not put the token in git. Keep `REACT_APP_TRACKING_MODE=simulated` until a separate decision enables live tracking.

## B. Owner MFA procedure

The owner does this in a browser. Do not send passwords, authenticator secrets, or six-digit codes in chat, logs, or this file.

1. Use the tunnel already recorded in `docs/PRODUCTION_RELEASE_RUNBOOK.md`: local port 9443 forwarded to the server's `127.0.0.1:8443`, with the existing ed25519 key. Do not open local port 8443. On this PC that port is a different listener. Do not change Nginx.
2. Open `https://127.0.0.1:9443/`. The private certificate warning is expected. The page title is Nabitouch owner authenticator.
3. Sign in as `info@nabitouch.com` with the existing owner password. Type it in the browser. Do not send it in chat.
4. When the authenticator challenge appears, enter the current code in that page. Do not use a recovery code unless the authenticator device is unavailable, and do not create a new authenticator.
5. Confirm an authenticated owner session opens.
6. Use Sign out. That calls `POST /api/auth/logout`.
7. Confirm the next visit requires sign-in again.

Checked at `2026-10-14T23:02:32Z`, without signing in. The tunnel was already running. `https://127.0.0.1:9443/api/health` returned the private health document. The public site health document was unchanged. Public TCP 8443 did not accept a connection. Stage B stays blocked until the owner reports that steps 3 through 7 passed or names the step that failed. The report must not include the password, the code, a cookie, or a session token.

Enforcement is already on. This procedure does not reset it, enroll a second secret, or turn on demo login. PASS is recorded only after the owner reports that all six steps finished. That report should say pass or fail, not the code.

## E. Post-deployment acceptance

Run only after an authorized private deploy. Use a test identity. Do not use a real client record.

| Check | Pass condition | If the data is absent |
| --- | --- | --- |
| API health | `127.0.0.1:8011/api/health` has mongo ok, redis ok, both flags false | Stop |
| Owner MFA | Stage B flow against the deployed private stack | BLOCKED until the owner finishes it |
| Service catalogue | The private stack lists the intended services | Do not publish or unpublish during the check |
| Practitioner profiles | A non-production practitioner profile can be opened | BLOCKED. Do not create Nabitu or any other practitioner |
| Booking and Mapbox | One test booking reaches a confirmed address | BLOCKED when no eligible practitioner exists |
| Appointment persistence | That test appointment is still present after a refresh | BLOCKED with the booking check |
| Pricing and GST | Treatment price, 5 percent GST, and total match the quote | BLOCKED with the booking check |
| WELCOME20 | First-booking discount matches the prepared rule | BLOCKED. `promo-welcome` is not in `nabitouch_prod` and must not be inserted here |
| Invoice snapshot | Invoice lines stay put after a catalogue price is not changed | BLOCKED until a test invoice exists |
| Private media | A private photo URL is 404 without a session and available to the owner | BLOCKED until a test photo exists |
| Restricted flags | Uploads, card checkout, and legacy import remain false | Stop if any is true |
| Rollback readiness | Current image id, rollback image id, archive checksum, and frontend tar are recorded | Stop |
| Public routing | `nabitouch.com` still proxies `/` to `127.0.0.1:8080` | Stop |

## F. Prepared business values, not applied

These stay in source until a separate authorization after the backup. Do not insert them during deployment.

| Item | Prepared value |
| --- | --- |
| WELCOME20 | `launch_welcome_offer()` in `backend/pricing.py`: `promo-welcome`, 20 percent, cap 40, first online booking, treatment only, not stackable, no dates |
| Cancellation | `launch_policy()`: status `pending`, `automaticFee` false, no automatic fee |
| Scheduling | Setup 10, cleanup 15, travel buffer 10, lead 90 minutes |
| Zones | Central Edmonton, inner ring, and outer ring, as already named in `docs/CONFIGURATION_CHANGE_MANIFEST.md`. Do not add a zone that is not already approved |
| Nabitu Kahindo | Draft id `p-nabitu-kahindo` only. Available false, bookable false, no specialties. Registration, insurance, email, services, and hours are not invented and are not created |
| Service publication | Owner reviews the 10 enabled services that have no `publication` field before any new frontend is routed. This package does not change them |
| Clinic booking | Remains disabled. No street address is added |
| Cash | Remains enabled |
| GST | Remains 5 percent |
| Still off | Rewards, referrals, NabiDerm, card checkout, document uploads, legacy import, public booking |

## Deployment event log

Copy one row per action. Leave secret columns out.

| UTC time | Actor | Action | Result | Image or archive id | SHA-256 | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |
