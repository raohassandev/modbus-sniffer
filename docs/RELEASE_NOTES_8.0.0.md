# Modbus Engineering Tool 8.0.0 — Release Notes

**Release track:** unified Modbus engineering product  
**Release branch:** `v8-release-completion`  
**Primary runtime:** `src/index-v7.js`

## What ships

Version 8.0.0 consolidates the product into one Modbus-only engineering application with three primary operating modes:

- **Sniffer / Analyzer** — passive RX-only Modbus observation and reverse engineering.
- **Master / Client** — active RTU/ASCII/TCP polling, diagnostics and guarded writes.
- **Slave / Server Simulator** — multi-Unit simulation with standard and advanced Modbus transports.

Supporting engineering workspaces include Traffic and Protocol Diagnostics, Register/Data Lab, Discovery, Raw Frame/Conformance Lab, Device Clone, Test Sequences, Logger/Trend, Replay/Compare, Transport Lab, and Modbus TCP Security/TLS diagnostics.

## Safety model

- Sniffer remains passive and does not fabricate Modbus requests.
- Active serial ownership changes require explicit takeover.
- Master writes are locked by default and automatically re-lock.
- Bulk and broadcast writes require stronger confirmation.
- Rejected unsafe writes are audited as not transmitted.
- Raw malformed traffic and simulator fault injection require explicit LAB arming.
- Sensitive TLS server material is not included in public runtime state or simulator export.

## Reliability and evidence

- Shared active/passive Traffic evidence.
- Request/response, CRC/LRC/MBAP, exception, timing and transaction-order diagnostics.
- Bounded Logger/Trend persistence with restart hydration.
- Raw-Lab conformance suites with semantic response validation.
- Capture, CSV/JSON/XLSX/PDF/ZIP evidence workflows.
- Deterministic source preflight and Mac release gate.
- Manual-only Windows NSIS packaging workflow with packaged-app identity smoke, provenance and SHA-256 checksums.
- Packaged Windows smoke also verifies the stable UI root and critical Master/Slave/Help assets.
- Fail-closed source audit protects product identity, manual-only workflows and core security invariants.
- Stable Playwright coverage checks asset loading, duplicate DOM IDs and document-level overflow.
- Unified browser acceptance runs before compatibility-shell browser coverage so product regressions fail fast.

## Runtime and packaging

Normal, compatibility and desktop launch commands use the unified runtime:

```text
src/index-v7.js
```

Desktop product name:

```text
Modbus Engineering Tool
```

Installer artifact naming:

```text
Modbus-Engineering-Tool-Setup-8.0.0.exe
```

## Upgrade and data

Desktop writable engineering data remains under Electron `userData/data`. Legacy data migration is copy-only into an empty destination and does not merge into an existing populated workspace.

## Release validation boundary

The source implementation and release-gate code are complete. A production release still requires evidence produced from the exact release head for applicable gates:

- source preflight / unit-integration suite,
- browser Playwright acceptance,
- bounded benchmark/soak,
- independent exact-head review,
- Windows packaged clean-machine smoke,
- representative physical RTU/TCP/TLS interoperability,
- production signing when signing material is supplied.

GitHub Actions remain manual `workflow_dispatch` only.
