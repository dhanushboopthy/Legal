# Shared by the scripts in this folder; each one dot-sources it first:
#     . "$PSScriptRoot\common.ps1"
# Written for Windows PowerShell 5.1 (the one built into Windows), so no
# PowerShell 7-only syntax (&&, ??, ternaries).

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $Root

$EnvFile = Join-Path $Root '.env.production'
$EnvExample = Join-Path $Root '.env.production.example'
$Project = 'legal-filing-prod'
# Always both files, never docker-compose.override.yml (that one is for dev).
$ComposeArgs = @(
    'compose', '-p', $Project, '--env-file', '.env.production',
    '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml'
)

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) { Write-Host "    $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "    $Message" -ForegroundColor Yellow }

function Stop-WithError([string]$Message) {
    Write-Host ''
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

# Runs a native command and returns its exit code, without PowerShell 5.1
# turning the command's stderr output into a terminating error.
function Invoke-Quiet {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $exe, $rest = $args
        & $exe @rest *> $null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
}

# `docker compose <args>` for the production project; stops the script if it fails.
function Invoke-Compose {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker @ComposeArgs @args
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
    if ($code -ne 0) {
        Stop-WithError "'docker compose $($args -join ' ')' failed (exit code $code). See the messages above."
    }
}

# The output of `docker compose <args>` as text, or $null if it failed.
function Get-ComposeOutput {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & docker @ComposeArgs @args 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return ($out -join "`n").Trim()
    } finally {
        $ErrorActionPreference = $old
    }
}

function Assert-DockerRunning {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-WithError ("Docker isn't installed. Install Docker Desktop from " +
            'https://www.docker.com/products/docker-desktop/ and run this again.')
    }
    if ((Invoke-Quiet docker info) -eq 0) { return }

    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktop)) {
        Stop-WithError 'Docker is installed but not running. Start Docker Desktop and run this again.'
    }
    Write-Note 'Starting Docker Desktop (this can take a minute or two)...'
    Start-Process -FilePath $desktop | Out-Null
    $deadline = (Get-Date).AddMinutes(4)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        if ((Invoke-Quiet docker info) -eq 0) {
            Write-Ok 'Docker is running.'
            return
        }
    }
    Stop-WithError "Docker Desktop didn't start within 4 minutes. Open it, wait until it says it's running, and run this again."
}

# KEY=VALUE lines of an env file, in order. Comments and blank lines skipped.
function Read-EnvFile([string]$Path) {
    $map = [ordered]@{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*(#|$)' -or $line -notmatch '=') { continue }
        $key, $value = $line -split '=', 2
        $map[$key.Trim()] = $value.Trim()
    }
    return $map
}

# UTF-8 without a byte-order mark and with LF endings: a BOM would corrupt the
# first key for docker compose, and the values are read inside Linux.
function Write-TextFile([string]$Path, [string[]]$Lines) {
    $text = ($Lines -join "`n") + "`n"
    [System.IO.File]::WriteAllText($Path, $text, (New-Object System.Text.UTF8Encoding $false))
}

# A random secret as lowercase hex (safe in URLs and env files).
function New-Secret([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Assert-EnvFile {
    if (-not (Test-Path -LiteralPath $EnvFile)) {
        Stop-WithError ".env.production doesn't exist yet. Run start.ps1 once to create it."
    }
}
