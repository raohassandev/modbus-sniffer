# Modbus Sniffer

A field-oriented Modbus engineering tool for observing, decoding and reverse-engineering Modbus RTU/RS485 and Modbus TCP traffic.

## Current product status

The **stable Sniffer / Analyzer is the default product again**.

The experimental v8 Workbench remains in this branch for continued Master/Slave development, but it is **not** the normal entry point and PR #31 is not release-eligible yet.

Normal commands:

```bash
npm start
```

or explicitly:

```bash
npm run sniffer
```

Both start the accepted Sniffer / Analyzer runtime:

```text
src/index-v7.js
```

Open:

```text
http://127.0.0.1:8080
```

The experimental Workbench is available only when intentionally requested:

```bash
npm run workbench
```

or:

```bash
npm run v8
```

Experimental v8 browser endpoint:

```text
http://127.0.0.1:8088/v8/
```

## Product model

The project is being corrected around three simple primary tools:

### 1. Sniffer

Passive analysis of an existing Modbus bus or TCP exchange.

Use Sniffer when you want to:

- listen to existing RTU traffic without polling the device
- decode requests and responses
- automatically identify Unit/Slave IDs
- group registers per device
- estimate polling intervals
- measure RTT, timeouts, exceptions and communication quality
- infer common datatypes / byte orders
- compare captures and export engineering evidence

The normal RTU Sniffer is receive-only by design.

### 2. Master

Active Modbus polling, similar to the normal workflow in Modbus Poll / ModScan.

The corrected Master workflow must be:

```text
Connect
  -> Slave / Unit ID
  -> Function
  -> Address
  -> Quantity
  -> Poll Interval
  -> Read Once / Start Polling
  -> Live Values
```

Writes must use the existing guarded write-safety path and must never be silently armed.

The v8 Master backend exists, but its UI/workflow is still being simplified before it can become a normal product entry point.

### 3. Slave

A Modbus slave/server simulator.

The corrected Slave workflow must be:

```text
Choose RTU / ASCII / TCP server
  -> configure port/listener
  -> add Unit ID
  -> edit Coils / Discrete Inputs / Holding Registers / Input Registers
  -> Start Server
  -> observe incoming reads/writes
```

Dynamic generators and fault injection are advanced/LAB functions, not part of the normal first screen.

## Install

Requirements:

- Node.js 20 or newer
- Windows, Linux or macOS
- USB-RS485 adapter for live RTU capture

Install:

```bash
git clone https://github.com/raohassandev/modbus-sniffer.git
cd modbus-sniffer
npm install
```

Run the stable Sniffer:

```bash
npm start
```

## Sniffer serial options

Examples:

```bash
npm start -- --port COM5 --baud 9600 --parity none
```

List serial ports:

```bash
npm run ports
```

Run demo traffic without hardware:

```bash
npm run demo
```

Change web port:

```bash
npm start -- --web-port 8090
```

Use another data directory:

```bash
npm start -- --data-dir data-site-a
```

## Modbus TCP analyzer

The stable TCP analyzer is an inline forwarding proxy. It forwards existing client/server bytes while analyzing MBAP transactions; it does not fabricate polling requests.

Example options include:

```text
--tcp-proxy
--tcp-listen-host 127.0.0.1
--tcp-listen-port 1502
--tcp-target-host 192.168.1.50
--tcp-target-port 502
```

## Desktop

The Windows desktop application now defaults to the stable Sniffer runtime.

Development launch:

```bash
npm --prefix desktop start
```

The experimental v8 desktop mode is explicit only:

```text
MODBUS_DESKTOP_MODE=v8
```

Windows installer build:

```bash
npm --prefix desktop run dist:win
```

## Safety

- Passive Sniffer RTU operation must not transmit production requests.
- Active Master and Discovery operations must remain explicitly separate from passive capture.
- Writes are locked by default.
- Bulk/broadcast writes require stronger confirmation.
- Raw/LAB traffic must remain clearly separated from normal validated requests.
- Persisted configuration must never restore an armed write state.

## Development status

PR #31 is currently an **experimental product-recovery branch**, not a release candidate.

The active recovery checklist is:

```text
docs/ACTIVE_TODO.md
```

The previous v8 planning documents remain useful implementation history, but they no longer override the current product requirement: the application must first make **Sniffer, Master and Slave** obvious and independently usable.

Do not merge PR #31 until that product model is implemented, accepted and retested.
