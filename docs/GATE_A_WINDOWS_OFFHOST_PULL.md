# Gate A — Windows PC off-host backup pull

**Status:** Directory + script ready. **Production transfer BLOCKED** until the owner runs `-ConfirmTransfer`.

## Destination (owner decision + filesystem fact)

| Requested | `G:\Nabitouch-Backups` |
| --- | --- |
| Drive `G:` | Google Drive virtual volume (not a local NTFS disk; `D:` absent) |
| Writable path | **`G:\My Drive\Nabitouch-Backups`** |
| Why | Google Drive only allows writes under `G:\My Drive\...`. Creating `G:\Nabitouch-Backups` at volume root fails. |

Treat `G:\My Drive\Nabitouch-Backups` as the approved implementation of the owner’s `G:\Nabitouch-Backups` decision unless the owner names a different local disk later.

**Method:** Outbound SSH/SCP from Windows to `root@187.77.204.131` using `%USERPROFILE%\.ssh\id_ed25519`. No inbound Windows SSH; no router changes.

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff` · `feature/codex-production-readiness`

## Script

`deploy/private-release/pull-gate-a-backups.ps1`

| Mode | Command |
| --- | --- |
| Synthetic self-test | `powershell -NoProfile -ExecutionPolicy Bypass -File deploy\private-release\pull-gate-a-backups.ps1 -SelfTest -LocalRoot "G:\My Drive\Nabitouch-Backups"` |
| Dry-run | `powershell -NoProfile -ExecutionPolicy Bypass -File deploy\private-release\pull-gate-a-backups.ps1 -LocalRoot "G:\My Drive\Nabitouch-Backups" -Stamp 20261017T085834Z -DryRun` |
| Owner-approved transfer | See command below |

### Behavior

1. Lists `/root/nabitouch-next-backups/` over SSH (`BatchMode=yes`).
2. Allowlists Gate A / Stage C `*.aesgcm` names; requires matching `*.aesgcm.sha256`.
3. Downloads to `*.partial` / `*.sha256.partial`.
4. Verifies local SHA-256; deletes partials on mismatch.
5. Renames to final names only after verification.
6. Existing finals are **skipped** (no overwrite, no auto-delete).
7. Refuses passphrase files, plaintext dumps, `.err` logs.

Logs: filenames + checksum hex only.

## Directory layout

```
G:\My Drive\Nabitouch-Backups\
G:\My Drive\Nabitouch-Backups\logs\
```

## Windows / Google Drive notes

- Full NTFS `icacls` lockdown may be limited on the Google Drive filesystem; keep the Windows user account locked and do not share the folder broadly in Drive UI.
- Prefer Drive sync as already-off-host storage for **ciphertext only**.
- Never place the SSH private key or backup passphrase in this folder.
- Passphrase: password manager only.

## Access check (completed)

Existing `root@187.77.204.131` identity can list and read `/root/nabitouch-next-backups/` (`REMOTE_READ_OK`). No permission broadening required.

## Owner-approved transfer command (do not run until authorized)

```powershell
cd "C:\Users\DG Solutions\nabitouch-emergent-handoff"
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\private-release\pull-gate-a-backups.ps1 `
  -LocalRoot "G:\My Drive\Nabitouch-Backups" `
  -Stamp 20261017T085834Z `
  -ConfirmTransfer
```

## Remaining owner items

- Authorize the transfer command above.
- Confirm passphrase in password manager; then authorize shred of VPS temp passfile.
- Public cutover / PR #1 / Nginx / Stripe remain **NO-GO**.
