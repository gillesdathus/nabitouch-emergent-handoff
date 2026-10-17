# FINAL CUTOVER SAFETY REPORT â€” 17 October 2026

**Recommendation: NO-GO** for public cutover, Nginx change, PR merge, or payment activation.

| Item | Value |
| --- | --- |
| Branch | `feature/codex-production-readiness` |
| Application RC (pinned) | `0a0d8c74336299bce9958bd39ede2769201a4fd5` |
| Pin file | `deploy/private-release/release-pin.conf` |
| Prior cutover prep | `docs/PRODUCTION_CUTOVER_PREPARATION_2026-10-17.md` |
| Stripe card checkout | **Must remain disabled** (`STRIPE_CARD_CHECKOUT_ENABLED=false`) |

This report prepares safety gates only. No public traffic was changed. No production database was modified. Draft PR #1 stays unmerged.

### Status addendum — Gate B complete (2026-10-17)

| Item | Status |
| --- | --- |
| Gate A encrypted backups + isolated restore | **PASS** |
| Off-host copy `C:\Nabitouch-Backups` + SHA-256 | **PASS** |
| Backup passphrase in owner password manager | **VERIFIED** |
| VPS temp passphrase shred | **DONE** (owner-confirmed earlier) |
| Gate B private loopback deploy | **PASS** — `POST_BUILD_DIGEST=sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f` on `:8011` |
| Public cutover / Nginx / PR merge / Stripe | **NO-GO** — not authorized |

Detail: `docs/GATE_B_PRIVATE_DEPLOY_RESULT_2026-10-17.md`, `docs/GATE_A_BACKUP_EXECUTION_RESULT_2026-10-17.md`, `docs/FINAL_PRE_DEPLOYMENT_EXECUTION_PLAN_2026-10-17.md`.

---

## 1. Exact pinned application SHA and artifacts

| Artifact | Value | Status |
| --- | --- | --- |
| Application SHA | `0a0d8c74336299bce9958bd39ede2769201a4fd5` | Reviewed RC |
| Short tag | `0a0d8c7` | Used for `nt-next-api:src-0a0d8c7` |
| Pre-deploy local/running digest | `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465` | Last known-good private image (`nt-next-api:9aca5eccdc3c` / `:local`) |
| Rollback digest (interim) | `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465` | `nt-next-api:pre-gate-b-f6a73339` — historical `0081eac` unavailable |
| Post-build digest for RC | `sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f` | Recorded after private loopback Gate B `health-ok` |

`deploy/private-release/deploy-private-api.sh` loads `release-pin.conf`, refuses any SHA other than this RC, keeps public Nginx on Emergent (`127.0.0.1:8080`), and requires card checkout / uploads / legacy import off. **Private Gate B executed 2026-10-17; public Nginx unchanged.**

Frontend artifact (when staged later): Vite `frontend/build` from the same SHA with `REACT_APP_BACKEND_URL=https://nabitouch.com` â€” not staged to `/var/www/nabitouch-next` in this work.

---

## 2. Legacy / new database compatibility

### Emergent public DB (`nabi_touch`) â€” metadata inventory (read-only, prior host audit 12 Oct 2026)

Source: `docs/HOSTINGER_REPLACEMENT.md`. Counts only; no document bodies were read in this preparation.

| Entity / collection | Approximate count | Notes |
| --- | --- | --- |
| `patients` | 17 | Closest analogue to `nt_clients` â€” **different schema** |
| Media / assets | 18 (+ 19 upload files, ~50 MiB volume) | Not `nt_media` shape |
| Users | 1 | Not the new role model |
| Import jobs | 1 | Legacy |
| CMS (services, FAQs, testimonials) | Present | Not `nt_services` catalogue |
| `soap_notes` | **0** (empty collection exists) | |
| `medical_flags` | Empty | |
| Appointments | **No collection** | |
| Invoices / payments / gift cards | **No collections** | |
| Insurance claims | **No collection** | |
| Consent (new-model) | **Not present** | |

Mongo volume ~505 MiB. Database name on public stack: **`nabi_touch`**. Engine: `nabitouch_mongo` inside Compose `nabitouch-rmt`. **No Redis** on that stack.

### Proposed production DB (`nabitouch_prod`) â€” this application

| Concern | Finding |
| --- | --- |
| Name | Must be exactly `nabitouch_prod` (Stage C backup + deploy script refuse otherwise) |
| Schema | `nt_*` collections (clients, appointments, invoices, ledger, consent, SOAP/clinical, gifts, etc.) |
| Stack | Isolated `nt-next` Mongo replica set `rs0` + Redis TLS â€” **not** the Emergent volume |
| Startup â€œmigrationsâ€ | Additive index creation in API lifespan (`ensure_*`); no destructive schema migrate-from-Emergent |
| Compatibility | **Not wire-compatible** with `nabi_touch`. Cannot mongorestore Emergent dumps into `nabitouch_prod` and expect the new API to serve them |

### Entity migration matrix (no data copied)

| Business entity | In Emergent `nabi_touch`? | Required before public cutover? | Guidance |
| --- | --- | --- | --- |
| Clients / patients | Yes (17) | **Owner decision** â€” preserve dump; import only with approved field map | Do not auto-copy |
| Appointments / active bookings | **No** | None to migrate | New stack starts empty of bookings unless seeded |
| Practitioners | CMS/user only â€” not `nt_practitioners` | Re-onboard or approved import | |
| SOAP notes | Empty | None | |
| Invoices / payment history | Absent | None | |
| Gift cards | Absent | None | |
| Consent records (new model) | Absent | None | |
| Uploads / media | Yes (18 + files) | Preserve volume + dump; import only if owner maps fields | Keep Emergent volume until archive accepted |

**Conclusion:** There is **no silent in-place upgrade path**. Cutover switches the public hostname to a **different database**. Patient rows in Emergent are **preservation + optional later migration**, not automatic continuity of active clinical/booking history (Emergent has no appointments/invoices to carry forward).

---

## 3. Coexistence and dual source-of-truth control

| Risk | Mitigation in this plan |
| --- | --- |
| Public site writing Emergent while private `nt-next` also takes bookings | **Before Nginx cutover:** only Emergent is public. Private API stays on `127.0.0.1:8011`. |
| After cutover, both stacks accepting public traffic | Cutover must point **all** `/api/` to `:8011` and stop using `:8080` for the vhost. Leave `nabitouch-rmt` running but **unreferenced** by public Nginx for rollback only. |
| Operators booking in both UIs | Single public URL; do not publish a second hostname to the old API after cutover. |
| Restoring Emergent dump into `nabitouch_prod` | Forbidden â€” schema mismatch; scripts and runbooks refuse overwrite of `nabitouch_prod` without second confirmation. |

**Gate:** Public cutover is allowed only when the owner accepts that the live booking/clinical system of record becomes `nabitouch_prod`, and Emergent `nabi_touch` becomes **archive / rollback**, not a second live writer.

---

## 4. Backup and off-host recovery prerequisites

| Prerequisite | Status |
| --- | --- |
| Encrypted oplog backup of `nabitouch_prod` | Prepared (`backup-encrypted.sh`); **not executed** â€” needs `CONFIRM_PRODUCTION_BACKUP=yes` |
| Targets correct DB | Script refuses unless `/etc/nabitouch-next.env` has `DB_NAME=nabitouch_prod` |
| Isolated restore | `restore-oplog-isolated.sh` â†’ `nt-restore-*` only; refuses live `nt-next-mongo` / production overwrite |
| Checksum | SHA-256 of ciphertext before decrypt |
| Off-host copy | **BLOCKED** until owner sets `OFFHOST_DESTINATION` |
| `FIELD_ENCRYPTION_KEY` off-server | Required separately â€” not inside archive |
| Emergent `nabi_touch` + uploads dump | **Still required** before public cutover (separate from Stage C); no dump found under common backup dirs in prior audit |
| Acceptance restore drill | PASS earlier (81 collections) â€” **does not** replace `nabitouch_prod` backup |

---

## 5. Emergent rollback availability

| Component | Keep until owner archives |
| --- | --- |
| Nginx site file | Copy to `nabitouch.com.active` before any edit |
| Compose `nabitouch-rmt` | Leave running; do not prune volumes |
| Frontend container `:8080` | Rollback target |
| `nabi_touch` Mongo volume | Leave intact |
| Uploads volume | Leave intact |

Rollback command (public traffic only):

```bash
sudo cp /etc/nginx/sites-available/nabitouch.com.active \
        /etc/nginx/sites-available/nabitouch.com
sudo nginx -t && sudo systemctl reload nginx
```

Private API rollback (loopback, if a private deploy of `0a0d8c7` already ran):

```bash
docker tag nt-next-api:9aca5eccdc3c nt-next-api:local
# or: docker tag nt-next-api:rollback-0081eac25d1e nt-next-api:local
docker compose -f deploy/docker-compose.hostinger.yml up -d --no-deps api
```

---

## 6. Nginx routing review (proposed cutover â€” not applied)

| Path | Today (Emergent) | After approved cutover |
| --- | --- | --- |
| `/api/` | Frontend container â†’ `nabitouch_backend:8001` | `proxy_pass http://127.0.0.1:8011` |
| SPA deep links | Old Vite shell | `try_files $uri /index.html` on `/var/www/nabitouch-next` |
| `/assets/` | Old hashed bundles | New build; long-cache immutable |
| Auth callbacks | Old session/cookie paths on Emergent API | New API on same host; `COOKIE_SECURE=true`, `CORS_ORIGINS=https://nabitouch.com` |
| Stripe webhooks | **404** (routes absent) | `POST /api/billing/stripe/webhook` (+ alias) on new API â€” still **no live keys** |
| `/uploads/` | Emergent backend | New stack: uploads remain **disabled** (`DOCUMENT_UPLOADS_ENABLED=false`) |

Inactive examples: `deploy/frontend-static.example.conf`, `deploy/nginx.staging.not-active.conf`.

Deploy script preflight still requires public vhost to proxy **`127.0.0.1:8080`** (and exactly one private `8011` location for operator tunnel). That guard **blocks accidental public cutover** during private API recreate.

---

## 7. Production configuration verification (no secret values)

Required for private deploy / later cutover (`deploy/env.hostinger.example` + `deploy-private-api.sh` + `validate-production-secrets.py`):

| Check | Required |
| --- | --- |
| `APP_ENV` | `production` |
| `DEMO_MODE` | `false` |
| `DB_NAME` | `nabitouch_prod` |
| `DOCUMENT_UPLOADS_ENABLED` | `false` |
| `STRIPE_CARD_CHECKOUT_ENABLED` | `false` |
| `LEGACY_PATIENT_IMPORT_ENABLED` | `false` |
| `REDIS_URL` | `rediss://â€¦` |
| `MAPBOX_TOKEN` | `pk.` prefix |
| Stripe secrets | Empty for first public cutover; never `sk_live_` without separate approval |
| Validator | `python3 deploy/validate-production-secrets.py` on VPS â€” prints PASS/FAIL/PENDING only |

This workspace did not read `/etc/nabitouch-next.env`. Owner must run the validator on the host before any deploy confirmation.

---

## 8. Deployment procedure (authorized later only)

### Private API recreate (no public traffic change)

```text
# Checkout APPLICATION_SHA; confirm release-pin.conf
CONFIRM_PRIVATE_DEPLOY=yes deploy/private-release/deploy-private-api.sh
# Expect health-ok on :8011 with cardCheckout=false; record POST_BUILD_DIGEST
```

Startup behaviour: additive indexes via lifespan; health must show mongo+redis ok and feature flags off. On failure, script retags previous good image and recreates API.

### Frontend stage (still no Nginx change)

```text
CONFIRM_FRONTEND_STAGE=yes deploy/private-release/stage-frontend-static.sh \
  /var/www/nabitouch-next /path/to/frontend/build
```

### Public cutover (separate owner approval)

1. Confirm backups (Stage C + Emergent dump).  
2. Save Nginx â†’ `.active`.  
3. Point `/` + `/api/` as in Â§6.  
4. `nginx -t && systemctl reload nginx`.  
5. Smoke: health shape, `/api/auth/config` 200, webhook path **not** 404 (400/503 without valid Stripe sig is expected), login, one read-only catalogue page.

### Smoke tests (post-cutover, cards off)

- `GET /api/health` â†’ mongo/redis style (not Emergent `db:up`)
- `GET /api/auth/config` â†’ 200
- `POST /api/billing/stripe/webhook` with `{}` â†’ 400 or 503, **not** 404
- Owner/practitioner/client sign-in smoke without clinical writes if owner prefers
- Confirm `cardCheckout: false` in health payload

---

## 9. Outstanding owner approvals

1. Confirm application pin `0a0d8c7` and later record `POST_BUILD_DIGEST`.  
2. `CONFIRM_PRODUCTION_BACKUP=yes` for `nabitouch_prod` + name `OFFHOST_DESTINATION`.  
3. Authorize Emergent `nabi_touch` + uploads off-server dump (counts-only restore drill).  
4. Decide patient migration: archive-only vs approved field-map import (default: **archive-only** for first cutover).  
5. Authorize private `CONFIRM_PRIVATE_DEPLOY` (loopback) then separately authorize Nginx cutover.  
6. Keep Stripe card checkout **disabled** until a further approval; test webhook registration only after routes stop 404â€™ing.  
7. Draft PR #1 merge only after GitHub CI review (not verified from this workspace).  
8. TLS renewal before ~18 Nov 2026.  
9. Owner MFA enrollment before enforcing privileged MFA.

---

## 10. Final GO / NO-GO

### **NO-GO** for public production cutover

Reasons that remain blocking:

1. Public hostname still serves Emergent (`health` = `db:up`; Stripe routes **404**).  
2. Emergent preservation dump / Gate C–G owner steps still required before public cutover.  
3. Owner cutover / migration / PR approvals outstanding.  
4. Dual-database nature requires explicit acceptance that Emergent is not a live parallel writer after cutover.

### What is ready

- Pinned RC + deploy script wired to `release-pin.conf`.  
- **Gate B PASS:** private `nt-next-api` on `:8011` at `POST_BUILD_DIGEST` `080185ce…` with health flags off.  
- Rollback tags `9aca5eccdc3c` / `pre-gate-b-f6a73339` retained on `f6a73339…`.  
- Schema incompatibility and migration matrix documented without exposing patient data.  
- Card checkout remains gated off in deploy and health checks.

---

## Explicit non-actions (still)

- Did not merge Draft PR #1  
- Did not change public Nginx / cut over nabitouch.com  
- Did not enable Stripe card checkout or register live webhooks  
- Did not authorize Gates D–G  
