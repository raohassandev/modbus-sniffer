# Export Results — v6.1

The **Reports** page now has one **Export Results** control with four primary outputs.

## Excel Workbook (.xlsx)

`GET /api/export/results.xlsx`

The workbook contains these sheets:

- Summary
- Devices
- Polling Groups
- Registers
- Engineering Values
- Timeouts
- Exceptions
- Traffic
- Project History

Each data sheet has a frozen header row and filters. Device names come from the active project, while raw protocol values come from the current capture/runtime state.

## Engineering Report (.pdf)

`GET /api/export/report.pdf`

The generated PDF contains project/site/bus information, health summary, diagnostic findings, device statistics, polling groups and engineering values. Very large tables are intentionally truncated in the PDF; the full datasets remain available in Excel and ZIP exports.

## Raw Capture (.mbcap)

`GET /api/capture/export.mbcap`

This is the replayable Modbus capture already supported by the analyzer. It includes current project metadata.

## Complete Project Backup (.zip)

`GET /api/export/project.zip`

The ZIP is the recommended handover/archive format. It contains:

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
csv/
  devices.csv
  polling-groups.csv
  registers.csv
  engineering-values.csv
  traffic.csv
```

The archive therefore contains both human-readable results and the data needed to reproduce/review the engineering analysis later.

## Individual exports

The Reports page also keeps individual CSV/JSON exports under **Individual CSV / JSON exports** for quick use:

- Devices CSV
- Polling Groups CSV
- Registers CSV
- Engineering CSV
- Traffic CSV
- Workspace JSON
- Printable HTML report

## Validation

The v6.1 smoke test downloads the XLSX, PDF and ZIP endpoints, checks their file signatures and content types, and opens the generated XLSX to verify all expected worksheet names. The normal Windows/Linux CI matrix runs this smoke test automatically.
