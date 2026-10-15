# Frontend dependency security review

Date: 14 October 2026
Branch investigated: `feature/nabitouch-launch-completion` at `c0fa16ae9ce91b58fa3823e09ef1e7716371dd30`
Package manager: Yarn 1.22.22 (`frontend/yarn.lock`)
Application: React 19.0.0, React Router 7 (`BrowserRouter`), Tailwind 3.4.17
Tests at investigation time: Jest through Create React App / CRACO
Build at investigation time: `react-scripts` 5.0.1 via `@craco/craco`
Deploy assumption: static files from `frontend/build`, served by Nginx or Caddy with an SPA fallback

No dependencies were changed before this audit. `npm audit fix --force` was not used.

## What the toolchain actually was

`react-scripts` and `cra-template` were listed as production dependencies. Yarn therefore counted the entire Create React App, Webpack, Jest, and ESLint tree as production. The browser application does not import `braces` or `sprintf-js`.

Client-visible variables already in source:

| Variable | Role |
| --- | --- |
| `REACT_APP_BACKEND_URL` | API origin baked into the browser bundle |
| `REACT_APP_MAPBOX_PUBLIC_TOKEN` | Mapbox public `pk.` token |
| `REACT_APP_TRACKING_MODE` | `simulated` or `live` |

Server and developer variables that must stay out of the bundle: `MAPBOX_TOKEN`, `JWT_SECRET`, `OWNER_PASSWORD`, `DEV_API_PROXY`, `ENABLE_HEALTH_CHECK`.

## Audit before migration

Command: `corepack yarn audit --level moderate --groups dependencies`
Result: **18 vulnerabilities, 10 high, 8 moderate, 1455 packages**. Exit code 12 means findings, not a crash.

| Package | Count | Advisory | Severity | Direct? | Parents under `react-scripts` | Fix | Where it runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| braces 3.0.3 | 10 | [1240992](https://www.npmjs.com/advisories/1240992) | high | transitive | `micromatch` via `eslint-webpack-plugin`, `jest-resolve`, `jest-haste-map`, `babel-jest` / `@jest/transform`, `@jest/reporters`, and `jest-config` | none (`<0.0.0`) | Webpack and Jest only |
| sprintf-js 1.0.3 | 8 | [1241202](https://www.npmjs.com/advisories/1241202) | moderate | transitive | `jest > babel-plugin-istanbul > @istanbuljs/load-nyc-config > js-yaml > argparse` | none (`<0.0.0`) | Jest coverage config only |

Yarn counted one finding per dependency path, so the same two packages appear 10 and 8 times. `react-scripts` 5 has no release that drops either chain. A Yarn resolution cannot select a patched version when the advisory says none exists.

## Exploitability in this application

Neither package is in the booking, authentication, or media code. `braces` 3.0.3 can exhaust the stack on a deeply nested glob. `sprintf-js` 1.0.3 accepts an unbounded precision value while Jest reads coverage config. A visitor cannot send input into those functions through the public site. The practical exposure is a developer machine or CI job. That is still worth removing, because both packages were installed on every production `yarn install`.

## Why Vite removes these chains

Replacing `react-scripts` removes Jest, Webpack, and the Istanbul coverage loader. That removes every `sprintf-js` path and every Create React App `braces` path. It does not remove every `braces` install on earth: Tailwind 3 still uses `chokidar` and `fast-glob` while compiling CSS. Those copies stay dev-only after the migration. Replacing Tailwind to chase an unpatched dev tool would be a redesign, so it was not done.
