/**
 * ==============================================================================
 * ORBITRA CUBESAT MISSION CONTROL - GROUND STATION SERVER & TELEMETRY BRIDGE
 * ==============================================================================
 * 
 * Features:
 * 1. Express REST API for Telemetry Ingestion, History & Ground Station Control
 * 2. Real-time Bi-directional WebSocket Streaming (ws)
 * 3. Integrated ESP32 USB-UART Serial Bridge (auto-detection, auto-reconnect & COM10 priority)
 * 4. UDP Socket Listener (Port 9090) for SDR / Radio Software Ingestion
 * 5. High-Fidelity Autonomous CubeSat Simulation Engine (auto-shuts off when hardware streams)
 * 6. Persistent Local Telemetry Database (JSONL + Fast In-Memory Ring Buffer)
 * 7. Embedded Aerospace Ground Station Frontend with Leaflet GPS Map
 * ==============================================================================
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const cors = require('cors');
const WebSocket = require('ws');

// Optional SerialPort support
let SerialPort = null;
let ReadlineParser = null;
try {
  const sp = require('serialport');
  SerialPort = sp.SerialPort;
  ReadlineParser = require('@serialport/parser-readline').ReadlineParser;
} catch (err) {
  console.warn('[Serial] serialport module not found or failed to load. Native serial bridge disabled.', err.message);
}

// Configuration & State
const HTTP_PORT = process.env.PORT || 3000;
const UDP_PORT = process.env.UDP_PORT || 9090;
const DEFAULT_BAUD = parseInt(process.env.SERIAL_BAUD || '115200', 10);
let targetSerialPort = process.env.SERIAL_PORT || 'COM10';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'telemetry_history.jsonl');
const MAX_HISTORY_BUFFER = 2000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mission State
const missionState = {
  startTime: Date.now(),
  satelliteId: process.env.SATELLITE_ID || 'ORBITRA-01',
  groundStation: {
    name: 'Primary Ground Station',
    lat: 13.0827,
    lon: 80.2707,
    alt: 15.0
  },
  simulationActive: true,      // Active by default until hardware packets arrive
  lastHardwarePacketTime: 0,
  totalPacketsReceived: 0,
  hardwarePacketsCount: 0,
  simulatedPacketsCount: 0,
  connectedClients: 0,
  serial: {
    connected: false,
    port: null,
    baudRate: DEFAULT_BAUD,
    error: null
  }
};

// In-Memory Ring Buffer for high-speed queries
const historyBuffer = [];

function loadHistoryFromDisk() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const lines = fs.readFileSync(DB_FILE, 'utf-8').trim().split('\n');
      const startIdx = Math.max(0, lines.length - MAX_HISTORY_BUFFER);
      for (let i = startIdx; i < lines.length; i++) {
        if (!lines[i]) continue;
        try {
          historyBuffer.push(JSON.parse(lines[i]));
        } catch {}
      }
      console.log(`[Storage] Loaded ${historyBuffer.length} historic telemetry frames from ${DB_FILE}`);
    } catch (e) {
      console.warn('[Storage] Error loading history from disk:', e.message);
    }
  }
}
loadHistoryFromDisk();

function persistTelemetryRecord(record) {
  try {
    fs.appendFileSync(DB_FILE, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.error('[Storage Error] Failed to persist record:', err.message);
  }
}

// Telemetry Normalizer
let packetSequenceCounter = historyBuffer.length > 0 
  ? Math.max(...historyBuffer.map(p => p.packetNo || 0)) 
  : 0;

function normalizeTelemetry(raw, source = 'HARDWARE') {
  packetSequenceCounter++;
  const now = new Date();

  const packetNo = Number.isFinite(Number(raw.packetNo)) 
    ? Number(raw.packetNo) 
    : (Number.isFinite(Number(raw.sequence_number)) ? Number(raw.sequence_number) : packetSequenceCounter);

  const timestamp = typeof raw.timestamp === 'string' && raw.timestamp.length > 10
    ? raw.timestamp
    : now.toISOString();

  // Battery voltage & state of charge (3.3V = 0%, 4.2V = 100%)
  const battery_v = Number.isFinite(Number(raw.battery_v))
    ? Number(raw.battery_v)
    : (Number.isFinite(Number(raw.battery_voltage_v)) 
        ? Number(raw.battery_voltage_v) 
        : (Number.isFinite(Number(raw.vbat)) ? Number(raw.vbat) : 4.12));
  const battery_pct = Math.max(0, Math.min(100, Math.round(((battery_v - 3.3) / (4.2 - 3.3)) * 100)));

  // Temperature
  const temperature = Number.isFinite(Number(raw.temperature))
    ? Number(raw.temperature)
    : (Number.isFinite(Number(raw.temp))
        ? Number(raw.temp)
        : (Number.isFinite(Number(raw.temperature_c)) ? Number(raw.temperature_c) : 24.5));

  const bmpTemperature = Number.isFinite(Number(raw.bmpTemperature))
    ? Number(raw.bmpTemperature)
    : (Number.isFinite(Number(raw.bmp_temp)) ? Number(raw.bmp_temp) : temperature + 0.4);

  const humidity = Number.isFinite(Number(raw.humidity))
    ? Number(raw.humidity)
    : (Number.isFinite(Number(raw.humidity_percent)) ? Number(raw.humidity_percent) : 55.0);

  // Pressure & Altitude
  const pressure = Number.isFinite(Number(raw.pressure))
    ? Number(raw.pressure)
    : (Number.isFinite(Number(raw.bmp_pressure)) ? Number(raw.bmp_pressure) : 1013.25);

  const bmpAltitude = Number.isFinite(Number(raw.bmpAltitude))
    ? Number(raw.bmpAltitude)
    : (Number.isFinite(Number(raw.bmp_altitude)) ? Number(raw.bmp_altitude) : 15.0);

  // GPS
  const latitude = Number.isFinite(Number(raw.latitude))
    ? Number(raw.latitude)
    : (Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : missionState.groundStation.lat);

  const longitude = Number.isFinite(Number(raw.longitude))
    ? Number(raw.longitude)
    : (Number.isFinite(Number(raw.lng)) ? Number(raw.lng) : (Number.isFinite(Number(raw.lon)) ? Number(raw.lon) : missionState.groundStation.lon));

  const altitude = Number.isFinite(Number(raw.altitude))
    ? Number(raw.altitude)
    : (Number.isFinite(Number(raw.alt)) ? Number(raw.alt) : bmpAltitude);

  const speed = Number.isFinite(Number(raw.speed)) ? Number(raw.speed) : 0.0;
  const satellites = Number.isFinite(Number(raw.satellites)) ? Number(raw.satellites) : (raw.gpsFix ? 8 : 0);
  const gpsFix = raw.gpsFix !== undefined ? (Number(raw.gpsFix) ? 1 : 0) : ((latitude !== 0 || longitude !== 0) ? 1 : 0);

  // IMU 6-DOF
  const ax = Number.isFinite(Number(raw.ax)) ? Number(raw.ax) : (Number.isFinite(Number(raw.acceleration_x)) ? Number(raw.acceleration_x) : 0.0);
  const ay = Number.isFinite(Number(raw.ay)) ? Number(raw.ay) : (Number.isFinite(Number(raw.acceleration_y)) ? Number(raw.acceleration_y) : 0.0);
  const az = Number.isFinite(Number(raw.az)) ? Number(raw.az) : (Number.isFinite(Number(raw.acceleration_z)) ? Number(raw.acceleration_z) : 1.0);
  const totalAcc = Number.isFinite(Number(raw.totalAcc)) ? Number(raw.totalAcc) : Math.sqrt(ax * ax + ay * ay + az * az);

  const gx = Number.isFinite(Number(raw.gx)) ? Number(raw.gx) : (Number.isFinite(Number(raw.gyroscope_x)) ? Number(raw.gyroscope_x) : 0.0);
  const gy = Number.isFinite(Number(raw.gy)) ? Number(raw.gy) : (Number.isFinite(Number(raw.gyroscope_y)) ? Number(raw.gyroscope_y) : 0.0);
  const gz = Number.isFinite(Number(raw.gz)) ? Number(raw.gz) : (Number.isFinite(Number(raw.gyroscope_z)) ? Number(raw.gyroscope_z) : 0.0);

  const roll = Number.isFinite(Number(raw.roll)) ? Number(raw.roll) : 0.0;
  const pitch = Number.isFinite(Number(raw.pitch)) ? Number(raw.pitch) : 0.0;
  const yaw = Number.isFinite(Number(raw.yaw)) ? Number(raw.yaw) : 0.0;

  const rssi = Number.isFinite(Number(raw.rssi)) 
    ? Number(raw.rssi) 
    : (Number.isFinite(Number(raw.signal_strength_dbm)) ? Number(raw.signal_strength_dbm) : -68.0);

  const status = typeof raw.status === 'string' ? raw.status : 'NOMINAL';

  return {
    packetNo,
    sequence_number: packetNo, // backwards-compatibility alias
    satellite_id: raw.satellite_id || missionState.satelliteId,
    timestamp,
    time_ms: now.getTime(),
    source,
    battery_v: parseFloat(battery_v.toFixed(3)),
    battery_voltage_v: parseFloat(battery_v.toFixed(3)),
    battery_pct,
    temperature: parseFloat(temperature.toFixed(2)),
    temperature_c: parseFloat(temperature.toFixed(2)),
    bmpTemperature: parseFloat(bmpTemperature.toFixed(2)),
    humidity: parseFloat(humidity.toFixed(1)),
    humidity_percent: parseFloat(humidity.toFixed(1)),
    pressure: parseFloat(pressure.toFixed(2)),
    bmpAltitude: parseFloat(bmpAltitude.toFixed(2)),
    latitude: parseFloat(latitude.toFixed(6)),
    longitude: parseFloat(longitude.toFixed(6)),
    altitude: parseFloat(altitude.toFixed(2)),
    speed: parseFloat(speed.toFixed(2)),
    satellites: parseInt(satellites, 10),
    gpsFix: parseInt(gpsFix, 10),
    ax: parseFloat(ax.toFixed(3)),
    ay: parseFloat(ay.toFixed(3)),
    az: parseFloat(az.toFixed(3)),
    totalAcc: parseFloat(totalAcc.toFixed(3)),
    acceleration_x: parseFloat(ax.toFixed(3)),
    acceleration_y: parseFloat(ay.toFixed(3)),
    acceleration_z: parseFloat(az.toFixed(3)),
    gx: parseFloat(gx.toFixed(2)),
    gy: parseFloat(gy.toFixed(2)),
    gz: parseFloat(gz.toFixed(2)),
    gyroscope_x: parseFloat(gx.toFixed(2)),
    gyroscope_y: parseFloat(gy.toFixed(2)),
    gyroscope_z: parseFloat(gz.toFixed(2)),
    roll: parseFloat(roll.toFixed(2)),
    pitch: parseFloat(pitch.toFixed(2)),
    yaw: parseFloat(yaw.toFixed(2)),
    rssi: parseFloat(rssi.toFixed(1)),
    signal_strength_dbm: parseFloat(rssi.toFixed(1)),
    status
  };
}

function ingestTelemetryPacket(rawPayload, source = 'HARDWARE') {
  try {
    const packet = normalizeTelemetry(rawPayload, source);

    missionState.totalPacketsReceived++;
    if (source === 'HARDWARE' || source === 'SERIAL' || source === 'UDP') {
      missionState.hardwarePacketsCount++;
      missionState.lastHardwarePacketTime = Date.now();

      // Automatically turn OFF simulation mode when real hardware telemetry is detected!
      if (missionState.simulationActive) {
        missionState.simulationActive = false;
        console.log(`[Ground Station] Real hardware telemetry detected on ${source}! Switching simulation mode OFF.`);
        broadcastSystemState();
      }
    } else {
      missionState.simulatedPacketsCount++;
    }

    historyBuffer.push(packet);
    if (historyBuffer.length > MAX_HISTORY_BUFFER) historyBuffer.shift();

    persistTelemetryRecord(packet);
    broadcastTelemetry(packet);
    return packet;
  } catch (err) {
    console.error('[Ingest Error]', err);
    return null;
  }
}

// WebSocket Broadcast
function broadcastTelemetry(packet) {
  const jsonString = JSON.stringify(packet);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(jsonString); } catch {}
    }
  });
}

function broadcastRawLog(lineText) {
  const msg = JSON.stringify({
    type: 'RAW_DEBUG',
    timestamp: new Date().toISOString(),
    line: lineText
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch {}
    }
  });
}

function broadcastSystemState() {
  const stateMsg = JSON.stringify({
    type: 'SYSTEM_STATE',
    system: {
      simulationActive: missionState.simulationActive,
      serialConnected: missionState.serial.connected,
      serialPort: missionState.serial.port,
      serialError: missionState.serial.error,
      totalPackets: missionState.totalPacketsReceived,
      hardwarePackets: missionState.hardwarePacketsCount,
      connectedClients: missionState.connectedClients
    }
  });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(stateMsg); });
}

wss.on('connection', (socket, req) => {
  missionState.connectedClients = wss.clients.size;
  const latest = historyBuffer.length > 0 ? historyBuffer[historyBuffer.length - 1] : null;

  socket.send(JSON.stringify({
    type: 'INIT_STATE',
    system: {
      satelliteId: missionState.satelliteId,
      simulationActive: missionState.simulationActive,
      serialConnected: missionState.serial.connected,
      serialPort: missionState.serial.port,
      serialError: missionState.serial.error,
      groundStation: missionState.groundStation,
      uptimeSec: Math.floor((Date.now() - missionState.startTime) / 1000)
    },
    latest
  }));

  socket.on('message', (messageText) => {
    try {
      const msg = JSON.parse(messageText.toString());
      if (msg.command === 'toggle_simulation') {
        missionState.simulationActive = !missionState.simulationActive;
        console.log(`[Simulation] Toggled: ${missionState.simulationActive ? 'ON' : 'OFF'}`);
        broadcastSystemState();
      } else if (msg.command === 'set_simulation') {
        missionState.simulationActive = !!msg.enabled;
        broadcastSystemState();
      } else if (msg.command === 'request_history') {
        const limit = Math.min(parseInt(msg.limit || '50', 10), 500);
        socket.send(JSON.stringify({ type: 'HISTORY_BATCH', points: historyBuffer.slice(-limit) }));
      } else if (msg.command === 'connect_serial' && msg.port) {
        targetSerialPort = msg.port;
        connectSerialPort(msg.port, msg.baud || DEFAULT_BAUD);
      } else if (msg.command === 'disconnect_serial') {
        disconnectSerialPort();
      } else if (msg.command === 'scan_ports') {
        scanAvailableSerialPorts().then(ports => socket.send(JSON.stringify({ type: 'SERIAL_PORTS_LIST', ports })));
      } else if (msg.command === 'uplink_ping') {
        socket.send(JSON.stringify({ type: 'UPLINK_ACK', timestamp: new Date().toISOString() }));
      }
    } catch {}
  });

  socket.on('close', () => { missionState.connectedClients = wss.clients.size; });
});

// ==============================================================================
// ESP32 USB-SERIAL BRIDGE WITH RECONNECT SUPERVISOR
// ==============================================================================
let activeSerialInstance = null;
let activeSerialParser = null;
let isConnectingSerial = false;

function parseFlexibleSerialLine(line) {
  line = line.trim();
  if (!line) return null;

  if (line.startsWith('{') && line.endsWith('}')) {
    try { return JSON.parse(line); } catch (e) {}
  }

  const jsonMatch = line.match(/(\{.*\})/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch (e) {}
  }

  const extractNum = (patterns) => {
    for (const p of patterns) {
      const match = line.match(p);
      if (match && match[1] !== undefined) {
        const val = parseFloat(match[1]);
        if (!isNaN(val)) return val;
      }
    }
    return null;
  };

  const temp = extractNum([
    /(?:\bbmp\s*temp(?:erature)?|\btemp(?:erature)?)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i,
    /([+-]?\d+(?:\.\d+)?)\s*°?C\b/i
  ]);
  const bmpTemp = extractNum([/\bbmp\s*temp(?:erature)?\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]) ?? temp;
  const humidity = extractNum([
    /(?:\bhumidity|\bhum)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i,
    /([+-]?\d+(?:\.\d+)?)\s*%\b/
  ]);
  const pressure = extractNum([
    /(?:\bpressure|\bpress|\bbaro)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i,
    /([+-]?\d+(?:\.\d+)?)\s*hPa\b/i
  ]);
  const alt = extractNum([
    /(?:\bbmp\s*alt(?:itude)?|\bgps\s*alt(?:itude)?|\balt(?:itude)?)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i,
    /([+-]?\d+(?:\.\d+)?)\s*m\b/i
  ]);
  const bat = extractNum([
    /(?:\bbat(?:tery)?|\bv_?bat(?:tery)?|\bvoltage)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i,
    /([+-]?\d+(?:\.\d+)?)\s*V\b/i
  ]);

  let ax = null, ay = null, az = null;
  const mAcc = line.match(/(?:\bacc(?:el)?\s*x|\bax|\bx)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)(?:[\s,|]+(?:\by|\bay)\s*[:=]\s*([+-]?\d+(?:\.\d+)?))?(?:[\s,|]+(?:\bz|\baz)\s*[:=]\s*([+-]?\d+(?:\.\d+)?))?/i);
  if (mAcc) {
    if (mAcc[1] !== undefined) ax = parseFloat(mAcc[1]);
    if (mAcc[2] !== undefined) ay = parseFloat(mAcc[2]);
    if (mAcc[3] !== undefined) az = parseFloat(mAcc[3]);
  }
  if (ax === null) ax = extractNum([/(?:\bacc(?:el)?\s*x|\bax)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  if (ay === null) ay = extractNum([/(?:\bacc(?:el)?\s*y|\bay)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  if (az === null) az = extractNum([/(?:\bacc(?:el)?\s*z|\baz)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);

  let gx = null, gy = null, gz = null;
  const mGyro = line.match(/(?:\bgyro\s*x|\bgx)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)(?:[\s,|]+(?:\by|\bgy)\s*[:=]\s*([+-]?\d+(?:\.\d+)?))?(?:[\s,|]+(?:\bz|\bgz)\s*[:=]\s*([+-]?\d+(?:\.\d+)?))?/i);
  if (mGyro) {
    if (mGyro[1] !== undefined) gx = parseFloat(mGyro[1]);
    if (mGyro[2] !== undefined) gy = parseFloat(mGyro[2]);
    if (mGyro[3] !== undefined) gz = parseFloat(mGyro[3]);
  }
  if (gx === null) gx = extractNum([/(?:\bgyro\s*x|\bgx)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  if (gy === null) gy = extractNum([/(?:\bgyro\s*y|\bgy)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  if (gz === null) gz = extractNum([/(?:\bgyro\s*z|\bgz)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);

  const roll = extractNum([/(?:\broll)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  const pitch = extractNum([/(?:\bpitch)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  const yaw = extractNum([/(?:\byaw)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);

  const lat = extractNum([/(?:\blat(?:itude)?)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  const lon = extractNum([/(?:\blon(?:gitude)?|\blng)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  const sats = extractNum([/(?:\bsat(?:ellite)?s?)\s*[:=]\s*(\d+)/i]);
  const speed = extractNum([/(?:\bspeed)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/i]);
  const packetNo = extractNum([/(?:\bpacket(?:No)?|\bseq(?:uence)?|\bpkt)\s*[:#=]\s*(\d+)/i]);

  if (temp !== null || humidity !== null || pressure !== null || alt !== null || ax !== null || roll !== null || lat !== null || bat !== null) {
    const res = {};
    if (packetNo !== null) res.packetNo = packetNo;
    if (temp !== null) res.temperature = temp;
    if (bmpTemp !== null) res.bmpTemperature = bmpTemp;
    if (humidity !== null) res.humidity = humidity;
    if (pressure !== null) res.pressure = pressure;
    if (alt !== null) { res.altitude = alt; res.bmpAltitude = alt; }
    if (bat !== null) res.battery_v = bat;
    if (ax !== null) res.ax = ax;
    if (ay !== null) res.ay = ay;
    if (az !== null) res.az = az;
    if (gx !== null) res.gx = gx;
    if (gy !== null) res.gy = gy;
    if (gz !== null) res.gz = gz;
    if (roll !== null) res.roll = roll;
    if (pitch !== null) res.pitch = pitch;
    if (yaw !== null) res.yaw = yaw;
    if (lat !== null) res.latitude = lat;
    if (lon !== null) res.longitude = lon;
    if (sats !== null) res.satellites = sats;
    if (speed !== null) res.speed = speed;
    return res;
  }
  return null;
}

async function scanAvailableSerialPorts() {
  if (!SerialPort) return [];
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || 'Standard Serial',
      friendlyName: p.friendlyName || p.path
    }));
  } catch { return []; }
}

function connectSerialPort(portName, baudRate = DEFAULT_BAUD) {
  if (!SerialPort) return false;

  // If already open on the exact port, don't reopen
  if (activeSerialInstance && activeSerialInstance.isOpen && missionState.serial.port === portName) {
    return true;
  }

  disconnectSerialPort();
  targetSerialPort = portName;
  isConnectingSerial = true;

  console.log(`[Serial Bridge] Attempting connection to ${portName} @ ${baudRate} baud...`);

  try {
    activeSerialInstance = new SerialPort({
      path: portName,
      baudRate: baudRate,
      autoOpen: false
    });

    activeSerialParser = activeSerialInstance.pipe(new ReadlineParser({ delimiter: '\n' }));

    activeSerialInstance.open((err) => {
      isConnectingSerial = false;
      if (err) {
        let cleanMsg = err.message;
        if (cleanMsg.includes('Access denied')) {
          cleanMsg = `Opening ${portName}: Access denied. (COM port is open in Arduino IDE / another app! Please CLOSE Arduino Serial Monitor)`;
          console.warn(`\n[WARNING] =========================================================`);
          console.warn(`[WARNING] Cannot open ${portName}: ACCESS DENIED!`);
          console.warn(`[WARNING] Your Arduino IDE Serial Monitor currently has ${portName} locked!`);
          console.warn(`[WARNING] >> PLEASE CLOSE THE SERIAL MONITOR TAB IN ARDUINO IDE <<`);
          console.warn(`[WARNING] The ground station will auto-connect as soon as you close it.`);
          console.warn(`[WARNING] =========================================================\n`);
        } else {
          console.error(`[Serial Error] Failed to open ${portName}:`, err.message);
        }

        missionState.serial.connected = false;
        missionState.serial.port = portName;
        missionState.serial.error = cleanMsg;
        broadcastSystemState();
        return;
      }

      missionState.serial.connected = true;
      missionState.serial.port = portName;
      missionState.serial.baudRate = baudRate;
      missionState.serial.error = null;
      console.log(`[Serial Bridge] >>> SUCCESS! Connected to ESP32 on ${portName} @ ${baudRate} baud <<<`);
      broadcastSystemState();
    });

    activeSerialParser.on('data', (rawLine) => {
      const line = rawLine.toString().trim();
      if (!line) return;

      // Always broadcast raw line to the dashboard terminal (live Arduino Serial Monitor)
      broadcastRawLog(line);

      // Attempt flexible telemetry parsing (JSON or text-formatted values)
      const parsed = parseFlexibleSerialLine(line);
      if (parsed) {
        ingestTelemetryPacket(parsed, 'SERIAL');
      } else {
        console.log(`[Arduino Print] ${line}`);
      }
    });

    activeSerialInstance.on('close', () => {
      console.log(`[Serial Bridge] Port ${portName} was closed.`);
      missionState.serial.connected = false;
      missionState.serial.port = null;
      broadcastSystemState();
    });

    activeSerialInstance.on('error', (err) => {
      console.error(`[Serial Bridge Error] ${portName}:`, err.message);
      missionState.serial.connected = false;
      missionState.serial.error = err.message;
      broadcastSystemState();
    });

    return true;
  } catch (e) {
    isConnectingSerial = false;
    missionState.serial.error = e.message;
    return false;
  }
}

function disconnectSerialPort() {
  if (activeSerialInstance && activeSerialInstance.isOpen) {
    try { activeSerialInstance.close(); } catch {}
  }
  activeSerialInstance = null;
  activeSerialParser = null;
  missionState.serial.connected = false;
  missionState.serial.port = null;
  broadcastSystemState();
}

// Supervisor: scans and keeps connection to COM10 / ESP32 alive
async function serialPortSupervisor() {
  if (missionState.serial.connected || isConnectingSerial) return;
  if (!SerialPort) return;

  const ports = await scanAvailableSerialPorts();
  if (ports.length === 0) return;

  // Look for target port (default COM10) or CH340 / CP210x / FTDI
  const target = ports.find(p => p.path.toUpperCase() === targetSerialPort.toUpperCase())
    || ports.find(p => {
      const desc = `${p.path} ${p.manufacturer} ${p.friendlyName}`.toLowerCase();
      return desc.includes('ch340') || desc.includes('cp210') || desc.includes('ftdi') || desc.includes('usb');
    })
    || ports[0];

  if (target) {
    connectSerialPort(target.path, DEFAULT_BAUD);
  }
}

// Check every 3 seconds for port availability (auto-connects the second Arduino Serial Monitor is closed!)
setInterval(serialPortSupervisor, 3000);

// UDP Listener (Port 9090)
try {
  const udpServer = dgram.createSocket('udp4');
  udpServer.on('message', (msg) => {
    try { ingestTelemetryPacket(JSON.parse(msg.toString()), 'UDP'); } catch {}
  });
  udpServer.bind(UDP_PORT);
} catch {}

// Simulation Engine
const simEngine = {
  orbitAngle: 0,
  battery: 4.18,
  temperature: 24.5,
  altitude: 420.5,
  roll: 0.0,
  pitch: 0.0,
  yaw: 45.0,
  inSunlight: true,

  step() {
    this.orbitAngle += 0.015;
    const baseLat = missionState.groundStation.lat;
    const baseLon = missionState.groundStation.lon;
    const lat = baseLat + Math.sin(this.orbitAngle) * 8.5;
    const lon = ((baseLon + (this.orbitAngle * 180 / Math.PI) * 0.4 + 180) % 360) - 180;

    this.inSunlight = Math.sin(this.orbitAngle * 0.5) > -0.2;
    this.battery = this.inSunlight 
      ? Math.min(4.20, this.battery + 0.003 + (Math.random() - 0.5) * 0.001)
      : Math.max(3.45, this.battery - 0.005 + (Math.random() - 0.5) * 0.001);

    const targetTemp = this.inSunlight ? 26.5 : 18.0;
    this.temperature += (targetTemp - this.temperature) * 0.05 + (Math.random() - 0.5) * 0.25;

    const pressure = 1013.25 + Math.sin(this.orbitAngle * 2) * 4.5 + (Math.random() - 0.5) * 0.8;
    const bmpAlt = 15.0 + Math.sin(this.orbitAngle) * 35.0 + (Math.random() - 0.5) * 1.5;

    this.roll = Math.sin(this.orbitAngle * 3) * 6.5 + (Math.random() - 0.5) * 0.8;
    this.pitch = Math.cos(this.orbitAngle * 2.5) * 4.8 + (Math.random() - 0.5) * 0.6;
    this.yaw = (this.yaw + 0.5) % 360;

    const ax = (Math.random() - 0.5) * 0.08;
    const ay = (Math.random() - 0.5) * 0.08;
    const az = 0.98 + (Math.random() - 0.5) * 0.04;

    return {
      battery_v: this.battery,
      temperature: this.temperature,
      bmpTemperature: this.temperature + 0.35,
      humidity: 52.0 + Math.sin(this.orbitAngle) * 6.0,
      pressure,
      altitude: bmpAlt,
      bmpAltitude: bmpAlt,
      latitude: lat,
      longitude: lon,
      speed: 18.5 + (Math.random() - 0.5) * 2.0,
      satellites: 9 + Math.floor(Math.random() * 3),
      gpsFix: 1,
      ax, ay, az,
      totalAcc: Math.sqrt(ax * ax + ay * ay + az * az),
      gx: Math.sin(this.orbitAngle * 4) * 2.5,
      gy: Math.cos(this.orbitAngle * 3) * 1.8,
      gz: 0.5,
      roll: this.roll,
      pitch: this.pitch,
      yaw: this.yaw,
      rssi: -66.0 + (Math.random() - 0.5) * 3.0,
      status: this.battery < 3.6 ? 'WARN:LOW_BATT' : 'NOMINAL'
    };
  }
};

// Simulation Interval (1000ms = 1 Hz telemetry stream)
setInterval(() => {
  const isHardwareActive = (Date.now() - missionState.lastHardwarePacketTime) < 5000;

  // Never simulate when real hardware packets are flowing!
  if (isHardwareActive) {
    if (missionState.simulationActive) {
      missionState.simulationActive = false;
      broadcastSystemState();
    }
    return;
  }

  // Only simulate if explicitly enabled
  if (missionState.simulationActive) {
    const simData = simEngine.step();
    ingestTelemetryPacket(simData, 'SIMULATION');
  }
}, 1000);

// REST API Endpoints
app.post(['/api/telemetry', '/api/telemetry/push'], (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Payload must be a valid JSON object' });
  }
  const packet = ingestTelemetryPacket(req.body, req.body.data_source || 'HTTP_POST');
  res.status(201).json({ success: true, packetNo: packet.packetNo, timestamp: packet.timestamp });
});

app.get('/api/history', (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit || '50', 10)), 1000);
  res.json(historyBuffer.slice(-limit));
});

app.get('/api/latest', (req, res) => {
  if (historyBuffer.length === 0) return res.status(404).json({ error: 'No data' });
  res.json(historyBuffer[historyBuffer.length - 1]);
});

app.get('/api/stats', (req, res) => {
  res.json({
    satelliteId: missionState.satelliteId,
    uptimeSeconds: Math.floor((Date.now() - missionState.startTime) / 1000),
    totalPackets: missionState.totalPacketsReceived,
    hardwarePackets: missionState.hardwarePacketsCount,
    simulatedPackets: missionState.simulatedPacketsCount,
    simulationActive: missionState.simulationActive,
    lastHardwarePacketTime: missionState.lastHardwarePacketTime,
    connectedWebSockets: missionState.connectedClients,
    serial: missionState.serial
  });
});

app.get('/api/serial/ports', async (req, res) => {
  const ports = await scanAvailableSerialPorts();
  res.json({ available: ports, current: missionState.serial });
});

app.post('/api/serial/connect', (req, res) => {
  const { port, baudRate } = req.body;
  targetSerialPort = port || targetSerialPort;
  const success = connectSerialPort(targetSerialPort, baudRate || DEFAULT_BAUD);
  res.json({ success, port: targetSerialPort, baudRate: baudRate || DEFAULT_BAUD, status: missionState.serial });
});

app.post('/api/serial/disconnect', (req, res) => {
  disconnectSerialPort();
  res.json({ success: true });
});

app.post('/api/simulation/toggle', (req, res) => {
  missionState.simulationActive = !missionState.simulationActive;
  console.log(`[Simulation] User toggled to: ${missionState.simulationActive}`);
  broadcastSystemState();
  res.json({ success: true, simulationActive: missionState.simulationActive });
});

app.delete('/api/history', (req, res) => {
  historyBuffer.length = 0;
  res.json({ success: true });
});

// Fallback to Dashboard SPA
app.use((req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`<h2>ORBITRA Ground Station Server Running</h2>`);
  }
});

// Launch
server.listen(HTTP_PORT, () => {
  console.log('================================================================');
  console.log('   ORBITRA CUBESAT MISSION CONTROL - GROUND STATION SERVER      ');
  console.log('================================================================');
  console.log(` Web Dashboard:      http://localhost:${HTTP_PORT}`);
  console.log(` Telemetry Stream:   ws://localhost:${HTTP_PORT}`);
  console.log(` Target Serial Port: ${targetSerialPort} @ ${DEFAULT_BAUD} baud`);
  console.log('================================================================\n');

  // Initial attempt to connect
  serialPortSupervisor();
});
