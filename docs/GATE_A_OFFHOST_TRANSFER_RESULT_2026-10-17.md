# Gate A — Off-host transfer execution result (2026-10-17)

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff`  
**Commit at transfer:** `f6af220`  
**Script:** `deploy/private-release/pull-gate-a-backups.ps1`  
**Destination:** `C:\Nabitouch-Backups`  
**Remote:** `root@187.77.204.131:/root/nabitouch-next-backups`  
**Stamp:** `20261017T085834Z`  
**Public cutover:** remains **NO-GO**

## Verdict

| Check | Status |
| --- | --- |
| Off-host recovery (Windows PC) | **PASS** |
| Local SHA-256 verification | **PASS** (all three) |
| Forbidden files absent | **PASS** (no passphrase / plaintext dumps / `.err`) |
| Partials left behind | **PASS** (none) |
| Passphrase file pulled | **No** (refused by policy; remains on VPS only) |

## Archives on `C:\Nabitouch-Backups`

| File | Bytes | SHA-256 (match sidecar) |
| --- | ---: | --- |
| `nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm` | 10 754 | `02084fa4cb0146ce6c5c944e1735db091f93acdd88a18bf9e01d5a1ac6f7430e` |
| `nabi_touch_20261017T085834Z.archive.gz.aesgcm` | 14 330 | `21c28f044c5dd4bdf40978404ec0e33b4851ebf0e3e17a08fe99f5d3dc8cfe40` |
| `nabi_touch_20261017T085834Z.uploads.tar.gz.aesgcm` | 50 677 595 | `0bc24c0f96f2b28a420cb7bb262ccce943f63c4c63b455bca96e617fc80c362f` |

Companions: matching `*.aesgcm.sha256` for each (65 bytes).

File timestamps on disk: **2026-10-17 ~03:46 local** (initial pull).  
ConfirmTransfer run at **~09:47 UTC / 03:47 local** saw all three finals already present, **skipped overwrite** (`verified=0` this invocation), then operator re-verified SHA-256 → **ALL_SHA_OK**.

Operator log: `C:\Nabitouch-Backups\logs\transfer_20261017T085834Z.log`

## Policy refusals (not transferred)

- `GATE_A_PASSPHRASE_RECOVER_ONCE.txt`
- Plaintext `nabitouch_prod-*.archive.gz` (2026-10-13)
- `mongodump` / `mongorestore` / cleanup `.err` logs

## Remaining Gate A owner items

1. Confirm passphrase recovery in the password manager.  
2. Authorize shred of VPS `GATE_A_PASSPHRASE_RECOVER_ONCE.txt`.  
3. Oplog-consistent backup remains **NOT VERIFIED** (separate approval if desired).

PR #1 merge, Nginx cutover, and Stripe remain out of scope / **NO-GO**.
