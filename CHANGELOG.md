# Changelog

All notable production-facing changes to Modbus Engineering Analyzer are recorded here.

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
