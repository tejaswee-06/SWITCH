$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'SWITCH - SIMULATED DEMO (no real devices, no Amazon / Alexa connection)' -ForegroundColor Cyan
if (-not (Test-Path 'switch_backend/.venv/Scripts/python.exe')) { if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m venv switch_backend/.venv } else { python -m venv switch_backend/.venv } }
if (-not (Test-Path 'node_modules/vite/bin/vite.js')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
& 'switch_backend/.venv/Scripts/python.exe' -m pip install -r 'switch_backend/requirements.txt'
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed' }
New-Item -ItemType Directory -Force 'switch_backend/data' | Out-Null
$backend = "Set-Location '$PSScriptRoot\switch_backend'; `$env:SWITCH_ENV='demo'; `$env:SWITCH_DEMO_PROFILE='journey'; `$env:SWITCH_DB='data\switch.db'; & '.venv\Scripts\python.exe' -m app"
Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',$backend
Start-Sleep -Seconds 3
Write-Host 'Backend: http://127.0.0.1:8000' -ForegroundColor Green
Write-Host 'Frontend: http://127.0.0.1:5173' -ForegroundColor Green
npm run dev -- --host 127.0.0.1 --port 5173
