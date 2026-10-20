# Nabitouch production deployment report — 17 October 2026

**Recommendation: NO-GO** for production cutover, live payments, and merging Draft PR #1.

**Release SHA (candidate, not deployed):** `3c5b5a2629f94631bdf175fd8a39463b091a2950`  
**Branch:** `feature/codex-production-readiness`  
**Working tree:** `C:\Users\DG Solutions\nabitouch-emergent-handoff`  
**Live site:** still the existing Emergent/`nabitouch-rmt` stack on `nabitouch.com` (not this SHA).

No production configuration was changed. No live keys were enabled. Draft PR #1 stays unmerged.

### Follow-up (17 Oct evening) — refund regression + readiness re-check

| Item | Result |
| --- | --- |
| Stripe sandbox refund KeyError `settled` | Fixed in test fixtures (`3c5b5a2`); app idempotency safeguard unchanged |
| `test_stripe_sandbox.py` | 24 passed |
| `test_checkout_reconciliation.py` | 5 passed |
| `test_payment_policy.py` + `test_recovery.py` | 41 passed |
| Frontend Vitest / production build | 88 passed / build OK |
| Isolated mongodump→restore drill (acceptance DB) | **PASS** (`DRILL_OK`, 81 cols, invoice `NT-INV-00007` match; probe DB dropped) |
| Live `GET /api/health` | 200 older shape `db:up` (not this SHA) |
| Live `POST /api/stripe/webhook` | **404** (cutover still required) |

---

## Verdict

| Gate | Result |
| --- | --- |
| Local Stripe test-mode deposit settlement (prior; not re-run) | PASS |
| Synthetic practitioner onboarding + hours (acceptance DB) | PASS |
| Clinic booking assign + practitioner visibility/nav | PASS |
| Mobile booking with verified address + travel fee | PASS |
| Backend regression (focused pytest) | PASS (67) |
| Frontend Vitest | PASS (81 / 22 files) |
| Frontend production build | PASS |
| Security preflight (secrets not tracked; acceptance test mode) | PASS |
| Backup/rollback runbook present | PASS (not executed against prod) |
| Browser smoke vs acceptance API | PASS (login + public shell) |
| Production HTTPS Stripe webhook ready | **FAIL / incomplete** |
| Staging HTTPS webhook delivery (isolated) | **BLOCKED** |
| Owner authorization to deploy / enable live cards | **Not given** |

---

## Completed acceptance work (priorities 1–3)

Evidence is in acceptance DB `nabitouch_stripe_acceptance_c0ad321d59214c3c` on `127.0.0.1:18082`.

| Item | Evidence |
| --- | --- |
| Practitioner | `p-nabitu-kahindo` — `bookable: true` |
| Clinic booking | `a-7548f4c8` — `status: assigned`, `locationType: clinic`, practitioner assigned |
| Mobile booking | `a-1eee3b75` — assigned; outer-zone travel fee path completed earlier ($30 travel / tax / deposit) |
| Prior Stripe deposit | `NT-INV-00007` — `partially_paid`, received `3150`, balance `9450` (duplicate blocked). **Not re-tested this turn.** |

Acceptance health: `mongo/redis ok`, `documentUploads: false`, `cardCheckout: true`, `PAYMENT_MODE=test`, `DEMO_MODE=false`.

---

## Priority 4 — Production Stripe HTTPS webhook audit (read-only)

### Code path (this SHA)

| Control | Finding |
| --- | --- |
| Routes | `POST /api/billing/stripe/webhook` and alias `POST /api/stripe/webhook` |
| Signing secret | Empty secret → `503 Card webhook is not configured`. Signature checked via `stripe_signature_matches` → `400` on bad sig |
| Auth / CSRF | Webhook is not cookie-authenticated. CSRF middleware only runs when session cookies are present, so Stripe deliveries without cookies are not CSRF-blocked. Paths are not listed in `EXEMPT`; that is intentional for cookie sessions |
| Live / test separation | `sk_live_` refused for checkout. Webhook rejects `livemode: true`. With `PAYMENT_MODE=test`, events must have `livemode: false` |
| Idempotency | Events upserted in `nt_stripe_events` by Stripe event id; ledger mutate keyed by hashed session id; checkout `status=paid` / prior payment short-circuit prevents double settlement (proven in local Stripe CLI acceptance) |
| Browser return | `GET /api/billing/stripe/return` is read-only; does not settle money |

### Live `nabitouch.com` (prior probe this campaign; no config change)

| Probe | Result |
| --- | --- |
| `GET /api/health` | 200 (older health shape vs this SHA) |
| `POST /api/billing/stripe/webhook` | **404** — route not present on the live stack |
| Dashboard endpoint registration / production `whsec_` | **Not verified** (no live key listing; would require owner Dashboard access). Do not invent or print secrets |

**Conclusion:** Production public HTTPS does not yet serve this codebase’s Stripe webhook. Cutover + webhook secret provisioning remain blockers. Do not register a live endpoint or set `sk_live_` without explicit approval.

---

## Priority 5 — Staging HTTPS webhook delivery

**BLOCKED — did not create infrastructure or secrets.**

| Observation | Implication |
| --- | --- |
| `deploy/nginx.staging.not-active.conf` is explicitly inactive (`nabitouch.staging.invalid`) | No approved public staging vhost for this app |
| Prior staging callback probe: billing webhook path returned **503** (secret unset); `/api/stripe/webhook` returned **401 Basic** | Path may exist behind Basic Auth, but delivery is not safely isolated for Stripe without configuring `STRIPE_WEBHOOK_SECRET` and exempting the billing path — both are config/infra changes |
| Local acceptance webhook (this turn) | Empty body → **400** (secret present, signature rejected) — confirms handler behavior offline |

A controlled Stripe Dashboard → HTTPS delivery test was **not** run. Doing so would require owner approval to set a staging webhook secret and/or register an endpoint.

---

## Priority 6 — Release cleanup and verification

| Check | Result |
| --- | --- |
| Focused pytest (`payment_policy`, `stripe_sandbox`, `busy_slot`, `onboarding`) | **67 passed** |
| Vitest | **81 passed** (22 files) |
| `vite build` (placeholder `REACT_APP_BACKEND_URL=https://example.com`) | **exit 0** (~41s). Recharts chunk circular-dependency warnings only |
| Gitignore / env | `backend/.env` and `.env.*` ignored; acceptance env shows `PAYMENT_MODE=test` |
| Scratch pytest DB | Dropped `nabitouch_pytest_scratch_1016` |
| Backup/rollback | Runbook `docs/BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md` reviewed; **not executed** against `nabitouch_prod` (requires owner authorization) |
| Browser smoke | Vite on `http://localhost:18083` → acceptance API `18082`. Login page renders; health reachable from browser; booking Step 1 (Where / mobile+clinic) loads. No staff password entered in automation |

Prior Stripe deposit acceptance (62 tests / genuine Checkout) remains the payment evidence baseline and was **not** repeated.

---

## Rollback commands (do not run until authorized)

From `docs/BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md` (private API baseline on host):

```bash
# Point private API back at the known-good image (do not drop nabitouch_prod)
# Prefer: nt-next-api:rollback-0081eac25d1e
# Or:     nt-next-api:9aca5eccdc3c
# Recreate container with the existing environment only.

# Public Nginx rollback (Hostinger cutover docs) — restore prior site file:
sudo cp /etc/nginx/sites-available/nabitouch.com.active /etc/nginx/sites-available/nabitouch.com
sudo nginx -t && sudo systemctl reload nginx
```

Database restore over `nabitouch_prod` requires a **second** owner confirmation after reviewing a restore copy. Leave additive indexes/media if the new process already created them.

---

## Remaining blockers (must clear before GO)

1. **Owner approval** to deploy SHA `3c5b5a2` and to merge Draft PR #1 (currently keep unmerged).
2. **Fresh encrypted `mongodump` of `nabitouch_prod`** + isolated restore verification (runbook sequence). Acceptance restore drill is PASS; production backup still requires owner authorization.
3. **Public cutover** of `nabitouch.com` `/api` to this API so `/api/billing/stripe/webhook` and `/api/stripe/webhook` return signature validation (not **404** — reconfirmed this turn).
4. **Stripe HTTPS webhook** on the cutover host: test-mode endpoint + `STRIPE_WEBHOOK_SECRET` only after isolation proof; live keys remain off until a separate approval.
5. **Staging HTTPS delivery** still blocked until an existing callback is authorized with a secret (no new infra in this campaign).
6. **Live payments** remain disabled until you explicitly approve (`sk_live_` refused by code until then).
7. Optional polish: clinic `a-7548f4c8` is `assigned` (visibility/nav OK); owner confirm to `confirmed` if product requires it before go-live demos.

---

## Explicit non-actions this turn

- Did not merge Draft PR #1  
- Did not deploy to production or change production/staging secrets  
- Did not enable live Stripe  
- Did not register new Stripe webhook endpoints  
- Did not re-run the proven $31.50 deposit acceptance suite  

---

## GO / NO-GO

**NO-GO** for production release at SHA `3c5b5a2`.

Application workflows (practitioner, clinic assign, mobile+travel, local Stripe test settlement) and automated tests are in good shape for a **later** cutover. Public production Stripe HTTPS settlement and authorized production backup/deploy steps are not. Acceptance backup/restore drill remains PASS.
