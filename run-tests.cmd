@echo off
title ORBITREX Mission Control - Unit Tests
set "SCRIPT_DIR=%~dp0"
set "PATH=%SCRIPT_DIR%.node_runtime;%PATH%"

echo Running Vitest suite...
call npm run test
pause
