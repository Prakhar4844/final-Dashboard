@echo off
title ORBITREX Telemetry Bridge - ESP32 Serial Reader
echo ==============================================================================
echo   ORBITREX ESP32 USB-Serial Telemetry Forwarder
echo ==============================================================================
echo.

echo Auto-detecting ESP32 serial COM port and forwarding to FastAPI...
python backend/serial_bridge.py %*
pause
