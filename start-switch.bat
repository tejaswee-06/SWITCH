@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo SWITCH - SIMULATED DEMO (no real devices, no Amazon / Alexa connection)
echo ============================================
if not exist "switch_backend\.venv\Scripts\python.exe" (
  echo Creating backend virtual environment...
  py -3 -m venv switch_backend\.venv 2>nul
  if errorlevel 1 python -m venv switch_backend\.venv
  if errorlevel 1 (echo Could not create Python venv. Install Python 3.11+ from python.org, tick "Add python.exe to PATH", and retry.& pause & exit /b 1)
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing frontend dependencies...
  call npm ci
  if errorlevel 1 (echo npm ci failed. Fix the npm error and rerun this script.& pause & exit /b 1)
)
echo Installing/checking backend dependencies...
call "switch_backend\.venv\Scripts\python.exe" -m pip install -r switch_backend\requirements.txt
if errorlevel 1 (echo Backend dependency installation failed.& pause & exit /b 1)
if not exist "switch_backend\data" mkdir "switch_backend\data"
start "SWITCH Person 2 Backend - SIMULATED" /D "%~dp0switch_backend" cmd /k "set SWITCH_ENV=demo&& set SWITCH_DEMO_PROFILE=journey&& set SWITCH_DB=data\switch.db&& .venv\Scripts\python.exe -m app"
timeout /t 3 /nobreak >nul
echo Backend starting at http://127.0.0.1:8000
echo Frontend starting at http://127.0.0.1:5173
echo Both services run simultaneously. Close their terminals to stop them.
call npm run dev -- --host 127.0.0.1 --port 5173
endlocal
