# Nabitouch frontend handoff

This package describes the current React/Vite application so a Lovable redesign can replace presentation without replacing behavior.

Cursor remains responsible for connecting an approved design back to this repository, then checking security and business rules. Lovable should not invent a second backend.

## Baseline

| Item | Value |
| --- | --- |
| Repository | Nabitouch mobile practice application |
| Branch | `feature/frontend-vite-security-migration` |
| Commit | `f93e52df865bc8ecd806de86d95e9389121a9653` |
| Commit subject | Keep staff practice in a separate training database. |
| Frontend | React  and Vite in `frontend/` |
| API client | `frontend/src/lib/api.js` |
| Routes | `frontend/src/App.js` |
| Backend | FastAPI in `backend/`, MongoDB |
| Auth | Email and password, httpOnly cookies, TOTP for privileged roles |

The handoff was prepared on this commit. No application source was changed for the handoff itself.

Unrelated uncommitted files were already in the working tree and were left untouched:

- `docs/PRODUCTION_RELEASE_RUNBOOK.md` (modified)
- `deploy/apply-owner-password.py`
- `deploy/reset-owner-password.sh`
- `deploy/set-resend-credentials.sh`

Those files are outside this handoff. Do not copy them into Lovable.

## Frontend build and test status

A production frontend build was not run for this documentation pass because no frontend source changed.

Targeted tests already recorded on this branch, before this handoff:

| Suite | Result |
| --- | --- |
| `frontend/src/components/ops/VisualCalendar.test.jsx` | 2 passed |
| `frontend/src/pages/owner/Campaigns.test.jsx` | 1 passed |
| `backend/tests/test_training_isolation.py` | 4 passed |

Those results describe the commit above. They are not a full regression suite.

## How the app is shaped

The signed-in browser loads one role-scoped snapshot from `GET /api/state`, then calls specific endpoints for writes. Most owner screens read that snapshot through `frontend/src/store/DemoStore.jsx`.

Privileged roles are `owner`, `practitioner`, and `desk` (reception). There is no separate `manager` role in authentication. A training manager is an `owner` role inside the training database only.

## Documents in this folder

1. `SCREEN_INVENTORY.md` — routes, roles, and actions
2. `API_CONTRACTS.md` — methods the frontend actually calls
3. `ROLES_AND_PERMISSIONS.md` — implemented access
4. `BRANDING.md` — approved identity
5. `UX_ISSUES.md` — problems the redesign should solve
6. `DESIGN_REQUIREMENTS.md` — target experience
7. `DEMO_MODE_SPEC.md` — isolated training, existing versus remaining work
8. `INTEGRATION_CHECKLIST.md` — what must still pass after a Lovable import
9. `ASSET_MANIFEST.md` — files to reuse

## Boundaries

- Keep the existing FastAPI and MongoDB contracts.
- Do not add Supabase, a new auth provider, or a replacement booking or payment engine.
- Mobile massage stays available. In-clinic booking stays off in the public flow until the clinic setting is explicitly enabled.
- Disabled features must stay visibly unavailable. Do not draw them as working.
- Do not present invented revenue, visits, or alerts as business data.
- Do not deploy, push, or merge from this handoff.
