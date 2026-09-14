# Modbus Engineering Analyzer — Master Remaining Work TODO

**Baseline:** v6.1.0  
**Baseline main:** `291f8cbdf14ae61f9a2681d52f023d10451cb778`  
**Purpose:** single source of truth for all remaining work required to make the analyzer professionally safe, transport-correct, discovery-capable, maintainable, and field-ready.

> Rule: do not mark an item complete because the UI exists. An item is complete only when implementation, migration/backward compatibility, automated tests, and the applicable acceptance gate all pass.

## Status / priority legend

- `[ ]` not started
- `[~]` in progress
- `[x]` complete
- **P0** release blocker / data correctness / safety
- **P1** required for the next planned feature release
- **P2** production hardening / scale / maintainability
- **P3** optional product enhancement after the planned roadmap

## Non-negotiable invariants

- [ ] **P0** Never merge data from different RTU buses, TCP endpoints, or TCP sessions merely because Unit/Slave ID and register addresses match.
- [ ] **P0** Passive RTU capture remains RX-only by default; active transmission must never be enabled implicitly.
- [ ] **P0** TCP proxy mode forwards the master's bytes unchanged; analyzer logic must not alter production Modbus commands.
- [ ] **P0** Active discovery must never issue write function codes.
- [ ] **P0** Existing projects, profiles, captures, history, and exports must migrate without silent loss or silent reassignment.
- [ ] **P0** A corrupted workspace must never be silently replaced by a new blank workspace.
- [ ] **P0** UI labels must reflect the actual operating mode: RTU passive, TCP proxy, TCP direct discovery, replay, offline capture, or mixed transport.
- [ ] **P0** Old capture replay must preserve source timing for analysis even when playback speed is accelerated.
- [ ] **P0** Every P0/P1 work package must add regression tests before being marked complete.

---

# RELEASE 6.2 — Transport & UI Foundation

This release must be completed before Discovery is built on top of the runtime model.

## 1. Transport-aware identity model

### 1.1 Channel abstraction

- [ ] **P0** Introduce a first-class `Channel` model with a stable `channelId` independent of a changing COM name or transient TCP socket.
- [ ] **P0** Channel fields must include at minimum:
  - `channelId`
  - `transport` = `RTU | TCP`
  - `mode` = `passive | proxy | direct | replay | offline`
  - user-facing name
  - created/updated timestamps
  - active/inactive state
- [ ] **P0** RTU channel identity must persist across COM-number changes when the same adapter is rebound by serial number/VID/PID.
- [ ] **P0** RTU channel configuration snapshot must include port, baud, parity, data bits, stop bits and adapter identity metadata where available.
- [ ] **P0** TCP channel identity must include normalized target endpoint and mode, not only Unit ID.
- [ ] **P0** TCP proxy session must also carry a separate `connectionId`/`sessionId`; multiple client connections to the same target are sessions of one channel, not separate devices by default.
- [ ] **P0** Normalize hostnames/IP literals, IPv4/IPv6 presentation and ports so logically identical endpoints do not generate accidental duplicate channels.

**Acceptance:** two RTU buses both using Slave 1 and two TCP endpoints both using Unit 1 can run simultaneously without any shared registers, poll statistics, timeouts, names, or histories.

### 1.2 Canonical device identity

- [ ] **P0** Replace the internal slave-only identity with a canonical `deviceKey` based on `channelId + unitId`.
- [ ] **P0** Use canonical internal field `unitId`; present it as **Slave ID** for RTU and **Unit ID** for TCP.
- [ ] **P0** Keep a compatibility alias for old API consumers only where the channel is unambiguous.
- [ ] **P0** Change device maps from `Map<slaveId,...>` to `Map<deviceKey,...>`.
- [ ] **P0** Change register keys from `slaveId:functionCode:address` to `deviceKey:functionCode:address`.
- [ ] **P0** Change poll-pattern keys to include `deviceKey`.
- [ ] **P0** Ensure timeout, exception, unmatched-response and write activity all carry `channelId`, `deviceKey` and `unitId`.
- [ ] **P0** Keep function-code summaries available both globally and per channel/device.

**Edge cases:**
- [ ] Same `44112` on RTU Slave 1 and TCP Unit 1.
- [ ] Same Unit 1 behind two different TCP gateways.
- [ ] Multiple TCP clients talking to the same endpoint/Unit ID.
- [ ] COM path changes while adapter serial identity remains the same.
- [ ] Adapter replacement using same COM number must not inherit the prior channel silently.

### 1.3 Runtime/API filters

- [ ] **P0** Add `channelId` and `deviceKey` filters to devices, registers, polling, traffic, engineering and history APIs.
- [ ] **P0** Existing `slave` filters must return an ambiguity error when more than one channel has the requested ID unless a channel is specified.
- [ ] **P0** WebSocket transaction events must include transport/channel/device identity.
- [ ] **P0** Status API must return a channel list with per-channel mode and health.
- [ ] **P1** Add endpoint/channel selection to the UI instead of relying on a single global transport state.

---

## 2. Persistence and backward-compatible migration

### 2.1 Workspace schema v2

- [ ] **P0** Bump workspace schema version from v1 to v2.
- [ ] **P0** Store `channels` explicitly in each project.
- [ ] **P0** Store named devices by `deviceKey`, not only numeric Slave ID.
- [ ] **P0** Store register mappings by `deviceKey + FC + address`.
- [ ] **P0** Keep reusable device profiles transport-independent; applying a profile binds it to a selected `deviceKey`.
- [ ] **P0** Implement an idempotent v1 -> v2 migration.
- [ ] **P0** Create a backup before migration and retain a migration report.
- [ ] **P0** Never guess a channel for legacy data if it is ambiguous. Put ambiguous legacy mappings into an explicit **Legacy / Unassigned** bucket and require user assignment.
- [ ] **P0** Validate imported workspace schema, types, ranges and maximum sizes before replacing local data.
- [ ] **P0** Reject partial/invalid imports without modifying the existing workspace.

### 2.2 Workspace corruption protection

- [ ] **P0** Stop silently returning an empty workspace on JSON parse failure.
- [ ] **P0** Preserve the corrupt original and surface a clear recovery error in CLI/UI.
- [ ] **P0** Maintain at least one known-good backup generation.
- [ ] **P0** Keep atomic temp-file + rename writes; verify Windows replacement semantics and recovery after interrupted writes.
- [ ] **P1** Add a workspace repair/import screen with explicit user confirmation.

### 2.3 Capture schema versioning

- [ ] **P0** Add explicit `.mbcap` schema version.
- [ ] **P0** Store `channelId`, `deviceKey`, transport, endpoint/session metadata and original timestamps in capture events.
- [ ] **P0** Import older captures through versioned migrations.
- [ ] **P0** Preserve raw source timestamp separately from replay/display time.
- [ ] **P0** Accelerated replay must not compress learned polling intervals or RTT analysis.
- [ ] **P0** Offline capture status must be capture-relative; old data must not appear offline simply because wall-clock time has advanced.
- [ ] **P1** Record analyzer version and relevant serial/TCP configuration in capture metadata.

### 2.4 History schema

- [ ] **P0** Add channel/device identity to history snapshots.
- [ ] **P0** Store per-channel health so RTU and TCP metrics are not mixed into one misleading figure.
- [ ] **P1** Add retention policy by time/size rather than only file rollover.
- [ ] **P2** Avoid loading an entire 25 MB JSONL file for each query; implement an indexed/chunked reader or migrate history to an indexed store.
- [ ] **P2** Add corruption detection/recovery for partial final JSONL records after power loss.

---

## 3. Modbus TCP reliability and correctness

### 3.1 Proxy session management

- [ ] **P0** Replace the current socket-count concept with explicit TCP sessions; one client/upstream pair = one session.
- [ ] **P0** Maintain a tracker-expiry timer per active TCP session so timeouts fire even when the connection becomes silent.
- [ ] **P0** On disconnect, resolve pending requests as `connection-closed`/timeout outcomes instead of silently discarding them.
- [ ] **P0** Detect Transaction ID reuse while the previous request is still pending; do not overwrite the old request silently.
- [ ] **P0** Preserve correct pairing of out-of-order responses by Transaction ID + Unit ID within the connection.
- [ ] **P0** Record target-connect failure, connection reset, clean close, reconnect and idle timeout separately.
- [ ] **P0** Fix connection status so upstream and client sockets are not counted as two independent connections.
- [ ] **P0** Implement graceful stop while requests are pending.
- [ ] **P0** Add configurable maximum client sessions.
- [ ] **P0** Add socket backpressure handling (`pause`/`resume` / drain) instead of blindly writing through under heavy traffic.
- [ ] **P1** Add configurable idle-session timeout.

### 3.2 MBAP/parser diagnostics

- [ ] **P0** Count malformed MBAP headers separately from generic noise.
- [ ] **P0** Surface non-zero Protocol ID, invalid length, truncated ADU and oversized ADU counters in TCP diagnostics.
- [ ] **P0** Feed parser `error-frame` events into runtime diagnostics instead of dropping them from the engineering view.
- [ ] **P0** Test fragmented frames split at every possible byte boundary.
- [ ] **P0** Test multiple coalesced ADUs in one TCP chunk.
- [ ] **P0** Test malformed prefixes followed by a valid frame and verify parser resynchronization.
- [ ] **P0** Keep raw MBAP/PDU bytes unmodified in proxy mode.
- [ ] **P1** Record request concurrency / outstanding-transaction high-water mark.
- [ ] **P1** Record bytes/s, requests/s and responses/s per channel.

### 3.3 TCP endpoint security/safety

- [ ] **P0** Continue binding analyzer web UI and TCP proxy to localhost by default.
- [ ] **P0** Show a prominent warning before binding the proxy to `0.0.0.0` or a non-loopback interface.
- [ ] **P0** Validate host/port configuration before starting the proxy and provide actionable upstream-connect errors.
- [ ] **P1** Add origin/CSRF protection to state-changing local web APIs so another webpage cannot trigger analyzer actions through the browser.
- [ ] **P1** Add reasonable request body/rate limits to mutation and import endpoints.

---

## 4. RTU edge-case hardening

- [ ] **P0** Treat Slave ID 0 broadcast requests correctly: no response is expected and must not create a timeout alarm.
- [ ] **P0** Verify matching behavior when a master issues another request before the prior reply arrives.
- [ ] **P0** Detect probable multi-master traffic and avoid falsely pairing requests/responses across masters where possible.
- [ ] **P0** Keep the FC01/FC02 exact-8-byte ambiguity regression coverage.
- [ ] **P0** Validate byte counts/quantities before mapping register/coil data.
- [ ] **P1** Remove/justify the effective 1 ms minimum RTU gap behavior for high baud rates; use high-resolution timing where the host API permits it.
- [ ] **P1** Make UI/docs clear that host timestamps are arrival/chunk timestamps, not electrical byte timestamps.
- [ ] **P1** Detect unsupported mark/space parity on platforms/drivers and fail clearly rather than appearing connected with an invalid configuration.
- [ ] **P1** Improve unknown/vendor-frame CRC scanning so random noise has lower probability of being accepted as valid traffic.
- [ ] **P1** Keep software RX-only language separate from electrical high-impedance guarantees; recommend isolated receive-only hardware for production tapping.

---

## 5. Transport-aware health model

### 5.1 RTU health

- [ ] **P0** Keep RTU-specific health inputs: CRC/frame validity, line noise, timeout rate, exception rate, unmatched responses, polling jitter, RTT and estimated wire utilization.
- [ ] **P0** Calculate RTU utilization only for an RTU channel with known serial framing/baud.

### 5.2 TCP health

- [ ] **P0** Do not display RTU bus utilization/noise as TCP health metrics.
- [ ] **P0** Add TCP-specific metrics:
  - MBAP errors
  - malformed/truncated ADUs
  - disconnect/reset count
  - reconnect count
  - outstanding transactions
  - Transaction ID reuse/collision
  - request/response throughput
  - bytes/s
  - timeout rate
  - exception rate
  - unmatched responses
  - average/P95 RTT
- [ ] **P0** Track health separately per TCP endpoint/channel.

### 5.3 Mixed-mode health

- [ ] **P0** Avoid a mathematically meaningless single blended RTU/TCP utilization figure.
- [ ] **P0** If a global health score remains, define and document the aggregation rule; always expose per-channel score beside it.
- [ ] **P1** Global findings should identify the affected channel/device explicitly.

---

## 6. Dashboard / UI foundation

### 6.1 Transport-neutral dashboard

- [ ] **P0** Replace hard-coded `Live RS485 / Modbus RTU visibility` with dynamic mode-aware text.
- [ ] **P0** Replace hard-coded `PASSIVE / RX ONLY` with a dynamic safety/mode badge.
- [ ] **P0** Modes must display accurately:
  - RTU passive capture
  - TCP inline analyzer proxy
  - TCP direct discovery
  - offline capture
  - replay
  - mixed transport
- [ ] **P0** Rename **Bus activity** to **Traffic activity** when TCP or mixed transport is active.
- [ ] **P1** Add `All / RTU / TCP / Channel` filter to Dashboard.
- [ ] **P1** Add per-channel summary cards with endpoint/serial configuration and state.
- [ ] **P1** Use Slave terminology for RTU and Unit terminology for TCP throughout UI, exports and reports.

### 6.2 Traffic activity graph

- [ ] **P0** Put the graph in a dedicated bounded container; it must never grow indefinitely with viewport width.
- [ ] **P0** Target responsive height: `clamp(220px, 25vh, 300px)` on desktop; provide a smaller mobile cap.
- [ ] **P0** Use `ResizeObserver` to resize/redraw only when the container changes.
- [ ] **P0** Make canvas backing dimensions DPI-aware using `devicePixelRatio`; prevent blurry Retina/high-DPI rendering.
- [ ] **P0** Prevent CSS/intrinsic canvas dimension feedback loops and layout shift.
- [ ] **P1** Allow metric selection: frames/s, requests/s, responses/s, bytes/s, timeouts/s.
- [ ] **P1** When both transports are selected, render separate RTU/TCP series without hiding total activity.
- [ ] **P1** Keep a fixed display window (for example last 60 seconds) while preserving longer runtime history elsewhere.
- [ ] **P1** Handle zero-traffic periods without collapsing axes or producing NaN coordinates.

### 6.3 Light / Dark / System theme

- [ ] **P0** Replace hard-coded dark colors with semantic design tokens.
- [ ] **P0** Add themes: `System`, `Light`, `Dark`.
- [ ] **P0** Persist explicit user choice locally.
- [ ] **P0** `System` must follow OS theme changes live where supported.
- [ ] **P0** Tokenize all core surfaces: app background, sidebar, panel, inputs, table header/hover, text levels, borders, code blocks, badges, charts and modal/toast states.
- [ ] **P0** Remove dark-only values remaining in `styles.css`, `ui-v4.css`, v6 styles and dynamically inserted markup.
- [ ] **P0** Canvas charts must read theme variables and redraw immediately on theme change.
- [ ] **P0** Set `color-scheme` correctly for the active theme instead of forcing dark.
- [ ] **P1** Verify PDF/print report remains readable independently of app theme.
- [ ] **P1** Meet usable contrast for normal text, muted text, status colors and focus rings in both themes.

### 6.4 UI quality / accessibility

- [ ] **P1** Add keyboard navigation for all primary pages, device rows, filters and dialogs.
- [ ] **P1** Add visible focus styles in light and dark themes.
- [ ] **P1** Add loading, empty, disconnected and error states for every page.
- [ ] **P1** Ensure long endpoint names, IPv6 addresses, manufacturer strings and register names cannot break layouts.
- [ ] **P1** Test 1366x768, 1920x1080, high-DPI laptop and narrow mobile/tablet layouts.
- [ ] **P1** Do not use color alone to communicate online/warning/fault state.

---

# RELEASE 6.3 — Discovery

## 7. Passive Discovery engine

Passive Discovery remains the default and must never transmit frames.

- [ ] **P1** Add a dedicated **Discovery** page.
- [ ] **P1** Build inventory strictly from observed valid transactions.
- [ ] **P1** Group discoveries by Channel -> Device -> Function -> Address range.
- [ ] **P1** For each discovered device show:
  - transport
  - channel/endpoint
  - Slave/Unit ID
  - first seen / last seen
  - online/silent/offline status
  - observed function codes
  - read/write behavior
  - contiguous register/coil ranges
  - request counts
  - response counts
  - timeout/exception counts
  - median/P95 poll interval
  - average/P95 RTT
  - latest values
- [ ] **P1** Build TCP topology as `Endpoint -> Unit IDs`.
- [ ] **P1** Build RTU topology as `RTU Channel -> Slave IDs`.
- [ ] **P1** Passive discovery must immediately isolate identical IDs on different channels.
- [ ] **P1** A valid Modbus exception response still proves that a device exists.
- [ ] **P1** Add confidence/reason fields for inferred findings; do not present guesses as confirmed manufacturer/model.
- [ ] **P1** Allow **Add to Project / Name Device / Create Profile** directly from Discovery.
- [ ] **P1** Persist discovery notes without polluting runtime protocol identity.

### 7.1 Duplicate/conflict detection

- [ ] **P1** Do not flag Unit 1 on two different TCP endpoints as a duplicate.
- [ ] **P1** Flag suspicious duplicate RTU Slave ID behavior only within the same RTU channel.
- [ ] **P1** Use evidence such as conflicting timing/signatures, overlapping replies, inconsistent identity objects, impossible value-source changes or collision/noise patterns.
- [ ] **P1** Label duplicate-ID findings as `suspected` unless evidence is conclusive.

---

## 8. Device Identification support

### 8.1 FC43 / MEI 0x0E decoder

- [ ] **P1** Add Function 43 / Encapsulated Interface Transport decoding.
- [ ] **P1** Add MEI type `0x0E` Read Device Identification request/response decoding.
- [ ] **P1** Parse conformity level, More Follows, Next Object ID and object count.
- [ ] **P1** Parse standard Basic/Regular/Extended Device ID objects without assuming ASCII is always clean UTF-8.
- [ ] **P1** Handle segmented multi-response identification sequences.
- [ ] **P1** Store observed vendor/product/revision objects with source/confidence metadata.
- [ ] **P1** Handle Illegal Function / Illegal Data Value as `identification unsupported`, not `device absent`.
- [ ] **P2** Add optional FC17 Report Server ID parsing as an RTU read-only identification source.

---

## 9. Active Discovery — safety first

Active Discovery is a separate operating mode. It must be disabled by default.

### 9.1 Global safety interlocks

- [ ] **P0** Require explicit user enable each time active discovery is started.
- [ ] **P0** Show the selected interface/endpoint, Unit/Slave range and scan method before starting.
- [ ] **P0** Never issue FC05, FC06, FC15, FC16, FC22, FC23-write or vendor write commands during discovery.
- [ ] **P0** Identification-only must be the default probe strategy.
- [ ] **P0** Random holding/input-register probing must not be a default fallback.
- [ ] **P0** Provide cancel/stop that halts new probes immediately and drains/cleans outstanding requests safely.
- [ ] **P0** Log every transmitted discovery request separately from passively observed production traffic.

### 9.2 RTU active scan

- [ ] **P0** Never active-scan through an RX-only passive tap.
- [ ] **P0** Require an explicitly TX-capable adapter/mode.
- [ ] **P0** If normal master traffic is detected, block active RTU scan by default and require a maintenance/exclusive-bus workflow rather than transmitting into a live production polling loop.
- [ ] **P0** Exclude address 0 from normal station scan because it is broadcast.
- [ ] **P1** Support bounded range selection (default narrow range, user may expand to 1..247).
- [ ] **P1** One outstanding RTU discovery request at a time.
- [ ] **P1** Respect serial silent interval and configurable inter-request delay.
- [ ] **P1** Distinguish timeout, CRC/noise collision, exception response and valid identification response.
- [ ] **P1** Restore prior passive configuration/state after scan stops or fails.

### 9.3 TCP active scan

- [ ] **P1** Add a direct TCP client specifically for discovery; do not misuse the transparent proxy as a scanner.
- [ ] **P1** User selects host, port and Unit ID range.
- [ ] **P1** Default port 502 but allow non-standard ports.
- [ ] **P1** Default probe = FC43/MEI 0x0E only.
- [ ] **P1** Treat valid exception replies as endpoint/unit presence.
- [ ] **P1** Handle native TCP devices that ignore Unit ID or conventionally use 0/255 without incorrectly creating 247 identical devices.
- [ ] **P1** Handle gateway exceptions 10/11 distinctly from target silence.
- [ ] **P1** Rate-limit Unit-ID scans and bound concurrency.
- [ ] **P1** Detect endpoint connection failure separately from individual Unit-ID timeout.
- [ ] **P1** Support hostname/IPv4/IPv6 targets.

### 9.4 Optional user-defined safe probe

- [ ] **P2** Allow a user to configure a known-safe read probe for equipment that does not support Device Identification.
- [ ] **P2** Probe definition must be explicitly read-only and validated against allowed FCs.
- [ ] **P2** Store probe templates separately from manufacturer register profiles.

---

## 10. Discovery UX and topology

- [ ] **P1** Discovery page tabs: `Passive Discovery` and `Active Scan`.
- [ ] **P1** Add transport/channel selector.
- [ ] **P1** Add scan-progress UI with current ID, elapsed time, found devices, errors and cancel.
- [ ] **P1** Show topology tree for TCP gateway -> Unit IDs and RTU channel -> Slave IDs.
- [ ] **P1** Add filters for online/offline, identified/unknown, exceptions, timeouts and transport.
- [ ] **P1** Add details drawer with observed register ranges and polling behavior.
- [ ] **P1** Do not display manufacturer/model unless observed or user-entered; label profile-based suggestions separately.
- [ ] **P1** Allow applying a known profile to a discovered device without changing the protocol identity.

---

# RELEASE 6.4 — Engineering, Export & Product Hardening

## 11. Engineering workspace hardening

- [ ] **P1** Make all device editing and register mapping channel/device-key aware.
- [ ] **P1** Prevent applying a mapping to the wrong same-numbered Unit/Slave on another channel.
- [ ] **P1** Validate byte-order strings against the selected datatype instead of accepting arbitrary text.
- [ ] **P1** Validate required word count and detect overlapping multiword mappings.
- [ ] **P1** Add address-display mode to distinguish zero-based protocol addresses from 3xxxx/4xxxx documentation notation without changing wire addresses.
- [ ] **P1** Keep exact integer representation for uint64/int64; never coerce unsafe values through JavaScript Number.
- [ ] **P1** Fix any remaining 64-bit precision path in legacy `MeterMap`.
- [ ] **P2** Improve ASCII/string mapping with configurable length/termination/encoding.
- [ ] **P2** Improve bitfield mapping with named bit definitions.
- [ ] **P2** Version reusable profiles and record profile source/version when applied.
- [ ] **P3** Manufacturer library/catalog only after the generic profile model is stable.

---

## 12. Export / report updates

- [ ] **P1** Add Transport, Channel, Endpoint and Device Key to all CSV/XLSX exports where relevant.
- [ ] **P1** Add **Channels** worksheet to XLSX.
- [ ] **P1** Add **Discovery** worksheet to XLSX.
- [ ] **P1** Add per-channel health/transport section to PDF report.
- [ ] **P1** Add topology summary to PDF/HTML report.
- [ ] **P1** Add discovery and channel metadata to complete project ZIP.
- [ ] **P1** Add schema/version metadata to ZIP manifest and `.mbcap`.
- [ ] **P1** Preserve individual CSV exports while making unified export authoritative.
- [ ] **P1** Verify formula-injection protection for all user/device-derived spreadsheet cells.
- [ ] **P1** Explicitly indicate truncation when a PDF or UI table is intentionally limited.
- [ ] **P2** Stream or chunk very large exports to avoid holding capture + XLSX + PDF + ZIP copies in memory simultaneously.
- [ ] **P2** Add deterministic export tests for filenames containing Unicode, slashes, reserved Windows names and very long project names.

---

## 13. Protocol coverage / decoder completeness

- [ ] **P1** FC43/MEI 0x0E as required by Discovery.
- [ ] **P2** Improve FC08 Diagnostics parsing for variable/subfunction-specific payloads.
- [ ] **P2** Add standard FC20 Read File Record decoding.
- [ ] **P2** Add standard FC21 Write File Record decoding.
- [ ] **P2** Add standard FC24 Read FIFO Queue decoding.
- [ ] **P2** Preserve unsupported/vendor/private FC payloads safely as unknown without inventing semantics.
- [ ] **P2** Add quantity/byte-count validation against Modbus protocol bounds before creating register/point arrays.
- [ ] **P2** Test address boundaries 0 and 65535 and maximum legal request quantities.
- [ ] **P2** Test all defined exception codes, including gateway-specific exceptions.

---

## 14. Browser/UI automated testing

The current Node tests and smoke tests are not enough to prove browser interaction correctness.

- [ ] **P1** Add Playwright (or equivalent) browser E2E tests.
- [ ] **P1** Test every navigation page loads without browser-console errors.
- [ ] **P1** Test port-card selection vs explicit connect behavior.
- [ ] **P1** Test Light/Dark/System switching and persistence.
- [ ] **P1** Test activity graph never exceeds height bounds after repeated window resizes.
- [ ] **P1** Test high-DPI resize path.
- [ ] **P1** Test RTU/TCP/mixed labels and terminology.
- [ ] **P1** Test Discovery passive inventory rendering from fixtures.
- [ ] **P1** Test active discovery safety confirmation/cancel path without transmitting in normal test mode.
- [ ] **P1** Test project switching and same-ID devices on different channels.
- [ ] **P1** Test XLSX/PDF/ZIP download controls from the UI.
- [ ] **P1** Fail CI on uncaught browser errors/unhandled promise rejections.

---

## 15. Unit / integration / fuzz test matrix

### 15.1 Identity isolation fixtures

- [ ] **P0** RTU channel A Slave 1 addr 44112 != RTU channel B Slave 1 addr 44112.
- [ ] **P0** RTU Slave 1 != TCP endpoint A Unit 1.
- [ ] **P0** TCP endpoint A Unit 1 != endpoint B Unit 1.
- [ ] **P0** Multiple TCP sessions to endpoint A Unit 1 intentionally merge device statistics but never cross-pair Transaction IDs between sessions.

### 15.2 TCP fixtures

- [ ] **P0** fragmented MBAP
- [ ] **P0** multiple ADUs per chunk
- [ ] **P0** out-of-order responses
- [ ] **P0** duplicate/reused transaction ID
- [ ] **P0** timeout with no subsequent network activity
- [ ] **P0** close with pending request
- [ ] **P0** connection reset
- [ ] **P0** upstream unavailable
- [ ] **P0** malformed Protocol ID/length
- [ ] **P0** high-throughput backpressure

### 15.3 RTU fixtures

- [ ] **P0** broadcast request with no timeout
- [ ] **P0** FC01/02 8-byte ambiguous response
- [ ] **P1** pipelined/unusual request ordering
- [ ] **P1** noise between valid frames
- [ ] **P1** truncated frames
- [ ] **P1** vendor/private FC valid CRC
- [ ] **P1** high-baud timing

### 15.4 Migration fixtures

- [ ] **P0** real v6.1 workspace -> v2 schema
- [ ] **P0** old `.mbcap` -> transport-aware capture
- [ ] **P0** corrupted workspace recovery does not overwrite original
- [ ] **P0** migration rerun is idempotent
- [ ] **P0** ambiguous old mixed-transport data remains explicitly unassigned

### 15.5 Fuzz/property tests

- [ ] **P2** fuzz RTU decoder/frame extractor with random bytes and bounded memory expectations.
- [ ] **P2** fuzz TCP MBAP stream parser with random fragmentation/corruption.
- [ ] **P2** assert parsers never crash process or allocate unbounded payloads from malformed length fields.

---

## 16. Performance / soak / scale

- [ ] **P1** Mixed RTU+TCP 24-hour soak.
- [ ] **P1** Ten+ RTU slaves with repetitive polling and deliberate timeouts.
- [ ] **P1** TCP gateway with 50+ Unit IDs.
- [ ] **P1** Multiple concurrent TCP client sessions.
- [ ] **P1** Verify memory remains bounded by configured history/transaction limits.
- [ ] **P1** Verify UI stays responsive with 10k+ transactions and thousands of discovered registers.
- [ ] **P1** Verify export behavior with maximum retained capture.
- [ ] **P2** Set explicit performance budgets for CPU, memory, page refresh and export generation.
- [ ] **P2** Add automated benchmark/regression script.

---

## 17. Desktop application production readiness

- [ ] **P0** Store project/history data under Electron `app.getPath('userData')`, not inside packaged application resources/Program Files.
- [ ] **P0** Pass an explicit writable `--data-dir` to the backend in packaged mode.
- [ ] **P0** Replace fixed backend port 8787 with safe dynamic-port selection or collision detection.
- [ ] **P0** Enforce single-instance behavior or handle multiple instances with separate ports/data locks safely.
- [ ] **P0** Ensure backend child process is terminated reliably on Windows during quit/crash/update.
- [ ] **P1** Restrict Electron navigation/window opening to the local analyzer; block unexpected external navigation.
- [ ] **P1** Make BrowserWindow background follow theme instead of being permanently dark.
- [ ] **P1** Add installer/app icons and proper version/product metadata.
- [ ] **P1** Test install, upgrade, uninstall and retained user-data behavior.
- [ ] **P1** Verify serialport native module works in the packaged app on clean Windows machines.
- [ ] **P1** Reduce installer size by avoiding unnecessary duplication of development/runtime dependencies.
- [ ] **P2** Add Windows code signing when certificate/process is available.
- [ ] **P2** Add release artifact checksum and provenance manifest.
- [ ] **P3** Auto-update only after signed releases and rollback behavior are defined.

---

## 18. CI / dependency / repository governance

- [ ] **P1** Add and commit a lockfile for reproducible root installs.
- [ ] **P1** Use `npm ci` in CI after lockfile is established.
- [ ] **P1** Add Node 24 to compatibility matrix; define when Node 20 support will end.
- [ ] **P1** Add dependency/security audit with reviewed exceptions instead of blindly using `--force` upgrades.
- [ ] **P1** Add lint/format checks for server/browser code.
- [ ] **P1** Add browser E2E job separately from fast unit tests.
- [ ] **P1** Add installer smoke test that launches the built app/backend, not only verifies NSIS build success.
- [ ] **P1** Protect `main` and require CI checks before merge; current development must not rely on unprotected direct pushes long-term.
- [ ] **P1** Add CHANGELOG/release notes and version-sync check across root and desktop package versions.
- [ ] **P2** Add test coverage reporting and minimum thresholds for protocol/runtime modules.
- [ ] **P2** Add automated stale/deprecated dependency review cadence.

---

## 19. Security review

- [ ] **P1** Threat-model local web UI, TCP proxy and import/export paths.
- [ ] **P1** Validate/escape all device/manufacturer/project strings rendered into dynamic HTML.
- [ ] **P1** Add a restrictive Content Security Policy compatible with the local UI.
- [ ] **P1** Add Origin/Host checks for mutation endpoints.
- [ ] **P1** Limit import sizes and reject zip bombs / pathological JSON structures where applicable.
- [ ] **P1** Ensure report/CSV/XLSX exports do not execute spreadsheet formulas from captured/user strings.
- [ ] **P1** Ensure proxy target configuration cannot be changed by an untrusted remote browser when web UI is non-loopback.
- [ ] **P1** Never log credentials/secrets if future authenticated TCP gateways or plugins are added.

---

## 20. Documentation / field SOP

- [ ] **P1** Update README to explain Channel -> Device identity model.
- [ ] **P1** Add RTU passive-tap wiring and electrical safety section.
- [ ] **P1** Add Modbus TCP proxy deployment diagram and limitation: proxy is inline, not a passive Ethernet tap.
- [ ] **P1** Add Discovery safety section explaining passive vs active modes.
- [ ] **P1** Add gateway topology examples.
- [ ] **P1** Add Light/Dark/System UI instructions.
- [ ] **P1** Add migration/recovery instructions for workspaces and captures.
- [ ] **P1** Add field troubleshooting: no frames, wrong baud/parity, CRC/noise, TCP target unavailable, Unit ID not responding, duplicate ID suspicion.
- [ ] **P1** Add export/handover SOP using the complete project ZIP.
- [ ] **P1** Keep a versioned site-acceptance checklist.

---

# OPTIONAL FOLLOW-ON AFTER 6.4

These items are useful but must not distract from transport correctness and Discovery.

## 21. True passive Ethernet / PCAP

- [ ] **P3** Offline PCAP import for Modbus TCP without requiring analyzer proxy placement.
- [ ] **P3** Optional live NIC capture if platform/driver privileges are acceptable.
- [ ] **P3** 5-tuple/session reconstruction and TCP retransmission handling before MBAP parsing.
- [ ] **P3** PCAP/PCAPNG export if raw packet metadata is available; do not fabricate Ethernet/IP packets from application-only proxy data.

## 22. Manufacturer knowledge library

- [ ] **P3** Signed/versioned manufacturer profiles.
- [ ] **P3** Profile confidence and compatibility metadata by model/firmware.
- [ ] **P3** User library import/export with conflict resolution.
- [ ] **P3** Keep automatic identification separate from profile suggestion so a profile match is never presented as observed Device ID proof.

---

# Release gates

## Gate A — v6.2 Transport Foundation

All must pass before Discovery work is considered merge-ready:

- [ ] Same IDs/addresses on RTU/TCP/multiple endpoints remain isolated.
- [ ] Workspace/capture migration passes fixture tests and preserves backups.
- [ ] TCP silent timeout and disconnect-with-pending-request tests pass.
- [ ] Broadcast RTU request does not create false timeout.
- [ ] Dashboard labels/mode badge are transport-correct.
- [ ] Traffic graph height is bounded and high-DPI/responsive tests pass.
- [ ] Light/Dark/System themes pass browser E2E.
- [ ] Windows/Linux unit + smoke + acceptance CI green.

## Gate B — v6.3 Discovery

- [ ] Passive RTU discovery fixture passes.
- [ ] Passive TCP gateway discovery fixture passes.
- [ ] FC43 segmented Device ID fixture passes.
- [ ] Active discovery cannot issue any write function code.
- [ ] Active RTU scan is blocked on an active production bus by default.
- [ ] Active TCP scan handles exceptions, gateway errors and Unit-ID edge cases.
- [ ] Discovery exports include channel/endpoint/device identity.
- [ ] Browser E2E and all prior CI green.

## Gate C — v6.4 Production Candidate

- [ ] 24-hour mixed RTU/TCP soak passes within memory/performance budget.
- [ ] Clean Windows packaged application starts, stores data in writable user-data path and accesses serial adapters.
- [ ] Installer upgrade preserves projects/history.
- [ ] Real hardware RTU field acceptance completed.
- [ ] Real Modbus TCP device/gateway acceptance completed.
- [ ] Complete ZIP/XLSX/PDF exports validated using real captures.
- [ ] Security review items completed or explicitly risk-accepted/documented.
- [ ] Main branch protected and release artifact produced from a green tagged commit.

---

# Recommended execution order / parallel lanes

### Lane A — Core identity & migration (blocking)

1. Channel model
2. Device key / runtime map migration
3. Workspace v2 migration
4. Capture/history migration
5. Identity regression matrix

### Lane B — TCP correctness (can run in parallel with Lane A after event schema is defined)

1. Session model
2. silent timeout timer
3. disconnect/pending handling
4. Transaction ID reuse handling
5. parser diagnostics
6. backpressure / connection limits

### Lane C — Dashboard & theme

1. semantic color tokens
2. Light/Dark/System
3. bounded DPI-aware chart
4. transport-aware labels/filtering
5. browser E2E

### Lane D — Discovery (starts only after Lane A schema is stable)

1. passive inventory/topology
2. FC43 decode
3. discovery UI
4. active TCP scan
5. active RTU safety workflow
6. export/report integration

### Lane E — Product hardening

1. persistence recovery
2. desktop writable data path / dynamic port
3. installer launch smoke
4. dependency/CI governance
5. 24-hour soak + real hardware acceptance

---

# Current definition of “remaining work complete”

The project should only be called **fully production-ready** when Gates A, B and C are all complete. Until then, v6.1 remains a capable RTU/TCP engineering analyzer, but the remaining work above is required to make mixed-transport identity, Discovery, UI/theme behavior, persistence, desktop packaging and field edge cases professionally reliable.
