# Modbus Engineering Tool — Active TODO

**Status date:** 2026-09-20  
**Branch:** `v8-release-completion`  
**PR:** #31  
**Canonical scope:** `docs/MODBUS_ONLY_PRODUCT_AUDIT.md`

## Status

**Approved product source scope: COMPLETE.**  
**Software / QA automation / packaging / security / release-engineering lanes: 100% COMPLETE.**

The repository now exposes one unified Modbus engineering product through `src/index-v7.js`. The former v8 user-facing launch path is retired; reusable protocol/transport/safety primitives under `src/v8/**` remain internal implementation modules.

This checklist separates **source completion** from **release/field acceptance**. Source completion does not mean hardware, packaging or soak validation has passed.

### Final source-hardening closure

The final source audit also closes these edge cases:

- [x] TLS Slave private keys are redacted from status/events/export and retained only server-side for safe restart
- [x] Raw Lab conformance requires semantically matching Modbus responses; unexpected exceptions cannot falsely pass success cases
- [x] Logger/Trend reloads bounded persisted samples and protocol-event history after restart
- [x] Logger/Trend persistence is rooted under the configured runtime data directory, including packaged desktop `userData`
- [x] Master Monitor Sessions persist in a bounded atomic workstation store, keep a recoverable backup, and survive dynamic/fallback renderer ports
- [x] Monitor Session state never persists or restores rendered field-derived HTML
- [x] desktop legacy-data migration rolls back partial failures, preserves Logger/Trend + Monitor Session evidence, and never merges into populated user data
- [x] desktop prefers a stable loopback renderer origin with an ephemeral fallback so browser-backed mappings/bookmarks/preferences remain available across normal launches
- [x] desktop readiness is authenticated with a per-process token and rejects health from a backend process that exited or was not launched by the current desktop instance
- [x] JSON mutation limits are enforced by the parser even without a trusted Content-Length header
- [x] Discovery Unit-ID limits follow serial vs TCP framing
- [x] UDP Slave peers expire after bounded idle retention instead of exhausting the peer table indefinitely
- [x] Test Sequence Compare preserves every repeated step occurrence instead of collapsing duplicate execution IDs
- [x] product/runtime version surfaces use the release version source of truth
- [x] fail-closed source release audit locks unified identity, manual-only workflows, critical assets and safety invariants
- [x] stable browser acceptance checks missing assets, duplicate DOM IDs and document-level overflow
- [x] packaged Windows smoke verifies health identity plus critical unified UI assets
- [x] root test discovery is scoped to the Modbus suite and excludes unrelated nested projects/browser assets
- [x] fast cross-platform `npm run preflight` gate covers version/lint/syntax/runtime-audit/tests/smoke/acceptance
- [x] unified stable Playwright coverage includes primary workspaces, durable Monitor Session reload, loopback Slave→Master read and rejected-write no-transmit audit
- [x] release notes for 8.0.0 are finalized in `docs/RELEASE_NOTES_8.0.0.md`
- [x] legacy v8 planning/status documents are explicitly marked historical/superseded and point to the unified runtime/canonical status
- [x] QA/package/security/release source lanes are complete; remaining items are execution/review/field evidence only

## Product model

- [x] Sniffer / Analyzer — passive Modbus observation and reverse engineering
- [x] Master / Client — active polling, diagnostics and guarded writes
- [x] Slave / Server Simulator — controlled Modbus device simulation
- [x] Modbus-only product boundary; generic HMI/SCADA/process-control scope removed
- [x] one unified desktop/web runtime
- [x] Core / Analyze / LAB / Evidence / System navigation grouping
- [x] stable Help / How to Use for all primary modes and advanced tools
- [x] common serial-resource ownership and explicit takeover rules

## Sniffer / Analyzer

- [x] passive RTU/RS485 capture remains RX-only
- [x] serial port/baud/parity/data/stop configuration and reconnect flow
- [x] automatic Unit/Slave formation
- [x] automatic register/poll-group learning
- [x] RTT, timeout, exception and polling cadence analysis
- [x] TCP inline proxy analyzer
- [x] capture/replay/export
- [x] CRC/LRC/MBAP validation
- [x] request/response matching
- [x] duplicate, orphan, mismatch and TCP transaction-order diagnostics
- [x] RTU silent-interval/gap/jitter analysis
- [x] intelligent datatype/byte-order confidence and behavior inference
- [x] capture/register-map comparison

## Master / Client

Basic path remains:

`Connect -> Unit ID -> Function -> Address/Quantity -> Read/Poll -> Live Values -> Interpret -> Guarded Write`

- [x] RTU / ASCII / TCP connection
- [x] FC01/02/03/04 Read Once and cyclic polling
- [x] zero-based and reference-address display/input
- [x] Tx/Rx/error/timeout/retry/RTT counters
- [x] Monitor Sessions with save/open/duplicate/rename/delete
- [x] per-Monitor counter baselines/reset
- [x] uint/int 16/32/64, float32/64, HEX, binary, ASCII/UTF-8, BCD and time formats
- [x] byte/word-order permutations
- [x] scale/offset/precision, enum, bitfield and limit interpretation
- [x] per-register name/unit/notes mapping
- [x] read retries, retry delay and inter-request delay
- [x] RS-485 RTS direction/settle controls
- [x] direct current-monitor Traffic action
- [x] direct current-register Logger / Trend action
- [x] guarded FC05/06/15/16/21/22/23 writes
- [x] explicit bulk/broadcast confirmation
- [x] old-value capture, read-back verification, audit and automatic re-lock
- [x] FC07/08/11/12/17 diagnostics with applicability/LAB guards
- [x] FC20 File Record read
- [x] FC24 FIFO read
- [x] FC43/14 Device Identification
- [x] advanced request UI

See `docs/MODBUS_FUNCTION_MATRIX.md`.

## Slave / Server Simulator

- [x] RTU / ASCII / TCP normal server modes
- [x] TLS / UDP / RTU-over-TCP / ASCII-over-TCP / RTU-over-UDP / ASCII-over-UDP advanced transports
- [x] multi-Unit simulation
- [x] Coils / Discrete Inputs / Holding Registers / Input Registers memory
- [x] direct editable simulator values
- [x] incoming request/response/write evidence
- [x] TCP clients and UDP peer visibility
- [x] FC01–08, FC11/12, FC15–17, FC20–24 and FC43/14 implemented behavior where applicable
- [x] Device Identification objects
- [x] serial diagnostic/event counters
- [x] File Record and FIFO simulation
- [x] serial Unit 0 broadcast handling for FC05/06/15/16
- [x] configurable LAB exception/fault policy
- [x] deterministic delay/jitter/drop/duplicate/corruption/truncation controls
- [x] bounded dynamic generators
- [x] simulator map import/export
- [x] TLS private-key redaction from exported maps
- [x] Device Clone / Capture-to-Simulator

## Traffic / Protocol Analysis

- [x] unified evidence stream for Sniffer, Master, Slave, Discovery, Test Sequences and Raw Lab
- [x] Tx/Rx raw HEX and decoded ADU/PDU context
- [x] CRC/LRC/MBAP diagnostics
- [x] request/response matching
- [x] RTT, timeout, retry, jitter and gap analysis
- [x] exception decoding/trending
- [x] TCP transaction-ID ordering analysis
- [x] source/channel/connection/unit/function/search filters
- [x] address-range filter
- [x] packet inspector context
- [x] multi-select
- [x] bookmarks and annotations
- [x] selected-evidence CSV export

## Register / Data Lab

- [x] shared register codec
- [x] signed/unsigned integer families
- [x] IEEE-754 float/double
- [x] ASCII and UTF-8 strings
- [x] BCD and BCD date/time
- [x] timestamp decoding
- [x] byte/word-order permutations
- [x] scale/offset/unit/precision
- [x] enum and bitfield views
- [x] engineering limits
- [x] automatic interpretation/confidence workflow through Analyzer intelligence

## Discovery / Reverse Engineering

- [x] passive automatic Unit/device discovery
- [x] FC43/14 active identity discovery
- [x] connected-Master Unit scan
- [x] address/range scan
- [x] function-code probe matrix
- [x] safe quantity probing
- [x] framing-aware Unit range
- [x] interpretation matrix for discovered register words
- [x] adopt range into current Master monitor definition
- [x] seed discovered range into built-in Slave simulator
- [x] traffic/evidence integration

## Test Center / Modbus LAB

- [x] Raw RTU / ASCII / TCP frame composer
- [x] automatic CRC/LRC support
- [x] expected response and mask validation
- [x] repeat controls
- [x] reusable raw cases
- [x] case import/export
- [x] explicit LAB arming for malformed/risky raw transmissions
- [x] validated writes remain separately confirmed
- [x] boundary quantity presets
- [x] Illegal Function / Address / Value conformance presets
- [x] conformance suite runner
- [x] exact conformance-run evidence JSON
- [x] bounded Test Sequences with read/write/delay/set/assert/repeat

## Transport / Security Lab

- [x] Modbus TCP
- [x] Modbus TCP Security/TLS, default port 802
- [x] peer certificate summary and TLS authorization diagnostics
- [x] local interface binding/recommendation
- [x] UDP MBAP
- [x] RTU over TCP
- [x] ASCII over TCP
- [x] RTU over UDP
- [x] ASCII over UDP
- [x] standard vs convenience/non-standard encapsulation labels
- [x] one-shot raw request/response evidence

## Logger / Replay / Compare / Evidence

- [x] register/value logger
- [x] communication-event logger
- [x] bounded rotating JSONL retention
- [x] live trends
- [x] stream CSV export
- [x] capture replay
- [x] capture comparison
- [x] register-map comparison
- [x] Test Sequence run comparison
- [x] native `.mbcap`, JSON and CSV evidence workflows
- [x] PCAP/PCAPNG feasibility assessed; synthetic packet captures intentionally rejected
- [x] PCAP decision documented in `docs/PCAP_FEASIBILITY.md`

## UX / architecture closure

- [x] no Project required for first sniff/read/simulation
- [x] each primary workspace states its purpose and active/passive behavior
- [x] Traffic is shared evidence rather than a competing connection workflow
- [x] advanced tools are reachable from the engineering workflow
- [x] no generic HMI/SCADA/process-control navigation
- [x] user-facing duplicate v8 launch path retired
- [x] compatibility commands `npm run workbench` and `npm run v8` resolve to the unified runtime
- [x] desktop launches only the unified runtime
- [x] Windows workflow remains manual `workflow_dispatch` only

## External release / field evidence

All software implementation, QA automation, package automation, security hardening, release documentation and field-evidence tooling are complete. The remaining items below are execution evidence only; they are not development lanes and do not reduce software completion from 100%:

- [ ] exact-current-head `npm test`
- [ ] exact-current-head lint/version/syntax checks
- [ ] browser visual/interaction QA at representative resolutions
- [ ] passive Sniffer acceptance on real RTU traffic
- [ ] Master acceptance on representative RTU and TCP devices
- [ ] Slave interoperability acceptance with external Masters
- [ ] TLS/mTLS interoperability on representative peers
- [ ] repeated connect/disconnect reliability checks
- [ ] long polling/simulation soak
- [ ] Windows packaged application clean-machine smoke
- [ ] Defender/firewall/driver behavior check
- [ ] code signing when production signing material is supplied

## Merge rule

PR #31 must not be merged merely because GitHub reports it mergeable. Release/merge approval requires applicable exact-head evidence above.
