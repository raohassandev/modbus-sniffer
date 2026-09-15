# v8 All-in-One Modbus Engineering Workbench — Master TODO

**Baseline:** v7.0 analyzer/reverse-engineering platform  
**Companion plans:** `V8_ALL_IN_ONE_MODBUS_WORKBENCH_PLAN.md`, `V8_PROFESSIONAL_UI_UX_PLAN.md`  
**Goal:** one professional workstation covering Modbus Master, Slave/Server simulator, passive/proxy analyzer, discovery, raw Test Center, automated recipes, charts/logger, historian, automation and engineering handover.

> Completion rule: an item is complete only when implementation, migration/safety behavior, automated tests and the applicable acceptance gate pass. A visible UI without protocol/runtime verification is not complete.

## Status / priority

- `[ ]` not started
- `[~]` in progress
- `[x]` complete
- **P0** correctness/safety/release blocker
- **P1** required core product capability
- **P2** professional hardening/workflow quality
- **P3** optional/market-driven extension

## Non-negotiable invariants

- [ ] **P0** Passive Analyzer never gains transmit capability implicitly.
- [ ] **P0** Master/Slave/Test Center share one protocol codec; no duplicate FC implementations per mode.
- [ ] **P0** A serial port has one exclusive active owner unless an explicitly supported hardware topology proves otherwise.
- [ ] **P0** Write permission is per connection, off by default and never persisted as armed across restart/replay.
- [ ] **P0** Discovery remains read-only and cannot inherit Master write permission.
- [ ] **P0** TCP proxy forwards production payload bytes unchanged.
- [ ] **P0** Fault injection can never execute through a production proxy/passive channel.
- [ ] **P0** Same Unit/Slave IDs on different channels remain isolated everywhere.
- [ ] **P0** Raw/custom frames are clearly separated from normal validated requests.
- [ ] **P0** Every write/test transmission is auditable with timestamp, channel, target and raw evidence.
- [ ] **P0** UI mode labels always reflect actual runtime ownership/capability.
- [ ] **P0** Existing v7 projects/captures remain readable or migrate explicitly without silent loss.

---

# PHASE 0 — v8 Foundation and Product Shell

## 0.1 Repository / architecture baseline

- [ ] **P0** Freeze v7 release behavior with regression fixtures before v8 refactors.
- [ ] **P0** Define v8 project schema version and migration strategy.
- [ ] **P0** Define shared package/module boundaries: protocol, transports, connection broker, master, slave, test engine, UI/API.
- [ ] **P0** Document dependency direction to prevent UI/runtime circular coupling.
- [ ] **P0** Define unified event envelope for Tx/Rx/error/state/test/write/discovery events.
- [ ] **P1** Create feature flags for incomplete v8 modules so `main` can remain testable.

## 0.2 Professional design system

- [ ] **P0** Introduce semantic design tokens for all v8 workspaces.
- [ ] **P0** Preserve System/Light/Dark themes.
- [ ] **P1** Add Comfortable/Compact/Dense data density.
- [ ] **P1** Standardize typography, tabular numerals and monospace protocol text.
- [ ] **P1** Standardize button hierarchy: primary, secondary, destructive, transmit/write.
- [ ] **P1** Standardize status chips for PASSIVE/MASTER/SLAVE/PROXY/REPLAY/LAB.
- [ ] **P1** Standardize tables, filters, inspectors, drawers, dialogs, forms and split panes.
- [ ] **P1** Add consistent empty/loading/error/offline states.
- [ ] **P1** Add icon + text status semantics; no color-only status.

## 0.3 Application shell

- [ ] **P0** Build persistent app bar with project, active connection, mode and write state.
- [ ] **P0** Build primary navigation for all v8 workspaces.
- [ ] **P1** Build collapsible context inspector.
- [ ] **P1** Build bottom engineering status bar.
- [ ] **P1** Add document/tab framework with dirty/saved state.
- [ ] **P1** Add split-view framework where required.
- [ ] **P1** Add command palette and quick-open.
- [ ] **P1** Persist safe UI layout/preferences per user/project.
- [ ] **P0** Never persist armed writes/fault injection as active on restart.

## 0.4 Connection ownership model

- [ ] **P0** Introduce central Connection Broker as sole owner of physical/logical transports.
- [ ] **P0** Enforce one active owner for serial ports.
- [ ] **P0** Represent owner mode: analyzer/master/slave/proxy/discovery/test/replay.
- [ ] **P0** Reject unsafe ownership conflicts with actionable error.
- [ ] **P0** Stop/switch ownership only after explicit user action.
- [ ] **P1** Support saved connection profiles.
- [ ] **P1** Track connection lifecycle, reconnect policy and runtime metrics centrally.
- [ ] **P1** Expose connection inventory/status through API/WebSocket.

**Gate 0:** new shell + broker can open a virtual connection and prove ownership conflict behavior without changing v7 analyzer correctness.

---

# PHASE 1 — Shared Protocol Core

## 1.1 PDU model

- [ ] **P0** Define canonical request/response/exception models.
- [ ] **P0** Define strict Unit ID, FC and payload validation.
- [ ] **P0** Preserve unknown/vendor PDUs without data loss.
- [ ] **P0** Return structured validation errors, not only strings.

## 1.2 Framing codecs

- [ ] **P0** RTU encode/decode and CRC16.
- [ ] **P0** ASCII encode/decode and LRC.
- [ ] **P0** MBAP encode/decode with TID/Protocol ID/Length validation.
- [ ] **P0** TCP/UDP ADU size validation.
- [ ] **P0** Raw bytes remain accessible beside decoded form.

## 1.3 Standard function codecs

Implement request + response + exception handling and boundary tests for:

- [ ] **P0** FC01 Read Coils.
- [ ] **P0** FC02 Read Discrete Inputs.
- [ ] **P0** FC03 Read Holding Registers.
- [ ] **P0** FC04 Read Input Registers.
- [ ] **P0** FC05 Write Single Coil.
- [ ] **P0** FC06 Write Single Register.
- [ ] **P1** FC07 Read Exception Status.
- [ ] **P1** FC08 Diagnostics and selected standard subfunctions.
- [ ] **P1** FC11 Get Comm Event Counter.
- [ ] **P2** FC12 Get Comm Event Log.
- [ ] **P0** FC15 Write Multiple Coils.
- [ ] **P0** FC16 Write Multiple Registers.
- [ ] **P1** FC17 Report Server ID.
- [ ] **P1** FC20 Read File Record.
- [ ] **P1** FC21 Write File Record.
- [ ] **P1** FC22 Mask Write Register.
- [ ] **P0** FC23 Read/Write Multiple Registers.
- [ ] **P1** FC24 Read FIFO Queue.
- [ ] **P0** FC43/MEI 0x0E Device Identification.

## 1.4 Common data model

- [ ] **P0** Bit/coil packing and unpacking.
- [ ] **P0** 16/32/64-bit signed/unsigned exact decoding.
- [ ] **P0** float32/float64.
- [ ] **P1** ASCII/string helpers.
- [ ] **P1** BCD helpers.
- [ ] **P1** configurable byte/word permutations.
- [ ] **P1** timestamp/date interpretations.
- [ ] **P0** exact integer handling beyond JS safe integer where required.

## 1.5 Protocol verification

- [ ] **P0** Golden vectors for every supported FC.
- [ ] **P0** Request/response round-trip tests.
- [ ] **P0** Quantity/byte-count limits.
- [ ] **P0** malformed/truncated/oversized cases.
- [ ] **P0** deterministic parser fuzz suite.
- [ ] **P1** compare representative frames against independent known-good tools/device captures.

**Gate 1:** Master/Slave/Analyzer tests use the same shared codec and all mandatory FC golden vectors pass.

---

# PHASE 2 — Transport Layer and Connection Center

## 2.1 Transport abstraction

- [ ] **P0** Common open/close/send/receive/error/state interface.
- [ ] **P0** Transport capabilities descriptor.
- [ ] **P0** Cancellation/abort support.
- [ ] **P0** Deadline/timeout ownership defined centrally.
- [ ] **P0** Backpressure and bounded queues.

## 2.2 Serial RTU

- [ ] **P0** Serial RTU Master transport.
- [ ] **P0** Serial RTU Slave transport.
- [ ] **P0** configurable baud/parity/data/stop bits.
- [ ] **P1** RTS/CTS/DSR/DTR options where supported.
- [ ] **P1** RTS toggle modes where supported.
- [ ] **P1** echo removal for adapters that require it.
- [ ] **P0** high-resolution RTU inter-frame timing as platform permits.
- [ ] **P0** unsupported driver settings fail explicitly.

## 2.3 ASCII serial

- [ ] **P1** Modbus ASCII Master.
- [ ] **P1** Modbus ASCII Slave.
- [ ] **P1** framing timeout/resync tests.

## 2.4 TCP

- [ ] **P0** TCP client transport.
- [ ] **P0** TCP server transport.
- [ ] **P0** multiple server clients.
- [ ] **P0** per-client TID pairing/state.
- [ ] **P0** IPv4 interface selection.
- [ ] **P1** IPv6.
- [ ] **P0** connect/read/idle timeouts.
- [ ] **P0** reconnect policy.

## 2.5 UDP / tunnelling

- [ ] **P1** Modbus UDP client/server.
- [ ] **P1** RTU over TCP.
- [ ] **P2** ASCII over TCP.
- [ ] **P2** RTU over UDP.
- [ ] **P2** ASCII over UDP.

## 2.6 Secure Modbus/TLS

- [ ] **P1** TLS client on configurable/default secure port.
- [ ] **P1** TLS server.
- [ ] **P1** certificate/key import and validation.
- [ ] **P1** CA trust configuration.
- [ ] **P1** client certificate selection.
- [ ] **P1** mutual TLS.
- [ ] **P1** certificate expiry/hostname diagnostics.
- [ ] **P0** never silently fall back from TLS to insecure TCP.

## 2.7 Connection Center UI

- [ ] **P0** Profile cards/table with exact runtime state.
- [ ] **P1** Connection wizard.
- [ ] **P1** auto-enumerate local serial ports and network interfaces.
- [ ] **P1** target-subnet recommendation for network interface.
- [ ] **P0** reject listen IP not assigned to PC where applicable.
- [ ] **P1** Test Connection action.
- [ ] **P1** duplicate/clone profile.
- [ ] **P1** import/export profiles.
- [ ] **P1** live diagnostics inspector.

**Gate 2:** virtual, TCP and RTU transports pass lifecycle/error tests and UI cannot create an unsafe ownership conflict.

---

# PHASE 3 — Master Workstation

## 3.1 Master runtime engine

- [ ] **P0** One-shot request API.
- [ ] **P0** cyclic poll scheduler.
- [ ] **P0** multiple poll jobs per connection.
- [ ] **P0** strict serial request serialization.
- [ ] **P0** bounded TCP concurrency.
- [ ] **P0** per-job interval/timeout/retry.
- [ ] **P0** global minimum inter-request delay.
- [ ] **P1** fair scheduling; dead device cannot starve others.
- [ ] **P1** pause/resume/disable-on-error.
- [ ] **P1** reconnect recovery.
- [ ] **P1** poll-cycle statistics.
- [ ] **P0** Unit 0 broadcast no-response semantics.

## 3.2 Write safety/audit service

- [ ] **P0** writes disabled by default on every new/restored live connection.
- [ ] **P0** per-connection enable latch.
- [ ] **P1** optional timed auto-lock.
- [ ] **P0** stronger confirmation for FC15/16/21/23 and broadcast.
- [ ] **P1** optional read-back verification.
- [ ] **P0** immutable audit event containing user/session, target, raw request/response, old value when known and result.
- [ ] **P0** replay/offline sources can never execute writes.
- [ ] **P0** project restart returns to locked state.

## 3.3 Master UI

- [ ] **P0** Poll Documents/tabs.
- [ ] **P0** Poll Jobs grid.
- [ ] **P0** Run/Pause/Stop/Read Now.
- [ ] **P1** multi-select enable/disable/duplicate.
- [ ] **P1** serial job ordering controls.
- [ ] **P1** inline interval/timeout/retry editing with validation.
- [ ] **P0** result/register grid.
- [ ] **P1** representation selector.
- [ ] **P1** stale/change/error/write-pending indicators.
- [ ] **P0** write drawer and encoded payload preview.
- [ ] **P1** Add to Chart / Logger / Recipe quick actions.
- [ ] **P1** job templates.

## 3.4 Address notation

- [ ] **P0** canonical internal zero-based address.
- [ ] **P1** UI base-0/base-1 selection.
- [ ] **P1** 4xxxx/3xxxx notation views.
- [ ] **P1** 5/6-digit extended notation.
- [ ] **P0** prevent notation changes from changing canonical stored address.

**Gate 3:** Master can poll/write a controlled virtual slave over TCP and RTU loopback, with correct audit/readback behavior and no write permission leakage.

---

# PHASE 4 — Slave / Server Simulator

## 4.1 Virtual device model

- [ ] **P0** many Unit/Slave IDs per server.
- [ ] **P0** Coils.
- [ ] **P0** Discrete Inputs.
- [ ] **P0** Holding Registers.
- [ ] **P0** Input Registers.
- [ ] **P1** FC43 identity objects.
- [ ] **P1** per-point name/type/order/scale/unit/access.
- [ ] **P0** deterministic bounds and illegal-address exceptions.

## 4.2 Server runtime

- [ ] **P0** TCP server multiple clients.
- [ ] **P0** RTU slave.
- [ ] **P1** ASCII slave.
- [ ] **P1** UDP server.
- [ ] **P2** tunnelling server modes.
- [ ] **P1** TLS server.
- [ ] **P0** correct exception responses.
- [ ] **P0** request/write audit.

## 4.3 Simulator UI

- [ ] **P0** device/server tree.
- [ ] **P0** memory spreadsheet editor.
- [ ] **P1** bulk range creation/fill/copy/paste.
- [ ] **P1** CSV/XLSX register-map import/export.
- [ ] **P1** client-session view.
- [ ] **P1** last request/write source.
- [ ] **P1** live request-rate/status.

## 4.4 Dynamic value generators

- [ ] **P1** constant.
- [ ] **P1** counter.
- [ ] **P1** sawtooth.
- [ ] **P1** sine wave.
- [ ] **P1** bounded random.
- [ ] **P1** timestamp.
- [ ] **P1** formula/copy from another point.
- [ ] **P1** scheduled state sequence.
- [ ] **P2** sandboxed script expression.
- [ ] **P0** generators cannot block protocol response loop.

## 4.5 Fault Injection Lab

- [ ] **P1** LAB master enable.
- [ ] **P1** response delay/jitter.
- [ ] **P1** drop every Nth response.
- [ ] **P1** forced exception.
- [ ] **P1** TCP disconnect/reset.
- [ ] **P1** wrong Unit/FC/byte count.
- [ ] **P1** bad CRC/LRC lab response.
- [ ] **P1** truncated response.
- [ ] **P1** duplicate/late response.
- [ ] **P0** impossible to activate on production proxy path.

**Gate 4:** external/our Master can exercise simulator memory and standard FCs; malformed behaviors require explicit LAB mode.

---

# PHASE 5 — Unified Traffic and Register Lab

## 5.1 Unified event timeline

- [ ] **P0** Master Tx/Rx events.
- [ ] **P0** Slave request/response events.
- [ ] **P0** Passive RTU events.
- [ ] **P0** TCP proxy events.
- [ ] **P0** Test Center events.
- [ ] **P0** Discovery events.
- [ ] **P0** Replay events.
- [ ] **P0** common channel/device/source metadata.

## 5.2 Traffic UI

- [ ] **P0** virtualized live table.
- [ ] **P1** freeze without stopping capture.
- [ ] **P1** filters by connection/mode/direction/device/FC/error.
- [ ] **P1** raw HEX search.
- [ ] **P1** bookmarks.
- [ ] **P1** copy as HEX/PDU/JSON.
- [ ] **P1** decoded/raw/request-response/timing inspector tabs.
- [ ] **P1** next/previous error navigation.
- [ ] **P1** stop/freeze on configured condition.
- [ ] **P0** bounded DOM/memory view independent of persistent capture.

## 5.3 Register Lab

- [ ] **P0** common register source abstraction.
- [ ] **P0** interpretation matrix.
- [ ] **P1** scale/offset and two-point scaling.
- [ ] **P1** units/precision.
- [ ] **P1** enum/value-name editor.
- [ ] **P1** bitfield editor.
- [ ] **P1** engineering limits.
- [ ] **P1** conditional formatting.
- [ ] **P1** provenance/notes.
- [ ] **P1** save to reusable profile.
- [ ] **P0** write actions only when source is writable Master + unlocked.

**Gate 5:** one frame can be followed from Master/Slave/Test action to raw Traffic evidence and engineering interpretation without identity loss.

---

# PHASE 6 — Scanning and Discovery Expansion

- [ ] **P0** retain v7 passive discovery behavior.
- [ ] **P0** Unit/Slave scan through shared Master request engine.
- [ ] **P0** FC43-first strategy.
- [ ] **P0** configurable range/rate/timeout/cancel.
- [ ] **P0** RTU maintenance/exclusive-bus interlock.
- [ ] **P1** address scan by memory area/FC.
- [ ] **P1** conservative one-by-one scan.
- [ ] **P1** adaptive block scan with fallback.
- [ ] **P0** exception-aware classification.
- [ ] **P0** silence is not a confirmed device.
- [ ] **P1** scan progress and estimated duration.
- [ ] **P1** results to project/evidence/export.
- [ ] **P1** convert selected discovery result to Master job.
- [ ] **P1** convert confirmed device map to simulator profile.

---

# PHASE 7 — Test Center and Production Recipe Engine

## 7.1 Raw Frame Studio

- [ ] **P0** HEX editor.
- [ ] **P1** ASCII editor.
- [ ] **P0** select connection/transport context.
- [ ] **P1** auto CRC/LRC.
- [ ] **P1** auto MBAP/TID.
- [ ] **P1** manual header override.
- [ ] **P0** live decode/validation.
- [ ] **P0** exact outgoing-byte preview.
- [ ] **P0** Send Once.
- [ ] **P1** repeat with rate/count.
- [ ] **P1** expected-response bytes/mask.
- [ ] **P1** named templates.
- [ ] **P0** malformed/manual frame sends require LAB/raw confirmation.

## 7.2 Recipe schema/runtime

- [ ] **P0** versioned JSON/YAML recipe schema.
- [ ] **P0** connect/disconnect step.
- [ ] **P0** read step.
- [ ] **P0** write step.
- [ ] **P1** raw-frame step.
- [ ] **P0** delay/wait-until.
- [ ] **P0** variables.
- [ ] **P0** assertions equality/range/tolerance.
- [ ] **P1** expected exception.
- [ ] **P1** timing assertion.
- [ ] **P1** loop/repeat.
- [ ] **P1** conditional branch.
- [ ] **P1** setup/teardown.
- [ ] **P0** cancellation/timeout.
- [ ] **P0** evidence capture.
- [ ] **P0** pass/fail summary.

## 7.3 Recipe UI

- [ ] **P1** step tree/editor.
- [ ] **P1** variables/assertion inspector.
- [ ] **P1** Validate.
- [ ] **P1** Run/Pause/Stop.
- [ ] **P1** step status indicators.
- [ ] **P1** execution console.
- [ ] **P1** jump failure to traffic evidence.
- [ ] **P1** convert Master actions into recipe steps.

## 7.4 Test reports

- [ ] **P1** PDF test report.
- [ ] **P1** XLSX/CSV result export.
- [ ] **P0** include exact Tx/Rx evidence for failures/writes.
- [ ] **P1** operator/site/device metadata.
- [ ] **P1** digital hash of evidence package.

**Gate 7:** deterministic recipe passes/fails identically via UI and CLI and produces traceable evidence.

---

# PHASE 8 — Charts, Logging and Historian

## 8.1 Charts

- [ ] **P1** multiple chart documents.
- [ ] **P1** multiple series.
- [ ] **P1** dual Y axes.
- [ ] **P1** per-series unit/scale.
- [ ] **P1** zoom/pan/cursor.
- [ ] **P1** rolling/fixed window.
- [ ] **P1** pause/autopan.
- [ ] **P1** current/min/max/avg.
- [ ] **P1** write/error/timeout/test markers.
- [ ] **P1** CSV/PNG export.
- [ ] **P0** bounded chart layout; no canvas resize feedback loop.
- [ ] **P1** decimation for long histories.

## 8.2 Logger

- [ ] **P1** select tags/registers/jobs.
- [ ] **P1** every sample.
- [ ] **P1** fixed interval.
- [ ] **P1** change-only.
- [ ] **P1** optional error/quality rows.
- [ ] **P1** ISO timestamps with milliseconds.
- [ ] **P1** CSV.
- [ ] **P1** TSV.
- [ ] **P1** JSONL.
- [ ] **P1** daily/size rotation.
- [ ] **P1** retention.
- [ ] **P1** immediate flush option.
- [ ] **P1** disk/error visibility.

## 8.3 SQLite historian

- [ ] **P1** schema for tags/samples/quality/events.
- [ ] **P1** indexed time-range queries.
- [ ] **P1** retention/compaction.
- [ ] **P1** safe interrupted-write recovery.
- [ ] **P1** export time range to CSV/XLSX.
- [ ] **P1** chart historian queries without loading all samples.

**Gate 8:** long run logging/charting does not block polling/capture and storage errors surface clearly.

---

# PHASE 9 — Capture-to-Digital-Twin

- [ ] **P1** select analyzer device/project as source.
- [ ] **P1** map observed FC/register blocks to simulator areas.
- [ ] **P1** carry confirmed datatype/order/scaling.
- [ ] **P1** carry FC43 identity.
- [ ] **P1** initialize example/current values.
- [ ] **P1** flag uncertain/inferred definitions visibly.
- [ ] **P1** choose read-only/writable defaults safely.
- [ ] **P1** edit generated simulator before enabling server.
- [ ] **P1** preserve source capture/evidence provenance.
- [ ] **P1** regression test PLC/HMI against generated simulator profile.

---

# PHASE 10 — Automation and APIs

## 10.1 REST/WebSocket

- [ ] **P1** connection management API.
- [ ] **P1** Master job control/read API.
- [ ] **P0** write API uses same lock/audit policy.
- [ ] **P1** Slave simulator control API.
- [ ] **P1** recipe API.
- [ ] **P1** logger/chart data API.
- [ ] **P1** unified event WebSocket.
- [ ] **P0** same-origin/local security retained by default.

## 10.2 CLI

- [ ] **P1** list/open connection.
- [ ] **P1** one-shot read.
- [ ] **P1** guarded write.
- [ ] **P1** run recipe.
- [ ] **P1** start/stop simulator.
- [ ] **P1** export/report.
- [ ] **P1** machine-readable JSON output.

## 10.3 SDK/examples

- [ ] **P2** JavaScript/TypeScript client.
- [ ] **P2** Python client/examples.
- [ ] **P2** generated examples from selected UI context.
- [ ] **P3** Windows COM/OLE compatibility bridge only if customer demand exists.

---

# PHASE 11 — HMI Builder

- [ ] **P2** page/canvas model.
- [ ] **P2** numeric display/input.
- [ ] **P2** lamp/switch.
- [ ] **P2** gauge/bar.
- [ ] **P2** trend.
- [ ] **P2** text/state label.
- [ ] **P2** image.
- [ ] **P2** bitfield/status panel.
- [ ] **P2** button/recipe trigger.
- [ ] **P2** bindings to project tags/registers.
- [ ] **P0** all write widgets go through central write-lock/audit.
- [ ] **P2** edit/preview/run modes.
- [ ] **P2** grid/snap/alignment/layers.
- [ ] **P2** reusable templates.

---

# PHASE 12 — Projects, Profiles and Reports

## 12.1 v8 project persistence

- [ ] **P0** persist connection profiles.
- [ ] **P0** persist Master documents/jobs.
- [ ] **P0** persist Slave devices/maps/generators.
- [ ] **P1** persist raw frame templates.
- [ ] **P1** persist recipes.
- [ ] **P1** persist chart/logger definitions.
- [ ] **P2** persist HMI pages.
- [ ] **P0** retain v7 analyzer/discovery/history data.
- [ ] **P0** explicit v7 -> v8 migration + backup/report.
- [ ] **P0** corrupt project protection.
- [ ] **P1** project templates.
- [ ] **P1** Save As / clone.

## 12.2 Profiles

- [ ] **P1** reusable register/device profiles.
- [ ] **P1** Master job templates.
- [ ] **P1** simulator templates.
- [ ] **P1** connection templates.
- [ ] **P1** recipe templates.
- [ ] **P1** version/provenance/conflict preview before apply.

## 12.3 Reports/export

- [ ] **P1** Master poll summary report.
- [ ] **P1** write audit report.
- [ ] **P1** simulator model export.
- [ ] **P1** recipe/test report.
- [ ] **P1** historian export.
- [ ] **P1** traffic selection export.
- [ ] **P1** full v8 project ZIP.
- [ ] **P0** keep channel/device identity in every export.
- [ ] **P0** formula-injection/file-name protections retained.
- [ ] **P1** manifest includes product/version/schema/hashes.

---

# PHASE 13 — UI Quality, Accessibility and Performance

## 13.1 Keyboard workflow

- [ ] **P1** command palette.
- [ ] **P1** quick open.
- [ ] **P1** workspace search.
- [ ] **P1** table keyboard selection/editing.
- [ ] **P1** dialog/drawer focus trapping.
- [ ] **P1** configurable shortcuts.
- [ ] **P0** shortcut cannot bypass write confirmations/locks.

## 13.2 Accessibility

- [ ] **P1** semantic labels/headers.
- [ ] **P1** visible focus.
- [ ] **P1** keyboard-only core workflows.
- [ ] **P1** contrast verification Light/Dark.
- [ ] **P1** reduced-motion support.
- [ ] **P1** status not color-only.

## 13.3 Responsive desktop UX

- [ ] **P1** 1366×768 acceptance.
- [ ] **P1** 1920×1080 optimized layout.
- [ ] **P1** HiDPI acceptance.
- [ ] **P1** inspector/nav collapse behavior.
- [ ] **P1** no horizontal overflow for primary shell; data grids scroll intentionally.

## 13.4 Performance budgets

- [ ] **P0** table virtualization for large registers/traffic.
- [ ] **P0** batched live UI updates independent of capture fidelity.
- [ ] **P1** background worker/job model for export/import/scans.
- [ ] **P1** cancellation for long tasks.
- [ ] **P1** progress for >500 ms operations.
- [ ] **P1** bounded chart render points/decimation.
- [ ] **P1** memory benchmark with Master + Slave + Analyzer + logger concurrently.

---

# PHASE 14 — Security and Safety Hardening

- [ ] **P0** same-origin mutation protection maintained.
- [ ] **P0** mutation rate/body limits.
- [ ] **P0** strict import schema/size validation.
- [ ] **P0** path/file export safety.
- [ ] **P0** TLS private-key handling avoids accidental export/logging.
- [ ] **P0** redact secrets from logs/reports.
- [ ] **P1** certificate-store diagnostics.
- [ ] **P0** sandbox simulator scripts/expressions.
- [ ] **P0** resource limits for recipes and raw repeat loops.
- [ ] **P0** clear production-vs-lab boundary.
- [ ] **P0** security regression suite for API/write/raw-frame paths.

---

# PHASE 15 — QA / Interoperability / Soak

## 15.1 Automated conformance matrix

- [ ] **P0** Master ↔ our Slave over virtual transport.
- [ ] **P0** Master ↔ our TCP Slave.
- [ ] **P0** Master ↔ our RTU Slave loopback/hardware test fixture.
- [ ] **P0** Analyzer decodes same exchange identically.
- [ ] **P0** exception matrix.
- [ ] **P0** write matrix.
- [ ] **P0** TID concurrency/out-of-order matrix.
- [ ] **P0** serial timeout/late-response matrix.
- [ ] **P0** malformed-frame/raw-lab isolation matrix.

## 15.2 Competitor/device interoperability

- [ ] **P1** our Slave tested with Modbus Poll/ModScan where licensing/environment permits.
- [ ] **P1** our Master tested against Modbus Slave/ModSim where licensing/environment permits.
- [ ] **P1** representative PLC.
- [ ] **P1** representative inverter.
- [ ] **P1** representative power meter.
- [ ] **P1** TCP-to-RTU gateway with multiple Unit IDs.
- [ ] **P1** device returning standard exceptions.
- [ ] **P1** slow/dead/noisy device scenarios.

## 15.3 Scale/performance

- [ ] **P1** 100+ poll jobs.
- [ ] **P1** 100 simulated Unit IDs.
- [ ] **P1** 10k+ mapped registers.
- [ ] **P1** 100k+ traffic rows viewed via virtualization.
- [ ] **P1** multi-hour logger/historian run.
- [ ] **P1** concurrent Master + Slave + Analyzer + chart workload.
- [ ] **P1** TCP multi-client stress.

## 15.4 Long soak

- [ ] **P1** 24 h software virtual/TCP soak.
- [ ] **P1** real field soak later on representative site hardware.
- [ ] **P1** monitor memory/handles/sockets/serial reconnect/disk growth.
- [ ] **P1** export/project reopen after soak.

---

# PHASE 16 — Desktop Packaging and Release

- [ ] **P0** v8 version synchronization.
- [ ] **P0** root/desktop reproducible lockfiles.
- [ ] **P0** Windows installer build.
- [ ] **P0** packaged-app smoke launch.
- [ ] **P1** upgrade from v7 preserving projects.
- [ ] **P1** uninstall/reinstall preserving user data by policy.
- [ ] **P1** installer checksum/provenance.
- [ ] **P1** code signing when certificate is available.
- [ ] **P1** crash/log collection path documented.
- [ ] **P1** clean machine acceptance.
- [ ] **P1** Windows Defender/firewall/network-bind UX validation.

---

# PHASE 17 — Documentation and Operator Guidance

- [ ] **P1** Getting Started.
- [ ] **P1** Connection modes guide.
- [ ] **P1** Master guide.
- [ ] **P1** Slave Simulator guide.
- [ ] **P1** Analyzer/Discovery guide.
- [ ] **P1** Register formats/address notation guide.
- [ ] **P1** Write safety guide.
- [ ] **P1** Test Center/Recipe guide.
- [ ] **P1** Charts/Logger/Historian guide.
- [ ] **P1** TLS/certificate guide.
- [ ] **P1** Automation/API guide.
- [ ] **P1** Lab/Fault Injection warning guide.
- [ ] **P1** troubleshooting matrix.
- [ ] **P1** v7 -> v8 migration guide.
- [ ] **P1** field acceptance checklist.

---

# Release Gates

## Gate A — Protocol Core

Required before production Master/Slave UI work is considered stable:

- shared codecs;
- mandatory FC round-trip tests;
- strict limits/errors;
- virtual Master ↔ Slave conformance.

## Gate B — Master MVP

- TCP + RTU Master reads;
- FC05/06/15/16 writes;
- scheduler;
- write lock/audit;
- Poll Documents UI;
- unified traffic evidence.

## Gate C — Slave MVP

- TCP + RTU server;
- multi-device memory;
- standard read/write functions;
- exceptions;
- simulator UI.

## Gate D — Engineering Test Platform

- Raw Frame Studio;
- Recipe Runner;
- assertions/evidence;
- scans;
- charts/logger;
- digital-twin generation.

## Gate E — Transport Complete

- ASCII;
- UDP/tunnelling targets;
- TLS/Secure Modbus;
- IPv6 where planned;
- connection diagnostics.

## Gate F — Professional Workbench

- complete new shell;
- accessibility/keyboard;
- dense large-data performance;
- project/report integration;
- automation APIs;
- desktop packaging.

## Gate G — Release Candidate

- Windows/Linux applicable CI green;
- browser E2E green;
- packaged Windows smoke green;
- security/audit green;
- interoperability matrix passed;
- 24 h software soak passed;
- no open P0;
- P1 exceptions documented/approved.

## External field gates

These stay separate from software completion:

- real production RS485 electrical acceptance;
- representative real Modbus TCP equipment acceptance;
- customer Windows-driver/security-policy acceptance;
- long-duration plant soak;
- code signing if certificate is not yet supplied.

---

# Recommended execution lanes

To move quickly without mixing unsafe changes, use parallel lanes with shared gates:

### Lane A — Protocol/Transport
Protocol Core, TCP, RTU, ASCII, UDP, TLS.

### Lane B — Master/Write Safety
Scheduler, writes, scans, Master UI.

### Lane C — Slave/Simulator
Server engine, memory model, generators, fault lab.

### Lane D — Unified Engineering UX
Shell, Connections, Traffic, Register Lab, charts/logger.

### Lane E — Test/Automation
Raw Frame Studio, recipes, CLI/API/SDK.

### Lane F — Persistence/Reports
v8 schema, migration, historian, exports/handover.

### Lane G — QA/Release
E2E, interoperability, soak, desktop installer, security.

Cross-lane rule: no lane may invent its own transport, write-lock, identity, engineering datatype or raw-event model.

# Immediate next work package

The first implementation package should be deliberately small and foundational:

1. Add v8 shared Protocol Core package/module.
2. Implement FC01/02/03/04/05/06/15/16/23/43 codecs first.
3. Add virtual loopback transport.
4. Add minimal one-shot Master API.
5. Add minimal in-memory TCP/virtual Slave engine.
6. Prove Master -> Slave -> Analyzer decode consistency in automated tests.
7. Introduce Connection Broker ownership state.
8. Build the v8 shell/Connection Center skeleton against those real runtime states.

Do **not** start by building a large Master UI against placeholder protocol logic. The UI should grow as vertical slices on top of the shared tested core.