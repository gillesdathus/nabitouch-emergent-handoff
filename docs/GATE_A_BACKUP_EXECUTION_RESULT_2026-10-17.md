# GATE A — Backup execution result (17 October 2026)

**Authorization:** Gate A only (owner).  
**Host:** `srv1393944`  
**Stamp:** `20261017T085834Z`  
**Public cutover / deploy / Nginx / Stripe / PR merge:** not performed.

## Summary

| Item | Result |
| --- | --- |
| A1 `nabitouch_prod` | **PASS** (encrypted DB-scoped dump + isolated restore) |
| A2 `nabi_touch` | **PASS** |
| A3 uploads volume | **PASS** (19/19 files) |
| Stage C oplog path | **BLOCKED** — `ntnext` has `readWrite` on `nabitouch_prod` only; cannot read `local.oplog.rs` |
| Host `openssl enc -aes-256-gcm` | **Unsupported** (OpenSSL 3.0.13 AEAD); used Python `NTA1GCM1` AES-GCM helper instead |
| Off-host transfer | **BLOCKED** (no destination) |
| Live DB overwrite | **None** — restores used throwaway `nt-restore-*` with remapped DB names; containers removed |

## Archives (preserved on VPS)

Directory: `/root/nabitouch-next-backups/` (mode `700`)

| File | Size (bytes) | SHA-256 (file = actual) |
| --- | ---: | --- |
| `nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm` | 10 754 | `02084fa4cb0146ce6c5c944e1735db091f93acdd88a18bf9e01d5a1ac6f7430e` **PASS** |
| `nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm.sha256` | 65 | — |
| `nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm.manifest` | 371 | notes `consistency=database` |
| `nabi_touch_20261017T085834Z.archive.gz.aesgcm` | 14 330 | `21c28f044c5dd4bdf40978404ec0e33b4851ebf0e3e17a08fe99f5d3dc8cfe40` **PASS** |
| `nabi_touch_20261017T085834Z.archive.gz.aesgcm.sha256` | 65 | — |
| `nabi_touch_20261017T085834Z.uploads.tar.gz.aesgcm` | 50 677 595 | `0bc24c0f96f2b28a420cb7bb262ccce943f63c4c63b455bca96e617fc80c362f` **PASS** |
| `nabi_touch_20261017T085834Z.uploads.tar.gz.aesgcm.sha256` | 65 | — |
| `nabi_touch_20261017T085834Z.uploads.manifest` | 88 | `pre_upload_files=19` |
| `GATE_A_REPORT_20261017T085834Z.txt` | — | operator log (no secrets) |
| `GATE_A_PASSPHRASE_RECOVER_ONCE.txt` | 45 | **Owner must copy to password manager then `shred -u`** |

Decrypt helper on host: `/root/gate-a-work/gate_a_aesgcm.py` (magic `NTA1GCM1`).

## Restore verification

### A1 `nabitouch_prod`
Isolated container restored to **`nabitouch_prod_restore_check`** (not live name on live mongo):

- collections: **44**
- `nt_services`: **10**
- `nt_media` / invoices / appointments / clients: **0** (matches empty operational data on this private DB)

Throwaway container/volume removed. No `nt-restore-*` left running.

### A2 `nabi_touch`
Restored to **`nabi_touch_restore_check`** on throwaway:

- patients **17**, media_assets **18**, soap_notes **0**, users **1**, services **11**, faqs **6**
- collections **12**

Cleanup done.

### A3 uploads
- Pre-count **19** → post-extract **19** **PASS**
- Volume: `nabitouch-rmt_uploads`

## Encryption / key recovery (no secret values)

| Item | Status |
| --- | --- |
| Backup passphrase | Generated once; stored only in `GATE_A_PASSPHRASE_RECOVER_ONCE.txt` (mode `600`) until owner moves it to a password manager and shreds the file |
| `FIELD_ENCRYPTION_KEY` | Present in `/etc/nabitouch-next.env` (len 44); `/etc/nabitouch-next.recovery-confirmed` **attested** — required to read sealed fields inside a restored `nabitouch_prod` |
| Cipher | AES-256-GCM via Python cryptography, PBKDF2-HMAC-SHA256 200 000 iterations |

## Known deviations / remaining blockers

1. **Stage C oplog backup still BLOCKED** until a MongoDB backup-capable role (e.g. `backup` / read on `local`) is authorized for user `ntnext` or a dedicated backup user. Current roles: `readWrite@nabitouch_prod` only.
2. **Host OpenSSL cannot `enc -aes-256-gcm`** — Gate A used `gate_a_aesgcm.py` instead of `backup-encrypted.sh`’s openssl pipeline.
3. **Off-host transfer BLOCKED** until `OFFHOST_DESTINATION` is configured and separately approved.
4. Owner must **recover the passphrase file** before it is lost/shredded.

## Explicit non-actions

- No Nginx change, no public cutover, no deploy, no PR merge, no Stripe activation  
- No off-host copy  
- No modification of live `nabitouch_prod` or `nabi_touch` document contents  
