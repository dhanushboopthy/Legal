<#
.SYNOPSIS
    Stops the whole service. Nothing is deleted: start.ps1 brings it back
    exactly as it was.
#>
. "$PSScriptRoot\common.ps1"

Assert-DockerRunning
Assert-EnvFile
Write-Step 'Stopping the service'
Invoke-Compose stop
Write-Ok 'Stopped. The site is offline until you run start.ps1 again.'
