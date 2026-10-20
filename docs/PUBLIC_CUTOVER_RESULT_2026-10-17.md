# Public cutover result — 17 October 2026

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff`  
**Branch:** `feature/codex-production-readiness`  
**Application RC:** `0a0d8c74336299bce9958bd39ede2769201a4fd5`  
**Deploy image:** `sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f`  
**Public cutover:** **PASS**  
**PR #1:** not merged  
**Stripe live card checkout:** remains **disabled**

## Phases

| Phase | Result |
| --- | --- |
| 1 Legacy patient export (17 records) | **PASS** — off-host under `C:\Nabitouch-Backups\Legacy-Patient-Export\` (owner+SYSTEM ACL); checksums verified; live ID-set hash matched |
| 2 Archive-only (no import) | **PASS** — `docs/LEGACY_PATIENT_ARCHIVE_ONLY_2026-10-17.md` |
| 3 Pre-cutover verification | **PASS** — digest, mongo/redis, auth/config, services (10; clinic/mobile flags present), rollback tags, legacy `:8080` healthy pre-cutover, frontend staged to `/var/www/nabitouch-next` |
| 4 Controlled public cutover | **PASS** |

## Cutover actions

1. Preserved prior Nginx as `/etc/nginx/sites-available/nabitouch.com.active`  
2. Staged RC Vite build to `/var/www/nabitouch-next`  
3. Switched public site: static root + `/api/` → `127.0.0.1:8011`  
4. `nginx -t` OK; reloaded  
5. Smoke: public health (new shape), home/book SPA assets, `/api/auth/config` 200, `/api/services` 200, Stripe webhook **503** (not 404), `cardCheckout=false`

## Rollback readiness

| Artifact | Status |
| --- | --- |
| `nabitouch.com.active` | Present (restore + reload restores Emergent `:8080`) |
| `nt-next-api:pre-gate-b-f6a73339` / `:9aca5eccdc3c` | Present (`sha256:f6a73339…`) |
| Emergent stack / `nabi_touch` / uploads | Left running; not deleted |
| Gate A `*.aesgcm` off-host | Intact |

## Explicit non-actions

- Did not merge Draft PR #1  
- Did not enable Stripe live payments / card checkout  
- Did not import legacy patients into `nabitouch_prod`  
- Did not delete legacy DB, volumes, or Gate A backups  
- Did not commit or print patient data  
