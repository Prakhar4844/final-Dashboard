@echo off
title ORBITREX Mission Control - Web Console
setlocal enabledelayedexpansion

echo ==============================================================================
echo   ORBITREX Mission Control - CubeSat Telemetry & Operations Console
echo ==============================================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "PATH=%SCRIPT_DIR%.node_runtime;%PATH%"

echo Starting ORBITREX Mission Control on http://localhost:3000 ...
call npm run dev
pause
