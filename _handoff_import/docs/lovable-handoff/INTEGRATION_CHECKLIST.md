# Integration checklist

Use this after a Lovable design is brought back into `frontend/`. The FastAPI application in `backend/` stays the authority. A screen that only looks finished does not pass.

## Preserve

- [ ] Branch work at or after `f93e52df865bc8ecd806de86d95e9389121a9653` is still present.
- [ ] `frontend/src/lib/api.js` still targets `/api` with cookies and CSRF.
- [ ] No Supabase project, second auth provider, or replacement database was added.
- [ ] Logo files in `frontend/public/brand/` are unchanged.
- [ ] Sign-in has email, password, forgot password, and create profile. Demo role buttons stay absent.
- [ ] Privileged sign-in still stops at authenticator enrollment or verification.
- [ ] In-clinic booking stays hidden and the API still rejects it while the clinic setting is off.
- [ ] Cash bookings remain unpaid until cash is recorded.
- [ ] Prices shown at checkout match `POST /api/bookings/quote`.
- [ ] Empty dashboards stay empty. SOAP percentage stays blank when no session has ended.
- [ ] Mapbox and Stripe failures stay visible as configuration gaps.
- [ ] Insurance is labeled not connected.
- [ ] Gift cards cannot be issued. Rewards stay off until settings say otherwise.
- [ ] Training writes never call operational booking, payment, or notification routes.

## Redesign acceptance

- [ ] 375, 390, and 430 widths have no horizontal overflow on booking, dashboard, schedule, manage, and invoices.
- [ ] 768 and 1024 show the intended two-column or sidebar layouts.
- [ ] Owner navigation is Dashboard, Schedule, Manage, and Invoices, with other tools inside Manage.
- [ ] Create actions are visible and forms stay closed until chosen, including campaigns, services, promotions, and staff invite.
- [ ] Dashboard KPI cards open the related visits or payments.
- [ ] Day, week, and month calendars position real appointments.
- [ ] Mobile schedule is a day strip and a vertical timeline.
- [ ] The same client profile opens from a visit and from client search.
- [ ] Practitioner credentials and approve actions are owner-only.
- [ ] Training workspace shows the training banner and uses training endpoints.

## Role checks

- [ ] Client snapshot has no other clients and no soap notes.
- [ ] Practitioner cannot approve their own credential.
- [ ] Reception without `viewAddresses` does not receive addresses.
- [ ] Reception without `managePayments` cannot record cash.
- [ ] Owner preview of training does not replace the operational session.

## Failure handling

- [ ] 401 returns to sign-in.
- [ ] 409 booking and schedule conflicts show the server message and do not claim success.
- [ ] 503 address search shows the Mapbox token message.

## Out of scope for the visual pass

Production deploy, production database edits, Stage C backup or restore, live Stripe activation, and insurer submission.
