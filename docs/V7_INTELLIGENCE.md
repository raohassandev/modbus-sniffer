# Modbus Engineering Analyzer v7 — Intelligence Layer

v7 adds an automatic reverse-engineering layer on top of the v6 transport-aware analyzer.

## Implemented

### Automatic register intelligence

For every discovered register start address, v7 evaluates likely interpretations across observed samples:

- `uint16` / `int16`
- `uint32` / `int32` / `float32`
- `uint64` / `int64` / `float64`
- common 32-bit and 64-bit byte/word orders
- ASCII candidates
- timestamp candidates
- counter / resetting-counter behavior
- low-cardinality status / bitfield behavior

Each candidate receives a confidence score. Multi-register candidates are evaluated from actual aligned Modbus response samples rather than only the latest word.

### Master polling-cycle reconstruction

v7 studies the ordered request stream per channel and reconstructs repeating polling cycles. The result includes:

- requests per cycle
- devices per cycle
- recovered request order
- per-slot confidence
- median and P95 cycle time
- cycle jitter
- gap between request slots

This is intended to expose how a PLC, logger or gateway actually sequences its Modbus polling program.

### Device fingerprints

Each observed device receives a transport-independent fingerprint based on:

- function codes
- register blocks
- poll request shapes
- passive FC43 device-identification data when present

The analyzer compares fingerprints and suggests shared device profiles when two devices are sufficiently similar.

### Register relationship analysis

The intelligence engine looks for:

- duplicate registers
- strong positive/inverse correlation
- monotonic and resetting counters
- totals that closely equal the sum of adjacent component registers
- multiplicative relationships with a stable scale factor

These findings are intended to accelerate undocumented-register reverse engineering. They are hypotheses with confidence scores, not manufacturer documentation.

### Anomaly engine

The current capture is continuously evaluated for:

- offline / silent devices
- missing-response rate
- high polling jitter
- polling interval drift
- Modbus write traffic
- RTT shifts
- rising RTU line-noise activity
- newly observed devices

### Session comparison

The Intelligence workspace can load two `.mbcap` files locally in the browser and compare:

- devices added / removed
- register map changes
- polling groups and interval changes
- timeout / exception changes
- response-time changes

Capture files are parsed locally for the comparison workflow.

## Runtime integration

`npm start` now launches `src/index-v7.js` and uses `PlatformRuntimeStateV7`.

The existing `/api/analysis` response is extended with:

```text
analysis.intelligence.version
analysis.intelligence.registerIntelligence
analysis.intelligence.pollingCycles
analysis.intelligence.fingerprints
analysis.intelligence.relationships
analysis.intelligence.anomalies
```

Existing v6 consumers can ignore these additional fields.

## UI

The browser sidebar now includes an **Intelligence** workspace showing:

- intelligence KPI summary
- recovered master polling cycles
- anomaly events
- automatic register interpretations
- device fingerprint matches
- register relationships
- before/after capture comparison

The visible badge is **UI v7.0**.

## Safety

The intelligence layer is analytical only. It does not add production Modbus writes. Passive RTU capture remains receive-only. Existing active discovery remains a separate explicitly guarded maintenance workflow.

## Validation

The v7 modules are included in the cross-platform CI syntax gate, and unit tests cover polling-cycle reconstruction, register intelligence, fingerprints, relationships, anomaly detection and capture comparison.
