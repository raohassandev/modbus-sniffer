# Modbus RTU Passive Sniffer — Node.js Console Project

A Windows/Linux Node.js project for passively listening to a live RS485 Modbus RTU bus using a **separate USB-to-RS485 adapter**. It never transmits bytes.

## What it does

- Lists serial/COM ports.
- Interactive COM-port selection if `--port` is omitted.
- Opens the selected serial port with configurable baud/parity/data/stop bits.
- Retries after unplug/replug, open failure, or temporary busy state.
- Remembers the USB adapter identity and can follow it if Windows changes its COM number after reconnect.
- Splits Modbus RTU frames using protocol lengths + CRC16 and an inter-frame gap timer.
- Validates Modbus CRC.
- Decodes common standard functions including FC01/02/03/04/05/06/07/08/11/12/15/16/17/22/23; unknown/vendor frames are still captured when CRC-valid.
- Decodes Modbus exception responses.
- Infers request/response direction from frame structure and pending transactions.
- Pairs responses to requests and calculates response time (RTT).
- Maps FC03/FC04/FC23 response words back to the exact requested register addresses.
- Optional meter/register map with scaling, signed/unsigned/float/64-bit data types, and byte/word order.
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

The application never calls `port.write()`.

Do **not** add another 120-ohm termination resistor just for the sniffer. Prefer an isolated RS485 adapter at industrial sites.

## Install

Install Node.js 20+ and run:

```bash
npm install
```

## List COM ports

```bash
npm run ports
```

## Start sniffing

```bash
npm start -- --port COM5 --baud 9600 --parity none
```

For 19200 8E1:

```bash
npm start -- --port COM5 --baud 19200 --parity even --data-bits 8 --stop-bits 1
```

If `--port` is omitted, the program lists the available ports and asks you to select one.

## Console output

```text
[11:10:22.104] | REQ | S=1 | FC=03 | Read Holding Registers | addr=32335 | qty=2
  RAW: 01 03 7E 4F 00 02 ...

[11:10:22.159] | RSP | S=1 | FC=03 | Read Holding Registers | RTT=55ms | addr=32335 | 32335=17194(0x432A) 32336=0(0x0000)
  RAW: 01 03 04 43 2A 00 00 ...
```

## Optional meter decoding

Use `config/register-map.example.json`, then run:

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

32-bit byte orders: `ABCD`, `BADC`, `CDAB`, `DCBA`.

64-bit byte orders: `ABCDEFGH`, `BADCFEHG`, `GHEFCDAB`, `HGFEDCBA`.

The `address` must be the **raw PDU register address actually seen on the wire**. If a manual uses `40001` notation, check the actual Modbus request before adding the map.

## Automatic COM-port recovery

When available, the sniffer remembers the adapter serial number / VID / PID. If the adapter is unplugged and Windows later assigns it another COM number, the sniffer automatically rebinds when it can identify the adapter unambiguously. Disable this behavior with `--no-rebind`.

## CSV logging

```bash
npm start -- --port COM5 --baud 9600 --csv logs/site-capture.csv
```

## Troubleshooting

If noise bytes keep increasing, check baud rate, parity, data bits, stop bits, A/B polarity, common reference/GND, adapter driver, and the selected RS485 pair.

If Windows reports access denied/busy, another program probably owns the same COM port. Close Modbus Poll, ModScan, PuTTY, Arduino Serial Monitor, vendor commissioning tools, etc., or use a second adapter as a passive tap.

## Tests

```bash
npm test
```

The protocol tests do not need hardware.
