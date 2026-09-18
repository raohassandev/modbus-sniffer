# Modbus Engineering Tool

A field-oriented advanced Modbus engineering application for **testing, simulation, sniffing, traffic analysis, reverse engineering, protocol research, troubleshooting and evidence**.

## Product boundary

This project is intentionally Modbus-only.

It is **not** a generic HMI, SCADA, PLC-programming, plant-automation, historian or IoT-dashboard product.

The canonical scope audit is:

`docs/MODBUS_ONLY_PRODUCT_AUDIT.md`

## Current product status

The stable **Sniffer / Analyzer** remains the default product while Master and Slave are being integrated into the same accepted experience.

```bash
npm start
```

or:

```bash
npm run sniffer
```

Open:

```text
http://127.0.0.1:8080
```

The experimental v8 workspace is still available explicitly:

```bash
npm run workbench
```

```text
http://127.0.0.1:8088/v8/
```

PR #31 remains experimental and is not release-eligible.

## Product model

### Sniffer / Analyzer

Passive Modbus observation and reverse engineering:

- RTU/RS485 capture
- TCP/proxy analysis
- request/response decoding
- Unit/Slave discovery from observed traffic
- polling interval, RTT, timeout, exception and quality analysis
- register inference and datatype research
- capture/replay/export

### Master / Client

Active Modbus testing:

- RTU / ASCII / TCP
- multiple polling Monitor Sessions
- FC01–04 reads
- guarded writes
- advanced function-code tests
- full register datatype/byte-order interpretation
- discovery, Traffic, Logger and Test Center integration

### Slave / Server Simulator

Controlled Modbus device simulation:

- RTU / ASCII / TCP
- multiple Unit IDs
- coils, discrete inputs, holding registers and input registers
- request/write visibility
- device identity and exception behavior
- dynamic values and controlled LAB fault/timing behavior
- Capture-to-Simulator Device Clone

## Advanced Modbus tools

The product roadmap includes only Modbus-related advanced tools:

- Traffic Analyzer
- Register/Data Lab
- Discovery & Scan
- Diagnostics & Conformance
- Test Center / Raw Frame Studio
- Device Clone / Capture-to-Simulator
- Scripted Test Sequences / API
- Replay / Compare
- Logger / Trend
- Reports / Export
- Transport Lab including UDP/tunnels and Modbus TCP Security/TLS where supported

A free-form HMI Builder is out of scope and will be removed from the Modbus product.

## Install

Requirements:

- Node.js 20+
- Windows, Linux or macOS
- USB-RS485 adapter for live serial work when required

```bash
git clone https://github.com/raohassandev/modbus-sniffer.git
cd modbus-sniffer
npm install
npm start
```

## Useful commands

```bash
npm run ports
npm run demo
npm test
npm run workbench
npm --prefix desktop start
npm --prefix desktop run dist:win
```

## Safety

- Passive Sniffer must not silently transmit.
- Master/Discovery/Test Center active transmissions are explicit.
- Writes are locked by default.
- Bulk/broadcast writes require stronger confirmation.
- Raw/LAB traffic is clearly separated from validated normal requests.
- Saved state never restores armed writes or LAB mode.
- One physical serial resource cannot be silently owned by passive and active runtimes at the same time.

## Active work

Canonical active checklist:

`docs/ACTIVE_TODO.md`

Master implementation checklist:

`docs/MODBUS_MASTER_TODO.md`

Do not merge PR #31 until the Modbus-only product scope, Sniffer/Master/Slave workflows and applicable exact-head validation are accepted.
