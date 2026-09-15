# v8 Execution Architecture — Modbus Engineering Workbench

**Status:** active implementation contract  
**Baseline:** v7.0 analyzer/reverse-engineering platform  
**Companion documents:** `V8_ALL_IN_ONE_MODBUS_WORKBENCH_PLAN.md`, `V8_PROFESSIONAL_UI_UX_PLAN.md`, `V8_MASTER_TODO.md`

This document turns the v8 product roadmap into an implementation contract. It defines module ownership, dependency direction, runtime/event contracts, connection exclusivity, protocol boundaries, migration rules and the acceptance gates that must be satisfied before later Master/Slave/UI work can build on the foundation.

## 1. Non-negotiable architecture rules

1. **One protocol implementation.** Master, Slave Simulator, Analyzer, Discovery and Test Center must consume the same shared Modbus codec. Function-code logic must not be reimplemented per workspace.
2. **One transport owner.** A physical serial resource has one active runtime owner. A passive analyzer must never silently become an active master, slave or test transmitter.
3. **Explicit capability.** Runtime ownership advertises `none`, `read-only`, `forward-only` or `active` transmit capability. The UI renders this capability; it does not infer it from page name.
4. **Transport-neutral protocol core.** PDU encode/decode is independent of serial/TCP/UDP/TLS framing. RTU CRC, ASCII LRC and MBAP framing sit around the same PDU.
5. **Raw evidence is preserved.** Every decoded request/response retains the original bytes so Traffic, tests and reports can show exactly what was transmitted or received.
6. **Strict validation at boundaries.** Quantity, byte-count, address, Unit ID, MBAP length, CRC/LRC and exception validation happens before data reaches Master/Slave business logic.
7. **No v7 regression by refactor.** v8 modules are additive until conformance tests prove parity. Existing v7 analyzer paths remain available while adapters are migrated deliberately.
8. **No armed state persistence.** Write permission, fault injection and dangerous lab controls always restart locked/off.

## 2. Dependency direction

The allowed dependency graph is:

```text
UI / CLI / REST
       |
       v
Application services
  Master | Slave | Test | Discovery | Analyzer adapters
       |
       v
Connection Broker  <---- Project/config persistence
       |
       v
Transport interfaces / implementations
       |
       v
Shared Protocol Core
```

The Protocol Core must not import UI, Express, Electron, project stores, serialport, sockets or runtime-state classes. Transport implementations may import the Protocol Core only for framing helpers where appropriate; protocol code must never open I/O itself.

## 3. Planned source layout

```text
src/v8/
  events.js                    unified workbench event envelope
  connectionBroker.js          connection/resource ownership authority
  protocol/
    errors.js                  structured protocol validation errors
    model.js                   canonical PDU/message models
    lrc.js                     Modbus ASCII LRC helpers
    framing.js                 RTU / ASCII / MBAP ADU framing
    functions.js               standard function-code codecs
    index.js                   stable Protocol Core public surface
  transports/
    virtualLoopback.js         deterministic in-process transport for tests
    serialRtu.js               later
    serialAscii.js             later
    tcpClient.js               later
    tcpServer.js               later
    udp.js                     later
    tls.js                     later
  master/                      later
  slave/                       later
  testEngine/                  later
```

Existing `src/modbus/*` analyzer modules are not deleted in Phase 0/1. The new core initially reuses the proven v7 CRC implementation. Analyzer migration to the public v8 codec happens behind regression fixtures after the shared API stabilizes.

## 4. Canonical protocol message model

The Protocol Core uses a transport-neutral shape:

```js
{
  kind: 'message' | 'exception',
  unitId: 0..255,
  functionCode: 1..255,
  pdu: Buffer,
  data: Buffer,
  exceptionCode?: 1..255,
  originalFunctionCode?: 1..127
}
```

Rules:

- `unitId` is transport-neutral. RTU/ASCII transport policies later constrain production slave ranges and broadcast semantics; TCP may legitimately carry Unit 0.
- `pdu` always includes the function byte; `data` excludes it.
- Exception responses are normalized but raw PDU bytes are preserved.
- Unknown/vendor function codes remain representable even when no structured standard decoder exists.

## 5. Framing contracts

### RTU

`encodeRtuAdu(unitId, pdu)` produces `Unit + PDU + CRC low + CRC high`.

`decodeRtuAdu(frame)` verifies minimum/maximum size and CRC before returning Unit/PDU. Stream timing/frame extraction remains a transport concern; the framing codec only validates a complete ADU.

### ASCII

`encodeAsciiAdu(unitId, pdu)` produces `:HEX...LRC\r\n` using upper-case hexadecimal.

`decodeAsciiAdu(frame)` validates delimiters, hexadecimal pairs and LRC. Stream line assembly/timeouts remain a transport concern.

### Modbus TCP / MBAP

`encodeTcpAdu({ transactionId, protocolId, unitId, pdu })` creates the 7-byte MBAP header plus PDU. Length is exactly `1 + PDU length` and Protocol ID defaults to 0.

`decodeTcpAdu(adu)` validates MBAP length, PDU bounds and optionally requires Protocol ID 0. TCP stream fragmentation/coalescing remains the responsibility of the TCP stream parser.

## 6. Standard function-code implementation policy

Each supported function has four possible operations:

- request encode;
- request decode;
- response encode;
- response decode.

Phase 1 starts with the high-value mandatory set used by Master/Slave MVP:

- FC01/02 read bits;
- FC03/04 read registers;
- FC05 single coil write;
- FC06 single register write;
- FC15 multiple coil write;
- FC16 multiple register write;
- FC23 read/write multiple registers;
- FC43/MEI 0x0E Device Identification request/response parsing.

Every codec enforces the Modbus quantity/byte-count limits before bytes reach a transport.

## 7. Unified workbench event envelope

Every active/passive subsystem will converge on the same event shape:

```js
{
  schemaVersion: 1,
  eventId,
  timestamp,
  type,
  source,
  connectionId,
  channelId,
  ownerMode,
  direction,
  unitId,
  functionCode,
  rawHex,
  details
}
```

`rawHex` is immutable evidence text suitable for Traffic/history/reporting. `details` contains mode-specific decoded metadata. Later persistence may store binary raw payload separately for very large traffic volumes, but the event contract remains stable.

## 8. Connection Broker contract

The Connection Broker is the sole authority for runtime ownership. A connection definition includes:

```text
connectionId
resourceKey
transportKind
transport instance
metadata
```

Examples of `resourceKey`:

```text
serial:usb-VID1234-PID5678-SNABC
serial:COM7                         fallback when stable hardware identity is unavailable
tcp-client:192.168.1.50:502
virtual:test-bus-1
```

Owner modes and transmit capability:

| owner mode | capability | intended behavior |
|---|---|---|
| analyzer | none | passive RX only |
| replay | none | no live I/O |
| discovery | read-only | guarded read-only probes |
| proxy | forward-only | forward existing production bytes only |
| master | active | explicit Master requests/writes subject to write lock |
| slave | active | responses to received requests |
| test | active | explicit lab/test transmissions |

For exclusive resources, acquiring one connection locks its `resourceKey`. A second connection cannot acquire the same serial adapter under another mode until the first owner releases it. No automatic mode switching is allowed.

## 9. Virtual loopback

The first transport is an in-process paired loopback. It provides deterministic byte delivery without hardware and is used to prove:

1. Connection Broker ownership.
2. Master request -> framing -> transport -> Slave decode.
3. Slave response -> transport -> Master decode.
4. Analyzer decode of the same captured exchange.
5. Cancellation/timeouts/failure handling without flaky network dependencies.

It is test infrastructure and later a useful simulator/test-recipe transport.

## 10. v8 project schema direction

The final v8 project migration is implemented only after runtime contracts stabilize. The planned top-level additions are versioned and additive:

```text
schemaVersion: 3 (provisional)
connections[]
masterJobs[]
slaveServers[]
virtualDevices[]
testRecipes[]
charts[]
loggerProfiles[]
automation[]
hmiScreens[]
```

Existing v7 `channels`, engineering mappings, discovery evidence, adoptions, captures and history remain preserved. Migration must be idempotent, backed up, and never convert a passive analyzer channel into an active connection automatically.

## 11. Safety state model

The UI must read safety state from runtime, not maintain a second truth. At minimum every live connection exposes:

```text
ownerMode
transmitCapability
writeLock
faultInjectionEnabled
state
```

Hard rules:

- `writeLock` defaults to `LOCKED` every process start.
- Discovery never receives a write capability even if Master mode for another connection is unlocked.
- Fault injection is only legal for virtual/lab Slave/Test paths.
- Production TCP proxy cannot route through fault injection middleware.
- Releasing or reconnecting a Master connection returns its write lock to `LOCKED` unless a later explicit policy is reviewed and approved.

## 12. Initial implementation work package (WP-01)

WP-01 is complete only when all of these are green:

- shared structured protocol errors;
- canonical message/PDU model;
- RTU CRC framing around the shared PDU;
- ASCII LRC framing around the shared PDU;
- MBAP framing around the shared PDU;
- first standard request/response codecs;
- virtual loopback transport;
- Connection Broker exclusive ownership;
- unified event envelope;
- automated tests for valid and invalid cases;
- existing v7 tests remain green.

WP-01 does **not** expose production Master writes or change existing v7 analyzer runtime behavior.

## 13. Gate strategy

### Gate 0 — Foundation

- virtual connection can be defined/acquired/released;
- conflicting serial-style resource ownership is rejected;
- runtime owner capability is explicit;
- passive owner has no transmit capability.

### Gate 1 — Protocol Core

- framing golden vectors pass;
- PDU encode/decode round trips pass;
- invalid length/CRC/LRC/quantity inputs fail with structured codes;
- unknown/vendor PDU remains lossless;
- Master/Slave MVP can later depend only on the public `src/v8/protocol/index.js` API.

No UI page is considered complete before its backing gate is green.
