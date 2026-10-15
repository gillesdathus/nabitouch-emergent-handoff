# Overnight release readiness report

Date: 13 October 2026. Branch `feature/nabitouch-launch-completion`. No push, merge, deploy, production write, public booking activation, or credential change was performed.

## Executive summary

Local automated tests passed, and the local browser covered the public catalogue, an owner catalogue cycle, a practitioner self-edit, and two guest bookings. One public-page overflow was fixed and rechecked. Production configuration, the private deployment, and public launch stay unauthorized.

Detailed artifacts:

- `docs/RELEASE_DIFF_INVENTORY.md`
- `docs/OVERNIGHT_SECURITY_FINDINGS.md`
- `docs/BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md`
- `docs/CONFIGURATION_CHANGE_MANIFEST.md`
- `docs/PRIVACY_READINESS_GAP.md`

## Repository

| Item | Value |
| --- | --- |
| Starting branch | `feature/nabitouch-launch-completion` |
| Starting HEAD | `67b61e925766dffc6f7570d5e263a240ec2ee970` |
| Deployed private API | `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f` |
| Remote | `origin` `https://github.com/gillesdathus/nabitouch-mobile` |
| Diff versus deployed baseline at start | 31 files, +3181 / −89, nothing removed |

Left untouched: `docs/PRODUCTION_RELEASE_RUNBOOK.md`, `deploy/apply-owner-password.py`, `deploy/reset-owner-password.sh`, and `deploy/set-resend-credentials.sh`. Those credential scripts were not read, executed, staged, or committed. `frontend/src/setupProxy.js` was used for the local browser and deleted before commit.

Application versions: frontend `0.1.0`, React `19.0.0`, react-scripts `5.0.1`. New backend pin: `pillow==11.3.0`. `pip check` reported no broken requirements.

The public-shell correction is `0cbbeb801900079b89baea8b86152bd8b570a163`. These readiness documents are the following commit. The branch tip after that commit is the local candidate. It was not tagged and it was not pushed.

## Automated tests

These counts were produced on this overnight run. They are not copied from an older handoff.

| Suite | Result | When |
| --- | --- | --- |
| Backend `pytest tests -n 0` | 213 passed, 0 skipped, 1 Starlette deprecation warning, 106.51 s, exit 0 | Earlier this run, before the shell change |
| Replica file | 4 passed, 2.43 s, exit 0 | Earlier this run |
| Frontend `yarn test --watchAll=false` | 23 passed, 8 suites, 23.187 s, exit 0 | After the shell change |
| Frontend `craco build` | Compiled successfully, exit 0, 106.34 s | After the shell change |

Frontend console noise: `AddressPicker.test.js` prints existing `act(...)` warnings. No test failed.

The production bundle is gitignored. Main assets: `build/static/js/main.b232ef38.js` (187.73 kB gzip) and `build/static/css/main.f42d082f.css` (15.11 kB gzip).

Yarn audit: exit 12, 18 vulnerabilities (8 moderate, 10 high). No compatible patch was applied. Secret scanning found fixture and template markers only. Values were not printed. The uncommitted runbook was not opened.

The backend suite was not repeated after the CSS-only shell change.

## Browser acceptance

Local stack: preview API `127.0.0.1:18014`, database `nabitouch_preview_validate`, frontend `localhost:3025`. Demo sign-in only. No production password or TOTP was used. No contact form was submitted.

| Journey | Result | Evidence |
| --- | --- | --- |
| Homepage | Pass | Heading present, 8 images, 0 broken. Mobile width 390 had 60 px horizontal overflow, then 0 after the shell clip. |
| Services catalogue | Pass | “Massage, made around you.”, 10 cards, 13 images, 0 broken, mobile overflow 0. |
| Swedish detail | Pass | Earlier this run: price and book control, 4 images, 0 broken. |
| Practitioner list and Maya profile | Pass | Earlier this run: Maya, Liam, Priya, Jordan visible; Nabitu absent; mobile profile had no overflow. Preview count for `p-nabitu-kahindo` is 0. |
| Mobile navigation | Pass | Bottom nav Home, Services, Book, My Nabitouch at 390 px. |
| Footer | Pass with a gap | Footer has the logo, public links, and the treatment disclaimer. It does not print the phone or email. |
| Contact page | Pass as designed | Clinic street stays hidden. Phone and email cards stay hidden until clinic settings are stored. Hours text is not on the page until `clinic.hours` is stored. The word “appointment” on the page is booking copy, not the business hours. |
| Owner sign-in | Pass local only | Demo owner reached `/owner` without MFA. |
| Production MFA | Blocked | Not authorized and no production secret was available. |
| Logout and session invalidation | Pass | Sign-out returned home. A following service create returned 401. |
| Service create, preview, publish, price | Pass | `overnight-probe` was created as draft, preview stayed 404 anonymously, publish returned 200 anonymously, price saved as 60 minutes at $99. |
| Service photo, archive, restore, delete | Pass | Published photo 200 anonymously. Archived photo 404 anonymously and 200 for the owner. Removed photo 404. Service row deleted. Anonymous GET 404. Probe count is now 0. The ten seed services were not moved to draft. |
| Practitioner own profile | Pass | Maya edited her biography and the original text was saved back. The form has no visibility or specialty control. |
| Practitioner gallery | Pass | Owner added a gallery JPEG for Maya. Anonymous GET returned 200 while her profile is public. Removal left the gallery empty and the media URL 404. |
| Practitioner schedule | Not tested for a save | `/pro/availability` loaded day, week, month, and weekly controls for Maya. No hours were changed. |
| Unauthorized owner route | Pass | Maya was sent from `/owner/manage` to `/pro`. Service create returned 403. |
| Unauthorized profile media | Pass | Maya uploading a photo for Liam returned 403. |
| Eligible welcome booking | Pass | `NT-2033`, Swedish 60, Maya, 20 Oct 2026 09:00, Central Edmonton, travel 0. Stored base 120, discount 24, tax 4.8, total 100.8, code `WELCOME20`. Draft invoice lines 12000 and −2400, tax 480, total 10080. |
| Ineligible welcome booking | Pass | Same email and phone, `NT-2034`, 21 Oct 2026 10:00. Preview and confirmation were $120, GST $6, total $126, welcome flag false. Stored pricing matches. |
| Mapbox civic address | Pass | Suggestion `10150 104 Street NW, Edmonton, Alberta T5J 1A7, Canada` confirmed in Central Edmonton. |
| Invalid address | Pass | `zzzz not an address 99999` produced no suggestion and left Continue disabled. Postal `T5J 2R4` on the verified civic line was rejected as approximate and did not confirm. |
| Invalid upload | Pass | Text file returned 400 `Use a JPEG, PNG, or WebP photo`. |
| CSRF | Pass | Missing and wrong tokens returned 403 `CSRF token missing or invalid`. |
| Archived, unpublished, removed media | Pass | Covered by the probe service above. |
| Duplicate submit, expired credential, invalid duration, unavailable specialty | Not tested in the browser | The serial backend suite, including profile specialty and credential checks, passed. The confirm button is disabled while a request is in flight; a double click was not performed. |

An owner authorization probe wrote Liam's preview biography to a temporary sentence. It was restored to “Patient, gentle approach — great with older adults.” Specialties were unchanged. That database is the local preview, not production.

## Security

See `docs/OVERNIGHT_SECURITY_FINDINGS.md`. No authentication defect was changed in code. Residual items are production MFA not enrolled, unpatched Create React App advisories, and authentication-only rate limits. Local preview document-upload and card-checkout flags are on and must not be copied to production.

## Database

The isolated backup drill restored 54 of 54 collections and the catalogue, practitioner, and media indexes. It ran before `NT-2033` and `NT-2034` existed. Details and the rollback sequence are in `docs/BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md`.

Starting a newer API against production would create additive unique indexes and can create `nt_media`. An application rollback does not remove them. That start was not performed.

## Media

Uploads are limited to JPEG, PNG, and WebP, re-encoded, and served with `Cache-Control: private, no-store`. Public reads follow publication. The local restore matched private probe bytes. The browser then proved publish, archive, remove, and gallery removal. No production media was touched.

## Operations

The configuration manifest is prepared and not applied. `WELCOME20` is 20 percent, capped at $40, first online booking, treatment only, not stackable, with no expiry in the prepared rule. Cancellation text is the approved draft and remains `pending`. Clinic booking stays off. Scheduling defaults are 10, 15, 10, and 90 minutes. Nabitu Kahindo is not in the preview database and was not created in production.

Private deployment acceptance, when later authorized, still requires a fresh production backup, the exact image SHA, owner MFA, and proof that public DNS and Nginx were not changed.

## Privacy

Technical inventory and the eight decisions that need a qualified Alberta or Canadian reviewer are in `docs/PRIVACY_READINESS_GAP.md`. This report does not certify compliance. Legacy health records were not moved or deleted.

## Owner decisions

1. Approve or reject the local shell overflow fix before any private image build.
2. Complete production owner MFA. This run did not request a code.
3. Authorize a backup of `nabitouch_prod` before any newer API process starts.
4. Decide when `WELCOME20`, the cancellation status, clinic phone, and clinic email may be written.
5. Supply Nabitu Kahindo's real login, registration, insurance, services, and hours. Do not activate her until that approval.
6. Keep document uploads, card checkout, rewards, referrals, NabiDerm, clinic booking, and automatic fees off for launch.
7. Commission the privacy review listed in the gap assessment.
8. Decide whether the Create React App advisories are accepted for launch or scheduled as a later toolchain upgrade.

## Final release recommendation

| Gate | Recommendation | Why |
| --- | --- | --- |
| Local development | Conditional | Automated suites passed and the browser journeys above passed. Production MFA, a saved schedule edit, and a double-submitted booking were not browser-tested. Frontend audit findings remain. |
| Private deployment | No-go | The private API stays on `9aca5ec`. No new image was built or started. A backup of production was not taken. |
| Production configuration | No-go | Welcome offer, cancellation approval, clinic contact fields, and practitioner activation were not written. |
| Public launch | No-go | Booking is not approved for the public site. DNS, Nginx, and the public website were not changed. |

The final local commit records evidence and the overflow fix. It is not a release tag and it is not approval to deploy.
