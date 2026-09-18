# Modbus Engineering Tool — Active TODO

**Status date:** 2026-09-18  
**Branch:** `v8-release-completion`  
**PR:** #31 — experimental, not release-eligible  
**Canonical scope:** `docs/MODBUS_ONLY_PRODUCT_AUDIT.md`

## Product rule

This repository is one **advanced Modbus engineering tool**. Every product feature must directly support Modbus testing, simulation, analysis, reverse engineering, research, troubleshooting, evidence or protocol validation.

Primary modes:

1. **Sniffer / Analyzer** — passive observation and reverse engineering.
2. **Master / Client** — active polling, diagnostics and guarded writes.
3. **Slave / Server Simulator** — controlled Modbus device simulation.

Advanced Modbus tools:

- Traffic Analyzer
- Register/Data Lab
- Discovery & Scan
- Diagnostics & Conformance
- Test Center / Raw Frame Studio
- Device Clone / Capture-to-Simulator
- Test Sequences / Scripted API
- Replay / Compare
- Logger / Trend
- Captures / Reports / Export
- Connection Profiles / Transport Lab

Explicitly out of product scope:

- generic HMI builder / SCADA screens
- generic process automation/control
- generic historian platform
- generic IoT/dashboard functionality
- non-Modbus workflow automation

## Scope cleanup

- [x] canonical Modbus-only scope audit created
- [x] remove HMI from product navigation
- [x] stop HMI Builder feature development in the Modbus product
- [x] remove HMI from Help/product roadmap
- [x] rename/reframe visible `Automation` product wording as `Test Sequences / API`
- [x] rename/reframe visible `Historian` product wording as `Logger / Trend`
- [ ] rename/reframe `Digital Twin` as `Device Clone / Capture-to-Simulator`
- [ ] ensure Device Clone remains capture/register-evidence -> Modbus simulator only
- [ ] ensure scripting APIs expose Modbus test operations only
- [ ] classify/remove any remaining non-Modbus UI/routes/services
- [x] inventory duplicate v7/v8 Master, connection and evidence paths
- [x] define one canonical shared Modbus core boundary (`src/modbusCore.js`)
- [ ] converge Master onto one runtime/UI contract
- [ ] migrate valuable v8 Modbus-only capabilities into the unified product shell
- [ ] retire duplicate experimental shell paths after migration/acceptance

## Stable Sniffer baseline

- [x] `npm start` restored to stable Sniffer / Analyzer
- [x] desktop default restored to stable Sniffer
- [ ] verify serial COM selection, baud/parity and reconnect flow on current head
- [ ] verify passive RTU request/response capture
- [ ] verify automatic Unit/Slave formation
- [ ] verify grouped registers, polling intervals, timeouts and RTT
- [ ] verify TCP inline proxy analyzer
- [ ] verify capture/replay/export
- [ ] add deeper CRC/LRC/MBAP diagnostics
- [ ] add serial silent-interval/timing analysis
- [ ] add duplicate/mismatch/out-of-order transaction diagnostics
- [ ] add capture comparison and register-map diff

## Master / Client

Basic flow must remain:

`Connect -> Unit ID -> Function -> Address/Quantity -> Read/Poll -> Live Values -> Interpret -> Guarded Write`

Implemented source:

- [x] RTU / ASCII / TCP basic connection
- [x] FC01/02/03/04 Read Once and polling
- [x] live grid and communication counters
- [x] raw/reference address handling
- [x] Monitor Sessions
- [x] uint/int 16/32/64, float32/64, HEX, binary, ASCII
- [x] ABCD/BADC/CDAB/DCBA policies
- [x] scale/offset/precision persistence

Next:

- [x] per-register alias/name/unit/notes mapping foundation
- [ ] bitfield and richer register metadata
- [ ] clear/reset per-monitor counters
- [ ] open current monitor directly in Traffic
- [ ] direct Modbus Logger/Trend from monitor
- [ ] guarded FC05/06/15/16 writes
- [ ] FC22 and FC23 UI
- [ ] FC07/08/11/12/17 serial diagnostics UI
- [ ] FC20/21 file record tester
- [ ] FC24 FIFO tester
- [ ] FC43/14 device-identification action
- [ ] broadcast semantics and explicit warnings
- [ ] retries/inter-request delay controls
- [ ] RS-485 RTS timing controls
- [ ] advanced request builder
- [ ] exact-head local tests + hardware acceptance

## Slave / Server Simulator

- [ ] professional first screen for RTU / ASCII / TCP server
- [ ] supported UDP/tunnel/TLS server variants under Advanced Transport
- [ ] multi-Unit device simulation
- [ ] coils/discrete/holding/input memory tables
- [ ] direct editable simulator values
- [ ] incoming read/write visibility
- [ ] connected TCP client visibility
- [ ] complete supported FC behavior matrix
- [ ] FC43 server identity objects
- [ ] diagnostic/event counters where applicable
- [ ] configurable exception responses
- [ ] deterministic latency/delay injection under LAB mode
- [ ] safe dynamic value generators
- [ ] simulator map import/export
- [ ] create simulator from captured device evidence

## Traffic / Protocol Analysis

- [ ] unified evidence from Sniffer, Master, Slave, Discovery and Test Center
- [ ] Tx/Rx raw HEX + decoded PDU/ADU
- [ ] CRC/LRC/MBAP validation
- [ ] request/response matching
- [ ] RTT, timeout, retry, jitter and gap analysis
- [ ] Modbus exception decoding/trending
- [ ] TCP transaction-ID analysis
- [ ] broadcast identification
- [ ] filter by connection/unit/function/address/session
- [ ] bookmarks/annotations
- [ ] export selected evidence

## Register/Data Lab

- [ ] shared datatype interpretation engine across Master/Sniffer/Simulator
- [ ] strings and fixed-length ASCII/UTF-8 views where applicable
- [ ] BCD and bitfield interpretation
- [ ] signed/unsigned integer families
- [ ] IEEE-754 float/double
- [ ] byte/word-order permutations
- [ ] scale/offset/unit/precision
- [ ] value-change frequency / min/max / entropy research
- [ ] inferred-map confidence and provenance
- [ ] map import/export/diff

## Discovery / Reverse Engineering

- [ ] compact Unit/Slave scan
- [ ] address/range scan
- [ ] function-code probe matrix
- [ ] FC43/14 identity scan
- [ ] safe quantity/range probing
- [ ] inferred datatype/endianness workflow
- [ ] change-frequency/entropy analysis
- [ ] adopt confirmed ranges into Monitor Sessions
- [ ] adopt evidence into Device Clone/Simulator

## Test Center / Modbus LAB

Existing protocol Test Center / recipe code remains in scope.

- [ ] raw RTU/ASCII/TCP frame composer UI
- [ ] auto CRC/LRC
- [ ] expected response + mask
- [ ] reusable raw test strings
- [ ] boundary quantity tests
- [ ] exception-code tests
- [ ] invalid function/address/value LAB tests
- [ ] timing/timeout/retry scenarios
- [ ] repeat/assert test recipes
- [ ] protocol regression suites
- [ ] explicit LAB arming for raw/risky transmissions
- [ ] test case import/export
- [ ] exact test-run evidence bundle

## Transport Lab

Current core already contains Serial, TCP, UDP, TLS and tunnel transports.

- [ ] consistent Master/Slave/Test Center exposure for supported transports
- [ ] RTU over TCP
- [ ] ASCII over TCP
- [ ] RTU over UDP
- [ ] ASCII over UDP
- [ ] Modbus UDP
- [ ] Modbus TCP Security/TLS on port 802 defaults
- [ ] certificate/authentication diagnostics
- [ ] clearly label standard Modbus vs convenience/non-standard encapsulations
- [ ] local interface binding controls
- [ ] reconnect/timeout/backpressure evidence

## Logger / Replay / Compare / Evidence

These remain in scope only as Modbus evidence tools.

- [ ] register/value logger
- [ ] communication-event logger
- [ ] live trends
- [ ] capture replay
- [ ] compare captures
- [ ] compare register maps
- [ ] compare test runs
- [ ] CSV/JSON/Excel export
- [ ] protocol report bundle
- [ ] PCAP/PCAPNG feasibility assessment
- [ ] bounded retention / large-session performance

## UX rules

- [ ] no Project required before first sniff/read/simulation
- [ ] every workspace answers a specific Modbus engineering question
- [ ] common connection/ownership model across all active tools
- [ ] Traffic is shared evidence, not a competing workflow
- [ ] advanced tools are reachable from the object being investigated
- [ ] no generic SCADA/HMI/process-control concepts in the product shell
- [ ] Help teaches Modbus concepts and tool operation, not unrelated automation concepts

## Validation / merge rule

Do **not** merge PR #31 because it is mergeable or because old release evidence passed.

Before release eligibility:

- [ ] exact-head automated tests pass
- [ ] stable Sniffer remains accepted
- [ ] Master accepted on representative RTU/TCP devices
- [ ] Slave accepted as a usable simulator
- [ ] Modbus-only navigation/scope cleanup accepted
- [ ] Test Center / Traffic / Discovery integration accepted
- [ ] Windows packaged application smoke passes
- [ ] representative long polling/simulation soak passes
