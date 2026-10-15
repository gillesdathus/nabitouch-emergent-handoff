# Nabitouch — integrations matrix

_Slice 0. Classes match `docs/CURSOR_AUDIT.md`. No provider was called with a production key. Mapbox Directions was not called. Stripe was not called. The Emergent email proxy was called only as a failed local send (HTTP 502)._

| Integration | Role in the product | Current class | Where it lives | What works today | Gap before production | Owner must supply |
|---|---|---|---|---|---|---|
| MongoDB (Motor) | System of record. Collections prefixed `nt_` | Implemented but Unverified as a durable store | `backend/server.py` | Local throwaway `mongo:7` accepted seed and the probes. Unique index on `nt_users.email` only | Auth, TLS, backups, restore test, appointment/idempotency indexes, no `demo/reset` in production | Connection string for a non-production database first. Do not reuse the Emergent database |
| JWT auth (PyJWT + bcrypt) | Login, refresh, staff, registration | Implemented but Unverified on HTTPS | `backend/auth.py` | Login 200 and bearer `/me` 200 on HTTP. Cookie session 401 on HTTP | F-01, F-03. MFA absent. Seeded passwords rewritten on boot | New `JWT_SECRET`. Rotated owner password. Decision on whether preview keeps demo mode |
| Demo auth | Role bar, preview sign-in | Implemented & Verified | `POST /api/auth/demo-login`, `RoleBar.jsx` | Owner session without a password when `DEMO_MODE=true` | Must be impossible when production mode is on | Written decision: preview-only, never production |
| FastAPI generic CRUD | Admin edits | Implemented & Verified as unsafe | `patch_doc`, `create_doc` | Saves documents | Replace with named commands (Slice 1) | None |
| Emergent email proxy | Booking and password email | Blocked | `backend/emailer.py` → `https://integrations.emergentagent.com` | HTML safety gate (https links, no forms). Local send returned 502 | Proxy works inside Emergent only. No queue, retry, or idempotency. `emergentintegrations` is not installable from public PyPI | Approval to use Resend (or another named provider). `RESEND_API_KEY`. Verified domain. From-address. Production `APP_URL` |
| Resend (direct) | Intended replacement | Blocked | Not in code. Handoff recommends the official SDK | Nothing | Slice 4 | Same as the row above |
| Mapbox GL JS | Street map | Implemented but Unverified | `frontend/src/components/MapboxLiveMap.jsx`, `mapbox-gl` | Build succeeds with no token and does not embed one. Map renders only when `REACT_APP_MAPBOX_PUBLIC_TOKEN` is set. Preview reports say tiles worked | Separate public token, URL-restricted. Do not ship a secret token to the browser | Public token, allowed origins, monthly budget |
| Mapbox Directions `driving-traffic` | Road ETA and geometry | Implemented but Unverified | `MapboxDirections` in `backend/tracking.py` | Cache 30 s or 250 m. Timeout 6 s. On missing token or error, returns the straight-line estimate with provider `mock`. UI copy distinguishes "live traffic" from "estimated ETA" | No startup check, no retry budget, token can appear in exception text, no Geocoding, no Matrix. Frontend `mapboxRouteProvider` is still a stub | Secret token with Directions scope only. Confirm pricing before raising refresh rates |
| Mapbox Geocoding | Address search | Incomplete | Not called. `SAMPLE_ADDRESSES` in `domain.js` | 11 sample Edmonton-area strings | Slice 2. Manual correction and zone eligibility | Same Mapbox account. Geocoding scope and a usage cap |
| Browser Geolocation | One-practitioner trial | Implemented but Unverified | `providers.js` `browserLocationProvider`, `useTrackingPublisher.js` | Foreground watch while the visit screen is open. Denied, timeout, and unavailable strings exist. Live-GPS pytest module was not in the failure list | Screen-off is not possible in the PWA. In-memory store. One practitioner id | Written consent for any practitioner whose phone is used. Keep the trial flag until the multi-practitioner path is verified |
| Simulated GPS | Everyone not on the trial | Simulated | `domain.js` `tripState` | Bezier path over about 150 s. Labeled simulated in the client and practitioner UI | Must stay visibly simulated. Server rejects `source=simulated` for the trial practitioner | None |
| Redis (or equivalent) | Shared latest-fix and ETA cache | Incomplete | Not in the repo. Comments name Redis | Process memory only | Slice 3. TTL measured in minutes, not a GPS history | Hosted Redis for staging, or a written decision to use another store |
| WebSocket / Socket.IO | Live tracking fan-out | Incomplete | Poll `GET /api/tracking/events` and `/api/state` every 2.5–5 s | Poll path exists and is authorized per request | Slice 3. Authenticated rooms per appointment | None beyond the app host |
| Capacitor background location | Screen-off practitioner GPS | Incomplete | Comparison table only, in `docs/TRACKING_PHASE1.md` | No Capacitor project | Slice 3 stops at a written recommendation unless the owner approves a plugin and store accounts | Apple Developer account, Google Play account, plugin licence if a commercial SDK is chosen. Do not implement behind a flag until that approval |
| Stripe | Card payments, refunds, webhooks | Simulated | `backend/payments.py`, `PaymentPanel.jsx` | Intent id prefix `pi_demo_`. Client can post a fake success (verified). Cash and refund routes exist. UI says Simulated | Slice 5. Server-created PaymentIntents, Stripe.js, signed webhooks, idempotent events. Keep insurance approval distinct from cash received | Stripe account, restricted keys, webhook secret, business rules for partial pay, cash, and refunds. Explicit activation approval. Production charges stay off until then |
| Insurer adjudication / direct billing | Claims and card OCR | Simulated | `payments.py` claim actions, `InsuranceWizard.jsx` | Status machine and `settle()` math. OCR returns sample text and labels it demo. No card image is uploaded | Do not present this as eligibility. Real submission stays disabled until a named insurer network is contracted | Counsel plus a future clearinghouse. Not a Slice 0 credential |
| SMS / web push | Late and en-route alerts | Simulated | `LogNotificationService` | In-memory log. Arrival message only | Slice 4 for email first. SMS and push stay backlog unless approved | CASL/consent copy. Provider only after email is approved |
| Emergent preview hosting | Historical test target | Blocked for this audit | Test defaults in `backend/tests/*.py` | Iterations 1–7 report passes against `nabitouch-preview.preview.emergentagent.com` | Those tests call demo reset. Do not use that host from CI or from this branch | None. Treat it as disposable preview data |
| Emergent visual overlay | In-editor preview chrome | Simulated / dev-only | `frontend/craco.config.js`, `package.json` devDependencies | Fails open if the package is missing. Production build did not need it | Remove from production images when Slice 4/7 retires Emergent. Do not remove before the dev workflow is replaced | None |
| Sentry / metrics / log drain | Operations | Incomplete | Not configured | `logging.basicConfig` only | Slice 7. Scrub emails, addresses, tokens, and clinical text | Account and DSN only after the scrubbing rules exist |
| Docker Compose | Local Mongo and, later, Redis | Incomplete | Docker was used ad hoc for this audit and then removed. Nothing is committed | Host has Docker. The repo has no compose file | Slice 7. Do not publish unauthenticated MongoDB | None |

## Token and environment split

| Name | Who sees it | Rule |
|---|---|---|
| `REACT_APP_MAPBOX_PUBLIC_TOKEN` | Browser bundle | Public token. URL-restrict to the real origins. Directions scope does not belong here |
| `MAPBOX_TOKEN` | API process only | Secret token. Directions only. Never `REACT_APP_` |
| `EMERGENT_EMAIL_KEY` | API process | Preview only. Remove when Resend (or the approved provider) is live |
| `RESEND_API_KEY` | API process | Not implemented. Do not invent a value |
| `JWT_SECRET` | API process | New value. No default in source |
| `OWNER_PASSWORD`, `DEMO_PASSWORD` | API process and, today, git history | Rotate. Delete fallbacks from tests. Demo password must not exist in production |
| `MONGO_URL`, `DB_NAME` | API process | TLS and authentication. Separate database per environment |
| `APP_URL` | Email links | Owner-supplied production origin. Links must be `https` or `emailer.py` will refuse them |
| `CORS_ORIGINS` | API process | Explicit list. The code default `*` is F-02 |
| `DEMO_MODE` | API process | `true` only on an isolated preview |
| Stripe keys | API and Stripe.js publishable key | Absent until Slice 5 approval. Publishable key is not `REACT_APP` by accident in server logs |

Startup does not validate this set. A missing `MONGO_URL`, `DB_NAME`, or `JWT_SECRET` fails later with a `KeyError`. Slice 1 should fail fast with the names of missing variables and without printing values.
