# WP-16 automation acceptance invariants

- CLI supports status, connections, reads, guarded writes, poll jobs, simulator control, recipes and digital-twin workflow.
- machine-readable JSON output is available.
- JavaScript and Python clients default to loopback-only endpoints.
- remote access requires explicit opt-in.
- write, bulk and broadcast confirmations cannot be omitted by client helpers.
- server-side ownership/write-lock/audit remains authoritative.
