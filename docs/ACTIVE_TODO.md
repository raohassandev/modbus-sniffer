# Modbus Product Recovery — Active TODO

**Status date:** 2026-09-17  
**Branch:** `v8-release-completion`  
**PR:** #31 — experimental, not release-eligible

User acceptance showed that the v8 Workbench had become difficult to understand and had obscured the basic Modbus workflows. This checklist replaces the previous release-closure assumption.

## Product rule

The product must be understandable as three primary tools:

1. **Sniffer** — passive analyzer. Existing accepted behavior must remain usable and familiar.
2. **Master** — actively poll/read/write a Modbus slave in the familiar Modbus Poll / ModScan style.
3. **Slave** — run a Modbus slave/server simulator with obvious memory tables and request/write visibility.

Everything else is secondary/advanced. Traffic, Register Lab, Discovery, Test Center, Charts, Historian, Automation, HMI and Digital Twin may support these tools but must not replace or obscure the three primary workflows.

## Recovery already completed

- [x] restore `npm start` to stable Sniffer / Analyzer (`src/index-v7.js`)
- [x] add explicit `npm run sniffer`
- [x] keep experimental v8 available explicitly through `npm run workbench` / `npm run v8`
- [x] restore desktop default to stable Sniffer
- [x] keep desktop v8 available only through `MODBUS_DESKTOP_MODE=v8`
- [x] restore Windows packaged smoke test to stable `/api/status`
- [x] restore desktop product identity to `Modbus Sniffer`
- [x] mark PR #31 experimental rather than release candidate
- [x] preserve support logging and storage migration behavior

## Sniffer — must remain the known-good baseline

- [ ] verify current stable UI still opens with `npm start`
- [ ] verify serial COM selection, baud/parity and reconnect flow
- [ ] verify passive RTU request/response capture
- [ ] verify automatic device formation by Unit/Slave ID
- [ ] verify grouped registers, polling intervals, timeouts and RTT
- [ ] verify TCP inline proxy analyzer workflow
- [ ] verify discovery/intelligence/export functions remain usable
- [ ] remove any v8 terminology that leaks into the normal Sniffer UI
- [ ] add a simple top-level explanation: this mode listens/analyzes; it does not poll the device

## Master — rebuild as a direct polling tool

The normal Master screen must not require the operator to understand Connection Center, Register Lab, Traffic ownership or internal workspace concepts before the first read.

Required first screen:

- [ ] connection type: RTU / ASCII / TCP
- [ ] COM port + baud/parity or IP + port
- [ ] Connect / Disconnect
- [ ] Slave / Unit ID
- [ ] Function: FC01 / FC02 / FC03 / FC04
- [ ] Start address
- [ ] Quantity
- [ ] Poll interval / scan rate
- [ ] Timeout
- [ ] Read Once
- [ ] Start Polling / Stop
- [ ] live address/value grid
- [ ] communication status and Tx/Rx/Error counters
- [ ] zero-based/reference-address toggle or clear indication
- [ ] unsigned/signed/hex/binary and common 32/64-bit float/int formats
- [ ] byte/word-order selection
- [ ] write selected coil/register through the existing guarded write safety path
- [ ] clear counters
- [ ] save/open polling definitions

Advanced Master functions must be hidden behind an **Advanced** section rather than mixed into the first-read workflow.

## Slave — rebuild as a direct server/simulator tool

Required first screen:

- [ ] server type: RTU / ASCII / TCP
- [ ] COM port + baud/parity or listen IP + port
- [ ] Start Server / Stop Server
- [ ] Unit/Slave ID management
- [ ] Coils table
- [ ] Discrete Inputs table
- [ ] Holding Registers table
- [ ] Input Registers table
- [ ] direct value editing where writable by the simulator
- [ ] incoming request counter
- [ ] incoming write visibility/audit
- [ ] connected TCP client visibility
- [ ] simple import/export of simulator memory/map

Dynamic generators and fault injection belong under **Advanced / LAB**, not in the normal Slave setup.

## Shared UX rules

- [ ] first screen answers: What mode am I in? What connection is selected? Am I connected? What do I do next?
- [ ] no workspace/tab explosion for normal commissioning
- [ ] no requirement to create a project before a first basic read/test
- [ ] common terminology: `Slave / Unit ID`, `Function`, `Address`, `Quantity`, `Poll Interval`, `Timeout`
- [ ] errors shown next to the operation that failed
- [ ] Traffic is evidence/support view, not the primary polling UI
- [ ] Register Lab is advanced interpretation, not required for basic uint16 polling
- [ ] Help is contextual and short; it must not compensate for a confusing workflow

## Validation before v8 can become default again

- [ ] a new user can sniff an RTU bus without reading documentation
- [ ] a new user can poll FC03 registers from a TCP device in under 60 seconds
- [ ] a new user can start a TCP slave and edit holding registers in under 60 seconds
- [ ] Sniffer, Master and Slave each have a clearly distinct purpose
- [ ] Windows packaged app opens the accepted default experience
- [ ] full automated test suite passes
- [ ] representative RTU and TCP hardware acceptance passes
- [ ] only after the above, reconsider v8 as default and restart release-gate work

## Merge rule

Do **not** merge PR #31 based on `mergeable=true`, prior source-closure claims, or old release-gate evidence. The PR remains experimental until the Sniffer/Master/Slave product model above is implemented and accepted.
