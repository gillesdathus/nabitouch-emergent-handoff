# Environment variables

Never commit real values. `backend/env.example` lists the names. Production startup rejects demo mode, wildcard CORS, insecure cookies, and an unauthenticated Redis URL.

| Name | Role |
|---|---|
| `APP_ENV` | `production` turns off demo login and simulated card payment |
| `MONGO_URL` | Database connection. Use a least-privilege user |
| `DB_NAME` | Database name. Keep it separate from development |
| `JWT_SECRET` | Signs session cookies. At least 16 characters. Rotate if it was ever shared |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | Bootstrap-only. First API start creates the owner when that email is absent. After the live account password changes (reset, change-password, or invite), do not copy the current password back into the environment. `OWNER_PASSWORD` is not used for day-to-day sign-in |
| `DEMO_MODE` / `DEMO_PASSWORD` | Development only. Production refuses `DEMO_MODE=true` |
| `COOKIE_SECURE` | Must be true behind HTTPS |
| `COOKIE_SAMESITE` | `lax` for the first-party site |
| `CORS_ORIGINS` | Explicit frontend origin. A wildcard is refused |
| `APP_URL` | Public site origin used in email links |
| `EMAIL_PROVIDER` / `EMAIL_FROM_NAME` | `disabled` until a provider is chosen. `mock` keeps mail in memory. Production launch uses `resend` |
| `EMAIL_FROM` | Resend From header, `Nabitouch <bookings@nabitouch.com>`. The address must be on `nabitouch.com` |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` | Send key and Svix webhook secret. Placeholders only in git |
| `EMAIL_TEST_RECIPIENT` | Documents the approved smoke-test recipient. Sending does not read this value |
| `PAYMENT_MODE` | `simulated` is ignored in production |
| `DOCUMENT_UPLOADS_ENABLED` | Unset stays off. Production must set it explicitly. `false` refuses file uploads before they are stored |
| `STRIPE_CARD_CHECKOUT_ENABLED` | Unset stays off. Production must set it explicitly. `false` refuses Checkout and simulated card intents before any session is created |
| `LEGACY_PATIENT_IMPORT_ENABLED` | Unset stays off. Production must set it explicitly. `false` refuses legacy and history imports |
| `HOSTING_STRATEGY` | `shared-vps` or `dedicated-vps`. `shared-vps` refuses `CLAMAV_HOST` |
| `LOG_LEVEL` | Optional `DEBUG`, `INFO`, `WARNING`, or `ERROR` |
| `STRIPE_SECRET_KEY` | Test key `sk_test_...` only until the owner enables live payments. `sk_live_` is refused |
| `STRIPE_WEBHOOK_SECRET` | Signs Checkout webhooks. A browser redirect does not settle a payment |
| `REDIS_URL` | `rediss://:password@host:6379/0` in production |
| `MAPBOX_TOKEN` | Server token for Geocoding and Directions. A public-scope `pk.` token with no URL restriction is accepted. It must be a different token from the browser token |
| `REACT_APP_BACKEND_URL` | Frontend build-time API origin |
| `REACT_APP_MAPBOX_PUBLIC_TOKEN` | Browser map token. Must be a URL-restricted `pk.` token. An `sk.` token is refused |
| `FIELD_ENCRYPTION_KEY` | 32-byte url-safe base64 key for insurance numbers, clinical text, and uploaded files. Required in production. Not stored in the database |
| `FIELD_ENCRYPTION_KEY_PREVIOUS` | Previous key, accepted for decrypt only while records are re-encrypted |
| `CLAMAV_HOST` / `CLAMAV_PORT` | Optional malware scanner. When set, an unreachable scanner leaves the file in quarantine |

Tax rates and per-service taxable flags are stored in the database, not in these variables. A professional should confirm which services are taxable before go-live.

## Production file

`deploy/env.hostinger.example` is the placeholder template for `/etc/nabitouch-next.env`. The filled file is created only by `deploy/provision-production-secrets.sh`, run as root on the VPS from an interactive terminal. That script generates the application secrets, asks for the Mapbox and Resend credentials without echoing them, and writes:

| Path | Mode | Contents |
|---|---|---|
| `/etc/nabitouch-next.env` | `0600`, root:root | API configuration. `MAPBOX_TOKEN` is `nabitouch-backend-prod`, the unrestricted public-scope token. The browser token is not stored here |
| `/etc/nabitouch-next.frontend.env` | `0600`, root:root | `REACT_APP_MAPBOX_PUBLIC_TOKEN` is `nabitouch-frontend-prod` for a later frontend build |
| `/etc/nabitouch-next.resend-status` | `0600`, root:root | `VERIFIED` or `PENDING` only |
| `/etc/nabitouch-next.recovery-confirmed` | `0600`, root:root | The word `owner-attested` after the owner confirms the off-server copy |

`FIELD_ENCRYPTION_KEY` is 32 random bytes, URL-safe base64, matching `backend/fieldcrypto.py`. It is generated independently of the JWT, MongoDB, and Redis secrets. The script keeps an existing key on replace and does not rotate it. The owner must store the recovery file off the server before the environment file is installed. The script does not print the key.

`deploy/validate-production-secrets.py` prints only `PASS`, `FAIL`, and `PENDING`. It does not source the environment file.

The API calls Geocoding v6 and Directions v5 with `MAPBOX_TOKEN`. Those are public Mapbox APIs, so `nabitouch-backend-prod` can be a `pk.` token with no URL restriction. No endpoint in this application needs a secret `sk.` scope. `nabitouch-frontend-prod` is the only token that enters the frontend build, through Mapbox GL. Its URL restriction must include `https://nabitouch.com` and `https://www.nabitouch.com`, because those are the two origins that can load the map. Provisioning does not call Mapbox and does not change Nginx or DNS.

Resend uses domain `nabitouch.com`, sender `Nabitouch <bookings@nabitouch.com>`, reply-to `info@nabitouch.com`, and smoke recipient `info@nabitouch.com`. `OWNER_EMAIL` is the same address. An empty API key or webhook secret stays pending, and the email release gate stays blocked. Provisioning does not send mail.

Rotation steps are in `docs/SECRET_ROTATION.md`. Do not commit filled values.

`REACT_APP_MAPBOX_PUBLIC_TOKEN` and `REACT_APP_BACKEND_URL` are frontend build arguments. They are not API environment variables. Build the frontend with `REACT_APP_BACKEND_URL=https://nabitouch.com` and a public `pk.` token restricted to `https://nabitouch.com`. Do not put an `sk.` token in the frontend.
