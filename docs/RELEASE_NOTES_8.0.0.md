# Modbus Engineering Tool 8.0.0 — Release Notes

**Release track:** unified Modbus engineering product  
**Release branch:** `v8-release-completion`  
**Primary runtime:** `src/index-v7.js`

## What ships

Version 8.0.0 consolidates the product into one Modbus-only engineering application with three primary operating modes:

- **Sniffer / Analyzer** — passive RX-only Modbus observation and reverse engineering.
- **Master / Client** — active RTU/ASCII/TCP polling, diagnostics and guarded writes.
- **Slave / Server Simulator** — multi-Unit simulation with standard and advanced Modbus transports.

Supporting engineering workspaces include Traffic and Protocol Diagnostics, Register/Data Lab, **Industrial Network Discovery & Device Intelligence**, Modbus Discovery, Raw Frame/Conformance Lab, Device Clone, Test Sequences, Logger/Trend, Replay/Compare, Transport Lab, and Modbus TCP Security/TLS diagnostics.

## Industrial Network Discovery

- Large IPv4 host/range/CIDR scans, including compact ranges such as `192.168.1-254.1-254`, plus bounded IPv6 host/CIDR support.
- Interface/subnet suggestions, exclusions, target previews and public-target confirmation.
- Multi-signal host discovery using neighbor evidence, TCP probes, reverse DNS and bounded ICMP fallback.
- Persistent device inventory with IP, MAC/OUI vendor, hostname, services, inferred type, provenance and confidence.
- Duplicate-IP / multi-IP-MAC findings and DHCP-context diagnostics.
- Industrial service-candidate detection with explicit distinction between candidates and verified protocols.
- Semantic Modbus TCP verification; an open port or echoed request cannot falsely prove Modbus.
- Unit-ID and FC43 continuation through the existing Modbus Discovery engine.
- Optional safe Nmap service/OS enrichment and explicit read-only SNMP/LLDP enrichment.
- SSDP, mDNS and WSD context discovery.
- Evidence-driven topology, subnet utilization, reference baselines, scan comparisons and per-device history.
- Selected-device monitoring plus Ping/Traceroute diagnostics, rolling packet-loss/RTT/jitter metrics.
- Native per-device Deep Scan works without Nmap; Nmap remains optional enrichment.
- Large live scans use paged result delivery so status polling does not repeatedly transfer the complete host inventory.
- IPv6 hosts participate in evidence topology using /64 grouping; read-only SNMP selects UDP4 or UDP6 from the target family.
- Safe **Open in Master** handoff prepares host/port/unit only and does not auto-connect or transmit.
- Network inventory is included in unified CSV/JSON/XLSX/PDF/ZIP evidence and desktop data migration.

## Safety model

- Sniffer remains passive and does not fabricate Modbus requests.
- Active serial ownership changes require explicit takeover.
- Master writes are locked by default and automatically re-lock.
- Bulk and broadcast writes require stronger confirmation.
- Rejected unsafe writes are audited as not transmitted.
- Raw malformed traffic and simulator fault injection require explicit LAB arming.
- Sensitive TLS server material is not included in public runtime state or simulator export.

## Reliability and evidence

- Master TCP reads perform one bounded transport reopen/retry after a dropped connection even when user-configured read retries are zero.
- Master read API distinguishes request errors, Modbus exceptions, timeouts and transport failures with actionable guidance; device exceptions/timeouts are no longer mislabeled as gateway 502/504 failures.
- Master polling UI rechecks backend connection state after failures, stops stale polling when disconnected, and exposes the full TCP Unit-ID range through 255 while preserving the serial 247 limit.
- Analyzer confirmation now requires matched request/response evidence; unmatched CRC-valid serial fragments remain observed-only and cannot populate confirmed device/register inventory.
- Dashboard and Analysis distinguish the active RTU/TCP source, suppress misleading confirmed KPIs from noisy serial input, and retain RTU/TCP device identity by channel/deviceKey.
- TCP Analyzer guidance now makes the inline-proxy boundary explicit: PLC traffic sent directly to the field device is not visible unless routed through the analyzer. A fixed-port-502 preset supports PLC clients that cannot change the Modbus TCP destination port.
- Shared active/passive Traffic evidence.
- Request/response, CRC/LRC/MBAP, exception, timing and transaction-order diagnostics.
- Bounded Logger/Trend persistence with restart hydration.
- Logger/Trend uses the configured runtime data root, including packaged desktop `userData`.
- Master Monitor Sessions use bounded atomic workstation persistence, retain a recoverable backup, and reload across browser/runtime restarts.
- Saved Monitor Sessions never persist or restore rendered field-derived HTML.
- The desktop renderer prefers a stable loopback origin and safely falls back to an ephemeral port if the preferred port is occupied.
- Desktop startup validates a per-process readiness token so a port race cannot attach the UI to an unrelated local backend.
- Raw-Lab conformance suites with semantic response validation.
- Capture, CSV/JSON/XLSX/PDF/ZIP evidence workflows.
- Deterministic source preflight and Mac release gate.
- Manual-only Windows NSIS packaging workflow with packaged-app identity smoke, provenance and SHA-256 checksums.
- Packaged Windows smoke also verifies the stable UI root and critical Master/Slave/Help assets.
- Fail-closed source audit protects product identity, manual-only workflows and core security invariants.
- Stable Playwright coverage checks asset loading, duplicate DOM IDs and document-level overflow.
- Unified browser acceptance runs before compatibility-shell browser coverage so product regressions fail fast.
- Legacy v8 planning/status documents are retained only as historical records and are explicitly marked superseded by the unified product documentation.

## Runtime and packaging

Normal, compatibility and desktop launch commands use the unified runtime:

```text
src/index-v7.js
```

Desktop product name:

```text
Modbus Engineering Tool
```

Installer artifact naming:

```text
Modbus-Engineering-Tool-Setup-8.0.0.exe
```

## Upgrade and data

Desktop writable engineering data remains under Electron `userData/data`. Legacy data migration is copy-only into an empty destination, rolls back partial failures, includes Logger/Trend, durable Master Monitor Sessions and their recovery backup, and does not merge into any existing populated user-data store.

## Release validation boundary

The source implementation and release-gate code are complete. A production release still requires evidence produced from the exact release head for applicable gates:

- source preflight / unit-integration suite,
- browser Playwright acceptance,
- bounded benchmark/soak,
- independent exact-head review,
- Windows packaged clean-machine smoke,
- representative physical RTU/TCP/TLS interoperability,
- production signing when signing material is supplied.

GitHub Actions remain manual `workflow_dispatch` only.
