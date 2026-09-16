# v8 Implementation Status and Deep-Audit Record

**Last audited:** 2026-09-16  
**Stable product release:** 7.0.0  
**v8 development state:** vertically integrated preview work in progress behind the stable v7 runtime  
**Status source of truth:** this document for implemented state; `V8_MASTER_TODO.md` remains the full target-scope roadmap.

## Why the repository still says v7

The default application entry point and Windows desktop launcher intentionally remain on the accepted v7 runtime while v8 is built behind `src/v8/`. `npm start`, `package.json` and the stable desktop product therefore remain 7.0.0 by design.

The v8 vertical slices are launched separately with `npm run v8:preview`. Do not change the default launcher/product version until the Master, Simulator, Traffic/Register Lab and applicable release gates are complete. A v8 preview surface being present on `main` does not by itself make v8 the released product.

## Implemented v8 foundation

The following work is present with automated coverage:

- WP-01: shared protocol/framing foundation, connection ownership broker, normalized event envelope and virtual loopback transport.
- WP-02: one-shot Master engine, virtual Slave memory/server behavior, write-lock enforcement, exceptions, serial broadcast safety and FC43 identity round-trip.
- WP-03: real TCP client/server transports, bounded stream framing/queues, multi-client routing and Transaction-ID-safe Master concurrency.
- WP-04: real serial RTU/ASCII transport foundation, timing/framing, serial enumeration, echo suppression and RTS direction support.
- WP-05: cyclic poll scheduler, write safety/read-back/audit service and canonical address notation.
- WP-06: v8 project schema v3, explicit/idempotent v7 schema-2 migration, separate `workbench-v8.json` persistence, atomic writes/backups, migration evidence, corrupt-primary recovery and safe configuration-only connection profiles.
- WP-07: professional v8 preview shell and Connection Center vertically wired to the v8 project store and Connection Broker. It includes the persistent app bar, primary navigation, context inspector, engineering status bar, System/Light/Dark themes, Comfortable/Compact/Dense data density, command palette, saved profile workflows, exact runtime ownership/state, serial/network enumeration, safe Test Connection, open/close lifecycle, duplicate/import/export, live WebSocket state and browser acceptance coverage.
- Deep-audit hardening: FC22 Mask Write Register end-to-end support, serial Unit-ID validation, correct RTU/ASCII broadcast behavior, immutable broker-level transmission evidence, reopen write-lock hardening, strict simulator seed validation, serialized serial transmit execution and explicit handling of indeterminate driver-write outcomes.

## Project migration guarantees

- The original v7 `workspaces.json` is left unchanged during automatic v8 migration and is copied to a timestamped v7 backup first.
- v7 channels, devices, channel-scoped `deviceKey` identities, register mappings, discovery evidence, Legacy / Unassigned data, profiles and available capture/history/adoption metadata are preserved in schema v3.
- A migrated channel becomes a saved **configuration profile only**. It is inactive, manually activated, unowned, transmit-disabled, write-locked and fault-injection-disabled after migration.
- Project-level or imported runtime ownership/write/fault state is removed during normalization and never persisted as armed.
- Running the migration again on schema v3 is idempotent and does not duplicate connection profiles.
- Same Unit IDs on different channels stay distinct because channel-scoped device keys are preserved and validated.
- The v8 store writes atomically, keeps a last-known-good backup and preserves a corrupt primary file before restoring that backup.

## Connection Center guarantees

- Saved profile configuration is validated before project mutation; invalid serial/TCP/runtime configuration is not persisted.
- TCP server listen addresses must belong to the local machine (or an explicit wildcard), so a device/remote IP cannot be silently used as the local listener.
- Serial ports keep exclusive broker ownership; active profiles cannot be edited or deleted until explicitly closed.
- Project switching is blocked while a v8 runtime connection is active.
- Test Connection only opens/closes the transport under read-only discovery ownership and never sends a Modbus request or arms writes.
- Live owner mode, transport state, transmit capability and write-lock status come from the Connection Broker, not from optimistic UI state.
- Browser mutations enforce same-origin checks and the preview defaults to loopback-only binding.
- Restart restores saved configuration but never restores live ownership, write permission or fault-injection state.

## Deep-audit findings closed

| Severity | Finding | Resolution |
| --- | --- | --- |
| P0 | A Master/Test connection could be write-armed before it was live and retain the armed state into `open()` | Enabling writes now requires an open transport; every real open/reopen resets writes and fault state to locked/off |
| P0 | Direct Master writes could bypass the richer `WriteSafetyController` audit | The Connection Broker now records immutable low-level evidence for every write/raw/test transmission, independent of the high-level safety wrapper |
| P0 | A serial write/drain timeout could be reported as an ordinary failure even though bytes may already have reached the driver/device | The public serial transport now reports `TRANSMISSION_OUTCOME_UNKNOWN`, latches the transport into error, requires close/reopen, records exact raw evidence, and the public broker immediately re-locks writes so the command cannot be automatically retried |
| P0 | Concurrent low-level serial sends could overlap RTS/echo/write/drain handling outside the higher-level Master request queue | The public serial transport now serializes all transmit attempts internally, so safety does not depend on every caller using `MasterEngine` |
| P0 | RTU/ASCII one-shot Master accepted Unit IDs 248..255 | Serial Master now enforces 0..247 while the transport-neutral/TCP codec retains byte-wide Unit IDs |
| P0 | FC23 could be treated as a no-response Unit-0 serial broadcast even though it contains a read operation | Unit-0 serial broadcast is restricted to FC05/06/15/16; unsupported broadcast functions are rejected before transmit |
| P0 | ASCII virtual Slave did not implement the same Unit-0 broadcast semantics as RTU | RTU and ASCII now share the same supported serial broadcast path |
| P0 | Connection Center could have persisted a transport-invalid profile before runtime validation failed | Candidate runtime configuration is now validated before save/duplicate/import; batch import pre-validates the full payload before mutation |
| P1 | FC22 was in the v8 target but absent from shared codec/Master/Slave/write-safety layers | Added one shared FC22 codec and end-to-end Master/Slave/read-back support |
| P1 | Failed/timeout writes could lose transmitted request bytes in the enriched write audit | Master/transport errors retain request evidence and write audit uses that evidence on failures; indeterminate low-level writes are separately marked in broker evidence |
| P1 | Simulator `seed()` could silently wrap invalid values through typed arrays | Seed operations now use the same strict bit/register value validation as live writes while still allowing initialization of read-only areas |
| P1 | CI syntax gates explicitly covered older runtime files but not the whole v8 source tree | Added recursive `npm run check:v8` syntax gate and wired it into CI |
| P1 | v8 had a planned schema but no executable, safe v7-to-v8 migration boundary | Added schema v3, validation, idempotent migration, source backup/reporting and a separate v8 store so v7 data is never silently overwritten |
| P2 | README/version state made v8 commits look inconsistent with a v7 package | Documentation explicitly separates stable v7 release surfaces from in-progress v8 preview/foundation surfaces |

## Safety invariants currently enforced in code

- Analyzer/replay ownership has no transmit intent.
- Discovery is read-only; proxy is forward-only.
- Master/Test write intent requires a per-connection live write latch.
- A reopened connection returns to `LOCKED` regardless of prior ownership state.
- Serial resource ownership is exclusive through the Connection Broker.
- Serial Unit 0 is only treated as broadcast for the explicitly supported write functions.
- Public serial transmit calls are internally serialized across direction control, echo handling, driver write and drain.
- If a serial driver write has been attempted but completion cannot be proven, the result is explicitly indeterminate, the transport enters error, writes are re-locked and close/reopen is required before further traffic.
- Every confirmed low-level write/raw/test transmission gets bounded append-only process-lifetime evidence containing timestamp, connection, owner, transport, intent and exact transmitted HEX; indeterminate writes also get an `outcome: unknown` audit record with the error code.
- The richer write audit additionally records user/session, address/quantity, requested values, old value when available, response, verification and result.
- Persisted v8 connection profiles contain configuration only and always normalize to manual/inactive/unowned/transmit-disabled/write-locked/fault-disabled state.
- The v8 shell displays actual broker ownership/capability/write state and does not infer an active mode from saved configuration.

## What is intentionally still not complete

These are roadmap items, not hidden completion claims:

- Master Workstation browser integration (documents/jobs/results/write drawer) on top of the already-tested Master runtime, Poll Scheduler and Write Safety service.
- Simulator browser integration (device tree/memory editor/generators/fault lab) on top of the already-tested virtual Slave runtime.
- unified v8 Traffic/Register Lab browser integration.
- address/unit scanning through the shared Master engine.
- Test Center/raw-frame studio and recipe engine.
- UDP/tunnelling, IPv6 completion and Modbus/TCP Security/TLS.
- charts/logger/SQLite historian, capture-to-digital-twin, automation APIs/CLI/SDK and HMI Builder.
- the remaining tab/split-view framework and full accessibility/keyboard/performance/security hardening across future workspaces.
- 24-hour v8 combined workload soak, third-party interoperability matrix and real-device/site acceptance.
- switching the default runtime/desktop launcher/product version from v7 to v8.

## Release interpretation

`main` can be green while v8 is still incomplete because the stable v7 runtime remains the default product and v8 vertical slices are introduced behind the separate preview launcher with regression tests. The next product-completion work should integrate the already-tested Master runtime vertically into the v8 shell rather than prematurely changing the release version.

A future v8 release candidate should only be declared after the applicable P0/P1 work in `V8_MASTER_TODO.md` is reconciled, the default entry point moves to v8, migration is tested, browser/desktop acceptance passes, and no open P0 remains. Real RS485 electrical/site qualification stays an external field gate even after software release-candidate status.
