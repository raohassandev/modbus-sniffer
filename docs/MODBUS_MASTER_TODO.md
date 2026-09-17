# Modbus Master — Implementation TODO

**Status date:** 2026-09-17  
**Branch:** `v8-release-completion`  
**Product rule:** stable Sniffer remains the default and must not regress. Master is added as an explicit active-polling workspace.

## Product outcome

The Master workflow must be immediately understandable to an engineer familiar with Modbus Poll / ModScan:

`Connect -> Unit/Slave -> Function -> Address/Quantity -> Read Once / Poll -> Live Values -> Format -> Guarded Write`

The first basic read must not require Projects, Register Lab, Traffic, or any v8 workspace knowledge.

## Lane model

AISH-OS concurrency rules apply: one integration owner for shared paths, non-overlapping implementation scopes, QA separate from implementation, exact-head evidence, and no planned lane reported as executing without repository evidence.

### Lane M0 — Integration / Critical Path

**Write scope:** `src/platformWebServerV61.js`, `public/platform-v6.js`, shared docs only.  
**Responsibility:** wire Master into the stable Sniffer without changing the Sniffer capture behavior.

- [ ] install Master backend routes into the stable v7 web server
- [ ] load Master CSS/JS in the stable UI shell
- [ ] add Master navigation entry without removing existing Analyzer pages
- [ ] ensure server shutdown closes active Master connection
- [ ] preserve passive Sniffer as default startup and desktop experience
- [ ] add clear UI identity: Analyzer is passive; Master is active

### Lane M1 — Master Connection + Read Runtime

**Write scope:** `src/master/**` only.  
**Responsibility:** active Modbus RTU / ASCII / TCP read engine using existing proven v8 transport/protocol components.

- [ ] connection normalization and validation
- [ ] RTU serial connection
- [ ] ASCII serial connection
- [ ] TCP client connection
- [ ] safe connection ownership through `ConnectionBroker`
- [ ] reuse `MasterEngine` and shared protocol encoder/decoder
- [ ] FC01 Read Coils
- [ ] FC02 Read Discrete Inputs
- [ ] FC03 Read Holding Registers
- [ ] FC04 Read Input Registers
- [ ] timeout / Modbus exception / framing error propagation
- [ ] Tx / Rx / error / timeout / RTT counters
- [ ] request/response HEX evidence
- [ ] explicit passive-capture takeover rule for the same serial port
- [ ] clean disconnect/reconnect lifecycle

### Lane M2 — Master Main UI

**Write scope:** `public/master-v7.js`, `public/master-v7.css`.  
**Responsibility:** implement the approved Master mockup in the current Sniffer design system.

- [ ] Master nav entry
- [ ] Connection & Session card
- [ ] RTU / ASCII / TCP selector
- [ ] serial COM/baud/parity/data/stop controls
- [ ] TCP host/port controls
- [ ] timeout and poll interval
- [ ] Connect / Disconnect / Test Connection
- [ ] Unit / Slave ID
- [ ] FC01 / FC02 / FC03 / FC04 selector
- [ ] raw PDU address input
- [ ] reference-address display/toggle (0xxxx/1xxxx/3xxxx/4xxxx)
- [ ] Quantity
- [ ] Read Once
- [ ] Start Polling / Pause / Stop
- [ ] live Tx/Rx/Error/Timeout/RTT counters
- [ ] Live Data Grid
- [ ] loading / disconnected / timeout / exception states
- [ ] responsive desktop behavior consistent with current stable UI

### Lane M3 — Data Format + Monitor Sessions

**Write scope:** future `src/master/format/**`, `src/master/session/**`, `public/master-format-v7.js` or dedicated scoped files.  
**Responsibility:** familiar Modbus Poll-style reusable monitors and value interpretation.

- [ ] uint16 / int16
- [ ] uint32 / int32
- [ ] float32
- [ ] uint64 / int64 / float64
- [ ] HEX / binary / ASCII
- [ ] byte/word orders ABCD / BADC / CDAB / DCBA and required 64-bit permutations
- [ ] scale / offset / precision
- [ ] per-row description/alias
- [ ] save/open/duplicate monitor definition
- [ ] multiple monitor tabs
- [ ] persistent poll interval and address settings
- [ ] recent profiles / templates
- [ ] quick-start wizard
- [ ] selected-register mini trend

### Lane M4 — Guarded Writes

**Write scope:** future `src/master/write/**`, `public/master-write-v7.js` and scoped tests.  
**Responsibility:** safe active writes; locked by default.

- [ ] write state LOCKED by default
- [ ] temporary explicit unlock with auto-lock timeout
- [ ] FC05 Write Single Coil
- [ ] FC06 Write Single Register
- [ ] FC15 Write Multiple Coils
- [ ] FC16 Write Multiple Registers
- [ ] FC22 Mask Write Register
- [ ] FC23 Read/Write Multiple Registers
- [ ] selected-row write workflow
- [ ] confirmation modal showing exact target/address/old/new values
- [ ] optional operator/comment evidence
- [ ] read-back verification
- [ ] mismatch/failure reporting
- [ ] write audit trail and export
- [ ] writes re-lock on disconnect/reconnect/restart/error

### Lane M5 — Discovery / Convenience

**Write scope:** dedicated Master discovery/adoption files only.  
**Responsibility:** optional convenience that feeds the Master; never required for a first read.

- [ ] Unit/Slave scan preset
- [ ] Address scan preset
- [ ] FC43/14 Device Identification action
- [ ] adopt discovered device into a Monitor Session
- [ ] recent targets
- [ ] common Power Meter / VFD / PLC / Energy Meter templates

### Lane Q1 — Functional QA

**Write scope:** `test/master-*.test.js`, `e2e/master-*.spec.js`.  
**Forbidden scope:** production implementation files unless ownership is explicitly handed off.

- [ ] normalization/validation unit tests
- [ ] protocol read row decoding tests FC01-04
- [ ] mocked TCP read integration
- [ ] mocked serial RTU read integration
- [ ] ASCII read integration
- [ ] timeout and Modbus exception cases
- [ ] passive serial conflict/takeover tests
- [ ] polling start/stop/no-overlap behavior
- [ ] write-lock and write confirmation tests
- [ ] UI shell regression test
- [ ] browser E2E: TCP FC03 first read in under 60 seconds

### Lane Q2 — UI/UX + Visual QA

**Write scope:** test evidence/screenshots only unless handed back to Lane M2/M3/M4.

- [ ] compare implementation to approved mockups
- [ ] verify basic-read journey without documentation
- [ ] 1366x768, 1440x900, 1920x1080 layouts
- [ ] empty/loading/error/timeout states
- [ ] keyboard focus and form labels
- [ ] no clipped controls or horizontal layout bleed
- [ ] clear separation of passive Analyzer vs active Master

### Lane R1 — Reliability / Release

- [ ] repeated connect/disconnect cycles
- [ ] 1 h TCP polling soak
- [ ] 1 h RTU polling soak on representative hardware
- [ ] no duplicate poll timers after reconnect/page changes
- [ ] bounded memory for long polling sessions
- [ ] clean shutdown with active Master connection
- [ ] Windows packaged application smoke
- [ ] representative meter / PLC / inverter acceptance

## Milestones

### M1 — Basic Master Read (current critical path)

Acceptance:

- [ ] stable Sniffer still works unchanged
- [ ] Master page is visible in stable application
- [ ] user can connect RTU/ASCII/TCP
- [ ] user can perform FC01-04 Read Once
- [ ] user can start/stop cyclic polling
- [ ] live values and communication counters update
- [ ] errors/timeouts are obvious

### M2 — Professional Monitor Workspace

- [ ] saved monitor sessions
- [ ] multiple monitor tabs
- [ ] datatype / byte-order / scale formatting
- [ ] aliases and templates
- [ ] quick-start guided flow
- [ ] mini trend / open-in-Traffic shortcuts

### M3 — Guarded Writes

- [ ] FC05/06/15/16 minimum
- [ ] temporary unlock + explicit confirmation
- [ ] read-back verification
- [ ] audit trail
- [ ] FC22/23 where device/function semantics apply

### M4 — Acceptance

- [ ] exact-head automated tests pass
- [ ] UI/UX review pass
- [ ] representative Windows + RTU + TCP hardware evidence
- [ ] Product Owner accepts Master workflow before any default-product promotion

## Non-negotiable invariants

- Stable Sniffer remains passive/RX-only and is not silently converted into an active transmitter.
- Master transmission is explicit and visibly identified as active mode.
- No write can transmit while the Master write lock is locked.
- Same serial port cannot be silently owned by passive capture and active Master at the same time.
- Projects/Traffic/Register Lab remain optional support tools, not prerequisites for basic polling.
- No release/complete claim without exact-head evidence for all applicable gates.
