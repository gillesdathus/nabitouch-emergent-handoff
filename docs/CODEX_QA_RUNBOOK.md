# Isolated QA and release gates

Read `CODEX_QA_2026-10-15.md` for actual evidence and outstanding blockers. These instructions authorize no deployment, production data access, real notification, live charge or app publication.

Current clean-install/security work is documented in `CI_DEPENDENCY_SECURITY_REVIEW.md`; Hostinger VPS staging preparation is in `HOSTINGER_STAGING_PROVISIONING.md`. Historical counts in the earlier QA report remain dated evidence.

## Repeatable backend QA

Requires Docker Compose. From repository root:

```powershell
docker compose -f deploy/qa/compose.yml build qa
docker compose -f deploy/qa/compose.yml up -d --wait mongo redis
docker compose -f deploy/qa/compose.yml run --rm qa
docker compose -f deploy/qa/compose.yml run --rm qa python tests/qa_runner.py --eta-failure
```

The first run uses successful synthetic provider responses; the second simulates a Directions outage. `backend/tests/critical_qa.txt` specifies the selected regressions. To target a fix:

```powershell
docker compose -f deploy/qa/compose.yml run --rm qa python tests/qa_runner.py tests/test_checkout_reconciliation.py
```

The QA network is internal, Mongo/Redis publish no ports and mount no production volumes, and every runner invocation chooses a new database with prefix `nabitouch_qa_codex_`. The runner overrides service URLs, disables dotenv loading and provider delivery, and generates fresh in-memory fixture secrets and an encryption key. It does not need real Mapbox, Stripe, Resend or Firebase credentials. Provider mocks are installed only in the test server process. Production code retains postal, confirmation, zone and scheduling checks.

Run serially (`-n 0` is enforced by the runner) because older suites share backend state. Do not replace fresh databases with a cleanup against an existing operational database. Logs/JUnit go to ignored `test_reports/`; handle them as synthetic test artifacts. Keys are deliberately not persisted, so encrypted fixture records retained after the process exits are not a key-recovery drill.

For CI, use a clean checkout and those same Compose commands on a Docker-enabled runner. Archive `test_reports/qa-results-*.xml`, not `.env` files or credentials. Preserve the test exit code. The QA Dockerfile installs the hash-locked `requirements-dev.txt` and includes Git so the tracked-secret validator runs. The clean image has now been built locally and the selected suite passed 185 tests with five skips and no Git exclusion. This is local evidence; inspect the GitHub Actions run for actual remote status.

After exporting artifacts, `docker compose -f deploy/qa/compose.yml down` removes only this QA project's containers/network. Do not add unrelated service names or production volume paths. Synthetic databases live in the disposable QA Mongo container; no production cleanup is required.

## Frontend and repository checks

The repository declares Yarn 1.22.22 and contains `frontend/yarn.lock`. With that package manager installed, use the existing lockfile:

```powershell
cd frontend
yarn install --frozen-lockfile
yarn test
$env:REACT_APP_BACKEND_URL = 'https://example.com'
yarn build
```

The HTTPS example origin is solely for compilation. The generated bundle must not be deployed as a release candidate. A real build requires the approved API origin and restricted public Mapbox token. The original evidence used npm without a lockfile; the subsequent CI preparation repaired `yarn.lock`, verified a frozen Yarn 1.22.22 install and reran Vitest/build. CI uses `--ignore-scripts --non-interactive` and the committed lockfile.

On Windows, a process-scoped script invocation runs the host repository checks without changing persistent execution policy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/qa-repository-check.ps1
git diff --check
```

The repository check prints statuses/counts only. Its history patterns are intentionally limited; commission a complete secret-history and dependency scan before release, and review preserved credential files. Private GitHub visibility does not invalidate previously exposed credentials.

## External acceptance

Stripe: keep live mode off. Initial launch supports cards and Link where applicable;
the genuine card/deposit/final-balance/3DS/decline/expiry/refund evidence is retained
in `STRIPE_LIFECYCLE_ACCEPTANCE_2026-10-16.md`. Delayed-method provider success/failure
is deferred outside initial scope, not passed; do not activate methods just for it.
Retain automated async handler regressions. Native redelivery remains a staging
gate. An inserted synthetic checkout proves handler behavior, not actual Stripe
integration. See `STRIPE_WEBHOOK.md` and Stripe's [fulfillment guidance](https://docs.stripe.com/payments/checkout/fulfill-orders).

Resend: check the verified sending domain, sender, DNS and webhook secret without exposing values. Use only a separately authorized test recipient for delivery. Confirm acceptance, inbox receipt and a verified delivery/bounce event; mock acceptance is insufficient. Keep lifecycle and billing mail disabled until individually approved.

Mobile: use physical Android and iOS devices. Verify native login/MFA, secure storage, refresh rotation/logout, FCM/APNs token refresh and removal, foreground/background delivery, permission denial, locked-screen GPS, reconnection, trip stop/expiry and navigation handoff. Keep these tests BLOCKED until actually performed.

Browser: connect a supported browser to the automation tool, use a fresh synthetic database, and check public desktop/mobile pages, address confirmation, booking/payment choices, clinical readiness, signed consent, timer/cleanup/offline replay, reviews and owner finance charts. Recheck Recharts circular-chunk warnings in the built application. No final browser run was completed on 15 October because no browser connection was available.

## Production configuration checklist

- Record the exact reviewed release commit/image digest; the uncommitted QA tree is not a deployable approval.
- Confirm `APP_ENV=production`, `DEMO_MODE=false`, explicit HTTPS origins, secure cookies, owner MFA and independent secrets. Exclude QA helpers, preserved historical snapshots, development credentials and generated reports from release packaging.
- Use least-privilege Mongo credentials and authenticated encrypted Redis; identify their exact destination before connecting. Verify unique indexes, expiration policies and cross-client clinical access.
- Keep `DOCUMENT_UPLOADS_ENABLED`, `STRIPE_CARD_CHECKOUT_ENABLED` and `LEGACY_PATIENT_IMPORT_ENABLED` explicitly false until their individual release gates are approved. Preserve the existing clinic/mobile booking configuration.
- Set production field encryption key and separate recovery custody. Verify current and previous key handling without writing key values into reports, repositories, backups or screenshots.
- Verify Stripe sandbox/live separation, webhook signatures, Mapbox server/browser token separation and URL restrictions, Resend sender/webhook settings and Firebase project/service-account identity. Keep push disabled/dry-run until device acceptance and approval.
- Verify application health, alert routing, audit/access-log redaction, notification failures, backup monitoring and restore ownership. Complete the existing privacy-review decisions; this technical run does not certify legal compliance.

## Backup and restore procedure

Existing details remain in `BACKUP_RESTORE.md` and `BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md`. Production execution needs separate authorization. Before any authorized deployment, positively identify source URI/database and a new restore destination, record a read-only inventory, and take a fresh encrypted off-host backup. Store the field key separately with controlled recovery access.

With those destinations reviewed, the standard tool sequence is:

```bash
mongodump --uri "$MONGO_URL" --db "$DB_NAME" --archive=nabitouch.archive.gz --gzip
mongorestore --uri "$RESTORE_MONGO_URL" --nsInclude "$DB_NAME.*" --nsFrom "$DB_NAME.*" --nsTo "$RESTORE_DB.*" --archive=nabitouch.archive.gz --gzip
```

Do not supply secrets as literal command text. Do not restore over production or use `--drop`. Encrypt the archive before transfer/storage, restrict access, verify transfer hashes, then compare all collection counts, index definitions and representative invoice/ledger/clinical records. Verify decryption with the separately recovered key and test an application read against the restore. Document retention and deletion of the synthetic drill artifacts separately from clinical retention.

The 15 October synthetic drill restored 77 collections and matched counts, indexes and an invoice. It did not test off-site retrieval, production data or recovery of field-encryption keys.

## Rollback procedure

Record the currently running image digest, application configuration version and database inventory before an authorized change. Preserve that image and the pre-change backup. Start a reviewed candidate only after those records exist, then check authentication/MFA, booking gates, ledger balances, clinical permissions and health. If acceptance fails, stop the candidate and restore the prior image/configuration. Do not automatically drop additive indexes or overwrite the database.

If data recovery is necessary, restore the backup into a new database, reconcile intervening bookings/payments and obtain explicit approval before any cutover. Keep application rollback and data restoration as separate decisions. Historical image digests in older runbooks must be reverified before use. No production rollback was executed in this QA run.
