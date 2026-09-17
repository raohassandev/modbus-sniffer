# Modbus Master — Implementation TODO

**Status date:** 2026-09-17  
**Branch:** `v8-release-completion`  
**Product rule:** stable Sniffer remains the default and must not regress. Master is added as an explicit active-polling workspace.

Checkboxes in implementation lanes mean the source/test artifact has been authored. They do **not** mean acceptance PASS. Acceptance and hardware evidence stay separate and unchecked until actually verified.

## Product outcome

The Master workflow must be immediately understandable to an engineer familiar with Modbus Poll / ModScan:

`Connect -> Unit/Slave -> Function -> Address/Quantity -> Read Once / Poll -> Live Values -> Format -> Guarded Write`

The first basic read must not require Projects, Register Lab, Traffic, or any v8 workspace knowledge.

## Lane model

AISH-OS concurrency rules apply: one integration owner for shared paths, non-overlapping implementation scopes, QA separate from implementation, exact-head evidence, and no planned lane reported as executing without repository evidence.

### Lane M0 — Integration / Critical Path

**Write scope:** `src/activeDiscoveryRoutes.js`, `public/platform-v6.js`, shared Master docs only.  
**Responsibility:** wire Master into the stable Sniffer without changing the Sniffer capture behavior.

- [x] install Master backend routes into the stable v7 product route stack
- [x] load Master CSS/JS in the stable UI shell
- [x] load Monitor Sessions assets only after the Master workspace is available
- [x] add Master navigation entry without removing existing Analyzer pages
- [x] ensure server shutdown closes active Master connection
- [x] preserve passive Sniffer as default startup and desktop experience
- [x] add clear UI identity: Analyzer is passive; Master is active

### Lane M1 — Master Connection + Read Runtime

**Write scope:** `src/master/**` only.  
**Responsibility:** active Modbus RTU / ASCII / TCP read engine using existing proven v8 transport/protocol components.

- [x] connection normalization and validation
- [x] RTU serial connection
- [x] ASCII serial connection
- [x] TCP client connection
- [x] safe connection ownership through `ConnectionBroker`
- [x] reuse `MasterEngine` and shared protocol encoder/decoder
- [x] FC01 Read Coils
- [x] FC02 Read Discrete Inputs
- [x] FC03 Read Holding Registers
- [x] FC04 Read Input Registers
- [x] timeout / Modbus exception / framing error propagation
- [x] Tx / Rx / error / timeout / RTT counters
- [x] request/response HEX evidence
- [x] explicit passive-capture takeover rule for the same serial port
- [x] clean disconnect/reconnect lifecycle

### Lane M2 — Master Main UI

**Write scope:** `public/master-v7.js`, `public/master-v7.css`.  
**Responsibility:** implement the approved Master mockup in the current Sniffer design system.

- [x] Master nav entry
- [x] Connection & Session card
- [x] RTU / ASCII / TCP selector
- [x] serial COM/baud/parity/data/stop controls
- [x] TCP host/port controls
- [x] timeout and poll interval
- [ ] dedicated Test Connection action (Connect / Disconnect already implemented)
- [x] Unit / Slave ID
- [x] FC01 / FC02 / FC03 / FC04 selector
- [x] raw PDU address input
- [x] functional reference-address input/toggle (0xxxx/1xxxx/3xxxx/4xxxx -> PDU)
- [x] Quantity
- [x] Read Once
- [x] Start Polling / Pause / Stop
- [x] live Tx/Rx/Error/Timeout/RTT counters
- [x] Live Data Grid
- [x] loading / disconnected / timeout / exception feedback states
- [x] responsive desktop layout rules consistent with current stable UI
- [x] explicit confirmed passive-Analyzer -> active-Master serial handoff

### Lane M3 — Data Format + Monitor Sessions

**Write scope:** `public/master-sessions-v7.js`, `public/master-sessions-v7.css`, future `src/master/format/**` / scoped format assets.  
**Responsibility:** familiar Modbus Poll-style reusable monitors and value interpretation.

- [x] basic uint16 / int16 quick display
- [ ] uint32 / int32
- [ ] float32
- [ ] uint64 / int64 / float64
- [x] basic HEX / binary display
- [ ] ASCII
- [ ] byte/word orders ABCD / BADC / CDAB / DCBA and required 64-bit permutations
- [x] basic scale / offset
- [ ] precision control
- [ ] per-row description/alias
- [x] save/open/duplicate monitor definition
- [x] multiple monitor tabs
- [x] persistent connection + Unit/FC/address/quantity/poll interval/timeout settings
- [x] persistent basic format/scale/offset settings
- [x] safe session switching stops active polling first
- [x] connection-profile changes disconnect the active Master before applying another saved target
- [x] saved live-grid snapshot per monitor, clearly identified as snapshot until refreshed
- [x] New / Save / Duplicate / Rename / Delete monitor workflow
- [ ] recent profiles / templates
- [ ] quick-start wizard
- [ ] selected-register mini trend
- [ ] per-monitor counter baseline/reset

### Lane M4 — Guarded Writes

**Write scope:** future `src/master/write/**`, `public/master-write-v7.js` and scoped tests.  
**Responsibility:** safe active writes; locked by default.

- [x] write state LOCKED by default in the M1 foundation
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

- [x] normalization/validation unit tests authored
- [ ] explicit protocol read row decoding tests for every FC01/02/03/04 path
- [ ] mocked TCP read integration
- [x] mocked serial RTU read integration authored
- [ ] ASCII read integration
- [ ] timeout and Modbus exception cases
- [x] passive serial conflict route test authored
- [x] polling start/stop/no-overlap regression authored
- [x] Monitor Sessions persistence/tab/switching regression authored
- [ ] write-lock and write confirmation tests
- [x] UI shell regression test authored
- [ ] browser E2E: TCP FC03 first read in under 60 seconds
- [ ] exact-head local `npm test` PASS

### Lane Q2 — UI/UX + Visual QA

**Write scope:** test evidence/screenshots only unless handed back to Lane M2/M3/M4.

- [ ] compare implementation to approved mockups
- [ ] verify basic-read journey without documentation
- [ ] verify Monitor Sessions tabs and actions in rendered UI
- [ ] 1366x768, 1440x900, 1920x1080 layouts
- [ ] empty/loading/error/timeout states visually verified
- [ ] keyboard focus and form labels
- [ ] no clipped controls or horizontal layout bleed
- [ ] clear separation of passive Analyzer vs active Master verified in rendered UI

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

### M1 — Basic Master Read (current acceptance gate)

Acceptance — evidence required:

- [ ] stable Sniffer still works unchanged on current exact head
- [ ] Master page is visible and usable in stable application
- [ ] user can connect RTU/ASCII/TCP
- [ ] user can perform FC01-04 Read Once
- [ ] user can start/stop cyclic polling
- [ ] live values and communication counters update
- [ ] errors/timeouts are obvious
- [ ] exact-head automated tests pass

### M2 — Professional Monitor Workspace

- [ ] saved monitor sessions accepted in rendered UI
- [ ] multiple monitor tabs accepted in rendered UI
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
- Switching Monitor Sessions must not leave an old poll timer running against a changed definition.
- A saved Monitor Session may restore stale values only as an explicitly labelled snapshot; a new live read is required for current quality.
- Projects/Traffic/Register Lab remain optional support tools, not prerequisites for basic polling.
- No release/complete claim without exact-head evidence for all applicable gates.