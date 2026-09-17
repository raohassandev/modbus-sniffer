# Modbus Engineering Workbench v8 — Standard Workflow and Parity Plan

**Status:** active product-usability work  
**Branch:** `v8-release-completion`  
**Goal:** make ordinary Modbus commissioning feel immediately familiar to engineers coming from Modbus Poll / ModScan while preserving the Workbench's stronger safety, evidence, simulation and automation layers.

## 1. Product rule

The default operator path must be simple:

1. **Connect**
2. **Define read/poll** — Slave/Unit ID, function, address, quantity, scan rate, timeout
3. **See live values in a grid**
4. **Change display interpretation**
5. **Inspect traffic when communication fails**
6. **Write only through an explicit guarded path**
7. **Log/chart only after communication and interpretation are proven**

Advanced tools must remain available without forcing a new user through them for a normal FC03/FC04 commissioning task.

## 2. Standard navigation order

Core workflow first:

- Connections
- Master / Poll
- Scan / Discovery
- Traffic
- Simulator

Engineering tools next:

- Register Lab
- Test Center
- Charts
- Historian

Advanced/system:

- Automation
- HMI
- Help
- Settings

## 3. Standard Monitor — required behavior

The Master workspace owns the normal Modbus Poll / ModScan-style monitor.

Definition fields:

- connection
- Slave / Unit ID
- FC01 / FC02 / FC03 / FC04
- canonical zero-based address
- reference-address hint (00001 / 10001 / 30001 / 40001 families)
- quantity
- scan rate
- timeout
- display format
- stop-on-error option

Runtime controls:

- Read once
- Start polling
- Stop
- direct jump to Traffic

Runtime evidence:

- request count
- successful response count
- error count
- last RTT
- live value grid
- raw value plus interpreted value

The first implementation is now in `public/v8/standard-monitor.js`. It intentionally reuses the central `/api/v8/master/read` path so transport ownership, request validation and Traffic evidence remain shared with the existing Master runtime.

## 4. Display / interpretation parity

Current Standard Monitor exposes the common quick formats:

- unsigned 16-bit
- signed 16-bit
- hexadecimal
- binary
- Float32 ABCD
- Float32 CDAB

Register Lab remains the authoritative advanced interpretation workspace for wider datatype/byte-order/scaling work.

Remaining parity work:

- [ ] persistent per-cell aliases/names
- [ ] all common 32/64-bit integer/float byte and word orders directly in Standard Monitor
- [ ] quick scale/offset/unit display without opening Register Lab
- [ ] conditional colors
- [ ] copy/paste friendly rectangular value selection

## 5. Write parity

Existing guarded writes support FC05, FC06, FC15 and FC16 with explicit confirmation and automatic re-locking.

Remaining standard-workflow work:

- [ ] safe write from a selected live-grid cell / selected range
- [ ] explicit write affordance that never makes a read-only cell look directly editable by accident
- [ ] FC22 Mask Write Register UI
- [ ] FC23 Read/Write Multiple Registers UI
- [ ] preserve central write audit and confirmation for every new UI path

## 6. Function-code exposure

Protocol core already includes standard primitives for:

- FC01 Read Coils
- FC02 Read Discrete Inputs
- FC03 Read Holding Registers
- FC04 Read Input Registers
- FC05 Write Single Coil
- FC06 Write Single Register
- FC15 Write Multiple Coils
- FC16 Write Multiple Registers
- FC22 Mask Write Register
- FC23 Read/Write Multiple Registers
- FC43/14 Read Device Identification

Standard UI exposure is currently strongest for FC01–04 and FC05/06/15/16; FC43/14 is used by Discovery.

Remaining parity work where transport/device support applies:

- [ ] FC08 Diagnostics (serial)
- [ ] FC11 Get Comm Event Counter (serial)
- [ ] FC17 Report Server ID (serial)
- [ ] FC22 direct standard UI
- [ ] FC23 direct standard UI
- [ ] FC43/14 direct on-demand device-identification action in Master/Connections

## 7. Scan parity

Discovery already contains Unit/Slave and address scanning with a stronger safety model than a blind scanner.

Remaining simplification work:

- [ ] add a compact 'Slave Scan' preset matching familiar tools
- [ ] add a compact 'Address Scan' preset matching familiar tools
- [ ] clearer progress/ETA and stop state
- [ ] one-click adopt confirmed scan range into Standard Monitor

## 8. Traffic parity

Traffic already provides Tx/Rx/error evidence, raw HEX, decoded/timing views, filtering, bookmarks and copy actions.

Remaining familiar-tool improvements:

- [ ] per-monitor Tx / Error counters beside the live grid
- [ ] clear counters button
- [ ] direct 'show only this monitor' filter
- [ ] communication traffic pop-out / focused view if desktop shell support is added

## 9. Logging and charts

The product already has Charts/Logger/Historian capabilities but they are too far from the ordinary read definition.

Remaining integration:

- [ ] 'Chart this range' from Standard Monitor
- [ ] 'Log this range' from Standard Monitor
- [ ] saved monitor definition can be promoted to Logger/Historian without re-entering Unit/FC/address/quantity

## 10. Multiple monitor sessions

Familiar master tools allow several simultaneous read definitions.

Remaining work:

- [ ] first-class Monitor Session model
- [ ] multiple monitor tabs/documents with independent Unit/FC/address/quantity/rate/format
- [ ] save/reopen monitor sessions with the project
- [ ] pause/disable individual session without deleting it
- [ ] duplicate monitor session

The current persistent Polling Job model is not a replacement for a user-facing monitor-document model; it should remain the advanced scheduler layer underneath or beside it.

## 11. Help and discoverability

Implemented:

- [x] in-app Help workspace
- [x] F1 context help
- [x] Quick Start
- [x] help for Connections, Master/Poll, Discovery, Traffic, Simulator, Register Lab, Test Center, Charts, Historian, Automation, HMI and Settings
- [x] addressing reference (zero-based versus 00001/10001/30001/40001)
- [x] function-code guide
- [x] recommended troubleshooting workflow

Remaining:

- [ ] inline '?' help next to complex fields
- [ ] first-run guided walkthrough
- [ ] examples for common meter/inverter register maps
- [ ] direct link from error messages to the relevant help topic

## 12. Release implication

These usability gaps are product gaps, not field-only acceptance items. A release-candidate PASS must be rerun on the final exact head after each source/UI commit. Do not merge PR #31 based only on previous exact-head evidence.
