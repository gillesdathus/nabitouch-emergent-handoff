# Gate A — Backup execution result (2026-10-17)

**Host:** `srv1393944` (`187.77.204.131`)  
**Authority:** Stage C scripts from `/opt/nabitouch/app`; A2/A3 custom encrypt; passphrase recovery path documented below.  
**Public deployment:** remains **NO-GO**. No deploy, merge, Nginx, production writes, or Stripe activation.

## Status matrix (recovery finalization)

| Check | Status | Notes |
| --- | --- | --- |
| Local backup (A1–A3) | **PASS** | Ciphertexts + SHA-256 on VPS under `/root/nabitouch-next-backups/` |
| Isolated restore | **PASS** | Temp DB `gate_a_restore_*` + temp uploads extract; cleaned after verify |
| Passphrase recovery (password manager) | **VERIFIED** | Owner confirmed retrieve from approved password manager (no secret in git/chat) |
| Off-host recovery | **PASS** | All three archives at `C:\Nabitouch-Backups`; SHA-256 verified — see `GATE_A_OFFHOST_TRANSFER_RESULT_2026-10-17.md` |
| VPS temp passphrase cleanup | **DEFERRED** | Owner authorized shred; blocked until SSH returns (Hostinger emergency maintenance) |
| Oplog-consistent backup | **NOT VERIFIED** | App user lacks `local.oplog.rs`; DB-scoped dump only |
| Gate B private deploy | **HELD** | Authorized by owner; not executed — VPS unreachable during Hostinger kernel patching |

## Archives (stamp `20261017T085834Z`)

### On VPS (`/root/nabitouch-next-backups/`)

| Artifact | Approx size |
| --- | ---: |
| `nabitouch_prod_20261017T085834Z.db.archive.gz.aesgcm` | ~10.7 KB |
| `nabi_touch_20261017T085834Z.archive.gz.aesgcm` | ~14 KB |
| `nabi_touch_20261017T085834Z.uploads.tar.gz.aesgcm` | ~50.7 MB |

### Off-host (`C:\Nabitouch-Backups`) — SHA-256 PASS

Same three families + `.sha256` sidecars; digests recorded in `GATE_A_OFFHOST_TRANSFER_RESULT_2026-10-17.md`.

Companions on VPS: A1 `.manifest`; uploads `.uploads.manifest`.

### Recovery inventory (both Mongo + uploads)

Disaster recovery must restore **all three** families:

1. `nabitouch_prod_*.db.archive.gz.aesgcm` — private release DB  
2. `nabi_touch_*.archive.gz.aesgcm` — legacy Emergent DB  
3. `nabi_touch_*.uploads.tar.gz.aesgcm` — legacy upload files  

## Encryption / decrypt helper (DR)

| Item | Detail |
| --- | --- |
| Format | `NTA1GCM1` (magic + salt + nonce + ciphertext+tag) |
| KDF | PBKDF2-HMAC-SHA256, 200000 iterations |
| Cipher | AES-256-GCM |
| Helper (repo) | `deploy/private-release/gate_a_aesgcm.py` |
| Dependency | `cryptography>=41` (Python 3) |

## Passphrase handling

| Location | Status |
| --- | --- |
| Password manager | **VERIFIED** — owner can retrieve (do not paste into chat) |
| Temp file `/root/nabitouch-next-backups/GATE_A_PASSPHRASE_RECOVER_ONCE.txt` | **Still on VPS** — shred authorized, **deferred** until SSH restored |
| After SSH returns | `shred -u` the temp file only; never commit |

## Hostinger maintenance hold (2026-10-17)

Hostinger emergency maintenance (kernel CVE patching; VPS restart batches) made `187.77.204.131` unreachable (SSH/ping timeout). While the hold lasts:

- Do **not** run Gate B (`CONFIRM_PRIVATE_DEPLOY`) until connectivity returns and owner re-confirms or says **retry Gate B**.  
- Do **not** shred the VPS passphrase file until SSH works.  
- Public cutover, PR #1 merge, Nginx changes, and Stripe activation remain **unauthorized / NO-GO**.

## DB-scoped / oplog limitation (do not escalate without approval)

`ntnext` has `readWrite` on `nabitouch_prod` only — no `local.oplog.rs`. Consistency mode is `database`, not `oplog`.

## Owner actions remaining

1. **When SSH returns:** shred VPS `GATE_A_PASSPHRASE_RECOVER_ONCE.txt` (already authorized).  
2. **When SSH returns:** **retry Gate B** private loopback deploy (already authorized; not executed).  
3. **Optional:** Mongo backup role for oplog-consistent dumps.  
4. Gates C–G, PR merge, Nginx cutover, Stripe — separate approvals only.

## Explicit non-actions

- No production application deploy completed under this hold  
- No Nginx change  
- No Draft PR #1 merge  
- No Stripe activation  
