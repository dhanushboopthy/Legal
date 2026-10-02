<#
.SYNOPSIS
    Creates the advocate's account (or makes an existing account the
    advocate). Run once, after start.ps1 has the service running.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy\windows\create-admin.ps1
#>
. "$PSScriptRoot\common.ps1"

Assert-DockerRunning
Assert-EnvFile
Write-Step "Creating the advocate's account"
Write-Note "You'll be asked for the email, name, Bar Council enrolment number and a password."
Write-Note "The password isn't shown as you type."
Invoke-Compose exec api python -m scripts.create_admin
