# v8 Implementation Status and Release-Candidate Audit

**Last audited:** 2026-09-16  
**Release-candidate version:** 8.0.0  
**Release branch:** `v8-release-completion`  
**Integration PR:** #31  
**Compatibility runtime:** v7 remains available through the explicit `npm run v7` command.

## Current release boundary

The v8 all-in-one Modbus Engineering Workbench is now the default runtime on the release-candidate branch. `npm start`, the package entry point, and the Windows desktop launcher use `src/index-v8.js`. The desktop shell opens the v8 UI and checks `/api/v8/status`. v7 is retained only as an explicit compatibility path.

This document records implemented software state on PR #31. A feature is not considered released on `main` until the exact PR head passes the configured release validation and is merged. Release validation for this repository runs on the existing Automatrix self-hosted Apple-silicon Mac runner. Real RS485 electrical behavior, representative third-party device interoperability, and clean Windows installer execution remain field/hardware acceptance gates and cannot be manufactured by software CI.

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
- **WP-11 — Traffic + Register Lab:** bounded unified timeline, filters/search/bookmarks/evidence/error navigation and datatype/order/engineering interpretation with provenance. Traffic and Register Lab both use virtualized row windows for large retained datasets; Register Lab requests up to 10,000 live points.
- **WP-12 / 12B — Test Center:** guarded raw-frame studio, validated writes, bounded repeat sends, versioned recipes, variables/assertions/repeat/pause/resume/stop, evidence and browser workflow isolation. Recipe expansion and nesting are preflight-bounded before transport acquisition.
- **WP-13 — Charts/Logger/Historian:** bounded chart service, backend decimation, rotating JSONL logging, optional SQLite historian and browser history workspaces.
- **WP-14 — UDP:** bounded Modbus UDP client/server transports with explicit reply routing and IPv4/IPv6 low-level coverage.
- **WP-15 — tunnelling/TLS:** RTU/ASCII over TCP/UDP transport modes plus TLS client/server, certificate/key loading, trust configuration, mutual-TLS options and fail-closed behavior.
- **WP-16 — Digital Twin + Automation:** capture/Register-Lab-to-Simulator draft workflow with approval boundary, loopback-first automation client, CLI, JavaScript SDK and Python example client.
- **WP-17 — HMI Builder:** persistent screens/templates, edit/preview/run modes, snap grid, layers/properties, live reads, guarded writes through the shared Master safety path, recipe/screen actions and bulk-write confirmation.
- **WP-18 — Projects/Reports/Release hardening:** project clone/Save As, reusable project templates with preview, project-switch live-connection interlock, engineering handover ZIP, SHA-256 manifest, identity-aware exports, formula-injection/filename protection, secret redaction, strict connection import preflight/rollback, same-origin HTTP/WebSocket browser protections, bounded mutation/body/realtime resources and v8 default/desktop promotion.

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
- Browser realtime WebSocket handshakes require same-origin. No-Origin local SDK/automation clients remain supported; WebSocket payload and client counts are bounded.
- Persisted/imported connection state is configuration-only: no owner, write latch or fault-injection state can be restored armed.
- Project switching is blocked while any connection is active.
- Recipe repeat nesting and total expanded execution are bounded before opening/claiming transport resources.
- Simulator expressions use a restricted parser/RPN evaluator rather than arbitrary JavaScript execution; generator count, schedule size and formula length are bounded.
- Handover reports redact credential/private-key fields while preserving engineering identity and typed evidence.
- Persistent desktop diagnostics redact credential patterns and accidental PEM private-key content before disk write.

## Project and handover guarantees

- Original v7 source data is not silently rewritten during migration and a source backup/report is created.
- Same Unit IDs on different channels remain distinct through channel-scoped identity.
- Project JSON is validated and atomically persisted with backup/recovery behavior.
- Project clone/template creation strips live/armed runtime state.
- Engineering handover bundles include a manifest with product/version/schema metadata and SHA-256 hashes.
- Export surfaces retain channel/device/register identity where applicable.
- CSV text is protected against spreadsheet formula injection and generated filenames are sanitized.
- Handover content includes project configuration plus bounded Master/write-audit/Traffic/Simulator/Recipe/Historian/Chart/Logger/HMI/Digital-Twin evidence where available.
- Historian is enabled by default unless a logger profile explicitly sets `historian: false`; handover tags follow the same rule.
- Known credential/private-key fields are redacted from handover content before hashing/archiving.

## UI / scale hardening

- Command palette and document tabs support keyboard-first navigation.
- Connection Center and Register Lab core rows are keyboard focusable; selection/navigation has keyboard equivalents.
- Visible focus and reduced-motion preferences are respected.
- Light/Dark core contrast regression checks and 1366×768 / 1920×1080 Chromium acceptance are included.
- Traffic and Register Lab use row-window virtualization rather than rendering the complete retained dataset into the DOM.
- `benchmark:v8` covers 100 poll jobs, 100 Unit IDs, 10,000 Register Lab points and 100,000 Traffic events with time/heap ceilings.
- `soak:v8` provides a concurrent v8 Master/Slave/PollScheduler/Traffic/RegisterLab/Chart workload with a short regression in `npm test` and configurable long-duration execution.

## SQLite / runner hardening

The SQLite historian is activated lazily so product-server tests that do not configure historian streams do not open unnecessary database handles. The repository includes deterministic SQLite lifecycle/isolation coverage and bounded test execution so a test cannot hold the release runner indefinitely. Release CI is routed to the existing Automatrix self-hosted Mac runner using labels `self-hosted`, `macOS`, `ARM64`, `automatrix-ci`, and `automatrix-mac`. Node 20, 22 and 24 validation is serialized on that runner to avoid resource contention.

## Release-candidate gate

PR #31 may be merged only when its **exact current head** passes all configured software gates on the self-hosted Mac runner:

- release/version consistency
- lint and recursive v8 syntax checks
- runtime dependency audit
- Node 20 / 22 / 24 full tests
- smoke and acceptance suites
- Chromium browser E2E

The guarded release-metadata sync must first change only the root-version fields in the two npm lockfiles to 8.0.0 and remove its temporary workflow helper. The release branch is intentionally not described as merged/released until those checks complete successfully.

## External acceptance still required

These are not missing software implementations; they require real equipment or target-platform time:

- real RS485 transceiver/termination/noise/timing qualification
- representative third-party PLC/inverter/meter interoperability
- TLS interoperability against representative external endpoints/certificates
- long-duration site soak under actual traffic/load
- 24-hour virtual/TCP soak execution evidence
- multi-hour Historian/logger disk-growth and reopen evidence
- final Windows installer execution on clean target machines

`docs/SITE_ACCEPTANCE.md` remains the field evidence procedure for those gates.
