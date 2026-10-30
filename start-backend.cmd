@echo off
title ORBITREX Telemetry Bridge - FastAPI WebSocket Server
echo ==============================================================================
echo   ORBITREX CubeSat Ground Station - FastAPI WebSocket Bridge
echo ==============================================================================
echo.

echo Starting FastAPI bridge on ws://localhost:8000/ws/telemetry ...
python backend/main.py
pause
