# Automation Safety Boundary

Automation uses the product REST API; it is not a second protocol engine.

The supplied clients default to loopback-only endpoints. Master writes require explicit confirmation, bulk writes require a separate bulk confirmation and Unit-0 broadcasts require a separate broadcast confirmation. Requests then pass through the same server-side ownership, write latch, audit and read-back policy used by the UI.

Remote endpoints require explicit client opt-in and should use a trusted TLS endpoint.
