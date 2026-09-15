# Changelog

All notable production-facing changes to Modbus Engineering Analyzer are recorded here.

## Unreleased — v8 workbench foundation

### Foundation work packages

- Added a transport-neutral v8 protocol core, normalized event model and central Connection Broker while preserving the v7 default runtime.
- Added one-shot Master and virtual Slave engines with virtual, TCP, RTU and ASCII transport foundations.
- Added cyclic polling, canonical Modbus address notation and a guarded write safety/read-back/audit service.
- Added real TCP client/server and serial RTU/ASCII transport foundations with bounded queues, routing, timing, echo suppression and serial direction controls.

### Deep-audit hardening

- Prevented write pre-arming on closed connections and force write/fault state back to safe defaults on every reopen.
- Added immutable low-level transmission evidence for write/raw/test transmissions so direct Master requests cannot bypass the minimum audit trail.
- Enforced serial Unit/Slave IDs 0..247 at the Master runtime boundary.
- Restricted serial Unit-0 broadcast to supported FC05/06/15/16 operations and aligned RTU/ASCII Slave broadcast behavior.
- Added FC22 Mask Write Register to the shared codec, Master, virtual Slave and write safety/read-back path.
- Preserved raw request evidence in timeout/invalid-response write failures.
- Hardened virtual-device seeding so invalid bit/register values fail instead of silently wrapping.
- Added a recursive v8 source syntax gate to CI.
- Added an explicit v7-stable/v8-development status document so development commits cannot be mistaken for a released v8 product.

### Release boundary

- The stable package/desktop version remains 7.0.0 and `npm start` still launches `src/index-v7.js` until the v8 shell, migration, persistence and release gates are complete.

## 7.0.0 — 2026-09-15

### Transport and identity

- Added first-class RTU/TCP channel identity and canonical `deviceKey = channelId + unitId` isolation.
- Prevented same Unit/Slave/register numbers on different RTU buses or TCP endpoints from sharing runtime or engineering data.
- Added transport-aware status, health, filters, history and capture metadata.
- Hardened TCP proxy session tracking, MBAP diagnostics, timeout handling and external-bind safety.

### Discovery

- Added passive RTU/TCP discovery and topology.
- Added FC43 / MEI 0x0E Device Identification decoding, including segmented responses.
- Added guarded read-only active discovery for RTU and TCP with explicit safety interlocks.
- Added persistent discovery evidence and auditable device-identity adoption.

### Engineering and persistence

- Added workspace schema v2 migration with backups and explicit Legacy / Unassigned handling.
- Added corruption preservation/recovery and atomic workspace writes.
- Added channel-aware engineering maps, datatype/byte-order validation, multiword overlap checks and exact 64-bit value handling.
- Added profile version/provenance tracking.
- Hardened history with chunked reads, rotation, retention and partial-record recovery.

### UI and reporting

- Added transport-aware dashboard, bounded HiDPI traffic chart and Light/Dark/System themes.
- Added Discovery, transport/channel filters and mixed-transport terminology.
- Added XLSX/PDF/ZIP exports with Channels, Discovery and Adoption Audit data.
- Added safer export filenames and spreadsheet/CSV hardening.

### Desktop and CI

- Desktop launcher now starts the v7 backend, stores data under Electron userData, chooses a safe local backend port, enforces a single instance and terminates the backend on quit.
- Added browser E2E tests and Windows/Linux Node compatibility checks.
- Added reproducible npm lockfiles and release-version consistency checks.

### Validation boundary

Software CI validates parser/runtime/UI/packaging behavior, but real RS485 electrical acceptance, real Modbus TCP equipment acceptance and long-duration field soak remain hardware/site validation activities.
