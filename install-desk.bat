@echo off
setlocal EnableExtensions
title Strategy Desk
cd /d "%~dp0"
if not exist "package.json" if exist "..\package.json" cd /d "%~dp0.."
if not exist "package.json" (
  echo This file has to sit in the Strategy Desk folder, next to package.json.
  echo If you downloaded only this file, put it in that folder and double-click it again.
  pause
  exit /b 1
)

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :need_node
if errorlevel 1 exit /b 1

echo.
echo Installing desk packages...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed.
  pause
  exit /b 1
)

curl.exe -sf -o NUL --max-time 2 http://127.0.0.1:8080/ >nul 2>&1
if not errorlevel 1 goto open_browser

echo.
echo Starting Strategy Desk. The page opens when the program is ready.
echo Leave the Strategy Desk window open. Closing it stops the desk.
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
echo To start it again later, double-click restart-desk.bat. Orders are off until you turn them on.
timeout /t 8 /nobreak >nul
exit /b 0

:not_ready
echo.
echo The desk did not start. Read the Strategy Desk window for the error.
pause
exit /b 1

:need_node
where node >nul 2>&1
if errorlevel 1 goto install_node
for /f %%A in ('node -p "Number(process.versions.node.split('.')[0])"') do set MAJOR=%%A
if not defined MAJOR goto install_node
if %MAJOR% GEQ 22 (
  echo Node.js %MAJOR% is ready.
  exit /b 0
)
echo Node.js %MAJOR% is too old. Strategy Desk needs 22 or newer.

:install_node
where winget >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
echo Installing Node.js. Windows may ask you to approve it.
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was installed. Close this window and double-click the file again.
  pause
  exit /b 1
)
for /f %%A in ('node -p "Number(process.versions.node.split('.')[0])"') do set MAJOR=%%A
if %MAJOR% LSS 22 (
  echo Node.js is still older than 22. Install a newer copy from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
exit /b 0
