# Frontend Vite migration handoff

14 October 2026. Local commit only. Nothing was pushed, merged, deployed, or enabled for public booking.

## 1. Starting point

Branch: `feature/nabitouch-launch-completion`
SHA: `c0fa16ae9ce91b58fa3823e09ef1e7716371dd30`
Parent of that docs commit: `0cbbeb801900079b89baea8b86152bd8b570a163`
The older SHA named in the task (`67b61e925766dffc6f7570d5e263a240ec2ee970`) is an ancestor. It was not reset.

Uncommitted files left untouched: `docs/PRODUCTION_RELEASE_RUNBOOK.md`, `deploy/apply-owner-password.py`, `deploy/reset-owner-password.sh`, `deploy/set-resend-credentials.sh`.

## 2. Final point

Branch: `feature/frontend-vite-security-migration`
Migration SHA: `5f19edc2f169c656e3144d5f5ebf15910b92814f`

That commit contains the Vite toolchain, the lockfile, and both reports. The branch tip is one docs commit later, which only writes this SHA into the handoff.

## 3. Files changed

- `frontend/package.json`, `frontend/yarn.lock` — Yarn reinstall without Create React App
- `frontend/vite.config.js`, `frontend/vitest.config.js`, `frontend/jsx-in-js.js`, `frontend/index.html`
- `frontend/src/lib/client-env.js`, `frontend/src/lib/client-env.test.js`, `frontend/src/setupTests.js`
- `frontend/src/components/AddressPicker.test.js` — Vitest mock API
- `frontend/tailwind.config.js`, `frontend/README.md`
- `frontend/craco.config.js` and `frontend/public/index.html` removed
- `deploy/frontend-static.example.conf` — commented example, not installed
- `docs/FRONTEND_DEPENDENCY_SECURITY_REVIEW.md`

`frontend/plugins/health-check/` remains on disk and is unused. It only ran inside the old Webpack config.

## 4. Migration decisions

- Vite 7.3.7 and Vitest 3.2.6. React stays 19.0.0. Router, Tailwind, axios, Mapbox, and lodash stay on their current majors.
- Build output is still `frontend/build`, so existing copy-to-web-root notes keep working. Hashed files land in `build/assets`.
- JSX remains in `.js` files. A small Vite plugin parses those files as JSX. Dev pre-bundling uses the same loader.
- `process.env.REACT_APP_*` call sites were not renamed. Only three keys are defined for the client. A missing value stays the expression `undefined`, matching the old Create React App string. An `sk.` Mapbox token throws before the bundle is written.
- `DEV_API_PROXY` is server-side only. The dev server proxies `/api` to it. It is not a `REACT_APP_` variable.
- The Emergent CRACO overlay and the PostHog snippet (`phc_` / `assets.emergent.sh`) were removed from the HTML entry. They are not part of Nabitouch branding or booking. The service worker, manifest, fonts, and DataCloneError handler stay.
- Yarn resolutions pin `tinypool@2.1.2`, `postcss-selector-parser@7.1.6`, and `@eslint/plugin-kit@0.3.4`. Yarn warns that the first two are outside the ranges their parents request. Tests and the CSS build still pass. The old `rollup@2.80.0` pin was removed because it would break Vite.

## 5. Dependency audit

| Graph | Before | After |
| --- | --- | --- |
| Packages Yarn counted as production | 1455, including Webpack and Jest | 206 |
| Production high / critical | 10 high `braces` | **0** |
| Production moderate | 8 `sprintf-js` | **0** |
| Full install | same 18 findings | 4 findings, 661 packages |

After command for production: `corepack yarn audit --groups dependencies` — 0 vulnerabilities, exit 0.
After command for everything: `corepack yarn audit --level low` — exit 12.

Remaining full-graph findings, all dev or build:

| Package | Advisory | Severity | Path | Status |
| --- | --- | --- | --- | --- |
| braces 3.0.3 | 1240992 | high | `tailwindcss > chokidar > braces` | no patched release |
| braces 3.0.3 | 1240992 | high | `tailwindcss > fast-glob > micromatch > braces` | no patched release |
| vitest 3.2.6 | 1193683 | moderate | `@vitest/mocker` path traversal | patched only in Vitest `>=4.1.11` |
| vitest 3.2.6 | 1193684 | moderate | `@vitest/mocker` path traversal | patched only in Vitest `>=4.1.11` |

Criticals that appeared on the first Vite install were cleared before this result: Vite 7.1.5 highs by moving to 7.3.7, a Vitest UI file-read by moving to 3.2.6, and `tinypool` prototype pollution by the 2.1.2 resolution. `@eslint/plugin-kit` low ReDoS and `postcss-selector-parser` moderate were pinned to patched versions. This is not a zero-vulnerability install.

## 6. High and critical still open

Production graph: none.
Full graph: two high `braces` findings, no patch, build machine only. No criticals.

## 7. Frontend tests

`corepack yarn test` — **26 passed, 9 files**, Vitest 3.2.6, about 4 seconds.
The previous 23 Create React App tests are included. Three new tests cover the client env allowlist, `sk.` refusal, and missing variables.
No ESLint config and no TypeScript, so there is no lint or typecheck gate to run.
Backend tests were not rerun. API contracts were not changed.

## 8. Production build

`corepack yarn build` with `REACT_APP_BACKEND_URL=https://nabitouch.com`, a fake `pk.` token, and tracking `simulated`: exit 0, 2764 modules.

| Asset | Size | Gzip |
| --- | --- | --- |
| `build/index.html` | 1.59 kB | |
| CSS | 81.79 kB | 14.22 kB |
| Main JS | 559.61 kB | 184.24 kB |
| Mapbox chunk | 1,908.69 kB | 538.45 kB |

Previous Create React App gzip was about 15.11 kB CSS, 187.73 kB main JS, and 521 kB for the large chunk. Vite warns that the Mapbox chunk is over 500 kB. It was already a separate large chunk before this migration.
The built JS contains `https://nabitouch.com`. `localhost` strings in the main chunk are library fallbacks, not the API base. `sk.` matches are Mapbox's own warning text and a pathname mask, not a secret. `build/` stays gitignored.

That build was repeated after the dev pre-bundle loader was added. `vite build` does not use that loader. The second run exited 0 in 22.60s and wrote the same `index-BtGMKkuW.js` and `MapboxLiveMap-C0bInTOL.js` names.

## 9. Browser acceptance

Stack: Vite on `http://localhost:3025`, proxy to the isolated API on `127.0.0.1:18014`. Database `nabitouch_preview_validate`. Stopped after the checks. Production containers were not touched.

| Check | Result |
| --- | --- |
| Homepage, desktop and 390px | Loaded, overflow 0, no broken images, bottom nav present |
| Service catalogue and `/services/swedish` refresh | Swedish Massage rendered |
| Practitioners | Jordan Ellis, Liam Fournier, Maya Chen, Priya Sandhu. Nabitu absent |
| Booking NT-2035 | Swedish 60, Maya, 22 Oct 2026 09:00, address confirmed |
| Mapbox autocomplete | Address confirmed in the booking |
| Travel | Included, $0.00 |
| WELCOME20 / GST / total | Treatment $120.00, welcome −$24.00, travel $0.00, GST $4.80, total $100.80 |
| Owner demo login | `/owner`, no MFA prompt. This is the local demo account only |
| Owner service CRUD | Draft `vite-probe` created, preview and anonymous read 404, publish and photo 200, archive 404, restore, delete. Row gone |
| Maya profile | `/pro/profile` editor opened, bio saved with a one-word suffix, then restored |
| Logged-out `/owner/manage` | Redirected to `/login` |
| Logged-out service write | 401 |

Production owner MFA was not exercised. The local preview health flags reported document uploads and card checkout on. Those flags belong to that preview env only.

## 10. Deployment compatibility

- No frontend Dockerfile. `deploy/Dockerfile.api` is the API image only.
- No GitHub workflow in this repo.
- `deploy/nginx.staging.not-active.conf` and `deploy/Caddyfile.example` already fall back to `index.html`.
- `deploy/frontend-static.example.conf` is a commented companion: long cache for `/assets/`, no-cache for `index.html` and `sw.js`. It was not copied to any live server.
- A production build must set `REACT_APP_BACKEND_URL` to the public origin. An empty value becomes the old `undefined/api` behaviour, not a hidden localhost default.
- API health checks and launch scripts were not modified.

## 11. Known limitations

- Tailwind's `braces` copies have no upstream fix.
- Vitest 4 is the only published fix for the two moderate mocker advisories. The suite was left on 3.2.6 because that jump is a new test runner.
- Yarn resolution warnings for `tinypool` and `postcss-selector-parser`.
- Mapbox remains one large chunk.
- The unused `frontend/plugins/health-check` folder is still in the tree.
- Preview data now includes guest booking NT-2035. `vite-probe` was deleted.

## 12. Recommended next steps

1. Review this branch locally. Do not deploy it from this handoff.
2. Decide later whether Vitest 4 is worth a separate test-runner change.
3. Leave Tailwind in place until `braces` publishes a fix or the CSS toolchain is replaced on purpose.
4. When a private deploy is explicitly authorized, build with the public API origin and a `pk.` token, then use the existing static-file host with an SPA fallback.

## 13. Recommendation

| Gate | Result |
| --- | --- |
| Functional readiness on the local preview | GO — tests and the browser journeys above passed |
| Production dependency graph | GO — 0 high, 0 critical, 0 moderate |
| Complete frontend install | CONDITIONAL — 2 unpatched high `braces` in Tailwind's build tools, 2 moderate Vitest advisories |
| Private deployment | NO-GO — not authorized and not performed |
| Public launch | NO-GO — booking stays off, production MFA was not part of this check |

Stop here. Push, merge, private deployment, and public launch need a separate explicit authorization.
