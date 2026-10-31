@echo off
title ORBITREX Mission Control - Web Console
setlocal enabledelayedexpansion

cd /d "%~dp0"
set "SCRIPT_DIR=%~dp0"

:: Auto-detect and configure local portable Node.js runtime
if exist "%SCRIPT_DIR%.node_runtime\node.exe" (
    set "PATH=%SCRIPT_DIR%.node_runtime;%PATH%"
)

echo ==============================================================================
echo   ORBITREX Mission Control - CubeSat Telemetry and Operations Console
echo ==============================================================================
echo.
echo [1/2] Launching Ground Station Server and Telemetry Stream...
echo       Web Dashboard:    http://localhost:3000
echo       Leaflet GPS HUD:  http://localhost:3000/hud
echo       WebSocket Stream: ws://localhost:3000
echo.
echo [2/2] Opening Mission Control in default browser...
start "" "http://localhost:3000"

echo.
echo ==============================================================================
echo Server is running. Press Ctrl+C in this window to stop.
echo ==============================================================================
echo.

node server.cjs
pause
