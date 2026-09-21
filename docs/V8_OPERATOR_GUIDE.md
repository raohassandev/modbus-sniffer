# Modbus Engineering Tool — Operator Guide

**Branch status:** product-integration / experimental until exact-head validation and field acceptance  
**Stable default:** Sniffer / Analyzer on `npm start`  
**Purpose:** advanced Modbus testing, simulation, analysis, reverse engineering, research and evidence.

This product is intentionally Modbus-only. It is not an HMI/SCADA builder, PLC programming environment, plant historian or generic automation platform.

## 1. Start the application

Install dependencies:

```bash
npm ci
```

Run the accepted Sniffer / Analyzer:

```bash
npm start
```

Open:

```text
http://127.0.0.1:8080
```

The older experimental v8 composition is available only when intentionally requested:

```bash
npm run workbench
```

Do not treat the v8 composition as the release default until the unified Modbus product migration is accepted.

## 2. Product modes

### Sniffer / Analyzer

Passive mode. Use it to observe an existing Modbus bus or TCP exchange without generating normal polling traffic.

Primary work:
- decode requests/responses
- form devices from Unit/Slave IDs
- learn polling groups and intervals
- measure RTT, timeouts, exceptions and noise
- inspect raw frames
- infer register maps/data types
- save captures and engineering evidence

The passive RTU Analyzer is receive-only by design.

### Master / Client

Active mode. Use it to communicate directly with a Modbus device.

Primary work:
- RTU / ASCII / TCP connection
- FC01–04 reads and continuous polling
- saved Monitor Sessions
- 16/32/64-bit integer/float interpretation
- byte/word order, scale, offset and precision
- per-register engineering names/units/notes
- guarded writes
- advanced diagnostics/function requests
- direct Traffic troubleshooting

### Slave / Server

Active server mode. Use it to simulate Modbus devices.

Primary work:
- RTU / ASCII / TCP server
- multiple Unit IDs
- Coils, Discrete Inputs, Holding Registers and Input Registers
- direct simulator memory editing
- incoming request/write evidence
- connected TCP client visibility
- FC43 identity
- advanced diagnostic/file/FIFO behavior
- JSON simulator-map import/export

## 3. Serial ownership safety

A physical serial adapter cannot be silently shared by incompatible modes.

Before switching the same COM/serial port:
- Sniffer -> Master requires explicit confirmation
- Sniffer -> Slave requires explicit confirmation
- Master -> Slave requires explicit confirmation
- Slave -> Master requires explicit confirmation
- active RTU Discovery must be stopped before serial Slave mode

A mode switch closes/releases the previous active owner before opening the next one.

## 4. Master basic polling

Normal commissioning flow:

```text
Connect
  -> Unit / Slave ID
  -> Function
  -> Start Address
  -> Quantity
  -> Timeout / Poll Interval
  -> Read Once or Start Polling
  -> Live Values
```

Basic reads:
- FC01 Read Coils
- FC02 Read Discrete Inputs
- FC03 Read Holding Registers
- FC04 Read Input Registers

Polling requests are serialized so a slow request cannot create an overlapping poll storm.

## 5. Address notation

The protocol uses zero-based PDU addresses. Manuals often show reference notation.

| Area | Function | First reference | PDU address |
| --- | --- | ---: | ---: |
| Coils | FC01 | 00001 | 0 |
| Discrete Inputs | FC02 | 10001 | 0 |
| Input Registers | FC04 | 30001 | 0 |
| Holding Registers | FC03 | 40001 | 0 |

Example: manual reference 40011 normally maps to FC03 PDU address 10.

Always verify the vendor manual because some vendors already publish zero-based values.

## 6. Datatype interpretation

Monitor Sessions support common engineering interpretations including:
- uint16 / int16
- uint32 / int32
- uint64 / int64
- float32 / float64
- HEX
- binary
- ASCII
- ABCD / BADC / CDAB / DCBA policies
- scale / offset / precision

Keep raw words visible while testing an interpretation. A numerically plausible float is not proof that the datatype is correct.

Per-register mapping can store an engineering name/alias, unit and notes for the active Monitor Session.

## 7. Guarded writes

Writes are locked by default.

The stable Master guarded-write path supports:
- FC05 Write Single Coil
- FC06 Write Single Register
- FC15 Write Multiple Coils
- FC16 Write Multiple Registers
- FC21 Write File Record
- FC22 Mask Write Register
- FC23 Read/Write Multiple Registers

Safety behavior:
- every operation requires explicit confirmation
- bulk operations require a separate bulk confirmation
- Unit 0 serial broadcast requires a separate broadcast confirmation
- read-back verification is enabled by default where a reply/read-back is possible
- old values are captured where supported
- the write latch automatically relocks after the operation
- audit records are append-only during the process lifetime
- operator comments can be stored with write evidence

Use the built-in Slave simulator for exploratory write tests whenever possible.

## 8. Advanced Master requests

The Advanced Modbus panel uses the same connection/Traffic path as normal Master requests.

Supported advanced request families:
- FC07 Read Exception Status — serial
- FC08 Diagnostics — serial
- FC11 Get Comm Event Counter — serial
- FC12 Get Comm Event Log — serial
- FC17 Report Server ID — serial
- FC20 Read File Record
- FC24 Read FIFO Queue
- FC43/14 Read Device Identification

Non-zero FC08 diagnostic subfunctions require explicit LAB confirmation.

FC21 is intentionally handled by Guarded Write rather than the read/diagnostic path.

## 9. Slave memory and identity

Each simulated Unit ID has independent:
- Coils
- Discrete Inputs
- Holding Registers
- Input Registers
- Device Identification objects
- exception-status byte
- File Record storage
- FIFO queues

The default direct Memory Editor changes simulator state deliberately; it is not a Modbus client write and therefore does not represent external write evidence.

External Master writes remain visible in Slave protocol events.

Simulator maps can be exported/imported as JSON. Exported maps preserve connection configuration, Unit IDs, non-zero memory, Device Identification, File Records and FIFO queues.

## 10. Traffic and troubleshooting

Traffic is protocol evidence, not a competing workflow.

When communication fails, inspect in this order:
1. active mode and connection ownership
2. exact Tx bytes
3. whether a reply arrived
4. Unit ID/function/address matching
5. CRC/LRC/MBAP validity
6. exception response
7. timeout/RTT/timing
8. only then datatype/engineering interpretation

Master provides a direct **Open Traffic** action with the current Unit/function/address filters.

## 11. Discovery and reverse engineering

Discovery is active/read-only testing and must remain separate from passive sniffing.

Use it for:
- Unit/Slave scan
- FC43 device identification
- controlled address/range probing
- discovery evidence
- adopting confirmed information into later engineering work

Silence is not proof that an address or device exists.

Serial active discovery requires maintenance/exclusive-bus confirmation.

## 12. Test Center / LAB

The protocol Test Center is for repeatable Modbus research:
- raw RTU/ASCII/TCP frames
- CRC/LRC helpers
- expected-response matching/masks
- validated read/write steps
- delays
- repeats
- assertions
- recipes
- malformed/boundary testing under explicit LAB controls

Raw/LAB transmission is not a shortcut around write safety.

## 13. Device Clone

The former generic “Digital Twin” direction is restricted to a Modbus-specific capability:

**Device Clone / Capture-to-Simulator**

Its purpose is to turn captured/confirmed Modbus register evidence into a virtual Slave definition for controlled research.

A Device Clone must preserve:
- source connection/device
- Unit ID
- memory area/address
- observed values
- provenance/confidence
- uncertain/inferred points
- explicit writable-area policy

It is not a plant/process digital-twin platform.

## 14. Test Sequences / API

The former generic “Automation” direction is restricted to Modbus test automation.

Allowed:
- scripted reads/writes
- simulator start/stop
- recipes/assertions
- protocol regression tests
- evidence collection

Not allowed:
- generic plant control
- arbitrary process automation
- non-Modbus workflow orchestration

Automated writes use the same confirmation/safety model as UI writes.

## 15. Logger / Trend / Replay / Reports

History capabilities exist only as Modbus engineering evidence:
- register/value trends
- communication event logs
- session replay
- capture comparison
- test-run evidence
- bounded exports/reports

Do not treat these components as a general plant historian.

## 16. Modbus transport lab

The shared transport core contains:
- RTU
- ASCII
- TCP client/server
- UDP client/server
- RTU/ASCII tunnelling
- TLS client/server
- virtual loopback

Convenience/non-standard encapsulations must be labeled clearly.

Modbus TCP Security/TLS work is specifically for Modbus Security testing, not generic network-security analysis.

## 17. Evidence and export

Engineering outputs may include:
- raw capture
- transaction CSV
- register map
- polling groups
- device inventory
- simulator map
- write audit
- discovery/test evidence
- Excel/PDF/report bundle

Review Unit IDs, addresses, datatype assumptions and source provenance before handing results to another engineer/site.

## 18. Validation boundary

Source implementation is not the same as release acceptance.

Before release eligibility, the exact final head still requires:
- full automated test suite
- stable Sniffer regression
- representative RTU hardware acceptance
- representative TCP device acceptance
- Slave interoperability
- Test Center/Discovery integration acceptance
- Windows packaged smoke
- long polling/simulation soak
- exact-head clean Mac release gate when release work resumes

Any source commit after a release-gate PASS invalidates that PASS for the new head.

## 19. Product scope

The canonical scope and live work state are:

```text
docs/MODBUS_ONLY_PRODUCT_AUDIT.md
docs/ACTIVE_TODO.md
docs/MODBUS_PARALLEL_LANES.md
docs/MODBUS_CORE_CONVERGENCE.md
```

If a proposed feature does not directly support Modbus testing, simulation, analysis, reverse engineering, research, troubleshooting, transport behavior or evidence, it does not belong in this product.
