# Export Results — v7 transport-aware handover

The **Reports** page exposes one **Export Results** control with four primary outputs. Exports are transport-aware: protocol rows carry Transport, Channel, Endpoint, Device Key and Unit/Slave identity where relevant so same-numbered devices on different RTU/TCP channels remain distinguishable in the handover package.

## Excel Workbook (.xlsx)

`GET /api/export/results.xlsx`

The workbook contains these sheets:

- Summary
- Channels
- Devices
- Polling Groups
- Registers
- Engineering Values
- Timeouts
- Exceptions
- Traffic
- Discovery
- Adoption Audit
- Project History

Each data sheet has a frozen header row and filters.

**Channels** records transport, channel ID, mode, endpoint, state and available per-channel health/traffic values.

**Discovery** records saved active-identification evidence including run/job ID, target, Unit/Slave ID, response state, FC43 support, Vendor/Product/Model/Revision, RTT and whether the evidence was adopted.

**Adoption Audit** records the explicit evidence-to-project binding: source discovery run, exact channel, device key, Unit/Slave ID, adoption time, whether existing identification was overwritten, and which fields were overwritten.

Device names and adopted identification come from the active project; raw protocol values come from the current capture/runtime state.

## Engineering Report (.pdf)

`GET /api/export/report.pdf`

The generated PDF is independent of the browser light/dark theme and contains project/site/bus information, global summary, diagnostic findings, **per-channel transport health**, device statistics, polling groups, engineering values, Discovery evidence and identification-adoption audit records. Very large tables are intentionally truncated in the PDF; the complete datasets remain in Excel/ZIP.

## Raw Capture (.mbcap)

`GET /api/capture/export.mbcap`

This is the replayable Modbus capture. It includes current project metadata and the transport-aware capture schema used by the runtime.

## Complete Project Backup (.zip)

`GET /api/export/project.zip`

The ZIP is the recommended engineering handover/archive format. Its manifest is version 2 and it contains:

```text
manifest.json
results/
  modbus-results.xlsx
  modbus-report.pdf
  modbus-report.html
  diagnostics.json
capture/
  current.mbcap
project/
  project.json
  all-workspaces-and-profiles.json
  history.json
  discovery-evidence.json
  discovery-adoptions.json
csv/
  channels.csv
  devices.csv
  polling-groups.csv
  registers.csv
  engineering-values.csv
  traffic.csv
  discovery.csv
  discovery-adoptions.csv
```

The archive therefore contains both human-readable results and the evidence required to review how an FC43 identity was discovered and, when approved by an operator, adopted into an exact project channel/device.

## Individual exports

The Reports page also retains the individual CSV/JSON exports for quick use. The unified XLSX/PDF/ZIP outputs should be preferred for project handover because they preserve the channel/device identity context.

## Filename safety

Generated project filenames are normalized for Windows-invalid separators/control characters, Windows reserved names such as `CON`, and excessive length while retaining valid Unicode project text.

## Validation

Smoke tests download XLSX, PDF and ZIP outputs, verify signatures/content types, open the XLSX with ExcelJS, require all worksheet names above, and verify the leading transport identity columns. Unit tests separately verify Discovery/adoption flattening and filename edge cases. The Windows/Linux CI matrix runs the validation automatically.
