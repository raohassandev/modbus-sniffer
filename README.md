# Modbus Engineering Analyzer v7

A field-oriented **Modbus RTU / RS485 and Modbus TCP engineering analyzer and reverse-engineering workstation** built with Node.js and a local browser UI.

v7 automatically forms devices from observed Unit/Slave IDs, reconstructs register groups and polling intervals, detects missing replies, analyzes RTT/jitter/exceptions, infers register data types and byte orders, reconstructs the master polling cycle, fingerprints similar devices, detects register relationships and communication anomalies, compares captures, maintains persistent engineering projects, and generates handover reports.

## Safety model

**Passive Modbus RTU capture is receive-only.** The normal analyzer does not transmit production Modbus RTU requests. Use a separate high-impedance / isolated USB-RS485 adapter connected in parallel with the live A/B bus.

The optional **Modbus TCP analyzer is an inline forwarding proxy**, not a passive Ethernet tap. It forwards existing client/server bytes unchanged and analyzes the MBAP request/response traffic.

The separate active device-identification scanner is intentionally guarded. RTU active discovery requires explicit maintenance-mode and exclusive-bus confirmation before it can transmit read-only identification requests.

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

The top-right badge should show **UI v7.0**.

For an existing clone:

```powershell
cd modbus-sniffer
git pull origin main
npm install
npm start
```

## Demo mode

Run the complete analyzer without hardware:

```powershell
npm run demo
```

The simulator produces multi-device Modbus traffic so device formation, registers, polling, timeouts, analysis and the v7 Intelligence workspace can be evaluated before site deployment.

## Automatic device formation

No manual slave configuration is required. Every observed Modbus Unit/Slave ID becomes an independent device under its exact transport/channel identity.

If a master polls ten RTU slaves, the analyzer creates ten device models automatically. Each device tracks:

- requests, responses and function codes
- discovered register groups and current raw values
- polling request groups and intervals
- median/P95 interval and jitter
- missing-response timeouts
- exceptions and unmatched replies
- average/P95 RTT
- online / silent / offline state
- health score

Identical register addresses on different slaves remain isolated.

## v7 Intelligence workspace

### Automatic register intelligence

For discovered register windows, v7 evaluates likely interpretations using multiple observed response samples rather than only one current value:

- `uint16` / `int16`
- `uint32` / `int32` / `float32`
- `uint64` / `int64` / `float64`
- common byte/word orders such as ABCD, BADC, CDAB and DCBA
- ASCII candidates
- likely timestamps
- monotonic and resetting counters
- low-cardinality status / bitfield behavior

Every hypothesis has a confidence score. These are reverse-engineering suggestions, not substitutes for manufacturer documentation.

### Master polling-cycle reconstruction

The ordered Modbus request stream is analyzed per channel to recover the master's repeating communication program:

```text
Channel: RTU Bus 1
Cycle: 2.01 s

1  Slave 1  FC03  0..19
2  Slave 1  FC03  100..119
3  Slave 2  FC04  300..305
4  Slave 3  FC03  44112..44131
...
```

The model reports requests per cycle, devices per cycle, slot confidence, median/P95 cycle duration, jitter and inter-request gaps.

### Device fingerprinting

Devices receive fingerprints derived from:

- function-code usage
- register blocks
- polling request shapes
- passive FC43 Device Identification data when available

Similar devices are scored against one another and v7 can suggest when the same engineering profile is likely reusable.

### Register relationship analysis

The analyzer searches observed values for useful reverse-engineering relationships including:

- duplicate registers
- strong correlations
- monotonic / resetting counters
- totals that approximate the sum of nearby component registers
- multiplicative relationships with a stable scale factor

### Anomaly engine

The live capture is evaluated for:

- device silent/offline transitions
- missing responses
- high polling jitter
- changed polling intervals
- observed write commands
- RTT shifts
- increasing line-noise activity
- newly observed devices

### Session comparison

The Intelligence page can compare two `.mbcap` captures and highlight:

- devices added or removed
- register-map changes
- poll groups added/removed
- polling interval changes
- timeout/exception changes
- response-time changes

## Main workspaces

- **Dashboard** — current bus health and traffic overview
- **Devices** — automatically formed devices with device-specific registers/polls
- **Live Traffic** — decoded request/response/timeout stream and raw HEX
- **Analysis** — timing, exceptions, timeouts and engineering findings
- **Registers** — automatically discovered register explorer
- **Decoder** — 16/32/64-bit interpretations and byte/word order analysis
- **Intelligence** — v7 reverse-engineering engine
- **Sessions** — save/load/replay `.mbcap` captures
- **Projects** — persistent site and bus workspaces
- **Engineering** — names, mappings, scaling, units and reusable profiles
- **History** — persistent communication/health snapshots
- **Discovery** — passive topology and FC43 identity visibility
- **Modbus TCP** — inline MBAP proxy analysis
- **Reports** — diagnostic outputs and engineering handover
- **Settings** — serial selection, reconnect and passive format detection

## Engineering register maps

A discovered register can be assigned persistent engineering metadata:

```text
Device      Slave 3
Function    FC03
Address     44112
Name        Total Active Power
Type        float32
Byte order  CDAB
Scale       0.001
Offset      0
Unit        kW
```

Reusable device profiles can be generated from one mapped device and applied to another matching device.

## Missing-response and polling analysis

Requests without a matching response before the configured timeout become explicit `TIMEOUT` events.

Default RTU request timeout:

```text
1000 ms
```

Override it with:

```powershell
npm start -- --request-timeout 800
```

## Passive serial-format detection

Settings provides Quick Detect and Full Detect. The analyzer tries common baud/parity combinations and scores valid CRC frames versus undecodable bytes. No Modbus request is transmitted during passive serial detection.

## Capture and replay

Save the current session as `.mbcap`, reload it later without hardware, and replay captured traffic through the analysis model.

Engineering exports include CSV, XLSX, PDF and complete project ZIP outputs.

## Modbus TCP analysis

Start the inline TCP analyzer from the UI or CLI:

```powershell
npm start -- --tcp-proxy --tcp-listen-port 1502 --tcp-target-host 192.168.1.50 --tcp-target-port 502
```

Point the existing Modbus TCP client to the analyzer PC on port `1502`; the analyzer forwards traffic to the target on port `502` while preserving transaction and Unit-ID isolation.

## Real RTU example

```powershell
npm start -- --port COM5 --baud 9600 --parity none --data-bits 8 --stop-bits 1
```

Recommended passive topology:

```text
Master / PLC                   Slave bus
    A+ --------------------------- A+
      \---- Sniffer USB-RS485 A+

    B- --------------------------- B-
      \---- Sniffer USB-RS485 B-

   GND --------------------------- GND
      \---- Sniffer reference/GND
```

Use an isolated adapter where practical. Do not add a new 120-ohm termination resistor only for the sniffer.

## Validation

```powershell
npm test
npm run smoke
npm run acceptance
npm run e2e
npm run soak
```

CI runs syntax, unit, smoke and acceptance checks on Windows and Linux across supported Node versions, plus a browser E2E gate.

For a real site with ten expected devices:

```powershell
npm run field-check -- --min-devices 10 --min-frames 500
```

Real production acceptance still requires hardware/site testing because wiring, termination, adapter behavior, noise and device timing cannot be proven by software CI.

## Windows desktop build

```powershell
npm install
npm run desktop:install
npm run desktop:win
```

Installer output is created under `desktop/dist/`.

## Documentation

- `docs/V7_INTELLIGENCE.md` — v7 reverse-engineering layer
- `docs/V6_PLATFORM.md` — persistent platform / TCP / projects foundation
- `docs/SITE_ACCEPTANCE.md` — real-hardware acceptance procedure
