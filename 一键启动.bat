@echo off
setlocal EnableExtensions EnableDelayedExpansion

title Campus Software Site - One Click Start

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not defined PORT set "PORT=3000"
set "APP_URL=http://localhost:%PORT%"
set "RUNTIME_DIR=%APP_DIR%.runtime"
set "LOCAL_NODE_DIR=%RUNTIME_DIR%\node"
set "NPM_CMD="
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell"

echo.
echo ========================================
echo  Campus Software Site - Setup and Start
echo ========================================
echo.
echo Project dir: %CD%
echo URL: %APP_URL%
echo.

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Put this BAT file in the project root directory and run it again.
  pause
  exit /b 1
)

call :ensure_node
if errorlevel 1 exit /b 1

call :ensure_npm
if errorlevel 1 exit /b 1

call :check_node_version
if errorlevel 1 exit /b 1

call :install_dependencies
if errorlevel 1 exit /b 1

call :start_server
exit /b %ERRORLEVEL%

:ensure_node
where node >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
  echo [OK] Node.js found: !NODE_VERSION!
  exit /b 0
)

if exist "%LOCAL_NODE_DIR%\node.exe" (
  set "PATH=%LOCAL_NODE_DIR%;%LOCAL_NODE_DIR%\node_modules\npm\bin;%PATH%"
  for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
  echo [OK] Local portable Node.js found: !NODE_VERSION!
  exit /b 0
)

echo [INFO] Node.js was not found. Downloading portable Node.js LTS into this project...
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%setup-portable-node.ps1"
if errorlevel 1 (
  echo [ERROR] Portable Node.js setup failed.
  echo Check network access to https://nodejs.org/ and run this BAT file again.
  pause
  exit /b 1
)

set "PATH=%LOCAL_NODE_DIR%;%LOCAL_NODE_DIR%\node_modules\npm\bin;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Portable Node.js was downloaded, but node.exe cannot be found.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo [OK] Node.js found: !NODE_VERSION!
exit /b 0

:ensure_npm
if exist "%LOCAL_NODE_DIR%\npm.cmd" (
  set "NPM_CMD=%LOCAL_NODE_DIR%\npm.cmd"
  for /f "delims=" %%v in ('"%LOCAL_NODE_DIR%\npm.cmd" -v') do set "NPM_VERSION=%%v"
  echo [OK] Local portable npm found: !NPM_VERSION!
  exit /b 0
)

where npm >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%p in ('where npm') do (
    if not defined NPM_CMD set "NPM_CMD=%%p"
  )
  for /f "delims=" %%v in ('"!NPM_CMD!" -v') do set "NPM_VERSION=%%v"
  echo [OK] npm found: !NPM_VERSION!
  exit /b 0
)

echo [ERROR] npm was not found. The portable Node.js package may be incomplete.
echo Delete "%RUNTIME_DIR%" and run this BAT file again.
pause
exit /b 1

:check_node_version
node -e "const major = Number(process.versions.node.split('.')[0]); process.exit(major >= 18 ? 0 : 1)"
if errorlevel 1 (
  for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
  echo [ERROR] Current Node.js version is !NODE_VERSION!, but this project requires Node.js 18 or newer.
  echo Upgrade Node.js LTS, then run this BAT file again.
  pause
  exit /b 1
)

echo [OK] Node.js version is supported.
exit /b 0

:install_dependencies
echo.
echo [STEP] Installing/checking npm dependencies...
if exist "package-lock.json" (
  call "%NPM_CMD%" ci
) else (
  call "%NPM_CMD%" install
)

if errorlevel 1 (
  echo [ERROR] npm dependency installation failed.
  pause
  exit /b 1
)

echo [OK] Dependencies are ready.
exit /b 0

:start_server
echo.
echo [STEP] Checking port %PORT%...
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$port = [int]$env:PORT; $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue; if ($conn) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo [INFO] Port %PORT% is already listening. Opening browser...
  start "" "%APP_URL%"
  echo.
  echo URL: %APP_URL%
  pause
  exit /b 0
)

echo [STEP] Starting server...
echo Log file: %APP_DIR%server.out.log
echo Error log: %APP_DIR%server.err.log

start "Campus Software Site Server" /min cmd /c "cd /d ""%APP_DIR%"" && call ""%NPM_CMD%"" start >> ""%APP_DIR%server.out.log"" 2>> ""%APP_DIR%server.err.log"""

echo [STEP] Waiting for server...
for /l %%i in (1,1,20) do (
  "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$port = [int]$env:PORT; $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue; if ($conn) { exit 0 } else { exit 1 }"
  if not errorlevel 1 (
    echo [OK] Server started.
    start "" "%APP_URL%"
    echo.
    echo URL: %APP_URL%
    echo To stop the server, close the "Campus Software Site Server" window or end node.exe in Task Manager.
    pause
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)

echo [ERROR] Server startup timed out. Check logs:
echo %APP_DIR%server.out.log
echo %APP_DIR%server.err.log
pause
exit /b 1
