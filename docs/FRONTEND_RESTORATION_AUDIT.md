# Nabitouch — Frontend Restoration: Phase 1 Audit & Phase 2 Design System

Date: 2026-10-18 · Author: Emergent (E1) · Scope: frontend only · No deploy, no merge, no backend contract change.

## 0. Source verification

| Item | Value |
| --- | --- |
| Repository | https://github.com/gillesdathus/nabitouch-emergent-handoff |
| Remote branches | `main` @ `9df0d2b` (2026-10-16), `feature/codex-production-readiness` @ `b56137f` (2026-10-18 11:11 -0600) |
| Latest development source | `feature/codex-production-readiness` @ **`b56137f`** "feat: promotions hub plus practitioner profile and activation repair" (58 commits ahead of `main`) |
| Cursor work confirmed present | promotions hub (`b56137f`), Owner mobile layout repair (`fba84a1`), live Stripe checkout gate (`8b8dccb`), Mapbox temp checks (`a93c21d`), multi-role practitioner dashboard (`42fd0f6`), RBAC/workspaces/manual invoices (`7e354b6`, `78615c0`) |
| Proposed restoration branch | `feature/frontend-restoration` created from `b56137f` |
| Stack | React 19 + Vite 7 + Tailwind 3 + Radix/shadcn, Capacitor 7 shell · FastAPI + MongoDB (`nb_*` collections) |

Git writes are not made from this workspace. Use **Save to GitHub** and choose the new branch `feature/frontend-restoration`. Do not push to `main` or `feature/codex-production-readiness`.

### Preview-only environment changes (not committed, not production)
- `backend/.env` (preview pod only): `PAYMENT_MODE=simulated` → `test` and `EMAIL_PROVIDER=resend` → `disabled`. The API refused to start because Stripe *test* keys need `PAYMENT_MODE=test`, and test mode requires email delivery off. This stops preview mail from reaching real recipients. Stripe stays on **test keys**. No real-money transaction was started.
- `MAPBOX_PERMANENT_GEOCODING` was **not** turned on (it has billing implications). As a result, preview address confirmation returns 503 (see D-MAP-1).

### QA data (preview DB `nabitouch_dev` only)
- Accounts: owner (from env), `qa.practitioner@qa.nabitouch.com`, `qa.client@qa.nabitouch.com`. See `/app/memory/test_credentials.md`.
- QA Practitioner activated through the **real** endpoints: credentials, verify, weekly schedule, onboarding approve, schedule approve.
- 7 appointments `qa-a1…qa-a7` (`qaFixture: true`, `synthetic: true`) were inserted directly. Booking through the API was blocked because the clinic is disabled and permanent geocoding is off.
- 3 invoices were created through the **real billing API**: `NT-INV-00001` (issued, then a $50 cash payment), `NT-INV-00002` (issued), and one standalone draft.
- No production patient records were used.

## 1. Route inventory (75 routes)

| Shell | Routes |
| --- | --- |
| Public / Client (`ClientShell`) | `/`, `/login`, `/join`, `/forgot-password`, `/reset-password`, `/account/security`, `/services`, `/services/:slug`, `/practitioners`, `/practitioners/:slug`, `/contact`, `/track`, `/track/:token`, `/welcome`, `/book`, `/offers`, `/me`, `/me/rewards`, `/me/profile`, `/me/intake`, `/me/visit/:id/prepare`, `/me/reviews`, `/me/insurance`, `/me/billing`, `/me/billing/payment-result`, `/me/gifts`, `/me/plans`, `/me/messages/:id` |
| Practitioner (`StaffShell pro`) | `/pro`, `/pro/profile`, `/pro/visit/:id`, `/pro/visit/:id/messages`, `/pro/visit/:id/native`, `/pro/soap/:id`, `/pro/plans`, `/pro/earnings`, `/pro/ratings`, `/pro/availability`, `/pro/route`, `/pro/recovery` |
| Owner (`StaffShell owner`) | `/owner`, `/owner/schedule`, `/owner/dispatch`, `/owner/turnaround`, `/owner/feedback`, `/owner/messages`, `/owner/manage`, `/owner/promos`, `/owner/marketing`, `/owner/giftcards`, `/owner/plans`, `/owner/safety`, `/owner/winback`, `/owner/channels`, `/owner/clients/:id`, `/owner/campaigns`, `/owner/training`, `/owner/rewards`, `/owner/zones`, `/owner/insights`, `/owner/reports`, `/owner/permissions`, `/owner/payments`, `/owner/credentials`, `/owner/legacy`, `/owner/availability`, `/owner/routes`, `/owner/recovery` |
| Reception (`StaffShell desk`) | `/desk`, `/desk/dispatch`, `/desk/clients`, `/desk/clients/:id`, `/desk/giftcards`, `/desk/verify`, `/desk/messages`, `/desk/safety` |
| Other | `/train` (isolated training workspace), `*` → `/` |

Backend: 114+ route handlers in `server.py` and its routers (billing, payments, availability, onboarding, clinical, campaigns, rewards, tracking, messaging, and others). The frontend contract is in `frontend/src/lib/api.js`.

## 2. Defects found

Severity: P0 = blocks a business workflow · P1 = serious UX or accuracy problem · P2 = polish.

### Global shell / responsive
| ID | Sev | Defect | Status |
| --- | --- | --- | --- |
| G-1 | P0 | The floating pill bottom nav (`fixed bottom-3`) had icons only and no labels. Each page cleared it with its own padding (`pb-28`, `staff-main-pad 7.25rem`), so the nav overlapped content wherever a page skipped that padding. | **Fixed (Ph2)**: docked nav with labels and safe-area padding. One shared `--nb-bottom-clear` value is applied by both shells. |
| G-2 | P0 | Owner mobile could not reach about 21 "Inside Manage" destinations (Reports, Zones, Credentials, Campaigns, and others) except through the Manage hub. | **Fixed**: "More" bottom sheet lists every Owner destination. |
| G-3 | P1 | Toasts were anchored bottom-right, over the bottom nav and form buttons on mobile. | **Fixed**: `offset` and `mobileOffset` place toasts above the nav and safe area. |
| G-4 | P1 | The staff header used `safe-top` with a fixed `h-14`, which squeezed content under the iOS notch in standalone mode. The client header had no safe-top. | **Fixed**: height is now `--nb-header-h + safe-area-inset-top`. |
| G-5 | P1 | `min-h-screen` (100vh) is wrong under mobile browser chrome and keyboard resizing. | **Fixed**: `100dvh` with a 100vh fallback. |
| G-6 | P2 | Styling was ad hoc on every page (`rounded-3xl ring-1` repeated). There were no shared Panel, KPI, Empty, or Error primitives. | **Fixed**: `components/ds.jsx` plus tokens in `index.css`. |
| G-7 | P1 | Loading, empty, and error states were inconsistent or missing. Many pages render only "None." | Partly fixed (Dashboard, Calendar, Invoices). Remaining pages are Phase 3. |

### Owner Dashboard
| ID | Sev | Defect | Status |
| --- | --- | --- | --- |
| D-1 | P0 | **Financial KPIs came from `appointment.settle`, not the invoice ledger.** Standalone and manual invoices were never counted. With 3 real invoices the old dashboard showed "Collected $0" and "Outstanding $0". | **Fixed**: KPIs come from `GET /invoices` (server `public_invoice` projection). |
| D-2 | P1 | KPI cards had different sizes (a 1-col card, a 2-col gradient card, and a 2+1 grid). The outstanding card used a `col-span-2` wrapper that pushed outside the layout. | **Fixed**: 4 equal KPI cards (2×2 on mobile, 4×1 on desktop). |
| D-3 | P1 | Charts were `h-48`/`h-52` with no Y-axis. Bar labels rotated −20° and were clipped. Recharts logged "width(-1)" warnings. | **Fixed**: 168px charts, Y-axis, horizontal bar chart with readable service labels, real-data empty states. |
| D-4 | P1 | Visit cards stacked two badges vertically, and they overlapped long names at 320px. | **Fixed**: compact row with a practitioner color rail and one status pill (hidden under 640px). |
| D-5 | P1 | Visits in progress fell into neither list, or showed as upcoming. | **Fixed**: separate "In progress", "Upcoming" (no DONE or ACTIVE visits), and "Recently completed" lists. |
| D-6 | P2 | The activity log showed only the action text, with no time or actor. | **Fixed**: timestamp, actor, and action in a grid. |
| D-7 | P2 | The alert bell showed a dot with no count, and balance alerts used appointment data. | **Fixed**: count badge, alerts from the invoice ledger, credential reminders panel. |

### Calendar
| ID | Sev | Defect | Status |
| --- | --- | --- | --- |
| C-1 | P1 | Mobile showed **both** a list and a time grid for the same day, so every visit appeared twice. | **Fixed**: mobile shows the agenda only. |
| C-2 | P1 | There was no List view. Month navigation used ±30 days, which skips months. | **Fixed**: Day, Week, Month, and List (30 days). Month steps by calendar month. |
| C-3 | P1 | The time grid had no contained vertical scroll, no sticky day header, and no now line. Overlapping visits were drawn on top of each other. | **Fixed**: grid scrolls inside its own panel, sticky header, Edmonton now line, side-by-side lanes for overlapping visits. |
| C-4 | P1 | There was no drag-to-reschedule (requested by the user). | **Fixed (desktop)**: HTML5 drag with 15-minute snap → confirm → `POST /appointments/{id}/event {kind:"rescheduled"}`. The server checks the slot (`assert_public_slot` and `ensure_slot`). Only requested, confirmed, or assigned future visits can be dragged. Touch drag on mobile is Phase 3. |
| C-5 | P2 | The practitioner filter was a plain `<select>` with no color legend. | **Fixed**: color-coded filter chips. |
| C-6 | P1 | **Google Calendar sync does not exist.** | Dependency — see §4. |

### Invoicing & payments (critical)
| ID | Sev | Defect | Status |
| --- | --- | --- | --- |
| I-1 | P0 | **There was no invoice list.** `/owner/payments` listed only appointment-based queues, so drafts and standalone invoices from `POST /invoices` could not be found. They were reachable only from a client's workspace. | **Fixed**: searchable and filterable invoice list (All, Outstanding, Drafts, Issued, Partly paid, Paid, Voided). Table on desktop, cards on mobile. Each row opens the detail drawer. |
| I-2 | P0 | **There was no "Issue invoice" action for drafts** anywhere in the staff UI. | **Fixed**: `DraftActions` → `POST /invoices/{id}/issue` with an idempotency key. |
| I-3 | P0 | **Recording a cash, e-Transfer, or terminal payment on an issued invoice was missing** from the invoice drawer. Only tips and the Stripe link were offered. | **Fixed**: `ManualPayment` → `POST /invoices/{id}/payments` (existing ledger, idempotency key, server-side validation). No new payment logic. |
| I-4 | P1 | After "Create invoice", the new draft disappeared. | **Fixed**: the list remounts and opens the new draft. |
| I-5 | P1 | Editing a draft's lines is not possible. The backend has no `PATCH /invoices/{id}` for drafts; only `/adjustments` exists, and only after issue. | **Dependency** (B-3). |
| I-6 | P2 | The page held invoices, collections, transactions, reconciliation, reports, and import on one long scroll. | **Fixed**: sectioned tabs. |
| I-7 | — | Stripe live checkout, webhooks, and idempotency are unchanged. The staff payment link still uses `POST /invoices/{id}/checkout`. | Preserved |

### Settings (audit only, implementation in Phase 3)
| Setting | Shown | Editable UI | Backend |
| --- | --- | --- | --- |
| Scheduling buffers (setup, cleanup, travel, lead) | `Zones.jsx` (read-only text) | **No** | `PATCH /settings/app {scheduling}` exists (`SETTINGS_FIELDS`) → frontend gap only |
| Enhancements / add-ons and prices | `Zones.jsx` (read-only list) | **No** | `PATCH /settings/app {addons}` exists → frontend gap only |
| Payment policy and deposit | `Zones.jsx` | Yes | `paymentPolicy` |
| Cancellation policy | Availability (read) | Partial | `cancellationPolicy` exists |
| Zones and travel fees | `Zones.jsx` | Yes | `PATCH /zones/{id}` |
| Clinic and mobile availability | `Zones.jsx` | Yes (clinic address needs a confirmed geocode) | `clinic` |
| Turnaround / cleanup | `Turnaround.jsx` | Yes | `/turnaround/config` |
| Reminders (credential reminder days) | not surfaced | **No** | `credentialReminderDays` in `SETTINGS_FIELDS` → frontend gap |
| Promotions: WELCOME20 and "10 Minutes. On Us." | `Promos.jsx`, `Campaigns.jsx` | Yes (draft until approved; never auto-activated) | `promotions`, `/campaigns/*` |

### Practitioner management
- Photo upload, gallery, profile, services, credentials, and onboarding approval endpoints all exist (`/practitioners/{id}/photo|gallery|profile|services`, `/credentials`, `/practitioners/{id}/onboarding/approve`).
- Activation gating (`ACTIVATION_HARD_GAPS = {login_email}`) already lets optional credentials not block activation. Booking stays gated by current registration and liability insurance.
- **Nabitu Kahindo** (`p-nabitu-kahindo`): in preview the record is a `draft` with **no linked login account**. Production identity linkage cannot be checked from here (no production DB access, by design). The next step is to compare `nt_users.subject` with `p-nabitu-kahindo` in production through an authorized read-only check. Do not create a duplicate.

### Maps
- `ZoneMap` in `ui-kit.jsx` is a decorative SVG labelled "Zone diagram, not a street map".
- `mapbox-gl@3` is installed, and a public `pk.` token is present in the frontend env.
- Phase 3 replaces the diagram with real Mapbox GL tiles, zone radius circles (turf-style polygons from `radiusKm`), geocoded pins, and trip markers only during an authorized `/tracking/sessions` session.
- Street-level photo imagery needs a provider and licensing review first. It is not proposed yet.

### PWA
| ID | Sev | Finding |
| --- | --- | --- |
| P-1 | P1 | `sw.js` cache name is hard-coded `nabitouch-shell-v1` and is never rotated, so old brand assets can persist. Navigation is network-first, so stale HTML appears only offline. Needs a build-hash cache name and an "update available" prompt. |
| P-2 | P2 | Manifest icons use `"any maskable"` combined, which crops on Android. It also lacks `id`, `scope`, and dedicated maskable icons. |
| P-3 | P2 | iOS needs `apple-mobile-web-app-status-bar-style` and splash images. |
| P-4 | OK | API responses are never cached by the service worker (good for clinical privacy). |
| P-5 | P2 | The service worker registers in dev and preview, which can mask hot-reload changes. Register only in production builds. |

## 3. Missing backend capabilities (explicit dependencies, nothing changed)

| ID | Capability | Needed for | Proposed contract |
| --- | --- | --- | --- |
| B-1 | Google Calendar sync | Practitioner and owner calendar sync | `POST /integrations/google/connect` (OAuth 2.0, scope `calendar.events`), `DELETE …/disconnect`, a server worker that pushes appointment create, reschedule, and cancel as events **without clinical details** (title "Nabitouch visit", no SOAP or health data), and optionally a read-only ICS feed `GET /calendar/{token}.ics`. Needs the owner's Google Cloud OAuth client and a privacy review. |
| B-2 | Insurer direct billing | TELUS eClaims, Alberta Blue Cross, Sun Life | See §4. `insurers.py` already models adapters as `not_connected`. |
| B-3 | Draft invoice line editing | "Edit while permitted" | `PATCH /invoices/{id}` allowed only while `state=="draft"` (lines, notes, practitioner, service date), audited. |
| B-4 | Mapbox permanent geocoding | Address confirmation and bookings in non-test environments | Owner decision: `MAPBOX_PERMANENT_GEOCODING=true` once Mapbox account eligibility and billing are confirmed. |
| B-5 | Branded PDF reports | Period reports | `GET /reports/{id}/pdf` already exists (`pdfbrand.py`). Phase 3 checks page numbers and table layout. Any change there is backend work and will be scoped separately. |
| B-6 | Client-safe invoice share link | "View and share invoice" | Today: PDF download plus an optional email (`INVOICE_EMAIL_ENABLED`). A tokenized share URL would need a new endpoint. |

## 4. Research: direct billing and Google Calendar

**TELUS Health eClaims**
- There is no public API.
- Access is through TELUS's **vendor/PMS certification** under a provider agreement. Jane, ClinicMaster, Juvonno, and ABELMed are examples of certified vendors.
- Each practitioner needs a TELUS Provider ID, role (Massage Therapist), and licence issuer and ID.
- Nabitouch would apply to TELUS Health as a software vendor. Expect a certification timeline and a commercial agreement.

**Alberta Blue Cross**
- There is no public third-party API.
- Providers submit through the secure Health Provider portal (provider.ab.bluecross.ca), or through TELUS eClaims where the insurer participates.
- Realistic in-app scope: deep-link to the portal and record its results manually (predetermination, approved amount, claim number). The existing `/invoices/{id}/claims` workflow already supports this.

**Sun Life**
- Since 2022, Sun Life claims go only through **Sun Life Connect**. Third-party gateways such as eClaims are no longer used for Sun Life.
- There is no public API. Same portal-plus-manual-record pattern as Alberta Blue Cross.

**"Provider Connect"**
- This most likely refers to the TELUS Health provider portal, or to the insurers' provider portals. Please confirm which product you mean.

**Google Calendar**
- Feasible through the Google Calendar API with OAuth (owner-provided Google Cloud credentials). Contract as in B-1.
- Two-way sync, where blocking time in Google blocks Nabitouch availability, is a larger scope item.

## 5. Phase 2 — design system (implemented in preview)

**Brand (preserved):**
- Colors: midnight navy `#0B1B3F`, ocean blue `#1565F0`, lagoon cyan `#12C9EF`, turquoise `#14D8C4`, teal `#0E9E9A`, warm white canvas `#F5FBFC` / `#FBFAF7`.
- Typography: Poppins (UI) and Fraunces italic (accent display).

**Tokens (`src/index.css`):**
- Layout: `--nb-header-h`, `--nb-nav-h`, `--nb-safe-t/b`, `--nb-bottom-clear`, `--nb-toast-offset`.
- Radii: `--nb-r-sm/md/lg/xl`.
- Elevation: `--nb-elev-1/2/3`.
- Hairline: `--nb-line`.

**Classes:** `.nb-panel`, `.nb-kpi`, `.nb-row`, `.nb-seg`, `.nb-th/.nb-td`, `.nb-main-clear`, `.nb-dock`.

**Components (`src/components/ds.jsx`):** `PageHeader`, `Panel`, `KpiCard`, `EmptyState`, `ErrorState`, `Segmented`, `SearchField`, `SkeletonRows`.

**Shell:** one content-clearance value for both shells, a docked labelled bottom nav with a "More" sheet, safe-area-aware headers, and toasts offset above the nav.

**Screens redesigned:**
- Owner Dashboard (`pages/owner/Dashboard.jsx`).
- Calendar (`components/ops/VisualCalendar.jsx` plus `calendar/{time.js,TimeGrid,MonthGrid,AgendaList}`).
- Invoices (`components/billing/InvoiceList.jsx`, `pages/owner/Payments.jsx`, `StaffInvoiceActions.jsx`).

## 6. Phase 3 backlog (awaiting approval)
1. Client records: responsive directory, identity summary, tabbed workspace for visits, invoices, insurance, consents, messages, and care plans.
2. Settings: editors for scheduling buffers, add-ons, reminder days, and cancellation policy (endpoints exist).
3. Practitioner management: unified profile, credential and document editor, separate status indicators (account, profile, booking, credentials).
4. Real Mapbox maps (zones, pins, authorized trip markers).
5. Reports: responsive tables, mobile cards, date-range and practitioner filters, PDF check.
6. PWA: hashed cache, update prompt, maskable icons, production-only service worker registration.
7. Touch drag on the mobile calendar, and a reschedule action inside the appointment sheet.
8. Remaining pages moved onto the design-system primitives.
