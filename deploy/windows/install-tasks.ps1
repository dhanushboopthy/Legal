<#
.SYNOPSIS
    Sets Windows up to run the service unattended: starts it whenever you
    sign in, and backs it up every night. Run once; running it again just
    updates the two tasks.

.DESCRIPTION
    Creates two tasks in Task Scheduler (for the signed-in user; no admin
    rights needed):
      "Legal Filing - Start"   at sign-in, runs start.ps1 -SkipBuild
      "Legal Filing - Backup"  every day at -BackupTime, runs backup.ps1
    Their output goes to logs\start.log and logs\backup.log in the repo.

    Docker Desktop only runs while someone is signed in to Windows, so also
    turn on "Start Docker Desktop when you sign in" in its settings, set
    Windows never to sleep, and see docs/production-windows.md about
    signing in again after Windows Update restarts.

.PARAMETER BackupTime
    When the nightly backup runs (24-hour clock). Default: 02:00.

.PARAMETER BackupDestination
    Passed to backup.ps1 -Destination. Default: the backups folder in the repo.
#>
param(
    [string]$BackupTime = '02:00',
    [string]$BackupDestination = ''
)

. "$PSScriptRoot\common.ps1"

$logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function New-ScriptAction([string]$Script, [string]$Arguments, [string]$Log) {
    # Through cmd.exe so everything the script prints, Docker's output
    # included, lands in the log file.
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Script`" $Arguments >> `"$Log`" 2>&1"
    return New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $command" -WorkingDirectory $Root
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Write-Step 'Start the service at sign-in'
$startTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# Give Docker Desktop a minute to come up first.
$startTrigger.Delay = 'PT1M'
Register-ScheduledTask -TaskName 'Legal Filing - Start' -Force -Principal $principal -Settings $settings `
    -Trigger $startTrigger `
    -Action (New-ScriptAction (Join-Path $PSScriptRoot 'start.ps1') '-SkipBuild' (Join-Path $logs 'start.log')) | Out-Null
Write-Ok 'Created "Legal Filing - Start".'

Write-Step "Back up every night at $BackupTime"
$backupArgs = ''
if ($BackupDestination) { $backupArgs = "-Destination `"$BackupDestination`"" }
Register-ScheduledTask -TaskName 'Legal Filing - Backup' -Force -Principal $principal -Settings $settings `
    -Trigger (New-ScheduledTaskTrigger -Daily -At $BackupTime) `
    -Action (New-ScriptAction (Join-Path $PSScriptRoot 'backup.ps1') $backupArgs (Join-Path $logs 'backup.log')) | Out-Null
Write-Ok 'Created "Legal Filing - Backup".'

Write-Host ''
Write-Host 'Done. You can see and run both tasks in Task Scheduler.' -ForegroundColor Green
Write-Note 'Still to do by hand (docs/production-windows.md, step 6):'
Write-Note '  Docker Desktop -> Settings -> General -> "Start Docker Desktop when you sign in"'
Write-Note '  Windows Settings -> System -> Power -> Sleep: Never (when plugged in)'
