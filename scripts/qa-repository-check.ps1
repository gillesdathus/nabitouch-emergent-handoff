$ErrorActionPreference = 'Stop'
$qaRoot = Split-Path $PSScriptRoot -Parent
Push-Location $qaRoot
try {
    $qaNames = @(git ls-files)
    if ($LASTEXITCODE -ne 0) { throw 'Git inventory failed' }
    $qaOkay = -not ($qaNames | Where-Object { (Split-Path $_ -Leaf) -eq 'nabitouch-next.env' })
    $qaLines = @(git grep -I -n -e ('pk.' + 'eyJ') -e ('sk.' + 'eyJ') -e ('mongodb://' + 'ntnext:'))
    if ($LASTEXITCODE -gt 1) { throw 'Git scan failed' }
    foreach ($qaLine in $qaLines) {
        if ($qaLine -notmatch 'replace-me|\{mongo\}|mongo-password-value|"mongodb://ntnext:"') { $qaOkay = $false }
    }
    foreach ($qaName in $qaNames) {
        if ($qaName -notmatch '(env\.example|env\.hostinger\.example)$') { continue }
        foreach ($qaLine in [IO.File]::ReadAllLines((Join-Path $qaRoot $qaName))) {
            if ($qaLine -match '^\s*(JWT_SECRET|OWNER_PASSWORD|FIELD_ENCRYPTION_KEY|RESEND_API_KEY|MAPBOX_TOKEN|REDIS_PASSWORD|RESEND_WEBHOOK_SECRET)=(.*)$') {
                $qaValue = $Matches[2].Trim().Trim([char[]]@([char]34, [char]39))
                if ($qaValue -notin @('', 'replace-me', 'replace-with-at-least-16-characters')) { $qaOkay = $false }
            }
        }
    }
    if (-not $qaOkay) { throw 'Tracked production-configuration check: FAIL (values withheld)' }
    Write-Output 'Tracked production-configuration check: PASS'
    $qaPattern = '(sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)'
    $qaRevisions = @(git rev-list --all)
    $qaHitCount = 0
    foreach ($qaRevision in $qaRevisions) {
        $qaHits = @(git grep -I -l -E $qaPattern $qaRevision --)
        if ($LASTEXITCODE -gt 1) { throw 'History scan failed' }
        $qaHitCount += $qaHits.Count
    }
    Write-Output ('Heuristic history scan: ' + $qaRevisions.Count + ' revisions; ' + $qaHitCount + ' matching revision/file pairs (values withheld)')
    $qaLegacyCount = @($qaNames | Where-Object { $_ -match '(^|/)test_credentials\.md$' }).Count
    Write-Output ('Legacy credential documents requiring review: ' + $qaLegacyCount)
    Write-Output 'This narrow scan does not prove that all secrets are absent or that credentials were rotated.'
} finally {
    Pop-Location
}
