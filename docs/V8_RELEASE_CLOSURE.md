# Modbus Engineering Workbench v8 — Release Closure Ledger

**Product:** Modbus Engineering Workbench  
**Release candidate:** 8.0.0  
**Integration branch:** `v8-release-completion`  
**Integration PR:** #31  
**Audit date:** 2026-09-16

## Purpose

`V8_MASTER_TODO.md` is the original planning inventory. Its historical checkboxes are intentionally not treated as the current source of truth because large parts of the plan were implemented in stacked work packages without rewriting every planning checkbox.

The authoritative release-state documents are now:

1. `V8_IMPLEMENTATION_STATUS.md` — implemented work packages and enforced safety invariants.
2. **This file** — release closure evidence and the exact remaining acceptance boundary.
3. `V8_OPERATOR_GUIDE.md` — supported operator/commissioning workflow.
4. `DESKTOP_DIAGNOSTICS.md` — desktop data, upgrade and support diagnostics.
5. `SITE_ACCEPTANCE.md` — real equipment/field evidence that software CI cannot manufacture.

Unchecked items in the historical master TODO must therefore be reconciled against this ledger before being called a missing product feature.

## Software implementation closure

The core v8 product implementation is complete on the release-candidate branch for the planned WP-01 through WP-18 scope described in `V8_IMPLEMENTATION_STATUS.md`.

Implemented software areas include:

- shared Modbus protocol/framing/data core
- Connection Broker and transport ownership
- virtual, TCP, serial RTU/ASCII, UDP, tunnelling and TLS transports
- Master one-shot requests and cyclic polling
- guarded writes and immutable write evidence
- multi-device Slave/Simulator and LAB-only fault injection
- read-only Discovery and adoption workflow
- unified Traffic timeline and Register Lab
- Test Center/raw-frame workflow and recipes
- Charts, rotating logger and SQLite Historian
- capture-to-Digital-Twin draft/approval flow
- REST/WebSocket/CLI/SDK automation surfaces
- HMI Builder with central write-safety integration
- project migration, clone/Save As and templates
- reports/handover bundles with identity preservation, SHA-256 manifests, spreadsheet/filename protection
- v8 default runtime and Electron desktop shell

## Release-safety closure

The following invariants are software-enforced and regression covered:

- Passive Analyzer/replay cannot acquire transmit capability implicitly.
- Discovery is read-only and cannot inherit Master write permission.
- Serial resources have exclusive active ownership through the Connection Broker.
- Live write permission is per connection, locked by default and not restored armed after restart/import/reopen.
- Raw/Test/LAB workflows remain separate from normal validated production requests.
- Strong confirmation is required for bulk/write-sensitive operations; HMI FC16 has explicit bulk confirmation.
- Confirmed transmissions retain bounded evidence/audit context.
- Indeterminate serial writes re-lock the connection and surface `TRANSMISSION_OUTCOME_UNKNOWN`.
- Import applies as a validated set and rolls back on failure rather than leaving partial runtime state.
- Cross-site browser mutations, oversized bodies and excessive mutation rates are rejected.
- Project switching is blocked while live connection ownership exists.
- TLS transport fails closed rather than silently downgrading to plain TCP.

## UI / accessibility closure

The release candidate now includes:

- command palette / quick-open
- semantic workspace document tabs with ARIA tab roles
- roving tab focus and Left/Right/Home/End keyboard navigation
- Connection Center rows focusable from the keyboard
- Enter/Space selection and Up/Down/Home/End table-row keyboard navigation
- visible `:focus-visible` focus treatment
- reduced-motion handling
- Light/Dark core text/accent contrast regression checks at WCAG AA normal-text threshold
- status labels that include text rather than color-only meaning
- Chromium E2E coverage at 1366×768 and 1920×1080
- HiDPI browser configuration and document-level horizontal-overflow assertion
- intentional virtualized Traffic row rendering using a scroll spacer/window rather than rendering the full retained list

## Scale / performance closure

`npm run benchmark:v8` and `test/v8-scale-regression.test.js` provide a bounded release regression using real v8 services. The gate covers at least:

- 100 cyclic poll-job definitions and forced request completion
- 100 simulated Modbus Unit IDs
- 100 isolated device channels
- 10,000 Register Lab points created from real v8 RTU request/response codec paths
- 100,000 retained Traffic events
- bounded 5,000-row Traffic query
- Traffic error filtering
- elapsed-time and heap ceilings

The Traffic browser workspace already uses row-window virtualization: the scroll spacer represents the full result length while only the visible slice plus overscan is rendered.

Charts keep bounded document points and support min/max decimation for requested render/query budgets.

## Concurrent software-soak closure

`npm run soak:v8` exercises a real concurrent v8 virtual workload:

- Virtual RTU Slave with multiple Unit IDs
- MasterEngine
- PollScheduler
- TrafficTimelineService
- RegisterLabService
- ChartService

Master Tx/Rx evidence feeds Traffic and Register Lab, while Register Lab point updates feed live chart samples. The harness verifies poll success/failure counts, Tx/Rx evidence, per-device Register Lab coverage, per-device chart samples and a heap ceiling.

A short form is included in `npm test` through `test/v8-concurrent-soak.test.js`. The same harness accepts a long `--seconds` value for extended local execution.

A **24-hour execution result is not claimed by source code alone**. That is an extended acceptance run and must retain actual run evidence.

## Desktop / packaging closure

Source-level desktop release work now includes:

- v8 backend entry point and `/api/v8/status` readiness
- loopback-only local backend binding
- dynamic local backend port
- navigation/window restrictions
- single-instance behavior
- persistent user data under Electron `userData`
- non-destructive legacy data migration policy
- persistent desktop/backend/crash diagnostics at `<userData>/logs/workbench-desktop.log`
- Windows packaging workflow pointed at Workbench v8 rather than the old v7 health endpoint
- release provenance file and SHA-256 checksum generation
- Workbench v8 artifact naming

Actual NSIS execution, clean-Windows launch, Defender/firewall behavior and code signing remain target-Windows acceptance rather than Mac software-CI claims.

## Operator/documentation closure

`V8_OPERATOR_GUIDE.md` consolidates:

- Getting Started
- connection modes
- address notation and register formats
- Master polling
- write safety
- Discovery
- Simulator/LAB fault injection
- Traffic/Register Lab
- Test Center/recipes
- Charts/Logger/Historian
- HMI Builder
- TLS/certificates
- Automation/API/CLI/SDK
- projects/migration
- reports/handover
- troubleshooting matrix
- release/field boundary

`DESKTOP_DIAGNOSTICS.md` documents desktop data migration, support logs and Windows acceptance evidence.

## Exact software release gate

The repository release validation is configured for the existing Automatrix Apple-silicon self-hosted runner labels:

```text
self-hosted
macOS
ARM64
automatrix-ci
automatrix-mac
```

The **exact final PR head** must pass:

- 8.0.0 version consistency
- lint
- recursive v8 syntax checks
- runtime dependency audit
- Node.js 20 full test/smoke/acceptance suite
- Node.js 22 full test/smoke/acceptance suite
- Node.js 24 full test/smoke/acceptance suite
- bounded v8 scale regression included in `npm test`
- bounded concurrent v8 soak regression included in `npm test`
- Chromium browser E2E including desktop viewport/keyboard checks

PR #31 must not be merged on `mergeable=true` alone because `main` has no branch-protection gate enforcing these checks.

## Remaining extended / external acceptance

These items are intentionally **not** described as missing source implementation. They require duration, target OS, external software, credentials or physical equipment:

### Extended local acceptance

- 24-hour v8 virtual/TCP soak with retained run logs
- multi-hour Historian/logger disk-growth and retention observation
- project export/reopen verification after long-duration soak
- extended socket/handle/reconnect observation

### External interoperability

- representative PLC
- representative inverter
- representative power meter
- TCP-to-RTU gateway with multiple Unit IDs
- third-party Modbus Master/Slave tools where licensing/environment permits
- representative external TLS servers/certificate policies

### Physical field acceptance

- RS485 polarity, termination, bias, isolation, grounding and noise qualification
- serial adapter/driver timing on actual hardware
- site traffic/load soak
- customer network/security policy acceptance

### Target Windows acceptance

- NSIS installer build and launch on a clean Windows target
- uninstall/reinstall preservation under the selected installer policy
- Windows Defender/firewall/network-bind behavior
- target serial-driver compatibility
- production code signing when a real signing certificate/private key is supplied

## Release decision

Once the exact final release head passes the configured self-hosted Mac software gate, the source/software release candidate can be merged to `main`.

The extended and external items above remain explicitly tracked as acceptance evidence. They must not be silently converted into software-CI passes, and they do not justify reopening already-implemented core work packages unless their real execution finds a defect.
