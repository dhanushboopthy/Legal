@echo off
rem Double-click to start (or update) the service. Opens a black terminal
rem window that shows each step and stays open until you press a key.
title Legal Filing - Start service
color 0F
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (echo The service did NOT finish starting ^(code %EXITCODE%^). Read the messages above.) else (echo Finished. You can close this window; the service keeps running.)
echo.
pause
