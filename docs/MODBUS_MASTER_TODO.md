# Modbus Master — Completion Checklist

**Status date:** 2026-09-18  
**Branch:** `v8-release-completion`

Checkboxes in the source section mean implementation exists. Acceptance remains separate.

## Source implementation — COMPLETE

### Connection / reads

- [x] RTU
- [x] ASCII
- [x] Modbus TCP
- [x] serial ownership protection
- [x] FC01/02/03/04 Read Once
- [x] non-overlapping cyclic polling
- [x] timeout / exception feedback
- [x] raw request/response evidence
- [x] Tx/Rx/error/timeout/retry/RTT counters
- [x] retries and retry delay
- [x] inter-request delay
- [x] RS-485 RTS direction/settle controls
- [x] TCP Unit IDs through 255

### Monitor workspace

- [x] raw PDU and reference addressing
- [x] Monitor Sessions
- [x] New / Save / Open / Duplicate / Rename / Delete
- [x] safe session switching
- [x] per-Monitor counter baseline/reset
- [x] saved snapshot clearly separated from a new live read
- [x] uint/int 16/32/64
- [x] float32/64
- [x] HEX / binary
- [x] ASCII / UTF-8
- [x] BCD / timestamp views through Data Lab
- [x] byte/word ordering
- [x] scale/offset/precision
- [x] register name/unit/notes mapping
- [x] direct Traffic action
- [x] direct Logger / Trend action

### Guarded writes

- [x] LOCKED by default
- [x] one-shot temporary unlock
- [x] automatic re-lock
- [x] FC05
- [x] FC06
- [x] FC15
- [x] FC16
- [x] FC21
- [x] FC22
- [x] FC23
- [x] explicit final confirmation
- [x] separate bulk confirmation
- [x] separate serial Unit 0 broadcast confirmation
- [x] old-value capture where applicable
- [x] read-back verification where applicable
- [x] mismatch/failure reporting
- [x] write audit

### Advanced functions

- [x] FC07 Read Exception Status
- [x] FC08 Diagnostics with LAB guard for non-zero diagnostic subfunctions
- [x] FC11 Comm Event Counter
- [x] FC12 Comm Event Log
- [x] FC17 Report Server ID
- [x] FC20 Read File Record
- [x] FC24 Read FIFO Queue
- [x] FC43/14 Device Identification
- [x] transport applicability guards

### Discovery integration

- [x] Unit scan
- [x] address/range scan
- [x] function probe
- [x] quantity probe
- [x] FC43 identity discovery
- [x] open/adopt discovered range into Master monitor
- [x] shared Traffic evidence

## Acceptance still required

- [ ] exact-head `npm test`
- [ ] exact-head quality/lint/version checks
- [ ] browser first-read workflow QA
- [ ] RTU FC01–04 hardware acceptance
- [ ] ASCII hardware/interoperability acceptance
- [ ] TCP FC01–04 interoperability acceptance
- [ ] guarded-write hardware acceptance
- [ ] repeated connect/disconnect test
- [ ] long polling soak
- [ ] Windows packaged smoke

## Non-negotiable invariants

- Sniffer stays passive.
- Master transmission is explicit.
- No write transmits while locked.
- Same serial port is not silently shared between active/passive modes.
- Saved Monitor state does not restore an armed write state.
- A first read never requires a Project.
