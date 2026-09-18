# Modbus-Only Product Audit and Scope Contract

**Status:** canonical product-direction audit  
**Branch:** `v8-release-completion`  
**Product purpose:** one advanced desktop engineering tool for Modbus testing, simulation, analysis, reverse engineering, research, troubleshooting, evidence and protocol validation.

## 1. Scope rule

A feature belongs in this product only when its primary purpose is directly related to Modbus protocol work.

In scope:

- observe and decode Modbus traffic
- act as Modbus client/master
- act as Modbus server/slave simulator
- inspect, compare and interpret registers/coils
- discover Modbus devices, Unit IDs and address ranges
- generate, transmit and validate Modbus requests/responses
- analyze timing, retries, exceptions, CRC/LRC/MBAP and communication quality
- capture, replay, log, chart and compare Modbus evidence
- clone a captured Modbus device into a simulator for controlled testing
- run scripted Modbus test sequences
- test protocol limits, exception behavior, malformed frames and conformance in LAB mode
- export Modbus maps, captures, test evidence and reports
- support Modbus RTU, ASCII, TCP, UDP/tunnel variants and Modbus TCP Security/TLS where implemented

Out of scope:

- generic SCADA
- generic HMI screen building
- process visualization/dashboard building unrelated to protocol analysis
- PLC programming
- plant automation/control logic
- ERP/CMMS/asset-management functions
- general historian platform
- alarm-management platform unrelated to Modbus test evidence
- generic IoT dashboarding
- energy-management/control functionality
- arbitrary workflow automation that is not a Modbus test sequence

A feature that can be useful for Modbus but is currently named or designed generically must be **reframed around its Modbus engineering purpose**, not expanded into a second product.

## 2. Product architecture target

### Primary modes

1. **Sniffer / Analyzer**
   - passive RTU/ASCII observation
   - TCP/UDP/tunnel proxy analysis where applicable
   - request/response pairing
   - Unit ID/device formation
   - polling cadence, RTT, timeout, exception and noise analysis
   - register/change inference
   - capture/replay/evidence

2. **Master / Client**
   - direct connection
   - multiple monitor sessions
   - all supported read/write/diagnostic function codes
   - safe guarded writes
   - datatype/byte-order interpretation
   - scan/discovery actions
   - traffic, chart and logging shortcuts
   - broadcast and serial diagnostic tools where applicable

3. **Slave / Server Simulator**
   - RTU/ASCII/TCP and supported network variants
   - multiple Unit IDs
   - coils/discrete inputs/holding/input-register memory maps
   - direct value editing
   - incoming request/write evidence
   - scripted/dynamic values
   - protocol exception/fault behavior under explicit LAB mode
   - import/export device maps

### Advanced Modbus engineering tools

4. **Traffic Analyzer**
5. **Register/Data Lab**
6. **Discovery & Scan**
7. **Protocol Test Center / Raw Frame Studio**
8. **Device Clone / Capture-to-Simulator**
9. **Test Sequences / Scripting API**
10. **Modbus Logger / Trend**
11. **Diagnostics & Conformance**
12. **Capture / Replay / Compare**
13. **Reports / Export**
14. **Connection Profiles / Transport Lab**

These are support workspaces for Modbus work. None should become a generic automation or SCADA product.

## 3. Current repository module audit

### KEEP as core Modbus functionality

- `src/master/**` and `src/v8/master/**`
- `src/v8/slave/**`
- `src/v8/protocol/**`
- `src/v8/transports/**`
- `src/v8/traffic/**`
- `src/v8/discovery/**`
- `src/v8/testCenter/**`
- stable Sniffer/analyzer runtime and passive capture stack
- connection broker/ownership/safety
- project/session persistence needed to save Modbus work
- reporting/export needed for Modbus evidence

### KEEP but rename/reframe

#### `src/v8/digitalTwin/**`

Current implementation derives virtual Modbus devices from captured Register Lab evidence and applies them to the simulator. This is directly useful for protocol research.

**Product name:** `Device Clone` or `Capture -> Simulator`  
**Do not market it as:** generic Digital Twin.

Required UX:
- select captured connection/device
- preview inferred memory map
- show confidence/uncertain points
- create simulator instance
- preserve provenance
- explicit read-only/writable area selection

#### `src/v8/automation/**`

The current API client drives Modbus read/write, scheduler, simulator and Test Center operations.

**Product name:** `Scripted Tests / API`  
**Allowed scope:** automated Modbus tests, regression sequences, lab recipes, CLI/API control.  
**Forbidden scope:** generic plant/process automation.

#### `src/v8/history/**`

Keep only capabilities that support Modbus evidence.

**Product name:** `Logger / Trend / Session Evidence`

Keep:
- register logging
- communication/event logging
- chart/trend for polled or captured Modbus values
- replay/research datasets
- bounded evidence storage

Do not evolve into a generic site historian.

#### `src/v8/project/**`

Keep as optional **Modbus Workspace / Test Project** persistence:
- connection profiles
- monitor sessions
- captures
- device maps
- simulator maps
- recipes
- evidence/report bundles

A project must never be required before a first read/sniff/simulation.

### REMOVE from product scope

#### `src/v8/hmi/**` and `public/v8/hmi-workspace.*`

The HMI builder supports generic screens/widgets, gauges, lamps, switches, images and button actions. That is a separate HMI/SCADA product direction.

Decision:
- stop feature development
- remove from primary/advanced navigation
- remove from Modbus product roadmap/help
- preserve code temporarily only until dependencies/tests are safely separated
- later archive/delete or move to a separate repository if desired

A small read-only register watch panel, table or trend is still allowed inside Master/Analyzer because it directly supports Modbus testing. A free-form HMI builder is not.

## 4. Critical architecture debt

The current branch intentionally contains both the stable v7 product shell and the experimental v8 Workbench. It also contains a stable-shell Master integration (`src/master/**`, `public/master-v7.js`) while the earlier v8 Master/workspaces still exist.

That is acceptable as a temporary recovery state, but **not** as the final architecture.

Risks:
- two user shells can diverge in terminology and behavior
- duplicate Master UI/runtime paths can implement the same function differently
- multiple connection abstractions can confuse resource ownership
- fixes may land in one surface and not the other
- tests can pass against a path users do not actually run
- product scope can drift again because old workspaces remain visible

Target:
- one desktop/web product shell
- one shared Modbus protocol core
- one shared transport layer
- one central connection/resource ownership model
- one evidence/event model
- Sniffer, Master, Slave, Discovery and Test Center as clients of the same core
- advanced tools consume the same Traffic/Register evidence instead of creating parallel data models

Migration rule:
- stable v7 remains the accepted default during migration
- do not add a third implementation of any Modbus function
- new protocol/transport logic belongs in reusable core modules, not page-specific code
- converge the two Master paths before declaring Master complete
- retire the experimental v8 shell only after its valuable Modbus capabilities have been migrated into the unified product

## 5. Current transport capability audit

Core transport code already contains:

- Serial RTU
- Serial ASCII
- Modbus TCP client/server
- UDP transport
- TLS transport
- tunnel transport
- virtual loopback
- serial echo suppression / framing support

Connection UI also exposes:

- Modbus UDP
- Modbus TCP Security/TLS
- RTU over TCP
- RTU over UDP
- ASCII over TCP
- ASCII over UDP

Roadmap requirement: these must become **Modbus Transport Lab** capabilities with consistent Master/Slave/Test Center support and explicit labeling of standard versus convenience/non-standard encapsulations.

## 6. Function-code capability audit

Protocol core already implements or contains primitives for a broad set including:

- FC01 Read Coils
- FC02 Read Discrete Inputs
- FC03 Read Holding Registers
- FC04 Read Input Registers
- FC05 Write Single Coil
- FC06 Write Single Register
- FC07 Read Exception Status
- FC08 Diagnostics
- FC11 Get Comm Event Counter
- FC12 Get Comm Event Log
- FC15 Write Multiple Coils
- FC16 Write Multiple Registers
- FC17 Report Server ID
- FC20 Read File Record
- FC21 Write File Record
- FC22 Mask Write Register
- FC23 Read/Write Multiple Registers
- FC24 Read FIFO Queue
- FC43/14 Read Device Identification

The major gap is not only protocol-core support; it is **consistent UI/test exposure, simulator behavior, evidence and conformance coverage**.

## 7. Missing high-value Modbus capabilities

### Master / Client

- expose supported advanced function codes through an Advanced request builder
- guarded FC05/06/15/16/22/23 writes
- serial-only FC07/08/11/12/17 actions
- FC20/21 file record tester
- FC24 FIFO tester
- FC43/14 device identification
- broadcast semantics and clear warnings
- address base 0/1 and 0xxxx/1xxxx/3xxxx/4xxxx handling
- 5/6-digit reference display support where useful
- RTS control / RS-485 converter timing
- retries/inter-request delay/response timeout controls
- per-session counters and clear/reset
- conditional formatting
- multi-register strings/BCD/bitfields/time formats
- copy/paste and CSV map import/export

### Slave / Server Simulator

- clean first-class Slave UI
- multi-Unit simulation
- complete supported FC handling matrix
- configurable exception responses
- invalid-address behavior
- server identity / FC43 objects
- serial diagnostic counters
- file record/FIFO simulation where supported
- multiple TCP client visibility
- deterministic dynamic-value generators
- request/write audit
- latency/delay injection under LAB mode

### Sniffer / Analyzer

- richer CRC/LRC/MBAP diagnostics
- serial silent-interval/timing analysis
- duplicate/out-of-order/mismatched transaction detection
- TCP transaction-ID analysis
- gateway latency analysis
- broadcast detection
- exception trend analysis
- scan inferred maps from observed requests
- compare two captures/register maps
- export reusable register map from passive evidence
- traffic bookmark/annotation and evidence bundles

### Discovery / Reverse Engineering

- Unit ID scan
- function-code probe matrix
- address/range scan
- FC43 identity scan
- safe quantity/range probing
- datatype/endianness inference
- change-frequency and entropy analysis
- read-only/writable inference only when safely evidenced
- adopt discovered ranges directly into Monitor Sessions or Simulator

### Test Center / Research Lab

- raw RTU/ASCII/TCP frame composer
- automatic CRC/LRC
- expected response + masks
- malformed-frame LAB tests
- exception-code tests
- boundary quantity tests
- illegal function/address/value tests
- timing/timeout/retry scenarios
- repeat/recipe/assert workflows
- protocol regression suites
- import/export reusable test cases
- explicit LAB arming for risky/raw transmissions

### Logging / Research / Evidence

- packet/event capture
- session replay
- CSV/JSON/Excel export
- protocol report bundle
- register/value trend
- request/response latency trend
- capture diff
- register map diff
- test run evidence with exact configuration
- PCAP/PCAPNG export/import if technically feasible for TCP and serial pseudo-link representation

### Modbus Security / TLS

Existing TLS transport should be developed only as **Modbus TCP Security** tooling:
- port 802 defaults
- client/server certificate inspection
- server/client authentication state
- mTLS test cases
- certificate failure diagnostics
- TLS/session evidence

Do not turn this into generic network-security tooling.

## 8. Navigation target

Recommended product navigation:

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

Remove:
- HMI
- generic Automation
- generic Historian
- generic Digital Twin terminology

## 9. Product UX rules

- Sniffer, Master and Slave must each be usable without creating a Project.
- Every advanced tool must clearly state what Modbus question it answers.
- No duplicate connection model should exist across workspaces.
- Traffic is shared evidence generated by Master, Slave, Sniffer, Discovery and Test Center.
- Register interpretation is shared across Master, Sniffer evidence, Device Clone and Simulator.
- Writes/raw transmissions always use central safety/ownership gates.
- Saved state must never restore armed writes or LAB mode.
- Advanced complexity belongs behind expandable/advanced controls, not on the basic first-read path.
- Help explains protocol behavior; it must not compensate for unclear primary workflows.

## 10. Repository cleanup plan

### Phase A — scope lock
- [x] define Modbus-only product contract
- [ ] update all active roadmap/help wording to this contract
- [ ] mark HMI Builder out-of-scope
- [ ] rename/reframe Automation, Historian and Digital Twin concepts

### Phase B — shell cleanup
- [ ] remove HMI from navigation
- [ ] rename Automation -> Test Sequences / API
- [ ] rename Historian -> Logger / Trend
- [ ] rename Digital Twin -> Device Clone
- [ ] simplify top-level navigation around Core / Analyze / LAB / Evidence
- [ ] keep Connection Profiles available but not required before basic operations

### Phase C — capability closure
- [ ] finish professional Master
- [ ] rebuild professional Slave
- [ ] unify Traffic evidence across modes
- [ ] expose advanced FC test matrix
- [ ] complete Discovery/reverse-engineering workflow
- [ ] complete Test Center and protocol conformance workflows
- [ ] complete capture/replay/compare/evidence workflows

### Phase D — remove dead product scope
- [ ] disconnect HMI routes/services from product composition
- [ ] remove HMI help/docs/tests from Modbus product
- [ ] archive/delete HMI implementation after dependency audit
- [ ] remove any generic automation/historian wording and APIs that do not serve Modbus testing

## 11. Definition of done

The product is ready only when an engineer can use one application to:

- sniff an unknown Modbus network
- identify devices and traffic patterns
- actively poll and write a device
- simulate one or many Modbus servers
- inspect raw and decoded traffic
- infer and test register mappings
- scan devices/addresses
- compose raw frames
- run repeatable protocol test recipes
- investigate errors/timing/exceptions
- clone captured behavior into a simulator
- log/chart protocol evidence
- compare captures/maps/test runs
- export a defensible Modbus engineering report

without being distracted by unrelated HMI/SCADA/process-automation functionality.
