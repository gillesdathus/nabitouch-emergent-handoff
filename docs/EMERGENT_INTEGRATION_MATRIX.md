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
| 1 | Client invoice list (`GET /invoices?mine`) | **Missing** | The UI works around it by looking up each appointment (N requests) |
| 2 | Branded invoice PDF | **Partial** | `/invoices/{id}/pdf` exists. Plain Helvetica text, no logo or branding |
| 3 | Receipt PDF | **Missing** | Payments carry `RCPT-` codes only |
| 4 | Email invoice / receipt / payment link | **Missing** | The outbox has only `booking_confirmation` plus lifecycle mail |
| 5 | Stripe invoice checkout + webhook | **Implemented, disabled** | `STRIPE_CARD_CHECKOUT_ENABLED` is off and the webhook secret is empty. Test key present |
| 6 | Reusable payment link | **Partial** | A Checkout Session URL is created on demand. No persistent or shareable link |
| 7 | e-Transfer report + staff verification | **Implemented** | Reporting never marks the invoice paid |
| 8 | Insurance ledger (claimed / approved / received) | **Implemented** | Manual recording. Insurer submission is disabled |
| 9 | Gift cards: products, purchase, issue, deliver, redeem, void, transactions | **Missing** | Only generic `POST /api/giftcards` with an amount check. No redemption locking, no ledger |
| 10 | Rewards balances | **Partial** | Settings, `/rewards/me`, attribution, product preview. Programme flag-gated |
| 11 | Financial reports (revenue, collections, A/R, insurance A/R, gift-card liability, refunds, retention, service performance), PDF and CSV | **Partial** | Only the practitioner period snapshot plus text PDF, and marketing analytics. No CSV |
| 12 | Per-client communication history for staff | **Partial** | Per-appointment threads and `/inbox` exist. No client-scoped aggregate |
| 13 | Branded transactional templates (change, invoice, receipt, invite, recovery) | **Partial** | Booking and lifecycle only. Invite and recovery mail are inline |

No duplicate APIs were created. Backend changes for rows 1, 3, 4, 9, 11 and 12 await your approval of the backend-change scope.

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
| **`/me/billing`** | Client | **New Tide** | `/invoices/by-appointment`, `/invoices/{id}/pdf`, `/invoices/{id}/checkout`, `/billing/etransfer`, `/invoices/{id}/etransfer-notice` | Real | Yes | Rows 1, 3 and 4 missing. Receipt and email buttons shown as off |
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
