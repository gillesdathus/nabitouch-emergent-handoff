# Engage — production checklist

**Date:** 2026-10-30  
**Goal:** Ship corporate event check-in on the existing NabiTouch booking + identity stack without a second clinical DB.

---

## Recommended cutover order

### A. Path launch (preferred first)

Serve Engage at **`https://nabitouch.com/engage`** (and `/engage/:eventId` QR links).

| Step | Action | Gate |
|------|--------|------|
| 1 | Deploy frontend + API with Engage routes | CI green |
| 2 | Confirm `FIELD_ENCRYPTION_KEY` is set in production | Required before any clinical sealing with writes |
| 3 | Set `ENGAGE_PUBLIC_ENABLED=true` | Public event + prototype check-in |
| 4 | Keep `ENGAGE_WRITES_ENABLED=false` | No appointments yet |
| 5 | QA tablet + phone flows on production URL | Synthetic seats OK |
| 6 | Staging: confirm venue geocode via Mapbox for each event address | `locate_visit` must succeed |
| 7 | Staging: set `ENGAGE_WRITES_ENABLED=true`, book one test guest | Appointment appears on Nabitu schedule with `appointmentKind: engage_event` |
| 8 | Production writes: set `ENGAGE_WRITES_ENABLED=true` only after step 7 sign-off | Owner + clinical lead |

### B. Subdomain (optional later)

`https://engage.nabitouch.com` → same SPA `/engage` routes.

| Extra | Detail |
|-------|--------|
| DNS + TLS | `engage.nabitouch.com` |
| Nginx | Proxy to same frontend; `/api` to API |
| `CORS_ORIGINS` | Include `https://engage.nabitouch.com` |
| Mapbox browser token | Allow that origin if maps are used on the page |

---

## Flags

| Variable | Production default in `deploy/env.hostinger.example` | Meaning |
|----------|------------------------------------------------------|---------|
| `ENGAGE_PUBLIC_ENABLED` | `false` until cutover | Public APIs |
| `ENGAGE_WRITES_ENABLED` | `false` | Create appointments |

Status probe: `GET /api/engage/status` → `readyForPublic`, `readyForWrites`, `blockers`.

---

## Ops surfaces

| Who | Where |
|-----|-------|
| Employees / kiosk | `/engage`, `/engage/:eventId?mode=tablet` |
| Owner | `/owner/wellness-studio/events` — attendance (no screening) |
| Therapist | `GET /api/engage/check-ins/{id}/precautions` (staff only) |

---

## Hard rules

1. **Do not** book corporate events with `ten-minutes-on-us` (consumer free trial). Use `workplace-chair`.
2. Employer attendance **never** returns screening, email, or phone.
3. Hard screening flags → private follow-up; **no** appointment even if writes are on.
4. Rate limit: 8 check-ins / 10 minutes per IP and per IP+email.
5. Production writes require encryption key + published `workplace-chair` service.

---

## Sign-off

| Role | Item | Done |
|------|------|------|
| Owner | Public Engage enabled on nabitouch.com | ☐ |
| Clinical | Venue addresses + screening copy approved | ☐ |
| Ops | Staging write test booked on Nabitu schedule | ☐ |
| Owner | Production `ENGAGE_WRITES_ENABLED` | ☐ |
