@echo off
rem Double-click to back up now.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup.ps1" %*
echo.
pause
