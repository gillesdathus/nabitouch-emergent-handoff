# Frontend release hardening handoff

14 October 2026. Local commit only. Nothing was pushed, merged, deployed, or enabled for public booking.

## Starting point

Branch: `feature/frontend-vite-security-migration`
HEAD at start: `1bc0983014409cee7eaca04efadafe01965ac138`
Migration commit, still in this branch: `5f19edc2f169c656e3144d5f5ebf15910b92814f`
Deployed private API baseline, unchanged: `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f`

The release runbook and the three credential scripts stayed unstaged.

## Final point

Branch: `feature/frontend-vite-security-migration`
Hardening SHA: `20c101cb5b1d4d9d1e8c9918b0c198dcd47645bd`

That commit is the release candidate. The branch tip is one docs commit later, which only writes this SHA into the handoff and the manifest.

## Files changed in this hardening

- `frontend/src/lib/client-env.js`, `frontend/src/lib/client-env.test.js`
- `frontend/src/lib/feature-flags.js`, `frontend/src/lib/feature-flags.test.js`
- `frontend/vite.config.js` — production mode runs the validator; source maps stay off
- `frontend/package.json`, `frontend/yarn.lock` — Vitest 4.1.11
- `frontend/src/pages/client/Booking.jsx`, `BookingSteps.jsx`, `InsurancePage.jsx`
- `frontend/src/components/PaymentPanel.jsx`, `InsuranceWizard.jsx`
- `frontend/README.md`
- `frontend/plugins/health-check/` removed after confirming nothing imports it
- `backend/config.py` — unset upload, card, and legacy-import flags stay off
- `backend/rewards.py` — a client payload cannot authorize rewards
- `backend/availability.py`, `backend/server.py` — a placeholder clinic cannot be booked
- `backend/tests/test_launch_config.py`, `backend/tests/test_rewards.py`
- `backend/env.example`, `docs/ENVIRONMENT.md`
- `docs/FRONTEND_RELEASE_CANDIDATE_MANIFEST.md`

## Security findings corrected

Production builds now refuse a missing, empty, or non-https `REACT_APP_BACKEND_URL`, a localhost or private host, credentials in the URL, and a path that would become `/api/api`. An `sk.` Mapbox token is still refused. A `pk.` token is accepted. Stripe `sk_live` / `sk_test_` values and MongoDB URLs are refused inside the three public variables. Development still allows the three variables to be unset. The deployment template's origin remains `https://nabitouch.com`. The validator does not hardcode that hostname, so a later authorized host can be supplied at build time.

Card checkout and document uploads render only when the server sends boolean `true`. The insurance wizard defaults to no file capture.

`DOCUMENT_UPLOADS_ENABLED`, `STRIPE_CARD_CHECKOUT_ENABLED`, and `LEGACY_PATIENT_IMPORT_ENABLED` now default to off when unset. Production still refuses to boot until each one is set explicitly. The Hostinger template already sets them to `false`.

The isolated preview container does not put those flags in Docker's environment list. Its start script writes `DOCUMENT_UPLOADS_ENABLED=true`, `STRIPE_CARD_CHECKOUT_ENABLED=true`, and `LEGACY_PATIENT_IMPORT_ENABLED=true` into the container's preview env file. The earlier health response was that explicit test configuration. It is not the production template and it is not the new unset default.

Rewards settings saved from a request ignore `activationAuthorized` and `taxTreatmentConfirmed`. NabiDerm stays off inside `validate_rewards`. Cancellation fees, automatic collection, recovery email, and promotional sending remain code-level off.

A clinic booking now requires `clinic.enabled` and an address that passes `validate_clinic`. A placeholder such as `[Clinic address — to be supplied]` is refused even if the stored flag is true.

## Remaining advisories

Production graph: none.

Full install, dev and build only:

| Package | Advisory | Severity | Path | Status |
| --- | --- | --- | --- | --- |
| braces 3.0.3 | 1240992 | high | `tailwindcss > chokidar > braces` | no patched release |
| braces 3.0.3 | 1240992 | high | `tailwindcss > fast-glob > micromatch > braces` | no patched release |

Both run while Tailwind compiles CSS. Visitor requests do not reach them. Replacing Tailwind was not done.

Yarn still warns that `postcss-selector-parser@7.1.6` is outside Tailwind's `^6` request, and `@eslint/plugin-kit@0.3.4` is outside `^0.2.7`. Those pins are the published fixes. The CSS production build succeeds with the parser pin. This repo has no ESLint config, so the plugin-kit pin is not on a lint path. The `tinypool@2.1.2` warning is gone because Vitest 4 requests a 2.x range that includes that pin.

## Dependency audit

| Graph | Before this hardening | After |
| --- | --- | --- |
| Production packages | 206, 0 findings | 206, 0 findings |
| Full install | 661 packages, 2 high braces, 2 moderate Vitest | 684 packages, 2 high braces, 0 moderate |

Commands, from `frontend/`:

- `corepack yarn audit --groups dependencies --level low` — exit 0
- `corepack yarn audit --level low` — exit 8, 2 high

`npm audit fix --force` was not used.

## Configuration validation

`corepack yarn install --frozen-lockfile` — exit 0.

| Build command | Exit | Result |
| --- | --- | --- |
| `yarn build` with no API origin | 1 | refuses `undefined/api` |
| `yarn build` with `http://localhost:3025` | 1 | refuses non-https |
| `yarn build` with an `sk.` Mapbox token | 1 | refuses the secret token |
| `yarn build` with `https://nabitouch.com` and `pk.public-build-check` | 0 | 22.71s, 2765 modules |

The successful artifact contains `https://nabitouch.com` and the fake `pk.public-build-check` token used for this local build. It does not contain `undefined/api`, `localhost:3025`, `127.0.0.1:18014`, `sk_live`, `sk_test_`, `mongodb://`, `emergent.sh`, or `phc_`. Three `http://localhost` strings are library fallbacks inside the router bundle. No `.map` files were emitted. `frontend/build` stays gitignored.

## Feature-flag enforcement

`docker run ... nt-validate-py python -m pytest` on the isolated image, with a disposable encryption key and `nabitouch_launch_check` on the preview MongoDB:

- `test_unset_restricted_flags_stay_off` — exit 0. Unset flags are false. A clinic slot probe is unavailable. A placeholder clinic is not bookable.
- `test_production_launch_env_is_accepted` and `test_production_requires_explicit_upload_flag` — included in an 8-test run, exit 0
- `tests/test_rewards.py` and `test_consent_unsubscribe_and_fees_stay_off` — included in that 8-test run
- `test_production_process_refuses_uploads_cards_and_import` — exit 0 after installing Pillow in that one-off container. Health reported both flags false. Checkout and card intent returned 503. Document upload, legacy import, and history import returned 403.

The launch-check database was dropped afterward. The full backend suite was not rerun.

On the isolated preview API, which still has the explicit `true` flags, health reported `documentUploads: true` and `cardCheckout: true`. An unauthenticated card checkout returned 401. An unauthenticated rewards activation returned 401. A clinic booking against the stored placeholder address returned 400 after the fix. One probe booking, `NT-2036`, was created before that fix and then deleted, along with its guest row, two audit rows, and its Redis tracking capability.

## Frontend tests

`corepack yarn test` — exit 0. **42 passed, 10 files**, Vitest 4.1.11. The previous 26 tests remain. New tests cover production origins, private tokens, and fail-closed flags. No lint or TypeScript gate is configured.

## Browser acceptance

Vite on `http://localhost:3025`, proxied to the isolated API on `127.0.0.1:18014`. Stopped afterward.

| Check | Result |
| --- | --- |
| Homepage | Heading present, 8 images, 0 broken, overflow 0 |
| Service catalogue | `/services` rendered |
| Swedish detail refresh | `/services/swedish` still showed Swedish Massage |
| Practitioners | Jordan Ellis, Liam Fournier, Maya Chen, Priya Sandhu. Nabitu absent |
| Maya profile refresh | `/practitioners/maya-chen` still showed Maya Chen, 0 broken images |
| Logged-out `/owner/manage` | Redirected to `/login` |
| Provisional quote | Treatment 120, welcome discount 24, travel 0, GST 4.8, total 100.8 |
| Mobile 390px | Overflow 0, bottom nav present, 0 broken images |

The preview database still has in-clinic visits marked enabled with a placeholder address, so the clinic tile is visible. The API refuses that booking. Owner MFA and a second saved booking were not part of this pass.

## Production build

`build/index.html` 1.59 kB. CSS gzip 14.22 kB. Main JS `index-Jbd7A9zo.js` 559.67 kB, gzip 184.27 kB. Mapbox chunk 1,908.69 kB, gzip 538.45 kB. Vite still warns that the Mapbox chunk is over 500 kB. It was not split. Map rendering was not changed.

## Outstanding risks

- Two unpatched `braces` copies in Tailwind's build tools.
- Resolution warnings for `postcss-selector-parser` and `@eslint/plugin-kit`.
- The isolated preview env file still turns uploads, cards, and legacy import on. That file is not the production template.
- The preview database still has a placeholder clinic marked enabled. Booking is refused; the stored flag was not edited.
- Production owner MFA was not exercised.
- Vitest prints a future warning about loading `vitest.config.js` as CommonJS. Tests passed. `type: module` was not set, because Tailwind's config uses `module.exports`.

## Private deployment prerequisites

Do not deploy from this handoff. A later authorization still needs:

1. This branch reviewed and the candidate SHA accepted.
2. A production build with `REACT_APP_BACKEND_URL=https://nabitouch.com` and the URL-restricted `pk.` browser token. No `sk.` token.
3. The API environment from `deploy/env.hostinger.example`, including the three restricted flags set explicitly to `false`.
4. Static files from `frontend/build`, with an SPA fallback and a long cache only for `/assets/`.
5. No copy of the preview env file, and no restart of the current private API, from this work.

## Recommendation

| Gate | Result |
| --- | --- |
| Local functional readiness | GO — 42 frontend tests and the browser checks above passed |
| Production dependency graph | GO — 0 findings |
| Complete frontend install | CONDITIONAL — 2 unpatched high `braces` findings in Tailwind's build tools |
| Private deployment | NO-GO — not authorized and not performed |
| Public launch | NO-GO — booking stays off and production MFA was not part of this check |

Stop here.
