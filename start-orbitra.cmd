@echo off
TITLE ORBITRA-01 CubeSat Mission Control Ground Station
COLOR 0B

echo ==============================================================================
echo       ORBITRA-01 CUBESAT GROUND STATION - LAUNCH SYSTEM
echo ==============================================================================
echo.
echo [1/3] Checking Node.js runtime...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)
echo       Node.js is detected.

echo.
echo [2/3] Launching Mission Control Backend & Telemetry Bridge...
echo       Target Port:      COM10 (ESP32 Ground Station Receiver)
echo       Web Dashboard:    http://localhost:3000
echo       WebSocket Stream: ws://localhost:3000
echo       REST Ingestion:   POST http://localhost:3000/api/telemetry
echo       UDP Listener:     udp://127.0.0.1:9090
echo.
echo [IMPORTANT] If Arduino IDE Serial Monitor is OPEN, please CLOSE it!
echo             Windows allows only ONE application to access COM10 at a time.
echo.

set SERIAL_PORT=COM10

echo [3/3] Opening Mission Control Dashboard in default web browser...
start http://localhost:3000

echo.
echo ==============================================================================
echo Press Ctrl+C at any time in this window to stop the ground station server.
echo ==============================================================================
echo.

node server.js
pause
