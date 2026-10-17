# GATE A — Backup readiness (authorization pending)

**Application RC:** `0a0d8c7`  
**Preparation HEAD:** `eae528f` (may advance with this doc)  
**Public cutover:** NO-GO  
**This document does not authorize or execute production backups.**

Owner must reply explicitly (e.g. “Approve Gate A”) before any `CONFIRM_*=yes` backup or transfer runs.

---

## Pre-flight verification (items 1–7)

### 1. Target databases correctly identified

| Target | Engine / container | Database name | Backup path |
| --- | --- | --- | --- |
| **New production** | `nt-next-mongo` (replica set `rs0`) | **`nabitouch_prod`** | `deploy/private-release/backup-encrypted.sh` — refuses unless `/etc/nabitouch-next.env` has `DB_NAME=nabitouch_prod` and dump DB set ⊆ `{admin,local,config,nabitouch_prod}` |
| **Legacy Emergent** | `nabitouch_mongo` (Compose `nabitouch-rmt`) | **`nabi_touch`** | **Not** covered by Stage C. Separate dump (commands below). Do not confuse with older unused DB `nabitouch` on `nabitu` |

**STOP** if `DB_NAME` ≠ `nabitouch_prod`, if preflight lists unexpected databases, or if Emergent dump is aimed at the wrong container/DB.

### 2. Legacy uploads included

| Asset | Location (prior inventory) | In Stage C `nabitouch_prod` dump? | Gate A requirement |
| --- | --- | --- | --- |
| New-stack media | Mongo `nt_media` / sealed fields | **Yes** (inside DB archive) | Covered by A1 |
| Emergent DB media metadata | ~18 assets in `nabi_touch` | N/A | Covered by A2 DB dump |
| Emergent **upload files** | Docker uploads volume (~19 files, ~50 MiB) | **No** | **Must** tar+encrypt separately (A2 media) |

**STOP** if A2 completes without a matching encrypted uploads archive + checksum.

### 3. Encryption keys — recoverable through approved procedure

| Secret | What it unlocks | Where it must live | Recovery procedure |
| --- | --- | --- | --- |
| **Backup passphrase** (prompted by scripts) | AES-256-GCM ciphertext of dumps | Owner password manager only — **never** beside archives, never in git, never in `.manifest` | Owner retrieves passphrase from password manager; re-enter at restore prompt. Losing it → archive unreadable |
| **`FIELD_ENCRYPTION_KEY`** (new app) | Clinical/insurance/file ciphertext **inside** restored `nabitouch_prod` | `/etc/nabitouch-next.env` + **off-server recovery copy** (`/etc/nabitouch-next.recovery-confirmed` attestation via `validate-production-secrets.py`) | Restore DB archive, then load same key into disposable env to read sealed fields. Key is **not** inside the mongodump |
| **Emergent archive passphrase** | Legacy DB + uploads ciphertext | Separate password-manager entry (may differ from Stage C passphrase) | Same as backup passphrase for that archive family |

**Pre-check (no values printed):**

```bash
python3 deploy/validate-production-secrets.py
# Expect field encryption key PASS and recovery copy PASS (or PENDING if not attested).
# STOP on FAIL for field encryption / recovery before relying on nabitouch_prod restore readability.
```

### 4. Disk space

| Source | Last measured | Gate A need |
| --- | --- | --- |
| VPS root | ~65–67 GiB free (Oct 2026 audits) | Re-measure live before dump |
| Emergent Mongo volume | ~505 MiB | |
| Emergent uploads | ~50 MiB | |
| `nabitouch_prod` logical | historically small (tens of KiB–MiB class) | |
| Budget | Prefer **≥ 2 GiB free** after dumps (ciphertext + temp decrypt in `/dev/shm` or `/tmp`) | |

```bash
df -hP /
docker system df
```

**Expected:** `Avail` on `/` still tens of GiB (or at least multi-GiB).  
**STOP** if free space &lt; ~2 GiB or `df` fails.

### 5. Isolated restore cannot overwrite live databases

| Script | Guard |
| --- | --- |
| `restore-oplog-isolated.sh` | Container name must be `nt-restore-*`; refuses `nt-next-mongo`; `--network none`; no published ports; no production volume mounts; target mongod must be empty (no user DBs, no `admin.system.users`); no `--drop` |
| `verify-isolated-restore.sh` | Remaps to `nabitouch_prod_restore_<UTC>` only; **refuses oplog manifests**; refuses name `nabitouch_prod` |
| `remove-isolated-mongo.sh` | Only `nt-restore-*` |
| Hand-typed `mongorestore` | **Out of policy** — scripts do not grant Mongo role protection against manual mistakes |

Restored `nabitouch_prod` **name inside** `nt-restore-*` is OK — that container is not the live replica set.

**STOP** if restore is pointed at `nt-next-mongo`, `nabitouch_mongo`, or live `nabitouch_prod` / `nabi_touch`.

### 6. Checksums and content validation (DB + media)

| Step | Covers |
| --- | --- |
| `sha256sum` vs `.sha256` | Ciphertext integrity (bit-exact) |
| Oplog isolated restore + collection count JSON | `nabitouch_prod` present; collection count &gt; 0 |
| Optional deeper check on throwaway only | Compare `estimatedDocumentCount` for key collections (`nt_services`, `nt_media`, `nt_invoices`, …) live vs restore — **counts only** |
| Emergent uploads | After decrypt+untar to empty dir: `find … | wc -l` vs pre-backup file count (~19); do **not** open file contents |
| Field readability | Proves passphrase+dump only; sealed fields need `FIELD_ENCRYPTION_KEY` separately |

Checksum alone does **not** prove the passphrase works — isolated decrypt+restore does.

### 7. Off-host destination

| Status | **BLOCKED** |
| --- | --- |
| Evidence | No `OFFHOST_DESTINATION` configured in repo/runbooks; `transfer-encrypted-backup.sh` refuses until set |
| Local `/root/nabitouch-next-backups` | **Not** off-host |
| Recommendation (when owner authorizes) | Existing SSH host: `user@backup-host:/absolute/dir` mode `700`, key auth, `stat`+`sha256sum` on remote |

Gate A may proceed to **local encrypted archives + isolated restore** with owner approval, but **off-host copy remains a sub-gate** until destination is named. Prefer completing off-host before public cutover (Gate D).

---

## Exact commands (run only after “Approve Gate A”)

All on `srv1393944` as root unless noted. Checkout with `deploy/private-release/`.

### A0. Read-only identity checks (safe anytime; no CONFIRM)

```bash
df -hP /
docker inspect nt-next-mongo --format '{{.Name}} {{.State.Status}}'
docker inspect nt-next-api --format '{{.Name}} {{.State.Status}}'
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i nabitouch
# Confirm /etc/nabitouch-next.env DB_NAME without printing secrets:
python3 - <<'PY'
data={}
for line in open("/etc/nabitouch-next.env", encoding="utf-8"):
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1); data[k.strip()]=v.strip().strip('"').strip("'")
print("DB_NAME", data.get("DB_NAME"))
print("APP_ENV", data.get("APP_ENV"))
print("STRIPE_CARD_CHECKOUT_ENABLED", data.get("STRIPE_CARD_CHECKOUT_ENABLED"))
PY
python3 deploy/validate-production-secrets.py
```

**Expected:** `DB_NAME nabitouch_prod`, `STRIPE_CARD_CHECKOUT_ENABLED false`, mongo/api running, `df` OK, validator not FAIL on encryption/recovery.

---

### A1. `nabitouch_prod` encrypted backup

```bash
CONFIRM_PRODUCTION_BACKUP=yes deploy/private-release/backup-encrypted.sh
# Prompt: Backup passphrase:  (enter password-manager value; not echoed)
```

**Expected stdout (pattern):**  
`Encrypted backup written. Checksum file: /root/nabitouch-next-backups/nabitouch_prod_<UTC>.archive.gz.aesgcm.sha256`  
Exit **0**. Files: `.aesgcm`, `.sha256`, `.manifest` with `consistency=oplog`, `sourceDatabase=nabitouch_prod`.

**Checksum verify:**

```bash
C=/root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm
awk 'NR==1 {print $1}' "${C}.sha256"
sha256sum "$C" | awk '{print $1}'
# Both lines identical
grep -E '^(consistency|sourceDatabase|databases)=' "${C}.manifest"
```

**Expected:** matching digests; `consistency=oplog`; `sourceDatabase=nabitouch_prod`.

**STOP (A1):** exit 2 (oplog/role/window/DB list/tools); exit 1 (encrypt/dump fail); checksum mismatch; passphrase forgotten / not stored in password manager.

---

### A1b. Isolated oplog restore (throwaway only)

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker run -d --name nt-restore-${STAMP} --network none \
  -v nt-restore-${STAMP}:/data/db \
  mongo:7 mongod --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.25

CONFIRM_ISOLATED_RESTORE=yes deploy/private-release/restore-oplog-isolated.sh \
  /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm \
  nt-restore-${STAMP}
```

**Expected:** `isolated-target-empty`; JSON like `{"database":"nabitouch_prod","collections":<N>}` with N&gt;0; exit 0.

Optional counts-only compare (on throwaway vs live via API mongo — counts only):

```bash
docker exec nt-restore-${STAMP} mongosh --quiet --eval \
  'const d=db.getSiblingDB("nabitouch_prod"); printjson({cols:d.getCollectionNames().length, media:d.nt_media.estimatedDocumentCount(), services:d.nt_services.estimatedDocumentCount()})'
```

**Cleanup:**

```bash
CONFIRM_REMOVE_ISOLATED_INSTANCE=yes deploy/private-release/remove-isolated-mongo.sh nt-restore-${STAMP}
```

**Expected:** `removed nt-restore-…`  
**STOP:** restore onto wrong container; checksum exit 4; empty collections exit 3.

---

### A2. Legacy `nabi_touch` + uploads (manual encrypted archive)

```bash
# Identify mongo + uploads volume names (adjust if docker ps differs)
docker ps --format '{{.Names}}' | grep -i mongo
docker volume ls | grep -i nabitouch

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=/root/nabitouch-next-backups
mkdir -p "$DIR" && chmod 700 "$DIR"

# Counts only (inside mongosh) — no document bodies:
# docker exec -it nabitouch_mongo mongosh --quiet nabi_touch --eval \
#   'db.getCollectionNames().forEach(c => print(c, db.getCollection(c).estimatedDocumentCount()))'

# DB dump → encrypt (passphrase from password manager — Emergent entry)
docker exec nabitouch_mongo mongodump --db=nabi_touch --archive --gzip \
  | openssl enc -aes-256-gcm -pbkdf2 -iter 200000 -salt \
    -out ${DIR}/nabi_touch_${STAMP}.archive.gz.aesgcm -pass env:BACKUP_PASSPHRASE
# Set BACKUP_PASSPHRASE in the environment only for that pipeline, then unset.

sha256sum ${DIR}/nabi_touch_${STAMP}.archive.gz.aesgcm \
  | awk '{print $1}' > ${DIR}/nabi_touch_${STAMP}.archive.gz.aesgcm.sha256
chmod 600 ${DIR}/nabi_touch_${STAMP}.*

# Uploads volume → tar → encrypt (replace VOLUME with actual name from docker volume ls)
# FILE_COUNT=$(docker run --rm -v VOLUME:/data:ro alpine find /data -type f | wc -l)
# echo "pre_upload_files=$FILE_COUNT" > ${DIR}/nabi_touch_${STAMP}.uploads.manifest
# docker run --rm -v VOLUME:/data:ro alpine tar -C /data -czf - . \
#   | openssl enc -aes-256-gcm -pbkdf2 -iter 200000 -salt \
#     -out ${DIR}/nabi_touch_${STAMP}.uploads.tar.gz.aesgcm -pass env:BACKUP_PASSPHRASE
# sha256sum … > ….sha256 ; chmod 600 …
```

**Validate legacy (disposable host/dir only):** decrypt DB to new DB name; compare collection counts; decrypt uploads to empty dir; compare file count to manifest; shred plaintext.

**STOP (A2):** wrong DB name; uploads archive missing; file count mismatch; plaintext left in `/tmp`.

---

### A3. Off-host transfer — **BLOCKED** until destination named

When owner sets destination:

```bash
export OFFHOST_DESTINATION='user@backup-host:/absolute/directory'
# Directory must already exist
CONFIRM_OFFHOST_TRANSFER=yes deploy/private-release/transfer-encrypted-backup.sh \
  /root/nabitouch-next-backups/nabitouch_prod_<stamp>.archive.gz.aesgcm
# Repeat for each nabi_touch_*.aesgcm (script is Stage-C-oriented; for legacy ciphertext
# use scp of .aesgcm + .sha256 + optional manifest with the same remote checksum compare).
```

**Expected:** `Off-host ciphertext stored: …` exit 0.  
**Until then:** report status **BLOCKED**; local encrypted copies alone are incomplete for cutover.

---

## Global STOP conditions (Gate A)

- No explicit owner approval for Gate A  
- `CONFIRM_*` not exactly `yes`  
- `DB_NAME` ≠ `nabitouch_prod` or Emergent target ≠ `nabi_touch`  
- Disk &lt; ~2 GiB free  
- Checksum mismatch  
- Isolated restore targeted at live mongo  
- Uploads volume omitted from A2  
- Backup passphrase or `FIELD_ENCRYPTION_KEY` recovery unproven / not in password manager  
- Off-host treated as done while still BLOCKED  
- Any Nginx, deploy, PR merge, or Stripe change bundled into Gate A  

---

## Gate A completion criteria (for owner sign-off after execution)

1. `nabitouch_prod_*.aesgcm` + matching `.sha256` + `.manifest`  
2. Isolated restore exit 0 + cleanup  
3. `nabi_touch_*.aesgcm` + `.sha256`  
4. `nabi_touch_*.uploads.*.aesgcm` + `.sha256` + file-count manifest  
5. Passphrases stored in password manager; `FIELD_ENCRYPTION_KEY` recovery attested  
6. Off-host: either completed with matching remote digests, or explicitly accepted as **deferred BLOCKED** with written risk acceptance  

**Not part of Gate A:** private deploy (B), Nginx (D), Stripe (F/G), PR merge (E).
