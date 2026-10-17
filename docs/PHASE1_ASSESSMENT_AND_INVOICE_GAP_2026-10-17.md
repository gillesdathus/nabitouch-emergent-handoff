# Phase 1 assessment + invoicing gap (2026-10-17)

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff`  
**Branch:** `feature/codex-production-readiness`  
**Production API (reported):** `sha256:f6a73339…` (rollback)  
**RC / Gate B:** `0a0d8c7` / `sha256:080185ce…`

## Phase 1 — production failures (root causes)

| Symptom | FE call | RC backend | Rollback cause |
| --- | --- | --- | --- |
| Gift Cards 405 | `GET /api/giftcards`, liability, detail | `giftcards` router | Missing router; path hits `POST /{name}` → **405** |
| Welcome-back 405 | `GET /api/winback/*` | `winback` router | Missing router |
| `GET /api/services` 405 | catalogue / probes | `@api.get("/services")` | Missing route; generic method clash |
| Service create “Not permitted” | `api.create("services")` → `POST /api/services` | `@api.post("/services")` → `create_service` (owner) | Without dedicated route, `POST /{name}` **blocks** `services` with **403 Not permitted** |
| Practitioner invite 404 | `POST /api/auth/staff/invite` | `auth.invite_staff` | Route absent on rollback |
| Historical import denied | `POST /api/billing/imports*` | `history_import` + `LEGACY_PATIENT_IMPORT_ENABLED` | Flag off and/or route missing; not a silent allow |
| Period reports | `GET /api/reports/{kind}`, `POST /api/reports` | `finance` + `report_create` | Verify after API restore |
| Owner blank card | `GET /api/ops/turnaround` | `turnaround` board | FE stuck on loading pulse when API 405s (**fixed in FE**) |
| Stripe live boot fail | N/A | `validate_stripe_env` | Live keys rejected (**fixed in code**) |
| Reset email LOADING | Resend HTML | `emailtpl.wrap` + `reset_email_html` | Doctype/gradient (**fixed in code**) |
| Enumeration on mail fail | forgot-password | `a9a0a3f` | Already on branch |

**Phase 1 code remedy:** restore API image built from this branch (includes routers + Stripe/email fixes). FE TurnaroundBoard error state ships with the same release. **No Nginx / Stripe checkout / deploy in this phase.**

Confirm `EMAIL_TEST_RECIPIENT` before any live reset send — must not redirect patient resets to an unauthorized inbox.

## Manual invoicing & phone bookings — what already exists

| Need | Status |
| --- | --- |
| Invoice from appointment | **Yes** — `POST /invoices/from-appointment/{aid}` |
| Issue / void / PDF / email | **Yes** — billing router |
| Cash / e-transfer / claims / partial pay | **Yes** — ledger + idempotency keys |
| Stripe settle only via webhook | **Yes** — checkout gated; livemode still blocked for settlement while checkout off |
| Standalone multi-line invoice (no appointment) | **Missing** — no `POST /invoices` create |
| Phone/WhatsApp/SMS/walk-in booking source | **Partial** — `POST /bookings` sources are `online` \| `reception` only |
| NewBookingDialog (desk/owner) | **Yes** — reception-style booking UI |
| Patient search / create | **Partial** — clients via state + `PATCH`; create path needs dedicated staff create + duplicate checks |
| Create Invoice / Phone Booking quick actions | **Missing** UI |
| Manager role / multi-workspace RBAC | **Missing** (Phases 3–4) |

**Phase 5** should extend billing + bookings; reuse invoice issue/payment/PDF/email and `NewBookingDialog` patterns. Do not invent a second ledger.

## Commit boundary

Phase 1 commit = Stripe live validation, reset-email MIME/HTML, TurnaroundBoard states, focused tests, readiness docs. Deploy remains owner-approved only.
