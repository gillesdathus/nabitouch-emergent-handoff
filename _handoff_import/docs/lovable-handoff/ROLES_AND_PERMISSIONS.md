# Roles and permissions

Authentication roles implemented today are `client`, `practitioner`, `owner`, and `desk`. Source: `backend/auth.py`.

There is no `manager` role. Owner is the manager of the business. A training scenario can include a fictional owner named as the training manager. That account exists only in the training database and cannot approve operational credentials.

Privileged roles (`owner`, `practitioner`, `desk`) must complete TOTP before a session is usable when MFA enforcement is on. Password verification alone returns an enrollment or MFA challenge and does not open the workspace.

## Owner

Workspace home: `/owner`. Shell: `StaffShell` in `frontend/src/components/shells.jsx`.

The owner can read the full `GET /api/state` snapshot, including clients, soap notes, audit, inquiries, and mail operations. Server shaping is in `get_state` in `backend/server.py`.

Implemented owner work:

- Dashboard metrics from stored appointments
- Schedule, dispatch, availability, routes, recovery
- Services, practitioners, clients, promotions, campaigns, rewards settings, zones, invoices, reports
- Credential review and practitioner onboarding approval
- Reception permission switches
- Staff invite (`POST /api/auth/staff/invite`) and the older password-based staff create (`POST /api/auth/staff`)
- Training scenario administration

The owner cannot be given a password by another screen. Practitioner and reception accounts should be invited so the person sets their own password. The permissions page still contains a password field for the older create endpoint. A redesign should prefer the invite flow.

## Reception (`desk`)

Workspace home: `/desk`.

Reception sees appointments and clients according to `settings.receptionPerms`. The owner toggles these on `/owner/permissions`. The server enforces them. Hiding a control in the UI is not the authorization check.

Keys in `RECEPTION_PERMS` (`frontend/src/lib/domain.js`):

| Key | Meaning | Default note |
| --- | --- | --- |
| `viewLocations` | Live location during an authorized trip | On-duty trips only |
| `viewEta` | ETA | |
| `viewAddresses` | Appointment and client addresses | |
| `assign` | Assign or reassign a practitioner | |
| `createBooking` | Create or reschedule | |
| `viewInsuranceStatus` | Insurance status | |
| `viewInsuranceDocs` | Insurance documents | |
| `managePayments` | Payment status and cash recording | |
| `viewHistory` | Operational history | |
| `clinical` | Clinical access | Off by default. Completion status only, never SOAP content |

Reception does not get soap note bodies, treatment plans, or gift cards in `GET /api/state`.

## Practitioner

Workspace home: `/pro`. Subject is the practitioner id.

Implemented:

- Today list and visit timeline
- Own profile, photo, and gallery
- Own availability, with owner approval before a new schedule is bookable
- Own route and recovery
- SOAP for own appointments, including sign and amend
- Own published reports only

A practitioner cannot approve their own credentials or onboarding. `POST /api/practitioners/{id}/onboarding/approve` and credential verify stay with the owner. The training approve endpoint also rejects the practitioner role.

## Client

Workspace home: `/me` after sign-in. Public catalogue and booking are available before sign-in.

Implemented:

- Register, profile, booking, offers, rewards page, insurance page
- Own appointments, own addresses, own plans marked visible, own gift cards
- No soap notes and no audit log in the client snapshot

Guest booking exists. Guest tracking uses a token, not the client session.

## Planned or not a separate role

| Idea | Status |
| --- | --- |
| Manager as a distinct login role | Not implemented. Use owner. |
| Reception clinical charting | Not implemented. The clinical switch does not reveal SOAP text. |
| Insurance claim submission to an insurer | Not connected. Endpoints exist for recording claim state. The UI must not imply a live insurer. |
| Card checkout | Implemented only when Stripe test configuration is present. The preview health field `cardCheckout` is currently false. |
| Live GPS as a product default | Device location requires an explicit tracking session. A route estimate is not live tracking. |

## Session rules Lovable must keep

- Cookies: `access_token`, `refresh_token`, `csrf_token`. Mutations send `X-CSRF-Token`.
- Training uses a different cookie, `nt_training`, and audience `training`. Operational `user_from` rejects that audience.
- `POST /api/auth/demo-login` still exists for tests. It is not shown on the sign-in page. Do not put it back in the customer or owner UI.
