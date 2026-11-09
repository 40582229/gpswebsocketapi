// One job: connect to the dump, forward everything it says to every listener.
const http = require('http');
const net = require('net');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;
const LOG = process.env.LOG === '1';
const DUMP_URL = process.env.DUMP_URL || 'http://localhost:8080/data/aircraft.json';

// ---- listeners -----------------------------------------------------------
const server = http.createServer();
const wss = new WebSocket.Server({ server });

function send(data) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on('connection', () => {
  console.log('listener connected, total', wss.clients.size);
});

// ---- SBS-1 lines -> one JSON object per message --------------------------
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

// ---- the dump ------------------------------------------------------------
// ws://host:port   dump pushes frames        (readsb --net-connector, or a ws bridge)
// tcp://host:30003 SBS-1 lines, sent as JSON (dump1090 --net-sbs-port 30003)
// http://host:8080 poll aircraft.json 1/s    (dump1090-fa default web server)
function connectDump() {
  const url = new URL(DUMP_URL);

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    (async function poll() {
      try {
        const res = await fetch(url);
        send(await res.text());
      } catch (err) {
        console.error('dump poll failed:', err.message);
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
        const json = JSON.stringify(msg);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on ws://localhost:${PORT} <- ${DUMP_URL}`);
});
