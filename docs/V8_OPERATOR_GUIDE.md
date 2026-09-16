# Modbus Engineering Workbench v8 — Operator Guide

**Product:** Modbus Engineering Workbench  
**Release line:** v8.0.0  
**Audience:** commissioning engineers, controls engineers, test engineers, support engineers and trained operators  
**Safety rule:** use live writes, raw transmission and LAB/fault-injection functions only on equipment and networks where you are authorized to transmit.

This guide is the operational companion to `V8_IMPLEMENTATION_STATUS.md`, `SECURITY.md`, `AUTOMATION_SAFETY.md`, `DIGITAL_TWIN_SAFETY.md`, `LOCAL_MAC_RELEASE_GATE.md` and `SITE_ACCEPTANCE.md`.

## 1. Getting started

Install the locked dependencies and start the v8 Workbench:

```bash
npm ci
npm start
```

`npm start` launches the v8 runtime (`src/index-v8.js`). v7 remains available only as an explicit compatibility command:

```bash
npm run v7
```

Useful development/commissioning validation commands are:

```bash
npm run version:check
npm run quality
npm test
npm run smoke
npm run acceptance
npm run e2e
```

For the exact software release gate on a clean Mac checkout, use:

```bash
npm run release:gate:mac
```

That command is stricter than the individual development checks: it validates Node 20/22/24, quality/audit, bounded scale/soak, browser E2E and exact-head integrity and retains evidence under `.release-evidence/`.

For CLI automation, inspect the supported commands first:

```bash
npm run v8:cli -- --help
```

The Workbench stores project configuration separately from live transport ownership. A project reopen must not restore a connection owner, an armed write latch or LAB/fault-injection state.

## 2. Main workspaces

The v8 shell exposes the following engineering workspaces:

- **Connections** — create, import, export, open, close and inspect transport profiles.
- **Master** — one-shot requests, poll jobs and guarded writes.
- **Simulator** — virtual devices, memory maps, generators and LAB-only fault injection.
- **Traffic** — unified Tx/Rx/error/state/test/discovery evidence.
- **Register Lab** — datatype, byte/word order, scaling, units and engineering interpretation.
- **Test Center** — validated requests, raw-frame work and repeatable recipes.
- **Charts / Historian** — bounded live trends, logging and time-range history.
- **Discovery** — read-only device/address discovery and evidence handoff.
- **Automation** — loopback-first API/CLI/SDK workflows.
- **HMI** — operator screens bound to project tags/registers through the central safety path.
- **Settings** — safe visual preferences such as theme and density.

Use **Ctrl+K** on Windows/Linux or **Cmd+K** on macOS to open the command palette. Workspace document tabs support Left/Right Arrow, Home and End keyboard navigation.

## 3. Connection modes

Connection profiles are configuration records; opening a profile creates the live runtime ownership state.

Supported connection families include:

- Serial RTU
- Serial ASCII
- Modbus TCP client/server
- Modbus UDP client/server
- RTU over TCP/UDP
- ASCII over TCP/UDP
- TLS client/server
- Virtual transport

### Serial guidance

Confirm the correct port, baud rate, parity, data bits and stop bits before opening a bus. Serial resources are exclusively owned by the Connection Broker; two incompatible live modes cannot silently share the same serial resource.

For production RS485 wiring, software validation is not enough. Polarity, termination, biasing, isolation, grounding, adapter behavior and noise must be checked under `SITE_ACCEPTANCE.md`.

### Network guidance

For client connections, verify the target host/port and selected local interface. The Connection Center may recommend an interface based on address family/subnet, but the operator remains responsible for selecting the intended plant network.

For server/listener modes, bind only to interfaces intended for the engineering task. Avoid exposing a listener outside the required local/plant network.

## 4. Modbus addressing and data formats

The Workbench uses a **canonical zero-based internal address**. Display notation can be adjusted without changing the stored address.

When interpreting registers, record all of the following rather than only the displayed value:

- function/memory area
- canonical address
- quantity
- signed/unsigned type
- 16/32/64-bit width
- float/integer/string/BCD/timestamp interpretation
- byte and word order
- scale and offset
- engineering unit
- source/provenance

Register Lab is the preferred place to compare alternate interpretations. Do not convert an inference into a confirmed definition without device documentation, controlled testing or repeatable evidence.

## 5. Master polling

Create poll jobs under the intended connection and Unit/Slave ID. Configure interval, timeout and retry values appropriate for the real device and bus.

Operational rules:

1. Start conservatively, especially on shared serial buses.
2. Do not allow a slow/dead device to drive an unnecessarily aggressive retry rate.
3. Use Traffic evidence to confirm request/response pairing and timing.
4. Use Register Lab for engineering interpretation rather than changing raw protocol evidence.
5. Pause or stop jobs before changing transport ownership or performing maintenance that requires exclusive access.

Unit ID `0` broadcast semantics are write-specific. A request that requires a response must not be treated as a no-response broadcast.

## 6. Write safety

Live writes are deliberately harder than reads.

- Writes are **disabled by default** for every new/restored live connection.
- Enabling writes is **per connection**.
- Closing/reopening or restarting returns the connection to the locked state.
- Replay/offline sources cannot execute live writes.
- Bulk/write-sensitive functions require stronger confirmation.
- HMI operations that resolve to effective FC16/multi-register writes require explicit bulk confirmation as well as the normal operator confirmation.
- Confirmed write/test transmissions produce audit evidence with target, channel/connection, timestamp and raw Tx/Rx evidence where applicable.

If a serial write is transmitted but the outcome cannot be determined, the Workbench reports `TRANSMISSION_OUTCOME_UNKNOWN`, places the connection into an error/safety state and re-locks writes until the connection is closed/reopened.

Never use a production plant write as an exploratory probe when a virtual simulator or controlled test device can answer the same engineering question.

## 7. Discovery

Discovery is read-only and cannot inherit Master write permission.

Use the FC43/device-identification path first where supported, then controlled read-only fallback scans. Configure range, rate and timeout to match the bus. On RTU, use the maintenance/exclusive-bus interlock before active scanning a production-connected serial line.

Important classification rule: **silence is not proof of a device**. Preserve exception, timeout and raw evidence when deciding whether an address is confirmed.

Selected discovery results can be adopted into project/Master workflows while preserving channel/device identity.

## 8. Simulator and LAB mode

The Simulator supports multiple Unit/Slave IDs, Modbus memory areas, dynamic value generators and standard exception behavior.

Use it for:

- PLC/HMI development before real hardware is available
- Master regression testing
- register-map validation
- deterministic recipe testing
- digital-twin drafts

Fault injection is a separate **LAB** capability. It can model delay/jitter, dropped responses, exceptions, disconnects and malformed/truncated/late behaviors. LAB fault injection must never be enabled through a production proxy/passive channel.

Dynamic generator definitions are resource-bounded and formulas use the restricted expression parser rather than arbitrary JavaScript execution.

## 9. Traffic and Register Lab

Traffic is the evidence layer. Use filters to isolate connection, direction, device, function, error or test context without changing captured protocol bytes.

When troubleshooting, follow this sequence:

1. Confirm the expected connection/owner mode.
2. Confirm exact Tx bytes.
3. Confirm whether a response arrived and how it was paired.
4. Review exception/timeout/timing state.
5. Only then interpret register payloads in Register Lab.

This avoids treating a datatype/scaling mistake as a communication failure or vice versa.

Traffic and Register Lab use bounded/virtualized presentation so large retained datasets do not require one rendered DOM row per retained item.

## 10. Test Center and recipes

Use normal validated requests for ordinary device testing. Raw/custom frames are intentionally separated from validated production requests.

Raw/LAB transmission requires explicit operator awareness because malformed bytes can trigger unexpected behavior in third-party devices.

Recipes provide repeatable engineering tests with variables, reads, guarded writes, delays/waits, assertions, repeats/conditions and evidence. Recipe nesting and expanded execution are bounded before connection/session acquisition so imported recipes cannot create unbounded execution work before safety validation.

Before executing a recipe against live plant equipment:

- review every write/raw step
- verify the selected connection and Unit ID
- confirm ranges and timeouts
- confirm teardown behavior
- use the simulator first where practical

## 11. Charts, Logger and Historian

Charts are for operator visibility; raw Traffic remains the protocol evidence source.

Use bounded time windows/decimation for long histories. Logger/Historian profiles should be sized for the intended sampling interval and retention period. Storage errors must be treated as data-quality issues rather than silently ignored.

The SQLite historian is opened lazily so projects that do not configure historian use do not create unnecessary database handles. Historian is enabled by default for a logger profile unless that profile explicitly sets `historian: false`.

For handover, export the required bounded history range instead of copying a live database file while it is actively being written.

## 12. HMI Builder

HMI screens provide operator views/actions on top of the same project/runtime model; they are not a separate bypass path.

- Live reads use project bindings.
- Write widgets use the central Master write-lock/audit path.
- Effective multi-register/FC16 writes require the same explicit bulk confirmation policy as equivalent Master operations.
- Unsaved HMI edits must be saved before entering Run mode so the browser/runtime cannot act on a definition different from the persisted backend screen.
- Leaving run/active views stops workspace polling where applicable.

Before handing an HMI screen to an operator, verify every write binding, Unit ID, address, datatype and engineering scale against a controlled source.

## 13. TLS and certificates

TLS transport must fail closed; it must not silently downgrade to plain TCP.

Verify:

- CA trust source
- server certificate and hostname/SNI
- certificate validity/expiry
- client certificate/key where required
- mutual-TLS policy for server mode

Private-key material must not be copied into reports, normal logs or project handover bundles. Persistent desktop diagnostics and handover exports redact known credential/private-key material; engineering path/reference identity is retained where needed.

External TLS interoperability still requires testing against representative endpoints/certificate policies used at the customer site.

## 14. Automation, REST/WebSocket, CLI and SDK

Automation follows the same ownership/write/audit policy as the UI. It is not a privileged bypass.

Prefer loopback/local access unless remote automation is explicitly engineered and secured. Browser mutation requests are same-origin protected and bounded by rate/body limits; browser realtime WebSocket handshakes are same-origin and bounded by client/payload limits. Legitimate non-browser local SDK/automation calls without a browser Origin header remain supported by the local API policy.

Before scripting a write workflow, prove the equivalent operation manually against a simulator or controlled device, then preserve the resulting audit/evidence expectations in the automation.

## 15. Projects, templates and migration

Project clone/Save As and templates copy engineering configuration, not live armed state. A project switch is blocked while a connection is active.

v7-to-v8 migration is explicit and preserves the original source/backup/report path rather than silently rewriting legacy data. After migration, verify the exact connection/channel identity of devices that shared Unit IDs across different physical/logical channels.

Connection import is preflighted as a complete set. A failed import rolls back instead of leaving a partially applied connection inventory. Imported metadata/options are sanitized so credential/private-key material is not persisted as arbitrary profile data; legitimate certificate/key path references remain configuration references.

## 16. Reports and engineering handover

The v8 handover bundle can include project configuration plus bounded Master/write-audit/Traffic/Simulator/Recipe/Historian/Chart/Logger/HMI/Digital-Twin material where available.

Release/handover protections include:

- SHA-256 manifest entries
- product/version/schema metadata
- channel/device/register identity preservation
- spreadsheet formula-injection protection
- Windows-safe generated filenames
- known credential/private-key redaction while preserving engineering identity/typed evidence

Always review the manifest and project identity before delivering a bundle to another site/customer.

## 17. Troubleshooting matrix

| Symptom | First checks |
| --- | --- |
| Serial device silent | port ownership, A/B polarity, baud/parity, Unit ID, termination/biasing, Traffic Tx bytes |
| TCP connects but no valid response | host/port, Unit ID, MBAP/TID pairing, device function support, Traffic exception evidence |
| Values look impossible | datatype width, signedness, byte/word order, scale/offset, canonical address |
| Polling becomes slow | timeout/retry, dead device, serial inter-request delay, TCP concurrency, excessive job rate |
| Write control unavailable | live connection state, owner mode, write latch, replay/offline state, safety re-lock after unknown outcome |
| Discovery finds nothing | FC43 support, scan range/rate, exclusive-bus condition, exceptions vs silence |
| Historian has gaps | logger profile, storage/disk errors, retention, sampling interval, connection quality |
| HMI write rejected | saved screen state, central write lock, confirmation, effective FC16 bulk confirmation, binding/address validity |
| TLS connection fails | CA trust, hostname/SNI, expiry, client cert/key, mTLS policy; do not downgrade to TCP |
| Imported project/profile rejected | schema/version, size/count bounds, duplicate IDs, unsupported source channel/transport |

## 18. Release and field acceptance boundary

The primary software release validation path is a direct local Mac execution from a clean checkout of the exact release head:

```bash
npm run release:gate:mac
```

The gate requires and records:

- exact starting/ending Git SHA equality
- clean repository state before and after validation
- version consistency
- lint and recursive v8 syntax checks
- runtime dependency audit
- Node 20 / 22 / 24 full test/smoke/acceptance suites
- bounded v8 scale benchmark
- v7 compatibility benchmark
- bounded concurrent v8 soak
- Chromium browser E2E
- lockfile SHA-256 evidence

A PASS is valid only for the exact head that produced it. Any later source commit requires the complete gate to run again.

GitHub Actions validation is manual-only and optional. The existing Automatrix Mac runner documented in another repository is repository-scoped there and cannot run this repository unless a separate/organization-scoped runner registration is configured.

The following remain separate target/field evidence and must not be claimed from the local software gate alone:

- real RS485 electrical/noise/termination acceptance
- representative PLC/inverter/meter interoperability
- representative external TLS/certificate interoperability
- 24-hour/long-duration plant or virtual soak evidence
- clean Windows installer execution and customer driver/security-policy acceptance
- production code signing when a real signing certificate/private key is supplied

Use `LOCAL_MAC_RELEASE_GATE.md` for exact software evidence and `SITE_ACCEPTANCE.md` for field evidence.

## 19. Minimum handover checklist

Before declaring a software build ready for controlled site acceptance:

- exact release commit identified
- root/desktop package and lockfile version surfaces are 8.0.0
- local Mac `summary.txt` reports `status=PASS`
- local Mac `start_head == end_head == current release head`
- no later commit supersedes the PASS evidence
- no known open P0 software defect
- write state confirmed locked by default
- required project/profile/report bundle exported and manifest reviewed
- field-only gates explicitly listed as pending rather than silently assumed

A successful software release is the start of controlled field acceptance, not a substitute for it.
