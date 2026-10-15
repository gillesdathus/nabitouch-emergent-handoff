# Nabitouch launch completion handoff

Local development record for `feature/nabitouch-launch-completion`. This document does not authorize a production change, deployment, merge, or public cutover.

## 1. Branch and commit

The completion work is on `feature/nabitouch-launch-completion`. The commit that introduces this document is the completion commit. It is local only and has not been pushed.

Verified ancestors:

- Production baseline `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f`
- Slice 1 service catalogue `63a644dd0b7630a03ff965205d0ace152688822e`
- Slice 2 secure photos `22d50b37dce7ab20fcbd907e272acdeaae1a94ae`

`22d50b37dce7ab20fcbd907e272acdeaae1a94ae` already contained Slice 1. No slice was overwritten.

## 2. What changed

Practitioner profiles, service publication, and booking checks were added on top of the existing catalogue, credential, availability, and `nt_media` paths.

- `backend/profiles.py` — profile visibility, public presentation, owner and self edits, booking eligibility.
- `backend/catalog.py` — draft, preview, published, and archived publication. An archived row stays hidden.
- `backend/server.py` — profile and publication routes, public state filtering, server-side practitioner checks.
- `backend/availability.py` — a selected practitioner is checked again when a slot is reserved.
- `backend/media.py` — profile visibility controls whether a photo is public. Orphan detection is available for backups.
- `frontend/src/pages/client/PractitionerProfile.jsx` — public profile at `/practitioners/:slug`.
- `frontend/src/pages/practitioner/Profile.jsx` — practitioner self-edit and the owner field set.
- `frontend/src/pages/owner/Manage.jsx` — publication actions and the owner profile editor.
- Tests in `backend/tests/test_profiles.py` and updates to booking fixtures that named a practitioner for a treatment they do not offer.

The uncommitted release runbook and the three credential scripts are not part of this commit.

## 3. API routes

Owner only:

- `POST /api/services/{id}/draft`
- `POST /api/services/{id}/preview`
- `POST /api/services/{id}/publish`

Signed-in owner, or the practitioner for their own record:

- `PUT /api/practitioners/{id}/profile`

Public when the profile is published. The owner, desk, and that practitioner can also read a draft or hidden profile:

- `GET /api/practitioners/{id-or-slug}`

Publication and profile writes ignore browser-supplied actor names. The audit actor is the authenticated account.

A published profile does not approve registration, insurance, hours, or booking. Booking still requires a published treatment, a practitioner who offers that treatment, current availability, and, once onboarding is approved, unexpired registration and liability insurance.

## 4. Database

Additive fields and indexes. No production migration was run.

- `nt_services.publication`: `draft`, `preview`, `published`, or `archived`. Existing rows without the field stay published when they are enabled and not archived.
- `nt_practitioners.profileVisibility`, `designation`, `experience`, `qualifications`, `displayOrder`, `slug`.
- Unique indexes already created on API startup in local validation: `service_id_unique`, `service_slug_unique`, `media_id_unique`, `media_subject`, and sparse `practitioner_slug_unique`.
- Appointment and invoice prices remain the snapshots stored at booking.

Starting this API against production would create those unique indexes on startup. Take a backup before any such start. An application-image rollback does not remove indexes, publication fields, profile fields, or `nt_media` documents.

## 5. Automated tests

Local validation API and database only.

- Backend: 213 passed, 0 skipped, 1 existing Starlette deprecation warning.
- Frontend: 23 passed, 8 suites.

`tests/test_replica_transactions.py` runs against the local validation replica when `MONGO_URL` contains `replicaSet=` and does not name `nabitouch_prod`. An explicit `REPLICA_MONGO_URL`, or `APP_ENV=production`, keeps those tests off the production database. On the local replica, four tests passed: an aborted transaction leaves no ledger or invoice row, a version conflict does not post a second ledger line, one of two concurrent payments with the same idempotency key is stored, and a service write plus its audit commit together. A failed write leaves neither row. When the audit insert hits an existing audit id, the service insert from that same transaction is rolled back.

The ten existing local services and four practitioners were copied into a throwaway database on that same replica. No duplicate service id, service slug, practitioner slug, or media id was present. `service_id_unique`, `service_slug_unique`, sparse `practitioner_slug_unique`, `media_id_unique`, and `media_subject` were created on the copy and the copy was dropped. Production was not contacted.

The earlier welcome-offer concurrency failure was contaminated test data for two fixed email addresses. The test now uses a fresh identity, and exactly one of two concurrent eligible bookings receives the discount. Eligibility rules were not weakened.

## 6. Browser acceptance

Checked against the local validation API through a temporary development proxy. The proxy file is not part of the commit.

- Public profile `/practitioners/maya-chen` shows the name, biography, offered treatments, booking action, and the title `Maya Chen · Nabitouch`.
- The same page fits a narrow viewport without horizontal overflow.
- Owner People & Services shows publication status, Preview, and Move to draft on published treatments, plus Edit profile on practitioner cards.
- A signed-out guest completed a mobile booking in the browser. The selected Mapbox line was `10150 104 Street NW, Edmonton, Alberta T5J 1A7, Canada`. Confirming that line with its own postal `T5J 1A7` returned confidence `address`, Central Edmonton, and travel included.
- A different postal on that same civic line stays unconfirmed. The form keeps Continue disabled for that result.
- The acceptance visit is reference `NT-1931`: Swedish Massage, 60 minutes, Sunday 18 October 2026 at 9:00 AM, practitioner `p-maya` (Maya Chen), status `assigned`. The review quote, confirmation screen, and stored pricing match: treatment $120.00, welcome discount $24.00, GST $4.80, total $100.80, code `WELCOME20`.
- A draft invoice for that visit copies the snapshot: treatment 12000 cents, welcome offer −2400 cents, tax 480 cents, total 10080 cents, practitioner `p-maya`. The later regression suite calls demo reset, which clears appointments in the local validation database. `NT-1931` is no longer stored there. The confirmation screen and the invoice snapshot were read before that reset.
- An earlier guest on the same address used a phone that already held a welcome claim from 13 October 2026. The provisional review showed the discount, and the saved visit `NT-1930` was repriced without it: $120.00, GST $6.00, total $126.00. The address itself was a precise civic match. Eligibility was not changed.

## 7. Security and media

- Anonymous callers receive 404 for a hidden profile and for that profile's photo.
- A practitioner cannot edit another practitioner.
- A client cannot edit a practitioner profile.
- A practitioner cannot set visibility, approval, or availability through the profile editor.
- Private media responses use `Cache-Control: private, no-store`.
- Deleting a photo removes anonymous and owner access.
- An orphan `nt_media` row can be detected, copied, and restored in the local database.
- Clinical document uploads stay behind `DOCUMENT_UPLOADS_ENABLED`. This work does not turn that flag on.
- The original ten services still use their static `/img` photos until an owner replaces one.

## 8. Remaining limits

- Mapbox can return an approximate result for a real Edmonton street. The booking form will not confirm that address. That is existing address verification, not a catalogue defect.
- Preview in the owner screen is an action on a real catalogue row. It was not clicked on the ten seed treatments during browser testing, so those rows stayed published.
- The replica-transaction tests still skip when the process is not attached to a non-production replica set. They passed on the local validation replica.
- Canadian privacy and health-information obligations are not certified here. Legacy patient collections, retention, and access still need a qualified review before any claim of compliance.

## 9. Production actions that still need separate authorization

Do not run these as part of this branch.

| Action | Authorization required |
| --- | --- |
| Insert the approved WELCOME20 promotion into `nabitouch_prod` | Explicit production data change |
| Publish the cancellation policy and business contact fields | Explicit production content approval |
| Onboard a real practitioner | Owner approval of registration, insurance, and hours in production |
| Confirm the scheduling buffer | Owner confirmation of the live schedule rules |
| Deploy this commit to the private `nt-next` API | Explicit private-release authorization, after a backup |
| Create the additive indexes on production | Included in the first start of this API; backup first |
| Public website cutover | Explicit public launch authorization |
| Enable document uploads or card checkout | Separate authorization; both stay off |

## 10. Release recommendation

**NO-GO** for production deployment, production configuration, merge to the default branch, and public booking.

Local acceptance passed: 213 backend tests, 23 frontend tests, four replica-set transaction tests, the browser booking `NT-1931`, media backup and restore, and unique indexes on a copy of the local catalogue. That does not authorize a release. The private deployment remains on `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f`.
