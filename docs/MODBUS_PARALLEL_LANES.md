# Modbus Engineering Tool — Parallel Lane Registry

**Status date:** 2026-09-20  
**Branch:** `v8-release-completion`

This registry tracks **software/release-engineering completion**. Physical hardware, clean-machine Windows execution, Defender/firewall/driver behavior and production signing are external acceptance evidence and are listed separately rather than being counted as unfinished software.

| Lane | Scope | Status | Completion |
|---|---|---|---:|
| L0 | Product scope + unified shell | COMPLETE | 100% |
| L1 | Master / Client engineering | COMPLETE | 100% |
| L2 | Shared Modbus core / ownership integration | COMPLETE | 100% |
| L3 | Slave / Server simulator | COMPLETE | 100% |
| L4 | Protocol diagnostics / conformance | COMPLETE | 100% |
| L5 | Traffic / Data Lab / Discovery | COMPLETE | 100% |
| L6 | Raw Lab / Device Clone / Test Sequences / Compare | COMPLETE | 100% |
| L7 | Logger / Trend / Transport / TLS evidence | COMPLETE | 100% |
| L8-A | Unit/integration/test-contract correctness | COMPLETE | 100% |
| L8-B | Unified browser / Playwright coverage | COMPLETE | 100% |
| L8-C | Desktop / installer / provenance automation | COMPLETE | 100% |
| L8-D | Security / ownership / transport hardening | COMPLETE | 100% |
| L8-E | Release docs / evidence contract | COMPLETE | 100% |
| L8-F | Field/Windows acceptance harness + evidence convergence | COMPLETE | 100% |

**Software and release-engineering completion: 100%.**

## Closure evidence implemented in source

- root test discovery is explicitly scoped to the Modbus suite;
- unified source preflight covers version, source audit, lint, syntax, runtime dependency audit, unit/integration tests, smoke, acceptance and L8-F runtime acceptance;
- unified Playwright runs against the shipped `src/index-v7.js` runtime;
- internal compatibility-shell Playwright is isolated behind its own config and is not a shipped launch path;
- stable browser coverage checks product identity, primary workspaces, durable Monitor Session reload, missing assets, duplicate DOM IDs, overflow, built-in Slave→Master loopback reads and no-transmit unsafe-write rejection;
- guarded writes validate confirmation before unlock and preserve failed/non-transmitted audit evidence;
- Raw Lab validates Modbus framing, semantics and successful response payload structure;
- TLS Slave private keys are redacted from public state/export and preserved server-side only;
- Logger/Trend hydrates bounded persisted register and protocol-event history after restart;
- Logger/Trend persists under the configured runtime data root rather than a process working directory;
- Master Monitor Sessions use atomic bounded workstation persistence, are browser-reload/restart tested, and reject rendered HTML persistence;
- desktop migration preserves Monitor Session/Logger evidence, rolls back partial failures and refuses mixed legacy/current data;
- desktop uses a stable preferred loopback renderer origin with safe ephemeral fallback for browser-backed preferences;
- Discovery Unit-ID limits are framing-aware;
- stale UDP peers expire before exhausting the simulator peer table;
- Test Sequence Compare preserves repeated step occurrences;
- web mutation body limits, same-origin protection and external-bind confirmation are enforced;
- product/version identity is sourced from the 8.0.0 release source of truth;
- desktop packaging excludes the compatibility launcher/shell and uses the unified runtime;
- Windows workflow is manual-only and includes preflight, soak, unified browser acceptance, NSIS build, packaged health/UI smoke, install/uninstall acceptance, environment capture, provenance and SHA-256 checksums;
- final L8-F evidence convergence tooling is present;
- release notes and site-acceptance documentation are complete.

## External release evidence still to execute

These are **not remaining development lanes**:

- exact-head source preflight execution;
- exact-head unified browser execution;
- bounded benchmark/soak execution;
- real passive RTU Sniffer acceptance;
- representative RTU/TCP Master acceptance;
- external-Master Slave interoperability;
- representative TLS/mTLS interoperability;
- clean Windows installer execution with Defender/firewall/USB-driver observations;
- production signing when signing material is supplied;
- final release/merge approval.

PR #31 must not be merged merely because GitHub reports it mergeable. External acceptance evidence must be tied to the exact release head.
