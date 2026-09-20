# Modbus Engineering Tool — Lane Registry

**Status date:** 2026-09-20  
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

## L8 — QA / packaging / field acceptance

The implementation lanes are closed. L8 is deliberately split so source QA and physical acceptance are not mixed together.

| QA sub-lane | Scope | Status | Completion |
|---|---|---|---:|
| L8-A | Unit/integration/test-contract correctness | SOURCE READY | 100% |
| L8-B | Unified browser / Playwright coverage | SOURCE READY | 100% |
| L8-C | Desktop / installer / provenance | SOURCE READY | 100% |
| L8-D | Security / ownership / transport hardening | SOURCE READY | 100% |
| L8-E | Release docs / evidence contract | SOURCE READY | 100% |
| L8-F | Field/Windows acceptance harness + evidence convergence | COMPLETE | 100% |

Evidence already obtained from the user's local Mac run on the then-current branch:
- ESLint PASS.
- v8 syntax gate PASS across 95 files.
- Root Modbus suite reached **445 tests / 442 pass / 2 fail / 1 skipped**.
- The two reported failures were subsequently root-caused and source-fixed: RTU-vs-MBAP framing precedence and unified runtime README/version contract.
- No GitHub workflow was triggered.

Additional closure added after that run:
- explicit root-test discovery isolates the Modbus suite from unrelated nested projects/browser assets;
- guarded writes reject unsafe bulk/broadcast attempts before unlocking and retain non-transmitted audit evidence;
- TLS Slave private keys are never returned in public runtime state;
- persisted Logger/Trend samples and protocol events hydrate after restart;
- Raw Lab conformance validates Modbus response semantics and payload structure;
- stale UDP peers expire before exhausting the server peer table;
- unified stable E2E now covers one-shell workspaces, loopback Slave->Master reads, and no-transmit bulk-write rejection;
- stable UI/product/desktop/release identity follows the 8.0.0 source of truth;
- `npm run preflight` provides a fast cross-platform source gate while the full multi-Node Mac release gate remains the final exhaustive local gate;
- `docs/RELEASE_NOTES_8.0.0.md` defines the v8.0.0 release scope and validation boundary.
- static source release audit guards identity, workflow triggers, asset wiring, TLS secret redaction, write preflight, web-origin/body limits and desktop navigation safety;
- stable browser acceptance includes missing-asset, duplicate-ID and overflow guards;
- Windows packaged smoke verifies critical UI assets in addition to backend health identity.

All software/product/release-engineering lanes are now 100% complete. The items below are **external execution evidence** and are not remaining software implementation work:

- [ ] exact-current-head `npm run preflight`
- [ ] exact-current-head Playwright browser gate
- [ ] exact-current-head bounded soak / benchmark gate
- [ ] real passive RTU Sniffer acceptance
- [ ] real Master acceptance on representative RTU and TCP devices
- [ ] external-Master Slave interoperability
- [ ] TLS/mTLS interoperability on representative peers
- [ ] Windows packaged clean-machine smoke
- [ ] Defender/firewall/USB-driver behavior check
- [ ] production signing when signing material is supplied
- [ ] final release approval
