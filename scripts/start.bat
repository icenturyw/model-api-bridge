@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0.."
set "PID_FILE=%ROOT_DIR%\data\router.pid"
set "LOG_DIR=%ROOT_DIR%\logs"
set "LOG_FILE=%LOG_DIR%\server.log"
set "PORT=8787"

if not "%DATA_DIR%"=="" set "ROOT_DIR=%DATA_DIR%\.." & set "PID_FILE=%DATA_DIR%\router.pid"
if not "%PORT%"=="" set "PORT=%PORT%"

for /f "tokens=1" %%i in ('powershell -Command "& { Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess }" 2^>nul') do set "EXISTING_PID=%%i"
if not "!EXISTING_PID!"=="" (
    echo [INFO] Port %PORT% is already in use by PID !EXISTING_PID!
    echo [INFO] Service appears to be already running.
    exit /b 0
)

if exist "%PID_FILE%" (
    set /p SAVED_PID=<"%PID_FILE%"
    tasklist /FI "PID eq !SAVED_PID!" 2>nul | findstr "!SAVED_PID!" >nul
    if not errorlevel 1 (
        echo [INFO] Service already running with PID !SAVED_PID! (from PID file)
        exit /b 0
    )
    echo [INFO] Removing stale PID file
    del "%PID_FILE%" 2>nul
)

if not exist "%ROOT_DIR%\data" mkdir "%ROOT_DIR%\data"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo [INFO] Starting model-api-bridge on port %PORT%...
cd /d "%ROOT_DIR%"

start "model-api-bridge" /B node src\server.js >>"%LOG_FILE%" 2>&1

set "NEW_PID=!errorlevel!"
if !NEW_PID! neq 0 (
    echo [ERROR] Failed to start service. Check %LOG_FILE%
    exit /b 1
)

for /f "tokens=2" %%i in ('tasklist /FI "IMAGENAME eq node.exe" /NH ^| findstr /R /C:" node\.exe" 2^>nul') do set "NEW_PID=%%i"

if "!NEW_PID!"=="" (
    echo [ERROR] Could not determine Node.js PID
    exit /b 1
)

echo !NEW_PID!>"%PID_FILE%"

ping -n 3 127.0.0.1 >nul

tasklist /FI "PID eq !NEW_PID!" 2>nul | findstr "!NEW_PID!" >nul
if errorlevel 1 (
    echo [ERROR] Service failed to start. Check %LOG_FILE%
    del "%PID_FILE%" 2>nul
    exit /b 1
)

echo [OK] Service started with PID !NEW_PID!
echo [OK] Admin console: http://127.0.0.1:%PORT%/admin
echo [OK] Gateway API:   http://127.0.0.1:%PORT%/v1
exit /b 0
