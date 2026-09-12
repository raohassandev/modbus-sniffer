# Modbus Sniffer v4.1 — Site Acceptance Procedure

This procedure is the final sign-off step after automated software acceptance passes. It requires a real passive USB-RS485 tap connected to the live bus.

## 1. Update and run software validation

```powershell
git pull origin main
npm install
npm test
npm run acceptance
npm run soak
```

All commands must finish with PASS before field validation.

## 2. Connect the passive tap

Connect the second USB-RS485 adapter in parallel with the existing bus:

```text
Master A+ ----+---------------- Device A+
              +---- Sniffer A+
Master B- ----+---------------- Device B-
              +---- Sniffer B-
GND ----------+---------------- Device GND
              +---- Sniffer GND
```

Use an isolated adapter where possible. Do not add another 120-ohm terminator only for the sniffer. The application does not transmit Modbus frames.

## 3. Start the analyzer

```powershell
npm start
```

Open:

```text
http://127.0.0.1:8080
```

Select the COM port. Either enter the known serial format or run Quick Detect / Full Detect.

## 4. Minimum capture period

Allow at least 60 seconds of normal master polling before judging polling intervals. For slow 5 s / 10 s / 60 s groups, capture long enough to obtain at least 10 repetitions of the slowest group.

## 5. Automatic device validation

On **Devices**, verify that every expected Slave ID forms automatically.

For a ten-device bus, run:

```powershell
npm run field-check -- --min-devices 10 --min-frames 500
```

Expected result:

```text
FIELD ACCEPTANCE CHECK: PASS
```

If the site intentionally has occasional timeouts or line noise, thresholds can be adjusted:

```powershell
npm run field-check -- --min-devices 10 --max-timeout-pct 2 --max-noise-pct 0.5
```

## 6. Register isolation validation

Where two slaves expose the same Modbus register addresses, verify their values remain separate under their own Slave IDs. The automated software suite tests this behavior, but a real-site spot check should still be made against one known value from at least two devices.

## 7. Poll interval validation

Choose at least three known polling groups and compare the analyzer median interval to the PLC/HMI configured interval.

Recommended acceptance tolerance:

- stable wired RTU bus: within ±10% of configured poll interval
- intentionally scheduled or burst polling: judge the median plus jitter, not one sample

## 8. Missing-response validation

If safe and permitted, temporarily disconnect one non-critical slave or use a controlled maintenance condition. Confirm that requests to that slave become explicit `TIMEOUT` events after the configured request timeout.

Do not interrupt a production-critical control device only to perform this test. If no safe interruption is possible, mark this item as laboratory-validated; the automated acceptance suite already verifies the timeout engine.

## 9. Exception validation

If a real exception reply naturally occurs, verify the exception code/name is shown under Live Traffic and the device. Do not intentionally send invalid Modbus requests from this passive application; it has no transmit path.

## 10. Capture/replay validation

Save a `.mbcap` file from **Sessions**, stop live capture, reload the file, and replay it at 2×. Confirm devices, polling groups, registers and values rebuild from the saved session.

## 11. Long-run validation

For production sign-off, leave the analyzer running for at least 2 hours while the master performs normal polling. Then run:

```powershell
npm run field-check -- --min-devices <expected-device-count> --min-frames 1000
```

Confirm:

- no application crash
- expected device count remains stable
- no unexplained rise in noise bytes
- timeout rate is appropriate for the site
- register values continue updating
- polling intervals remain stable
- browser remains responsive

## Acceptance record

Record these values when signing off:

```text
Site:
Date/time:
USB-RS485 adapter:
COM port:
Baud / data / parity / stop:
Expected slaves:
Detected slaves:
Capture duration:
Frames:
Requests:
Responses:
Timeout rate:
Noise ratio:
Unmatched response rate:
Average RTT:
P95 RTT:
Field-check result:
Capture filename:
Engineer:
```

When the automated software acceptance, field-check, and the real-bus checks above all pass, the Modbus Sniffer v4.1 release can be marked production accepted for that hardware/site combination.
