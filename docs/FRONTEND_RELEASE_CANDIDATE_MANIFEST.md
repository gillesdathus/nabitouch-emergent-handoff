# Frontend release candidate manifest

14 October 2026. This manifest compares the deployed private API baseline with the local candidate. It does not authorize a deploy.

## Baseline

Deployed private API: `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f`
Candidate branch: `feature/frontend-vite-security-migration`
Candidate SHA: `20c101cb5b1d4d9d1e8c9918b0c198dcd47645bd`

The candidate is ahead of the baseline. It has not been pushed or installed.

## Deployment source

Check out the complete tree `6f67bcd23767d366942b2d3848a1f336f1fd06a8` or a later commit on this branch whose diff from that SHA is only documentation and `deploy/private-release/`. Do not deploy from `20c101c` alone: that checkout omits the release records. Do not build from `/opt/nt-next`; that directory is not this git tree.

`20c101c` is the last commit that changes application code. The API image and the frontend bundle built from the complete tree match that code because later commits do not change `backend/` or `frontend/src`.

## Commits after the deployed baseline

These were already on the branch before this hardening pass:

| SHA | Subject |
| --- | --- |
| `63a644d` | Record service catalogue changes from the signed-in owner |
| `22d50b3` | Keep treatment and practitioner photos separate from insurance documents |
| `850fc01` | Keep unpublished profiles and treatments out of public booking |
| `4df0e76` | Record the local replica and booking acceptance without authorizing a release |
| `67b61e9` | Roll a catalogue write back when its audit record cannot be saved |
| `0cbbeb8` | Keep the public pages from scrolling sideways on a phone |
| `c0fa16a` | Record the overnight release-readiness evidence without authorizing a release |
| `5f19edc` | Replace Create React App with Vite so the production install drops the unpatched Jest and Webpack advisories |
| `1bc0983` | Record the Vite migration SHA in the frontend handoff |

The hardening commit that follows `1bc0983` is the candidate SHA above.

`git diff --stat 9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f..1bc0983` was 54 files, +7210 / −10467, before the hardening commit. The largest frontend change in that range is the Vite migration: `react-scripts` and CRACO leave, `frontend/build` remains the static output, and the production dependency audit goes to 0 findings. Backend changes in that range add catalogue audit, media, and profile rules. They are not repeated here.

## What this hardening adds

| Area | Difference from `1bc0983` |
| --- | --- |
| Production frontend build | Refuses an empty, localhost, private, or non-https API origin, and refuses `sk.` or other non-`pk.` Mapbox tokens |
| Browser feature flags | Card checkout and document upload UI follow boolean `true` only |
| API defaults | Unset upload, card, and legacy-import flags stay off. Production still requires an explicit value |
| Rewards | Request body cannot turn rewards, referrals, or NabiDerm on |
| Clinic booking | Enabled-but-placeholder clinic addresses are refused |
| Tests | Vitest 4.1.11. Frontend suite is 42 tests. The two moderate Vitest advisories are gone |
| Removed | `frontend/plugins/health-check/`, which nothing referenced after the Webpack config was deleted |
| Still open | Two high `braces` findings under Tailwind, with no upstream patch |

## What a private deploy would ship

- Frontend: the Vite `frontend/build` directory, built with `https://nabitouch.com` and a public `pk.` token.
- API: the candidate source, with `deploy/env.hostinger.example` values. Uploads, card checkout, and legacy import stay `false`.
- Not shipped: the preview env file that sets those three flags to `true`, source maps, or the local `pk.public-build-check` placeholder.

## Not in this candidate

The uncommitted release runbook and the three credential scripts are not part of the diff. Production MongoDB, Nginx, DNS, and the running private API were not changed.
