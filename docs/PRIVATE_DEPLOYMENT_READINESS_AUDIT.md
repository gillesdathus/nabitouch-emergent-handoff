# Private deployment readiness audit

14 October 2026. This audit prepares a future private deployment. It does not authorize one. Nothing was pushed, merged, deployed, or written to a production database.

## Release identity

| Item | Value |
| --- | --- |
| Branch | `feature/frontend-vite-security-migration` |
| Application code SHA | `20c101cb5b1d4d9d1e8c9918b0c198dcd47645bd` |
| Hardening record | `f35add295f5b18a7ec9dc9020b6b2c8c33975061` |
| This audit | documentation only; it does not change the runtime |
| Deployed private API, unchanged | `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f` |

`9aca5ec` is an ancestor of `20c101c`. `20c101c` is an ancestor of `f35add2`, which is an ancestor of this audit. `git diff --name-only 20c101c..f35add2` is only:

- `docs/FRONTEND_RELEASE_HARDENING_HANDOFF.md`
- `docs/FRONTEND_RELEASE_CANDIDATE_MANIFEST.md`

Those edits record the hardening SHA. `deploy/Dockerfile.api` copies `backend/` only. The frontend bundle does not include `docs/`. A build from the tip and a build from `20c101c` therefore contain the same application code.

Include this audit in the eventual checkout. Tag the API image and the static-file release with the audit SHA, and record `20c101c` as the last commit that changed runtime code. Checking out only `20c101c` would omit the handoff that names that SHA. Commits after `20c101c` change documentation only.

`git diff --stat 9aca5ec..20c101c` is 70 files, +7815 / −10865. The uncommitted release runbook and the three credential scripts are not in either SHA.

## 1. Release integrity

Verified on this machine:

| Check | Result |
| --- | --- |
| Ancestry | `9aca5ec` → `20c101c` → `f35add2` |
| Code trees | Tip differs from the candidate only in the two handoff files above |
| `corepack yarn install --frozen-lockfile` | Exit 0. Lockfile matches `frontend/package.json` |
| Production rebuild | Exit 0, 27.40s. Main chunk `index-Jbd7A9zo.js` and Mapbox chunk `MapboxLiveMap-ybShPzFS.js` match the hardening handoff |
| Yarn resolution warnings | `postcss-selector-parser@7.1.6` vs Tailwind `^6`, and `@eslint/plugin-kit@0.3.4` vs `^0.2.7`. Both are the published fixes. CSS still builds |

`backend/requirements.txt` pins FastAPI, Starlette, Uvicorn, PyMongo, Motor, bcrypt, Pillow, and httpx. Other Python packages use minimum versions. Rebuilding the API image on a later day can install newer transitive packages. Rollback must use the image digest that was running, not a fresh build of an old SHA.

The local machine has no `nt-next-api` image. The previously recorded host images stay in `docs/BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md`. This audit did not inspect or retag the VPS.

## 2. Database compatibility

There is no separate migration runner. Startup calls `create_index` and the catalogue, media, profile, billing, clinical, legacy, and notification helpers. New indexes and fields are additive. The deployed SHA does not create `service_id_unique`, `service_slug_unique`, `practitioner_slug_unique`, `media_id_unique`, or `media_subject`. The candidate does, on first boot.

Catalogue and practitioner photos are BSON `data` and `thumb` on `nt_media`. `GET /api/media/{id}` serves `data`, or `thumb` when `size=thumb`. A document that only has some other field is not a photo the API can return. Clinical uploads, when the flag is on, are BSON on `nt_files`. A `mongodump` of the application database covers both. The old Hostinger uploads volume is a different store and is described in `docs/BACKUP_RESTORE.md`. It was not copied.

Appointment prices are stored on the appointment. `lines_from_pricing` copies that pricing into invoice lines when the invoice is drafted. GST is stored as `taxCents`. It is not a separate line unless the copied total does not match the lines. A later catalogue edit does not rewrite those documents.

Indexes added since `9aca5ec` are `service_id_unique`, `service_slug_unique`, sparse `practitioner_slug_unique`, `media_id_unique`, and `media_subject`. Billing, clinical, legacy, notification, and the lifespan indexes in `server.py` already exist at the deployed SHA. `service_slug_unique` is not sparse: two services with a missing slug cannot boot. Missing practitioner slugs are allowed. A service with no `publication` field stays on the public catalogue when it is not archived and `enabled` is not false. Draft and preview apply only after that field is set.

Isolated drill, database `nabitouch_preview_validate` on `nt-validate-mongo` only. Production was not contacted. The container was stopped afterward. Representative rows already in that database:

| Check | Source | Restore `nabitouch_restore_audit` |
| --- | --- | --- |
| Collections | 54 | 54, none missing |
| Documents restored | | 3052, 0 failed |
| `nt_services` | 10 | 10 |
| `nt_practitioners` | 4 | 4 |
| `nt_appointments` | 17 | 17 |
| `nt_invoices` | 1 | 1 |
| `nt_audit` | 34 | 34 |
| `nt_files` | 0 | 0 |
| Duplicate service ids | 0 | |
| Duplicate service slugs | 0 | |
| Services missing a slug | 0 | |
| Practitioners missing a slug | 4 | allowed, sparse index |
| Replica set | `rs0` | indexes restored with the data |

All 10 services are legacy rows: no `publication` field, none archived, so the candidate treats them as published. None has `imgMediaId`. Nabitu count is 0. `promo-welcome` is present, code `WELCOME20`, type percent, value 20, enabled, approval `approved`. The clinic record is enabled and its address is still a placeholder, so `clinic_is_bookable` is false.

Draft invoice `inv-69c083e2bbd6` for appointment `NT-2033` stores base 120, discount 24, travel 0, tax 4.80, total 100.80, promo `promo-welcome`. Lines are Treatment `12000` and First-booking welcome offer `-2400`. `taxCents` is 480 and `totalCents` is 10080. On the restore database only, all 10 service `prices.60` values were set to 999. The invoice lines, tax, and total stayed the same. The preview catalogue was not edited.

A private probe `media-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` was inserted with `public: false`, a 10-byte `data` value, and an 11-byte `thumb`. Both fields matched after restore. The probe was then deleted. The restore database was dropped. The archive was removed from the container. Preview service prices were unchanged (`nt_services` still 10).

### Preflight, later and only when authorized

Do not run this against production from this audit. Export `MONGO_URL` and `DB_NAME` on the server first. Refuse to continue if the database name is not the intended private database.

```bash
mongosh "$MONGO_URL" --quiet --eval "
const d = db.getSiblingDB(process.env.DB_NAME);
const hello = d.hello();
if (hello.setName !== 'rs0') quit(2);
const slugs = d.nt_services.aggregate([{\$group:{_id:'\$slug', n:{\$sum:1}}}, {\$match:{n:{\$gt:1}}}]).toArray();
const ids = d.nt_services.aggregate([{\$group:{_id:'\$id', n:{\$sum:1}}}, {\$match:{n:{\$gt:1}}}]).toArray();
const people = d.nt_practitioners.aggregate([{\$match:{slug:{\$type:'string', \$ne:''}}}, {\$group:{_id:'\$slug', n:{\$sum:1}}}, {\$match:{n:{\$gt:1}}}]).toArray();
print(JSON.stringify({
  set: hello.setName,
  services: d.nt_services.countDocuments({}),
  missingServiceSlug: d.nt_services.countDocuments({\$or:[{slug:{\$exists:false}},{slug:null},{slug:''}]}),
  practitioners: d.nt_practitioners.countDocuments({}),
  media: d.nt_media.countDocuments({}),
  appointments: d.nt_appointments.countDocuments({}),
  invoices: d.nt_invoices.countDocuments({}),
  duplicateServiceIds: ids.length,
  duplicateSlugs: slugs.length,
  duplicatePractitionerSlugs: people.length,
  nabitu: d.nt_practitioners.countDocuments({id:'p-nabitu-kahindo'}),
  welcome: d.nt_promotions.countDocuments({id:'promo-welcome'})
}));
"
```

Stop if `duplicateServiceIds`, `duplicateSlugs`, or `duplicatePractitionerSlugs` is not 0, or if `missingServiceSlug` is greater than 1. The new unique indexes would then prevent the API from finishing startup. Do not drop those documents as part of boot. Practitioner documents with no slug are compatible with the sparse index.

`nabitu` should be 0. `welcome` records whether the approved `promo-welcome` document is already stored. Its presence is expected when the launch seed has been applied. It is not a reason to delete the promotion.

## 3. Backup and rollback

### Database

Take the archive only after authorization, and not onto the application container's writable layer.

```bash
mongodump --uri "$MONGO_URL" --db "$DB_NAME" --archive=nabitouch.archive.gz --gzip
mongorestore --uri "$MONGO_URL" --nsFrom "$DB_NAME.*" --nsTo "${DB_NAME}_restore.*" --archive=nabitouch.archive.gz --gzip
```

Compare collection counts, index names, one invoice `totalCents`, and one media `id` plus `public`, `data` length, and `thumb` length. Drop only `${DB_NAME}_restore`. Keep `FIELD_ENCRYPTION_KEY` apart from the archive. The archive holds ciphertext for insurance numbers, clinical text, and uploaded files. Restoring without that key does not make those fields readable.

This local drill used an unauthenticated preview database. It does not replace the production archive. The second drill restored 3052 documents with 0 failures, then dropped `nabitouch_restore_audit`.

### Media

New photos travel inside the same `mongodump`. Compare `data` and `thumb`, not an unused field. There is no second file tree for `nt_media`. The old site's uploads directory, if it still exists on the VPS, is a separate tar, encrypt, checksum, and shred sequence in `docs/BACKUP_RESTORE.md`. Do not open those files during the count check.

Anonymous callers only receive a photo when `public` is true. An owner can read a private photo. A practitioner can read a private practitioner or gallery photo only when `subject` matches `subjectId`. Anyone else receives 404. That HTTP check has not been repeated in this pass.

### API image

Before changing the running container, record `docker image inspect` for the current image and for `nt-next-api:9aca5eccdc3c`. The rollback image already recorded on the host is `nt-next-api:rollback-0081eac25d1e` (`sha256:0081eac25d1edc251fb45d46ac8351008fffad0afbe5fe87eb9882f59745f7b6`). Rollback starts that image, or the `9aca5ec` image, with the existing environment file. Do not rebuild it from today's `pip`.

This machine has no `nt-next-api` tag, so those host digests were not started. A local procedure drill did run: a throwaway container on `127.0.0.1:18081` was started from `python:3.12-slim` (`sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1`), stopped, and replaced with `python:3.12` (`sha256:63828510c8b5ccce3bf0d6fabd6f3d17d4effa1ffe690f80a67c8e2d394e03ee`). The image ids differed and the replacement answered HTTP 200. The container was removed. That validates the swap. It does not boot the private API.

### Frontend static files

Before replacing the web root, tar the whole current directory. Copy `frontend/build` as a directory. `index.html` names the hashed files in `assets/`. Rollback replaces the whole directory from the tar. Do not leave a new `index.html` pointing at assets that were deleted, and do not cache `index.html` or `sw.js`.

Local drill, outside the repo: a copy of `frontend/build` was broken so `index.html` pointed at `/assets/missing-rollback.js`. Replacing that directory with the previous copy restored `/assets/index-Jbd7A9zo.js` and `/assets/index-Du28SQqu.css`, and `sw.js` was present. The temporary copies were deleted. Nginx was not changed.

`deploy/frontend-static.example.conf` is still commented and was not installed.

### Database after an application rollback

Leave the new indexes, extra document fields, and `nt_media` rows in place. On the restore database, the 16 index creations from the deployed lifespan and billing/MFA paths all succeeded, and `service_id_unique`, `service_slug_unique`, `practitioner_slug_unique`, `media_id_unique`, and `media_subject` were still there afterward. The deployed SHA does not read `nt_media`. Historical appointment prices and invoice lines stay as stored. Do not drop `nabitouch_prod` to make the old image comfortable.

Restore the database from the pre-change archive only with a second confirmation, and only into a reviewed database name until that confirmation names an overwrite.

### Limitations

- Redis is not in the dump. Tracking keys expire. Invoices do not live there.
- A standalone MongoDB cannot commit the catalogue and its audit in one transaction. Production is a replica set named `rs0`.
- `mongorestore --drop` is for the restore database name only.
- The preview drill contained demo rows, including `NT-2033`. It is not a production count.
- Legacy services with no `publication` field remain public when they are enabled. Hiding one requires setting `publication` to draft, preview, or archived.
- The API image swap used local Python images. It did not start `nt-next-api`.
- Encryption-key loss makes the clinical ciphertext in an archive unreadable.

## 4. Deployment configuration

Reviewed from source. No live file was changed.

| Item | Requirement |
| --- | --- |
| API environment | `deploy/env.hostinger.example`. `APP_ENV=production`. `APP_URL` and `CORS_ORIGINS` are `https://nabitouch.com` |
| Frontend origin | Build with `REACT_APP_BACKEND_URL=https://nabitouch.com`. The build refuses localhost, private hosts, empty values, and `sk.` tokens |
| Mapbox | Server `MAPBOX_TOKEN` stays in the API env. The browser receives only a different `pk.` token restricted to `https://nabitouch.com` and `https://www.nabitouch.com` |
| Flags | `DOCUMENT_UPLOADS_ENABLED=false`, `STRIPE_CARD_CHECKOUT_ENABLED=false`, `LEGACY_PATIENT_IMPORT_ENABLED=false`. Unset now means off. Production still refuses to boot if they are unset |
| MongoDB | `mongo:7`, replica set `rs0`, auth, key file, no published host port in `deploy/docker-compose.hostinger.yml` |
| Redis | `rediss://` with a password and TLS certs. Not the financial record |
| Health | Container check requests `http://127.0.0.1:8000/api/health`. The JSON includes `mongo`, `redis`, `documentUploads`, and `cardCheckout` |
| Nginx | Not reloaded. The inactive example uses `try_files` to `index.html`, immutable cache for `/assets/`, and `no-cache` for `index.html` and `sw.js`. `/api/` proxies to `127.0.0.1:8011` |
| Logs | Compose uses json-file, 10m, 3 files. Sentry is not configured. `docs/INTEGRATIONS_MATRIX.md` still lists it as incomplete |
| Public booking | Stays off until a separate decision. This audit does not enable it |

Do not copy the isolated preview env file. That file sets the three restricted flags to `true`.

## 5. Acceptance checklist

| Check | Already verified locally | Must be repeated after a private deploy |
| --- | --- | --- |
| Owner MFA | Not verified. Local demo login does not ask for a TOTP. Production refuses `DEMO_MODE=true` | Sign in as the owner and confirm the authenticator gate before any staff-MFA change |
| Service catalogue | Preview has 10 legacy services, no `publication` field, no duplicate id or slug, and no uploaded photo. The candidate treats those rows as published. Draft and preview stay off the catalogue only after `publication` is set | Confirm which private services are intended to be public. A legacy enabled row will be bookable |
| Practitioner profiles | Four practitioners, none with a slug. Nabitu count is 0. Sparse slug index accepts the missing slugs | Confirm the private roster and that Nabitu is still absent |
| Booking and geocoding | Mapbox address confirmation and a server quote succeeded on the preview during migration. Not repeated in this pass | One private booking on the new stack, then void or retain it under the owner's instruction |
| WELCOME20 | `promo-welcome` is enabled and approved at 20 percent. `NT-2033` stored discount 24 on a 120 treatment | Same figures on the private stack for a first online booking |
| GST | That draft stores tax 4.80 as `taxCents` 480. There is no separate GST line | Same `taxCents` and `totalCents` on the private stack |
| Invoice snapshots | `NT-2033` lines stayed 12000 and −2400, `totalCents` 10080, after every restored service price was set to 999 | Issue one private invoice and confirm the lines do not change after a catalogue edit |
| Media authorization | Private `data` and `thumb` survived dump and restore and stayed `public: false`. HTTP authorization was not called in this pass | Confirm a private photo URL returns 404 without a session and 200 for the owner |
| Restricted features | With flags false, checkout and card intent returned 503 and uploads returned 403 in the hardening pass. Rewards cannot be authorized by the request body. The preview clinic is enabled with a placeholder address, so in-clinic booking is refused | Health on the private API must show `documentUploads: false` and `cardCheckout: false` |
| Rollback readiness | Restore, old-index replay, static directory swap, and a local image swap all succeeded. The production API image is not on this machine | Record the pre-change archive checksum and the running image id before the container is replaced |

## 6. Residual risk

Two high `braces` findings remain, both build-time, both unpatched:

| Package | Advisory | Path |
| --- | --- | --- |
| braces 3.0.3 | 1240992 | `tailwindcss > chokidar > braces` |
| braces 3.0.3 | 1240992 | `tailwindcss > fast-glob > micromatch > braces` |

They are not in the browser bundle. The production Yarn graph audited at 0 findings. A visitor cannot send a glob into Tailwind. The practical exposure is the machine that runs `yarn build` or the API image build. Build that machine from the lockfile, without the preview env file and without production secrets in the frontend environment. `REACT_APP_` is limited to the API origin, the public Mapbox token, and the tracking mode.

Additional release risks:

- Python packages that are not exact pins can change if the image is rebuilt later.
- Unique indexes will refuse to boot if production already has duplicate service or practitioner slugs. That preflight has not been run.
- Production owner MFA is still untested.
- No error-monitoring account is configured. Container logs rotate at 10m by 3 files.
- The Mapbox chunk remains about 538 kB gzip. It was not split.
- Preview data still has an enabled clinic with a placeholder address. The API refuses that booking. The stored flag was not edited, and it is not production data.

## 7. Authorization checklist

Private deployment stays **NO-GO** until the owner checks every line.

1. Accept the audit checkout, with application code `20c101cb5b1d4d9d1e8c9918b0c198dcd47645bd`.
2. Run the production preflight above and stop if any duplicate slug count is not zero.
3. Take a fresh `mongodump` of the identified production database. Store it outside the app container. Store `FIELD_ENCRYPTION_KEY` separately. Restore it to a new database name and compare counts. Drop only that restore database.
4. Build the API image from this checkout and tag it with the tip SHA. Keep the current image id for rollback.
5. Build the frontend with `REACT_APP_BACKEND_URL=https://nabitouch.com` and the URL-restricted `pk.` token. Confirm the bundle has no `sk.` token and no localhost API origin.
6. Start the new API only on the private stack, with the three restricted flags set to `false`, `DEMO_MODE` off, and Redis on `rediss://`.
7. Read `/api/health`. Require mongo and redis ok, and both feature flags false.
8. Complete owner MFA on that stack before any DNS or Nginx change.
9. Run the post-deploy column of the acceptance checklist.
10. Leave public booking off unless a later decision says otherwise.

Rollback, if that deploy is authorized and then fails: put the previous API image back, put the previous static directory back, and leave the database in place. Do not drop it.

## Recommendation

| Gate | Result |
| --- | --- |
| Release identity and reproducible frontend build | GO for a later authorized build |
| Isolated database backup, restore, and local rollback drills | GO. Production image was not on this machine |
| Production preflight and production backup | Not run. Required before any deploy |
| Private deployment | NO-GO |
| Public launch | NO-GO |
