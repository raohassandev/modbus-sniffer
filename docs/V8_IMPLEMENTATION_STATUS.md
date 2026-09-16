# v8 Implementation Status and Deep-Audit Record

**Last audited:** 2026-09-16  
**Stable product release:** 7.0.0  
**v8 development state:** foundation/runtime and vertical browser workspaces in progress on `main`  
**Status source of truth:** this document for implemented state; `V8_MASTER_TODO.md` remains the full target-scope roadmap.

## Why the repository still says v7

The default application entry point and Windows desktop launcher remain on the accepted v7 runtime while v8 is completed behind a separate development launcher. Keeping `package.json`, the desktop package and `npm start` on 7.0.0 is a release boundary. The v8 shell is launched separately with `npm run v8` until release gates are complete.

## Implemented v8 work packages

The following work is present with automated coverage:

- WP-01: shared protocol/framing foundation, connection ownership broker, normalized event envelope and virtual loopback transport.
- WP-02: one-shot Master engine, virtual Slave memory/server behavior, write-lock enforcement, exceptions, serial broadcast safety and FC43 identity round-trip.
- WP-03: real TCP client/server transports, bounded stream framing/queues, multi-client routing and Transaction-ID-safe Master concurrency.
- WP-04: real serial RTU/ASCII transport foundation, timing/framing, serial enumeration, echo suppression and RTS direction support.
- WP-05: cyclic poll scheduler, write safety/read-back/audit service and canonical address notation.
- WP-06: v8 project schema v3, explicit/idempotent v7 schema-2 migration, separate `workbench-v8.json` persistence, atomic writes/backups, migration evidence, corrupt-primary recovery and safe configuration-only connection profiles.
- WP-07: dedicated v8 browser shell and Connection Center with persistent app bar/navigation/status, safe project UI preferences, System/Light/Dark themes, density modes, context inspector, document tabs, command palette, feature flags, profile create/delete/duplicate/import/export, serial/network enumeration, target-subnet interface recommendation, open/close/test actions, live diagnostics and WebSocket runtime state.
- Deep-audit hardening: FC22 Mask Write Register end-to-end support, serial Unit-ID validation, correct RTU/ASCII broadcast behavior, immutable broker-level transmission evidence, reopen write-lock hardening, strict simulator seed validation, serialized serial transmit execution and explicit handling of indeterminate driver-write outcomes.

## Project migration guarantees

- The original v7 `workspaces.json` is left unchanged during automatic v8 migration and is copied to a timestamped v7 backup first.
- v7 channels, devices, channel-scoped `deviceKey` identities, register mappings, discovery evidence, Legacy / Unassigned data, profiles and available capture/history/adoption metadata are preserved in schema v3.
- A migrated channel becomes a saved configuration profile only. It is inactive, manually activated, unowned, transmit-disabled, write-locked and fault-injection-disabled after migration.
- Project-level or imported runtime ownership/write/fault state is removed during normalization and never persisted as armed.
- Running the migration again on schema v3 is idempotent and does not duplicate connection profiles.
- Same Unit IDs on different channels stay distinct because channel-scoped device keys are preserved and validated.
- The v8 store writes atomically, keeps a last-known-good backup and preserves a corrupt primary file before restoring that backup.

## Deep-audit findings closed

| Severity | Finding | Resolution |
| --- | --- | --- |
| P0 | A Master/Test connection could be write-armed before it was live and retain the armed state into `open()` | Enabling writes now requires an open transport; every real open/reopen resets writes and fault state to locked/off |
| P0 | Direct Master writes could bypass the richer `WriteSafetyController` audit | The Connection Broker records immutable low-level evidence for every write/raw/test transmission, independent of the high-level safety wrapper |
| P0 | A serial write/drain timeout could be reported as an ordinary failure even though bytes may already have reached the driver/device | The public serial transport reports `TRANSMISSION_OUTCOME_UNKNOWN`, latches the transport into error, requires close/reopen, records exact raw evidence, and the public broker immediately re-locks writes so the command cannot be automatically retried |
| P0 | Concurrent low-level serial sends could overlap RTS/echo/write/drain handling outside the higher-level Master request queue | The public serial transport serializes all transmit attempts internally |
| P0 | RTU/ASCII one-shot Master accepted Unit IDs 248..255 | Serial Master enforces 0..247 while the transport-neutral/TCP codec retains byte-wide Unit IDs |
| P0 | FC23 could be treated as a no-response Unit-0 serial broadcast even though it contains a read operation | Unit-0 serial broadcast is restricted to FC05/06/15/16; unsupported broadcast functions are rejected before transmit |
| P0 | ASCII virtual Slave did not implement the same Unit-0 broadcast semantics as RTU | RTU and ASCII share the same supported serial broadcast path |
| P1 | FC22 was in the v8 target but absent from shared codec/Master/Slave/write-safety layers | Added one shared FC22 codec and end-to-end Master/Slave/read-back support |
| P1 | Failed/timeout writes could lose transmitted request bytes in the enriched write audit | Master/transport errors retain request evidence and write audit uses that evidence on failures; indeterminate low-level writes are separately marked in broker evidence |
| P1 | Simulator `seed()` could silently wrap invalid values through typed arrays | Seed operations use the same strict bit/register value validation as live writes while still allowing initialization of read-only areas |
| P1 | CI syntax gates explicitly covered older runtime files but not the whole v8 source tree | Added recursive v8 syntax coverage and expanded it to the v8 launcher/browser shell |
| P1 | v8 had a planned schema but no executable, safe v7-to-v8 migration boundary | Added schema v3, validation, idempotent migration, source backup/reporting and a separate v8 store so v7 data is never silently overwritten |
| P1 | Connection Center lacked a vertical browser/runtime integration | Added the v8 shell, profile/runtime API, WebSocket updates, safe project preferences and browser acceptance coverage |
| P2 | README/version state made v8 commits look inconsistent with a v7 package | Documentation separates stable v7 release surfaces from the in-progress v8 workbench |

## Safety invariants currently enforced in code

- Analyzer/replay ownership has no transmit intent.
- Discovery is read-only; proxy is forward-only.
- Master/Test write intent requires a per-connection live write latch.
- A reopened connection returns to `LOCKED` regardless of prior ownership state.
- Serial resource ownership is exclusive through the Connection Broker.
- Serial Unit 0 is only treated as broadcast for explicitly supported write functions.
- Public serial transmit calls are internally serialized across direction control, echo handling, driver write and drain.
- If a serial driver write has been attempted but completion cannot be proven, the result is explicitly indeterminate, the transport enters error, writes are re-locked and close/reopen is required before further traffic.
- Every confirmed low-level write/raw/test transmission gets bounded append-only process-lifetime evidence containing timestamp, connection, owner, transport, intent and exact transmitted HEX; indeterminate writes also get an `outcome: unknown` audit record with the error code.
- The richer write audit records user/session, address/quantity, requested values, old value when available, response, verification and result.
- Persisted v8 connection profiles contain configuration only and always normalize to manual/inactive/unowned/transmit-disabled/write-locked/fault-disabled state.
- UI mode/write labels are driven from the live Connection Broker state rather than persisted profile flags.

## Remaining product work

- Complete the shared protocol/core matrix still missing from the v8 target, including remaining standard function codecs, common engineering data types and golden-vector verification.
- Complete Master Workstation UI, scan workflow and full poll-document persistence/editing.
- Complete Slave/Server Simulator UI, dynamic generators and isolated Fault Injection Lab.
- Integrate unified v8 Traffic and Register Lab workspaces.
- Build Test Center/raw-frame studio and automated recipe engine.
- Add UDP/tunnelling, remaining IPv6 work and Modbus/TCP Security/TLS.
- Build charts/logger/SQLite historian, capture-to-digital-twin, automation APIs/CLI/SDK and HMI Builder.
- Complete accessibility/keyboard/performance/security hardening for all final v8 workspaces.
- Complete long-duration combined workload soak, interoperability matrix and real-device/site acceptance.
- Switch default runtime/desktop launcher/product version from v7 to v8 only after all release gates pass.

## Release interpretation

`main` can remain green while v8 is incomplete because stable v7 stays the default product and v8 modules are introduced behind a separate launcher and feature flags. Each completed v8 work package must pass its automated/runtime/browser gates before it is counted complete.

A future v8 release candidate is declared only after applicable P0/P1 items in `V8_MASTER_TODO.md` are reconciled, the default entry point moves to v8, migration is tested, browser/desktop acceptance passes, and no open P0 remains. Real RS485 electrical/site qualification remains an external field gate even after software release-candidate status.
