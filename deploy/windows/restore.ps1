<#
.SYNOPSIS
    Restores the database and documents from a folder made by backup.ps1.
    EVERYTHING currently in the service is replaced by the backup.

.DESCRIPTION
    For moving to a new PC, or recovering after a failure:
      1. on the new PC, clone the repo and copy the backup folder over,
      2. copy the backup's env.production to .env.production in the repo
         (the documents can only be read with the same storage keys),
      3. run start.ps1 once, so the containers exist,
      4. run this script with -From pointing at the backup folder.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy\windows\restore.ps1 -From D:\LegalFilingBackups\2026-10-01_0200
#>
param([Parameter(Mandatory = $true)][string]$From)

. "$PSScriptRoot\common.ps1"

$From = (Resolve-Path -LiteralPath $From).Path
foreach ($file in 'database.dump', 'documents.tar.gz') {
    if (-not (Test-Path -LiteralPath (Join-Path $From $file))) {
        Stop-WithError "$From has no $file. Point -From at one dated folder made by backup.ps1."
    }
}
Assert-DockerRunning
Assert-EnvFile
$values = Read-EnvFile $EnvFile

Write-Host ''
Write-Host "This replaces ALL current cases, documents, accounts and payments with the backup in" -ForegroundColor Red
Write-Host "  $From" -ForegroundColor Red
$answer = Read-Host 'Type RESTORE to continue'
if ($answer -cne 'RESTORE') {
    Write-Host 'Cancelled. Nothing changed.'
    exit 1
}

Write-Step 'Stopping everything except the database'
Invoke-Compose stop cloudflared web bff api worker storage
Invoke-Compose up -d db

Write-Step 'Restoring the database'
$env:PGPASSWORD = $values.POSTGRES_PASSWORD
try {
    $db = $values.POSTGRES_DB
    $user = $values.POSTGRES_USER
    $common = @('run', '--rm', '--network', "${Project}_default", '-e', 'PGPASSWORD', '-v', "${From}:/backup:ro", 'postgres:16-alpine')
    # Each -c runs on its own, outside a transaction, as DROP DATABASE needs.
    $code = Invoke-Quiet docker @common psql -h db -U $user -d postgres `
        -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "CREATE DATABASE $db OWNER $user"
    if ($code -ne 0) { Stop-WithError "Couldn't recreate the database." }
    $code = Invoke-Quiet docker @common pg_restore -h db -U $user -d $db --no-owner /backup/database.dump
    if ($code -ne 0) { Stop-WithError 'pg_restore reported a problem. The database may be incomplete; run this again.' }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
Write-Ok 'Database restored.'

Write-Step 'Restoring the documents'
$code = Invoke-Quiet docker run --rm -v "${Project}_storagedata:/data" -v "${From}:/backup:ro" alpine `
    sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/documents.tar.gz -C /data'
if ($code -ne 0) { Stop-WithError 'Restoring the documents failed.' }
Write-Ok 'Documents restored.'

Write-Step 'Starting the service again'
& "$PSScriptRoot\start.ps1" -SkipBuild
