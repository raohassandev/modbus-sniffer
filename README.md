# Modbus RTU Passive Sniffer — Node.js Console Project

A Windows/Linux Node.js project for passively listening to a live RS485 Modbus RTU bus using a **separate USB-to-RS485 adapter**. It never transmits bytes.

## What it does

- Lists serial/COM ports.
- Interactive COM-port selection if `--port` is omitted.
- Opens the selected serial port with configurable baud/parity/data/stop bits.
- Retries after unplug/replug, open failure, or temporary busy state.
- Splits Modbus RTU frames using protocol lengths + CRC16 and an inter-frame gap timer.
- Validates Modbus CRC.
- Decodes FC01, FC02, FC03, FC04, FC05, FC06, FC15 and FC16.
- Decodes Modbus exception responses.
- Infers request/response direction from frame structure and pending transactions.
- Pairs responses to requests and calculates response time (RTT).
- Maps FC03/FC04 response words back to the exact requested register addresses.
- Optional meter/register map with scale, data type and 32-bit byte order.
- Optional CSV transaction logging.
- Reports undecodable/noise bytes to help identify wrong baud/parity/wiring.

## Important hardware limitation

On Windows a COM port is normally exclusive. If another application already opened **the same USB adapter**, Node.js cannot also open it.

For true passive sniffing use a **second USB-RS485 adapter** connected in parallel to the existing RS485 A/B bus:

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

The Node.js application never calls `port.write()`.

Do **not** add another 120-ohm termination resistor just for the sniffer. Prefer an isolated RS485 adapter at industrial sites.

## Install

Install Node.js 20+.

```bash
npm install
```

## List COM ports

```bash
npm run ports
```

Example:

```text
Available serial ports:
  [1] COM2
  [2] COM5  -  FTDI | PID:6001 | VID:0403
```

## Start sniffing

```bash
npm start -- --port COM5 --baud 9600 --parity none
```

For 19200 8E1:

```bash
npm start -- --port COM5 --baud 19200 --parity even --data-bits 8 --stop-bits 1
```

If you omit `--port`, the program lists ports and asks you to select one.

## Example console output

```text
[11:10:22.104] REQ | S=1 | FC=03 | Read Holding Registers | addr=32335 | qty=2
  RAW: 01 03 7E 4F 00 02 ...

[11:10:22.159] RSP | S=1 | FC=03 | Read Holding Registers | RTT=55ms | addr=32335 | 32335=17194(0x432A) 32336=0(0x0000)
  RAW: 01 03 04 43 2A 00 00 ...
```

## Optional meter decoding

Use the example map:

```text
config/register-map.example.json
```

Then run:

```bash
npm start -- --port COM5 --baud 9600 --map config/register-map.example.json
```

Example map item:

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

Supported types: `uint16`, `int16`, `uint32`, `int32`, `float32`, `uint64`, `int64`.

Supported 32-bit byte orders: `ABCD`, `BADC`, `CDAB`, `DCBA`.

The `address` must be the **raw start address actually present in the Modbus request packet**. If a manual uses `40001` notation, verify whether the master actually sends address `0`, `1`, `40001`, etc.

## CSV logging

```bash
npm start -- --port COM5 --baud 9600 --csv logs/site-capture.csv
```

## Wrong serial settings

If the console repeatedly reports undecodable/noise bytes, check baud rate, parity, data bits, stop bits, A/B polarity, common reference/GND, adapter driver, and whether you are connected to the correct RS485 pair.

## Tests

The protocol tests do not need real hardware:

```bash
npm test
```

## Next phase

The console core is intentionally separated from the UI. A later phase can add a web dashboard (Express/WebSocket + React) without changing the serial capture and Modbus decoding engine.
