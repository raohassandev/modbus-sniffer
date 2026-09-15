# v8 All-in-One Modbus Workbench — Competitive Analysis and Implementation Plan

**Status:** implementation roadmap  
**Baseline:** v7 analyzer/reverse-engineering platform  
**Goal:** evolve the project into a single professional Modbus workstation that combines and exceeds the practical workflows of Modbus Poll, Modbus Slave, ModScan/ModSim, protocol analyzers/sniffers, test centers and engineering/reverse-engineering tools.

## 1. Research baseline

### Modbus Poll / Modbus Slave

Current Witte Software documentation was reviewed in detail. Modbus Poll provides a multi-window Modbus master, RTU/ASCII/TCP, Modbus/TCP Security, UDP, RTU/ASCII over TCP and UDP, read/write polling, address/slave scanning, raw test strings, traffic view, logging, charting, per-cell data formats, word/byte ordering, scaling, conditional colors, value-name mapping, workspace persistence and Automation access. Modbus Slave provides the complementary multi-device server/slave simulator with similar display/engineering tools.

Important reference capabilities to match or exceed:

- Multiple simultaneous poll windows/jobs.
- RTU and ASCII serial operation.
- Modbus TCP/IP and Modbus/TCP Security.
- Modbus UDP/IP.
- RTU/ASCII tunnelling over TCP/UDP.
- FC01/02/03/04 reads.
- FC05/06/15/16 writes.
- FC08 diagnostics, FC11 event counter, FC17 server ID, FC22 mask write, FC23 read/write multiple registers, FC43/MEI 0x0E device identification.
- Configurable response/connect timeouts and delay between polls.
- Custom baud rate, RTS/CTS/DSR/DTR controls and echo removal.
- One-shot and cyclic polling.
- Disable-on-error behavior.
- Base-0/base-1 and extended/6-digit addressing.
- Broadcast handling.
- Enron/Daniel compatibility mode.
- Address scan and Slave/Unit scan.
- Raw frame/test-string center with CRC/LRC assistance.
- Communication traffic viewer with stop/clear/save/copy/log and stop-on-error.
- Text/Excel logging, independent log interval, change-only logging, error logging, timestamps and file rollover.
- Signed/unsigned 16/32/64-bit, hex, binary, ASCII, float32, float64 and word/byte-order variants.
- Scaling and precision.
- Enum/value-name substitution.
- Conditional cell colors.
- Real-time charts with multiple series, dual Y axes, zoom/pan and export.
- Workspace save/restore.
- CSV export and master-to-slave workspace exchange.
- Automation from Excel/VBA/Python.
- Slave simulator with many virtual devices and memory blocks.

### WinTECH ModScan / ModSim

The current WinTECH site confirms ModScan as a Modbus master and ModSim as a Modbus slave simulator, with serial RTU/ASCII, Modbus/TCP, TCP tunnelling, IPv4/IPv6, and current Version 8 Secure Modbus support. Historical official ModScan32 documentation additionally describes multi-document cyclic polling, direct writes, multiple display formats, debug traffic, customized user-defined messages, test scripts with expected-response verification and disk logging, OLE/Control Automation, database integration and custom MMI forms. Historical ModSim documentation describes multi-slave simulation, serial or network-server operation, multiple TCP clients and Automation-driven process simulation.

Features from the older WinTECH documentation are treated as workflow references, not assumed to be unchanged in every current ModScan64 build.

## 2. v7 baseline we already have

The existing v7 product already gives us a stronger analyzer/reverse-engineering foundation than either classic polling tool:

- Passive RTU analyzer.
- Modbus TCP inline proxy analyzer.
- Transport-aware channel/device identity.
- Automatic device/register/poll formation.
- Timeouts, RTT, jitter, exceptions and health metrics.
- Passive and guarded active discovery.
- FC43 identity evidence and auditable adoption.
- Register datatype/byte-order inference.
- Poll-cycle reconstruction.
- Fingerprinting, relationships and anomaly analysis.
- Capture/replay and session comparison.
- Persistent projects, engineering mappings and history.
- XLSX/PDF/ZIP handover exports.
- Light/Dark/System UI and Windows desktop packaging.

The major missing product categories are a general-purpose active **Master**, a full **Slave/Server Simulator**, advanced protocol transports, a production **Test/Script Engine**, and integrated HMI/logger workflows.

## 3. Target product model

v8 should be one application with clearly separated operating modes instead of separate executables.

### Primary workspaces

1. **Connections** — serial/network/TLS endpoints and profiles.
2. **Master** — polling/read/write workstation.
3. **Slave Simulator** — virtual Modbus devices/server.
4. **Analyzer** — current passive/proxy analyzer.
5. **Discovery** — passive + guarded active discovery.
6. **Traffic** — unified Tx/Rx/raw/decoded timeline.
7. **Register Lab** — values, formats, maps, scaling and write tools.
8. **Test Center** — raw frames, sequences, assertions and production test recipes.
9. **Charts & Logger** — live trends and persistent data logging.
10. **Automation** — scripts, CLI/API and scheduled recipes.
11. **HMI Builder** — optional custom engineering screens.
12. **Projects** — complete reusable workspaces.
13. **Reports** — captures, test reports and engineering handover.

Every live channel must have an explicit mode badge such as `PASSIVE ANALYZER`, `MASTER ACTIVE`, `SLAVE SERVER`, `TCP PROXY`, `SECURE TCP`, `REPLAY`, or `LAB TEST`.

## 4. Core architecture

Do not bolt Master/Slave behavior into analyzer classes. Introduce reusable protocol and transport engines.

### 4.1 Protocol Core

Create a pure Modbus protocol package responsible for:

- PDU request/response models.
- RTU framing and CRC16.
- ASCII framing and LRC.
- MBAP encode/decode.
- Standard exception handling.
- Strict quantity/byte-count validation.
- Function-code codecs.
- Register/coil bit packing.
- Device Identification object handling.
- Diagnostics subfunctions.
- Raw/custom PDU escape hatch.

The same codec must be used by Master, Slave, Analyzer, Test Center and simulator tests so behavior cannot drift between modes.

### 4.2 Transport Layer

One transport abstraction with implementations for:

- Serial RTU.
- Serial ASCII.
- Modbus TCP.
- Modbus TCP Security/TLS.
- UDP.
- RTU over TCP.
- ASCII over TCP.
- RTU over UDP.
- ASCII over UDP.
- Replay/virtual loopback.

Transport capabilities must expose local interface, remote endpoint, IPv4/IPv6, timeouts, serial framing and flow-control metadata.

### 4.3 Master Engine

The master engine owns active requests. It must provide:

- One-shot request API.
- Cyclic poll-job scheduler.
- Multiple devices/jobs per connection.
- Per-job scan rate and global minimum inter-request gap.
- Retry policy and reconnect policy.
- Bounded outstanding requests for TCP.
- Strict serial request serialization by default.
- Broadcast write support with explicit warning and no-response semantics.
- Pause/resume/disable-on-error.
- Read-after-write verification option.
- Per-request latency, result and error metadata.
- Fair scheduling so a slow/dead device cannot starve other jobs.

### 4.4 Slave/Server Engine

The simulator must model many devices and independent memory areas:

- Coils.
- Discrete inputs.
- Holding registers.
- Input registers.
- Unit/Slave IDs.
- FC43 identity objects.
- Per-device maps and engineering names.

Server modes:

- Serial RTU/ASCII slave.
- TCP server with multiple clients.
- UDP server.
- RTU/ASCII-over-IP server.
- Secure Modbus/TLS server later in the same architecture.

### 4.5 Test Engine

A deterministic recipe runner shared by UI and CLI:

- Read/write step.
- Raw-frame step.
- Delay/wait-until step.
- Loop/repeat.
- Variables.
- Assertions.
- Expected exception.
- Tolerance/range assertions.
- Timing assertions.
- Branch on result.
- Capture evidence.
- Pass/fail report.

Use a versioned YAML/JSON recipe format. Do not make Excel/OLE the primary automation model.

## 5. Master workspace specification

### 5.1 Poll documents/jobs

Each job contains:

- Connection/channel.
- Unit/Slave ID.
- Function code.
- Start address.
- Quantity.
- Poll interval.
- Timeout/retry policy.
- Disabled/one-shot/cyclic state.
- Engineering display map.

The UI may look like tabs/cards rather than legacy MDI windows, but must allow many live jobs at once.

### 5.2 Standard function coverage target

Master request builders and Slave handlers should ultimately support the standard functions relevant to engineering tools:

- FC01 Read Coils.
- FC02 Read Discrete Inputs.
- FC03 Read Holding Registers.
- FC04 Read Input Registers.
- FC05 Write Single Coil.
- FC06 Write Single Register.
- FC07 Read Exception Status where applicable.
- FC08 Diagnostics with supported serial subfunctions.
- FC11 Get Comm Event Counter.
- FC12 Get Comm Event Log where practical.
- FC15 Write Multiple Coils.
- FC16 Write Multiple Registers.
- FC17 Report Server ID.
- FC20 Read File Record.
- FC21 Write File Record.
- FC22 Mask Write Register.
- FC23 Read/Write Multiple Registers.
- FC24 Read FIFO Queue.
- FC43/MEI 0x0E Read Device Identification.

Unknown/vendor functions remain accessible through Test Center/raw PDU mode.

### 5.3 Write safety

Writes are a major difference from the current passive analyzer and need explicit controls:

- Writes disabled by default for newly created live connections.
- Per-channel **Enable Writes** latch.
- Optional timed auto-lock.
- Confirmation for multi-register/multi-coil writes.
- Stronger confirmation for Unit 0/broadcast.
- Read-back verification.
- Full write audit log containing old value when known, requested value, response and user/time.
- Lab recipes can explicitly opt into writes; analyzer/discovery never inherits write permission.

## 6. Slave Simulator specification

### 6.1 Virtual device designer

Allow a project to contain hundreds of virtual Unit/Slave devices. Each device can define arbitrary memory blocks without requiring one UI window per block.

Each point supports:

- Address and memory area.
- Name/description.
- Raw value.
- Datatype and byte/word order.
- Scale/offset/unit.
- Read-only/read-write behavior.
- Enum/value names.
- Bit labels.

### 6.2 Dynamic simulation

Go beyond Modbus Slave/ModSim static cells by supporting value generators:

- Constant.
- Increment/decrement counter.
- Sawtooth.
- Sine wave.
- Random bounded value.
- Timestamp.
- Copy/formula from another point.
- Scheduled state sequence.
- JavaScript sandbox expression/recipe variable.

### 6.3 Fault injection / negative testing

Lab-only simulator options:

- Configurable response delay/jitter.
- Drop every Nth response.
- Force exception code.
- Disconnect TCP client.
- Wrong Unit ID/function/byte count.
- Bad CRC/LRC for serial lab testing.
- Truncated response.
- Duplicate/delayed response.

These features must be unmistakably marked **LAB / FAULT INJECTION**, never available accidentally on a production proxy path.

### 6.4 Capture-to-simulator

High-value differentiator: generate a virtual device profile from an analyzer capture/project.

Workflow:

`Analyze real device -> confirm register map -> Create Simulator -> edit dynamic behavior -> run PLC/HMI against virtual device.`

This should preserve discovered FCs, addresses, datatypes, scaling, FC43 identity and example values.

## 7. Test Center and production test automation

Combine the strongest ideas from Modbus Poll Test Center and ModScan test scripts.

### Raw Frame Studio

- Hex/ASCII editor.
- Select RTU/ASCII/TCP/UDP/TLS context.
- Auto CRC/LRC.
- Auto MBAP header/TID with manual override.
- Decode current frame live.
- Send once/repeat.
- Expected-response mask/assertion.
- Save named frame templates.
- Compare response bytes.

### Recipe Runner

Example logical flow:

```text
connect
read FC03 unit=1 addr=0 qty=10
assert register[2] between 220 and 250
write FC06 unit=1 addr=20 value=1
wait 500ms
read FC03 unit=1 addr=20 qty=1
assert value == 1
repeat 100
export test report
```

Results must include exact Tx/Rx frames, RTT, assertion outcome and timestamp.

## 8. Register Lab / data presentation

Match the useful Poll/ModScan display functions while extending them.

Required formats:

- bool/coil.
- uint16/int16.
- hex16/binary16.
- ASCII characters/strings.
- uint32/int32.
- uint64/int64 with exact integer preservation.
- float32/float64.
- BCD where requested.
- Unix/epoch/date-time interpretations.
- configurable word/byte permutations.

Engineering metadata:

- Scale + offset.
- Two-point linear scaling compatibility.
- Decimal precision.
- Unit.
- Enum/value names.
- Bitfield names.
- Min/max engineering limits.
- Conditional formatting.
- Read-only designation.

Provide protocol address, base-1 PLC notation and 5/6-digit forms as alternate views of the same canonical address, not separate internal addresses.

## 9. Scanning and discovery

Unify classic scanning with our v7 discovery intelligence.

### Unit/Slave scan

- Configurable range.
- Read-only probe strategy.
- FC43 first when appropriate.
- Conservative timeout/rate limits.
- RTU exclusive-bus interlock.
- Export results.

### Address scan

- Memory area/function selection.
- Start/end range.
- Conservative one-by-one mode for compatibility.
- Optional adaptive block probing with fallback to smaller ranges.
- Abort/cancel and progress.
- Exception-aware result classification.
- Never infer that one Illegal Address means the whole remaining range is invalid.

### Smart discovery

Keep the existing passive discovery as the safest first choice. Active scans are supplemental.

## 10. Traffic and analyzer unification

The Traffic workspace should understand all modes:

- Master Tx/Rx.
- Slave request/response.
- Passive RTU sniffing.
- TCP proxy traffic.
- Test Center frames.
- Replay.

Features:

- Raw hex + decoded tree.
- Direction and connection/session.
- Unit/Slave, FC, address/quantity.
- TID for TCP.
- CRC/LRC status.
- RTT.
- exception/error.
- stop/freeze.
- clear.
- filter/search.
- copy/save/export.
- stop on configurable error/assertion.

Unlike Modbus Poll's communication view, the analyzer must remain capable of observing traffic that was not generated by our master when using passive/proxy capture.

## 11. Charting, logging and historian

### Charting

- Unlimited practical series with a sensible UI cap per chart.
- Left/right axes.
- independent units.
- zoom/pan.
- pause/resume.
- rolling/continue/restart modes.
- min/max/avg/current statistics.
- markers for writes/errors/timeouts.
- PNG/CSV export.

### Logging

- Per-job or selected-tag logging.
- Every sample / fixed interval / change-only.
- Include errors optionally.
- ISO-8601 with milliseconds.
- CSV/TSV/JSONL.
- SQLite historian for long runs.
- Daily/size rotation and retention.
- XLSX export after capture instead of depending on live Excel automation.

## 12. HMI Builder

This is lower priority but directly exceeds ModScan custom MMI forms.

Drag/drop widgets:

- Numeric display/input.
- Boolean lamp/switch.
- Gauge/bar.
- Trend.
- Text/state label.
- Image.
- Bitfield/status panel.

Every write-capable widget must honor the same channel write lock and audit system as Master mode.

## 13. Automation/API strategy

Modern replacement for OLE/COM as primary integration:

- REST API for project/master/slave/test control.
- WebSocket event stream.
- CLI commands.
- JavaScript/TypeScript SDK.
- Python client package/examples.
- Import/export Excel/CSV.

A Windows COM/OLE compatibility bridge may be added later only if customer demand requires direct legacy Excel macros.

## 14. Secure Modbus

Implement after basic TCP client/server engines are stable.

Modbus/TCP Security requirements:

- TLS transport on default port 802.
- X.509 certificate store/import.
- Client certificate selection.
- Server certificate/private-key configuration.
- CA trust configuration.
- Mutual authentication option/requirements aligned with Modbus Security specification.
- Certificate validation diagnostics.
- No weakening/fallback to insecure TCP without an explicit user action.

Keep ordinary TCP port 502 and secure Modbus port 802 as distinct connection profiles.

## 15. IPv4 / IPv6 and network interfaces

- Master target may be IPv4, IPv6 or hostname.
- Slave listen interface picker enumerates local adapters.
- TCP/UDP server supports explicit interface or all interfaces.
- Link-local IPv6 scope IDs handled correctly.
- Proxy/listen security warnings remain.

## 16. Projects and compatibility

A v8 project should contain:

- Connection profiles.
- Master poll jobs.
- Simulator devices/maps/generators.
- Analyzer captures and discoveries.
- Engineering metadata/profiles.
- Charts.
- Logger definitions.
- Test recipes.
- HMI layouts.
- Reports and test evidence.

Use a new project schema version with migration from v7. Never mutate a v7 project without backup and migration report.

## 17. Recommended implementation sequence

### Phase 0 — v8 branch and architecture freeze

- Freeze v7 as the accepted analyzer baseline.
- Add v8 schema and migration envelope.
- Define normalized PDU and transport interfaces.
- Add feature flags for new active modes.

**Gate:** no v7 analyzer regression.

### Phase 1 — Protocol Core

- Extract common encode/decode layer.
- Add request encoders and response encoders.
- Complete standard FC validation.
- CRC/LRC/MBAP shared utilities.
- Unit tests with golden frames and malformed boundaries.

**Gate:** analyzer outputs remain byte-for-byte compatible on existing capture fixtures.

### Phase 2 — Master MVP

Start with RTU + TCP and FC01/02/03/04/05/06/15/16/22/23/43.

- Connection profiles.
- Poll scheduler.
- Tabbed poll jobs.
- one-shot/cyclic.
- writes and readback.
- traffic integration.
- device scan/address scan.

**Gate:** hardware tests against at least one real serial device and one real TCP device plus simulator CI.

### Phase 3 — Slave Simulator MVP

- TCP server first for deterministic CI.
- multi-client support.
- multiple Unit IDs.
- four memory areas.
- standard reads/writes.
- FC43 identity.
- profile save/import.
- serial RTU slave second.

**Gate:** internal Master-to-Slave conformance matrix plus external third-party master test.

### Phase 4 — Test Center + Recipe Engine

- raw frame studio.
- CRC/LRC/MBAP helpers.
- expected response/assertions.
- sequence runner.
- pass/fail reports.
- CLI execution.

**Gate:** deterministic recipe suite exercises Master and Slave engines.

### Phase 5 — Advanced transports

- ASCII.
- UDP.
- RTU/ASCII over TCP.
- RTU/ASCII over UDP.
- IPv6.
- serial flow-control/RTS/echo options.

**Gate:** transport matrix automated where possible and hardware serial acceptance for RTU/ASCII.

### Phase 6 — Secure Modbus

- TLS client/server.
- certificate management.
- mutual authentication diagnostics.
- port 802 presets.

**Gate:** local certificate-based client/server interoperability plus external secure-device test when hardware is available.

### Phase 7 — Advanced simulator and digital twin

- dynamic generators.
- scripting.
- fault injection.
- capture-to-simulator.
- clone project/device map.

**Gate:** learned device profile can be served to our Master and a third-party master.

### Phase 8 — Data tools and HMI

- advanced charts.
- long-run logger/historian.
- enums/bitfields/conditional formatting.
- HMI builder.

**Gate:** long-duration logging and workspace restore tests.

### Phase 9 — Production hardening

- cross-mode resource locking.
- crash recovery.
- Windows installer/upgrade.
- performance/soak.
- security review.
- site acceptance.

## 18. Parallel engineering lanes

Use parallel lanes only after Phase 1 stabilizes shared protocol contracts.

- **Lane A — Protocol/Transport:** codecs, serial, TCP, UDP, TLS.
- **Lane B — Master:** scheduler, polling, writes, scans.
- **Lane C — Slave:** server, memory maps, simulator behavior.
- **Lane D — Test/Automation:** recipes, raw frames, assertions, CLI/API.
- **Lane E — UI/Data:** grids, formats, charts, logging, HMI.
- **Lane F — Analyzer integration:** traffic, capture, digital twin, intelligence.
- **Lane G — Quality:** golden frames, fuzz tests, E2E, performance, packaging.

Every lane must use the same Protocol Core and project schema; do not duplicate Modbus encoders in individual features.

## 19. Important edge cases to design before coding

- Serial port can only have one active transmitter owner inside the app.
- Analyzer passive capture and Master active transmit are mutually exclusive on the same serial adapter unless explicit supported hardware architecture exists.
- Slave serial mode cannot share a COM port with Master mode.
- Unit 0 broadcast must never wait for a serial response.
- TCP Unit 0 is not automatically treated as serial broadcast.
- TCP Transaction IDs can wrap/reuse and responses may arrive out of order.
- TCP fragmentation/coalescing.
- UDP duplicate/lost/out-of-order packets.
- ASCII whitespace/case/LRC and CRLF handling.
- Partial serial frames and stale bytes after reconnect.
- FC15 bit packing and padding.
- FC16 quantity limits.
- FC20/21 variable subrequest structures.
- FC23 separate read/write ranges.
- FC43 segmented identification.
- 64-bit integers cannot be represented safely as ordinary JavaScript Number.
- Overlapping engineering mappings.
- Broadcast and multi-write confirmation.
- Failed writes must not update displayed confirmed value unless explicitly marked optimistic.
- Simulator read-only areas must reject illegal writes correctly.
- Simulator exception injection must be separated from normal project behavior.
- Network listen address must belong to the local PC unless wildcard is explicitly chosen.
- TLS private keys must not be exported in project ZIPs by default.

## 20. Product differentiation — how v8 should be better

The target is not simply "Modbus Poll + ModScan in a browser". The strongest differentiators should be:

1. **One application, all roles:** Master + Slave + Analyzer + Proxy + Discovery + Test Center.
2. **Transport-aware engineering identity:** no Unit/Slave collisions across buses/endpoints.
3. **Passive reverse engineering:** automatically learn devices, blocks, poll cycles, timing and likely datatypes.
4. **Capture-to-digital-twin:** turn observed equipment into a simulator profile.
5. **Smart test recipes:** assertions, timing, evidence and repeatable production tests.
6. **Professional write safety:** per-channel locks, audit trail and readback verification.
7. **Modern automation:** REST/WebSocket/CLI/Python instead of depending on Windows OLE.
8. **Unified evidence:** traffic + charts + logs + test results + project handover in one package.
9. **Fault-injection lab:** controlled simulator faults for PLC/HMI robustness testing.
10. **Modern security:** Modbus/TCP Security/TLS and certificate diagnostics.
11. **Engineering intelligence:** correlations, fingerprints, anomalies and capture comparison already present in v7.

## 21. Deliberately low-priority compatibility items

These can be added only when there is a concrete customer need:

- Legacy Windows TAPI/modem workflows from old ModScan deployments.
- Microsoft Jet database compatibility.
- Direct OLE/COM server compatibility.
- Exact legacy `.mbp/.mbw/.mbs` proprietary file import if licensing/format constraints make clean interoperability impractical.

Modern equivalents (network profiles, SQLite, REST/CLI, CSV/XLSX/profile import) should be preferred.

## 22. First implementation work package

The first coding package should **not** start by drawing the Master page. Start with shared foundations:

1. Create v8 Protocol Core request/response object model.
2. Move existing analyzer decode logic behind the shared codec without changing behavior.
3. Implement RTU/TCP request encoding for FC01/02/03/04/05/06/15/16/22/23/43.
4. Build a deterministic in-memory virtual transport.
5. Build Master Engine one-shot request API on the virtual transport.
6. Build a minimal TCP simulator using the same response codec.
7. Add conformance tests where our Master talks to our Slave and analyzer sees the same exchange.
8. Only after that expose Master/Slave UI.

This sequence prevents three separate implementations of Modbus framing from diverging and gives us a testable core before live hardware is involved.

## Research references

- Witte Software Modbus Poll product page and current user manual: https://www.modbustools.com/modbus_poll.html and https://www.modbustools.com/mbpoll-user-manual.html
- Witte Software Modbus Slave product page/manual: https://www.modbustools.com/modbus_slave.html and https://www.modbustools.com/mbslave-user-manual.html
- WinTECH current product page: https://www.win-tech.com/
- WinTECH historical ModScan32 detail: https://www.win-tech.com/html/modscan32.htm
- WinTECH historical ModSim32 detail: https://www.win-tech.com/html/modsim32.htm
- Modbus Organization specifications/security: https://www.modbus.org/modbus-specifications
