# v8 Implementation Status and Deep-Audit Record

**Last audited:** 2026-09-16  
**Stable product release:** 7.0.0  
**v8 development state:** foundation/runtime work in progress on `main`  
**Status source of truth:** this document for implemented state; `V8_MASTER_TODO.md` remains the full target-scope roadmap.

## Why the repository still says v7

The default application entry point, browser product surface and Windows desktop launcher intentionally remain on the accepted v7 runtime while v8 is built behind `src/v8/`. Keeping `package.json`, the desktop package and `npm start` on 7.0.0 is therefore a release boundary, not a version-sync defect.

Do not label the product v8 or change the default launcher until the v8 shell, runtime integration and applicable release gates are complete. A v8 source module being present on `main` does not by itself make that capability production-exposed.

## Implemented v8 foundation

The following work is present with automated coverage:

- WP-01: shared protocol/framing foundation, connection ownership broker, normalized event envelope and virtual loopback transport.
- WP-02: one-shot Master engine, virtual Slave memory/server behavior, write-lock enforcement, exceptions, serial broadcast safety and FC43 identity round-trip.
- WP-03: real TCP client/server transports, bounded stream framing/queues, multi-client routing and Transaction-ID-safe Master concurrency.
- WP-04: real serial RTU/ASCII transport foundation, timing/framing, serial enumeration, echo suppression and RTS direction support.
- WP-05: cyclic poll scheduler, write safety/read-back/audit service and canonical address notation.
- WP-06: versioned v8 workspace/project schema, explicit v7 workspace-v2 migration, no-silent-loss preservation of unmapped fields, safe connection-profile persistence, feature flags for incomplete modules, atomic save/backup/recovery behavior and project-restart write/fault disarming.
- Deep-audit hardening: FC22 Mask Write Register end-to-end support, serial Unit-ID validation, correct RTU/ASCII broadcast behavior, immutable broker-level transmission evidence, reopen write-lock hardening, strict simulator seed validation, serialized serial transmit execution and explicit handling of indeterminate driver-write outcomes.

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
| P0 | Persisted project/runtime state could have become a future path for restoring armed writes/fault injection | v8 project normalization and persistence always replace transient runtime capability with a disarmed safe state; connection profiles exclude live owner/state/write/fault fields |
| P0 | A v7-to-v8 migration could silently drop fields that the new schema did not yet understand | Explicit migration preserves known identity-bearing data and retains unknown project/workspace fields under legacy/migration evidence, while producing a backup and migration report |
| P1 | FC22 was in the v8 target but absent from shared codec/Master/Slave/write-safety layers | Added one shared FC22 codec and end-to-end Master/Slave/read-back support |
| P1 | Failed/timeout writes could lose transmitted request bytes in the enriched write audit | Master/transport errors retain request evidence and write audit uses that evidence on failures; indeterminate low-level writes are separately marked in broker evidence |
| P1 | Simulator `seed()` could silently wrap invalid values through typed arrays | Seed operations now use the same strict bit/register value validation as live writes while still allowing initialization of read-only areas |
| P1 | CI syntax gates explicitly covered older runtime files but not the whole v8 source tree | Added recursive `npm run check:v8` syntax gate and wired it into CI |
| P2 | README/version state made v8 commits look inconsistent with a v7 package | Documentation now explicitly separates stable v7 release surfaces from the in-progress v8 foundation |

## Safety invariants currently enforced in code

- Analyzer/replay ownership has no transmit intent.
- Discovery is read-only; proxy is forward-only.
- Master/Test write intent requires a per-connection live write latch.
- A reopened connection returns to `LOCKED` regardless of prior ownership state.
- Saved v8 project files cannot persist armed write/fault state; load/save normalizes those runtime fields back to safe defaults.
- Saved connection profiles do not carry runtime ownership, live connection state, write latch or fault-injection state.
- Serial resource ownership is exclusive through the Connection Broker.
- Serial Unit 0 is only treated as broadcast for the explicitly supported write functions.
- Public serial transmit calls are internally serialized across direction control, echo handling, driver write and drain.
- If a serial driver write has been attempted but completion cannot be proven, the result is explicitly indeterminate, the transport enters error, writes are re-locked and close/reopen is required before further traffic.
- Every confirmed low-level write/raw/test transmission gets bounded append-only process-lifetime evidence containing timestamp, connection, owner, transport, intent and exact transmitted HEX; indeterminate writes also get an `outcome: unknown` audit record with the error code.
- The richer write audit additionally records user/session, address/quantity, requested values, old value when available, response, verification and result.

## What is intentionally still not complete

These are roadmap items, not hidden completion claims:

- v8 application shell, Connection Center UI, Master UI and Simulator UI.
- vertical browser integration of the new v8 project store and saved connection profiles.
- unified v8 Traffic/Register Lab browser integration.
- address/unit scanning through the shared Master engine.
- Test Center/raw-frame studio and recipe engine.
- UDP/tunnelling, IPv6 completion and Modbus/TCP Security/TLS.
- charts/logger/SQLite historian, capture-to-digital-twin, automation APIs/CLI/SDK and HMI Builder.
- complete accessibility/keyboard/performance/security hardening for the new v8 product shell.
- 24-hour v8 combined workload soak, third-party interoperability matrix and real-device/site acceptance.
- switching the default runtime/desktop launcher/product version from v7 to v8.

## Release interpretation

`main` can be green while v8 is still incomplete because the stable v7 runtime remains the default product and v8 foundation modules are being introduced behind it with regression tests. The next product-completion work must integrate those tested modules vertically into the v8 shell and project model rather than prematurely changing the release version.

A future v8 release candidate should only be declared after the applicable P0/P1 work in `V8_MASTER_TODO.md` is reconciled, the default entry point moves to v8, migration is tested, browser/desktop acceptance passes, and no open P0 remains. Real RS485 electrical/site qualification stays an external field gate even after software release-candidate status.
