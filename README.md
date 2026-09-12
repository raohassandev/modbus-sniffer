# Modbus Engineering Analyzer v6

A field-oriented **Modbus RTU / RS485 and Modbus TCP engineering analyzer** built with Node.js and a local browser UI. It automatically forms devices from observed Slave IDs, reconstructs register groups, learns polling intervals, detects missing replies, analyzes RTT/jitter/exceptions, decodes register data types, saves capture sessions, maintains persistent site projects and engineering maps, records history, generates diagnostic reports, and includes Windows desktop packaging.

## Safety model

**Modbus RTU capture is receive-only.** The application does not transmit Modbus RTU requests. For passive RTU monitoring, use a separate USB-RS485 adapter connected in parallel with the existing A/B bus.

The optional **Modbus TCP analyzer is an inline forwarding proxy**, not a passive Ethernet tap. It forwards bytes sent by the connected Modbus TCP client to the configured target and analyzes the MBAP request/response traffic. It does not fabricate polling requests.

## Requirements

- Node.js 20 or newer
- Windows, Linux, or macOS
- USB-RS485 adapter for live RTU capture

## Install and run

```powershell
git clone https://github.com/raohassandev/modbus-sniffer.git
cd modbus-sniffer
npm install
npm start
```

Open:

```text
http://127.0.0.1:8080
```

The top-right UI badge should show **UI v6.0**.

If the repository is already cloned:

```powershell
cd modbus-sniffer
git pull origin main
npm install
npm start
```

## Demo mode

Run the full analyzer without hardware:

```powershell
npm run demo
```

The simulator generates multi-slave traffic so automatic devices, polling groups, registers, timing, exceptions, writes, timeouts, and analysis views can be evaluated before going to site.

## Automatic device formation

No manual slave configuration is required. Every observed Modbus Slave ID automatically becomes a device.

If a master polls ten slaves, the analyzer creates ten independent device models. Each device tracks its own:

- read/write requests and responses
- function codes
- register groups and latest values
- polling groups and request intervals
- median/P95 interval and jitter
- missing-response timeouts
- exceptions and unmatched replies
- average/P95 RTT
- online/silent/offline status
- health score

Identical register addresses on different slaves remain isolated by Slave ID and function code.

## Main UI workspaces

The browser application contains:

- **Dashboard** — traffic, health, devices, registers, RTT, timeouts, exceptions and bus activity.
- **Devices** — automatically formed Slave-ID devices with polling groups, register ranges, values and device-specific findings.
- **Live Traffic** — request/response/timeout stream, filters, raw HEX and packet inspector.
- **Analysis** — polling cadence, jitter, slow replies, timeout behavior and engineering findings.
- **Registers** — automatically discovered register explorer.
- **Decoder** — 16/32/64-bit integer/float interpretations and common byte/word orders.
- **Sessions** — save/load/replay `.mbcap` captures.
- **Projects** — persistent site/bus workspaces.
- **Engineering** — device naming, register maps, scaling, units and reusable device profiles.
- **History** — persistent project health/communication snapshots.
- **Modbus TCP** — inline MBAP proxy configuration and status.
- **Reports** — deeper diagnostics, engineering exports and printable diagnostic report.
- **Settings** — serial port selection, live reconnect and passive serial-format detection.

## Persistent projects

Project information is stored locally under the `data/` directory by default. A project can contain:

```text
Project: Factory A
Site: Lahore Plant
Bus: Solar RS485-1

Slave 1  Huawei Logger
Slave 2  Energy Meter
Slave 3  Inverter-01
...
```

Device identity fields include name, manufacturer, model and notes.

Use another storage location with:

```powershell
npm start -- --data-dir D:\ModbusProjects
```

`data/` is git-ignored.

## Engineering register maps

A discovered register can be assigned engineering metadata directly from the UI:

```text
Slave       3
Function    FC03
Address     44112
Name        Total Active Power
Type        float32
Byte order  CDAB
Scale       0.001
Offset      0
Unit        kW
```

Supported mapped types include:

```text
uint16  int16
uint32  int32  float32
uint64  int64  float64
ascii   bits
```

Mappings are persistent and live values are calculated from the current captured register words.

Reusable **device profiles** can be created from one mapped slave and applied to other devices using the same register map.

## Persistent history

While the analyzer is running, the active project receives periodic history snapshots containing bus totals, rates, health and per-device summaries. History is stored as local JSONL data with file rotation and can be reviewed from the History page.

## Missing-response and polling analysis

Requests without a matching response before the configured timeout become explicit `TIMEOUT` events.

Default RTU timeout:

```text
1000 ms
```

Override from Settings or CLI:

```powershell
npm start -- --request-timeout 800
```

For each unique polling request group the analyzer learns request count, response count, timeout count, exception count, median/P95 interval, min/max interval, jitter, average/P95 RTT and latest values.

## Passive serial-format detection

Settings provides Quick Detect and Full Detect. The analyzer tries common baud/parity combinations and scores them from valid CRC frames versus undecodable bytes. It does not send Modbus requests during detection.

## Capture and replay

Save the current session as `.mbcap`, reload it later without hardware, and replay the traffic through the analysis model.

CSV exports are available for:

- transactions
- devices
- polling groups
- discovered registers
- engineering mappings

## Deep diagnostics and report

The Reports workspace analyzes conditions such as:

- missing responses
- unmatched responses
- high polling jitter
- write traffic observed on the monitored bus
- possible duplicate Slave-ID / capture asymmetry behavior
- estimated RTU utilization

The printable HTML report includes project information, health, diagnostic findings, device statistics, polling groups and engineering mappings. Use the browser Print / Save PDF function when a PDF report is required.

## Modbus TCP analysis

The v6 TCP engine parses fragmented MBAP streams and pairs requests/responses using transaction ID + Unit ID.

Start the inline proxy from the UI or CLI:

```powershell
npm start -- --tcp-proxy --tcp-listen-port 1502 --tcp-target-host 192.168.1.50 --tcp-target-port 502
```

Then point the existing Modbus TCP client at:

```text
Analyzer PC :1502
```

The analyzer forwards that connection to:

```text
192.168.1.50 :502
```

and records MBAP traffic and RTT while forwarding bytes unchanged.

## Real RTU hardware example

```powershell
npm start -- --port COM5 --baud 9600 --parity none --data-bits 8 --stop-bits 1
```

Or simply run:

```powershell
npm start
```

and select the port from Settings.

Recommended passive wiring:

```text
Master / PLC                   Slave bus
    A+ --------------------------- A+
      \---- Sniffer USB-RS485 A+

    B- --------------------------- B-
      \---- Sniffer USB-RS485 B-

   GND --------------------------- GND
      \---- Sniffer GND
```

Use an isolated adapter where practical. Do not add a new 120-ohm termination resistor only for the sniffer.

## Validation commands

Run the complete software checks:

```powershell
npm test
npm run smoke
npm run acceptance
npm run soak
```

`npm run smoke` launches the v6 demo server and validates the HTTP/UI bootstrap, persistent project APIs, engineering mapping, diagnostics, TCP subsystem and report generation.

For a real site capture, for example ten expected slave devices:

```powershell
npm run field-check -- --min-devices 10 --min-frames 500
```

See `docs/SITE_ACCEPTANCE.md` for the full hardware acceptance procedure.

## Windows desktop application

The repository includes an Electron/NSIS desktop packaging project.

Build locally on Windows:

```powershell
npm install
npm run desktop:install
npm run desktop:win
```

Installer output is created under:

```text
desktop/dist/
```

A manual GitHub Actions workflow named **Build Windows desktop installer** is also included and uploads the generated installer as an artifact.

## Useful API endpoints

```text
GET  /api/status
GET  /api/analysis
GET  /api/transactions
GET  /api/devices
GET  /api/devices/:slave
GET  /api/registers
GET  /api/polls
GET  /api/engineering
GET  /api/diagnostics/deep
GET  /api/history
GET  /api/workspaces
GET  /api/project
GET  /api/profiles
GET  /api/tcp/status
GET  /api/report.html

POST /api/serial/autodetect
POST /api/serial/configure
POST /api/capture/import
POST /api/replay/start
POST /api/tcp/start
POST /api/tcp/stop
```

The UI binds to `127.0.0.1` by default. There is no authentication layer, so keep the local-only binding unless access from a trusted engineering LAN is intentionally required.

## Current release status

**v6.0 software roadmap implemented.** Automated syntax, unit, end-to-end smoke and acceptance checks run on Windows and Linux with Node 20 and Node 22.

Production acceptance for a specific RS485 installation still requires the real-hardware procedure in `docs/SITE_ACCEPTANCE.md`, because physical wiring, adapter behavior, noise, actual device timing and site-specific traffic cannot be validated from software CI alone.

Additional implementation details are documented in `docs/V6_PLATFORM.md`.
