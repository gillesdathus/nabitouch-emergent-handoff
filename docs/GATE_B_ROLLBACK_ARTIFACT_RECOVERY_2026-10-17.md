# Gate B — Rollback artifact recovery (2026-10-17)

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff` @ `eed6b95`  
**Application RC:** `0a0d8c74336299bce9958bd39ede2769201a4fd5` (`0a0d8c7`)  
**Gate B deploy:** **not executed**  
**Public cutover / Nginx / PR merge / Stripe:** **NO-GO / not authorized**  
**`nt-next-api:local`:** preserved (not overwritten, removed, rebuilt, or retagged)

## 1. Available image digests (VPS)

| Tag / identity | Digest | Status |
| --- | --- | --- |
| `nt-next-api:local` (running `nt-next-api`) | `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465` | **Present** — matches `PRE_DEPLOY_LOCAL_DIGEST` |
| `nt-next-api:9aca5eccdc3c` | (historically same digest as local) | **Tag missing** |
| `nt-next-api:rollback-0081eac25d1e` | `sha256:0081eac25d1edc251fb45d46ac8351008fffad0afbe5fe87eb9882f59745f7b6` | **Image missing** |

No other `nt-next-api` tags exist on the host. No dangling layers for `0081eac2…`.

## 2. Recoverability of original rollback images

| Artifact | Recoverable from host? | Evidence |
| --- | --- | --- |
| `rollback-0081eac25d1e` (`0081eac2…`) | **No** | Not in `docker images`; no `docker save` tar; not in `/root/nt-release`; not in staging `images.tar` (that archive is `nabitouch-staging` `97fde6f`, unrelated) |
| `9aca5eccdc3c` **tag** | **Tag only** | Docs (`PRODUCTION_READ_ONLY_PREFLIGHT.md`, `BACKUP_FIRST_DEPLOYMENT_ROLLBACK.md`) record that this tag previously pointed at the **same** digest as today’s `local` (`f6a73339…`). The git tree for `9aca5eccdc3c97bef09a2e750a2ec0d5fc81c69f` remains at `/root/nt-release/9aca5ec/` (`SOURCE_SHA` + `source.tar.gz`), but that is **source**, not the historical `0081eac` image. |

**Conclusion:** The historical hard-rollback image `0081eac25d1e…` (commit `35c9082` per rollback runbook) is **not recoverable** from authorized locations on this VPS or the Windows checkout search. Rebuilding from source would produce a **new** digest and must not be labeled as `rollback-0081eac25d1e`.

## 3. Immutable copy of current working image (prepared — not substituted)

Without retagging `local`, an offline copy was written:

| File | Path |
| --- | --- |
| Image tar | `/root/nt-release/gate-b-prep/nt-next-api-local-f6a7333986f7.image.tar` |
| SHA-256 | `a111e3d0dedd5df5828d8d89b9fb637eca731cdc2f3d61e038eb3494d27c301a` (sidecar `.sha256`) |

Post-save inspect: `nt-next-api:local` still `sha256:f6a73339…` only (`LOCAL_PRESERVED=PASS`).

This tar is a **named interim safety copy**, not a silent stand-in for `0081eac25d1e`.

## 4. Proposed rollback strategy (requires owner approval)

### Preferred (if image tar of `0081eac` is found off-host)

1. `docker load` the authentic `0081eac25d1e` archive.  
2. Confirm `docker image inspect nt-next-api:rollback-0081eac25d1e --format '{{.Id}}'` equals pin `ROLLBACK_DIGEST`.  
3. Restore additive tag only: `docker tag nt-next-api:local nt-next-api:9aca5eccdc3c` (same digest; does not change what `local` points to).  
4. Leave `release-pin.conf` digests unchanged.  
5. Then authorize Gate B.

### Interim alternative (if `0081eac` remains unavailable)

Document explicitly that historical hard rollback is lost; use the **current known-good** digest as the only available rollback target:

| Pin field | Current value | Proposed interim value |
| --- | --- | --- |
| `PRE_DEPLOY_LOCAL_DIGEST` | `sha256:f6a73339…` | unchanged |
| `PREVIOUS_GOOD_TAG` | `nt-next-api:9aca5eccdc3c` | restore **additive** tag on `f6a73339…` (same bytes as today) |
| `ROLLBACK_TAG` | `nt-next-api:rollback-0081eac25d1e` | e.g. `nt-next-api:pre-gate-b-f6a73339` (new name) |
| `ROLLBACK_DIGEST` | `sha256:0081eac25d1e…` | `sha256:f6a7333986f70d24d22af50d7d886a9c4f080bef8b9484b2154614a8845d7465` |

Notes:

- Auto-fail path in `deploy-private-api.sh` retags `PREVIOUS_GOOD_TAG` → `:local` (not the rollback tag).  
- Changing `ROLLBACK_*` weakens the original “older than baseline” hard rollback; it must be an **explicit owner pin change**, not a silent retag of `0081eac`.  
- Load path for interim tag: `docker load` from the prepared tar **or** additive `docker tag nt-next-api:local nt-next-api:pre-gate-b-f6a73339` after approval (still leaves `:local` intact).

## 5. Source transfer (prepared)

### Integrity facts

| Item | Value |
| --- | --- |
| Windows HEAD archived | `eed6b95e000eba7f87220c07a1469c81b6f4f25f` |
| `git diff 0a0d8c7 HEAD -- backend frontend` | **empty** (application RC content match) |
| `release-pin.conf` | **not** in tree at `0a0d8c7`; present from `b9c714a` onward — required for current deploy script |
| Archive on VPS | `/root/nt-release/gate-b-prep/nabitouch-gate-b-src-HEAD-eed6b95-app-rc-0a0d8c7.tar.gz` |
| Archive SHA-256 | `b486244ec904f7a727953bafe8b98e4dbdf1b8e7ab9ba75e1fd98517f0d4117f` (`sha256sum -c` **OK**) |
| Exclusions | `git archive` of tracked files only — no `.env`, passphrase files, or `.aesgcm` |

### Exact procedure (already executed for prep; repeatable)

```powershell
# On Windows approved checkout
cd "C:\Users\DG Solutions\nabitouch-emergent-handoff"
git rev-parse HEAD   # expect eed6b95… or later docs-only
git diff --quiet 0a0d8c74336299bce9958bd39ede2769201a4fd5 HEAD -- backend frontend
$out = "$env:TEMP\nabitouch-gate-b-prep"
New-Item -ItemType Directory -Force -Path $out | Out-Null
git archive --format=tar.gz --prefix=nabitouch-gate-b/ --output="$out\nabitouch-gate-b-src.tar.gz" HEAD
Get-FileHash "$out\nabitouch-gate-b-src.tar.gz" -Algorithm SHA256
scp -i $env:USERPROFILE\.ssh\id_ed25519 `
  "$out\nabitouch-gate-b-src.tar.gz" "$out\nabitouch-gate-b-src.tar.gz.sha256" `
  root@187.77.204.131:/root/nt-release/gate-b-prep/
```

```bash
# On VPS — extract to a path that is NOT /opt/nt-next
mkdir -p /root/nabitouch-rc && cd /root/nabitouch-rc
sha256sum -c /root/nt-release/gate-b-prep/nabitouch-gate-b-src-HEAD-eed6b95-app-rc-0a0d8c7.tar.gz.sha256
tar -xzf /root/nt-release/gate-b-prep/nabitouch-gate-b-src-HEAD-eed6b95-app-rc-0a0d8c7.tar.gz
# Initialize git so deploy-private-api.sh can rev-parse / diff against RC:
cd nabitouch-gate-b
git init && git add -A && git commit -m "gate-b source eed6b95 (backend/frontend == 0a0d8c7)"
# Optionally: git fetch and checkout exact objects if a remote is configured later
```

Deploy must run from that extracted tree (or a real clone), never `/opt/nt-next`.

## 6. Required deployment-pin changes

| If | Pin change |
| --- | --- |
| `0081eac` image restored from authentic tar | **None** — keep current `ROLLBACK_*` |
| Interim strategy approved | Update `ROLLBACK_TAG` / `ROLLBACK_DIGEST` as in §4; document loss of `0081eac` in pin comments; keep `APPLICATION_SHA=0a0d8c7` and `PRE_DEPLOY_LOCAL_DIGEST=f6a73339…` |

No pin file was modified in this recovery pass.

## 7. Remaining owner approvals

1. **Locate / provide** authentic `docker save` of `sha256:0081eac25d1e…` if it exists off-host — **or**  
2. **Authorize interim pin change** (§4) acknowledging historical hard rollback is unavailable.  
3. Authorize **additive** tag `nt-next-api:9aca5eccdc3c` → same digest as `:local` (optional but matches prior ops docs).  
4. Authorize extract + `git init` of transferred source under `/root/nabitouch-rc/…`.  
5. Then **retry Gate B** (`CONFIRM_PRIVATE_DEPLOY=yes`) — still no Nginx / Stripe / PR merge.

## Explicit non-actions this document

- Did not run Gate B deploy  
- Did not retag, rebuild, or replace `nt-next-api:local`  
- Did not change public Nginx, merge PR #1, activate Stripe, or modify production data  
- Did not label any new/rebuilt image as `rollback-0081eac25d1e`  
