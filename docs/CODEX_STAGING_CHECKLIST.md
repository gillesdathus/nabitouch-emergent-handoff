# Staging acceptance checklist

Status: PREPARATION ONLY. No staging/production deployment, real delivery, live payment, mobile publication or production database write is authorized by this checklist. Deployment and each external delivery/device phase require subsequent authorization. Preserve Emergent's approved Tide/lagoon UI and existing business rules.

## Entry requirements

- [ ] Review the draft QA pull request and record its exact commit/image digest. Do not merge or deploy as part of preparation.
- [ ] Supply an approved staging HTTPS frontend origin and API origin, hosting destination, and an explicit later deployment authorization. Identify who owns test execution and evidence review.
- [ ] Allocate separate staging MongoDB/Redis and least-privilege credentials. Use synthetic users, addresses, appointments and clinical answers only; never clone production patient records. Record backup and rollback ownership.
- [ ] Build the QA image from a clean checkout and run the critical manifest, including the Git-dependent check. Verify frozen-lockfile frontend installation and a build using the intended staging API origin. Prior verification reused installed backend dependencies; a clean CI image has not been proven.
- [ ] Configure production-like safeguards: `APP_ENV=production`, `DEMO_MODE=false`, secure cookies, explicit CORS, owner MFA, authenticated encrypted Redis and a separate field encryption key held outside Git. Provision synthetic test accounts through supported administration flows. Do not reuse demo/production passwords.
- [ ] Keep uploads, imports, gift cards, live payments, lifecycle/invoice/statement/review mail, SMS and push off unless a particular approved acceptance test needs a staging-only capability. Keep public booking gated.
- [ ] Ensure the QA runner, mock adapters, test secrets, local `.env` files, historical snapshots, `test_reports/`, database archives and dependency caches are excluded from the deployed runtime. Staging integration tests must exercise real providers; the isolated QA runner deliberately forces mocks.
- [ ] Resolve/review the preserved credential document and any reused values; finish the dependency audit. No production credential rotation or Git history rewrite is authorized here.
- [ ] Provide a connected browser, a physical Android test phone, and a secure evidence destination. Do not paste secrets, tokens, consent signatures or health records into GitHub or screenshots.

## Stripe sandbox/test-mode acceptance

Requirements: a dedicated Stripe sandbox/test account; supported test API key in the staging secret store; endpoint-specific webhook signing secret; an approved reachable HTTPS endpoint at `/api/billing/stripe/webhook`; synthetic customers; test-card details; permission for sandbox transactions. No live key or real card/customer may be used. The current integration supports `sk_test_` keys; do not silently change its credential handling during staging setup.

- [ ] Confirm sandbox identity and that live payments remain unavailable. Confirm production-like payment logic is not using simulated checkout.
- [ ] Configure the sandbox endpoint for Checkout completed, expired, delayed-success and delayed-failure events. Record endpoint identity and delivery IDs, never its signing secret. See `STRIPE_WEBHOOK.md`.
- [ ] Enable card checkout only in the approved staging environment after the above checks and deployment authorization. No settings are applied by this document.
- [ ] Create a synthetic confirmed booking; verify the server's quote, address, taxes, deposit/full-payment choices, idempotency and CSRF behavior.
- [ ] Complete a hosted test deposit and full payment. Confirm a browser return alone does not settle an invoice. Exercise decline and 3DS/authentication paths.
- [ ] Verify unpaid/missing-payment-status completion records no money; paid completion and delayed success record the expected amount. Delayed failure must not settle money; document owner recovery behavior.
- [ ] Replay the same event and deliver events out of order; verify one payment, correct balance, no duplicate receipt/invitation and no overpayment. Check signature rejection, amount mismatch and expiry handling.
- [ ] Compare provider amount/session ID with invoice, ledger, financial reports and issued/released invoice/receipt. Test a sandbox refund and reconcile it. Capture redacted evidence and close R1 only after review.

## Resend authorized test delivery

Requirements: a verified staging-approved sending domain/sender, Resend API key and webhook signing secret stored securely, reachable delivery webhook `/api/notifications/resend`, and the exact recipient inbox with explicit authorization to send to it. DNS/domain status and delivery to that inbox have not been verified by the local QA run.

- [ ] Confirm sender verification, reply-to, SPF/DKIM/DMARC evidence and the endpoint's signature validation. Do not infer current readiness from historical reports.
- [ ] Identify the exact test recipient and set `EMAIL_TEST_RECIPIENT` in staging. Verify redirection behavior before any send; synthetic booking fixtures must contain no customer addresses.
- [ ] Keep all automatic mail flags off. After separate delivery authorization, select `EMAIL_PROVIDER=resend` only in staging and use the fixed owner test-mail action for the approved inbox.
- [ ] Confirm provider acceptance, actual inbox receipt and a verified delivery event separately. Check one controlled bounce/failure case, retry/backoff and deduplication without contacting customers.
- [ ] If specifically authorized, enable only the staging mail category under test for a synthetic booking, invoice or review. Record exactly which flag changed, then disable it after acceptance.
- [ ] Confirm logs/receipts contain no medical notes or credentials. Preserve redacted message/event IDs and close R2 only after actual delivery evidence.

## Browser E2E and UI fidelity

Requirements: a connected automation browser, approved staging URLs, synthetic client/practitioner/reception/owner accounts, owner MFA enrollment, real staging Mapbox server and restricted browser tokens, and approved Stripe/Resend test configuration for any external journey. No working browser connection existed during the completed local QA session.

- [ ] Verify desktop/mobile layouts against Emergent's approved design: public catalogue, service detail, practitioner profile, navigation, contact and booking. Check overflow, broken images, page errors and keyboard access.
- [ ] Exercise full address suggestion/confirmation, postal mismatch, unsupported service area, missing provider and ETA failure paths without bypassing real production validation.
- [ ] Complete booking, duplicate submit, consent/intake/returning-client changes, consent withdrawal and re-consent; confirm Start Session gates and cross-client access isolation.
- [ ] Exercise treatment countdown/overtime, pause reason, cleanup, Ready for Next, next-booking conflicts, offline operation replay and reconnect. Check that replay does not duplicate transitions/payments.
- [ ] Verify review eligibility/edit restrictions, private feedback and Google Review link configuration. Check owner finance reports, invoice/receipt permissions and chart rendering, including the existing Recharts circular-chunk warnings.
- [ ] Record actual browser/version/viewport, commit, pass/fail evidence and any remaining console/network errors. Close R3 only after the real browser journeys run.

## Android physical-device validation

Requirements: an identified physical Android phone and OS version, USB debugging/device installation access, Android build tooling/signing for a non-store test build, a dedicated staging Firebase project, Android package registration matching `com.nabitouch.practitioner`, matching native Firebase configuration, secure backend service-account provisioning, staging test accounts and later authorization to install/test. Do not publish to a store.

- [ ] Verify package/build/commit identity, staging API routing, secure native token storage, login/MFA, refresh rotation/reuse detection and logout/device-token revocation.
- [ ] Verify notification permission grant/denial and FCM registration/refresh. Keep `PUSH_ENABLED=false` until authorized for the specific test device; use dry-run first, then an explicitly authorized device-only delivery.
- [ ] Confirm background/foreground notification delivery and tap routing, token replacement and logout removal. Check that another user's device receives nothing.
- [ ] Verify foreground/background location permissions, denied/revoked permissions, locked-screen operation, battery/background restrictions, trip pause/stop/arrival and expiration. Confirm only authorized active trips share GPS.
- [ ] Test Google Maps/Waze handoff and web fallback; opening a map app must not imply navigation or arrival succeeded. Exercise network loss/resume and queued session actions without duplicates.
- [ ] Record device model, OS, build, permission state and observed results. Keep physical-device cases BLOCKED until performed. Android success does not certify iOS/APNs or store readiness.

## Existing evidence and explicit gaps

The completed local run recorded **184 passed backend tests**, **60 passed frontend tests**, a successful frontend production build and a **77-collection synthetic backup/restore comparison** of counts/indexes plus a sample invoice. See `CODEX_QA_2026-10-15.md`; logs/archives remain local and ignored. These results are not external provider, browser or device validation.

Five skipped tests in `backend/tests/test_t1_iteration4.py`:

1. `TestAddress::test_out_of_area_live_mapbox` — live Toronto Mapbox geocoding was unavailable.
2. `TestDeep5::test_catalog` — the Deep Tissue 5-pack product was absent.
3. `TestDeep5::test_purchase_book_cancel_complete` — the product was absent.
4. `TestDeep5::test_credit_visit_earnings_per_credit` — no completed credit visit existed.
5. `TestBookingBilling::test_flow` — card checkout was off and no Stripe test key was configured; the hosted-checkout/webhook journey was not run. Separate signed synthetic webhook tests did pass.

Excluded check: `backend/tests/test_secret_validation.py::test_repository_has_no_tracked_production_secret_file` was deselected because the reused minimal Python container lacked Git. The host equivalent passed. Rerun the actual test in the new QA image, which includes Git.

If the 5-pack is in launch scope, add isolated product/credit fixtures and rerun all three cases; otherwise retain its explicit exclusion. Production configuration/recovery, credential hygiene and dependency review remain R5/R6 blockers. Reverify the backup with off-site retrieval and separately recovered field keys before a production decision.

Exit requirement: a reviewed acceptance record for the exact candidate, all applicable R1–R7 gates resolved or explicitly scoped out, separate web/Android/iOS decisions and explicit authorization before any deployment/cutover. Current recommendation remains NO-GO.
