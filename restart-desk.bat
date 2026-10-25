@echo off
setlocal EnableExtensions
title Strategy Desk
cd /d "%~dp0"
if not exist "package.json" if exist "..\package.json" cd /d "%~dp0.."
if not exist "package.json" (
  echo This file has to sit in the Strategy Desk folder, next to package.json.
  echo Double-click install-desk.bat once before using this restart.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo The desk is not installed yet. Double-click install-desk.bat first.
  pause
  exit /b 1
)

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Double-click install-desk.bat, or install Node.js 22 from https://nodejs.org
  pause
  exit /b 1
)

curl.exe -sf -o NUL --max-time 2 http://127.0.0.1:8080/ >nul 2>&1
if not errorlevel 1 goto open_browser

echo Starting Strategy Desk. The page opens when the program is ready.
echo Leave the Strategy Desk window open. Closing it stops the desk.
echo Orders are off after a restart until you turn them on.
start "Strategy Desk" /D "%CD%" cmd /k npm run dev

set TRIES=0
:wait_ready
set /a TRIES+=1
if %TRIES% GTR 60 goto not_ready
curl.exe -sf -o NUL --max-time 2 http://127.0.0.1:8080/ >nul 2>&1
if not errorlevel 1 goto open_browser
timeout /t 2 /nobreak >nul
goto wait_ready

:open_browser
start "" http://127.0.0.1:8080/
echo.
echo Strategy Desk is open at http://127.0.0.1:8080
echo Leave the Strategy Desk window open. Closing it stops the desk.
echo Orders are off after a restart until you turn them on.
timeout /t 8 /nobreak >nul
exit /b 0

:not_ready
echo.
echo The desk did not start. Read the Strategy Desk window for the error.
pause
exit /b 1
