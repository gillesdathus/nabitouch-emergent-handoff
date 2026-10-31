# NabiTouch Engage — Phase 2 integration (gated writes)

**Date:** 2026-10-30  
**Status:** Thin API wired · UI approved · **appointment writes off by default**  
**Constraint:** Reuses clients + `POST /bookings` path. No second clinical DB or booking engine.

---

## What shipped after UI approval

| Layer | Change |
|-------|--------|
| `backend/engage.py` | Public event catalog, check-in, employer-safe attendance |
| `backend/server.py` | Mount Engage router; seed events on startup |
| `backend/config.py` | `ENGAGE_PUBLIC_ENABLED`, `ENGAGE_WRITES_ENABLED` |
| `frontend/src/lib/api.js` | `engageStatus` / `engageEvent` / `engageCheckIn` / `engageAttendance` |
| `frontend/src/lib/engageApi.js` | Load + submit helpers with fixture fallback |
| `frontend/src/pages/engage/*` | Live event fetch + check-in submit |
| Tests | `backend/tests/test_engage.py`, updated Engage UI tests |

---

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/api/engage/status` | Public | Flag mirror |
| `GET` | `/api/engage/events` | Public* | List seeded events + remaining seats |
| `GET` | `/api/engage/events/{id}` | Public* | Event + slots |
| `POST` | `/api/engage/events/{id}/check-in` | Public* | Validates screening/consent; stores check-in |
| `GET` | `/api/engage/events/{id}/attendance` | Staff | Names + slots + codes only — **no screening** |

\*Requires `ENGAGE_PUBLIC_ENABLED` (default **on** in development, **off** in production until set).

### Write gate

| Flag | Default | Effect |
|------|---------|--------|
| `ENGAGE_PUBLIC_ENABLED` | `true` non-prod / `false` prod | Read + check-in endpoints |
| `ENGAGE_WRITES_ENABLED` | `false` | When `true`, successful check-ins create appointments via existing `create_booking` (`locationType: event`, trial service) |

With writes **off**, check-in still records an `nt_engage_checkins` row (`writeMode: prototype`) and returns a check-in code. Screening is stored in `clinicalSealed` and never returned on attendance.

---

## Privacy model

- Employer/staff attendance projection omits email, phone, and clinical fields.
- Hard screening flags → `private_follow_up` status; no appointment even if writes are on.
- Soft flags remain on the sealed clinical blob for the treating therapist path (future open).

---

## How to review

1. UI (unchanged paths): `/engage?mode=phone`, `/engage?mode=tablet`
2. With API up (dev): banner should read **Engage API connected · prototype check-in (writes off)**
3. Unit: `pytest backend/tests/test_engage.py`
4. Frontend: `yarn test src/pages/engage/EngageApp.test.jsx src/lib/engage.test.js`

---

## Explicit non-goals (still)

- No `engage.nabitouch.com` DNS / public cutover
- No SMS/email templates for Engage yet
- No Wellness Studio event admin CRUD
- Do **not** set `ENGAGE_WRITES_ENABLED=true` in production until venue geo + Nabitu schedule capacity are signed off

---

## Phase 2b shipped toward production

1. `workplace-chair` catalogue (not free trial) + seed migration  
2. Check-in rate limits + readiness probe on `GET /api/engage/status`  
3. Staff precautions: `GET /api/engage/check-ins/{id}/precautions`  
4. Wellness Studio **Events** live attendance page  
5. Env templates + `docs/ENGAGE_PRODUCTION_CHECKLIST_2026-10-30.md`

**Still gated:** production `ENGAGE_PUBLIC_ENABLED` / `ENGAGE_WRITES_ENABLED` until checklist sign-off.
