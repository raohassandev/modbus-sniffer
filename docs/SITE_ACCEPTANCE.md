# Modbus Engineering Analyzer v7 — Site Acceptance Procedure

This procedure is the final hardware/network sign-off after software CI passes. Software tests cannot prove RS485 electrical behavior, real gateway timing, plant network policy or long-duration site stability.

## 1. Update and validate the workstation

```powershell
git pull origin main
npm ci
npm run version:check
npm test
npm run smoke
npm run acceptance
node scripts/benchmark-v7.js
```

All commands must pass before field acceptance. Node 22 is recommended for new deployments.

## 2. RTU passive-tap wiring

Use a second isolated/high-impedance USB-RS485 adapter in parallel with the live bus:

```text
Master A+ ----+---------------- Device A+
              +---- Sniffer A+
Master B- ----+---------------- Device B-
              +---- Sniffer B-
GND ----------+---------------- Device GND/reference
              +---- Sniffer GND/reference
```

Do not add a new 120-ohm terminator only for the sniffer. Normal RTU capture is software RX-only, but that does not guarantee the electrical behavior of a USB adapter; use appropriate isolated hardware for production tapping.

## 3. Start the analyzer

```powershell
npm start
```

Open `http://127.0.0.1:8080`, select the adapter and known serial settings, or use passive Quick Detect / Full Detect. Confirm the Dashboard mode badge says RTU passive capture and not an active/transmitting mode.

## 4. Capture enough normal traffic

Capture at least 60 seconds for fast polling. For 5 s / 10 s / 60 s groups, capture long enough to observe at least ten repetitions of the slowest expected group. Keep the analyzer attached while the process experiences normal load/state changes so engineering values and polling behavior can be compared against known equipment values.

## 5. Device and channel identity

On **Devices** and **Discovery**, verify:

- every expected RTU Slave ID appears under the correct RTU channel;
- duplicate Slave IDs on different physical buses remain separate devices;
- TCP Unit IDs are shown under the correct endpoint/channel;
- the same Unit ID behind two TCP gateways does not share registers, history, names or health;
- channel endpoint/serial configuration is correct.

For a ten-device RTU bus:

```powershell
npm run field-check -- --min-devices 10 --min-frames 500
```

If the site has an accepted amount of communication loss/noise, set documented thresholds rather than silently ignoring it.

## 6. Register and engineering-value validation

Spot-check at least two devices that use identical register addresses and verify their values remain isolated. For mapped engineering values, compare known voltage/current/power/energy or another trusted value against the equipment/HMI. Verify datatype, word/byte order, scale, offset and unit.

Multiword mappings must not overlap another mapping on the same device/function unless the engineering design intentionally changes the mapping first.

## 7. Polling and missing-response behavior

Compare at least three known polling groups with PLC/HMI settings. Use median interval and jitter rather than one sample. For a stable wired RTU bus, ±10% of the configured interval is a practical initial acceptance target unless the master intentionally schedules/bursts requests.

If safe and permitted, disconnect one non-critical slave during maintenance and confirm a missing reply becomes a `TIMEOUT` after the configured timeout. Do not interrupt production-critical equipment merely to create a test fault.

## 8. Passive Discovery and FC43 identity

Passive Discovery must not transmit. Where devices naturally answer FC43 / MEI 0x0E, confirm Vendor/Product/Model/Revision evidence is tied to the exact channel/device.

If an identity is adopted into the project, use Preview first and verify the exact target channel/device. Overwriting existing identification requires an explicit decision and must remain visible in the adoption audit.

## 9. Active Discovery safety

Active Discovery is intentionally separate from passive analysis.

For RTU, use it only during a maintenance window with exclusive-bus permission. Confirm both safety acknowledgements before scanning. For TCP, enter the exact intended target endpoint. Active Discovery sends only read-only FC43 / MEI 0x0E Device Identification requests; it must not be used as a general register scanner or write tool.

Stop the scan immediately if the site/equipment behavior is unexpected.

## 10. Modbus TCP inline-proxy acceptance

The TCP analyzer is an inline forwarding proxy, not a passive Ethernet tap.

1. Start with loopback binding where possible.
2. Configure the exact target host/port.
3. Point the existing Modbus TCP master/client at the analyzer listen endpoint.
4. Verify normal plant/client operation while the analyzer runs.
5. Confirm transaction IDs, Unit IDs, requests/responses, RTT and exceptions appear correctly.
6. Verify a controlled client disconnect is reported separately from a silent request timeout.
7. Confirm endpoint/channel identity remains stable across reconnects.

A non-loopback proxy bind requires explicit confirmation and should only be used on a trusted engineering/control network.

## 11. Capture, replay and handover

Save a `.mbcap`, stop live capture, reload it, and replay it at 2× or another accelerated speed. Polling intervals/RTT analysis must remain based on source timestamps rather than compressed replay wall-clock time.

From **Reports**, export the XLSX, PDF and complete ZIP. Verify the ZIP includes channel/device identity, Discovery evidence, Adoption Audit and the raw capture needed for later engineering review.

## 12. Desktop installer acceptance

On the intended Windows class of workstation:

- install the generated NSIS package;
- launch without requiring the source checkout;
- verify the UI and v7 backend start locally;
- connect the real USB-RS485 adapter and confirm the serial module opens it;
- restart the PC/app and verify project/history persistence;
- perform an upgrade install and confirm data is retained;
- uninstall and confirm project data retention/removal behavior follows the site policy.

Compare the installer/file checksum with `SHA256SUMS.txt` from the same CI artifact and retain `BUILD-PROVENANCE.txt` with the handover record.

## 13. Long-duration sign-off

A short 2-hour run is useful for commissioning, but final production sign-off should include a representative long-duration soak; 24 hours is the default target where site operations permit it.

During the soak confirm:

- no application/backend crash or restart;
- expected devices/channels remain stable;
- no unexplained rise in RTU noise or TCP parser errors;
- timeout/exception rates remain within the site threshold;
- register values and history continue updating;
- no unbounded memory growth or UI slowdown;
- exports still complete successfully near the end of the run.

## Acceptance record

```text
Site:
Date/time:
Analyzer commit/version:
Windows/Node version:
RTU adapter + serial number:
RTU COM / baud / data / parity / stop:
TCP listen endpoint (if used):
TCP target endpoint (if used):
Expected RTU slaves:
Expected TCP units/endpoints:
Detected devices/channels:
Capture duration:
Frames / requests / responses:
Timeout rate:
RTU noise ratio:
TCP MBAP/parser errors:
Unmatched response rate:
Average / P95 RTT:
Field-check result:
Discovery evidence run ID(s):
Capture filename:
Export ZIP filename:
Installer SHA-256:
Engineer:
Result: PASS / FAIL
Notes:
```

Production acceptance is valid for the tested hardware/site/network combination. A major wiring, adapter, gateway, firmware, master-program or network-topology change should trigger a focused re-validation.
