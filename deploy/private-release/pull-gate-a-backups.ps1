#Requires -Version 5.1
<#
.SYNOPSIS
  PC-initiated pull of Gate A encrypted backups from the production VPS (outbound SSH/SCP only).

.DESCRIPTION
  Downloads ONLY *.aesgcm ciphertext and matching *.aesgcm.sha256 sidecars from
  /root/nabitouch-next-backups/. Verifies SHA-256, uses .partial names until verified,
  refuses overwrite of existing local recovery copies, and never pulls passphrases,
  plaintext dumps, or unrelated files.

  Does NOT open inbound SSH on Windows. Does NOT change router/firewall for inbound.

.PARAMETER LocalRoot
  Local backup directory. On this PC G: is Google Drive; the writable owner path is
  G:\My Drive\Nabitouch-Backups (G:\Nabitouch-Backups at volume root is not writable).
  Resolution: -LocalRoot / NABITOUCH_OFFHOST_ROOT, else D:\Nabitouch-Backups if D: exists,
  else G:\My Drive\Nabitouch-Backups if that Google Drive path exists.

.PARAMETER DryRun
  List/validate remote candidates and local plan; transfer nothing.

.PARAMETER ConfirmTransfer
  Required (with DryRun:$false) to perform a real download. Without it, refuse transfer.
#>
[CmdletBinding()]
param(
  [string]$LocalRoot = $env:NABITOUCH_OFFHOST_ROOT,
  [string]$RemoteHost = $(if ($env:NABITOUCH_VPS_SSH) { $env:NABITOUCH_VPS_SSH } else { 'root@187.77.204.131' }),
  [string]$RemoteDir = '/root/nabitouch-next-backups',
  [string]$IdentityFile = $(Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
  [string]$Stamp = '',
  [switch]$DryRun,
  [switch]$ConfirmTransfer,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Log {
  param([string]$Level, [string]$Message)
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  Write-Host ("[{0}] {1} {2}" -f $ts, $Level, $Message)
}

function Resolve-LocalRoot {
  param([string]$Requested)
  if (-not [string]::IsNullOrWhiteSpace($Requested)) {
    return [System.IO.Path]::GetFullPath($Requested)
  }
  if (Test-Path -LiteralPath 'D:\') {
    return 'D:\Nabitouch-Backups'
  }
  $gDrive = 'G:\My Drive\Nabitouch-Backups'
  if (Test-Path -LiteralPath 'G:\My Drive') {
    return $gDrive
  }
  $hint = Join-Path $env:USERPROFILE 'Nabitouch-Backups'
  throw ("LocalRoot is required. Set -LocalRoot or NABITOUCH_OFFHOST_ROOT (on this PC use: {0} or {1})." -f $gDrive, $hint)
}

function Test-AllowedCipherName {
  param([string]$Name)
  # Encrypted Gate A / Stage C style only - reject plaintext and passphrase files by shape.
  if ($Name -match '(?i)passphrase|recover_once|\.env$|private.?key') { return $false }
  if ($Name -notmatch '\.aesgcm$') { return $false }
  if ($Name -match '\.archive\.gz$' -and $Name -notmatch '\.aesgcm$') { return $false }
  if ($Name -match '^nabitouch_prod_[0-9]{8}T[0-9]{6}Z\.db\.archive\.gz\.aesgcm$') { return $true }
  if ($Name -match '^nabitouch_prod_[0-9]{8}T[0-9]{6}Z\.archive\.gz\.aesgcm$') { return $true }
  if ($Name -match '^nabi_touch_[0-9]{8}T[0-9]{6}Z\.archive\.gz\.aesgcm$') { return $true }
  if ($Name -match '^nabi_touch_[0-9]{8}T[0-9]{6}Z\.uploads\.tar\.gz\.aesgcm$') { return $true }
  if ($Name -match '^nabitouch_prod-launch-[0-9]{8}\.archive\.gz\.aesgcm$') { return $true }
  return $false
}

function Get-SshArgs {
  param([string]$Identity)
  if (-not (Test-Path -LiteralPath $Identity)) {
    throw "SSH identity not found: $Identity"
  }
  return @(
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=20',
    '-i', $Identity
  )
}

function Invoke-RemoteList {
  param([string]$HostSpec, [string]$Dir, [string[]]$SshArgs)
  $remoteCmd = "ls -1 -- '$Dir' 2>/dev/null || true"
  $raw = & ssh @SshArgs $HostSpec $remoteCmd 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Remote listing failed (exit $LASTEXITCODE): $raw"
  }
  return @($raw | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' })
}

function Get-FileSha256Hex {
  param([string]$Path)
  $hash = Get-FileHash -LiteralPath $Path -Algorithm SHA256
  return $hash.Hash.ToLowerInvariant()
}

function Read-ExpectedSha256 {
  param([string]$ShaPath)
  $line = (Get-Content -LiteralPath $ShaPath -TotalCount 1).Trim()
  if ($line -match '^([A-Fa-f0-9]{64})\b') {
    return $Matches[1].ToLowerInvariant()
  }
  throw "Malformed sha256 sidecar: $ShaPath"
}

function Invoke-SelfTest {
  param([string]$Root)
  Write-Log INFO "SelfTest starting under $Root"
  $dir = Join-Path $Root '_selftest'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $name = 'nabi_touch_20990101T000000Z.archive.gz.aesgcm'
  $cipher = Join-Path $dir $name
  $sha = "$cipher.sha256"
  $partial = "$cipher.partial"
  $partialSha = "$sha.partial"
  [IO.File]::WriteAllBytes($partial, [Text.Encoding]::UTF8.GetBytes('nta1-selftest-ciphertext-not-real'))
  $hex = Get-FileSha256Hex -Path $partial
  Set-Content -LiteralPath $partialSha -Value "$hex  $name" -Encoding ascii -NoNewline
  $expected = Read-ExpectedSha256 -ShaPath $partialSha
  $actual = Get-FileSha256Hex -Path $partial
  if ($expected -ne $actual) { throw 'SelfTest checksum mismatch' }
  Move-Item -LiteralPath $partial -Destination $cipher
  Move-Item -LiteralPath $partialSha -Destination $sha
  if (-not (Test-Path -LiteralPath $cipher)) { throw 'SelfTest rename failed' }
  Remove-Item -LiteralPath $cipher, $sha -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Log INFO 'SelfTest PASS (local partial->verify->rename; no VPS transfer)'
}

# --- main ---
if ($SelfTest) {
  $root = if ($LocalRoot) {
    Resolve-LocalRoot $LocalRoot
  } elseif (Test-Path 'D:\') {
    'D:\Nabitouch-Backups'
  } elseif (Test-Path -LiteralPath 'G:\My Drive') {
    'G:\My Drive\Nabitouch-Backups'
  } else {
    Join-Path $env:TEMP 'Nabitouch-Backups-SelfTest'
  }
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  Invoke-SelfTest -Root $root
  exit 0
}

$resolvedRoot = Resolve-LocalRoot -Requested $LocalRoot
$sshArgs = Get-SshArgs -Identity $IdentityFile

Write-Log INFO "LocalRoot=$resolvedRoot"
Write-Log INFO "RemoteHost=$RemoteHost RemoteDir=$RemoteDir"
Write-Log INFO "IdentityFile=$IdentityFile (path only; key material not logged)"
if ($DryRun) {
  Write-Log INFO 'Mode=DRY-RUN'
} elseif ($ConfirmTransfer) {
  Write-Log INFO 'Mode=TRANSFER'
} else {
  Write-Log INFO 'Mode=REFUSED-NO-CONFIRM'
}

$names = Invoke-RemoteList -HostSpec $RemoteHost -Dir $RemoteDir -SshArgs $sshArgs
$nameSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$names)

$candidates = @()
foreach ($n in $names) {
  if ($Stamp -and ($n -notlike "*$Stamp*")) { continue }
  if (-not (Test-AllowedCipherName -Name $n)) {
    if ($n -match '\.aesgcm$') {
      Write-Log WARN "Skip unexpected aesgcm name: $n"
    }
    continue
  }
  $shaName = "$n.sha256"
  if (-not $nameSet.Contains($shaName)) {
    Write-Log ERROR "Reject $n - missing sidecar $shaName"
    throw "Missing checksum for $n"
  }
  $candidates += [pscustomobject]@{ Cipher = $n; Sha = $shaName }
}

if ($candidates.Count -eq 0) {
  throw 'No allowed encrypted archives with sha256 sidecars matched the filter.'
}

Write-Log INFO ("Candidates={0}" -f $candidates.Count)
foreach ($c in $candidates) {
  Write-Log INFO ("Plan pull: {0} + {1}" -f $c.Cipher, $c.Sha)
}

$refused = @($names | Where-Object {
  ($_ -match '(?i)passphrase|GATE_A_PASSPHRASE') -or
  (($_ -match '\.archive\.gz$') -and ($_ -notmatch '\.aesgcm')) -or
  ($_ -match '\.err$') -or
  ($_ -match '(?i)^mongodump|^mongorestore')
})
foreach ($r in $refused) {
  Write-Log INFO "Refuse (policy): $r"
}

if ($DryRun) {
  Write-Log INFO 'DRY-RUN complete - no files transferred.'
  exit 0
}

if (-not $ConfirmTransfer) {
  throw 'Transfer refused: pass -ConfirmTransfer (and omit -DryRun) only after owner authorization.'
}

New-Item -ItemType Directory -Force -Path $resolvedRoot | Out-Null

$ok = 0
foreach ($c in $candidates) {
  $finalCipher = Join-Path $resolvedRoot $c.Cipher
  $finalSha = Join-Path $resolvedRoot $c.Sha
  $partialCipher = "$finalCipher.partial"
  $partialSha = "$finalSha.partial"

  if ((Test-Path -LiteralPath $finalCipher) -or (Test-Path -LiteralPath $finalSha)) {
    Write-Log WARN "Skip existing recovery copy (preserve): $($c.Cipher)"
    continue
  }

  if (Test-Path -LiteralPath $partialCipher) { Remove-Item -LiteralPath $partialCipher -Force }
  if (Test-Path -LiteralPath $partialSha) { Remove-Item -LiteralPath $partialSha -Force }

  $remoteCipher = "$RemoteDir/$($c.Cipher)"
  $remoteSha = "$RemoteDir/$($c.Sha)"

  Write-Log INFO "SCP $($c.Sha) -> partial"
  & scp @sshArgs "${RemoteHost}:${remoteSha}" $partialSha
  if ($LASTEXITCODE -ne 0) { throw "scp failed for $($c.Sha)" }

  Write-Log INFO "SCP $($c.Cipher) -> partial"
  & scp @sshArgs "${RemoteHost}:${remoteCipher}" $partialCipher
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $partialCipher, $partialSha -Force -ErrorAction SilentlyContinue
    throw "scp failed for $($c.Cipher)"
  }

  $expected = Read-ExpectedSha256 -ShaPath $partialSha
  $actual = Get-FileSha256Hex -Path $partialCipher
  if ($expected -ne $actual) {
    Remove-Item -LiteralPath $partialCipher, $partialSha -Force -ErrorAction SilentlyContinue
    throw "SHA-256 mismatch for $($c.Cipher) expected=$expected actual=$actual"
  }

  Move-Item -LiteralPath $partialCipher -Destination $finalCipher
  Move-Item -LiteralPath $partialSha -Destination $finalSha
  Write-Log INFO "VERIFIED OK $($c.Cipher) sha256=$actual"
  $ok++
}

Write-Log INFO "Transfer complete verified=$ok"
exit 0
