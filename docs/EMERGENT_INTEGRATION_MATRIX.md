# Nabitouch — Emergent integration matrix

Status legend: **Done** = Tide composition on real API, functionally complete. **Tide/partial** = Tide styling, gaps listed. **Legacy-ish** = functional, composition needs a Tide redesign. Nothing is marked verified: testing has not been run (waiting for "START TESTING").

## 0. Source preservation

| Item | Location | State |
| --- | --- | --- |
| Handoff repo main @ d49405c | `/app` (working) and `/app/_handoff_import` (pristine clone) | Identical to GitHub apart from two doc hostname lines rewritten by the platform |
| Milestone 1 Tide preview (user zip) | `/app/_milestone1_preserved` | Preserved untouched. CRA build with mock data, 60 source files |
| M1 pieces **not** in the zip | — | Guided service editor, full client workspace, operations workspace, billing interfaces, gift-card visual designs. Needs a newer export |

Design reconciliation: the handoff `index.css` and `tailwind.config.js` are a strict superset of the M1 Tide tokens (same palette, `--nb-brand` and `--nb-lagoon` gradients, Poppins and Fraunces, glass, motion keyframes, same brand and photo assets). Handoff `tide.jsx` re-exports the M1 ui-kit primitives. Most handoff client pages are direct ports of M1 compositions onto real data.

## 1. Stage 5 verification (code read)

| Capability | Where | Status |
| --- | --- | --- |
| Appointment-linked threads | `messaging.py` GET/POST `/appointments/{id}/messages` | Implemented |
| Mongo persistence | `nt_messages`, `nt_trip_notices` | Implemented |
| Redis real-time | pub/sub `nt:msg:{id}` plus SSE `/messages/stream` | Implemented (Redis is up locally) |
| Read/unread | POST `/messages/read`, `/inbox` unread count | Implemented |
| Quick presets | `/messages/presets` (practitioner and client sets, late with minutes) | Implemented |
| Running late / trip notices | `record_trip_notice` from transitions and the delayed event | Implemented, separate from chat |
| Channel honesty | `/notifications/channels` reports sms=false, email=false | Implemented |
| Resend outbox | `notifications.py` lease, retry and idempotency, webhook status | Implemented. Provider is `mock` here |
| SMS readiness | `sms.py` hard off, consent gate | Disabled (as required) |
| GPS tracking | `tracking.py` sessions, heartbeat, guest links, SSE, Mapbox Directions ETA | Implemented |
| Mapbox geocoding | `geo.py` v6 forward and reverse | Live (token added, verified with an Edmonton address) |

## 2. Backend contract reconciliation (own gap analysis)

| # | Contract | Status | Notes |
| --- | --- | --- | --- |
| 1 | Invoice list `GET /invoices` (client: own; owner/desk with payments or insurance permission: `?clientId`) | **Implemented (M3)** | Paginated, no drafts for clients, claim notes stripped |
| 2 | Branded invoice PDF | **Implemented (M3)** | `/invoices/{id}/pdf` now uses `pdfbrand.py` (ReportLab, Poppins, logo, lagoon band) |
| 3 | Receipt PDF `GET /invoices/{id}/receipt` | **Implemented (M3)** | Confirmed payments only. 409 when nothing has been received |
| 4 | `POST /invoices/{id}/email` (invoice, receipt, payment_link) | **Implemented, disabled** | `INVOICE_EMAIL_ENABLED` off returns 503. When on, it queues to the existing outbox with idempotency and branded `email_templates.py` |
| 5 | Stripe invoice checkout + webhook | **Implemented, disabled** | `STRIPE_CARD_CHECKOUT_ENABLED` is off and the webhook secret is empty. Test key present |
| 6 | Reusable payment link | **Partial** | A Checkout Session URL is created on demand. No persistent or shareable link |
| 7 | e-Transfer report + staff verification | **Implemented** | Reporting never marks the invoice paid |
| 8 | Insurance ledger (claimed / approved / received) | **Implemented** | Manual recording. Insurer submission is disabled |
| 9 | Gift cards `giftcards.py` (`/api/giftcards/*`) plus `POST /invoices/{id}/giftcard` | **Implemented, disabled (M3)** | `GIFTCARDS_ENABLED` off returns 503 for purchase, issue, activate, redeem and void. Atomic balance decrement with an idempotency key on a unique index. Ledger `nt_gc_ledger` and audit entries. The legacy generic giftcards writes now return 410 |
| 10 | Rewards balances | **Partial** | Settings, `/rewards/me`, attribution, product preview. Programme flag-gated |
| 11 | `GET /finance/reports/{kind}` for revenue, collections, outstanding (aging), insurance, giftcards and earnings, as JSON (paginated), CSV or branded PDF | **Implemented (M4)** | Owner only. Practitioners get earnings for their own visits only. Retention and service-performance reports are still to do |
| 12 | `GET /clients/{id}/workspace` | **Implemented (M3)** | Owner and desk, permission-shaped. Includes consents summary, threads and plans (owner only). Never SOAP or clinical notes. Every open is audited |
| 13 | Branded transactional templates | **Partial (M3)** | `email_templates.py` covers invoice, receipt, payment link, invitation, recovery and change. Only the billing ones are wired. Invite and recovery still use their inline HTML |

No duplicate APIs were created. M3 (approved scope) implemented rows 1, 2, 3, 4, 9 and 12. Row 11 (financial reports and CSV) is next: `pdfbrand.report_pdf` is ready to use.

## 3. Route matrix

| Route | Role | UI/Tide | API | Function | Mobile | Gaps / remaining |
| --- | --- | --- | --- | --- | --- | --- |
| `/` Home | Public | Tide (M1 port) | `/state` | Real | Yes | — |
| `/services`, `/services/:slug` | Public | Tide (M1 port) | `/state` | Real | Yes | Benefits and prep need editor data |
| `/practitioners`, `/:slug` | Public | Tide (M1 port) | `/state`, `/practitioners/{key}` | Real | Yes | — |
| `/offers` | Public | Tide/partial | `/campaigns/public` | Real | Yes | Composition refresh |
| `/book` | Public | Tide (stepper) | `/bookings/quote`, `/bookings`, `/geo/*` | Real | Yes | Map autocomplete now live |
| `/contact` | Public | Tide/partial | `/contact` | Real | Yes | — |
| `/login`, `/join`, `/forgot-password`, `/reset-password` | Public | Tide/partial | `/auth/*` incl. MFA | Real | Yes | Composition refresh |
| `/track`, `/track/:token` | Public | Tide/partial | `/tracking/guest/*` | Real | Yes | Freshness indicator review |
| `/me` | Client | Tide | `/state`, `/billing/notices` | Real | Yes | Wallet tab overlaps with the new Billing page |
| **`/me/billing`** | Client | **New Tide** | `/invoices`, `/pdf`, `/receipt`, `/email`, `/checkout`, `/giftcard`, `/billing/etransfer`, `/etransfer-notice` | Real; card, email and gift card behind flags | Yes | Not yet tested |
| **`/me/gifts`** | Client | **New Tide** | `/giftcards/mine`, `/config`, `/purchase` | Real; purchase flag-gated | Yes | Not yet tested |
| **`/owner/giftcards`**, **`/desk/giftcards`** | Owner, Desk (payments) | **New Tide** | list, detail, liability, issue, activate, void, products | Real; mutations flag-gated | Yes | Not yet tested |
| **`/owner/clients/:id`**, **`/desk/clients/:id`** | Owner, Desk | **New Tide** | `/clients/{id}/workspace`, `/invoices?clientId`, Stage 5 thread | Real | Yes | Not yet tested |
| `/me` live trip | Client | **New Tide `LiveTripCard`** | tracking session SSE or poll, `/appointments/{id}/messages` notices | Real (no fabricated ETA) | Yes | Not yet tested |
| `/me/profile`, `/me/intake`, `/me/insurance` | Client | Tide/partial | `/clients`, `/intake`, `/consents` | Real | Yes | Insurance page composition |
| `/me/rewards` | Client | Tide/partial | `/rewards/me` | Flag-gated | Yes | — |
| `/me/messages/:id` | Client | Tide/partial | Stage 5 | Real | Yes | Thread header composition |
| `/pro/*` (10 routes) | Practitioner | Tide/partial | Tracking, SOAP, schedules, messages | Real | Yes | Earnings and reports screen missing |
| `/owner/*` (18 routes) | Owner | Mixed | Many | Real | Partly | Service editor and client workspace (need the M1 source), gift cards (row 9), reports (row 11) |
| `/desk/*` (5 routes) | Reception | Mixed | Many | Real | Partly | Client workspace, payments composition |
| `/train` | Training | Tide/partial | `/training/*` (isolated DB) | Real | Yes | — |

## 4. Security notes

- `.env` files are git-ignored and hold disposable dev secrets only. `DEMO_MODE=false`, and no real customer data.
- The Mapbox `pk.` token is used in the browser. The server uses the second token, which is also `pk.` scope; the backend accepts this.
- Stripe test key only. Card checkout, Resend, SMS and insurer submission remain off.
- Client invoice views strip claim notes and staff-only documents (`billing.py view_for`).

## Milestone 4 additions
| Route | Role | Status |
| --- | --- | --- |
| `/owner/reports` | Owner | New Tide: six report types, range presets, practitioner filter, KPIs, bar groups, paginated detail, PDF and CSV |
| `/pro/earnings` | Practitioner | New Tide: pay-period presets, hero total, statement PDF and CSV. Labelled "not payroll" |
| `/me` arrival | Client | New `ArrivalMoment`, using the service's `prep` tips |
| `/me/gifts` | Client | Card checkout through Stripe test (`POST /giftcards/{id}/checkout`). Needs both GIFTCARDS_ENABLED and card checkout. The webhook activates the card once per event |
| `/contact` | Public | Phone, WhatsApp and email cards (+1 780-235-6508, info@nabitouch.com) |
| All shells | All | The mobile header shows only the emblem |
