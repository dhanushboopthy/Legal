<#
.SYNOPSIS
    Starts the whole service, or updates it after new code is pulled.

.DESCRIPTION
    Safe to run any number of times. In order, it:
      1. makes sure Docker Desktop is running (starts it if not),
      2. on the very first run, creates .env.production with fresh random
         secrets and stops so you can fill in the rest,
      3. checks .env.production is complete,
      4. builds the images from the current code,
      5. starts the database and document storage, applies any database
         migrations and refreshes the role permissions,
      6. starts everything else (api, worker, website, Cloudflare Tunnel),
      7. waits until the site answers, and says whether it's reachable from
         the internet.

.PARAMETER SkipBuild
    Don't rebuild the images (faster; used by the start-at-sign-in task).
    Leave it off after pulling new code.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy\windows\start.ps1
#>
param([switch]$SkipBuild)

. "$PSScriptRoot\common.ps1"

function New-ProductionEnv {
    $postgresPassword = New-Secret 24
    $generated = @{
        SECRET_KEY            = New-Secret 32
        POSTGRES_PASSWORD     = $postgresPassword
        REDIS_PASSWORD        = New-Secret 24
        AWS_ACCESS_KEY_ID     = 'lfp' + (New-Secret 8)
        AWS_SECRET_ACCESS_KEY = New-Secret 24
    }
    $template = Read-EnvFile $EnvExample
    $lines = foreach ($line in Get-Content -LiteralPath $EnvExample) {
        if ($line -match '^([A-Z0-9_]+)=GENERATED$') {
            $key = $Matches[1]
            if ($key -eq 'DATABASE_URL') {
                "DATABASE_URL=postgresql+asyncpg://$($template.POSTGRES_USER):$postgresPassword@db:5432/$($template.POSTGRES_DB)"
            } else {
                "$key=$($generated[$key])"
            }
        } else {
            $line
        }
    }
    Write-TextFile $EnvFile $lines
}

# Everything that would stop the service working, in plain words.
function Get-EnvProblems($values) {
    $problems = @()
    foreach ($key in $values.Keys) {
        if ($values[$key] -eq 'CHANGE_ME') { $problems += "$key still says CHANGE_ME" }
        if ($values[$key] -eq 'GENERATED') { $problems += "$key still says GENERATED" }
    }
    foreach ($key in 'SECRET_KEY', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'AWS_ACCESS_KEY_ID',
                     'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'CLOUDFLARE_TUNNEL_TOKEN',
                     'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET') {
        if (-not $values[$key]) { $problems += "$key is empty" }
    }
    if ($values.ENVIRONMENT -ne 'production') { $problems += 'ENVIRONMENT must be production' }
    if ($values.DEBUG -ne 'false') { $problems += 'DEBUG must be false' }
    foreach ($key in 'APP_BASE_URL', 'S3_ENDPOINT_URL') {
        if ($values[$key] -notlike 'https://*') { $problems += "$key must start with https://" }
    }
    if ($values.RAZORPAY_KEY_ID -like 'rzp_test_*') {
        $problems += 'RAZORPAY_KEY_ID is a test key (rzp_test_...); use the Live mode key'
    }
    if ($values.GOOGLE_CLIENT_ID -ne $values.VITE_GOOGLE_CLIENT_ID) {
        $problems += 'GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID must be the same (or both empty)'
    }
    return $problems
}

function Wait-Database($values) {
    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $deadline) {
        $code = Invoke-Quiet docker @ComposeArgs exec -T db pg_isready -U $values.POSTGRES_USER -d $values.POSTGRES_DB
        if ($code -eq 0) { return }
        Start-Sleep -Seconds 3
    }
    Stop-WithError "The database didn't become ready within 2 minutes. Look at: docker compose -p $Project logs db"
}

function Wait-Site {
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        # From inside the web container: nginx -> api -> database.
        $code = Invoke-Quiet docker @ComposeArgs exec -T web wget -q -O /dev/null http://127.0.0.1/api/health
        if ($code -eq 0) { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}

# ---------------------------------------------------------------------------

Write-Host 'Sri Krishn Legal Office: starting the service' -ForegroundColor White

Write-Step 'Checking Docker'
Assert-DockerRunning
Write-Ok 'Docker is running.'

Write-Step 'Checking settings (.env.production)'
if (-not (Test-Path -LiteralPath $EnvFile)) {
    New-ProductionEnv
    Write-Ok "Created $EnvFile with new random passwords and keys."
    Write-Note 'Now open it in Notepad and replace every CHANGE_ME:'
    Write-Note '  the Cloudflare Tunnel token, the Razorpay Live keys and webhook secret,'
    Write-Note '  and the email (SMTP) settings. Then run this script again.'
    Write-Note "  notepad `"$EnvFile`""
    Write-Note 'Keep this file private: it holds every password the service uses.'
    exit 1
}
$values = Read-EnvFile $EnvFile
$problems = @(Get-EnvProblems $values)
if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'These settings in .env.production need fixing first:' -ForegroundColor Red
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host ''
    Write-Host "Open it with: notepad `"$EnvFile`"" -ForegroundColor Yellow
    exit 1
}
Write-Ok 'Settings look complete.'

if ($SkipBuild) {
    Write-Step 'Skipping the build (-SkipBuild)'
} else {
    Write-Step 'Building from the current code (the first time takes several minutes)'
    Invoke-Compose build --pull
}

Write-Step 'Starting the database and document storage'
Invoke-Compose up -d db redis storage storage-init
Wait-Database $values
Write-Ok 'Database is ready.'

Write-Step 'Updating the database'
Invoke-Compose run --rm --no-deps api python -m alembic upgrade head
Invoke-Compose run --rm --no-deps api python -m scripts.seed_roles
Write-Ok 'Database is up to date.'

Write-Step 'Starting the website, api, worker and tunnel'
Invoke-Compose up -d --remove-orphans

Write-Step 'Waiting for the site to answer'
if (-not (Wait-Site)) {
    Stop-WithError "The site didn't answer within 3 minutes. Look at: docker compose -p $Project logs --tail 100 api web"
}
Write-Ok 'The site is answering inside Docker.'

$advocates = Get-ComposeOutput exec -T db psql -U $values.POSTGRES_USER -d $values.POSTGRES_DB -tAc `
    "select count(*) from users u join roles r on r.id = u.role_id where r.name = 'super_admin' and u.is_active and u.removed_at is null"
if ($advocates -eq '0') {
    Write-Note "There's no advocate account yet. Create one with:"
    Write-Note '  powershell -ExecutionPolicy Bypass -File deploy\windows\create-admin.ps1'
}

Write-Step 'Checking it from the internet'
$publicUrl = $values.APP_BASE_URL.TrimEnd('/')
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$reachable = $false
for ($i = 0; $i -lt 6 -and -not $reachable; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "$publicUrl/api/health" -UseBasicParsing -TimeoutSec 15
        $reachable = $response.StatusCode -eq 200
    } catch {
        Start-Sleep -Seconds 5
    }
}
if ($reachable) {
    Write-Ok "$publicUrl is live."
} else {
    Write-Note "$publicUrl isn't reachable yet. The service is running; check the tunnel:"
    Write-Note "  docker compose -p $Project logs --tail 30 cloudflared"
    Write-Note '  and that the tunnel has both public hostnames (docs/production-windows.md, step 3).'
}

Write-Host ''
Invoke-Compose ps --format 'table {{.Service}}\t{{.Status}}'
Write-Host ''
Write-Host "Done. Open $publicUrl" -ForegroundColor Green
