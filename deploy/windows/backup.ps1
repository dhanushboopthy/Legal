<#
.SYNOPSIS
    Backs up the database, every uploaded document and the settings file
    into a dated folder, and deletes backups older than -KeepDays.

.DESCRIPTION
    Document storage is paused for the few seconds it takes to copy it, so
    the copy is consistent; the rest of the site keeps running. Run it by
    hand, or nightly via install-tasks.ps1.

    A backup contains every client document and every password the service
    uses. Keep it as private as the PC itself, and copy it somewhere off
    this PC (an external drive, or encrypted cloud storage) regularly: a
    backup on the same disk doesn't survive that disk failing.

.PARAMETER Destination
    Where the dated backup folders go. Default: the backups folder in the repo.

.PARAMETER KeepDays
    Backups older than this many days are deleted. Default: 30.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1 -Destination D:\LegalFilingBackups
#>
param(
    [string]$Destination = '',
    [int]$KeepDays = 30
)

. "$PSScriptRoot\common.ps1"

if (-not $Destination) { $Destination = Join-Path $Root 'backups' }
Assert-DockerRunning
Assert-EnvFile
$values = Read-EnvFile $EnvFile

$folder = Join-Path $Destination (Get-Date -Format 'yyyy-MM-dd_HHmm')
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$folder = (Resolve-Path -LiteralPath $folder).Path
Write-Host "Backing up to $folder" -ForegroundColor White

Write-Step 'Database'
# Through a throwaway container on the service's network, writing straight
# into the folder: piping pg_dump through PowerShell would corrupt it.
$env:PGPASSWORD = $values.POSTGRES_PASSWORD
try {
    $code = Invoke-Quiet docker run --rm --network "${Project}_default" -e PGPASSWORD `
        -v "${folder}:/backup" postgres:16-alpine `
        pg_dump -h db -U $values.POSTGRES_USER -d $values.POSTGRES_DB -Fc -f /backup/database.dump
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
if ($code -ne 0) { Stop-WithError 'The database backup failed. Is the service running (start.ps1)?' }
Write-Ok 'database.dump'

Write-Step 'Documents'
Invoke-Compose stop storage
try {
    $code = Invoke-Quiet docker run --rm -v "${Project}_storagedata:/data:ro" -v "${folder}:/backup" `
        alpine tar czf /backup/documents.tar.gz -C /data .
} finally {
    Invoke-Compose start storage
}
if ($code -ne 0) { Stop-WithError 'The documents backup failed.' }
Write-Ok 'documents.tar.gz'

Write-Step 'Settings'
Copy-Item -LiteralPath $EnvFile -Destination (Join-Path $folder 'env.production')
Write-Ok 'env.production'

Write-Step "Removing backups older than $KeepDays days"
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -LiteralPath $Destination -Directory |
    Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' -and $_.CreationTime -lt $cutoff } |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
        Write-Ok "removed $($_.Name)"
    }

$size = (Get-ChildItem -LiteralPath $folder -File | Measure-Object -Property Length -Sum).Sum
Write-Host ''
Write-Host ("Backup complete: {0} ({1:N1} MB)" -f $folder, ($size / 1MB)) -ForegroundColor Green
