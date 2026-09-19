# Modbus Engineering Tool

A unified field-oriented Modbus application for **sniffing, active polling, simulation, traffic analysis, reverse engineering, protocol testing, troubleshooting and evidence**.

## Product model

The application has three primary modes:

- **Sniffer / Analyzer** — passive observation; never transmits Modbus frames.
- **Master / Client** — active RTU/ASCII/TCP polling, diagnostics and guarded writes.
- **Slave / Server Simulator** — controlled Modbus device simulation.

Advanced tools support those three modes:

- Traffic Analyzer and Protocol Diagnostics
- Register / Data Lab
- Discovery & Scan
- Raw Frame / Conformance Lab
- Device Clone / Capture-to-Simulator
- Test Sequences
- Logger / Trend
- Replay / Compare
- Transport / Modbus TCP Security Lab
- Capture/export/report evidence

This project is intentionally Modbus-only. It is not a generic HMI, SCADA, PLC-programming, process-control, historian or IoT-dashboard product.

## Run

Requirements:

- Node.js 20+
- Windows, Linux or macOS
- USB/serial hardware when working with a physical RTU/ASCII bus

```bash
git clone https://github.com/raohassandev/modbus-sniffer.git
cd modbus-sniffer
npm install
npm start
```

Open:

```text
http://127.0.0.1:8080
```

`npm run sniffer`, `npm run workbench`, `npm run v7` and `npm run v8` are compatibility commands that now resolve to the same unified product runtime.

The desktop application also launches the same unified runtime.

`src/index-v7.js` is the unified runtime entrypoint used by the normal, compatibility and desktop launch paths.

## First-use workflows

### Sniffer

`Settings -> Serial port/format -> Apply & reconnect -> Dashboard / Devices / Traffic / Analysis`

The Sniffer is passive/RX-only. Devices, polling groups and registers are learned from observed traffic.

### Master

`Master -> Connection -> Connect -> Unit ID -> Function -> Address/Quantity -> Read Once -> Poll`

Normal reads use FC01–04. Advanced diagnostics and guarded writes are available without being required for the first read.

### Slave

`Slave -> Transport -> Unit IDs / Memory -> Start Server`

The built-in simulator supports normal RTU/ASCII/TCP operation plus advanced TLS, UDP and RTU/ASCII tunnel variants.

## Safety

- Passive Sniffer never silently becomes an active transmitter.
- One physical serial port cannot be silently shared by Sniffer, Master, Slave, Raw Lab or active Discovery.
- Serial ownership changes require explicit confirmation.
- Master writes are locked by default.
- Guarded writes require explicit confirmation and automatically re-lock.
- Bulk and Unit 0 broadcast writes require stronger confirmation.
- Raw/malformed traffic requires explicit LAB arming.
- Slave fault injection and dynamic generators require explicit LAB confirmation.
- Saved state does not restore armed write/LAB state.
- TLS private keys are not included in exported Slave maps.

## Protocol coverage

See:

- `docs/MODBUS_FUNCTION_MATRIX.md`
- `docs/ACTIVE_TODO.md`
- `docs/PCAP_FEASIBILITY.md`
- `docs/RELEASE_NOTES_8.0.0.md`

Implemented product paths cover FC01–08, FC11/12, FC15–17, FC20–24 and FC43/14 where applicable to Master, Slave, Discovery, Transport Lab and conformance workflows.

## Evidence

Supported evidence includes:

- native `.mbcap` capture/replay
- unified Traffic raw HEX and decoded context
- selected Traffic CSV
- register/value Logger CSV + rotating JSONL
- Raw Lab exact conformance-run JSON
- capture/register-map/test-run comparison

Synthetic PCAP/PCAPNG is intentionally not generated because the current evidence model does not retain original Ethernet/IP/TCP packet headers or a universally interoperable serial PCAP link layer.

## Useful commands

```bash
npm run ports
npm run demo
npm test
npm run lint
npm run version:check
npm --prefix desktop start
npm --prefix desktop run dist:win
```

For an exact-checkout local validation before manual field testing:

```bash
npm ci && npm run version:check && npm run lint && npm run check:v8 && npm audit --omit=dev --audit-level=high && npm test && npm run smoke && npm run acceptance
```

Browser E2E is a separate local gate because Chromium may need to be installed first:

```bash
npx playwright install chromium && npm run e2e
```

GitHub Actions release/build workflows remain manual-only.

## Current completion boundary

The approved **source implementation scope is complete** on the integration branch. Release/merge acceptance remains separate and requires exact-head automated tests, browser QA, representative RTU/TCP/TLS hardware/interoperability checks, Windows packaged smoke and soak evidence.

PR #31 must not be merged merely because GitHub reports it mergeable.
