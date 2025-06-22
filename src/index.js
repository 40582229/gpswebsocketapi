// ws-server.js
const http = require('http');
const WebSocket = require('ws');

// Create regular HTTP server
const server = http.createServer();

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected via ws');

  ws.on('message', (msg) => {
    console.log('Received:', msg.toString());

      wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {

        client.send(msg);
      }
    });
  });

 
  ws.send('Connected to gps server!');
});

server.listen(process.env.PORT,'0.0.0.0', () => {
  console.log(`WebSocket server running on ws://localhost:${process.env.PORT}`);
});
