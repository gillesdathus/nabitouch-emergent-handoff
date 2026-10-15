# Nabitouch — Mobile, live ETA, safety and wellness plans: contracts and phased plan

Status: **Implemented** (this session) · **Existing** (already in source) · **Proposed** (needs your approval before server work)

## 1. Done in this session
| Contract | Status |
| --- | --- |
| Welcome offer: first app booking, signed in, profile complete (name, email, phone, service address, insurance on file **or** `noInsurance: true`). Enforced in `pricing.py` (`_profileComplete`) | Implemented |
| `practitioners.preferredNavApp` (google / apple / waze), saved from the visit screen. Opens the external app link only; nothing in-app claims that navigation has started | Implemented |
| `GET /api/appointments/{id}/preparation`: rule-based guidance (mandatory space rules, location, time of day, service prep, access notes). No AI text. Practitioners get only the access and location sections | Implemented (`readiness.py`) |
| `PUT /api/appointments/{id}/readiness` `{items:{space,paths,pets,entry,safe,service}}`: stored on the appointment with timestamps. Editable until the session starts. Practitioner sees a badge | Implemented |

## 2. Native practitioner app (Priority 1): Capacitor evaluation
- **Fit:** Capacitor 6 wraps the existing Vite build unchanged (`webDir: build`). There is one codebase and one FastAPI backend.
- **Auth:** the WebView runs at `capacitor://localhost` (iOS) or `https://localhost` (Android), which makes the API cross-site, so SameSite=Lax cookies will not be sent.
  - **Proposed contract:** a native session mode. `POST /api/auth/native/login` returns a short-lived access token plus a rotating refresh token, kept in Keychain/Keystore (`@capacitor/preferences` + `capacitor-secure-storage`). The `Authorization: Bearer` header is honoured only for requests with an `X-Nabitouch-Client: native` app header.
  - MFA is unchanged. CSRF is not needed for bearer requests.
- **Plugins:**

| Need | Plugin | Notes |
| --- | --- | --- |
| Background GPS | `@transistorsoft/capacitor-background-geolocation` (paid licence for Android release builds, about USD 399+) or `@capacitor-community/background-geolocation` (MIT, simpler, less battery tuning) | iOS needs the "Always" permission and the `location` background mode. Android 10+ needs `ACCESS_BACKGROUND_LOCATION` plus a foreground-service notification. Uninterrupted tracking is **not guaranteed** until tested on real devices |
| Push | `@capacitor/push-notifications` + FCM / APNs | Needs Apple Developer (USD 99/yr) and Firebase projects |
| Lifecycle | `@capacitor/app` | Resume pings `/tracking/sessions/{id}/resume` |
| External navigation | `@capacitor/app-launcher` `canOpenUrl` (comgooglemaps://, waze://, maps://), falling back to an installed app or the web link | |
| Deep links | Universal Links / App Links for `/pro/visit/:id`, `/me/billing` | Needs `apple-app-site-association` and `assetlinks.json` hosting |
| Documents | `@capacitor/filesystem` + share sheet for PDFs | |

- **Testing:** physical iPhone and Android devices are required. Simulators do not reproduce background location.

## 3. Live GPS and ETA
- **Existing:** `tracking.py` handles sessions, heartbeats, Redis freshness, Mapbox Directions ETA (server-authoritative), and stale / paused / denied states.
- **Proposed:**
  - Recompute ETA on the server when a heartbeat arrives and ≥ 5 min have passed since the last route call, **or** on start, resume, a reported delay, arrival, a deviation over 500 m from the route polyline, or an ETA change of 5 min or more. Throttle with a Redis key `nt:eta:{aid}`. Never fall back to straight-line distance as an ETA.
  - Notify the client only on a material change (≥ 5 min) or a trip event (`nt_trip_notices` dedupe key `eta:{aid}:{bucket}`).
  - Retention: delete raw fixes 30 days after the visit and keep only the session summary.

## 4. Reminders and notifications (proposed)
- `settings.reminders` holds offsets that are on by default and configurable: booked, −24 h, −2 h, trip started, ETA material change, arrived.
- `nt_reminders` with a worker uses the existing outbox. The in-app record is always kept. Push, email and SMS go out only when the channel flag is on and the client has consented.
- `POST /api/devices {platform, token}` and `DELETE /api/devices/{id}` register push tokens. `GET/PUT /api/me/notification-preferences` stores preferences.

## 5. Practitioner safety (proposed)
- `POST /api/appointments/{id}/safety/{checkin|checkout}`: arrival check-in and safe check-out, timestamped.
- `POST /api/appointments/{id}/incidents {kind: obstructed|unsafe|unhygienic|unsuitable|other, note, action: request_fix|cannot_proceed}`.
  - `cannot_proceed` moves the visit to `safety_hold` with no automatic penalty. Fees follow the approved policy, decided by the owner.
- `POST /api/appointments/{id}/assist`: an in-app alert to designated managers. It is labelled clearly as **not** emergency dispatch.
- The emergency control is a native `tel:911` call plus calls to designated contacts. No location or health data is sent automatically.
- `nt_safety_events` is visible to the practitioner involved and to owner/managers, and is audited.

## 6. Messaging presets (proposed small change)
- Add the practitioner presets you listed (late 5/10/15/20/30 min, building access, treatment area, need assistance) and the client presets.
- Late presets keep using `record_trip_notice` with the existing dedupe, so a repeated late notice never creates a duplicate chat row.

## 7. Billing extras
| Item | Status |
| --- | --- |
| Insurer decision recording with instant client balance | Existing claim endpoints. Client page refreshes every 15 s. **Proposed:** a reception "Insurance decisions" screen |
| Payment-link email | Implemented as `POST /invoices/{id}/email {kind:"payment_link"}`, gated by `INVOICE_EMAIL_ENABLED` (off) |
| Return-client invite discount | **Proposed:** promotion `eligibility: "winback_invite"`, a one-time code per invite, valid 30 days, client inactive ≥ 60 days |
| Recurring series discount | **Proposed:** `eligibility: "recurring_series"`, for a weekly or bi-weekly series booked over ≥ 3 months (≥ 12 weekly or ≥ 6 bi-weekly visits). Monthly visits don't qualify. The discount is re-checked if the series breaks |

## 8. Wellness plans (proposed contracts)
- **Collections:**
  - `nt_plan_products` (package or membership)
  - `nt_plan_purchases`
  - `nt_credits`: one row per credit, states `available → reserved → consumed | released | refunded`
  - `nt_credit_ledger`
  - `nt_memberships`
- **Endpoints:**
  - `GET /api/plans` (public, published only); owner CRUD under `/api/plans/products` (publish / pause / archive)
  - `POST /api/plans/{pid}/checkout`: Stripe test Checkout. The webhook issues N credits once per session
  - `POST /api/plans/memberships/{pid}/subscribe`: Stripe Subscription. `customer.subscription.*` and `invoice.paid` webhooks drive state
  - `GET /api/plans/mine`: wallet with available, reserved and consumed counts, plus history
  - Booking: `POST /bookings/quote` gains `useCredit: true`. The server finds an eligible credit (service, duration, practitioner, location) and reserves it atomically (`find_one_and_update` state=available with an idempotency key). Consumed on completion; released on cancellation within policy
  - `POST /api/plans/purchases/{id}/refund` (owner): refunds unused credits pro rata, with an audit trail
- **Accounting:**
  - A purchase is **deferred revenue**, recognised only when a credit is consumed. The outstanding prepaid obligation is a report row.
  - Practitioner pay on a credit visit uses the effective treatment price (for example $100).
  - Membership and package discounts never stack.
- **Separate instruments:** credits, gift cards, rewards and insurance stay separate (different collections and ledgers).

## Phased plan
1. **A (done):** welcome gate, nav preference, preparation and readiness.
2. **B:** safety endpoints and Safety Center UI, presets, the ETA cadence rule, reminders worker (in-app only).
3. **C:** Capacitor practitioner shell: native auth contract, background GPS, push tokens, external navigation, debug builds for internal devices.
4. **D:** wellness-plan backend (packages first, then memberships on Stripe test subscriptions) plus booking credit redemption.
5. **E:** Wellness Plans UI (client wallet, owner workspace, reports: deferred revenue, membership MRR/retention).
6. **F:** client native app on the same shell. Winback and recurring-series discounts. Insurer decision screen.
