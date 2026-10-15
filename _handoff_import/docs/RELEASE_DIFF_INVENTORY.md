# Release diff inventory

Compared on 13 October 2026. Development branch `feature/nabitouch-launch-completion`. Starting HEAD `67b61e925766dffc6f7570d5e263a240ec2ee970`. Deployed private API baseline `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f`. Remote `origin` is `https://github.com/gillesdathus/nabitouch-mobile`. This inventory does not authorize a push, merge, or deploy.

## Ancestry

`9aca5ec` welcome-offer preparation, then `63a644d` service catalogue audit, `22d50b3` photo storage, `850fc01` unpublished booking exclusion, `4df0e76` replica and booking record, `67b61e9` audit-record rollback. No files were removed in `9aca5ec...67b61e9`.

## Diff at the start of this run

`git diff --stat 9aca5ec...HEAD` reported 31 files, 3181 insertions, 89 deletions.

Added:

- `backend/catalog.py`, `backend/media.py`, `backend/profiles.py`
- `backend/tests/test_media.py`, `backend/tests/test_profiles.py`, `backend/tests/test_service_catalog.py`
- `docs/LAUNCH_COMPLETION_HANDOFF.md`
- `frontend/src/lib/catalog.test.js`
- `frontend/src/pages/client/PractitionerProfile.jsx`
- `frontend/src/pages/practitioner/Profile.jsx`

Modified: availability, requirements, server, replica and slice tests, App routes, client shell and cards, API client, domain helpers, booking steps, public pages, and owner manage.

## Dependencies and environment

The only new Python dependency is `pillow==11.3.0`. `python -m pip check` inside the validation API reported no broken requirements. Frontend `package.json` remains version `0.1.0` (React 19.0.0, react-scripts 5.0.1). There is no ESLint or TypeScript check script. Yarn audit reported 18 vulnerabilities (8 moderate, 10 high), including `braces` and `sprintf-js` with no compatible patch on the current react-scripts toolchain. No major upgrade was applied.

No new production environment variable is required to boot the existing private API. Production validation already requires `DOCUMENT_UPLOADS_ENABLED`, `STRIPE_CARD_CHECKOUT_ENABLED`, and `LEGACY_PATIENT_IMPORT_ENABLED` to be explicit. The local preview turned the first two on for development only. Those preview values must not be copied to production.

## Behaviour added since the deployed baseline

- Catalogue create, draft, preview, publish, archive, restore, delete, and price edits, with owner audit rows.
- Publication: legacy enabled rows stay public; archived wins; draft and preview stay off the public catalogue.
- Practitioner profile read and owner/self update. Public booking requires a published, available, bookable profile.
- Media upload, replace, and delete for service photos and practitioner gallery items, re-encoded and stripped of metadata.
- Replica transactions for catalogue writes, including rollback when the audit id already exists.

## Unintended changes

No debug identities, fake production credentials, or hardcoded production URLs were found in the committed diff. The local dev proxy `frontend/src/setupProxy.js` was recreated for browser testing and deleted before commit. Credential helper scripts and the uncommitted production runbook were not read, staged, or committed.

One local code correction was made after the starting SHA: the public client shell clips horizontal overflow. See the overnight report for the measurement.
