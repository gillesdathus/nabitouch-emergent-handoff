# NabiTouch Engage — Phase 1 UI prototype

**Date:** 2026-10-30  
**Status:** Interactive UI ready for UI/UX review  
**Constraint:** Synthetic data only. No real bookings, PHI persistence, messages, or public deploy.

---

## What shipped

Public **Engage** employee check-in / event intake experience (prototype for `engage.nabitouch.com`):

- Full-viewport, no page-level scrolling shell
- Step-by-step flow with progress, large touch targets, reduced-motion transitions
- Shared tablet idle Start + privacy reset + 90s idle wipe
- Phone mode QR-style deep link (`/engage/:eventId`) with non-sensitive progress only in `sessionStorage`
- Clinically structured screening (not a single oversimplified question)
- Hard contraindications → private follow-up path (employer-safe copy)
- Multi-page readable consent viewer
- Confirmation check-in code (synthetic; no booking write)

---

## Routes

| Path | Purpose |
|------|---------|
| `/engage` | Default demo event (Aurora chair day) |
| `/engage/:eventId` | Event deep link (`aurora-chair-day`, `clearsky-afternoon`) |
| `?mode=tablet` | Shared tablet / kiosk behaviour |
| `?mode=phone` | Employee phone (default) |

**Entry from Wellness Studio:** Overview → Prepared integrations → Employee engage.

---

## Suggested review checklist

1. **Phone portrait** `/engage?mode=phone` — welcome → contact → slot → screening → focus → consent → confirm  
2. **Soft keyboard** — focus email/phone; footer stays above keyboard (`--nb-keyboard-inset`)  
3. **Tablet** `/engage?mode=tablet` — Start → complete → Finish clears → privacy reset → Start again  
4. **Hard stop** — answer “fever/unwell = Yes” → private follow-up (no employer disclosure of reason)  
5. **Consent** — all three pages readable; checkbox only on last page  
6. **Large text / narrow width** — no horizontal overflow; progress remains visible  
7. **Reduced motion** — OS reduce-motion: transitions collapse  

---

## Files

| File | Role |
|------|------|
| `frontend/src/fixtures/engage.js` | Synthetic events, screening, consent copy |
| `frontend/src/lib/engage.js` | Validation, mode, progress helpers |
| `frontend/src/pages/engage/EngageApp.jsx` | Orchestrator + tablet timeout |
| `frontend/src/pages/engage/EngageShell.jsx` | No-scroll shell |
| `frontend/src/pages/engage/EngageSteps.jsx` | Step screens |
| `frontend/src/pages/engage/*.test.jsx` / `lib/engage.test.js` | UI + unit tests |
| `frontend/src/App.js` | Routes |
| `frontend/src/index.css` | Engage surface tokens |

---

## Explicit non-goals (this phase)

- No API calls, bookings, identity writes, or clinical database
- No SMS/email
- No production DNS / `engage.nabitouch.com` cutover
- No second booking engine

---

## Stop point

**UI/UX approved 2026-10-30.** Phase 2 thin API integration: see `docs/ENGAGE_PHASE2_INTEGRATION_2026-10-30.md`.

Appointment writes remain gated (`ENGAGE_WRITES_ENABLED` default off).
