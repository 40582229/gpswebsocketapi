# gpswebsocketapi

Connects to the dump and forwards everything it says to every WebSocket listener.

## .env

```
PORT=3001
DUMP_URL=http://localhost:8080/data/aircraft.json
LOG=1
```

Read at startup, so `npm start` alone is enough. Variables set on the command line still win.

`DUMP_URL` accepts:

| URL                              | source                                            |
| -------------------------------- | ------------------------------------------------- |
| `http://localhost:8080/data/aircraft.json` | dump1090-fa web server, polled every 1 s |
| `tcp://localhost:30003`          | SBS-1 lines (`--net-sbs-port`), sent as one JSON object per message |
| `ws://localhost:30007`           | anything that pushes over WebSocket               |

Front end connects to `ws://<host>:3001` and receives, per SBS message:

```json
{ "hex": "406BDE", "altitude": 33000, "lat": 51.5072, "lon": -0.1276, "onGround": false }
{ "hex": "406BDE", "speed": 450, "track": 275, "verticalRate": -640, "squawk": "7000" }
{ "hex": "406BDE", "callsign": "BAW123" }
```

Fields are only present when the message carried them, so merge by `hex`.
