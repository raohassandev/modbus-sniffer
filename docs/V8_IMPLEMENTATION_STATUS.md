# v8 Implementation Status and Release-Candidate Audit

**Last audited:** 2026-09-16  
**Release-candidate version:** 8.0.0  
**Release branch:** `v8-release-completion`  
**Integration PR:** #31  
**Compatibility runtime:** v7 remains available through the explicit `npm run v7` command.

## Current release boundary

The v8 all-in-one Modbus Engineering Workbench is now the default runtime on the release-candidate branch. `npm start`, the package entry point, and the Windows desktop launcher use `src/index-v8.js`. The desktop shell opens the v8 UI and checks `/api/v8/status`. v7 is retained only as an explicit compatibility path.

This document records implemented software state on PR #31. A feature is not considered released on `main` until the exact PR head passes the complete CI matrix and is merged. Real RS485 electrical behavior and third-party device interoperability remain field/hardware acceptance gates and cannot be manufactured by software CI.

## Implemented v8 work packages

- **WP-01 — shared foundation:** canonical protocol/framing core, normalized events, Connection Broker ownership model and virtual loopback transport.
- **WP-02 — Master/Slave foundation:** one-shot Master engine, virtual Slave memory/server, exceptions, broadcast handling and write-lock enforcement.
- **WP-03 — TCP:** bounded TCP client/server transports, stream framing, multi-client routing and Transaction-ID-safe concurrency.
- **WP-04 — serial RTU/ASCII:** serial transports, timing, enumeration, echo suppression, flow-control/direction options and driver-independent regression coverage.
- **WP-05 — Master safety/runtime:** fair cyclic scheduler, strict serialization, write safety, read-back, immutable audit evidence and canonical addressing.
- **WP-06 — schema/migration:** v8 schema v3, explicit/idempotent v7 migration, source backup, migration report, atomic writes, last-known-good backup and corrupt-primary recovery.
- **WP-07 — shell/Connection Center:** v8 browser shell, app/status bars, themes/density, command palette, persistent safe preferences, connection profiles, serial/network enumeration, interface recommendation, open/close/test actions and WebSocket state.
- **WP-08 — protocol + Master Workstation:** shared FC01/02/03/04/05/06/07/08/11/12/15/16/17/20/21/22/23/24/43 support, unknown/vendor PDU preservation, 16/32/64-bit exact decoding, floats, strings/BCD/timestamps, persistent poll jobs and guarded writes.
- **WP-09 — Discovery:** read-only FC43-first discovery, fallback scans, adaptive address scanning, progress/cancel, evidence export, Master handoff and serial maintenance/exclusive-bus interlocks.
- **WP-10 — Simulator:** persistent server/device models, memory editor, dynamic generators, request/write evidence, isolated LAB fault injection and browser workspace.
- **WP-11 — Traffic + Register Lab:** bounded unified timeline, filters/search/bookmarks/evidence/error navigation and datatype/order/engineering interpretation with provenance.
- **WP-12 / 12B — Test Center:** guarded raw-frame studio, validated writes, repeat sends, versioned recipes, variables/assertions/repeat/pause/resume/stop, evidence and browser workflow isolation.
- **WP-13 — Charts/Logger/Historian:** bounded chart service, backend decimation, rotating JSONL logging, optional SQLite historian and browser history workspaces.
- **WP-14 — UDP:** bounded Modbus UDP client/server transports with explicit reply routing and IPv4/IPv6 low-level coverage.
- **WP-15 — tunnelling/TLS:** RTU/ASCII over TCP/UDP transport modes plus TLS client/server, certificate/key loading, trust configuration, mutual-TLS options and fail-closed behavior.
- **WP-16 — Digital Twin + Automation:** capture/Register-Lab-to-Simulator draft workflow with approval boundary, loopback-first automation client, CLI, JavaScript SDK and Python example client.
- **WP-17 — HMI Builder:** persistent screens/templates, edit/preview/run modes, snap grid, layers/properties, live reads, guarded writes through the shared Master safety path, recipe/screen actions and bulk-write confirmation.
- **WP-18 — Projects/Reports/Release hardening:** project clone/Save As, reusable project templates with preview, project-switch live-connection interlock, engineering handover ZIP, SHA-256 manifest, identity-aware exports, formula-injection/filename protection, strict connection import preflight/rollback, same-origin mutation protection, bounded mutation rate/body handling and v8 default/desktop promotion.

## Safety invariants enforced

- Passive Analyzer/replay ownership has no implicit transmit capability.
- Discovery is read-only and cannot inherit Master write permission.
- Serial resources have exclusive active ownership through the Connection Broker.
- Writes are per-connection, off by default, require a live connection, and re-lock on close/reopen/restart.
- Strong confirmation is enforced for bulk/write-sensitive operations; HMI FC16 requires explicit bulk confirmation as well as operator confirmation.
- Unit-0 serial broadcast is limited to supported write functions; read-bearing FC23 cannot be treated as no-response broadcast.
- Raw/Test/LAB capabilities are distinct from normal validated production requests.
- Fault injection exists only in the Simulator LAB path and is disabled by default.
- Every confirmed low-level write/raw/test transmission retains bounded audit evidence with connection, owner, transport, timestamp and transmitted HEX.
- Indeterminate serial writes are reported as `TRANSMISSION_OUTCOME_UNKNOWN`, force an error state and re-lock writes until close/reopen.
- Connection imports are bounded and preflighted as a complete set; failure rolls back rather than leaving a partial import.
- Browser cross-site mutation requests are rejected; mutation rate/body sizes are bounded while legitimate non-browser CLI/SDK calls without an Origin header remain supported.
- Persisted/imported connection state is configuration-only: no owner, write latch or fault-injection state can be restored armed.
- Project switching is blocked while any connection is active.

## Project and handover guarantees

- Original v7 source data is not silently rewritten during migration and a source backup/report is created.
- Same Unit IDs on different channels remain distinct through channel-scoped identity.
- Project JSON is validated and atomically persisted with backup/recovery behavior.
- Project clone/template creation strips live/armed runtime state.
- Engineering handover bundles include a manifest with product/version/schema metadata and SHA-256 hashes.
- Export surfaces retain channel/device/register identity where applicable.
- CSV text is protected against spreadsheet formula injection and generated filenames are sanitized.
- Handover content includes project configuration plus bounded Master/write-audit/Traffic/Simulator/Recipe/Historian/Chart/Logger/HMI/Digital-Twin evidence where available.

## Windows / SQLite hardening

The SQLite historian is activated lazily so product-server tests that do not configure historian streams do not open unnecessary database handles. Windows Node 22/24 CI isolates SQLite historian tests deterministically instead of skipping them or forcing process termination. CI also uses pull-request concurrency so obsolete heads do not block the current release candidate indefinitely.

## Release-candidate gate

PR #31 may be merged only when its **exact current head** passes all configured gates:

- version consistency
- lint and recursive v8 syntax checks
- runtime dependency audit
- Linux + Windows Node 20/22/24 tests
- Windows SQLite historian isolation coverage
- smoke and acceptance suites
- Chromium browser E2E

The release branch is intentionally not described as merged/released until those checks complete successfully.

## External acceptance still required

These are not missing software implementations; they require real equipment or field time:

- real RS485 transceiver/termination/noise/timing qualification
- representative third-party PLC/inverter/meter interoperability
- TLS interoperability against representative external endpoints/certificates
- long-duration site soak under actual traffic/load
- final Windows installer execution on clean target machines

`docs/SITE_ACCEPTANCE.md` remains the field evidence procedure for those gates.
