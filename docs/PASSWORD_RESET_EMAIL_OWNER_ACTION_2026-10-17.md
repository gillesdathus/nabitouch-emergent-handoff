# Password-reset email — owner action required (2026-10-17)

**Endpoint:** `POST /api/auth/forgot-password`
**Provider:** Resend (`EMAIL_PROVIDER=resend`)
**Public symptom:** Forgot Password shows "Failed to send email"

## Root cause

Resend rejects the configured API key:

- `POST https://api.resend.com/emails` → **401** `API key is invalid`
- `GET https://api.resend.com/domains` → **400** `API key is invalid`

`EMAIL_FROM` / `APP_URL` / domain status sidecar look present. This is not an application-code sender bug.

## Secondary findings

| Item | Finding |
| --- | --- |
| Reset link base | `APP_URL=https://nabitouch.com` → `/reset-password?token=…` (correct once mail sends) |
| Token | Created hashed in DB; raw token only in email (or preview mode) |
| Unknown email | Returns generic `{ok:true}` (no enumeration) |
| Known email + send fail | Previously returned **502** "Failed to send email" (**enumerates**). Code patch prepared in `backend/auth.py` to return the same generic ok on provider failure |
| `EMAIL_TEST_RECIPIENT` | **Set** (domain `nabitouch.com`) — after key repair, all outbound mail is redirected to that test inbox until cleared |

## Required owner action (blocking)

1. In Resend, create a new API key (revoke the invalid one).
2. On the VPS, set `RESEND_API_KEY` in `/etc/nabitouch-next.env` (mode 600). Do not commit it.
3. Confirm `nabitouch.com` remains verified in Resend and `EMAIL_FROM` uses `@nabitouch.com`.
4. Authorize a test mailbox address for a live send proof.
5. Decide whether to **clear `EMAIL_TEST_RECIPIENT`** for real user delivery (keep it only while soft-launch testing).
6. Authorize API recreate/redeploy of the auth enumeration patch and a focused reset-email test.

No credentials were invented. Stripe untouched. PR not merged.
