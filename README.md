# ORBITREX Mission Control
### CubeSat Telemetry & Operations Console (v1.0.0)

> **Identity:** A polished, technical ground-station web application engineered for ESP32-based student satellite prototypes.  
> **Default Callsign:** `ORBITREX-01`  
> **Simulation Guarantee:** Runs immediately in Simulation Mode with zero external hardware or backend dependencies required.

---

## 1. System Architecture Overview

```
 [ESP32 Hardware Core]
  ├─ MPU6050 6-DOF IMU (I2C 0x68: SDA=GPIO21, SCL=GPIO22)
  ├─ DHT22 / SHT31 Temp & Humidity (GPIO4 / I2C 0x44)
  └─ Battery Voltage Divider (Li-Ion 1S -> GPIO34 ADC1_CH0)
          │
          │  Serial UART @ 115200 baud (or SX1278 LoRa Downlink)
          ▼
 [Ground Bridge Layer] (backend/)
  ├─ serial_bridge.py (PySerial Auto-Port Detector & Streamer)
  └─ main.py (FastAPI WebSocket Hub: ws://localhost:8000/ws/telemetry)
          │
          │  Bi-directional WebSocket Broadcast
          ▼
 [ORBITREX Mission Control Web Console] (React 18 + Vite + Tailwind CSS)
  ├─ Replaceable Data Source (SimulationDataSource vs HardwareWebSocketDataSource)
  ├─ Central Telemetry Engine & Packet Validator (Range, Type, Null Preservation)
  ├─ Alert Engine (Hysteresis Recovery, Duplicate Suppression, Threshold Ordering)
  ├─ Persistent Telemetry Vault (IndexedDB via Dexie)
  └─ 8 Integrated Operations Views
```

---

## 2. Quick Start & Launch Instructions

### A. Launch Web Console (Immediate Simulation Mode)
No dependencies to install! Portable Node.js is already configured in `.node_runtime`:
```bash
# Windows Batch Launcher:
start-dashboard.cmd

# Or directly via PowerShell:
$env:PATH = "$((Get-Item .).FullName)\.node_runtime;$env:PATH"
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in any modern browser.  
The console launches directly in **Simulation Mode**, streaming realistic Low Earth Orbit (LEO) thermal, electrical, RF, and 6-DOF inertial telemetry.

### B. Run Automated Test Suite
```bash
# Windows Batch:
run-tests.cmd

# Or via PowerShell:
$env:PATH = "$((Get-Item .).FullName)\.node_runtime;$env:PATH"
npm run test
```

### C. Launch Optional Hardware Bridge (FastAPI + ESP32)
```bash
# 1. Start FastAPI WebSocket Server:
start-backend.cmd
# (Runs on http://localhost:8000, WebSocket endpoint ws://localhost:8000/ws/telemetry)

# 2. Flash ESP32:
# Open firmware/esp32_telemetry.ino in Arduino IDE and flash your ESP32 DevKit V1.

# 3. Start Serial Bridge:
start-serial-bridge.cmd
```

---

## 3. Shared Telemetry Data Schema & Units

All views, data sources, exports, and backend bridges share a single typed telemetry contract.  
**Critical rule:** Missing or unread sensor data is preserved strictly as `null` and **never replaced with zero**.

| Parameter | Data Type | Units | Nominal Bounds | Description |
| :--- | :--- | :--- | :--- | :--- |
| `satellite_id` | `string` | — | Non-empty string | Satellite identifier / callsign (`ORBITREX-01`) |
| `sequence_number`| `integer` | counts | `≥ 0` | Monotonically incrementing packet counter |
| `timestamp` | `string` | UTC | ISO-8601 | Satellite onboard timestamp (`YYYY-MM-DDTHH:mm:ssZ`) |
| `temperature_c` | `number \| null`| **°C** | 15.0 to 32.0 | Internal avionics temperature (Warning: >35, Crit: >40) |
| `battery_voltage_v`| `number \| null`| **V** | 3.70 to 4.20 | EPS Li-Ion bus voltage (Warning: <3.5, Crit: <3.3) |
| `humidity_percent`| `number \| null`| **%** | 20.0 to 60.0 | Avionics bay relative humidity |
| `signal_strength_dbm`| `number \| null`| **dBm** | -80.0 to -40.0 | Ground downlink RF RSSI (Warning: <-85) |
| `acceleration_x`| `number \| null`| **m/s²** | -5.0 to +5.0 | MPU6050 Linear Acceleration (X-axis) |
| `acceleration_y`| `number \| null`| **m/s²** | -5.0 to +5.0 | MPU6050 Linear Acceleration (Y-axis) |
| `acceleration_z`| `number \| null`| **m/s²** | +7.0 to +12.0 | MPU6050 Linear Acceleration (Z-axis / 1g benchmark) |
| `gyroscope_x` | `number \| null`| **°/s** | -30.0 to +30.0 | MPU6050 Roll Rate |
| `gyroscope_y` | `number \| null`| **°/s** | -30.0 to +30.0 | MPU6050 Pitch Rate |
| `gyroscope_z` | `number \| null`| **°/s** | -30.0 to +30.0 | MPU6050 Yaw Rate |
| `status` | `string` | — | `NOMINAL` / `WARNING` / `CRITICAL` | Autonomous onboard health determination |

### Realistic Example Downlink Packet (JSON)
```json
{
  "satellite_id": "ORBITREX-01",
  "sequence_number": 248,
  "timestamp": "2026-10-28T01:30:15.250Z",
  "temperature_c": 28.45,
  "battery_voltage_v": 4.08,
  "humidity_percent": 42.6,
  "signal_strength_dbm": -68.4,
  "acceleration_x": 0.052,
  "acceleration_y": 0.081,
  "acceleration_z": 9.814,
  "gyroscope_x": 1.25,
  "gyroscope_y": 0.88,
  "gyroscope_z": 0.35,
  "status": "NOMINAL"
}
```

---

## 4. Eight Functional Navigation Views

1. **Mission Dashboard**
   - Telemetry cards for Temperature, Battery Voltage, Humidity, Signal RSSI, MPU6050 3-Axis Acceleration, and MPU6050 3-Axis Gyroscope.
   - Overall system health indicator, live 60fps thermal/power trend chart, battery state gauge, sensor availability summary, and live packet stream.
   - Clear distinction between `NOMINAL`, `WARNING`, `CRITICAL`, `OFFLINE`, and `NO DATA`.

2. **Live Telemetry**
   - High-throughput live telemetry table with parameter filtering.
   - Raw JSON packet inspector with syntax highlighting and one-click clipboard copying.
   - Simulator controls: Start, Pause, Resume, Reset (resets simulation sequence; does **not** erase history).
   - Fault injection scenarios: Nominal Orbit, Thermal Anomaly (>35°C/40°C), Battery Depletion (<3.5V/3.3V), Weak Signal (<-85 dBm), Attitude Tumble (>50°/s), Sequence Gap Injection (+5 jump), and Malformed Packet Injection.
   - Live diagnostics log showing sequence gaps, parse errors, and connection events.

3. **Plot Graphs & Customizable Workspace**
   - Synchronized real-time multi-parameter charts powered by Recharts.
   - Time window selectors: 1 minute, 5 minutes, 15 minutes, 1 hour, and All available.
   - Customizable panels: add/remove panels, dual Y-axes for mismatched units, hover tooltips with UTC timestamps, and reset workspace defaults.
   - Bounded in-memory sliding window for buttery performance without deleting persistent history.

4. **Sensors Registry**
   - Explicit instrumentation registry covering Thermal, Power, Environmental, RF, and MPU6050 6-DOF sensors.
   - Five distinct health states: `NOT CONFIGURED`, `NO DATA`, `STALE`, `AVAILABLE`, `FAULT`.
   - Calibration modal showing nominal operating envelopes, hardware pinouts/I2C addresses, and min/max observed.
   - Unconfigured sensors are explicitly silenced (no false physical fault alerts).

5. **Data History & Exports (IndexedDB)**
   - Persistent storage in browser IndexedDB surviving page reloads, browser restarts, and offline operation.
   - Multi-field filtering: Satellite ID, Data Source (`SIMULATED` vs `HARDWARE`), Status, Sequence range, and time bounds.
   - Pagination (25, 50, 100 records per page), sorting (ascending/descending), and individual packet inspection modal.
   - CSV and JSON export with ISO-8601 UTC timestamps, engineering units in header, and unambiguous `data_source` tagging.
   - Double-confirmed storage purge (never clears history silently on simulator reset).

6. **Alerts & Events Engine**
   - Autonomous rule evaluation with `INFO`, `WARNING`, and `CRITICAL` severities.
   - Hysteresis recovery logic (prevents alert flickering around threshold boundaries).
   - Duplicate suppression: maintains active alert condition without duplicate alert spam.
   - Full lifecycle management: `ACTIVE` → `ACKNOWLEDGED` → `RESOLVED`.
   - Clear disclaimer that defaults are demonstration baselines and must be tuned in Settings.

7. **Mission Overview**
   - Editable mission profile (Mission Title, Callsign ID, Description, Epoch).
   - Live Mission Elapsed Time (MET) counter (`T+DD:HH:MM:SS`).
   - Hardware component inventory and full schema specification.
   - Pipeline architecture flow with honest status indicators (`IMPLEMENTED`, `CONNECTED`, `PLANNED`, `UNVERIFIED`).

8. **Settings Console**
   - LocalStorage persistence with Save, Cancel, and Reset to Defaults actions.
   - Threshold ordering validation (e.g. Warning < Critical for temperature; Warning > Critical for battery voltage).
   - Configurable stale data timeout (default 5000ms), simulator interval (ms), and WebSocket endpoint URL.

---

## 5. Verification & Test Report

| Test Suite / Check | Command | Result | Status |
| :--- | :--- | :--- | :--- |
| **TypeScript Typecheck** | `npm run typecheck` | 0 errors across all views and models | **PASSED** |
| **Production Bundle Build** | `npm run build` | Built in 18.04s (`dist/` generated) | **PASSED** |
| **Packet Validator Tests** | `npm run test` (Vitest) | 4 tests: valid, null preservation, malformed rejection, sequence gap | **PASSED** |
| **Alert Engine Tests** | `npm run test` (Vitest) | 5 tests: warning/critical triggers, duplicate suppression, hysteresis, unconfigured silence | **PASSED** |
| **Simulator Control Tests** | `npm run test` (Vitest) | 3 tests: connect, pause/resume, sequence generation, reset | **PASSED** |
| **Backend Route Verification** | Python internal tests | Root, Health, Push Ingestion, Null Preservation verified | **PASSED** |

### Honest Component Verification Status
- **Simulation Mode & UI Console:** Fully implemented and verified.
- **IndexedDB Storage & CSV/JSON Export:** Fully implemented and verified.
- **Alert Engine & Hysteresis:** Fully implemented and verified.
- **FastAPI WebSocket Backend:** Source complete (`backend/main.py`), dependencies verified (`fastapi`, `uvicorn`, `pyserial`).
- **ESP32 Firmware:** Sketch complete (`firmware/esp32_telemetry.ino`). Physical hardware communication remains **UNVERIFIED** until an operator connects a physical ESP32 via USB/UART. The application displays `DISCONNECTED` or `UNCONFIGURED` when no hardware is attached, never fabricating hardware telemetry.
