# Nabitouch — final production cutover preparation

**Date:** 17 October 2026  
**Branch:** `feature/codex-production-readiness`  
**Release candidate SHA:** `0a0d8c74336299bce9958bd39ede2769201a4fd5`  
**Draft PR #1:** remains unmerged (not merged by this work)  
**Recommendation:** **NO-GO** for production cutover until owner decisions below are completed.

This document prepares an executable release. It does **not** authorize backup, Nginx reload, compose start against public traffic, live Stripe, or production data changes.

---

## 1. Release candidate verification

| Check | Result |
| --- | --- |
| Local HEAD | `0a0d8c74336299bce9958bd39ede2769201a4fd5` |
| Message | Record refund fixture fix and reconfirm webhook cutover plus restore-drill readiness. |
| Working tree | Clean (synced with `origin/feature/codex-production-readiness`, ahead/behind `0 0`) |
| Remote sync | `git fetch` + compare: local == origin |
| Uncommitted release changes | None on this branch |
| Diff vs `origin/main` | Large (139 files / ~10k insertions) — full production-readiness branch, not a hot-fix |
| GitHub PR / CI via API | **Not readable** from this workspace (`gh` unauthenticated; public API 404 for private repo). Owner must confirm Draft PR #1 + CI in the GitHub UI before merge |

### Recent verified automation (this campaign)

| Suite | Result |
| --- | --- |
| `test_stripe_sandbox.py` | 24 passed |
| `test_checkout_reconciliation.py` | 5 passed |
| `test_payment_policy.py` + `test_recovery.py` | 41 passed |
| Frontend Vitest | 88 passed |
| Frontend production build | PASS |
| Acceptance Mongo restore drill | PASS (81 collections; probe DB dropped) |

### Untested / not re-run this turn

- Full live-API booking suite (rate-limiter risk; prefer TestClient where possible).
- Real Stripe Dashboard → HTTPS delivery on production hostname.
- Encrypted `nabitouch_prod` backup (requires owner `CONFIRM_PRODUCTION_BACKUP=yes`).
- Private API image build at SHA `0a0d8c7` on the VPS (deploy script still pins an older frozen SHA — see §4).

---

## 2. Current production deployment (read-only)

### Public internet (re-probed 17 Oct 2026)

| Probe | Result |
| --- | --- |
| `GET https://nabitouch.com/api/health` | `200` `{"status":"ok","db":"up",...}` — **legacy Emergent health shape** |
| `GET https://nabitouch.com/api/` | `200` `{"name":"NabiTouch API","status":"ok"}` |
| `GET /api/auth/config` | **404** (exists on this repo’s API) |
| `GET /api/billing/stripe/status` | **404** |
| `POST /api/billing/stripe/webhook` | **404** |
| `POST /api/stripe/webhook` | **404** |
| Homepage `Server` | `nginx/1.24.0 (Ubuntu)` |
| TLS :443 | Reachable |

### Architecture (from prior host inventory + `docs/HOSTINGER_REPLACEMENT.md`)

| Layer | Live today |
| --- | --- |
| DNS | `nabitouch.com` / `www` → Hostinger VPS (`srv1393944`) |
| Nginx | Proxies public site to **`127.0.0.1:8080`** (`nabitouch_frontend` in Compose project **`nabitouch-rmt`**) |
| API | Inside that stack: frontend proxies `/api/` → **`nabitouch_backend:8001`** on private Docker network |
| MongoDB (public stack) | `nabitouch_mongo`, DB name **`nabi_touch`** (legacy schema — not `nt_*`) |
| Redis (public stack) | **None** |
| TLS | Let’s Encrypt `/etc/letsencrypt/live/nabitouch.com/` (expiry ~18–19 Nov 2026 — renew before then) |
| Parallel private stack | Prepared as **`nt-next`** on `127.0.0.1:8011`, DB **`nabitouch_prod`**, Redis TLS — **not** the public upstream today |

Host SSH inventory was last recorded 12 Oct 2026. This preparation did **not** SSH or modify the VPS.

### Why both Stripe webhook routes return 404

The public hostname still serves the **old Emergent/`nabitouch-rmt` API**. That codebase does not mount this repository’s billing router.

In **this** release candidate:

- `POST /api/billing/stripe/webhook`
- `POST /api/stripe/webhook` (alias)

are registered in `backend/billing.py`.

On **live** `nabitouch.com`, those paths do not exist → Nginx/upstream returns **404**. This is a **routing / cutover mismatch**, not a missing secret and not a Stripe Dashboard misconfiguration. Registering a Stripe endpoint at these URLs **before** Nginx points `/api/` at `nt-next` will only deliver 404s.

### Environment variable names (presence only — no values)

Prepared template: `deploy/env.hostinger.example` → future `/etc/nabitouch-next.env`.

Required name classes (do not print values):

- App: `APP_ENV`, `DEMO_MODE`, `APP_URL`, `CORS_ORIGINS`, `COOKIE_SECURE`, `JWT_SECRET`, `OWNER_EMAIL`
- Data: `MONGO_URL`, `DB_NAME` (must be `nabitouch_prod` for Stage C backup), `REDIS_URL`, `REDIS_PASSWORD`, `FIELD_ENCRYPTION_KEY`
- Integrations: `MAPBOX_TOKEN`, `EMAIL_PROVIDER`, `RESEND_*`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_MODE`
- Feature flags: `DOCUMENT_UPLOADS_ENABLED`, `STRIPE_CARD_CHECKOUT_ENABLED`, `LEGACY_PATIENT_IMPORT_ENABLED`

Public `nabitouch-rmt` uses a different env layout and DB name (`nabi_touch`). Do not assume keys are interchangeable.

---

## 3. Production backup procedure (prepared — not executed)

**Authorized script path:** `deploy/private-release/backup-encrypted.sh`  
**Review:** `docs/STAGE_C_BACKUP_RESTORE_REVIEW.md`  
**Confirmation gate:** `CONFIRM_PRODUCTION_BACKUP=yes` (refuse otherwise)

| Concern | Prepared control |
| --- | --- |
| Destination | `/root/nabitouch-next-backups/nabitouch_prod_<UTC>.archive.gz.aesgcm` (+ `.sha256`, `.manifest`) |
| Encryption | AES-256-GCM, PBKDF2 200k, prompted passphrase (not logged) |
| Permissions | Dir `700`, files `600`, run as root |
| Integrity | SHA-256 of ciphertext before decrypt; refuse empty/short archive |
| Source identity | `DB_NAME` in `/etc/nabitouch-next.env` must be exactly `nabitouch_prod` |
| Consistency | `mongodump --oplog` on replica set `rs0` |
| Restore isolation | Oplog replay only onto `nt-restore-*` container (`restore-oplog-isolated.sh`); never `--drop` onto live; scripts refuse `nabitouch_prod` overwrite on live mongo |
| Disk | Last recorded ~65–67 GiB free; archive expected kilobytes–small MiB class (re-measure with `df -hP /` before run) |
| Off-host copy | `transfer-encrypted-backup.sh` — **BLOCKED** until owner sets `OFFHOST_DESTINATION` |
| Field crypto | `FIELD_ENCRYPTION_KEY` is **not** in the archive; keep off-server |

### Operator sequence (after explicit owner approval only)

```text
# On srv1393944 as root, from a checkout containing deploy/private-release/
df -hP /
docker inspect nt-next-mongo --format '{{.State.Status}}'
CONFIRM_PRODUCTION_BACKUP=yes deploy/private-release/backup-encrypted.sh
# Compare sha256 of ciphertext to .sha256 file
CONFIRM_ISOLATED_RESTORE=yes deploy/private-release/restore-oplog-isolated.sh <ciphertext> nt-restore-<stamp>
# Validate counts inside that container only, then:
CONFIRM_REMOVE_ISOLATED_INSTANCE=yes deploy/private-release/remove-isolated-mongo.sh nt-restore-<stamp>
```

**Never** restore over `nabitouch_prod` on `nt-next-mongo` without a **second** owner confirmation.  
**Also preserve** the public Emergent DB `nabi_touch` and uploads volume before any public cutover (separate dump — schema is not `nt_*`).

Acceptance drill already proved dump→restore mechanics on the **acceptance** DB (81 collections). That is **not** a substitute for `nabitouch_prod`.

---

## 4. Smallest safe API / frontend cutover plan (not executed)

### Goal

Keep `nabitouch.com` branding and DNS. Switch public Nginx so:

- Static spa root → new Vite build (`/var/www/nabitouch-next`)
- `location /api/` → `http://127.0.0.1:8011` (`nt-next-api`)

That single change exposes this codebase’s Stripe webhook routes under the existing domain.

### Preconditions (all required)

1. Owner approves exact SHA `0a0d8c7` (or a later tagged successor).
2. Fresh encrypted backup of `nabitouch_prod` (+ off-host copy if destination named).
3. Separate dump/archive of public `nabi_touch` + current Nginx site file + current web root.
4. `nt-next` healthy on loopback: `curl -sS http://127.0.0.1:8011/api/health` shows **mongo + redis** (not legacy `db:up`).
5. Frontend staged to `/var/www/nabitouch-next` with `REACT_APP_BACKEND_URL=https://nabitouch.com`.
6. Live site file copied to `nabitouch.com.active` **before** edit.
7. **Update** `deploy/private-release/deploy-private-api.sh` frozen SHA / image expectations to this RC — today it still pins `6f67bcd…` and old image digests and will **refuse** this HEAD. That script edit is a **pre-deploy owner-approved** change, not done in this preparation.

### Proposed Nginx delta (verify with `nginx -T` before reload)

Preserve existing TLS `server_name nabitouch.com` / `www` blocks. Replace upstream for `/` and `/api/`:

```nginx
# Conceptual — adapt to the real site file path from nginx -T
root /var/www/nabitouch-next;

location /api/ {
    proxy_pass http://127.0.0.1:8011;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}

location = /index.html { add_header Cache-Control "no-cache"; try_files $uri =404; }
location / { try_files $uri /index.html; }
```

Reference examples (inactive): `deploy/frontend-static.example.conf`, `deploy/nginx.staging.not-active.conf`.

### Deployment command sequence (authorized later)

```text
# A. Build API image from approved checkout (after frozen-SHA pin updated)
CONFIRM_PRIVATE_DEPLOY=yes deploy/private-release/deploy-private-api.sh

# B. Stage frontend (from workstation build of same SHA)
CONFIRM_FRONTEND_STAGE=yes deploy/private-release/stage-frontend-static.sh \
  /var/www/nabitouch-next /path/to/frontend/build

# C. Save live Nginx, apply cutover file, test, reload
sudo cp /etc/nginx/sites-available/nabitouch.com \
        /etc/nginx/sites-available/nabitouch.com.active
# edit sites-available/nabitouch.com as above — do not enable until owner says go
sudo nginx -t && sudo systemctl reload nginx
```

Do **not** delete `nabitouch-rmt` containers/volumes on day one.

### Rollback (seconds)

```bash
sudo cp /etc/nginx/sites-available/nabitouch.com.active \
        /etc/nginx/sites-available/nabitouch.com
sudo nginx -t && sudo systemctl reload nginx
```

Optional: recreate private API from `nt-next-api:rollback-0081eac25d1e` / last-known-good tag using existing `/etc/nabitouch-next.env`. Do **not** drop `nabitouch_prod`.

### Expected downtime

| Step | Expectation |
| --- | --- |
| Private API recreate | Loopback only — public site unaffected |
| Frontend stage | Public unaffected until Nginx reload |
| `nginx reload` | Typically **&lt; 5 seconds** of interrupted requests; DNS unchanged |

---

## 5. Stripe readiness (code + policy — live payments still off)

| Control | Status in RC |
| --- | --- |
| Test / live separation | `sk_live_` refused for checkout; webhook rejects `livemode: true`; `PAYMENT_MODE=test` requires `livemode: false` |
| Signing secret | Empty → `503 Card webhook is not configured`; bad sig → `400` |
| Routes after cutover | `POST /api/billing/stripe/webhook` (+ `/api/stripe/webhook`) |
| Idempotency | `nt_stripe_events` by event id; ledger mutate by idempotency key; duplicate refund id settles once |
| Feature flag | Keep `STRIPE_CARD_CHECKOUT_ENABLED=false` on first public cutover |
| Refunds | Require reconciled PaymentIntent; before-capture → `503`; amount/currency mismatch → `409` |
| Browser return | Read-only; does not settle |
| Failure / retry | Non-2xx for unknown checkout / early refund asks Stripe to retry |

### First-cutover Stripe posture (recommended)

1. Cut over API with **empty** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` and **card checkout false**.
2. Confirm health + auth + booking without cards.
3. Separate approval: set **test** keys + Dashboard **test** endpoint → `https://nabitouch.com/api/billing/stripe/webhook`.
4. Prove signed test events (paid / unpaid / duplicate / expiry).
5. Separate approval again for `sk_live_` + live endpoint (not this plan).

Do **not** register a live webhook while public routes still 404.

Note: `deploy/env.hostinger.example` shows `PAYMENT_MODE=live` with empty keys — for a first public cutover prefer leaving card checkout off and following `docs/STRIPE_WEBHOOK.md` (test mode) until a dedicated live-payments approval.

---

## 6. Final release plan checklist

### Exact release SHA

`0a0d8c74336299bce9958bd39ede2769201a4fd5`  
(`feature/codex-production-readiness`, clean, pushed)

### Health checks (post-cutover)

```text
curl -sS https://nabitouch.com/api/health
# expect mongo + redis style (this app), not legacy {"db":"up"}

curl -sS https://nabitouch.com/api/auth/config
# expect 200 (was 404 on Emergent)

curl -sS -X POST https://nabitouch.com/api/billing/stripe/webhook \
  -H 'Content-Type: application/json' -d '{}'
# expect 400 invalid signature or 503 not configured — NOT 404
```

### Stripe webhook verification (after test keys approved)

Follow `docs/STRIPE_WEBHOOK.md`: signed paid/unpaid/async/expiry/duplicate; ledger single settlement.

### Remaining owner decisions (block GO)

1. Approve deploy of SHA `0a0d8c7` and whether Draft PR #1 may merge (CI green in GitHub UI).
2. Approve `CONFIRM_PRODUCTION_BACKUP=yes` and name off-host destination.
3. Approve update of frozen SHA / image pins in `deploy-private-api.sh` to this RC.
4. Approve Nginx cutover (save `.active`, reload).
5. Approve Emergent `nabi_touch` preservation dump + retention.
6. Approve when (if ever) to enable test Stripe on the public hostname.
7. Separate decision for live payments / live webhook.
8. Renew TLS before ~18 Nov 2026.
9. Complete owner MFA enrollment before enforcing privileged MFA.

### GO / NO-GO

**NO-GO** for production release and public cutover at this time.

Application automation on the feature branch is in strong shape. Public production still runs Emergent/`nabitouch-rmt` (hence webhook **404**). Encrypted `nabitouch_prod` backup, deploy-script pin update, Nginx cutover, and Stripe activation all require **explicit owner approval** and have not been executed.

---

## Explicit non-actions this preparation

- Did not merge Draft PR #1  
- Did not deploy, restart, or reload production Nginx  
- Did not run production backup/restore  
- Did not enable live or test Stripe on the public hostname  
- Did not modify production data or secrets  
- Did not expand infrastructure beyond documenting existing `nt-next` / Stage C scripts  
