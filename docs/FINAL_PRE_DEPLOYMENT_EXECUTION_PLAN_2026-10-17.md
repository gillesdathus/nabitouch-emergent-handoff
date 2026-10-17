# FINAL PRE-DEPLOYMENT EXECUTION PLAN — 17 October 2026

**Public cutover: NOT AUTHORIZED / NO-GO.**  
**Stripe card checkout: stays `false`.**  
**Draft PR #1: do not merge until owner step E.**  
**No production deploy, Nginx change, or Stripe activation is authorized under the current hold.**

| Item | Value |
| --- | --- |
| Branch | `feature/codex-production-readiness` |
| Application RC | `0a0d8c74336299bce9958bd39ede2769201a4fd5` |
| Pin | `deploy/private-release/release-pin.conf` |
| Safety report | `docs/FINAL_CUTOVER_SAFETY_REPORT_2026-10-17.md` |
| Docs HEAD at plan authoring | `b9c714a` (may advance with this doc only) |

### Live status — public cutover PASS (2026-10-17)

| Gate / item | Status |
| --- | --- |
| **A** backups + isolated restore | **PASS** |
| **A** off-host (`C:\Nabitouch-Backups`) + SHA-256 | **PASS** |
| **A** passphrase in password manager | **VERIFIED** |
| **A** VPS temp passphrase shred | **DONE** |
| **B** private loopback deploy | **PASS** — `POST_BUILD_DIGEST=sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f` |
| Legacy export + archive-only | **PASS** — `docs/LEGACY_PATIENT_ARCHIVE_ONLY_2026-10-17.md` |
| Controlled public cutover | **PASS** — `docs/PUBLIC_CUTOVER_RESULT_2026-10-17.md` |
| PR #1 merge / Stripe live card checkout | **Not authorized** (still disabled) |

This plan completes **safe preparation** only. Commands under **OWNER** require explicit approval before any run. Do not alter Nginx, public traffic, production records, or live payments.

---

## 1. Verified pin and deploy safeguards (done — no execution)

| Control | Verified |
| --- | --- |
| `APPLICATION_SHA` | `0a0d8c74336299bce9958bd39ede2769201a4fd5` |
| Script refuses other SHAs | Yes |
| Pre-deploy image must match | `PRE_DEPLOY_LOCAL_DIGEST` / running `:local` |
| Rollback image must exist | Interim `ROLLBACK_TAG` = `nt-next-api:pre-gate-b-f6a73339` + `ROLLBACK_DIGEST=f6a73339…` |
| Previous-good retag on failure | `PREVIOUS_GOOD_TAG` = `nt-next-api:9aca5eccdc3c` |
| Public Nginx during private deploy | Must still `proxy_pass http://127.0.0.1:8080` |
| Private API only | Health on `127.0.0.1:8011` |
| `STRIPE_CARD_CHECKOUT_ENABLED` | Must be `false` in `/etc/nabitouch-next.env` |
| Health gate | `mongo=ok`, `redis=ok`, `documentUploads=false`, `cardCheckout=false` |
| `POST_BUILD_DIGEST` | `sha256:080185ce702a34025d9745ab6934651a7205c2cf0d1b33e425e8171fc9584d8f` (Gate B PASS) |

**STOP** if any of the above fail on the VPS before `CONFIRM_PRIVATE_DEPLOY=yes`.

---

## 2. Backup preparation (both databases) — OWNER A required to execute

### A1. New stack — `nabitouch_prod` (Stage C)

```bash
# On srv1393944 as root, checkout containing deploy/private-release/
df -hP /
docker inspect nt-next-mongo --format '{{.State.Status}}'
# OWNER A:
CONFIRM_PRODUCTION_BACKUP=yes deploy/private-release/backup-encrypted.sh
```

**Verify (no secrets):**

```bash
# Replace stamp from script output
sha256sum /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm
awk 'NR==1 {print $1}' /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm.sha256
# Digests must match. Inspect .manifest for consistency=oplog and DB_NAME identity — no passphrase in file.
```

**Isolated restore (OWNER A, never onto live prod):**

```bash
CONFIRM_ISOLATED_RESTORE=yes deploy/private-release/restore-oplog-isolated.sh \
  /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm nt-restore-<stamp>
# Count collections inside that container only, then:
CONFIRM_REMOVE_ISOLATED_INSTANCE=yes deploy/private-release/remove-isolated-mongo.sh nt-restore-<stamp>
```

### A2. Legacy Emergent — `nabi_touch` (+ uploads)

Stage C scripts **do not** dump Emergent. Prepare a separate root-only archive (OWNER A):

```bash
# Identify container (expect nabitouch_mongo). Do not print URIs or documents.
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i nabitouch
# Counts only inside mongosh against nabi_touch — no document bodies:
#   db.getName(); db.getCollectionNames();
#   db.getCollectionNames().forEach(c => print(c, db.getCollection(c).estimatedDocumentCount()))

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/root/nabitouch-next-backups/nabi_touch_${STAMP}.archive.gz
# OWNER A — dump via docker exec into a pipe, then encrypt (example pattern):
# docker exec nabitouch_mongo mongodump --db=nabi_touch --archive --gzip | \
#   openssl enc -aes-256-gcm -pbkdf2 -iter 200000 -out ${OUT}.aesgcm
# sha256sum ${OUT}.aesgcm > ${OUT}.aesgcm.sha256
# Also archive the uploads volume (tar | encrypt) into the same directory.
# chmod 600 /root/nabitouch-next-backups/nabi_touch_*
```

Restore legacy dump only to a **new disposable DB name** or throwaway mongo — never into `nabitouch_prod`, never `--drop` on live Emergent.

**STOP** if passphrase is written to disk, if digests mismatch, or if free disk is insufficient (`df -hP /`).

---

## 3. Off-host destination recommendation (do not create / transmit without OWNER A)

| Option | Recommendation |
| --- | --- |
| **Simplest secure** | Existing SSH host you already control: `OFFHOST_DESTINATION=user@backup-host:/absolute/locked-dir` with key-only auth, dir mode `700` |
| Transfer tool | `CONFIRM_OFFHOST_TRANSFER=yes OFFHOST_DESTINATION=… deploy/private-release/transfer-encrypted-backup.sh <ciphertext>` |
| What transfers | Ciphertext + `.sha256` + `.manifest` only — **not** passphrase, not plaintext |
| Avoid for now | New cloud accounts, public object storage, emailing archives, USB without inventory |

**STOP** until owner names `OFFHOST_DESTINATION` and confirms the remote directory exists. Do not invent a storage account.

---

## 4. Private loopback deploy on `:8011` — OWNER B required

Preconditions: OWNER A backups complete (or owner explicitly accepts risk); pin checked out; `/etc/nabitouch-next.env` validates with card checkout false.

```bash
git fetch origin && git checkout 0a0d8c74336299bce9958bd39ede2769201a4fd5
# Confirm pin file matches RC
grep APPLICATION_SHA deploy/private-release/release-pin.conf
python3 deploy/validate-production-secrets.py   # PASS/FAIL/PENDING only — no secret print
# OWNER B:
CONFIRM_PRIVATE_DEPLOY=yes deploy/private-release/deploy-private-api.sh
```

Optional frontend stage (still no Nginx change) — OWNER B:

```bash
# Build on a workstation from the same SHA, then on VPS:
CONFIRM_FRONTEND_STAGE=yes deploy/private-release/stage-frontend-static.sh \
  /var/www/nabitouch-next /path/to/frontend/build
```

**STOP** if script refuses (wrong SHA, wrong digests, public proxy not on `:8080`, health fails). Script auto-retags previous good image on health failure.

---

## 5. Capture and verify `POST_BUILD_DIGEST`

After OWNER B succeeds:

```bash
NEW=$(docker image inspect nt-next-api:local --format '{{.Id}}')
echo "$NEW"
# Must equal the line printed by deploy-private-api.sh ("Record POST_BUILD_DIGEST=…")
curl -fsS http://127.0.0.1:8011/api/health
# Expect mongo/redis ok and cardCheckout false
```

Update pin (commit on feature branch after owner review):

```bash
# In deploy/private-release/release-pin.conf set:
# POST_BUILD_DIGEST=sha256:<exact Id from docker image inspect>
```

**Verify:** `docker image inspect nt-next-api:local --format '{{.Id}}'` equals `POST_BUILD_DIGEST`.

---

## 6. Archive-only legacy strategy (OWNER C)

| Rule | Commitment |
| --- | --- |
| Automatic patient migration | **No** |
| Destructive ops on Emergent | **No** — leave `nabitouch-rmt`, volumes, uploads |
| Parallel public booking writers | **No** — after any future cutover, only `:8011` receives public `/api/` |
| `LEGACY_PATIENT_IMPORT_ENABLED` | Remains `false` |
| Staff retrieval of archived records | (1) Keep Emergent containers stopped-from-public but intact for Nginx rollback; (2) decrypt off-host `nabi_touch_*.aesgcm` into a disposable mongo **offline**; (3) authorized owner/operator queries counts or specific records under privacy policy — never restore into `nabitouch_prod` without a separate field-map approval |

Code note: `backend/legacy.py` documents `SOURCE_DATABASE = "nabi_touch"` for a future gated import path — import stays **off** until OWNER C reverses archive-only.

---

## 7. Pre-cutover smoke tests (run against loopback / private tunnel — not public cutover)

Use `http://127.0.0.1:8011` (or existing private TLS tunnel). **Cards off.** Prefer owner/staff test accounts; do not dump PHI into chat logs.

| Area | Check |
| --- | --- |
| Auth | Login owner + one staff role; logout; CSRF present on mutating calls |
| Treatments | `GET` services catalogue; select a bookable slug |
| Availability | Practitioner hours / availability endpoint returns slots |
| Booking | Quote + book **mobile** and **clinic** (if clinic enabled) on future dates; expect 200 |
| Billing API | Issue draft invoice path exists; checkout returns **503** while cards disabled |
| Webhook route | `POST /api/billing/stripe/webhook` with `{}` → **400/503**, never 404 on private API |
| Records / ACL | Client cannot read another client; practitioner scoped; owner can read allowed admin |
| Frontend | Staged `/var/www/nabitouch-next` assets load via temporary local/nginx test only; SPA deep link `try_files` — **do not** point public vhost yet |

**STOP** if private health shows `cardCheckout: true`, webhook 404 on `:8011`, or bookings write to Emergent.

---

## 8. Stripe posture

| Setting | Value |
| --- | --- |
| `STRIPE_CARD_CHECKOUT_ENABLED` | `false` |
| Live keys / live webhook | Not configured (OWNER G later) |
| Test-mode on public host | OWNER F only **after** public routes exist (post cutover) |

---

## 9. OWNER APPROVAL CHECKLIST

| Gate | Approval | What it authorizes | What it does **not** do |
| --- | --- | --- | --- |
| **A. Production backups** | `CONFIRM_PRODUCTION_BACKUP=yes` + Emergent dump + optional `CONFIRM_OFFHOST_TRANSFER` / `OFFHOST_DESTINATION` | Encrypted `nabitouch_prod` + `nabi_touch` (+ uploads) archives; off-host copy | No Nginx change, no deploy |
| **B. Private loopback build** | `CONFIRM_PRIVATE_DEPLOY=yes` (+ optional `CONFIRM_FRONTEND_STAGE`) | Build/recreate API on `:8011`; stage static tree | No public traffic change |
| **C. Legacy archive-only** | Written owner decision | Confirms no auto migration; Emergent preserved | No import into `nabitouch_prod` |
| **D. Public Nginx cutover** | Separate written approval | Point `/` + `/api/` to new stack; save `.active` first | Does not enable Stripe |
| **E. GitHub PR merge** | Owner after CI green | Merge Draft PR #1 | Not a deploy by itself |
| **F. Stripe test-mode** | Separate approval post-D | Test keys + Dashboard test webhook | Not live charges |
| **G. Stripe live payments** | Separate approval after F | `sk_live_` + live webhook | Highest risk — last |

---

## 10. Final execution sequence (when approvals are granted in order)

```text
0. STOP if public cutover requested before A–C.
1. OWNER A  — nabitouch_prod encrypted backup + checksum + isolated restore drill
2. OWNER A  — nabi_touch (+ uploads) encrypted archive + checksum
3. OWNER A  — OFFHOST_DESTINATION transfer (both families of ciphertext)
4. OWNER C  — sign archive-only decision
5. OWNER B  — CONFIRM_PRIVATE_DEPLOY; record POST_BUILD_DIGEST; loopback smoke (§7)
6. OWNER B  — optional frontend stage
7. OWNER E  — merge PR only if desired and CI green (can be earlier; not required for B)
8. OWNER D  — save Nginx .active; edit; nginx -t; reload; public smoke
9. OWNER F  — test Stripe only after D proves webhook ≠ 404
10. OWNER G — live Stripe only after F
```

### Rollback (any stage)

```bash
# Public traffic (after D):
sudo cp /etc/nginx/sites-available/nabitouch.com.active \
        /etc/nginx/sites-available/nabitouch.com
sudo nginx -t && sudo systemctl reload nginx

# Private API (after B):
docker tag nt-next-api:9aca5eccdc3c nt-next-api:local
# or: docker tag nt-next-api:rollback-0081eac25d1e nt-next-api:local
docker compose -f deploy/docker-compose.hostinger.yml up -d --no-deps api
curl -fsS http://127.0.0.1:8011/api/health
```

### Global STOP conditions

- Any confirmation variable unset or not exactly `yes`
- Digest / checksum mismatch
- Public Nginx would change during B
- `cardCheckout` true or live Stripe keys present before F/G
- Attempt to restore any backup over live `nabitouch_prod` or live `nabi_touch` without a **second** owner confirmation
- Parallel public writers to Emergent and `nt-next`

---

## Explicit non-actions this document

- Did not run backups, transfers, private deploy, or Nginx reload  
- Did not merge PR #1  
- Did not enable Stripe  
- Did not modify production records or create cloud storage  
