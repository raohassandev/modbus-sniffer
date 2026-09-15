# Security and Deployment Safety

## Scope

Modbus Engineering Analyzer is a local engineering workstation. Its normal RTU analyzer is passive; its Modbus TCP mode is an explicit inline proxy; active discovery is a separate guarded read-only operation.

## Local web service

- The web UI binds to loopback by default.
- State-changing API requests are protected by same-origin checks and mutation rate/body limits.
- WebSocket upgrades are origin checked.
- Security headers include content-type protection, referrer policy and a restrictive content-security policy.
- If the web server is intentionally exposed beyond loopback, place it only on a trusted engineering network and protect host access at the operating-system/network layer. The analyzer is not an Internet-facing multi-user service.

## Modbus RTU

Normal RTU capture must remain RX-only at the software level. Use a separate isolated/high-impedance USB-RS485 adapter in parallel with the production bus where practical. Software RX-only behavior does not prove the electrical characteristics of an adapter.

Active RTU discovery is a different operating mode. It requires explicit maintenance/exclusive-bus confirmation and only sends Device Identification requests (FC43 / MEI 0x0E). It does not send write function codes.

## Modbus TCP

The TCP analyzer is an inline forwarding proxy. Existing master bytes are forwarded to the selected target unchanged. The proxy binds to loopback by default; a non-loopback bind requires explicit confirmation. Each client/upstream pair is tracked as a session under the target channel so Unit IDs on different endpoints cannot collide.

Active TCP discovery opens a direct connection to the user-selected target and sends only read-only Device Identification requests. Discovery never writes configuration or process values.

## Imports and persistent data

- Workspace imports are schema/range/size validated before replacing the current workspace.
- Workspace writes use atomic replacement and preserve a known-good backup.
- Corrupt workspace input is preserved for recovery rather than silently replaced with a blank project.
- Legacy identities without reliable transport/channel provenance remain `Legacy / Unassigned` until the user explicitly assigns them.
- History uses bounded retention and repairs/preserves a partial final JSONL record after interrupted writes.

## Exports

XLSX and CSV data use spreadsheet formula-injection protection for user/device supplied text. Export filenames are normalized for Windows reserved names and unsafe path characters. Project ZIP exports contain diagnostics, captures, project/workspace data, history, channel-aware CSVs, Discovery evidence and adoption audit records.

Treat exported captures and project backups as engineering data. They may reveal device topology, addresses, endpoints and process values, so store and share them accordingly.

## Dependency and release controls

The repository checks in npm lockfiles. CI uses `npm ci`, runs syntax/unit/smoke/acceptance/browser tests, a conservative JavaScript safety lint, a runtime dependency audit, version-consistency checks and a processing/memory budget. The Windows build also performs a packaged-app backend smoke test and emits SHA-256 checksums plus build provenance.

Node 22 is the recommended runtime for v7 deployments. Node 20 remains a compatibility target for the v7.0 maintenance line; new deployments should prefer Node 22 or newer.

## Reporting a security issue

Do not post sensitive site captures, credentials, customer network details or production configurations in a public issue. Share a minimal sanitized reproduction with the repository maintainer through an appropriate private channel.

## Validation boundary

Software CI cannot prove RS485 electrical isolation, termination, grounding, EMC/noise behavior, USB adapter quality, firewall policy, real PLC/inverter timing or long-duration plant behavior. These remain field-acceptance responsibilities and must be tested on the intended hardware/network before production sign-off.
