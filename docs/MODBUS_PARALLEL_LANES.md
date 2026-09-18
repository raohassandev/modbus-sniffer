# Modbus Engineering Tool — Lane Registry

**Status date:** 2026-09-18  
**Branch:** `v8-release-completion`

Percentages below distinguish **source implementation** from **release/field acceptance**.

| Lane | Scope | Source status | Source completion |
|---|---|---|---:|
| L0 | Product scope + unified shell | COMPLETE | 100% |
| L1 | Master / Client engineering | COMPLETE | 100% |
| L2 | Shared Modbus core / ownership integration | COMPLETE for approved scope | 100% |
| L3 | Slave / Server simulator | COMPLETE | 100% |
| L4 | Protocol diagnostics / conformance | COMPLETE | 100% |
| L5 | Traffic / Data Lab / Discovery | COMPLETE | 100% |
| L6 | Raw Lab / Device Clone / Test Sequences / Compare | COMPLETE | 100% |
| L7 | Logger / Trend / Transport / TLS evidence | COMPLETE | 100% |
| L8 | QA / packaging / hardware / soak evidence | PENDING EVIDENCE | — |

**Approved source-roadmap completion: 100%.**  
**Release/field acceptance: pending exact-head evidence.**

## L0 — Unified product

- [x] one Modbus-only product contract
- [x] HMI/SCADA/process-control product scope removed
- [x] Core / Analyze / LAB / Evidence / System navigation
- [x] stable operational Help
- [x] former v8 product launch retired
- [x] desktop and compatibility launch commands use the unified runtime

## L1 — Master

- [x] RTU/ASCII/TCP first-read workflow
- [x] Monitor Sessions
- [x] full register formatting/data interpretation integration
- [x] metadata mapping
- [x] per-monitor counters
- [x] retries/inter-request delay/RS-485 RTS
- [x] guarded writes and audit/read-back
- [x] advanced diagnostics/File Record/FIFO/Device ID
- [x] direct Traffic and Logger/Trend actions

## L2 — Shared core

- [x] `src/modbusCore.js` is the canonical reusable boundary
- [x] shared transports/protocol/write safety/raw frame primitives
- [x] common serial ownership rules across Sniffer/Master/Slave/Raw Lab/Discovery
- [x] shared active Evidence Hub integrated into stable Traffic
- [x] old user-facing v8 launch path retired
- [x] reusable `src/v8/**` implementation primitives retained internally where already proven

## L3 — Slave

- [x] RTU/ASCII/TCP
- [x] TLS/UDP/tunnels
- [x] multi-Unit + four memory areas
- [x] client/peer/request evidence
- [x] implemented FC matrix
- [x] identity/diagnostics/File Record/FIFO
- [x] LAB fault policy
- [x] dynamic generators
- [x] import/export and Device Clone

## L4 — Protocol / conformance

- [x] protocol function exposure documented
- [x] CRC/LRC/MBAP diagnostics
- [x] matching/duplicate/orphan/mismatch/TID analysis
- [x] timing/gap/jitter/silent-interval analysis
- [x] boundary and exception conformance presets
- [x] exact conformance evidence bundle

## L5 — Analysis / Discovery

- [x] unified Traffic evidence
- [x] source/connection/unit/function/address/search filtering
- [x] selection/bookmark/annotation/export
- [x] shared Data Lab codec
- [x] passive intelligence/confidence analysis
- [x] Unit/range/function/quantity engineering scans
- [x] Monitor/Simulator adoption

## L6 — LAB / replay

- [x] Raw Frame Lab
- [x] reusable/importable/exportable test cases
- [x] explicit LAB safety
- [x] Test Sequences
- [x] Device Clone
- [x] capture/register-map/test-run comparison

## L7 — Evidence / transports

- [x] Logger / Trend
- [x] bounded rotating storage
- [x] CSV evidence
- [x] Transport Lab
- [x] Modbus TCP Security/TLS diagnostics
- [x] local-interface binding
- [x] PCAP feasibility decision

## L8 — Acceptance evidence

Still required before a release/merge claim:

- [ ] exact-head `npm test`
- [ ] exact-head quality/lint/version checks
- [ ] browser interaction/visual QA
- [ ] real RTU/TCP Master and Sniffer acceptance
- [ ] external-Master Slave interoperability
- [ ] TLS/mTLS interoperability
- [ ] Windows packaged smoke
- [ ] repeated lifecycle/long soak
- [ ] final release approval
