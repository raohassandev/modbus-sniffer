# Digital Twin Safety Boundary

Capture-to-Digital-Twin is configuration generation, not live control.

A generated twin starts as a draft, preserves its source connection and Register Lab evidence, marks uncertain/inferred definitions, and defaults writable Modbus areas to read-only. Applying a twin creates Simulator configuration only. The Simulator refuses to start a generated server until that specific twin has been explicitly reviewed and approved. Approval does not arm a Master connection and does not enable production writes.

If writable Coils or Holding Registers are explicitly requested for a generated simulator, that choice is persisted as simulator-only access policy. Discrete Inputs and Input Registers remain read-only.
