# Standard Modbus Engineering Workflow

**Branch:** `v8-release-completion`  
**Canonical scope:** `docs/MODBUS_ONLY_PRODUCT_AUDIT.md`

## Product rule

This application is not a SCADA/HMI/automation platform. It is an advanced Modbus engineering tool.

All workflows must support one or more of:

- Modbus testing
- simulation
- sniffing/traffic analysis
- register interpretation
- discovery/reverse engineering
- protocol diagnostics/conformance
- scripted test research
- capture/replay/compare
- evidence/reporting

## Primary workflows

### Sniffer

`Select capture -> Listen -> Decode -> Form devices -> Analyze timing/registers -> Save evidence`

### Master

`Connect -> Define request -> Read/Poll -> Interpret -> Inspect traffic -> Guarded write/test -> Save session`

### Slave

`Choose server transport -> Configure Unit IDs/memory -> Start -> Observe requests/writes -> Inject controlled LAB behavior -> Save map`

## Navigation target

### Core
- Sniffer
- Master
- Slave

### Analyze
- Traffic
- Register Lab
- Discovery
- Diagnostics

### LAB
- Test Center
- Device Clone
- Replay / Compare
- Test Sequences

### Evidence
- Logger / Trend
- Captures
- Reports / Export

### System
- Connections
- Help
- Settings

The following generic product labels are deprecated:

- HMI
- Automation
- Historian
- Digital Twin

Their allowed Modbus-specific replacements are:

- Automation -> Test Sequences / API
- Historian -> Logger / Trend
- Digital Twin -> Device Clone / Capture-to-Simulator
- HMI -> removed from this product

## Master parity

The familiar first-read workflow remains mandatory and simple. Advanced Modbus operations belong behind an Advanced area, not another product shell.

Required advanced Master surface:

- FC01/02/03/04 reads
- FC05/06/15/16 guarded writes
- FC22/23
- serial FC07/08/11/12/17
- FC20/21 file records
- FC24 FIFO
- FC43/14 identity
- broadcast
- address base/reference display
- multi-session monitors
- full datatype/byte-order formatting
- counters, traffic, logger and trend shortcuts

## Slave parity

Slave is a true Modbus simulator, not a digital dashboard:

- RTU/ASCII/TCP first-class server modes
- supported advanced transports under Transport Lab
- multiple Unit IDs
- four Modbus memory areas
- complete request/write visibility
- exceptions/identity/diagnostics
- controlled latency/fault behavior in LAB mode
- capture-to-simulator Device Clone

## Test Center

The Test Center is a core advanced capability, not optional decoration:

- custom raw frames
- CRC/LRC helpers
- expected response/masks
- repeatable recipes
- assertions
- timing and exception tests
- protocol boundary tests
- reusable regression suites

## Logging and charts

Logging/charting stay only as Modbus evidence tools:

- monitor/session logger
- register trend
- RTT/error trend
- replay dataset
- compare/diff
- report evidence

No generic plant historian/dashboard roadmap.

## Help

Help must cover:

- addressing/reference conventions
- function codes and transport applicability
- exception codes
- CRC/LRC/MBAP
- serial timing
- TCP transaction IDs
- datatype/byte order
- broadcast
- TLS/Modbus Security
- Master/Slave/Sniffer workflows
- Test Center/LAB safety

Remove HMI-builder help and generic automation help.

## Release implication

Product-scope cleanup is a release requirement. Source that is technically functional but points the user toward HMI/SCADA/generic automation still violates the product requirement.
