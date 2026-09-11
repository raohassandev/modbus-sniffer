# Modbus Sniffer

A passive **Modbus RTU / RS485 protocol workstation** written in Node.js. It captures a live bus through a separate USB-RS485 receive tap, validates CRC, pairs requests with responses, decodes Modbus functions, reconstructs register addresses, measures response time, discovers register maps automatically, and exposes the result in both the console and a live browser interface.

> The application does not transmit Modbus frames. For true passive monitoring, connect a separate USB-RS485 adapter in parallel with the existing A/B bus. Windows normally does not allow two applications to open the same COM port.

## v2 browser workstation

Running the sniffer now starts a local HTML interface at **http://127.0.0.1:8080** by default.

Pages:

- **Dashboard** — connection state, frame rate, slave count, RTT, exceptions, noise, bus-health score and live activity chart.
- **Live Traffic** — request/response stream, filters, pause/resume, raw HEX, RTT and a detailed packet inspector.
- **Analysis** — capture health, P50/P95/P99 latency, function-code distribution, per-slave statistics, automatic observations and discovered address ranges.
- **Registers** — automatic register discovery with slave, FC, raw PDU address, current value, HEX, min/max, read/write counts and change count.
- **Settings** — list active serial ports and change COM port, baud, parity, data bits and stop bits without restarting Node.js.

Both transaction and discovered-register tables can be exported as CSV.

## Hardware connection

```text
PLC / Master                Inverter / Meter / Logger
    A+ ----------------------------- A+
     |\
     +------ Sniffer USB-RS485 A+

    B- ----------------------------- B-
     |\
     +------ Sniffer USB-RS485 B-

   GND ----------------------------- GND
     |\
     +------ Sniffer GND (recommended)
```

Do not add another 120-ohm termination resistor only for the sniffer. An isolated industrial USB-RS485 interface is preferred.

## Requirements

- Node.js 20 or newer
- Windows, Linux or macOS
- USB-RS485 adapter for real RTU capture

## Install

```bash
npm install
```

## See available ports

```bash
npm run ports
```

## Run with real hardware

```bash
npm start -- --port COM5 --baud 9600 --parity none
```

Example 19200 8E1:

```bash
npm start -- --port COM5 --baud 19200 --parity even --data-bits 8 --stop-bits 1
```

You may also run only:

```bash
npm start
```

If exactly one serial port exists, it is selected automatically. If multiple ports exist, the web UI starts and you can select the capture interface from **Settings**. With `--no-web`, the original interactive console port picker is used.

## Demo mode — no hardware required

To evaluate the complete UI before going to site:

```bash
npm run demo
```

Then open:

```text
http://127.0.0.1:8080
```

Demo mode generates synthetic FC03/FC04 reads, FC06 writes, occasional exceptions and a small amount of simulated noise so the analysis views have realistic data.

## Console output stays active

The HTML workstation does not replace the console. Packets continue to be decoded and printed in real time:

```text
[11:10:22.104] | REQ | S=1 | FC=03 | Read Holding Registers | addr=32335 | qty=2
  RAW: 01 03 7E 4F 00 02 ...

[11:10:22.159] | RSP | S=1 | FC=03 | Read Holding Registers | RTT=55ms | addr=32335
  32335=17194(0x432A) 32336=0(0x0000)
```

## Supported Modbus RTU functions

The decoder has explicit handling for common standard functions including:

- FC01 Read Coils
- FC02 Read Discrete Inputs
- FC03 Read Holding Registers
- FC04 Read Input Registers
- FC05 Write Single Coil
- FC06 Write Single Register
- FC07 Read Exception Status
- FC08 Diagnostics
- FC11 Get Comm Event Counter
- FC12 Get Comm Event Log
- FC15 Write Multiple Coils
- FC16 Write Multiple Registers
- FC17 Report Server ID
- FC22 Mask Write Register
- FC23 Read/Write Multiple Registers

CRC-valid vendor/unknown function frames are still captured for inspection.

## Automatic request/response analysis

The sniffer remembers requests and uses them to interpret responses. For a read request such as:

```text
Slave 1 · FC03 · address 32335 · quantity 2
```

and its response, the analyzer reconstructs:

```text
32335 = 17194 (0x432A)
32336 = 0     (0x0000)
RTT   = 55 ms
```

This also feeds the automatic register explorer and per-slave latency analysis.

## Optional engineering register map

`config/register-map.example.json` can assign engineering meaning to known addresses:

```json
{
  "slaveId": 1,
  "function": 3,
  "name": "Total Active Power",
  "address": 32335,
  "type": "int32",
  "byteOrder": "ABCD",
  "scale": 0.001,
  "unit": "kW"
}
```

Supported types include `uint16`, `int16`, `uint32`, `int32`, `float32`, `uint64`, and `int64`.

32-bit byte orders: `ABCD`, `BADC`, `CDAB`, `DCBA`.

64-bit byte orders: `ABCDEFGH`, `BADCFEHG`, `GHEFCDAB`, `HGFEDCBA`.

Addresses are the **raw Modbus PDU addresses actually seen on the wire**, not automatically converted `4xxxx` notation.

## CSV logging

Persistent console capture logging:

```bash
npm start -- --port COM5 --baud 9600 --csv logs/site-capture.csv
```

The web UI also provides live exports:

- `/api/export/transactions.csv`
- `/api/export/registers.csv`

## Automatic COM recovery

When available, the sniffer remembers USB serial number / VID / PID. If an adapter is unplugged and Windows assigns the same device a different COM number, it can rebind automatically.

Disable this with:

```bash
npm start -- --port COM5 --no-rebind
```

## Web options

```text
--web-host 127.0.0.1    Bind locally (default)
--web-port 8080         Browser UI port
--no-web                Console only
--history 5000          In-memory transaction history
```

To view the UI from another machine on a trusted engineering LAN:

```bash
npm start -- --port COM5 --web-host 0.0.0.0
```

There is currently no authentication layer, so keep the default `127.0.0.1` binding unless LAN access is specifically required.

## HTTP / WebSocket API

Useful endpoints:

```text
GET  /api/status
GET  /api/analysis
GET  /api/transactions
GET  /api/registers
GET  /api/ports
GET  /api/config
POST /api/serial/configure
POST /api/capture/clear
GET  /api/export/transactions.csv
GET  /api/export/registers.csv
WS   /ws
```

This makes the capture core reusable later by a React/Electron desktop application or a larger monitoring platform.

## Troubleshooting

If noise bytes increase continuously, verify baud rate, parity, data bits, stop bits, A/B polarity, common reference/GND, correct RS485 pair and USB driver.

If Windows reports the port as busy/access denied, close Modbus Poll, ModScan, PuTTY, Arduino Serial Monitor, commissioning software, or any other program using that same COM interface.

## Tests

```bash
npm test
```

The test suite covers protocol/core behavior and the v2 runtime analysis state without requiring actual RS485 hardware.
