// One job: connect to the dump, merge what it says per aircraft, forward that to every listener.
const http = require('http');

// Read .env if there is one. Real env vars still win (loadEnvFile never overrides).
try {
  process.loadEnvFile();
} catch {
  // no .env, or Node older than 20.12
}

const net = require('net');
const os = require('os');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;
const LOG = process.env.LOG === '1';
const DUMP_URL = process.env.DUMP_URL || 'http://localhost:8080/data/aircraft.json';
const STALE_MS = 30_000;

// dump1090's web server, for the one field SBS drops: the emitter category.
// Defaults to the same host as the dump, port 8080.
const CATEGORY_URL = (() => {
  if (process.env.CATEGORY_URL) return process.env.CATEGORY_URL;
  const url = new URL(DUMP_URL);
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  const proto = url.protocol === 'wss:' ? 'https:' : 'http:';
  return `${proto}//${url.hostname}:8080/data/aircraft.json`;
})();

// ---- listeners -----------------------------------------------------------
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// hex -> everything heard about that aircraft so far
const aircraft = new Map();
// hex -> emitter category, refilled from aircraft.json
const categories = new Map();

// Only aircraft with a position can be drawn, so only those are sent.
function positioned(a) {
  return a.lat !== undefined && a.lon !== undefined;
}

function send(data) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on('connection', (ws) => {
  console.log('listener connected, total', wss.clients.size);
  // catch the newcomer up on everything already known
  for (const a of aircraft.values()) if (positioned(a)) ws.send(JSON.stringify(a));
});

// forget aircraft nothing has been heard from in a while
setInterval(() => {
  const cutoff = Date.now() - STALE_MS;
  for (const [hex, a] of aircraft) if (a.lastSeen < cutoff) aircraft.delete(hex);
}, 5000);

// ---- SBS-1 lines -> merged per-aircraft JSON -----------------------------
// MSG,<type>,<session>,<aircraft id>,<hex>,<flight id>,<date gen>,<time gen>,
// <date log>,<time log>,<callsign>,<alt>,<speed>,<track>,<lat>,<lon>,
// <vert rate>,<squawk>,<alert>,<emergency>,<spi>,<on ground>
const NUMERIC = { 11: 'altitude', 12: 'speed', 13: 'track', 14: 'lat', 15: 'lon', 16: 'verticalRate' };

function parseSbs(line) {
  const f = line.split(',');
  if (f[0] !== 'MSG' || !f[4]) return null;

  const msg = { hex: f[4] };
  for (const [index, key] of Object.entries(NUMERIC)) {
    if (f[index] !== '' && f[index] !== undefined) msg[key] = Number(f[index]);
  }
  if (f[10]) msg.callsign = f[10].trim();
  if (f[17]) msg.squawk = f[17];
  if (f[21] === '-1') msg.onGround = true;
  if (f[21] === '0') msg.onGround = false;

  return msg;
}

function merge(msg) {
  const merged = { ...aircraft.get(msg.hex), ...msg, lastSeen: Date.now() };
  if (categories.has(msg.hex)) merged.category = categories.get(msg.hex);
  aircraft.set(msg.hex, merged);
  return merged;
}

// ---- emitter category, from aircraft.json ---------------------------------
let lastPollError = '';

async function pollCategories() {
  try {
    const res = await fetch(CATEGORY_URL);
    const data = await res.json();
    for (const a of data.aircraft ?? []) {
      if (a.hex && a.category) categories.set(a.hex.toUpperCase(), a.category);
    }
    lastPollError = '';
  } catch (err) {
    if (err.message !== lastPollError) {
      lastPollError = err.message;
      console.error('category poll failed:', CATEGORY_URL, err.message);
    }
  }
  setTimeout(pollCategories, 2000);
}

// ---- the dump ------------------------------------------------------------
// ws://host:port   dump pushes frames        (readsb --net-connector, or a ws bridge)
// tcp://host:30003 SBS-1 lines, merged per aircraft
// http://host:8080 poll aircraft.json 1/s    (dump1090-fa default web server)
function connectDump() {
  const url = new URL(DUMP_URL);

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    (async function poll() {
      try {
        const res = await fetch(url);
        send(await res.text());
      } catch (err) {
        console.error('dump poll failed:', url.href, err.message);
      }
      setTimeout(poll, 1000);
    })();
    return;
  }

  if (url.protocol === 'tcp:') {
    const socket = net.connect(Number(url.port || 30003), url.hostname);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => console.log('dump connected:', url.href));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const msg = parseSbs(line);
        if (!msg) continue;
        const merged = merge(msg);
        // heard but not yet located: keep merging, don't send yet
        if (!positioned(merged)) continue;
        const json = JSON.stringify(merged);
        if (LOG) console.log(json);
        send(json);
      }
    });
    socket.on('error', (err) => console.error('dump error:', err.message));
    socket.on('close', () => setTimeout(connectDump, 2000));
    return;
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    const ws = new WebSocket(url.href);
    ws.on('open', () => console.log('dump connected:', url.href));
    ws.on('message', (msg) => send(msg));
    ws.on('error', (err) => console.error('dump error:', err.message));
    ws.on('close', () => setTimeout(connectDump, 2000));
    return;
  }

  throw new Error(`Unsupported DUMP_URL: ${DUMP_URL}`);
}

connectDump();
if (CATEGORY_URL !== DUMP_URL) pollCategories();

// 0.0.0.0 = every interface, so anything on the LAN can connect
server.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on port ${PORT} <- ${DUMP_URL}`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) console.log(`  ws://${iface.address}:${PORT}`);
    }
  }
});
