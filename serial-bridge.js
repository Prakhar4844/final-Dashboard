/**
 * ==============================================================================
 * ORBITRA CUBESAT - STANDALONE ESP32 SERIAL BRIDGE
 * ==============================================================================
 * Connects to the ESP32 Ground Station Receiver (RX_cubesat.ino) via USB Serial UART,
 * parses incoming telemetry JSON lines, and pushes them directly to the
 * ORBITRA backend server via HTTP POST and/or WebSocket.
 * ==============================================================================
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const http = require('http');

const SERVER_HOST = process.env.SERVER_HOST || 'localhost';
const SERVER_PORT = process.env.SERVER_PORT || 3000;
const API_URL = `http://${SERVER_HOST}:${SERVER_PORT}/api/telemetry`;
const DEFAULT_BAUD = parseInt(process.env.SERIAL_BAUD || '115200', 10);
const TARGET_PORT = process.env.SERIAL_PORT || 'COM10';

async function findESP32Port() {
  const ports = await SerialPort.list();
  if (!ports || ports.length === 0) return null;

  if (TARGET_PORT) {
    const match = ports.find(p => p.path.toUpperCase() === TARGET_PORT.toUpperCase());
    if (match) return match.path;
  }

  // Look for common USB-UART bridges (CP210x, CH340, FTDI, Prolific)
  for (const p of ports) {
    const desc = `${p.path} ${p.manufacturer || ''} ${p.friendlyName || ''}`.toLowerCase();
    if (desc.includes('cp210') || desc.includes('ch340') || desc.includes('ftdi') || desc.includes('usb') || desc.includes('uart')) {
      return p.path;
    }
  }

  return ports[0].path;
}

function pushTelemetryHttp(payload) {
  const postData = JSON.stringify(payload);
  const options = {
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: '/api/telemetry',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 3000
  };

  const req = http.request(options, (res) => {
    // success
  });

  req.on('error', (err) => {
    console.warn(`[Bridge HTTP Warning] Failed to reach server: ${err.message}`);
  });

  req.write(postData);
  req.end();
}

async function startBridge() {
  console.log('================================================================');
  console.log('       ORBITRA ESP32 GROUND STATION SERIAL BRIDGE               ');
  console.log('================================================================');
  console.log(` Target Server:  ${API_URL}`);
  console.log(` Baud Rate:      ${DEFAULT_BAUD}`);
  console.log(' Scanning for ESP32 receiver on USB ports...');

  const portName = await findESP32Port();
  if (!portName) {
    console.warn('[Bridge] No USB COM ports detected. Retrying in 3 seconds...');
    setTimeout(startBridge, 3000);
    return;
  }

  console.log(`[Bridge] Connecting to ${portName}...`);

  const port = new SerialPort({
    path: portName,
    baudRate: DEFAULT_BAUD,
    autoOpen: true
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  port.on('open', () => {
    console.log(`[Bridge] Connected to ESP32 on ${portName} @ ${DEFAULT_BAUD} baud!`);
    console.log(' Listening for incoming ESP-NOW telemetry packets...');
  });

  parser.on('data', (lineRaw) => {
    const line = lineRaw.toString().trim();
    if (!line) return;

    if (!line.startsWith('{')) {
      console.log(`[ESP32] ${line}`);
      return;
    }

    try {
      const data = JSON.parse(line);
      console.log(`[Telemetry Ingest] Packet #${data.packetNo || '?'} | Temp: ${data.temperature || data.bmpTemperature}°C | Alt: ${data.altitude || data.bmpAltitude}m | Satellites: ${data.satellites}`);
      pushTelemetryHttp(data);
    } catch (e) {
      console.warn('[Bridge Parse Error] Malformed JSON line:', line);
    }
  });

  port.on('close', () => {
    console.warn(`[Bridge] Serial connection to ${portName} closed. Reconnecting in 3s...`);
    setTimeout(startBridge, 3000);
  });

  port.on('error', (err) => {
    console.error(`[Bridge Error] Serial port error:`, err.message);
    setTimeout(startBridge, 3000);
  });
}

startBridge();
