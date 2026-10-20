# Gate B — Private loopback deploy result (2026-10-17)

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff`  
**Deploy source on VPS:** `/root/nabitouch-rc` @ `7cd6ab8a33caa55b8df1ec519a2b9977f63054bb`  
**Application RC:** `0a0d8c74336299bce9958bd39ede2769201a4fd5` (`0a0d8c7`)  
**Gate B:** **PASS**  
**Public cutover / Nginx / PR merge / Stripe:** **NO-GO / not authorized**

## Outcome

| Item | Value |
| --- | --- |
| Command | `CONFIRM_PRIVATE_DEPLOY=yes deploy/private-release/deploy-private-api.sh` |
| Built / running tag | `nt-next-api:src-0a0d8c7` → `:local` |
| `POST_BUILD_DIGEST` | `sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f` |
| Container start | `2026-10-17T17:05:05Z` |
| Health (`127.0.0.1:8011/api/health`) | `status=ok`, `mongo=ok`, `redis=ok`, `documentUploads=false`, `cardCheckout=false` |
| Public Nginx | **Unchanged** (staging still `proxy_pass` → `127.0.0.1:18081`; nabitouch.com not cut over) |

## Attempt history

1. **First attempt** (pre-retry script): container started; single immediate `curl` hit connection reset; script rolled back to `sha256:f6a73339…`. Image `src-0a0d8c7` retained.  
2. **Fix:** `deploy-private-api.sh` health check retries up to ~90s (`seq 1 30` × 3s); UTF-8 BOM stripped. Commit `7cd6ab8`.  
3. **Second attempt:** initial curl reset observed; retry loop reached `health-ok`; deploy exit 0; previous good image left tagged for rollback.

## Rollback artifacts (post-deploy)

| Tag | Digest | Role |
| --- | --- | --- |
| `nt-next-api:local` / `:src-0a0d8c7` | `sha256:080185ce…` | Current private API |
| `nt-next-api:9aca5eccdc3c` | `sha256:f6a73339…` | Previous-good retag target |
| `nt-next-api:pre-gate-b-f6a73339` | `sha256:f6a73339…` | Interim Gate B rollback (owner-approved) |

Historical `rollback-0081eac25d1e` remains unavailable (see `docs/GATE_B_ROLLBACK_ARTIFACT_RECOVERY_2026-10-17.md`).

## Explicit non-actions

- Did not change public Nginx for nabitouch.com  
- Did not merge Draft PR #1  
- Did not enable Stripe card checkout or register live webhooks  
- Did not modify production database contents beyond normal API startup index ensure  
- Did not label any rebuilt image as `rollback-0081eac25d1e`
