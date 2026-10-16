# Nabitouch: Production Readiness Report (June 2026, dev/staging)

Statuses: **PASS**, **FAIL**, **BLOCKED** or **NOT TESTED**. Evidence comes from `/app/test_reports/iteration_1–5.json` and the inline iteration‑4 audit. Pytest suites are in `/app/backend/tests/` (`test_t1_*`, `test_m7_10_*`, `test_finance_billing_giftcards.py`). Nothing here has been deployed. Live payments, real customer notifications and app-store publishing are all off.

**Overall: NO‑GO for production today.** The application code passes. The blockers are external accounts and approvals (section 9).

## 1. Feature audit

| Area | Status | Evidence |
|---|---|---|
| Public site, catalog, contact | PASS | Iter 4/5: desktop 1920 and mobile 390, no overflow, no page errors |
| Registration, login, lockout, CSRF | PASS | Iter 4: 5×401 then 429; a missing or wrong X‑CSRF‑Token returns 403 |
| MFA (TOTP) web | PASS | Earlier iterations; native MFA endpoint was tested at the API level |
| Native sign-in (Bearer + rotating refresh) | PASS (API) | Iter 2/4: header required, refresh reuse revokes the session |
| RBAC and cross-client/practitioner isolation | PASS | Iter 4: 12 owner-only endpoints return 403 for desk; client A cannot reach client B data (403/404) |
| Booking: quote, book, reschedule, cancel, travel fee, GST | PASS | Iter 4: $120 + $6 GST; Stripe paid only after a signed webhook |
| Address confirmation and service area | PASS (fixed) | Iter 5: saved address becomes confirmed after a verified booking; unconfirmed or out-of-area addresses return 400; the server re-geocodes on every booking |
| Invoices, payments, receipts (PDF), refunds | PASS | Iter 4: application/pdf; client PDF returns 403 until released |
| Insurance payments | PASS | Reconciliation: claimed $558.60 − received $512.40 = pending $46.20 |
| Gift cards | PASS | 90 days: $475 issued − $165 redeemed − $100 voided = $210 liability |
| Wellness plans / Deep Tissue 5-Pack | PASS | $500, 5×60 min, regular $550; exactly 5 credits; concurrent bookings get different credits; the credit doesn't combine with winback (409) |
| Memberships (Stripe subscription) | PASS (simulated) | Signed webhooks; real renewals still need a reachable webhook URL |
| Practitioner earnings and statements | PASS (fixed) | Iter 5: lock gives 3 concurrent → 1×200 + 2×409; credit-visit pay uses the $100 per-credit price |
| Financial reports | PASS | All KPIs equal the row and invoice sums (revenue $1,422.75 this month / $8,846.25 over 90 days) |
| Safety Center, incidents, hold, 911 control | PASS | Iter 2/5; no emergency dispatch exists or is implied |
| Client readiness and Ready Glow | PASS | Iter 5 |
| Messaging and presets | PASS | Iter 5 (short labels added afterwards) |
| Tracking and ETA (Mapbox) | PASS (web) / NOT TESTED (device) | Background GPS on a real phone has not been verified |
| Winback, member badge, plan nudge | PASS | Iter 3/5 |
| Owner screens (reports date picker, plans, winback, safety, channels, gift cards) | PASS | Iter 5 |
| Push device registry and revocation | PASS | Iter 4: fingerprint only, 429 limit, revoked on native logout |
| Android Firebase (FCM) delivery | BLOCKED | No registered test device; PUSH_ENABLED=false |
| iOS / APNs | BLOCKED | Apple Developer enrollment pending |
| Native device behaviour (GPS, background, maps hand-off) | NOT TESTED | Needs physical devices |
| Training/sandbox | PASS (earlier) | Not re-tested in iteration 4/5 |

## 2. Integrations

- **Resend: PASS (test-inbox mode)**
  - nabitouch.com is verified in Resend (us-east-1), checked through the Domains API.
  - Sender: `Nabitouch <bookings@nabitouch.com>`. Every email is redirected to `EMAIL_TEST_RECIPIENT=info@nabitouch.com`.
  - Templates: the Tide shell `backend/emailtpl.py` (version `tide-2026-06`, sent as a Resend tag) wraps every email. It includes an Edmonton-time note and support contact, and never includes treatment notes.
  - Sending: idempotent sends (Idempotency-Key), worker retries with backoff, and Svix-verified delivery/bounce webhook at `/api/notifications/resend`.
  - **To do:** add `RESEND_WEBHOOK_SECRET`; confirm DMARC alignment in DNS (SPF/DKIM are verified by Resend); add a bounce suppression list (Medium).
- **Twilio SMS: PASS (one controlled test text)**
  - Trial account; Messaging Service `MGea9d…` with +1 707•••9545.
  - Webhook signatures are verified; STOP/START/HELP are handled; status updates can't move a text back to an earlier state.
  - `SMS_ENABLED=false` during testing. Upgrading the account is needed before real clients get texts.
- **Firebase Admin: credentials PASS** (OAuth token acquired; key `e29e04e77e…`).
  - Delivery BLOCKED: needs a test device and approval.
- **Stripe: PASS (test mode)**. Live mode is not enabled.
- **Mapbox: PASS** (geocoding, matrix ETA).

## 3. Security findings

| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | Medium | litellm, emergentintegrations, python-jose and ecdsa are installed but not imported by the app; pip-audit reports CVEs for them | Open. Remove from the production image |
| S2 | Medium | Pillow 11.3 had CVEs | Fixed (12.3.0) |
| S3 | Info | No secrets are tracked in git; `.env`, `google-services.json`, `GoogleService-Info.plist` and service-account JSON are gitignored | PASS |
| S4 | Medium | Two Firebase keys were shared through public upload links | The first was rotated and deleted; production needs a key never uploaded here |
| S5 | Low | The Twilio Auth Token was pasted in chat | Rotate it before production |
| S6 | Info | Twilio, Stripe, Resend and cron webhooks are authenticated | PASS (iter 4) |
| S7 | Info | yarn audit: 0 vulnerabilities | PASS |
| S8 | Medium | No email bounce suppression list yet | Open |

## 4. Remaining defects

- **Critical:** none.
- **High:** none in the code. External blockers are in section 9.
- **Medium:**
  - S1 and S8 above.
  - Overlapping test statements exist for maya (test data only).
  - Native device verification is outstanding.
- **Low:**
  - The report practitioner filter is a native select.
  - Desk users see the Safety nav item even when they aren't managers (the page explains why).
  - A broken media thumbnail exists in the sample data.
  - `/me` logs a 404 for an invoice that doesn't exist yet.
  - ESLint config needs migrating to the flat format.
  - Old demo-mode test suites (`backend_test.py`, `test_tracking.py`, `slice*`) lock out the sample accounts. Retire them.

## 5. Production configuration checklist

- `APP_ENV=production`, `COOKIE_SECURE=true`, `REDIS_URL=rediss://…`, explicit `CORS_ORIGINS` (include `capacitor://localhost`, `https://localhost`).
- Separate production `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `WEBHOOK_CRON_SECRET`.
- Stripe: live keys and live webhook secret. Separate approval needed.
- Resend: `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `SUPPORT_EMAIL`. **Remove `EMAIL_TEST_RECIPIENT`**, then turn on email types one at a time (`EMAIL_LIFECYCLE_ENABLED`, `INVOICE_EMAIL_ENABLED`, `STATEMENT_EMAIL_ENABLED`).
- Twilio: upgraded account, rotated Auth Token, **remove `SMS_TEST_RECIPIENT`**, `SMS_ENABLED=true` only after approval. Point the Messaging Service webhooks to `https://<prod>/api/sms/inbound` and `/api/sms/status`.
- Firebase: mount the service-account file outside the app (chmod 600). Set `FIREBASE_PROJECT_ID`. Use `PUSH_DRY_RUN=true` first, then false; `PUSH_ENABLED` only after approval.
- Mapbox production token restricted to your domains.
- Cron `.emergent/crons.yml` `sms-reminders` runs every 15 minutes.

## 6. Backup and restore

- **Verified in staging (PASS):** `mongodump` of `nabitouch_dev` (4.1 MB, 75 collections) was restored into `nt_restore_check`, with identical document counts in all 75 collections. The check database was then dropped.
- **Production:** take a daily `mongodump --uri=$MONGO_URL --db=$DB_NAME --out=/backups/$(date +%F)` to encrypted storage. Keep backups for 30 days. Test a restore quarterly into a separate database.
- **GPS data:** keep only what is needed for trip sharing. Review the tracking TTL before launch.

## 7. Deployment and rollback

1. Freeze the release.
2. Run the regression suites with `-n 0`: `test_t1_*`, `test_m7_10_*`, `test_finance_billing_giftcards.py`.
3. Take a backup (section 6).
4. Deploy with every notification flag off.
5. Smoke test: login, booking quote, Stripe test checkout on staging.
6. Turn integrations on one at a time, after approval.

**Rollback:** use the platform rollback to the previous checkpoint, and turn every `*_ENABLED` flag off (notifications stop immediately). If data was migrated, restore from the pre-deploy dump.

## 8. Native readiness

- **Android:** `com.nabitouch.practitioner`, `google-services.json` in place, google-services plugin, FCM 24.1.0, permissions and notification channels set. The build has not been run here (no SDK); build it in Android Studio.
- **iOS:** bundle `com.nabitouch.practitioner`; FirebaseMessaging is in the Podfile; the AppDelegate passes Firebase's FCM token to the app. BLOCKED on Apple enrollment (APNs .p8 key, Push capability, plist).
- **Not yet verified on devices:** background GPS, lock-screen behaviour, battery, maps hand-off, push deep links, offline behaviour.

## 9. Release blockers needing your action or approval

1. Apple Developer enrollment, then the iOS Firebase setup.
2. Physical-device testing for Android and iOS.
3. Twilio upgrade, rotated Auth Token, and a decision on the US vs Canadian number.
4. Production secrets (Stripe live, a fresh Firebase key, a Resend webhook secret).
5. Approval to deploy and turn notifications on.
6. Pricing decision: the catalog lists Deep Tissue 60 min at $130, while the 5-Pack assumes a regular price of $110.

## 10. Sample-data reset

`cd /app/backend && python ../scripts/seed_sample.py`. It refuses to run when `APP_ENV=production`, when `DB_NAME` contains "prod", or when the database name doesn't end in `_dev`, `_staging` or `_test`. It only replaces `synthetic: true` records and prints new sample passwords.
