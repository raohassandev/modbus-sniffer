# Modbus Engineering Workbench v8 — Site Acceptance Procedure

This procedure is the final hardware/network sign-off after the exact software release head has passed the local Mac release gate. Software validation cannot prove RS485 electrical behavior, real gateway timing, plant network policy, third-party device behavior or long-duration site stability.

Record the exact Workbench commit used for every acceptance run. Do not mix evidence from different commits without explicitly documenting the change.

## 1. Verify the release workstation and evidence

Before field acceptance, confirm the exact software head has valid local Mac release evidence as defined in `LOCAL_MAC_RELEASE_GATE.md`.

On the engineering workstation, verify the checked-out release source:

```powershell
git rev-parse HEAD
npm ci
npm run version:check
npm run check:v8
npm test
npm run smoke
npm run acceptance
```

For the final software release decision, the authoritative Mac evidence is produced by:

```bash
npm run release:gate:mac
```

The release evidence SHA must match the commit used for field work. Node 22 is recommended for normal field execution; the release gate separately validates Node 20, 22 and 24.

## 2. RTU passive-tap wiring

Use a second isolated/high-impedance USB-RS485 adapter in parallel with the live bus:

```text
Master A+ ----+---------------- Device A+
              +---- Workbench tap A+
Master B- ----+---------------- Device B-
              +---- Workbench tap B-
GND ----------+---------------- Device GND/reference
              +---- Workbench tap GND/reference
```

Do not add a new 120-ohm terminator only for the passive tap. Software RX-only behavior does not prove the electrical behavior of a USB adapter; use appropriate isolated hardware for production tapping.

## 3. Start Workbench v8

```powershell
npm start
```

Open:

```text
http://127.0.0.1:8088/v8/
```

Confirm the active connection/mode shown by the v8 shell matches the intended capability. For passive analysis, verify the selected path has no active transmit/write ownership. For Master, Discovery, Simulator or Test Center work, confirm the displayed ownership matches the operation being performed.

## 4. Capture enough normal traffic

For passive/observed traffic, capture at least 60 seconds for fast polling. For 5 s / 10 s / 60 s groups, capture long enough to observe at least ten repetitions of the slowest expected group.

Keep the Workbench attached while the process experiences representative load/state changes so engineering values, request intervals and responses can be compared against known equipment/HMI values.

Retain raw evidence and timestamps needed to reproduce the observation.

## 5. Device and channel identity

Verify throughout Traffic, Register Lab, Discovery and project/report surfaces that:

- every expected RTU Slave/Unit ID appears under the correct RTU channel;
- duplicate Unit IDs on different physical buses remain separate devices;
- TCP Unit IDs are shown under the correct endpoint/channel;
- the same Unit ID behind two TCP gateways does not share registers, history, names or health;
- channel endpoint/serial configuration is correct;
- exported handover evidence preserves channel/device identity.

For a ten-device RTU bus where the legacy field-check helper is applicable:

```powershell
npm run field-check -- --min-devices 10 --min-frames 500
```

If the site has an accepted amount of communication loss/noise, record explicit thresholds rather than silently ignoring it.

## 6. Register and engineering-value validation

Spot-check at least two devices that use identical register addresses and verify their values remain isolated by channel/device identity.

For mapped engineering values, compare known voltage/current/power/energy or another trusted value against the equipment/HMI. Verify:

- function/area
- address notation
- datatype
- word/byte order
- scale
- offset
- engineering unit
- signed/unsigned interpretation

For 32/64-bit values, verify every source register word and byte order against the device documentation or trusted reference value.

Multiword mappings must not unintentionally overlap another mapping on the same device/function.

## 7. Master polling and missing-response behavior

Where the Workbench is intentionally operating as Master, compare at least three known polling groups with the expected configuration. Use median interval and jitter rather than one sample.

For a stable wired RTU bus, ±10% of the configured interval is a practical initial observation target unless the application intentionally schedules or bursts requests differently.

If safe and permitted, disconnect one non-critical slave during a maintenance window and confirm a missing reply becomes a timeout after the configured timeout/retry policy. Do not interrupt production-critical equipment merely to create a test fault.

Confirm repeated polling remains serialized according to the configured connection/bus policy and does not create unintended concurrent RTU requests.

## 8. Discovery safety and identity

Discovery is read-only.

For RTU, use active scanning only during a maintenance window or with confirmed exclusive-bus permission when the site topology requires it. For TCP, enter the exact intended endpoint/channel.

The v8 Discovery flow may use FC43/MEI Device Identification first and read-only FC01-04 fallback/adaptive scanning where configured. It must never gain write permission or send write function codes.

For each discovered device:

- retain the request/response evidence;
- verify the exact channel and Unit ID;
- compare Vendor/Product/Model/Revision where FC43 evidence exists;
- preview adoption before changing project identity/mapping data;
- verify adopted identity remains scoped to the intended device/channel.

Stop the scan immediately if equipment/site behavior is unexpected.

## 9. Write-safety acceptance

Perform write testing only on an approved non-critical target or maintenance setup.

Before the first write confirm:

- the intended connection is live under Master ownership;
- writes are initially locked;
- the exact Unit ID, function code and address are documented;
- the operator explicitly enables/authorizes the write path;
- bulk/broadcast confirmation is required where applicable;
- HMI multi-register/effective FC16 writes require the explicit bulk confirmation path;
- read-back is used where supported and meaningful.

After a confirmed write, verify the write audit contains the expected connection, target, timestamp and transmitted evidence.

Close/reopen the connection and verify write permission returns to the safe locked state.

Do not deliberately create indeterminate production writes. If a real serial transmission outcome becomes unknown, verify the Workbench reports `TRANSMISSION_OUTCOME_UNKNOWN` and re-locks writes.

## 10. Simulator / Digital Twin / LAB acceptance

For virtual testing:

- verify generated Digital Twins remain review-gated before run;
- verify an unrelated existing Simulator server cannot be silently overwritten by a Digital Twin apply;
- verify generated devices are read-only by default unless writable areas were explicitly selected;
- approve the generated server explicitly before start;
- keep LAB fault injection isolated from production/passive channels;
- confirm LAB state is not restored armed after project reopen/restart.

Fault injection must never be connected to a production proxy/passive path.

## 11. Modbus TCP inline/proxy acceptance

When using an inline forwarding/proxy topology, treat it as active network infrastructure rather than a passive Ethernet tap.

1. Start with loopback binding where possible.
2. Configure the exact target host/port.
3. Point the intended Modbus TCP master/client at the Workbench listen endpoint.
4. Verify normal client/device operation while the Workbench runs.
5. Confirm transaction IDs, Unit IDs, requests/responses, RTT and exceptions appear correctly.
6. Verify a controlled client disconnect is reported separately from a silent request timeout.
7. Confirm endpoint/channel identity remains stable across reconnects.
8. Confirm forwarded production payload semantics are not altered by analysis/reporting features.

A non-loopback bind requires explicit engineering intent and should only be used on a trusted engineering/control network.

## 12. TLS interoperability acceptance

For TLS profiles, test against representative external endpoints/certificates used by the deployment.

Verify as applicable:

- trusted CA behavior
- hostname/SNI verification
- server certificate rejection when trust/identity is wrong
- client-certificate/mTLS policy
- private-key/certificate path handling
- no silent downgrade to plain TCP
- diagnostic/report/log surfaces do not expose private-key material

Retain certificate-policy details without copying private keys into acceptance records.

## 13. Handover export and reopen

Create the v8 engineering handover bundle and inspect its manifest/hashes.

Verify available evidence includes the expected project configuration and applicable bounded evidence for Master/write audit, Traffic, devices/registers, Simulator, recipes, Historian/logger/charts, HMI and Digital Twin definitions.

Check that:

- channel/device/register identity is retained;
- CSV text is protected from spreadsheet formula injection;
- generated filenames are safe;
- known credential/private-key fields are redacted;
- manifest SHA-256 hashes match the exported files.

Close and reopen the project/workstation and verify project configuration remains readable and live/armed states do not restore unsafe ownership or write permission.

## 14. Desktop installer acceptance

On the intended Windows class of workstation:

- build or obtain the exact Workbench 8.0.0 NSIS package for the tested commit;
- install the generated NSIS package;
- launch without requiring the source checkout;
- verify the Workbench v8 backend exposes `/api/v8/status` locally;
- verify the UI opens the v8 workspace;
- connect the real USB-RS485 adapter and confirm the serial module opens it;
- restart the PC/app and verify project/history persistence;
- perform an upgrade install and confirm data is retained according to policy;
- uninstall/reinstall and confirm project-data behavior follows site policy;
- verify Windows Defender/firewall behavior for the intended local/network bind;
- verify target serial drivers.

When the packaging workflow or equivalent build procedure creates `SHA256SUMS.txt` and `BUILD-PROVENANCE.txt`, retain both with the installer/handover record and verify the installer checksum before installation.

The repository Windows workflow is manual-only; Windows acceptance is not automatically implied by merging the source branch.

## 15. Long-duration sign-off

A short commissioning run is useful, but final production sign-off should include representative long-duration evidence. A 24-hour target is the default where site operations permit it.

For the virtual/TCP Workbench soak harness:

```powershell
npm run soak:v8 -- --seconds 86400
```

During the soak confirm:

- no application/backend crash or unexplained restart;
- expected devices/channels remain stable;
- no unexplained rise in RTU noise or TCP parser errors;
- timeout/exception rates remain within the site threshold;
- register values, charts and history continue updating;
- logger/Historian retention and disk growth remain bounded as configured;
- no unbounded memory growth or UI slowdown;
- reconnect/handle behavior remains stable;
- project export/handover still completes successfully near the end of the run;
- project reopen works after the soak.

Retain exact commit SHA, start/end timestamps, environment details and logs for the long-duration run.

## Acceptance record

```text
Site:
Date/time:
Workbench commit:
Workbench version:
Local Mac release evidence ID/path:
Field workstation OS/Node version:
Windows installer provenance (if applicable):
Windows installer SHA-256 (if applicable):
RTU adapter + serial number:
RTU COM / baud / data / parity / stop:
TCP listen endpoint (if used):
TCP target endpoint (if used):
TLS endpoint/policy (if used):
Expected RTU units:
Expected TCP units/endpoints:
Detected devices/channels:
Capture/observation duration:
Frames / requests / responses:
Timeout rate:
RTU noise ratio:
TCP MBAP/parser errors:
Unmatched response rate:
Average / P95 RTT:
Field-check result (if applicable):
Discovery evidence run ID(s):
Write-safety test target/result (if applicable):
Handover ZIP filename:
Handover manifest verification:
24-hour soak evidence path/result (if applicable):
Engineer:
Result: PASS / FAIL
Notes:
```

Production acceptance is valid only for the tested software commit, hardware, site and network combination. A major Workbench revision, wiring change, adapter/gateway change, device firmware change, master-program change or network-topology change should trigger focused re-validation.
