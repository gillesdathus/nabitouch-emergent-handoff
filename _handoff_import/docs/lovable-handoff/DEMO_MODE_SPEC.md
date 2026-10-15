# Training and demo requirements

Training must stay isolated from operational bookings, payments, availability, messages, and analytics. A `demo: true` flag on an operational document is not sufficient.

## What already exists

Implemented in `backend/training.py` and `frontend/src/pages/training/Workspace.jsx`. Administered at `/owner/training`.

| Requirement | Current behavior |
| --- | --- |
| Separate store | Database name `{operational}_training`, refused when it matches the operational database or a production name |
| Separate session | Cookie `nt_training`, JWT audience `training`. Operational auth rejects that audience |
| Four personas | Fictional practitioner, client, receptionist, and owner/manager, created with the scenario |
| Labeled data | Records carry `training: true` and `scenarioId`. Invoices say “TRAINING ONLY — NOT A VALID INVOICE”. Credentials say “TRAINING — NOT VALID” |
| Payments | Training cash updates only the training appointment. No Stripe call |
| Messages | Training inbox only. No operational email or SMS enqueue |
| Availability | Training schedules and bookings are stored in the training database |
| Expiration | Presets 24h, 3d, 7d, 14d, 30d, or 1–90 custom days. Default from the UI is 7 days |
| Cleanup | Hourly worker marks expired scenarios and revokes their sessions. Delete removes documents with that `scenarioId` from the training database only |
| Banner | “TRAINING MODE — No real bookings or payments” |
| Owner preview | An already signed-in owner can open one training role. This does not bypass operational MFA and does not impersonate an operational user |
| Analytics | Training dashboard reads the training snapshot, not operational KPIs |

Routes: `GET/POST /api/training/scenarios`, reset, extend, end, delete, preview, plus `/api/training/login`, `/logout`, `/me`, `/state`, bookings, transitions, reschedule, cash, soap, profile, availability, reports, approve, notifications, progress, and route.

## What the redesign should show

- Training Center as a Manage destination, not a fifth primary nav item.
- Scenario card with status, created time, expiration, remaining time, participants, and role openers.
- Inside `/train`, the same dashboard, calendar, and profile components used operationally, with the banner always visible.
- Guided task progress stored only on the training scenario.
- A training route labeled as an estimate. If Mapbox is not configured, show that configuration state. Do not draw a fake route or a moving practitioner.

## What is not done

| Gap | Notes |
| --- | --- |
| The word DEMO on every training row | Current label is training, plus the invoice and credential sentences above. A redesign may say DEMO in the UI. The stored flag remains `training: true`. |
| Email invitation for a trainee | Not sent. The owner is shown one-time training passwords when a scenario is created. Do not log those passwords into analytics or design mock data. |
| Full operational API inside training | Training implements a subset (book, status, cash, soap, availability, report, approve). Other operational writes must fail rather than fall through to the live database. |
| Live Mapbox inside training | The route endpoint reports whether a token exists and does not dispatch anyone. A quota field exists on the scenario. |
| Automatic purge of expired document files | Training seed does not upload files. Cleanup deletes training documents by `scenarioId`. |
| A public demo button on `/login` | Removed on purpose. Do not restore it. |

## Rules for any future demo data

- Fictional names, phones, addresses, and credentials only.
- No copy of operational clients, soap notes, invoices, or files.
- Demo appointments must not take operational slot locks.
- Demo payments must not change operational totals, tax, compensation, or insurer state.
- Demo activity must not send email, SMS, insurance traffic, or payment-provider requests.
- Expired sessions must not keep writing.

Do not build a second demo backend in Lovable. Extend `backend/training.py` only after the design is accepted and the change is reviewed in this repository.
