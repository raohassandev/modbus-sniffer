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
3. `LOCAL_MAC_RELEASE_GATE.md` — exact local Mac software gate and evidence procedure.
4. `V8_OPERATOR_GUIDE.md` — supported operator/commissioning workflow.
5. `DESKTOP_DIAGNOSTICS.md` — desktop data, upgrade and support diagnostics.
6. `SITE_ACCEPTANCE.md` — real equipment/field evidence that software validation cannot manufacture.

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
- capture-to-Digital-Twin draft/approval flow with conflict-safe atomic apply
- REST/WebSocket/CLI/SDK automation surfaces
- HMI Builder with central write-safety integration and effective bulk-write confirmation
- project migration, clone/Save As and templates
- reports/handover bundles with identity preservation, SHA-256 manifests, spreadsheet/filename protection and credential redaction
- v8 default runtime and Electron desktop shell

## Release-safety closure

The following invariants are software-enforced and regression covered:

- Passive Analyzer/replay cannot acquire transmit capability implicitly.
- Discovery is read-only and cannot inherit Master write permission.
- Serial resources have exclusive active ownership through the Connection Broker.
- Live write permission is per connection, locked by default and not restored armed after restart/import/reopen.
- Raw/Test/LAB workflows remain separate from normal validated production requests.
- Strong confirmation is required for bulk/write-sensitive operations; HMI effective FC16 has explicit bulk confirmation.
- Confirmed transmissions retain bounded evidence/audit context.
- Indeterminate serial writes re-lock the connection and surface `TRANSMISSION_OUTCOME_UNKNOWN`.
- Import applies as a validated set and rolls back on failure rather than leaving partial runtime state.
- Cross-site browser mutations, oversized bodies and excessive mutation rates are rejected.
- Browser WebSocket handshakes are same-origin; no-Origin local SDK/automation WebSockets remain supported.
- Realtime WebSockets have bounded inbound payload size and client count.
- Project switching is blocked while live connection ownership exists.
- TLS transport fails closed rather than silently downgrading to plain TCP.
- Handover files redact known credential/private-key fields without removing engineering identity fields.
- Persistent desktop logs redact JSON/key-value credentials and accidental PEM private-key blocks.
- Recipe execution is bounded before transport acquisition: default maximum 10,000 expanded executable steps and repeat nesting depth 8.
- Raw-frame repeat remains explicitly bounded.
- Simulator formulas use a restricted parser/RPN evaluator rather than arbitrary JavaScript execution.
- Simulator dynamic generators are bounded by generator count, schedule-step count and formula length.
- Digital Twin apply refuses unrelated target-server collisions and restores the previous generated topology if a partial apply fails.

## UI / accessibility closure

The release candidate includes:

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
- virtualized Traffic row rendering using a scroll spacer/window
- Register Lab 10,000-point query support with virtualized visible-window rendering and keyboard navigation across the virtual window
- HMI Run-mode prevention when the screen has unsaved edits
- UI/backend agreement on effective multi-register FC16 confirmation

## Scale / performance closure

`npm run benchmark:v8` and `test/v8-scale-regression.test.js` provide a bounded release regression using real v8 services. The gate covers at least:

- 100 cyclic poll-job definitions and forced request completion
- 100 simulated Modbus Unit IDs
- 100 isolated device channels
- 10,000 Register Lab points created from real v8 RTU request/response codec paths
- 100,000 retained Traffic events
- bounded Traffic query
- Traffic error filtering
- elapsed-time and heap ceilings

Traffic and Register Lab browser workspaces use virtual row windows so retained engineering datasets do not require one DOM node per retained row.

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

A **24-hour execution result is not claimed by source code alone**. That remains extended acceptance evidence.

## Desktop / packaging closure

Source-level desktop release work includes:

- v8 backend entry point and `/api/v8/status` readiness
- loopback-only local backend binding
- dynamic local backend port
- navigation/window restrictions
- single-instance behavior
- persistent user data under Electron `userData`
- non-destructive legacy data migration policy
- persistent desktop/backend/crash diagnostics at `<userData>/logs/workbench-desktop.log`
- credential/private-key redaction before persistent desktop log writes
- Windows packaging workflow pointed at Workbench v8 rather than the old v7 health endpoint
- release provenance file and SHA-256 checksum generation
- Workbench v8 artifact naming

The Windows packaging workflow is **manual-only**. It does not run automatically on merge and therefore cannot silently consume GitHub-hosted runner minutes. Actual NSIS execution, clean-Windows launch, Defender/firewall behavior and code signing remain target-Windows acceptance.

## Release metadata closure

The release metadata is synchronized to **8.0.0** across:

- root `package.json`
- root `package-lock.json`
- desktop `package.json`
- desktop `package-lock.json`
- `src/v8/version.js`

The lockfile synchronization commit changed only the four intended root-version lines. The temporary hosted bootstrap and self-modifying release helper have been removed. Unrelated lockfile dependencies, integrity hashes and package metadata must not be regenerated merely for release version closure.

## Exact software release gate

The authoritative gate is executed directly on the MacBook:

```bash
npm run release:gate:mac
```

The script creates ignored evidence under `.release-evidence/` and validates the exact starting Git SHA. It requires:

- clean macOS checkout
- Node.js 20 full tests/smoke/acceptance
- Node.js 22 full tests/smoke/acceptance
- Node.js 24 full tests/smoke/acceptance
- 8.0.0 version consistency
- lint
- recursive v8 syntax checks
- bounded v8 scale benchmark
- v7 compatibility benchmark
- runtime dependency audit
- bounded concurrent v8 soak
- Chromium browser E2E
- unchanged exact HEAD through completion
- unchanged tracked files through completion
- lockfile SHA-256 evidence

A release gate is valid only if `summary.txt` reports `status=PASS`, its `start_head` equals `end_head`, and that same SHA is still the current PR #31 head. A new commit invalidates older evidence and requires a complete rerun.

`docs/LOCAL_MAC_RELEASE_GATE.md` is the detailed execution procedure.

## GitHub Actions boundary

`.github/workflows/test.yml` is retained only as a **manual optional self-hosted** validation path. It has no automatic push or pull-request trigger.

The existing `automatrix-macbook-01` runner from the `automatrix-engineering` project is repository-scoped to `raohassandev/automatrix-engineering`. Matching labels (`self-hosted`, `macOS`, `ARM64`, `automatrix-ci`, `automatrix-mac`) do not make it available to `modbus-sniffer`.

If GitHub self-hosted execution is wanted later, a runner must be registered for `raohassandev/modbus-sniffer` or at an organization scope that permits this repository. That is optional and is not required to execute the local Mac gate.

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

## Remaining software release evidence

The source-side release metadata and release-gate implementation are complete. The remaining software release evidence is an **actual PASS execution** of `npm run release:gate:mac` on the exact final PR head.

PR #31 must not be merged on `mergeable=true` alone because `main` has no branch-protection gate enforcing this local evidence.

No local Mac PASS is claimed by this document until the actual evidence set exists and matches the exact PR head.

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

Once the **exact final PR head** has a valid local Mac release-gate PASS evidence set, the source/software release candidate can be merged to `main`.

The extended and external items above remain explicitly tracked as acceptance evidence. They must not be silently converted into software-validation passes, and they do not justify reopening already-implemented core work packages unless their real execution finds a defect.
