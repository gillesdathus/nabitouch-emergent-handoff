# Corporate Wellness Studio — silent homepage redirect fix

**Date:** 2026-10-30  
**Production URL observed:** `https://nabitouch.com/owner/wellness-studio` → `https://nabitouch.com/`  
**Auth context:** Authenticated Owner (confirmed)

---

## Root cause (two layers)

### 1. Feature not in production bundle (primary)

`/owner/wellness-studio` is **not** registered in the live SPA.  
`grep wellness-studio /var/www/nabitouch-next/assets` → **no matches**.

Feature commit SHA: **none** (implementation still uncommitted locally).  
Deployed production frontend lineage: `e018349` + hist-treatments static hotfix (`2026-10-31T012741Z`).

### 2. Catch-all silently sends unknown routes to `/` (why you see home)

In `frontend/src/App.js` production still has:

```jsx
<Route path="*" element={<Navigate to="/" replace />} />
```

When React Router finds no matching `/owner/wellness-studio` child route, the `*` route runs and **replaces the URL with `/`**. That looks like an auth bounce even though the Owner session is valid.

Nginx SPA fallback is fine: `try_files $uri /index.html` — nested paths are served to the client correctly.

Staff auth already does the right thing for signed-out users:

```jsx
<Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
```

---

## Code correction (local, ready to release)

| Change | Purpose |
|--------|---------|
| Replace `*` → `Navigate to="/"` with `<NotFoundPage />` | Unknown routes → **404**, not public home |
| `StaffShell` wrong workspace → `<ForbiddenPage />` | Unauthorized signed-in user → **403** |
| Keep `/login?next=` for signed-out staff | Login then return to Studio |
| Keep `/owner/wellness-studio` routes + nav | Owner opens Studio once deployed |
| `frontend/src/pages/RouteStatus.jsx` | Shared 404 / 403 UI |

**Not changed:** patient records, invitations, bookings, billing, practitioner identities, merge execution, campaign send.

---

## Expected behaviour after release

| Actor | `/owner/wellness-studio` |
|-------|---------------------------|
| Authenticated Owner / Manager (`owner` workspace) | Studio Overview opens |
| Signed out | `/login?next=/owner/wellness-studio` then return |
| Signed in without owner workspace | **403** Access denied |
| Truly unknown path (e.g. `/owner/nope`) | **404** Page not found |
| Missing Studio in an old bundle | **404** (not silent `/`) |

---

## Test results

```
vitest run src/pages/RouteStatus.test.jsx \
  src/pages/owner/wellness-studio/WellnessStudioDashboard.test.jsx

Test Files  2 passed (2)
Tests       10 passed (10)
```

Covers: 404 vs silent `/` redirect, StaffShell 403, login `next=`, Wellness Overview still synthetic/inert.

---

## Deployment status

**Not deployed. Awaiting approval.**

| Item | Value |
|------|--------|
| Feature commit SHA | N/A until commit |
| Deployed production SHA | Frontend from `e018349` + hist-treatments hotfix bundle |
| Production verification | Pending post-deploy: Studio opens; refresh keeps URL |

---

## Release plan (approve before execute)

**Smallest safe frontend-only release** (no API restart required):

1. Create branch from `origin/main` @ `e018349` (avoid unfinished billing WIP).
2. Commit only:
   - `frontend/src/pages/RouteStatus.jsx` (+ test)
   - `frontend/src/pages/owner/wellness-studio/**`
   - `frontend/src/components/wellness/**`
   - `frontend/src/fixtures/wellnessStudio.js`
   - `App.js` (Studio routes + NotFound catch-all)
   - `shells.jsx` (Studio nav + Forbidden)
   - `Manage.jsx` (Studio hub link)
3. PR → CI → merge (or approved hotfix SHA).
4. Hostinger static stage:
   - `npm ci && npm run build` in frontend
   - Backup `/var/www/nabitouch-next`
   - Stage `dist/` → `/var/www/nabitouch-next`
   - Do **not** swap API image / touch Mongo / invites / Stripe
5. Verify as Owner:
   - https://nabitouch.com/owner/wellness-studio opens Overview (refresh keeps path)
   - More → Corporate Wellness Studio
   - Manage → Corporate Wellness Studio
   - Signed-out window: login returns to Studio
   - Spot-check `/owner`, bookings entry, invitations, invoices

Reply: **“Approve Wellness Studio + route-guard frontend deploy from main”**
