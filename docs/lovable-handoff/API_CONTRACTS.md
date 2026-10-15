# API contracts for the frontend

Base path: `/api`. The browser client is `frontend/src/lib/api.js`. Cookies are sent with `withCredentials`. Mutations include `X-CSRF-Token` when an operational session cookie exists.

Errors use FastAPI `detail`: a string, a list of validation messages, or an object with `message` and sometimes `conflicts` or `gaps`. The UI helper is `apiError` in `api.js`.

There is no general cursor pagination. `GET /api/state` returns the role-shaped snapshot (lists capped in the handler, audit limited to 80). Other lists use a fixed `to_list` cap. Do not assume `page` and `limit` query params unless a specific legacy route documents them.

Do not send this document with credentials, tokens, or exported records.

## Session

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | Public | Body `{email, password}`. Success may be `{enrollmentRequired}` or `{mfaRequired}` with a challenge and no session |
| POST | `/auth/mfa/enroll` | Challenge or privileged session | Returns otpauth URI. Do not store the secret in local storage |
| POST | `/auth/mfa/confirm` | Same | Body includes the 6-digit code |
| POST | `/auth/mfa/verify` | Challenge | Opens the session after a valid code |
| POST | `/auth/register` | Public | Client registration |
| POST | `/auth/forgot-password` | Public | |
| POST | `/auth/reset-password` | Public | `{token, password}` |
| POST | `/auth/refresh` | Cookie | |
| POST | `/auth/logout` | Cookie | |
| GET | `/auth/me` | Cookie | `{id, email, name, role, subject}` |
| GET | `/auth/config` | Public | Includes whether demo mode is on. Not a license to show demo buttons |
| POST | `/auth/staff/invite` | Owner | Creates an invited practitioner. Password is not chosen by the owner. Preview may return `previewInviteToken` once |
| POST | `/auth/invite/accept` | Public, CSRF exempt | Sets password. Does not open a session |
| POST | `/auth/staff` | Owner | Older create that requires a password. Prefer invite |
| GET | `/auth/staff` | Owner | Staff list |
| POST | `/auth/demo-login` | Tests | Not for the redesigned UI |

Training session, separate cookie:

| Method | Path | Who |
| --- | --- | --- |
| GET, POST | `/training/scenarios` | Operational owner |
| POST | `/training/scenarios/{id}/reset`, `/extend`, `/end` | Owner |
| DELETE | `/training/scenarios/{id}` | Owner |
| POST | `/training/scenarios/{id}/preview` | Owner, body `{role}` |
| POST | `/training/login` | Training identity |
| POST | `/training/logout` | Training cookie |
| GET | `/training/me`, `/training/state` | Training cookie |

Expired training returns 401 with “This training scenario has ended.”

## Snapshot

`GET /state` is the main read.

- Public: catalogue and anonymized busy slots. No clients.
- Client: own profile, own appointments, no soap.
- Practitioner: own appointments, related clients without insurance details, own soap and plans.
- Desk: appointments and clients filtered by `receptionPerms`.
- Owner: full collections in the snapshot, plus `inquiries` and `mailOps`.

Appointment times in this snapshot are `date` as `YYYY-MM-DD` and `time` as `HH:MM` in Edmonton local time. Instants such as `expiresAt`, audit `at`, and MFA timestamps are ISO-8601 UTC.

## Booking and schedule

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/bookings/quote` | Server price. Travel and GST are separate from the treatment |
| POST | `/bookings` | Creates the visit. `locationType: "clinic"` returns 400 “In-clinic booking is not available” while the clinic is not bookable. Slot conflicts return 409 |
| POST | `/appointments/{id}/transition` | Body `{to, actor, note}`. Unknown transitions are rejected |
| POST | `/appointments/{id}/event` | Reschedule, reassignment, and timeline events |
| POST | `/appointments/{id}/address` | Update a visit address |
| GET | `/schedules/{practitionerId}?start&end` | `{schedule, days[]}`. Each day has `segments` of `{start, end, state}` where state is available, blocked, booked, or omitted when closed |
| PUT | `/schedules/{id}/weekly` | Recurring hours. Edmonton wall times |
| POST | `/schedules/{id}/exceptions` | Break, close, or open. 409 body includes `conflicts`. Retry with `resolution: "keep_appointments"` leaves existing visits in place |
| POST | `/schedules/{id}/pause` | `{acceptingBookings}` |
| POST | `/schedules/{id}/approve` | Owner. 400 includes `gaps` when onboarding is incomplete |
| GET | `/schedules/{id}/route` | Route for a day. Not live GPS |
| GET | `/schedule-overview?date=` | Owner only. One summary row per practitioner. Addresses are omitted |
| POST | `/availability/recommendations` | Slot ranking |
| POST | `/openings/watch` | Signed-in client. Body must include `optIn: true` |
| POST | `/openings/{id}/accept` | Signed-in client claims an offer already addressed to them |
| GET | `/geo/suggest?q=` | 503 with a Mapbox configuration message when the token is absent |
| POST | `/geo/check`, `/geo/confirm` | Zone check and pin confirm |

Blocking an operational slot from a training screen is forbidden. Training bookings use `POST /training/bookings`.

## Catalogue and people

| Method | Path | Notes |
| --- | --- | --- |
| GET, POST | `/services` | Create starts unpublished, image empty. Benefits, goals, and prep must be non-empty lists. `clinic: true` is rejected while clinic booking is off |
| POST | `/services/{id}/draft`, `/preview`, `/publish`, `/archive`, `/restore` | Publication states |
| DELETE | `/services/{id}` | |
| POST, DELETE | `/services/{id}/photo` | Multipart field `upload` |
| PUT | `/practitioners/{id}/profile` | Biography and profile fields |
| PUT | `/practitioners/{id}/services` | `{specialties}` |
| POST | `/practitioners/{id}/onboarding/approve` | Owner only |
| POST, DELETE | `/practitioners/{id}/photo` and `/gallery` | |
| GET | `/credentials`, `/credentials/reminders`, `/onboarding` | |
| POST | `/credentials` | |
| POST | `/credentials/{id}/verify` | Owner. A practitioner must not verify their own row |
| POST | `/promotions` | Owner. Draft with `enabled: false`. Eligibility `first_online` is rejected with 409. The seeded welcome offer is not created through this route |
| PATCH | `/{collection}/{id}` | Generic update for settings, zones, promotions, clients, appointments. Collection must be one of the allowed names in `backend/server.py` |
| POST | `/{collection}` | Generic create. Refuses some collections that have dedicated routes |

Money on appointments is decimal dollars in `pricing.total`, `pricing.travel`, `pricing.tax`, and `settle.clientPaid` / `settle.balance`. Some billing fields are integer cents (`amountCents`, `depositCents`). Format dollars with two places. Do not add dollars to cents.

## Campaigns

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/campaigns` | Owner. `{campaigns, promotionalSending}` |
| POST | `/campaigns` | Creates `status: "draft"`. `discountPercent` is 1–80. Requires `expiresAt`, `bookingStart`, `windowStart`. `sendNow: true` is rejected |
| PUT | `/campaigns/{id}` | Draft or paused only. Live campaigns must be paused first |
| POST | `/campaigns/{id}/duplicate` | New draft |
| POST | `/campaigns/{id}/status` | `live`, `paused`, `cancelled`, `draft`, `archived` |
| GET | `/campaigns/public` | Signed-in user. Live public campaigns that have not expired |
| GET | `/marketing/analytics` | Owner counts from stored campaigns and recovery cases |

`bookingStart` is a date. `windowStart` and `windowEnd` are Edmonton `HH:MM`. `expiresAt` and `publishAt` are UTC instants. The campaign screen converts Edmonton local input to UTC before POST.

## Money, clinical, tracking

Invoice and Stripe routes live in `backend/billing.py`. Card checkout returns a configuration failure when Stripe is disabled. Do not mark a visit paid on button press.

Cash: `POST /payments/{id}/cash` with `{actor, amount}`.

Reports: `POST /reports` accepts `{start, end, practitionerId}` or `{year, month, half, practitionerId}`. Half 1 is the 1st–15th. Half 2 is the 16th through the real last day of the month. Approve, then publish. `GET /reports/{id}/pdf` is the owner or the matching practitioner after publish.

SOAP: `PUT /soap/{appointmentId}`, `POST /soap/{appointmentId}/sign`, `POST /soap/{appointmentId}/amendments`.

Tracking prefix `/api/tracking`: start, stop, pause, resume, heartbeat, locations, session, stream, active. A location post is a real device update for that session only. Guest open uses a token.

Insurance claim routes exist under `/invoices/{id}/claims` and `/claims/{id}`. The product UI does not submit them to an insurer. Leave them unavailable in the redesign.

## Health

`GET /health` returns status plus flags such as `documentUploads` and `cardCheckout`. Those flags are the source of truth for disabled integrations.
