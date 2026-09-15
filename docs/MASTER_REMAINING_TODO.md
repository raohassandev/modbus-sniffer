# Modbus Engineering Analyzer — v7 Release Closure Ledger

**Release:** v7.0.0  
**Closure date:** 2026-09-15  
**Status:** software scope complete; remaining items are external hardware/release-environment acceptance gates.

This file supersedes the earlier v6.1/v6.2/v6.3 implementation backlog. The planned transport, persistence, Discovery, intelligence, UI, export, desktop and CI work has been implemented in v7.0.0. Items that require real equipment, plant wiring, long-duration operation, signing credentials or repository-administration permissions are intentionally not marked as software defects.

## Release invariants — COMPLETE

- [x] RTU buses and TCP endpoints use transport-aware channel/device identity; equal Unit/Slave IDs on different channels do not share device/register/poll state.
- [x] Passive RTU capture remains receive-only by default.
- [x] TCP analyzer mode is an inline forwarding proxy and preserves production Modbus bytes.
- [x] Active discovery is explicit, guarded and read-only; write function codes are not used for discovery.
- [x] Workspace/capture/history migration paths retain channel/device identity and preserve ambiguous legacy mappings instead of silently guessing.
- [x] Workspace corruption is surfaced and preserved rather than silently replaced by an empty workspace.
- [x] Replay preserves source timing metadata separately from replay/display speed.
- [x] UI operating-mode labels distinguish RTU passive, TCP proxy, discovery, replay/offline and mixed-transport use.
- [x] P0/P1 implementation areas have automated regression coverage in the CI suite.

## v7 software work — COMPLETE

### Transport and runtime

- [x] First-class RTU/TCP channels and canonical `deviceKey` isolation.
- [x] Channel/device-aware registers, polls, timeouts, exceptions, traffic, engineering data and history.
- [x] TCP session tracking, TID pairing, timeout/close handling, malformed MBAP diagnostics, connection-state reporting and safer proxy lifecycle.
- [x] RTU edge-case hardening including broadcast/no-response handling, quantity/byte-count validation and ambiguity regressions.
- [x] Transport-specific health metrics with no misleading RTU utilization shown as TCP health.

### Persistence and migration

- [x] Workspace schema v2 migration with backup/report behavior and Legacy / Unassigned handling.
- [x] Atomic workspace writes and corruption preservation/recovery path.
- [x] Versioned transport-aware capture metadata and replay timing separation.
- [x] Channel-aware history with retention/rotation and partial-record recovery hardening.

### Dashboard and UI

- [x] Transport-aware Dashboard/status terminology.
- [x] Bounded responsive HiDPI traffic chart.
- [x] Light / Dark / System themes with persisted choice.
- [x] Transport/channel filters and RTU Slave-ID vs TCP Unit-ID terminology.
- [x] Discovery, Engineering, History, Modbus TCP, Reports and v7 Intelligence workspaces integrated into the main UI.

### Discovery and reverse engineering

- [x] Passive RTU/TCP discovery and topology.
- [x] FC43 / MEI 0x0E Device Identification decoding, including segmented identity responses.
- [x] Guarded read-only active discovery for RTU and TCP.
- [x] Persistent discovery evidence and auditable identity adoption into the exact project channel/device.
- [x] Automatic register interpretation hypotheses, polling-cycle reconstruction, fingerprints, relationships, anomalies and capture comparison.

### Engineering and exports

- [x] Transport-aware engineering mappings and reusable profiles.
- [x] Datatype/byte-order validation, overlap checks and exact 64-bit handling.
- [x] XLSX, PDF, raw capture and complete ZIP handover exports.
- [x] Channels, Discovery, Adoption Audit and Project History included in the unified handover outputs.
- [x] CSV/XLSX formula-injection hardening and Windows-safe export filenames.

### Quality, security and release engineering

- [x] Reproducible root and desktop npm lockfiles.
- [x] CI installs with `npm ci`.
- [x] ESLint and release-version consistency checks.
- [x] Runtime dependency audit gate.
- [x] Deterministic parser fuzz/regression coverage and extended Modbus function validation.
- [x] Windows/Linux Node compatibility matrix.
- [x] Browser E2E gate.
- [x] v7 performance/memory benchmark gate.
- [x] Windows NSIS packaging workflow.
- [x] Packaged Windows application smoke-launch check against the v7 backend health endpoint.
- [x] Build provenance and SHA-256 checksum generation for Windows artifacts.
- [x] Security, export, site-acceptance and v7 intelligence documentation.
- [x] Temporary lockfile-generation workflow removed after reproducible lockfiles became part of the repository.

## Automated release gates

The repository CI is expected to run the following gates on supported Node versions/platforms:

```text
npm ci
npm run version:check
npm run lint
npm audit --omit=dev --audit-level=high
npm test
npm run smoke
npm run acceptance
npm run e2e
node scripts/benchmark-v7.js --cycles 25000 --min-fps 500 --max-heap-mb 384
```

The Windows desktop workflow additionally builds the NSIS installer, launches the packaged application, waits for the local v7 `/api/status` endpoint, and writes build provenance plus SHA-256 checksums.

## External validation gates — NOT SOFTWARE BLOCKERS

These cannot be truthfully completed by repository code or hosted CI alone. They remain release/site acceptance activities:

- [ ] **Real RS485 electrical acceptance** — verify actual A/B polarity, termination, biasing, isolation, adapter behavior, noise and passive high-impedance tapping on production hardware.
- [ ] **Real Modbus TCP equipment acceptance** — verify the inline proxy against the actual PLC/SCADA/gateway/inverter/meter network and production timing.
- [ ] **Windows field-PC acceptance** — verify the target customer's USB/serial drivers, installer upgrade path, uninstall/reinstall behavior and local security policy.
- [ ] **Representative long-duration site soak** — run the analyzer on a real plant workload for the required operating period (recommended 24 h or project-specific duration) and review memory, reconnects, timing and export integrity.
- [ ] **Production code signing** — sign the Windows installer/executable when an actual code-signing certificate/private key and CI secret are supplied.
- [ ] **Repository branch/ruleset enforcement** — enable required checks/review policy using repository administration permissions if desired.

## Field acceptance commands

For software-side validation before going to site:

```powershell
npm ci
npm run quality
npm test
npm run smoke
npm run acceptance
npm run e2e
```

For a real site with a known minimum device/frame expectation:

```powershell
npm run field-check -- --min-devices 10 --min-frames 500
```

For a longer engineering soak:

```powershell
npm run soak
```

The site team must retain the resulting captures, reports and acceptance evidence with the project handover.

## Final release decision

**v7.0.0 software implementation: COMPLETE.**

The repository is ready for controlled field acceptance. Do not label the physical installation "site accepted" until the applicable external gates above have been performed on the actual hardware/environment.
