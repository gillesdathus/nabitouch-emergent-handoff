# Gate A — Backup execution result (2026-10-17)

**Host:** `srv1393944` (`187.77.204.131`)  
**Authority:** Stage C scripts from `/opt/nabitouch/app`; A2/A3 custom encrypt; passphrase recovery path documented below.  
**Public deployment:** remains **NO-GO**. No deploy, merge, Nginx, production writes, or Stripe activation.

## Status matrix (recovery finalization)

| Check | Status | Notes |
| --- | --- | --- |
| Local backup (A1–A3) | **PASS** | Ciphertexts + SHA-256 on VPS under `/root/nabitouch-next-backups/` |
| Isolated restore | **PASS** | Temp DB `gate_a_restore_*` + temp uploads extract; cleaned after verify |
| Passphrase recovery | **PENDING** | Owner must confirm password-manager retrieve; then shred temp file |
| Off-host recovery | **PASS** | `C:\Nabitouch-Backups` stamp `20261017T085834Z`; see `GATE_A_OFFHOST_TRANSFER_RESULT_2026-10-17.md` |
| Oplog-consistent backup | **NOT VERIFIED** | App user lacks `local.oplog.rs`; DB-scoped dump only |

## Archives (stamp `20261017T085834Z`)

| Artifact | Path | Approx size |
| --- | --- | --- |
| Prod Mongo (DB-scoped) | `/root/nabitouch-next-backups/nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm` | ~10.7 KB |
| Legacy Mongo | `/root/nabitouch-next-backups/nabi_touch_20261017T085834Z.archive.gz.aesgcm` | ~14 KB |
| Legacy uploads | `/root/nabitouch-next-backups/nabi_touch_20261017T085834Z.uploads.tar.gz.aesgcm` | ~50.7 MB |

Companions: `.sha256` for each; A1 `.manifest`; uploads `.uploads.manifest`.

### Recovery inventory (both Mongo + uploads)

Disaster recovery must restore **all three** families:

1. `nabitouch_prod_*.db.archive.gz.aesgcm` — private release DB  
2. `nabi_touch_*.archive.gz.aesgcm` — legacy Emergent DB  
3. `nabi_touch_*.uploads.tar.gz.aesgcm` — legacy upload files  

Missing any one family is an incomplete Gate A recovery set.

## Encryption / decrypt helper (DR)

| Item | Detail |
| --- | --- |
| Format | `NTA1GCM1` (magic + salt + nonce + ciphertext+tag) |
| KDF | PBKDF2-HMAC-SHA256, 200000 iterations |
| Cipher | AES-256-GCM |
| Helper (repo) | `deploy/private-release/gate_a_aesgcm.py` |
| Dependency | `cryptography>=41` (Python 3) |
| Why not OpenSSL CLI | Host OpenSSL 3.0.13 has no `enc -aes-256-gcm` |

Isolated decrypt smoke (no passphrase print): `deploy/private-release/gate_a_decrypt_smoke.sh`  
**Executed on VPS 2026-10-17:** `SYNTHETIC_ROUNDTRIP=PASS`, `A1_DECRYPT_GZIP_MAGIC=PASS`, `GATE_A_DECRYPT_SMOKE=PASS` (A1 → 10702-byte gzip; plaintext shredded; passfile untouched).  
Helper preserved at repo `deploy/private-release/gate_a_aesgcm.py` and VPS `/root/gate-a-work/gate_a_aesgcm.py`. Dependency: `cryptography>=41`.

## Passphrase handling

| Location | Status |
| --- | --- |
| Temp file `/root/nabitouch-next-backups/GATE_A_PASSPHRASE_RECOVER_ONCE.txt` | **Still present** until owner confirms PM recovery |
| Password manager | **Owner action** — transfer + retrieve verify (do not paste into chat) |
| After owner confirms | `shred -u` (or `rm` after overwrite) the temp file; never commit |

## DB-scoped / oplog limitation (do not escalate without approval)

`ntnext` (app Mongo user) has `readWrite` on `nabitouch_prod` only. Stage C oplog-consistent backup requires read on `local.oplog.rs`, which this principal **does not** have.

| Consequence | Detail |
| --- | --- |
| Consistency mode | `consistency=database` (manifest), not `oplog` |
| Point-in-time | **NOT VERIFIED** for oplog-aligned restore |
| Privilege change | **Do not** grant broader MongoDB roles without explicit owner approval |

## Off-host transfer

Procedure (not executed): `docs/GATE_A_OFFHOST_TRANSFER_PROCEDURE.md`  
Uses existing trusted SSH destination pattern; copies all three ciphertext families + decrypt helper; **never** the passphrase file.

## Deviations from Stage C ideal

1. Oplog backup refused → DB-scoped dump.  
2. OpenSSL AEAD unavailable → Python `gate_a_aesgcm.py`.  
3. Off-host not run (policy).  
4. Passphrase temp file retained pending owner PM confirmation.

## Owner actions remaining to close Gate A

1. **Passphrase:** Confirm retrieval from the approved password manager succeeds (without sharing the secret in chat). Reply that PM recovery is confirmed.  
2. **Shred:** After (1), authorize removal of `GATE_A_PASSPHRASE_RECOVER_ONCE.txt` on the VPS.  
3. **Off-host:** Completed to `C:\Nabitouch-Backups` (stamp `20261017T085834Z`).  
4. **Optional / separate approval:** Mongo role for oplog-consistent backups (only if desired; not required to keep local+isolated PASS as documented).  

Gates B–G, PR #1 merge, Nginx cutover, and Stripe remain out of scope for Gate A close.
