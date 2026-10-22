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

echo.
echo Starting Strategy Desk at http://127.0.0.1:8080
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8080/"
call npm run dev
if errorlevel 1 pause
exit /b %errorlevel%

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
