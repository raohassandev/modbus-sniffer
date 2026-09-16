# Modbus Engineering Workbench v8

An all-in-one Modbus engineering workstation for **RTU, ASCII, TCP, UDP, tunnelling and TLS** workflows. The v8 product combines Master polling/writes, Slave/Server simulation, passive/proxy analysis, discovery, Traffic/Register Lab, Test Center/recipes, Charts/Logger/Historian, Digital Twin workflows, automation and HMI Builder surfaces behind one shared protocol and connection-ownership model.

## Release status

This branch is the **8.0.0 release candidate** carried by PR #31. On this branch:

- `npm start` launches `src/index-v8.js`.
- the package entry point is v8.
- the Windows desktop launcher starts the v8 backend and UI.
- v7 remains available explicitly with `npm run v7` for compatibility.

Do not describe 8.0.0 as merged/released on `main` until PR #31's exact current head passes the full CI matrix and is merged. See `docs/V8_IMPLEMENTATION_STATUS.md` for the audited release boundary.

## Safety model

The active workspaces are deliberately separated from passive and LAB behavior:

- Passive Analyzer/replay does not gain transmit capability implicitly.
- Discovery is read-only and cannot inherit Master write permission.
- Serial resources have one active owner through the central Connection Broker.
- Write permission is per connection, off by default, available only while the connection is live and re-locks on close/reopen/restart.
- Bulk/sensitive writes require stronger confirmation. HMI FC16 writes require explicit bulk confirmation as well as the operator confirmation.
- Unit-0 RTU/ASCII broadcast semantics are limited to supported write functions.
- Raw Test Center traffic is distinct from normal validated Modbus requests.
- Fault injection exists only in the Simulator LAB path and is disabled by default.
- Low-level write/raw/test transmissions retain bounded audit evidence including connection, ownership, timestamp and transmitted HEX.
- Browser cross-site mutations are rejected and mutation/body limits are enforced.
- Persisted/imported projects and connections cannot restore live ownership, armed writes or active fault injection.

## Requirements

- Node.js 20 or newer
- Windows, Linux or macOS
- USB-RS485 adapter for real RTU/ASCII work
- appropriate network access for TCP/UDP/TLS targets

## Install and run

```powershell
git clone https://github.com/raohassandev/modbus-sniffer.git
cd modbus-sniffer
npm install
npm start
```

The default v8 browser endpoint is:

```text
http://127.0.0.1:8088/v8/
```

Use another port when required:

```powershell
npm start -- --port 8090
```

Use a separate data directory:

```powershell
npm start -- --data-dir C:\ModbusWorkbench\data
```

The web server binds to loopback by default. Change `--host` only when you intentionally need another bind address and understand the network exposure.

## v7 compatibility

The accepted legacy analyzer remains available explicitly:

```powershell
npm run v7
```

This is a compatibility path, not the default product on the v8 release-candidate branch.

## Main v8 workspaces

- **Connection Center** — saved connection profiles, ownership/state, serial/network enumeration, diagnostics and safe open/close/test actions.
- **Master** — one-shot requests, persistent cyclic poll jobs, scheduling, result grids, canonical addressing and guarded writes/read-back/audit.
- **Discovery** — FC43-first read-only identification and adaptive FC01-04 scanning with evidence and Master handoff.
- **Simulator** — persistent virtual servers/devices, memory editing, dynamic generators and isolated LAB fault injection.
- **Traffic** — bounded unified runtime timeline with filters, search, bookmarks, raw evidence and error navigation.
- **Register Lab** — datatype/byte-order/engineering interpretation, scale/offset, enums/bitfields/limits and provenance.
- **Test Center** — guarded raw-frame studio and versioned automated recipes with assertions, variables, repeat, pause/resume/stop and evidence.
- **Charts / Logger / Historian** — bounded live series, backend decimation, rotating JSONL logging and optional SQLite historian.
- **Digital Twin** — draft Simulator models from observed/register evidence with an explicit approval boundary before running generated servers.
- **HMI Builder** — persistent screens/templates, edit/preview/run modes, bindings, live reads and guarded operator writes/actions.
- **Projects / Reports** — project clone/Save As, reusable project templates and complete engineering handover bundles.

## Supported protocol/runtime scope

The shared v8 protocol core covers standard handling for:

```text
FC01  Read Coils
FC02  Read Discrete Inputs
FC03  Read Holding Registers
FC04  Read Input Registers
FC05  Write Single Coil
FC06  Write Single Register
FC07  Read Exception Status
FC08  Diagnostics
FC11  Get Comm Event Counter
FC12  Get Comm Event Log
FC15  Write Multiple Coils
FC16  Write Multiple Registers
FC17  Report Server ID
FC20  Read File Record
FC21  Write File Record
FC22  Mask Write Register
FC23  Read/Write Multiple Registers
FC24  Read FIFO Queue
FC43  MEI / Device Identification
```

The common data model includes exact 16/32/64-bit signed/unsigned handling, float32/float64, configurable byte/word permutations, string/ASCII helpers, BCD and timestamp/date interpretations.

Transport families include native serial RTU/ASCII, Modbus TCP client/server, UDP client/server, RTU/ASCII tunnelling over TCP/UDP and TLS client/server options. TLS profiles use explicit certificate/key/trust configuration and do not silently downgrade to insecure TCP.

## Connection and write safety

A connection profile stores configuration only. Opening a connection establishes runtime ownership separately. A saved project cannot restore a previously armed write latch.

Typical Master flow:

1. create/save the connection profile;
2. open it in Master ownership;
3. perform read-only polling;
4. explicitly enable writes for that live connection when required;
5. confirm the individual write, including additional bulk/broadcast confirmation where applicable;
6. inspect read-back/audit evidence;
7. close the connection, which returns it to a safe locked state.

If a serial driver write may have reached the bus but completion cannot be proven, the result is reported as `TRANSMISSION_OUTCOME_UNKNOWN`; the connection enters an error state and writes are re-locked until close/reopen.

## Projects and migration

v8 uses schema version 3 and stores its workbench database separately from legacy v7 workspace data. Migration from supported v7 schema-2 data is explicit and creates a source backup and migration report before writing the v8 destination.

The store uses atomic writes, keeps a last-known-good backup and preserves a corrupt primary file before recovery. Same Unit IDs on different channels remain isolated through channel-scoped identity.

Project clone/Save As and reusable project templates strip runtime/armed state. Project switching is refused while a connection is active.

## Engineering handover export

The v8 handover ZIP contains a manifest with product/version/schema metadata and SHA-256 hashes. Depending on available project/runtime evidence, it can include:

- complete project configuration
- Master summary
- write audit
- bounded Traffic evidence
- device/register CSVs with channel/device identity
- Simulator model
- recipes/Test Center definitions
- Logger/Chart/Historian definitions and tags
- HMI pages
- Digital Twin definitions

CSV text is protected against spreadsheet formula injection and generated filenames are sanitized.

## Automation / CLI / SDK

The v8 automation client defaults to loopback-only API access and requires explicit remote opt-in. Write helpers require explicit confirmation and preserve separate bulk/broadcast confirmations.

Examples:

```powershell
npm run v8:cli -- status --json
npm run v8:cli -- connections --json
npm run v8:cli -- read --connection meter-1 --unit 1 --fc 3 --address 0 --quantity 10 --json
npm run v8:cli -- write --connection meter-1 --unit 1 --fc 6 --address 10 --value 25 --confirm --json
npm run v8:cli -- recipe-run .\recipe.json --connection meter-1 --json
```

JavaScript SDK entry point:

```text
sdk/js/index.js
```

Dependency-free Python example client:

```text
sdk/python/modbus_workbench_client.py
```

## Validation

Run the local validation gates:

```powershell
npm run quality
npm test
npm run smoke
npm run acceptance
npm run e2e
```

CI exercises Windows and Linux across Node 20/22/24, plus quality/dependency audit and Chromium browser E2E. Windows Node 22/24 runs the SQLite historian coverage through the repository's isolation runner rather than skipping it.

The release candidate must not be merged solely because it is mergeable; the exact current head must be green.

## Windows desktop build

```powershell
npm install
npm run desktop:install
npm run desktop:win
```

Installer output is created under `desktop/dist/`. The release-candidate desktop shell launches v8 on a loopback dynamic port and opens `/v8/` after `/api/v8/status` becomes ready.

## Field acceptance

Software CI cannot prove site wiring, termination, transceiver behavior, electromagnetic noise, third-party device timing or real certificate infrastructure. Perform real equipment/site qualification before production deployment.

For the field procedure see:

```text
docs/SITE_ACCEPTANCE.md
```

## Documentation

- `docs/V8_IMPLEMENTATION_STATUS.md` — audited implementation and release-candidate boundary
- `docs/V8_MASTER_TODO.md` — full target-scope roadmap
- `docs/V8_ALL_IN_ONE_MODBUS_WORKBENCH_PLAN.md` — product/architecture plan
- `docs/V8_EXECUTION_ARCHITECTURE.md` — execution/ownership contract
- `docs/V8_PROFESSIONAL_UI_UX_PLAN.md` — UI/UX target
- `docs/V8_WP15_WP16.md` — Digital Twin and automation details
- `docs/SITE_ACCEPTANCE.md` — real-hardware/site acceptance procedure
