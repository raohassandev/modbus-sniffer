# Modbus-Only Product Audit

**Status date:** 2026-09-18

## Product contract

This repository is one **advanced Modbus engineering tool**.

In scope:

- passive Modbus sniffing/analyzing
- active Modbus Master testing
- Modbus Slave/server simulation
- traffic/protocol diagnostics
- register interpretation and reverse engineering
- device/range/function discovery
- raw/conformance LAB testing
- capture-to-simulator cloning
- repeatable Modbus test sequences
- Modbus-specific logging/trending/comparison/evidence
- Modbus transport and Modbus TCP Security/TLS testing

Out of scope:

- generic HMI/SCADA design
- generic PLC/programming workflows
- generic process control
- generic historian/IoT dashboard product features
- non-Modbus workflow automation

## Final user-facing architecture

The product launches only the unified stable runtime:

`src/index-v7.js`

Primary modes:

1. **Sniffer / Analyzer** — passive/RX-only.
2. **Master / Client** — explicit active polling/diagnostics/guarded writes.
3. **Slave / Server Simulator** — controlled response/simulation mode.

Navigation is grouped as **Core / Analyze / LAB / Evidence / System**.

The former v8 shell is no longer a product or desktop launch path. Proven modules under `src/v8/**` are retained only as internal protocol, transport, safety, simulation and evidence implementation components consumed through the unified product.

## Shared architecture

`src/modbusCore.js` is the reusable Modbus boundary for:

- connection ownership
- Master engine
- serial/TCP/TLS/UDP/tunnel transports
- protocol encoding/decoding
- write safety/audit
- Slave simulation primitives
- Raw Frame Studio
- register codec integration

A bounded Evidence Hub merges active evidence into the stable Traffic model without changing passive Sniffer inference.

## Scope-cleanup result

- HMI removed from the product.
- visible Automation renamed/reframed as Modbus Test Sequences.
- visible Historian reframed as Modbus Logger / Trend.
- Digital Twin product terminology replaced by Device Clone / Capture-to-Simulator.
- Projects are not required before first sniff/read/simulation.
- advanced complexity is secondary to the three primary workflows.
- Help documents actual Modbus operation rather than compensating for hidden workflows.

## Implemented engineering capability

See `docs/MODBUS_FUNCTION_MATRIX.md` and `docs/ACTIVE_TODO.md`.

The approved source scope includes:

- full normal Master read/poll workflow
- guarded writes and advanced FC diagnostics
- multi-Unit Slave with advanced transports and LAB behavior
- protocol diagnostics and matching/timing analysis
- Data Lab and automatic register intelligence
- active/passive Discovery
- Raw Frame / conformance Lab
- Device Clone and Test Sequences
- Logger / Trend and Compare
- Transport / TLS Lab
- unified evidence export

## Evidence boundary

The application does not fabricate PCAP/PCAPNG. The technical decision is documented in `docs/PCAP_FEASIBILITY.md`.

## Definition of source complete

The source scope is complete when one product can:

- sniff an unknown Modbus network
- identify devices and polling patterns
- actively poll/read/write a target
- simulate one or more Modbus Units
- inspect raw/decoded traffic and protocol faults
- interpret and research register values
- scan Units/functions/address ranges
- compose raw frames and run conformance cases
- clone captured register behavior into a simulator
- log/trend/compare/export Modbus evidence

The integration branch now satisfies that source definition.

## Release boundary

Source completion is not release acceptance. Exact-head tests, browser QA, representative physical/network interoperability, Windows packaged smoke and soak evidence remain mandatory before merge/release approval.
