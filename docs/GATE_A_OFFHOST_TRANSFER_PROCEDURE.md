# Gate A — Off-host transfer procedure (not executed)

**Status: BLOCKED** until the owner authorizes `-ConfirmTransfer` (path approved).

**Owner-selected destination (2026-10-17):** Windows PC `C:\Nabitouch-Backups` via **outbound** SSH/SCP pull (no inbound Windows SSH; no router changes).

Primary runbook: `docs/GATE_A_WINDOWS_OFFHOST_PULL.md`  
Script: `deploy/private-release/pull-gate-a-backups.ps1`

Do not create cloud accounts. Do not email archives. Do not treat `/root/nabitouch-next-backups` alone as off-host.

## VPS-push alternative (not selected)

The Stage C `OFFHOST_DESTINATION=user@host:/dir` push pattern below remains documented for a future Linux backup host. It is **not** the active Windows-PC plan.

## Destination requirements

| Requirement | Detail |
| --- | --- |
| Form | `OFFHOST_DESTINATION=user@backup-host:/absolute/directory` |
| Auth | SSH public-key only (`BatchMode=yes`; no password on CLI) |
| Remote dir | Already exists; mode `700`; not this VPS hostname |
| Remote tools | `stat`, `sha256sum` |
| Refuse | localhost / `127.0.0.1` / `srv1393944` (enforced by Stage C checks for the Stage C transfer script) |

## Archives to copy (all three families)

From `/root/nabitouch-next-backups/` stamp `20261017T085834Z`:

1. `nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm` (+ `.sha256` + `.manifest`)
2. `nabi_touch_20261017T085834Z.archive.gz.aesgcm` (+ `.sha256`)
3. `nabi_touch_20261017T085834Z.uploads.tar.gz.aesgcm` (+ `.sha256` + `.uploads.manifest`)

Also copy (once, with the ciphertext set):

- `deploy/private-release/gate_a_aesgcm.py` (decrypt helper)
- Note: dependency `cryptography>=41` on the recovery host

**Do not** copy `GATE_A_PASSPHRASE_RECOVER_ONCE.txt` off-host. Passphrase stays in the password manager only.

## Stage C transfer script (A1-style paths)

`transfer-encrypted-backup.sh` expects Stage C naming and a `.manifest` with `consistency=oplog`. The Gate A A1 archive uses `consistency=database` and a `.db.` filename, so use **manual scp with checksum compare** for all three Gate A ciphertexts (below). Optionally adapt Stage C later after an oplog-capable backup exists.

## Approved command pattern (after destination is named)

```bash
# On srv1393944 as root — OWNER must set DEST first
export OFFHOST_DESTINATION='user@backup-host:/absolute/locked-dir'
DestHost="${OFFHOST_DESTINATION%%:*}"
DestDir="${OFFHOST_DESTINATION#*:}"
Base=/root/nabitouch-next-backups
Stamp=20261017T085834Z

transfer_one() {
  local src="$1"
  local base remote_partial remote_final
  base="$(basename -- "$src")"
  remote_partial="${DestDir}/${base}.partial"
  remote_final="${DestDir}/${base}"
  scp -o BatchMode=yes "$src" "${DestHost}:${remote_partial}"
  scp -o BatchMode=yes "${src}.sha256" "${DestHost}:${remote_partial}.sha256"
  # optional companions
  [ -f "${src}.manifest" ] && scp -o BatchMode=yes "${src}.manifest" "${DestHost}:${remote_partial}.manifest"
  local expected actual
  expected="$(awk 'NR==1 {print $1}' "${src}.sha256")"
  actual="$(ssh -o BatchMode=yes "$DestHost" "sha256sum '${remote_partial}'" | awk 'NR==1 {print $1}')"
  [ "$expected" = "$actual" ] || { echo "STOP checksum mismatch $base"; exit 4; }
  ssh -o BatchMode=yes "$DestHost" \
    "mv '${remote_partial}' '${remote_final}' && mv '${remote_partial}.sha256' '${remote_final}.sha256' && chmod 600 '${remote_final}' '${remote_final}.sha256' && ([ -f '${remote_partial}.manifest' ] && mv '${remote_partial}.manifest' '${remote_final}.manifest' || true)"
  echo "Off-host stored: ${remote_final}"
}

# OWNER APPROVAL REQUIRED before running:
# transfer_one "$Base/nabitouch_prod_${Stamp}.db.archive.gz.aesgcm"
# transfer_one "$Base/nabi_touch_${Stamp}.archive.gz.aesgcm"
# transfer_one "$Base/nabi_touch_${Stamp}.uploads.tar.gz.aesgcm"
# scp gate_a_aesgcm.py to the same remote dir
```

## Verification after transfer

On the remote host: recompute `sha256sum` of each ciphertext and match the `.sha256` file. Do not decrypt off-host unless that host is the approved recovery workstation.

## STOP

- Destination unset or points at this VPS  
- Checksum mismatch  
- Attempt to copy the passphrase file  
- Transfer without written owner approval of `OFFHOST_DESTINATION`  
