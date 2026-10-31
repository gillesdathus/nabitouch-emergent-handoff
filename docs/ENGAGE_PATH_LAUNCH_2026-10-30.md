# Engage — path launch (checklist step 1)

**Date:** 2026-10-30  
**PR:** https://github.com/gillesdathus/nabitouch-emergent-handoff/pull/27  
**Branch:** `feature/engage-path-launch`  
**Commit:** `111499f0da7a8b286ac8a84226746fcf6eeae2f1`

---

## Goal

Serve Engage at **`https://nabitouch.com/engage`** (same origin). No `engage.nabitouch.com` DNS yet. **Writes stay off.**

---

## After CI / merge to main

On the production VPS:

```bash
CONFIRM_PROD_ENGAGE_PATH_DEPLOY=yes \
ENGAGE_SHA=<merged_main_sha> \
bash /path/to/repo/deploy/private-release/_ops_prod_engage_path_deploy.sh
```

The script:

1. Builds + restarts API with `backend/engage.py`
2. Forces `ENGAGE_WRITES_ENABLED=false` in `/etc/nabitouch-next.env`
3. Leaves `ENGAGE_PUBLIC_ENABLED=false` if unset (UI uses fixture fallback until step 2)
4. Stages static frontend to `/var/www/nabitouch-next`
5. Smokes `/engage` and `/api/engage/status`

---

## Smoke after deploy

| Check | Expect |
|-------|--------|
| `https://nabitouch.com/engage` | HTTP 200 SPA |
| `https://nabitouch.com/engage?mode=tablet` | Idle Start screen |
| `GET /api/engage/status` | `writesEnabled: false` |
| `/owner/wellness-studio/events` | Events ops page (owner session) |

---

## Next (checklist step 2+)

1. UI smoke as owner/guest  
2. Set `ENGAGE_PUBLIC_ENABLED=true` (still no appointments)  
3. Staging venue Mapbox + writes test  
4. Only then `ENGAGE_WRITES_ENABLED=true`

Full checklist: `docs/ENGAGE_PRODUCTION_CHECKLIST_2026-10-30.md`
