# gpswebsocketapi

Connects to the dump, merges what it says per aircraft, and forwards that to every WebSocket listener.

## .env

```
PORT=3001
DUMP_URL=tcp://localhost:30003
CATEGORY_URL=http://localhost:8080/data/aircraft.json
LOG=1
```

Read at startup, so `npm start` alone is enough. Variables set on the command line still win.

`DUMP_URL` accepts:

| URL                              | source                                            |
| -------------------------------- | ------------------------------------------------- |
| `tcp://localhost:30003`          | SBS-1 lines (`--net-sbs-port`), merged per aircraft |
| `http://localhost:8080/data/aircraft.json` | dump1090-fa web server, polled every 1 s |
| `ws://localhost:30007`           | anything that pushes over WebSocket               |

`CATEGORY_URL` is optional. SBS doesn't carry the emitter category, so it is polled from
`aircraft.json` every 2 s and merged in. Defaults to the dump's host on port 8080.

Front end connects to `ws://<host>:3001`. On connect it is sent one message per known
aircraft, then a fresh one every time that aircraft is updated:

```json
{
  "hex": "406BDE",
  "callsign": "BAW123",
  "altitude": 33000,
  "lat": 51.5072,
  "lon": -0.1276,
  "speed": 450,
  "track": 275,
  "verticalRate": -640,
  "squawk": "7000",
  "onGround": false,
  "category": "A3",
  "lastSeen": 1794224652622
}
```

Every message is the whole aircraft, so `planes.set(m.hex, m)` is enough — no merging on
the client. Fields appear as the aircraft reports them. Aircraft quiet for 30 s are dropped
from the relay's map; the client can drop them on `lastSeen` age.

Only aircraft with `lat` and `lon` are sent — anything else cannot be drawn. An aircraft
heard before its first position fix is merged silently and appears the moment it resolves
(usually within 2 s).
