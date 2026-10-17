# Prep — Live Stripe startup validation (API image) — STOPPED before production deploy

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff`  
**Branch:** `feature/codex-production-readiness` (includes `a9a0a3f` enumeration fix)  
**Date:** 2026-10-17  
**Production deploy:** **NOT performed**

## Verdict

**READY for authorized API-only recreate** against existing `/etc/nabitouch-next.env` (`PAYMENT_MODE=live`, `STRIPE_CARD_CHECKOUT_ENABLED=false`, live secret + `whsec`). Checkout stays off. No Nginx, PR merge, or payment-data changes in this prep.

| Artifact | Digest / value |
| --- | --- |
| Prep image tag (local) | `nt-next-api:prep-live-stripe-validation` |
| Prep image Id | `sha256:ac2b9595e31432805091082facebbf4615549173613645e797e62c67c60b97d6` |
| Running production (preserve) | `sha256:f6a73339…` (rollback image) |
| Original Gate B (retain) | `sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f` |
| Focused tests | **9 passed** |

## Root cause (Gate B crash-loop)

`validate_stripe_env()` previously permitted **only** `sk_test_` / `rk_test_` keys. With production `PAYMENT_MODE=live` and a loaded `sk_live_` secret, startup raised and the container exited. Rollback `f6a73339` does not enforce that check the same way, so it stays up with the new env.

## Code changes (uncommitted on branch tip)

### `backend/stripe_gateway.py`

- Accept `PAYMENT_MODE=live` with matching `sk_live_` / `rk_live_` + `whsec_` when a secret is set.
- **Refuse** `STRIPE_CARD_CHECKOUT_ENABLED=true` in live mode (startup hard-fail).
- Preserve test-mode sandbox-only rules and delivery-channel gates.
- Reject live keys outside `PAYMENT_MODE=live` and test keys outside `PAYMENT_MODE=test`.
- `stripe_request()` still sandbox-only (`PAYMENT_MODE=test`) and still rejects `livemode=true` objects.

### `backend/auth.py`

- Already present via commit `a9a0a3f`: forgot-password wraps `send_email` in `try/except HTTPException` and returns the same generic `{ok: true, message: …}` on delivery failure (no account enumeration).

### Tests added / adjusted

| File | Coverage |
| --- | --- |
| `backend/tests/test_stripe_live_config.py` | Live+disabled checkout OK; live rejects test key; live requires whsec; live refuses enabled checkout; live key requires live mode; webhook HMAC signature match/reject |
| `backend/tests/test_forgot_password_enumeration.py` | Unknown vs known+mail-failure → identical public body |
| `backend/tests/test_services_route_contract.py` | Source contract: `@api.get("/services")` + `services_catalogue`; catalogue helpers importable |
| `backend/tests/test_stripe_sandbox.py` | Adjusted expectation for live-key rejection wording under non-live modes |

## GET `/api/services` → 405

- **Frontend bootstrap** uses `api.state()` → `GET /api/state` (`frontend/src/lib/api.js`, `DemoStore.jsx`). It does **not** call `GET /api/services`.
- Approved/Gate B / prep trees define `@api.get("/services")` → `services_catalogue`.
- **405 on rollback `f6a73339`** is an image gap / probe mismatch, not a SPA contract break. **No route code change** beyond regression contract tests.

## Test + build evidence

```text
docker build -f deploy/Dockerfile.api -t nt-next-api:prep-live-stripe-validation .
# image Id: sha256:ac2b9595e31432805091082facebbf4615549173613645e797e62c67c60b97d6

# tests mounted (image .dockerignore excludes backend/tests)
pytest tests/test_stripe_live_config.py \
       tests/test_forgot_password_enumeration.py \
       tests/test_services_route_contract.py
# → 9 passed

# synthetic live boot gate
PAYMENT_MODE=live STRIPE_SECRET_KEY=sk_live_synthetic \
STRIPE_WEBHOOK_SECRET=whsec_synthetic STRIPE_CARD_CHECKOUT_ENABLED=false
→ validate_stripe_env() OK (LIVE_DISABLED_CHECKOUT_OK)
```

## Deployment procedure (owner-authorized only — not run)

1. Transfer/load `nt-next-api:prep-live-stripe-validation` (`sha256:ac2b9595…`) onto the VPS; retag to the compose image name used by `nt-next` (typically `nt-next-api:local`).
2. Confirm `/etc/nabitouch-next.env` still has `PAYMENT_MODE=live`, `STRIPE_CARD_CHECKOUT_ENABLED=false`, live secret + webhook secret (do not print values).
3. Recreate **only** the API container for the `nt-next` stack (no Nginx edit).
4. Verify `127.0.0.1:8011/api/health` → `ok`; `cardCheckout=false`.
5. Spot-check: forgot-password public body unchanged for known/unknown; `GET /api/services` returns 200 (catalogue) on the new image; checkout endpoints still refuse when flag is false.
6. Leave legacy stack, Nginx, Gate B image `080185ce`, and rollback tag `f6a73339` on disk.

## Rollback procedure

1. Retag/recreate API to preserved `sha256:f6a73339…` (current public runner).
2. Do not touch Nginx or legacy containers.
3. Optional alternate: return to Gate B `sha256:080185ce…` **only** after env no longer presents `sk_live_` under the old validator — prefer `f6a73339` for immediate public restore.

## Remaining release blockers / notes

1. **Uncommitted prep** — `stripe_gateway.py` + new tests are local WC changes; commit/tag before treating the digest as the release source of truth if you rebuild from git.
2. **Live webhook settlement still blocked by design** — `billing.stripe_webhook` raises `400 Live Stripe events are prohibited` when `livemode` is true. Signature verification runs first; live events will not settle payments. Acceptable while checkout is off; changing this needs a **separate authorization**.
3. **`stripe_request()` remains test-mode only** — cannot create live Checkout sessions via this gateway path.
4. **Do not** set `STRIPE_CARD_CHECKOUT_ENABLED=true` in production; validator will refuse to boot in live mode.
5. **PR #1** — still not merged (per standing order).
6. Docs that still say “`sk_live_` is refused” (`docs/ENVIRONMENT.md`, Hostinger notes) are stale relative to this prep; update only if you want operator docs aligned.

## Explicit non-actions (this session)

- No production container recreate  
- No Nginx changes  
- Checkout not enabled; no charges; no patient/payment record edits  
- Credentials / reset tokens not printed  
- PR #1 not merged  
- Broad repo scans / parallel agents not used  
