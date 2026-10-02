@echo off
rem Double-click to stop the service.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
echo.
pause
