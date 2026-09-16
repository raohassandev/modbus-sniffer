# v8 Implementation Status and Deep-Audit Record

**Last audited:** 2026-09-16  
**Stable product release:** 7.0.0  
**v8 development state:** tested vertical workspaces continue behind the separate v8 launcher  
**Status source of truth:** this document records implemented state; `V8_MASTER_TODO.md` remains the full target-scope roadmap.

## Release boundary

The default application entry point and Windows desktop launcher remain on the accepted v7 runtime while v8 is completed behind a separate development launcher. Keeping `package.json`, the desktop package and `npm start` on 7.0.0 is intentional. The v8 shell is launched with `npm run v8` until the v8 release gates are complete.

A v8 module being present on `main` does not by itself make that capability the stable released product. The release switch happens only after the applicable P0/P1 work, migration, browser/desktop acceptance and release gates pass.

## Implemented v8 work packages

The following work has landed on `main` with automated coverage unless a narrower qualification is stated.

- **WP-01 — shared foundation:** protocol/framing foundation, Connection Broker ownership model, normalized event envelope and virtual loopback transport.
- **WP-02 — Master/Slave foundation:** one-shot Master engine, virtual Slave memory/server behavior, write-lock enforcement, exceptions, serial broadcast safety and FC43 identity round-trip.
- **WP-03 — TCP transport:** bounded TCP client/server transports, stream framing, multi-client server routing and Transaction-ID-safe Master concurrency.
- **WP-04 — serial transport:** real Serial RTU/ASCII transport foundation, frame timing, enumeration, echo suppression, flow-control/direction support and hardware-independent injected-driver coverage.
- **WP-05 — Master runtime safety:** fair cyclic poll scheduler, write safety/read-back/audit service and canonical address notation.
- **WP-06 — project schema/migration:** v8 project schema v3, explicit/idempotent v7 schema-2 migration, separate `workbench-v8.json` persistence, atomic writes/backups, migration evidence, corrupt-primary recovery and safe configuration-only connection profiles.
- **WP-07 — shell/Connection Center:** dedicated v8 browser shell, persistent app bar/navigation/status, safe project UI preferences, System/Light/Dark themes, density modes, context inspector, document tabs, command palette, feature flags, profile create/delete/duplicate/import/export, serial/network enumeration, target-subnet interface recommendation, open/close/test actions, live diagnostics and WebSocket runtime state.
- **WP-08 — protocol completion + Master Workstation:** standard FC codecs for FC01/02/03/04/05/06/07/08/11/12/15/16/17/20/21/22/23/24/43, unknown/vendor-PDU preservation, shared integer/float/ASCII/BCD/timestamp permutations, one-shot reads, persistent cyclic poll jobs, scheduler controls, guarded writes/read-back and exact evidence in the browser Master workspace.
- **WP-09 — read-only Discovery:** FC43-first Unit/Slave scan with read-only fallback, adaptive FC01-04 address scanning, cancellation/progress, persistent scan evidence/export, confirmed-device handoff into Master jobs, REST/WebSocket integration and serial maintenance/exclusive-bus interlocks.
- **WP-10 — Slave/Server Simulator:** persistent simulator/server/device configuration, memory editor, dynamic value generators, request/write evidence, isolated LAB fault injection, REST/WebSocket integration and browser Simulator workspace.
- **WP-11 — unified Traffic + Register Lab:** bounded live Traffic timeline, filtering/search/bookmarks/evidence inspection/error navigation/freeze controls, plus Register Lab interpretation with datatype/order, engineering definitions, scale/offset, units, enum/bitfield/limits, provenance and safe write-readiness state.
- **WP-12 — Test Center/Recipe runtime:** guarded Raw Frame Studio, exact evidence, explicit LAB/raw confirmation, validated-write safety, repeat sends and versioned Recipe Engine with connect/disconnect, read/write/raw/delay/set/assert/repeat, pause/resume/stop, variables, timeouts/cancellation and pass/fail evidence. The dedicated browser Test Center surface is tracked separately as WP-12B until its browser gate merges.
- **WP-13 — Charts/Logger/Historian:** bounded chart service, rotating JSONL logger and conditional SQLite historian with regression coverage.
- **WP-14 — Modbus UDP transport:** bounded UDP client/server transports, explicit server reply routing, IPv4/IPv6 transport support, queue/datagram limits and shared Master/Virtual-Slave coverage.
- **Deep-audit hardening:** FC22 end-to-end support, serial Unit-ID validation, correct RTU/ASCII Unit-0 broadcast behavior, immutable broker-level transmission evidence, reopen write-lock hardening, strict simulator seed validation, cyclic-poll write exclusion, serialized serial transmit execution and explicit handling of indeterminate driver-write outcomes.

## Project migration guarantees

- The original v7 `workspaces.json` is left unchanged during automatic v8 migration and is copied to a timestamped v7 backup first.
- v7 channels, devices, channel-scoped `deviceKey` identities, register mappings, discovery evidence, Legacy / Unassigned data, profiles and available capture/history/adoption metadata are preserved in schema v3.
- A migrated channel becomes a saved configuration profile only. It is inactive, manually activated, unowned, transmit-disabled, write-locked and fault-injection-disabled after migration.
- Project-level or imported runtime ownership/write/fault state is removed during normalization and never persisted as armed.
- Running migration again on schema v3 is idempotent and does not duplicate connection profiles.
- Same Unit IDs on different channels stay distinct because channel-scoped device keys are preserved and validated.
- The v8 store writes atomically, keeps a last-known-good backup and preserves a corrupt primary file before restoring that backup.

## Deep-audit findings closed

| Severity | Finding | Resolution |
| --- | --- | --- |
| P0 | A Master/Test connection could be write-armed before it was live and retain the armed state into `open()` | Enabling writes requires an open transport; every real open/reopen resets writes and fault state to locked/off |
| P0 | Direct Master writes could bypass the richer `WriteSafetyController` audit | Connection Broker records immutable low-level evidence for every write/raw/test transmission independent of the high-level wrapper |
| P0 | A serial write/drain timeout could be reported as an ordinary failure even though bytes may already have reached the device | Public serial transport reports `TRANSMISSION_OUTCOME_UNKNOWN`, latches error, requires close/reopen, preserves exact evidence and causes the broker write state to re-lock |
| P0 | Concurrent low-level serial sends could overlap RTS/echo/write/drain handling | Public serial transport serializes transmit attempts internally |
| P0 | RTU/ASCII one-shot Master accepted Unit IDs 248..255 | Serial Master enforces 0..247 while TCP/transport-neutral codecs retain byte-wide Unit IDs |
| P0 | FC23 could be treated as a no-response Unit-0 serial broadcast despite containing a read | Unit-0 serial broadcast is restricted to FC05/06/15/16 and unsupported broadcasts are rejected before transmit |
| P0 | ASCII virtual Slave lacked the RTU Unit-0 broadcast semantics | RTU and ASCII share the same supported serial broadcast path |
| P1 | FC22 was planned but absent from shared codec/Master/Slave/write-safety layers | Added one shared FC22 codec and end-to-end Master/Slave/read-back support |
| P1 | Failed/timeout writes could lose transmitted request evidence | Master/transport errors retain request evidence; enriched write audit consumes it and indeterminate sends are separately marked |
| P1 | Simulator `seed()` could silently wrap invalid typed-array values | Seed operations use strict bit/register value validation while still allowing initialization of read-only areas |
| P1 | CI syntax gates explicitly covered older files but not the whole v8 source tree | Added recursive v8 syntax coverage and expanded it to v8 launcher/browser surfaces |
| P1 | v8 had no executable safe v7-to-v8 persistence boundary | Added schema v3 validation/migration/source backup/reporting and a separate v8 store |
| P1 | Connection Center lacked a vertical browser/runtime integration | Added v8 shell, runtime/profile API, WebSocket updates, safe UI preferences and browser acceptance coverage |
| P1 | Discovery risked becoming a second active-Master path | Discovery has dedicated read-only ownership; writes cannot be armed and serial scans require two explicit safety confirmations |
| P2 | README/version state made v8 commits look inconsistent with a v7 package | Documentation separates stable v7 release surfaces from the in-progress v8 workbench |

## Safety invariants currently enforced

- Analyzer/replay ownership has no transmit intent.
- Discovery is read-only; proxy is forward-only.
- Master/Test write intent requires a per-connection live write latch.
- Reopened connections return to `LOCKED` regardless of prior ownership state.
- Serial resource ownership is exclusive through the Connection Broker.
- Serial Unit 0 is only treated as broadcast for explicitly supported write functions.
- Public serial transmit calls are internally serialized across direction control, echo handling, driver write and drain.
- If a serial driver write has been attempted but completion cannot be proven, the result is explicitly indeterminate, the transport enters error, writes are re-locked and close/reopen is required before further traffic.
- Every confirmed low-level write/raw/test transmission has bounded append-only process-lifetime evidence containing timestamp, connection, owner, transport, intent and exact transmitted HEX; indeterminate writes carry `outcome: unknown` evidence.
- The richer write audit records user/session, address/quantity, requested values, old value when available, response, verification and result.
- Persisted v8 connection profiles contain configuration only and normalize to manual/inactive/unowned/transmit-disabled/write-locked/fault-disabled state.
- UI mode/write labels are driven by live Connection Broker state rather than persisted flags.
- Discovery serial scans cannot start unless maintenance-window and exclusive-bus access are both explicitly confirmed.
- Simulator fault injection is a separate LAB capability and is disabled by default.
- Test Center LAB/raw and validated-write latches are separate and disabled by default.

## Remaining product work

The major remaining software/release work after WP-14 is:

- Merge and validate the **WP-12B Test Center browser workspace** without cross-workspace lifecycle leakage.
- Reconcile `V8_MASTER_TODO.md` checkboxes against the capabilities already proven by WP-01 through WP-14; the roadmap currently understates completion.
- Complete remaining Master professional workflow polish where not yet covered: richer representation/stale/change states, batch/order workflow, encoded write preview, templates and cross-workspace shortcuts.
- Add **RTU/ASCII tunnelling** modes that remain explicitly distinct from native Modbus TCP/UDP.
- Add **Modbus/TCP Security/TLS** client/server, certificate/key validation, trust configuration, mutual TLS and fail-closed diagnostics.
- Finish IPv6 qualification across all applicable UI/profile/runtime paths, not merely low-level transport support.
- Add capture-to-digital-twin workflows and the remaining advanced simulator/test tooling.
- Build automation API/CLI/SDK surfaces and HMI Builder workspaces.
- Complete accessibility, keyboard, performance and security hardening across the final v8 product shell.
- Complete combined long-duration soak, third-party interoperability matrix and real-device/site acceptance.
- Promote v8 to the default browser/desktop runtime and product version only after release gates pass.

## Release interpretation

`main` can remain green while v8 is incomplete because stable v7 stays the default product and v8 modules are introduced behind a separate launcher/feature flags. Each completed v8 package must pass its applicable unit/integration/browser gates before being counted complete.

A v8 release candidate should be declared only after applicable P0/P1 items in `V8_MASTER_TODO.md` are reconciled, the default entry point moves to v8, migration is tested, browser/desktop acceptance passes, and no open P0 remains. Real RS485 electrical/site qualification remains an external field gate even after software release-candidate status.
