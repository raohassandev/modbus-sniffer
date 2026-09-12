# Modbus Sniffer v4

A passive **Modbus RTU / RS485 engineering analyzer** written in Node.js. It listens to an existing bus through a separate USB-RS485 receive tap, validates CRC, pairs requests with responses, automatically forms slave devices, learns polling cycles and register groups, detects missing replies, analyzes timing, decodes register data types, and supports offline capture/replay.

> The application is receive-only. It does not transmit Modbus frames. For true passive monitoring, connect a separate USB-RS485 adapter in parallel with the existing A/B bus.

## v4 highlights

### Automatic slave-device formation

No device configuration is required. Every observed Modbus Slave ID becomes a device automatically.

If a master polls Slave IDs 1 through 10, the application creates ten device models independently. Each device keeps its own:

- request and response counts
- function codes
- missing-response timeouts
- exceptions and unmatched responses
- average and P95 RTT
- automatically learned polling groups
- median/P95 request interval and jitter
- contiguous register groups
- latest register values and HEX
- min/max/change/read/write counters
- learned register poll interval
- online/silent/offline state and health score

A request such as:

```text
Slave 4 · FC03 · address 44112 · quantity 6
```

becomes a polling group owned by Slave 4. Repeated requests automatically build its request interval statistics. The matching response populates Slave 4 registers `44112..44117`; those values are never mixed with another slave that uses the same address.

### Missing-response analyzer

Requests that do not receive a matching response before the configured timeout become explicit `TIMEOUT` events. Timeouts are counted at bus, slave and polling-group level.

Default:

```text
1000 ms
```

Configure from **Settings** or the CLI:

```bash
npm start -- --request-timeout 800
```

### Polling-cycle analyzer

For every unique request group the analyzer learns:

```text
Slave ID
Function code
Read / write operation
Start address
Quantity
Request count
Response count
Timeout count
Exception count
Median request interval
P95 request interval
Min / max interval
Jitter ms / jitter %
Average RTT / P95 RTT
Latest values
```

This makes it possible to see exactly what a PLC/HMI is polling, how often, and which slave or register block is slow or unreliable.

### Register data-type analyzer

Select captured words and inspect them as:

```text
uint16 / int16
uint32 / int32 / float32
uint64 / int64 / float64
```

Common 32-bit orders:

```text
ABCD
BADC
CDAB
DCBA
```

Common 64-bit orders include:

```text
ABCDEFGH
BADCFEHG
CDABGHEF
EFGHABCD
GHEFCDAB
HGFEDCBA
```

The UI also shows common scale interpretations such as `x0.1`, `x0.01`, and `x0.001`.

### Passive serial-format detection

From **Settings**, select a COM port and run Quick Detect or Full Detect. The sniffer tests baud/parity candidates without transmitting any Modbus request and scores them using valid CRC frames versus undecodable bytes.

Quick detection checks common combinations around:

```text
9600 / 19200 / 38400 / 115200
8N1 / 8E1
```

Full detection expands to lower baud rates and odd parity.

### Capture sessions and replay

Save the complete analysis session as a `.mbcap` file. It preserves captured transactions so the device, polling and register models can be rebuilt later without hardware.

The **Sessions** page can:

- save a capture
- load a capture for offline analysis
- replay it at 0.5x, 1x, 2x, 5x or 10x
- export packets, devices, polling groups and registers as CSV

## Browser pages

Running the application starts the local UI at:

```text
http://127.0.0.1:8080
```

Pages:

- **Dashboard** — bus health, devices, poll groups, registers, timeouts, RTT, exceptions and activity.
- **Devices** — automatically formed Slave-ID devices with per-device poll groups, register groups, values, timing and issues.
- **Live Traffic** — REQ/RSP/TIMEOUT stream, filters, raw HEX and packet inspector.
- **Analysis** — timeout rate, polling cadence, jitter, latency, device health and findings.
- **Registers** — all automatically discovered registers grouped by Slave ID and function.
- **Decoder** — 16/32/64-bit data-type and byte/word-order analysis.
- **Sessions** — `.mbcap` save/load/replay and exports.
- **Settings** — clickable COM ports, serial parameters, request timeout and passive format detection.

## Hardware connection

```text
PLC / Master                 Inverter / Meter / Logger
    A+ ------------------------------ A+
     |
     +------ Sniffer USB-RS485 A+

    B- ------------------------------ B-
     |
     +------ Sniffer USB-RS485 B-

   GND ------------------------------ GND
     |
     +------ Sniffer GND (recommended)
```

Do not add another 120-ohm termination resistor only for the sniffer. An isolated industrial USB-RS485 interface is preferred.

## Requirements

- Node.js 20 or newer
- Windows, Linux or macOS
- USB-RS485 adapter for real RTU capture

## Install and run

```bash
git clone https://github.com/raohassandev/modbus-sniffer.git
cd modbus-sniffer
npm install
npm start
```

Then open:

```text
http://127.0.0.1:8080
```

Run on a known port directly:

```bash
npm start -- --port COM5 --baud 9600 --parity none --request-timeout 1000
```

Example 19200 8E1:

```bash
npm start -- --port COM5 --baud 19200 --parity even --data-bits 8 --stop-bits 1
```

List serial ports:

```bash
npm run ports
```

## Demo mode

No hardware is required:

```bash
npm run demo
```

The v4 demo simulates a master polling **10 separate slave devices**, multiple register groups per slave, changing values, writes, exceptions, occasional missing replies and line noise. This is useful for verifying the automatic device/grouping behavior before going to site.

## Supported Modbus functions

Explicit decoding includes:

```text
FC01 Read Coils
FC02 Read Discrete Inputs
FC03 Read Holding Registers
FC04 Read Input Registers
FC05 Write Single Coil
FC06 Write Single Register
FC07 Read Exception Status
FC08 Diagnostics
FC11 Get Comm Event Counter
FC12 Get Comm Event Log
FC15 Write Multiple Coils
FC16 Write Multiple Registers
FC17 Report Server ID
FC22 Mask Write Register
FC23 Read/Write Multiple Registers
```

CRC-valid vendor/unknown function frames are still captured for inspection.

## API

Main endpoints:

```text
GET  /api/status
GET  /api/analysis
GET  /api/devices
GET  /api/devices/:slave
GET  /api/polls
GET  /api/transactions
GET  /api/registers
GET  /api/decode
GET  /api/ports
GET  /api/config
POST /api/serial/configure
POST /api/serial/disconnect
POST /api/serial/autodetect
POST /api/capture/clear
GET  /api/capture/export.mbcap
POST /api/capture/import
POST /api/replay/start
POST /api/replay/stop
GET  /api/export/devices.csv
GET  /api/export/polls.csv
GET  /api/export/registers.csv
GET  /api/export/transactions.csv
WS   /ws
```

## Safety / passive behavior

The application does not call serial `write()` for normal capture or serial-format detection. It only changes the local USB serial receiver configuration while testing baud/parity candidates.

Windows normally gives a COM port exclusive ownership. To inspect an independent PLC-to-device RS485 bus, use a second USB-RS485 adapter connected in parallel rather than trying to open a COM port already used by another application.

## Tests

```bash
npm test
```

The automated suite includes CRC/frame/parser behavior plus v4 tests for automatic multi-slave device formation, register ownership, polling intervals, missing-response assignment, data-type decoding and capture rebuild. GitHub Actions tests Node 20 and 22 on both Windows and Linux.
