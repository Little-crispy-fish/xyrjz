@echo off
setlocal EnableExtensions

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if not defined PORT set "PORT=3000"

set "LOCAL_NODE_DIR=%APP_DIR%.runtime\node"
if exist "%LOCAL_NODE_DIR%\node.exe" (
  set "PATH=%LOCAL_NODE_DIR%;%LOCAL_NODE_DIR%\node_modules\npm\bin;%SystemRoot%\System32;%SystemRoot%;%PATH%"
  set "NODE_EXE=%LOCAL_NODE_DIR%\node.exe"
) else (
  set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"
  set "NODE_EXE=node"
)

(
  echo.
  echo [%DATE% %TIME%] Starting server on PORT=%PORT%
  echo APP_DIR=%APP_DIR%
  echo NODE_EXE=%NODE_EXE%
  "%NODE_EXE%" "%APP_DIR%server.js"
) >> "%APP_DIR%server.out.log" 2>> "%APP_DIR%server.err.log"
