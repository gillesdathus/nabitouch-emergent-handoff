# Password-reset email render fix (2026-10-17)

**Symptom:** Delivered “Reset your Nabitouch password” email on iPhone Apple Mail stays blank with a persistent **LOADING** indicator.

**Status:** Code fixed and unit-tested. **Not deployed.** No live Resend send from this workstation (local `EMAIL_PROVIDER=mock`; no Users `.env` Resend key).

## Root cause

The Tide shell (`emailtpl.wrap`) produced HTML that Apple Mail’s renderer often fails to finish:

1. **`<!-- nabitouch-shell -->` before `<!doctype html>`** — content before the doctype breaks HTML document mode in WebKit Mail (blank body / endless loading).
2. **`background-image: linear-gradient(...)`** on the brand header — CSS gradients via `background-image` are unsafe in Apple Mail / Outlook and can stall layout.
3. **Reset body was a second full-bleed table** nested inside the shell with almost no padding, fighting the outer card instead of providing a simple text + button fragment.

MIME: Resend path already sent `html` + `text`; the failure was HTML structure, not a missing subject.

## Files changed

| File | Change |
| --- | --- |
| `backend/emailtpl.py` | Doctype first; marker in `<head>`; solid `#0B1B3F` header; no gradients; consistent 28px padding; `TEMPLATE_VERSION=tide-2026-10` |
| `backend/auth.py` | Email-safe `reset_email_html`: table button, visible copy-paste URL, no nested shell, no images |
| `backend/emailer.py` | `assert_complete_email_body()` after wrap; refuse non-doctype lead, scripts/iframes, `background-image`, empty plain text; Resend payload still includes `text` |
| `backend/email_templates.py` | Delivery-test body includes `https://nabitouch.com` so completeness guard passes |
| `backend/tests/test_password_reset_email_render.py` | Render / multipart / guard regressions |

## Compatibility

| Client | Expectation after deploy |
| --- | --- |
| Apple Mail (iOS) | Visible text + button without remote images |
| Gmail | Same |
| Outlook | Table button + solid `bgcolor` header |

Brand: text “Nabitouch” in navy header (no logo image). Usable if images are blocked.

## Tests

```text
tests/test_password_reset_email_render.py  → 5 passed
tests/test_forgot_password_enumeration.py  → included in batch (6 passed total with render file)
test_launch_config Resend send mocks       → re-run with new guards
```

Controlled **live** send to an authorized mailbox was **not** executed here (no Resend credentials in the Users checkout). After deploy, send a **synthetic** preview only (`token=preview-not-a-real-token`) to `EMAIL_TEST_RECIPIENT` / owner inbox — never a real patient reset token.

## Reset URL

Unchanged: `{APP_URL}/reset-password?token={urlsafe}` with existing expiry / hashing. Token security untouched.

## Deployment required?

**Yes** — production still runs the rollback image with the old shell. Deploy the API image that includes these files (can ship with the live-Stripe validation prep). Do not auto-deploy from this session.

## Rollback

Revert to previous API digest (`f6a73339…` or Gate B `080185ce…`). Email subject will still deliver; body may again LOADING on Apple Mail until the new template is restored.
