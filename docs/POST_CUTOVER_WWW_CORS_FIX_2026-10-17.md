# Post-cutover frontend fix — www CORS (2026-10-17)

**Symptom:** Public SPA stuck on "Can't reach Nabitouch — retrying..." / skeletons.
**Failing init:** `GET /api/state` via axios (`DemoStore.refresh`), with `withCredentials: true` and build-time `baseURL=https://nabitouch.com/api`.
**Root cause:** Browsers on `https://www.nabitouch.com` called the apex API origin. `CORS_ORIGINS` allowed only `https://nabitouch.com`, so the browser blocked the response (Nginx still logged HTTP 200).

## Fix applied (smallest safe change)

1. `/etc/nabitouch-next.env`: `CORS_ORIGINS=https://nabitouch.com,https://www.nabitouch.com`
2. Recreated `nt-next-api` only (same image digest `sha256:080185ce…`)
3. Nginx: `www.nabitouch.com` → `301 https://nabitouch.com$request_uri` (apex keeps static + `/api/` → `:8011`)

## Preserved

- API digest `sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f`
- Rollback image tags / `nabitouch.com.active`
- No Stripe enablement, no PR merge, no DB changes

## Verification

- `Origin: https://www.nabitouch.com` → `access-control-allow-origin: https://www.nabitouch.com`
- `https://www.nabitouch.com/` → `301` apex
- Public health / home / services / book / state → OK; `cardCheckout=false`
