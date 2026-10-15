# Overnight security findings

Review date: 13 October 2026. Scope is the local preview on `127.0.0.1:18014` and `localhost:3025`, plus reading the authentication, CSRF, media, and catalogue code. Production was not contacted. No exploit was developed.

## Verified controls

| Control | Evidence this run | Result |
| --- | --- | --- |
| Owner catalogue writes | Owner demo session created, published, priced, archived, restored, and deleted only `overnight-probe`. | Pass |
| Practitioner cannot create a service | Maya session `POST /api/services` returned 403 `Not permitted`. | Pass |
| Practitioner cannot open owner manage | Browser navigation to `/owner/manage` as Maya ended on `/pro`. | Pass |
| Logout invalidates the session | After sign-out, `POST /api/services` returned 401. | Pass |
| CSRF | Owner session `POST /api/services` without a token, and with a wrong token, returned 403 `CSRF token missing or invalid`. Cookie mutations require the header to match the `csrf_token` cookie and the session row. Bearer requests skip CSRF. Exempt paths are login, register, forgot-password, reset-password, and demo-login. | Pass |
| Cookies | Access and refresh are HttpOnly. The CSRF cookie is not HttpOnly, which the browser script needs. `Secure` defaults off outside production and is required when `APP_ENV=production`. SameSite defaults to `lax`. | Pass in code; production cookie flag not observed |
| Media type check | A text upload to the Swedish service photo returned 400 `Use a JPEG, PNG, or WebP photo`. | Pass |
| Cross-profile media | Maya `POST /api/practitioners/p-liam/photo` returned 403 `Not permitted`. | Pass |
| Public media follows publication | A published service photo returned 200 anonymously. After archive it returned 404 anonymously and 200 to the owner. After removal it returned 404 to the owner. A published gallery photo returned 200 anonymously and 404 after removal. | Pass |
| Welcome eligibility | A second booking for the same phone and email was stored without the discount. | Pass |

Access tokens expire in 15 minutes. Refresh tokens last 7 days. Login locks after 5 failures for 15 minutes. Password reset is limited to 3 requests per window.

## Findings

### F1 — Production MFA enrollment is not done

Severity: high for public launch, not a code defect. Production owner MFA was not exercised. Local preview runs `DEMO_MODE=true`, and demo sign-in does not ask for a TOTP. `validate_env` refuses `DEMO_MODE` when `APP_ENV=production`. Residual risk: the production authenticator setup remains an owner action. No TOTP was requested or printed.

### F2 — Frontend toolchain advisories have no compatible patch

Severity: low for the API runtime. `yarn audit` exited 12 with 18 advisories (8 moderate, 10 high). High items include `braces` and `sprintf-js` under react-scripts and Jest. No patched release fits the current toolchain without a major frontend upgrade, which was not applied. Residual risk stays in the build tools, not in the booking API.

### F3 — API rate limiting is limited to authentication

Severity: low. Login and password reset are throttled. A general per-route limiter was not found. This was not newly exploited. Residual risk is abusive traffic against authenticated routes after a session exists.

### F4 — Local preview flags are not the launch flags

Severity: informational. The preview process has document uploads and card checkout enabled so existing tests can run. Production validation requires those variables to be set explicitly, and the last known production values were off. This run did not read production. Copying the preview environment into production would turn those features on. Do not do that.

## Corrections

No authentication or media defect met the bar for a code change. An owner profile update used during the cross-check wrote Liam Fournier's biography to a probe sentence in the isolated preview database. Specialties were unchanged. The biography was restored to the seed text in that same preview database before the run ended. Production was not involved.

## Residual risk

Production MFA, production cookie flags, and production feature flags were not observed. The private API remains on `9aca5ec`. Starting a newer image against `nabitouch_prod` is not authorized and would create additive indexes.
