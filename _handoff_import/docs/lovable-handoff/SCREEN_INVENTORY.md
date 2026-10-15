# Screen inventory

Routes are declared in `frontend/src/App.js`. Shells are in `frontend/src/components/shells.jsx`. Unless a row names a write endpoint, the screen reads `GET /api/state` through `useDemo()`.

Unknown routes redirect to `/`.

## Public and client

| Route | Screen | Role | What it does | Writes | Limits |
| --- | --- | --- | --- | --- | --- |
| `/` | Home | Public | Marketing and entry to booking | None | In-clinic tile stays off unless `clinicBookable` |
| `/services` | Service catalogue | Public | Published services | None | Unpublished services are hidden from non-owners |
| `/services/:slug` | Service detail | Public | One treatment and a book link | None | Missing or unpublished slug shows not found |
| `/practitioners` | Practitioner list | Public | Bookable public profiles | None | Draft practitioners stay hidden |
| `/practitioners/:slug` | Public profile | Public | Biography and services | None | This is not the owner profile sheet |
| `/book` | Booking | Public or client | Location, service, time, practitioner, review, payment choice | `POST /api/bookings/quote`, `POST /api/bookings`, `GET /api/geo/suggest` | Clinic step hidden. Pressure choice removed. Cash is not prepaid. Card step depends on Stripe |
| `/contact` | Contact | Public | Message form | `POST /api/contact` | |
| `/offers` | Flash offers | Signed-in client | Live public campaigns | Booking draft only | Empty when none are live |
| `/track`, `/track/:token` | Guest tracking | Token | Visit status for a guest link | `POST /api/tracking/guest/open` | Not staff dispatch |
| `/welcome` | Welcome | Client | Post-registration | None | |
| `/login` | Sign in | Public | Email, password, forgot password, create profile | `POST /api/auth/login`, MFA endpoints | No demo account buttons. Privileged users stop at MFA |
| `/forgot-password` | Forgot password | Public | Request reset | `POST /api/auth/forgot-password` | Preview with mock email can return a local reset token |
| `/reset-password` | Reset | Public | Set a new password | `POST /api/auth/reset-password` | Does not skip MFA |
| `/join` | Staff join | Invite token | Set password from an invite | `POST /api/auth/invite/accept` | Does not open a session |
| `/me` | My Nabitouch | Client | Upcoming visits, profile links | Visit actions that exist on the page | Rewards copy says the programme is off |
| `/me/profile` | Profile form | Client | Edit own profile | `PATCH /api/clients/{id}` | |
| `/me/rewards` | Rewards | Client | Points and referral code | `GET /api/rewards/me` | Earning is not active |
| `/me/insurance` | Insurance | Client | Coverage preference | Profile fields | Insurer billing is not connected |

Public nav: Home, Services, Book, My Nabitouch. Practitioners and Contact are secondary on small screens. Source: `frontend/src/lib/navigation.js`.

## Practitioner

Shell items: Today, Profile, Route, Recovery, Hours, Plans.

| Route | Screen | Function | Main endpoints | Actions |
| --- | --- | --- | --- | --- |
| `/pro` | Today | Assigned visits | State snapshot, tracking when a trip is started | Open visit, status changes |
| `/pro/visit/:id` | Visit | Timeline and status | `POST /api/appointments/{id}/transition`, tracking session routes | Status updates. Late notice is recorded, not auto-sent |
| `/pro/soap/:id` | SOAP | Clinical note | `PUT /api/soap/{id}`, `POST /api/soap/{id}/sign`, amendments | Own appointments only |
| `/pro/profile` | Profile | Biography, photo, gallery | `PUT /api/practitioners/{id}/profile`, media routes | Cannot self-approve credentials |
| `/pro/availability` | Hours | Time grid plus editor | `GET/PUT /api/schedules/{id}/...` | Pause. Conflicts return 409 and do not move visits |
| `/pro/route` | Route | Day route | `GET /api/schedules/{id}/route` | Road time needs Mapbox. Straight-line text must stay labeled as such |
| `/pro/plans` | Plans | Care plans | State `plans` | Own plans |
| `/pro/recovery` | Recovery | Gap recovery | `/api/recovery` | |

## Owner

Primary nav: Overview `/owner`, Schedule `/owner/schedule`, Manage `/owner/manage`, Invoices `/owner/payments`.

| Route | Screen | Function | Main endpoints | Actions |
| --- | --- | --- | --- | --- |
| `/owner` | Dashboard | KPIs, upcoming visits, charts, alerts, quick actions | State snapshot, including `mailOps` and `audit` | Open visit, open client. Charts are real totals. Segment click-through is incomplete |
| `/owner/schedule` | Calendar | Day, week, month grid | State appointments, `POST /api/schedules/{id}/exceptions` to block time | Open visit, block one hour for a selected practitioner |
| `/owner/dispatch` | Dispatch | Assignment and travel | State, appointment events | Not a live GPS product |
| `/owner/availability` | Hours | Same editor as practitioner, owner mode | Schedule routes plus approve | Approve schedule |
| `/owner/routes` | Routes | Multi-practitioner routes | Schedule route endpoint | |
| `/owner/recovery` | Recovery | Same recovery tools | `/api/recovery` | |
| `/owner/manage` | People and services | Tabs for practitioners, services, clients | Service CRUD and photo, `POST /api/auth/staff/invite`, profile sheets | Create service, invite practitioner, open profiles. Synthetic preview people are labeled and not deleted here |
| `/owner/promos` | Promotions | Draft create and existing cards | `POST /api/promotions`, `PATCH /api/promotions/{id}` | Create stays closed until requested. Gift cards are listed and cannot be issued |
| `/owner/campaigns` | Flash campaigns | List, filters, guided create | `GET/POST /api/campaigns`, `PUT`, duplicate, status | Create opens a sheet. Performance is separate from the form |
| `/owner/rewards` | Rewards settings | Thresholds | `GET/PUT /api/rewards/settings` | Form is visible on load. Programme stays unauthorized |
| `/owner/zones` | Zones and settings | Fees, GST, payment policy, cancellation copy | `PATCH /api/zones/{id}`, `PATCH /api/settings/app` | |
| `/owner/insights` | Insights | Audit and clinical summary | State audit | |
| `/owner/permissions` | Reception access | Permission switches and staff list | `PATCH /api/settings/app`, `POST /api/auth/staff` | Staff password form is still visible. Prefer invite from Manage |
| `/owner/payments` | Invoices and reports | Ledger and half-month reports | Invoice and `/api/reports` routes | PDF after publish |
| `/owner/credentials` | Credentials | Review and add | `/api/credentials`, onboarding | Add form is behind a button. Practitioners cannot verify themselves |
| `/owner/legacy` | Legacy import | Historical client import | `/api/legacy/*` | Off unless the legacy flag is enabled. Do not treat this as day-to-day client create |
| `/owner/training` | Training Center | Isolated scenarios | `/api/training/scenarios` | Create, reset, extend, end, delete, open a role |

Profile sheets are not separate routes. They are `ClientProfile` and `PractitionerProfile` in `frontend/src/components/ops/Profiles.jsx`.

## Reception

| Route | Screen | Function | Actions |
| --- | --- | --- | --- |
| `/desk` | Schedule | Day strip and practitioner columns, check-in | New booking if `createBooking`. Check-in via appointment patch |
| `/desk/dispatch` | Dispatch | Same dispatch component, desk role | Limited by reception permissions |
| `/desk/clients` | Clients | Search | View within permission |
| `/desk/verify` | Payments | Record and review | `managePayments` |
| `/desk/messages` | Messages | Operational messages | Send control was removed where delivery is not real |

## Training workspace

| Route | Screen | Role | Notes |
| --- | --- | --- | --- |
| `/train` | Training sign-in or workspace | Training cookie only | Banner required. Uses training endpoints, not operational writes |

## Shared components

| Component | Used by |
| --- | --- |
| `AppointmentSheet` | Dashboard, schedule, desk, dispatch |
| `NewBookingDialog` | Desk and owner quick action |
| `VisualCalendar` | Owner schedule, availability, training |
| `PaymentPanel` | Appointment sheet |

## Not implemented as screens

- A distinct manager login
- Insurer claim submission UI that talks to an insurer
- Issuing new gift cards
- Customer-facing cancellation-fee collection
- Pagination screens. Lists come from the state snapshot or a short endpoint list
