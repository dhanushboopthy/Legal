@echo off
rem Double-click to start (or update) the service.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
echo.
pause
