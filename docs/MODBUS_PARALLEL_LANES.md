# Modbus Engineering Tool — Parallel Lane Registry

**Status date:** 2026-09-18  
**Branch:** `v8-release-completion`  
**Management model:** AISH-style dependency DAG, non-overlapping write scopes, one integration owner for shared shell files, QA separate from implementation.

Percentages below are **source-roadmap completion estimates**, not release/acceptance percentages. A lane can have substantial source code and still remain unaccepted until exact-head tests and hardware/UX evidence pass.

| Lane | Scope | Status | Source completion |
|---|---|---|---:|
| L0 | Product Scope + Shell Integration | EXECUTING | 82% |
| L1 | Master / Client Engineering | EXECUTING | 82% |
| L2 | Shared Core Convergence | EXECUTING | 48% |
| L3 | Slave / Server Simulator | EXECUTING | 72% |
| L4 | Protocol Functions + Diagnostics / Conformance | EXECUTING | 80% |
| L5 | Traffic + Register Lab + Discovery | EXECUTING | 62% |
| L6 | Test Center + Device Clone + Replay/Test Sequences | EXECUTING | 82% |
| L7 | Logger/Trend + Reports + Transport/Security Lab | READY | 45% |
| L8 | QA + UX + Reliability + Release Evidence | EXECUTING | 34% |

**Approximate overall source-roadmap completion:** 64%  
**Release/field acceptance:** substantially lower; exact-head suite, packaged smoke, hardware acceptance and soak remain open.

## Dependency DAG

```text
L0 Product scope/shell ──────────────┐
L2 Shared core ───────────┐          │
                          ├─> L1 Master
                          ├─> L3 Slave
                          ├─> L4 Protocol/Diagnostics
                          ├─> L5 Analysis/Discovery
                          ├─> L6 LAB/Clone/Sequences
                          └─> L7 Evidence/Transport
                                      │
All implementation lanes ────────────> L8 QA/Acceptance
```

## L0 — Product Scope + Shell Integration — 70%

**Owner:** integration lane  
**Shared write scope:** product navigation/composition/help/docs only. Other lanes must not edit shared shell files without handoff.

Completed:
- [x] Modbus-only scope contract
- [x] HMI removed from visible v8 navigation
- [x] HMI workspace script no longer loaded by v8 shell
- [x] Simulator visible name reframed as Slave
- [x] Historian visible name reframed as Logger / Trend
- [x] Automation visible name reframed as Test Sequences
- [x] HMI Builder topic removed from Help
- [x] false v8 release-candidate shell wording removed
- [x] canonical README/roadmap wording corrected

Remaining:
- [x] HMI backend composition/routes disconnected after dependency audit
- [x] HMI runtime/UI/tests removed; legacy project schema fields retained only for backward-compatible parsing
- [ ] add category headers Core / Analyze / LAB / Evidence / System in final unified shell
- [ ] migrate valuable v8 Modbus workspaces into accepted unified shell
- [ ] retire duplicate shell after acceptance

## L1 — Master / Client Engineering — 64%

**Owner:** Master lane  
**Write scope:** `src/master/**`, `public/master-*.js/css`, Master-specific tests.

Completed:
- [x] RTU / ASCII / TCP basic connection
- [x] FC01–04 Read Once / polling
- [x] live grid and communication counters
- [x] raw/reference addressing
- [x] Monitor Sessions
- [x] 16/32/64-bit integer/float, HEX/binary/ASCII
- [x] ABCD/BADC/CDAB/DCBA formatting
- [x] scale/offset/precision
- [x] session-aware register Name/Unit/Notes mapping foundation

Remaining:
- [ ] bitfield/string/BCD/time interpretations
- [ ] true per-session counter reset/baselines
- [ ] Traffic/Logger/Trend direct actions
- [x] guarded FC05/06/15/16 with audit/read-back/auto-relock
- [x] guarded FC22/23 UI/runtime
- [x] diagnostics FC07/08/11/12/17 with applicability/LAB guards
- [x] FC20/21, FC24, FC43/14 stable Master exposure
- [ ] broadcast/retry/inter-request delay/RTS controls
- [ ] advanced request builder
- [ ] hardware acceptance

## L2 — Shared Core Convergence — 30%

**Owner:** architecture lane  
**Write scope:** shared reusable core only; no UI.

Completed:
- [x] duplicate architecture risk documented
- [x] canonical `src/modbusCore.js` facade introduced
- [x] stable Master moved from direct v8 imports to shared core facade

Remaining:
- [ ] formal shared event/evidence contract
- [ ] move Slave/Test Center/Discovery consumers through shared core
- [ ] centralize datatype/register interpretation
- [ ] converge duplicate Master workspace/runtime services
- [ ] converge connection ownership models
- [ ] remove obsolete duplicate implementation paths after acceptance

## L3 — Slave / Server Simulator — 30%

**Owner:** Slave lane  
**Write scope:** Slave backend/UI/tests only.

Existing foundations:
- virtual device/server implementation
- simulator workspace/service code
- TCP server transport
- device memory model foundations

Completed source:
- professional RTU/ASCII/TCP first screen
- multi-Unit management
- four Modbus memory areas with direct editing
- incoming request/write evidence and TCP client visibility
- FC43 identity plus supported diagnostic/File Record/FIFO behavior
- simulator map import/export
- Device Clone adoption from stable Sniffer evidence

Remaining:
- configurable exceptions/latency/dynamic-value LAB behavior in the stable surface
- advanced UDP/tunnel/TLS server exposure
- documented FC behavior matrix
- exact-head and interoperability acceptance tests

## L4 — Protocol Functions + Diagnostics / Conformance — 55%

**Owner:** protocol lane  
**Write scope:** protocol encoders/decoders, diagnostic request services, conformance tests.

Existing core covers primitives for FC01–08, FC11/12, FC15–17, FC20–24 and FC43/14 families used by the roadmap.

Completed source:
- stable Master exposure for FC07/08/11/12/17/20/21/24/43
- transport applicability guards for serial-only diagnostics
- guarded File Record writes and read-back verification
- built-in Slave behavior for diagnostics/File Record/FIFO/identity

Remaining:
- complete exception/conformance matrices
- broader boundary-value suites
- documentation/evidence polish
- exact-head/device interoperability acceptance

## L5 — Traffic + Register Lab + Discovery — 45%

**Owner:** analysis lane  
**Write scope:** traffic/register/discovery services and UI only.

Completed source:
- stable Analyzer transaction/evidence model
- bounded active Evidence Hub separated from passive inference
- unified Traffic stream for Sniffer + Master + Slave packets
- Test Sequence and Discovery annotations
- source/channel/unit/function/search filtering and source-aware inspector
- register lab and discovery scan foundations

Remaining:
- raw Discovery request/response bridging
- richer active PDU decode/matching context
- CRC/LRC/MBAP/timing diagnostics
- transaction mismatch/duplicate analysis
- compact Unit/address/function scans
- entropy/change-frequency research
- map diff/export/adoption and selected-evidence export

## L6 — Test Center + Device Clone + Replay/Test Sequences — 50%

**Owner:** LAB lane  
**Write scope:** Test Center, capture-to-simulator clone, scripted test/replay modules.

Completed source:
- hardened Recipe Engine with bounded assertions/repeat
- stable Modbus-only Test Sequences service/UI/API
- one-shot guarded Test Sequence writes with automatic re-lock
- Device Clone / Capture-to-Simulator service/UI using stable Sniffer evidence
- read-only-by-default cloned writable-area policy

Remaining:
- expose Raw Frame Studio cleanly in the stable shell
- reusable test case library
- malformed/boundary/exception suites
- replay/compare UX
- exact evidence bundles
- exact-head integration validation

## L7 — Logger/Trend + Reports + Transport/Security Lab — 45%

**Owner:** evidence/transport lane  
**Write scope:** Modbus logging/reporting/transport tooling only.

Existing foundations:
- logger/history/chart services
- reporting bundles
- serial/TCP/UDP/TLS/tunnel transports

Remaining:
- reframe Historian -> Logger/Trend
- session/capture replay evidence
- report/capture/map diff
- bounded retention/performance
- Modbus Security/TLS port 802 UX
- certificate/auth diagnostics
- standard vs non-standard encapsulation labeling

## L8 — QA + UX + Reliability — 28%

**Owner:** QA lane  
**Forbidden:** production changes unless explicit handoff.

Completed:
- [x] product-scope regression authored
- [x] canonical-core import guard authored
- [x] register-mapping asset/parse guard authored
- [x] substantial historical unit/regression suite already exists

Remaining:
- [ ] run exact-current-head `npm test`
- [ ] browser visual QA of new shell and Master mapping
- [ ] RTU/TCP hardware matrix
- [ ] Slave acceptance
- [ ] Test Center/Discovery integration acceptance
- [ ] Windows packaged smoke
- [ ] polling/simulation soak
- [ ] final unified-shell acceptance
