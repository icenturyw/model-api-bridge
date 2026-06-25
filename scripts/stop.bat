@echo off
setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0.."
set "PID_FILE=%ROOT_DIR%\data\router.pid"
set "PORT=8787"

echo [INFO] Stopping model-api-bridge...

set "STOPPED=0"

for /f "tokens=1" %%i in ('powershell -Command "& { Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess }" 2^>nul') do (
    taskkill /PID %%i /F >nul 2>&1
    if !errorlevel! equ 0 set "STOPPED=1"
)

if exist "%PID_FILE%" (
    set /p SAVED_PID=<"%PID_FILE%"
    tasklist /FI "PID eq !SAVED_PID!" 2>nul | findstr "!SAVED_PID!" >nul
    if not errorlevel 1 (
        taskkill /PID !SAVED_PID! /F >nul 2>&1
        if !errorlevel! equ 0 set "STOPPED=1"
    )
    del "%PID_FILE%" 2>nul
)

if !STOPPED! equ 1 (
    echo [OK] Service stopped successfully.
) else (
    echo [INFO] No running instance found on port %PORT%.
)

exit /b 0
