# Gate A — Windows PC off-host backup pull

**Status:** Directory + script ready. **Production transfer BLOCKED** until the owner runs `-ConfirmTransfer`.

**Owner-approved destination:** `C:\Nabitouch-Backups`  
(`D:` absent; `G:` Google Drive path retired for this workflow.)

**Method:** Outbound SSH/SCP from Windows to `root@187.77.204.131` using `%USERPROFILE%\.ssh\id_ed25519`. No inbound Windows SSH; no router changes.

**Checkout:** `C:\Users\DG Solutions\nabitouch-emergent-handoff` · `feature/codex-production-readiness`

## Script

`deploy/private-release/pull-gate-a-backups.ps1`

| Mode | Command |
| --- | --- |
| Synthetic self-test | `powershell -NoProfile -ExecutionPolicy Bypass -File deploy\private-release\pull-gate-a-backups.ps1 -SelfTest -LocalRoot C:\Nabitouch-Backups` |
| Dry-run | `powershell -NoProfile -ExecutionPolicy Bypass -File deploy\private-release\pull-gate-a-backups.ps1 -LocalRoot C:\Nabitouch-Backups -Stamp 20261017T085834Z -DryRun` |
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
C:\Nabitouch-Backups\
C:\Nabitouch-Backups\logs\
```

## Windows permissions

```powershell
New-Item -ItemType Directory -Force -Path 'C:\Nabitouch-Backups','C:\Nabitouch-Backups\logs' | Out-Null
icacls 'C:\Nabitouch-Backups' /inheritance:r
icacls 'C:\Nabitouch-Backups' /grant:r "$env:USERNAME:(OI)(CI)F"
icacls 'C:\Nabitouch-Backups' /grant:r 'SYSTEM:(OI)(CI)F'
```

Keep the SSH private key in `%USERPROFILE%\.ssh\` — never copy it into the backup folder.  
Passphrase: password manager only.

## Access check

Existing `root@187.77.204.131` identity can read `/root/nabitouch-next-backups/`. No permission broadening required.

## Owner-approved transfer command (do not run until authorized)

```powershell
cd "C:\Users\DG Solutions\nabitouch-emergent-handoff"
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\private-release\pull-gate-a-backups.ps1 `
  -LocalRoot "C:\Nabitouch-Backups" `
  -Stamp 20261017T085834Z `
  -ConfirmTransfer
```

## Remaining owner items

- Authorize the transfer command above.
- Confirm passphrase in password manager; then authorize shred of VPS temp passfile.
- Public cutover / PR #1 / Nginx / Stripe remain **NO-GO**.
