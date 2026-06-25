@echo off

set "SCRIPT_DIR=%~dp0"

call "%SCRIPT_DIR%stop.bat"

ping -n 3 127.0.0.1 >nul

call "%SCRIPT_DIR%start.bat"

exit /b %errorlevel%
