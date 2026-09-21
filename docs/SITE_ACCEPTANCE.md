# Modbus Engineering Tool 8.0.0 — L8-F Site / Windows Acceptance

This procedure is the final acceptance boundary for the **unified Modbus Engineering Tool**. It applies only to the exact tested commit, workstation, adapter/gateway, device firmware and network topology.

Software source completion is not proof of RS485 electrical behavior, third-party device interoperability, Windows driver behavior or site-network policy.

## 1. Freeze exact release identity

Record:

- Git commit SHA
- product version
- workstation OS / architecture
- Node version when running from source
- installer SHA-256 and BUILD-PROVENANCE when using Windows desktop
- date/time and engineer

The unified runtime entrypoint is:

`src/index-v7.js`

Normal source launch:

```bash
npm start
```

Normal browser URL:

```text
http://127.0.0.1:8080/
```

The former `/v8/` compatibility shell is not a shipped product surface.

## 2. Exact-head automated runtime acceptance

Before field work, the exact checkout must pass the automated source gates.

Cross-platform fast gate:

```bash
npm ci
npm run preflight
```

L8-F runtime lifecycle gate:

```bash
npm run acceptance:l8f -- --expect-head <COMMIT_SHA> --json-out ./l8f-runtime.json
```

The L8-F runtime gate verifies:

- unified product/version identity
- critical UI assets and blocked compatibility shell
- serial enumeration API safety
- built-in TCP Slave startup
- Master → Slave FC03 loopback read
- write lock initially LOCKED
- unsafe FC16 bulk write rejected before transmission
- failed/non-transmitted write audit evidence
- Raw Lab and Slave LAB unarmed by default
- restart does not restore Master connection, write enable, running Slave or LAB arming

On macOS, the exhaustive release evidence gate is:

```bash
npm run release:gate:mac
```

It validates Node 20/22/24, source/test/smoke/acceptance, benchmarks, bounded soak, unified browser E2E and internal compatibility regression coverage while preserving exact-head evidence.

## 3. Passive RTU Sniffer acceptance

Use an isolated/high-impedance USB-RS485 adapter in parallel with the live bus.

Recommended tap:

```text
Master A+ ----+---------------- Device A+
              +---- Analyzer tap A+
Master B- ----+---------------- Device B-
              +---- Analyzer tap B-
GND ----------+---------------- Device reference
              +---- Analyzer tap reference
```

Do not add a new termination resistor only for the passive tap.

Verify:

- correct COM device and baud/data/parity/stop configuration
- passive Analyzer does not transmit
- expected Unit IDs appear
- polling groups and intervals are learned
- requests and responses pair correctly
- known register values agree with a trusted meter/HMI/reference
- timeout/noise/unmatched-response rates remain within site limits
- duplicate Unit IDs on different channels remain isolated

Collect at least ten repetitions of the slowest expected polling group.

Machine-readable evidence:

```bash
npm run field-check -- \
  --min-devices <N> \
  --min-frames <N> \
  --max-noise-pct <LIMIT> \
  --max-timeout-pct <LIMIT> \
  --max-unmatched-pct <LIMIT> \
  --expect-version 8.0.0 \
  --expect-head <COMMIT_SHA> \
  --json-out ./field-acceptance.json
```

## 4. Master RTU acceptance

Use an approved non-critical device or maintenance setup.

Verify FC01–04 on representative addresses and quantities:

- connect with correct serial format
- Unit ID and address notation are correct
- Read Once returns trusted values
- cyclic polling remains serialized
- configured retry / inter-request delay works as expected
- RTS direction control works with the selected RS485 adapter when required
- timeouts are reported when a non-critical device is intentionally unavailable
- Traffic shows exact Tx/Rx evidence
- disconnect/reconnect does not restore an armed write state

For guarded writes, test only an approved writable point.

Verify:

- write state begins LOCKED
- explicit confirmation is required
- bulk/broadcast writes require stronger confirmation
- rejected write has `transmitted=false`
- successful write audit contains target/function/address/timestamp/evidence
- read-back verification works where supported
- write state returns LOCKED after operation/reconnect

## 5. Master TCP acceptance

Against a representative Modbus TCP device/gateway verify:

- endpoint and Unit ID
- FC01–04 reads
- MBAP transaction matching
- RTT and timeout behavior
- reconnect behavior
- multiple gateways with the same Unit ID remain distinct channels/devices
- no serial-only diagnostic is incorrectly offered as TCP-compatible

If using inline/proxy operation, treat the tool as active network infrastructure and verify forwarded request/response semantics remain unchanged.

## 6. Slave interoperability acceptance

Test the built-in Slave with at least one independent external Master/client.

Verify:

- TCP server start/stop and multiple client behavior
- representative FC01/02/03/04 reads
- representative guarded writable areas for FC05/06/15/16 where enabled
- Modbus exceptions for illegal function/address/value
- Unit-ID isolation
- Device Identification when used
- File Record/FIFO/diagnostic functions where applicable
- imported simulator maps preserve identity/memory
- LAB fault policy remains disabled unless explicitly armed
- dynamic generators require explicit LAB confirmation

For serial Slave mode, also verify actual adapter direction control and response timing.

## 7. TLS / mTLS interoperability

Use representative certificates/endpoints from the deployment.

Verify:

- Modbus TCP Security uses the intended TLS endpoint (default product guidance: port 802)
- trusted CA succeeds
- wrong/untrusted server certificate fails
- hostname/SNI policy behaves as configured
- mTLS client-certificate requirement behaves as configured
- there is no silent downgrade to plain TCP
- logs/status/export never expose private-key material
- restart/reconfigure does not require the application to expose retained private keys

Retain certificate subjects/fingerprints/policy in evidence. Never copy private keys into acceptance records.

## 8. Windows installer acceptance

The repository Windows workflow is manual-only and must be run against the exact release head.

It performs:

- source preflight
- Windows SQLite handle/isolation checks
- bounded synthetic soak
- unified Chromium browser acceptance
- runtime dependency audit
- NSIS build
- unpacked package smoke
- **actual silent NSIS install**
- installed application health/UI/serial-enumerator check
- compatibility-shell block check
- Defender/firewall/USB/serial inventory capture
- **actual silent uninstall**
- release provenance and SHA-256 generation

Required evidence from `desktop/dist`:

- `Modbus-Engineering-Tool-Setup-8.0.0.exe`
- `BUILD-PROVENANCE.txt`
- `SHA256SUMS.txt`
- `WINDOWS-ACCEPTANCE.json`
- `WINDOWS-ENVIRONMENT.txt`

On a representative production workstation additionally verify:

- installer launches without source checkout
- expected USB-RS485 driver creates the COM port
- real adapter opens successfully
- Defender does not quarantine/block the application
- required Windows Firewall behavior matches the intended loopback/network bind
- reboot preserves user/project data but does not restore live ownership/write/LAB states
- upgrade install retains user data according to policy
- uninstall behavior matches site data-retention policy

## 9. Device Clone / evidence acceptance

Verify:

- captured/discovered data can seed Device Clone / built-in Slave only after review
- generated simulator memory is scoped to the intended Unit/channel
- no simulator server is silently replaced
- writable areas are deliberate
- Traffic, Logger/Trend, Raw Lab and Compare exports preserve device/channel identity
- TLS/private-key fields are redacted
- CSV/export filenames and content remain safe

## 10. Long-duration acceptance

For software-only bounded stress:

```bash
npm run soak -- --cycles 50000
npm run soak:v8 -- --seconds 60
```

For final production commissioning, a representative long-duration run (24 hours where operations permit) should verify:

- no backend/UI crash or unexplained restart
- no unbounded memory/disk growth
- stable channel/device identity
- acceptable timeout/noise/exception rates
- Logger/Trend retention remains bounded
- reconnects do not leak handles/resources
- export still works near the end of the run
- restart/reopen remains safe

## 11. Acceptance record

```text
Site:
Date/time:
Engineer:
Result: PASS / FAIL

Commit SHA:
Product version:
Release evidence path/run:
Windows installer:
Installer SHA-256:
BUILD-PROVENANCE commit:

Workstation OS/architecture:
Node version (source run):
Defender/firewall result:
USB-RS485 adapter / serial:
COM / baud / data / parity / stop:

Passive RTU result:
Master RTU result:
Master TCP result:
External-Master Slave result:
TLS/mTLS result:

Expected devices:
Detected devices:
Observation duration:
Frames / requests / responses:
Timeout rate:
Noise ratio:
Unmatched-response rate:
Average / P95 RTT:

Write-safety target/result:
Field acceptance JSON:
L8-F runtime JSON:
Windows acceptance JSON:
Long-soak evidence:

Notes:
```

## 12. Final L8-F evidence convergence

Copy `docs/L8F_PHYSICAL_ACCEPTANCE.template.json` to an acceptance evidence folder and complete every physical check only from observed evidence on the exact release head.

After runtime, Windows, field and physical evidence all report PASS for the same commit/version, run:

```bash
npm run acceptance:l8f:final -- \
  --runtime ./l8f-runtime.json \
  --windows ./WINDOWS-ACCEPTANCE.json \
  --field ./field-acceptance.json \
  --physical ./L8F_PHYSICAL_ACCEPTANCE.json \
  --expect-head <COMMIT_SHA> \
  --json-out ./L8F-FINAL-ACCEPTANCE.json
```

The finalizer fails closed if any evidence is missing, not PASS, has the wrong evidence kind, belongs to another commit/version, does not match the current checkout, omits required automated checks, or marks a required physical category PASS without an evidence reference.

A major application revision, wiring change, adapter/gateway replacement, device firmware change, master-program change or network-topology change requires focused re-validation.
