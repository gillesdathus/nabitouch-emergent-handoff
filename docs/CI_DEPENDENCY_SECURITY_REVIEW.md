# Clean CI, skipped tests and dependency/security review

Prepared 15 October 2026 from `5f3f793778d21f3f8a868503472c46b5240eb26a` on the existing feature branch. PR #1 remains draft. Historical QA evidence remains in `CODEX_QA_2026-10-15.md`; the observations below supersede its clean-install/dependency-review gaps where explicitly verified.

## CI design and local verification

There were no tracked GitHub Actions workflows. `.github/workflows/ci.yml` now performs configuration/security checks, clean backend image installation, maintained backend regressions including Git, a Directions-outage regression, frontend frozen installation/Vitest/build and dependency auditing. Actions are pinned to verified release commit hashes, repository permissions are read-only, checkout credentials are not persisted, and there is no deployment job or deployment credential. It runs on PR synchronization even while the PR is draft. Remote run status must be read from GitHub Actions; local results are not evidence of remote success.

Backend application imports were mapped before removing unused prototype packages. Runtime direct dependencies are in `backend/requirements.in`; test/audit tools extend them in `requirements-dev.in`. Their generated `.txt` locks pin the complete transitive tree and hashes. Installation uses `--require-hashes` and `pip check`. The vendor-hosted LiteLLM wheel, Emergent integrations and unused AI/prototype/lint dependencies no longer enter the active image. Preserved snapshots retain historical requirements and are excluded from image context.

To regenerate in Python 3.12 using `pip==25.3` and `pip-tools==7.5.3` as the isolated lock-generation tooling:

```bash
cd backend
pip-compile --allow-unsafe --generate-hashes --resolver=backtracking --output-file=requirements.txt requirements.in
pip-compile --allow-unsafe --generate-hashes --resolver=backtracking --output-file=requirements-dev.txt requirements-dev.in
```

`--allow-unsafe` includes the explicitly pinned image installer (`pip==26.2.1`) in hash checking; it does not disable hash verification. The lock generator is not shipped as an application dependency. Re-audit locks and rerun tests after regeneration. See pip's [secure installation guidance](https://pip.pypa.io/en/stable/topics/secure-installs/).

The frontend's old frozen install failed because Capacitor and other declared dependencies were missing from `yarn.lock`. Yarn 1.22.22 regenerated the lock without changing the declared UI/runtime dependency versions. A subsequent frozen install passed locally; Vitest passed 60/60 and the example-origin production build completed. Existing peer-version and Recharts/circular-chunk warnings remain for browser/device acceptance.

A clean local Python image installed successfully; the selected suite passed **185 tests, five skipped**, including the formerly excluded Git-dependent test. This increased count is the existing repository check actually running, not new external integration coverage. Five new staging preflight guard tests also passed locally. Remote results are recorded separately after the pushed workflow runs.

## Vulnerability review

The initial installed Python environment audit reported 35 advisory records across `litellm==1.80.0` (32), `ecdsa==0.19.2` (2), and `python-jose==3.5.0` (1). Counts include duplicate/alias records and must not be described as 35 distinct CVEs. These distributions were not imported by the active app and were removed from its requirements closure. The initial clean-image audit then found only the base image's `pip==25.0.1` (12 advisory records); the image installer is now explicitly pinned to `26.2.1`. The final clean local audit reported **no known vulnerabilities**; remote audit status remains separate evidence. This is Python-package coverage, not an OS/container-image vulnerability assessment.

Frontend Yarn audit reported two dependency paths to the same **high-severity `braces` advisory**, [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through Tailwind's `chokidar` and `fast-glob > micromatch`. The advisory affects versions through 3.0.3 and lists no patched version at review time. It concerns crafted deeply nested glob patterns exhausting the Node call stack. In this application these are build-time tooling paths; browsers receive static compiled assets and do not run the Tailwind compiler. That limits the identified deployment exposure but does not erase the finding.

`scripts/check_frontend_audit.cjs` permits only this exact advisory/module under `tailwindcss>` until **15 November 2026**, warns visibly and fails for other advisories, audit errors, missing summaries or an expired baseline. This is a bounded CI baseline, not owner acceptance for production release. Keep build inputs trusted; investigate a supported Tailwind/toolchain remediation separately without redesigning the approved interface. Owner risk/remediation review remains open. No severity-wide suppression is used.

## Five skipped tests investigated

All are in `backend/tests/test_t1_iteration4.py`:

1. `TestAddress::test_out_of_area_live_mapbox`: **external-service acceptance**. The test needs live Toronto geocoding and an actual configured Mapbox provider. The deterministic Leduc service-area rejection test passes independently. CI has no provider token and does not claim real geocoding validation.
2. `TestDeep5::test_catalog`: **optional product fixture**, not an external-service prerequisite. `ensure_plans()` creates indexes, not a `plp-deep5` product, and the demo/launch seeds do not publish it.
3. `TestDeep5::test_purchase_book_cancel_complete`: **optional product fixture** with downstream checkout/credit lifecycle. It cannot purchase the missing product; enabling it requires a disposable QA-only product plus simulated/sandbox checkout, not changing launch catalogue or production rules.
4. `TestDeep5::test_credit_visit_earnings_per_credit`: **dependent optional coverage**. It uses the completed visit set by the previous package test; absence of that visit explains its skip. It is not separate proof of an earnings defect.
5. `TestBookingBilling::test_flow`: **external hosted-checkout acceptance gap**. The method runs booking/invoice setup but skips when card checkout is off/no sandbox key. Synthetic handler tests cover paid/unpaid/deferred/replayed webhook settlement, not a Stripe-created session, 3DS or actual provider reconciliation.

Do not delete skips to manufacture coverage. If the 5-pack enters launch scope, create isolated package fixtures, run the three dependent cases and verify the credited-visit invoice/earnings. Otherwise record its exclusion. Mapbox and hosted Stripe acceptance remain explicitly blocked pending the authorized staging phase. Firebase physical-device cases are separately BLOCKED, never inferred from API tests.

## Secret-file exclusions and historical exposure

The tracked `_milestone1_preserved/memory/test_credentials.md` first appeared in history at `a19cae4264f59a574540fb58aef1e94ebb94fe4a`. It is removed from the current Git index while its local copy remains ignored. `**/test_credentials.md` is now ignored globally. No credential value was printed or copied into this report. Prior commits still contain the file; removal from HEAD and private visibility do not revoke old credentials. Review every account/provider that may have reused those values and confirm rotation with the owner before release. No live credential was changed and no history was rewritten.

The new cross-platform repository check fails on tracked environment/private-key/credential files and runs the existing production-secret validator, then performs a limited redacted token/private-key history scan and reports the known document exposure. `.dockerignore` separately prevents `.env` files, private keys, service accounts, native Firebase configuration, historical snapshots, Git, test artifacts and archives from entering build context. `.gitignore` alone never controls Docker COPY.

There are still hardcoded synthetic passwords/test keys in historical tests and snapshots; they are not production configuration and must never be reused. The pattern scan does not prove all historical secrets are absent, validate rotation, inspect provider access logs or establish who previously downloaded the repository. Historical exposure review remains a release blocker even if CI passes.

## Staging and release decision

Use `HOSTINGER_STAGING_PROVISIONING.md` and `deploy/staging/` examples. Hostinger VPS with Docker Compose is confirmed; actual host/IP, dedicated/shared status, domain, TLS, access CIDRs, independent secrets and deployment authorization are outstanding. Static Compose/preflight tests do not certify a running stack.

**NO-GO** for web/Android/iOS release remains: unpatched build-tool advisory/risk review, historical credential rotation review, provider/browser/device acceptance, image/OS audit, production recovery/key custody and applicable optional-product coverage. A successful remote CI result is a code/configuration prerequisite, not deployment authorization.
