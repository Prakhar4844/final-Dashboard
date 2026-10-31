@echo off
TITLE ORBITRA-01 CubeSat Mission Control Ground Station
COLOR 0B
setlocal enabledelayedexpansion

cd /d "%~dp0"
set "SCRIPT_DIR=%~dp0"

:: Auto-detect and configure local portable Node.js runtime
if exist "%SCRIPT_DIR%.node_runtime\node.exe" (
    set "PATH=%SCRIPT_DIR%.node_runtime;%PATH%"
)

echo ==============================================================================
echo       ORBITRA-01 CUBESAT GROUND STATION - LAUNCH SYSTEM
echo ==============================================================================
echo.
echo [1/3] Checking Node.js runtime...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js runtime was not found!
    echo Please ensure the .node_runtime folder is present or install Node.js from https://nodejs.org
    pause
    exit /b 1
)
echo       Node.js runtime is ready.

echo.
echo [2/3] Launching Mission Control Backend and Telemetry Bridge...
echo       Web Dashboard:    http://localhost:3000
echo       Leaflet GPS HUD:  http://localhost:3000/hud
echo       WebSocket Stream: ws://localhost:3000
echo       Target Port:      COM10 (ESP32 Ground Station Receiver)
echo.
echo [IMPORTANT] If Arduino IDE Serial Monitor is OPEN, please CLOSE it!
echo             Windows allows only ONE application to access COM10 at a time.
echo.

set SERIAL_PORT=COM10

echo [3/3] Opening Mission Control Dashboard in default web browser...
start "" "http://localhost:3000"

echo.
echo ==============================================================================
echo Press Ctrl+C at any time in this window to stop the ground station server.
echo ==============================================================================
echo.

node server.cjs
pause
