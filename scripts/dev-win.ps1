param(
  [switch]$NoWeb
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) {
  Write-Host "[dev-win] $msg"
}

$repoRoot = Split-Path -Parent $PSCommandPath | Split-Path -Parent
$py = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
  Write-Error "Python venv not found at $py. Create it and install backend deps first."
  exit 1
}

# 1) Apply Alembic migrations
Write-Info "Applying database migrations"
Push-Location (Join-Path $repoRoot "apps/backend")
try {
  & $py -m alembic upgrade heads
}
finally {
  Pop-Location
}

# 2) Start backend API
Write-Info "Starting backend on http://127.0.0.1:8000"
$backendArgs = @(
  '-m','uvicorn',
  '--app-dir', (Join-Path $repoRoot 'apps/backend'),
  'app.main:app',
  '--host','127.0.0.1',
  '--port','8000',
  '--reload'
)
$backendProc = Start-Process -FilePath $py -ArgumentList $backendArgs -PassThru -WindowStyle Normal

# 3) Wait for backend health
$healthUrl = 'http://127.0.0.1:8000/health'
for ($i = 0; $i -lt 100; $i++) {
  try {
    $res = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    if ($res.StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Milliseconds 300
}
Write-Info "Backend is up."

# 4) Start web app unless suppressed
if (-not $NoWeb) {
  Write-Info "Starting web on http://127.0.0.1:3000"
  $env:NEXT_PUBLIC_BACKEND_URL = 'http://127.0.0.1:8000'
  Start-Process -FilePath 'npm' -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $repoRoot 'apps/web')
}

Write-Info "Done. Press Ctrl+C to stop processes if running in this terminal."