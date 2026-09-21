# Industrial Network Discovery & Device Intelligence Plan

**Status date:** 2026-09-21  
**Branch:** `v8-release-completion`  
**Parent product:** Modbus Engineering Tool  
**Execution model:** live development lanes; no scheduler/background automation is required for project delivery.  
**Implementation status:** **SOURCE COMPLETE — 2026-09-21**

## Implementation closure

The approved Industrial Network Discovery & Device Intelligence source scope is implemented in the unified product. The source now includes:

- bounded IPv4 host/range/CIDR parsing plus compact ranges such as `192.168.1-254.1-254`;
- bounded IPv6 host/CIDR support with the same target-count safety gates;
- local-interface/subnet suggestions, neighbor-table enrichment, ICMP fallback and staged TCP service discovery;
- service and industrial-candidate classification with property provenance;
- semantic Modbus TCP verification that rejects an open port or echoed request as proof of Modbus;
- Unit-ID/FC43 continuation into the existing Modbus discovery workflow;
- persistent project inventory, bounded scan history, baselines, comparisons and event history;
- duplicate-IP / multi-IP-MAC findings and DHCP-context findings;
- offline MAC/OUI vendor enrichment, optional safe Nmap enrichment, explicit read-only SNMP/LLDP enrichment, SSDP/mDNS/WSD context discovery;
- evidence-driven topology, subnet utilization and searchable/pan-zoom topology UI;
- device detail tabs, diagnostics, monitoring, filtering, configurable result columns and exports;
- safe **Open in Master** handoff with `connect:false` and `transmit:false`;
- integration into XLSX/PDF/ZIP/CSV evidence exports and packaged-desktop data migration;
- deterministic unit/integration/browser contracts covering target safety, persistence, Modbus false positives, diagnostics, protocol parsers and the integrated UI workflow.

Source completion is separate from representative field-network and clean-machine release evidence, which remains governed by the existing exact-head release gates.

### Lane closure

| Lane | Scope | Completion |
|---|---|---:|
| N1 | Architecture / persistence | 100% |
| N2 | Core scanner / target engine | 100% |
| N3 | Enrichment / industrial intelligence | 100% |
| N4 | Modbus integration / Master handoff | 100% |
| N5 | UI / UX / topology / device detail | 100% |
| N6 | History / baseline / monitoring / evidence | 100% |
| N7 | QA / hardening / release contracts | 100% |

Final hardening includes paged live scan results for large networks, native deep per-device scanning without an Nmap dependency, IPv6 /64 topology grouping, IPv4/IPv6 SNMP transport selection, rolling monitor packet-loss/RTT/jitter metrics, and spreadsheet-safe network inventory export.

## Goal

Extend the existing Modbus Discovery workspace into an industrial network discovery system that can start from an unknown IPv4 network, find hosts, enrich their identity, verify industrial services, correlate Modbus TCP endpoints with Unit IDs and existing project devices, preserve evidence/history, compare scans, and hand selected endpoints directly into the existing Master workflow.

The feature is not a generic vulnerability scanner and must not silently transmit Modbus writes.

## Product boundary

Network discovery is an enabling workflow for the existing Modbus Engineering Tool.

In scope:
- large IPv4 target/range/CIDR discovery, including ranges such as `192.168.1-254.1-254`
- future-ready IPv6 target model
- local-interface/subnet discovery
- multi-signal host discovery
- MAC/vendor/hostname/service/device identity enrichment
- industrial service candidates
- verified Modbus TCP detection and Unit-ID/FC43 continuation
- duplicate-IP and identity-change diagnostics
- project inventory, reference baseline, history and scan comparison
- topology evidence where the relationship is confirmed or explicitly labelled inferred
- selected-host monitoring diagnostics
- export/report/evidence integration
- optional external Nmap enrichment when separately installed

Out of scope:
- exploit/vulnerability scanning
- password guessing
- intrusive NSE/vulnerability scripts
- generic asset-management/cloud platform scope
- automatic Modbus writes
- fabricated topology links
- fabricated OS/device identities

## Core safety rules

1. Discovery results distinguish **Observed**, **Verified**, **Inferred**, and **User-defined** facts.
2. Ping failure alone never means Offline.
3. TCP/502 open alone never means Verified Modbus.
4. Modbus detection must validate a Modbus/MBAP response before declaring a host Modbus-capable.
5. Deep Modbus identity scans remain read-only.
6. Active RTU discovery retains the existing maintenance/exclusive-bus safety gates.
7. Large scans are bounded by concurrency, timeout, cancellation and per-stage rate controls.
8. Public/non-private target ranges require an explicit acknowledgement.
9. Scan cancellation preserves already collected evidence.
10. No scan setting restores an armed write or LAB state.

## User workflow

```text
Select interface / target
        ↓
Parse + validate range
        ↓
Fast host discovery
        ↓
Identity enrichment
        ↓
Service discovery
        ↓
Industrial service classification
        ↓
Verify Modbus TCP candidates
        ↓
Optional Unit-ID / FC43 identity scan
        ↓
Correlate with project / passive traffic
        ↓
Inventory + topology + history
        ↓
Open in Master / monitor / export / compare
```

## Target formats

Required IPv4 inputs:
- single host: `192.168.1.20`
- CIDR: `192.168.0.0/16`
- explicit range: `192.168.1.1-192.168.254.254`
- compact octet range: `192.168.1-254.1-254`
- multiple include targets
- explicit exclusions
- interface-derived local subnet

The parser must:
- reject invalid octets/prefixes
- deduplicate targets
- exclude network/broadcast addresses where applicable
- provide target count before execution
- enforce a configurable safe maximum
- never materialize huge ranges unnecessarily in memory

## Scan profiles

### Quick
Host discovery only.

### Standard Industrial
Host discovery + common network/industrial services + safe metadata.

### Modbus Focus
Host discovery + configurable Modbus ports + protocol verification + optional Unit-ID/FC43 follow-up.

### Deep
Broader bounded TCP service discovery + HTTP/TLS/SNMP enrichment + optional external Nmap enrichment.

### Custom
User-defined discovery methods, ports, timeouts, concurrency and enrichment stages.

Default profile should be **Standard Industrial** with conservative OT-safe concurrency.

## Discovery signals

Use multiple available signals; each result retains its source:
- OS neighbor/ARP cache
- active ARP where platform support permits
- ICMP echo
- bounded TCP connect probes
- reverse DNS
- mDNS
- SSDP/UPnP
- WSD where practical
- DHCP server discovery
- optional SNMP enrichment
- optional LLDP/SNMP topology data
- existing passive Modbus/TCP evidence in the application

A host state is derived from all evidence, not one probe.

## Device identity model

A network host is a parent entity separate from Modbus Unit IDs.

```text
Network Host
  IP / MAC / hostname / services
        │
        └── Modbus Endpoint host:port
                  ├── Unit 1
                  ├── Unit 2
                  └── Unit N
```

Required network-host fields:
- stable internal ID
- scanner ID (future distributed-scan compatibility)
- IP family/address
- MAC
- MAC/OUI vendor
- hostname/PTR/mDNS name
- local interface used
- subnet/CIDR
- first seen / last seen
- last changed
- discovery methods
- RTT/latency samples
- online/offline/unknown state
- identity confidence
- trusted/unknown/unexpected/ignored/decommissioned classification
- notes/tags
- services
- industrial service candidates
- Modbus endpoint verification
- references to correlated project/channel/device keys
- property-level provenance

## Property provenance

Identity facts must record:
- value
- source
- source timestamp
- confidence
- status: observed / verified / inferred / user
- conflict state

Conflicting sources are displayed; one source must not silently overwrite another.

## Service model

Common network candidates:
- SSH 22
- Telnet 23
- DNS 53
- HTTP 80
- HTTPS 443
- SNMP 161
- NTP 123

Industrial candidates:
- Siemens S7 102
- Modbus TCP 502
- Modbus TCP Security 802
- MQTT 1883 / 8883
- OPC UA 4840
- EtherNet/IP 44818
- BACnet/IP UDP 47808

Non-Modbus protocol support is detection/context only. Deep protocol control remains out of product scope.

## Modbus verification

For every candidate Modbus endpoint:
1. TCP connect.
2. Send a bounded read-only verification request only when user/profile enables protocol verification.
3. Validate MBAP framing/transaction semantics.
4. Mark endpoint Verified Modbus only on a valid Modbus response.
5. Offer Unit-ID scan.
6. Reuse existing FC43/MEI 0x0E identity scan.
7. Save evidence with the project.
8. Offer **Open in Master** using host/port/unit without automatically starting polling.

## Duplicate/conflict diagnostics

Required findings:
- one IPv4 address observed with multiple MAC addresses
- one MAC observed with multiple current IPv4 addresses
- hostname changed
- MAC changed
- vendor/identity changed
- service opened/closed
- Modbus verification appeared/disappeared
- Modbus Unit added/removed
- FC43 identity changed
- unexpected DHCP server
- reference inventory device missing/new

Severity is evidence-based; uncertainty is shown.

## Inventory and baseline

Inventory views:
- All
- Online
- Offline
- New
- Changed
- Modbus
- Industrial
- Unknown
- Trusted
- Unexpected

User can save any completed scan as a **Reference Network**. Later scans compare against it without mutating the baseline.

Comparison classes:
- Added
- Removed/Missing
- Changed
- Unchanged

## Topology

Topology is evidence-driven.

Allowed relationship sources:
- LLDP
- SNMP bridge/FDB/neighbor data
- directly observed local interface/gateway relationships
- observed application traffic
- explicit manual relationship

Every edge must expose its source and confidence. Inferred edges use a distinct visual style.

Views:
- physical/evidence topology
- logical subnet/service topology
- subnet utilization heatmap

## Monitoring

Selected known devices may enter a lightweight monitor mode:
- availability
- RTT
- packet loss/jitter where measurable
- selected TCP service availability
- Modbus verification availability

Monitoring is local and bounded. Project development itself does not use scheduled ChatGPT tasks.

## History and event timeline

Network events integrate with existing evidence/history concepts:
- device discovered
- device disappeared/returned
- IP/MAC/name changed
- service opened/closed
- duplicate IP detected/resolved
- Modbus verified/lost
- Unit added/removed
- identity changed
- topology relationship changed

Scan history stores completed/partial scans with target/profile/settings and bounded results.

## UX structure

Keep the sidebar compact by evolving the existing **Discovery** page into tabs:

```text
Discovery
  [ Network Scan ] [ Devices ] [ Topology ] [ Modbus ] [ History ]
```

The global navigation remains Core / Analyze / LAB / Evidence / System; Discovery stays within Analyze unless later usability testing proves a separate group is clearer.

### Network Scan
Header:
- Interface selector
- Target editor
- Scan profile
- Start/Pause/Resume/Stop
- Advanced settings drawer

Live progress:
- targets
- scanned
- online
- industrial
- verified Modbus
- unknown
- warnings/errors
- elapsed/progress percentage

Results table default columns:
- State
- IP
- Name
- MAC/Vendor
- Type
- Services
- Modbus
- RTT
- Last Seen

Columns are configurable.

### Device detail drawer
Tabs:
- Overview
- Network
- Services
- Modbus
- History
- Evidence
- Notes

Primary actions:
- Open Web UI
- Copy IP/MAC
- Ping/continuous ping
- Traceroute
- Deep Scan
- Scan Modbus
- Open in Master
- Monitor
- Trust/Mark expected

### Topology
- pan/zoom
- search/filter
- subnet grouping
- status/protocol filters
- evidence/confidence legend
- no invented links

### Address utilization
For /24 show host cells; for larger ranges aggregate by subnet and drill down.

## Persistence model

Do not overload existing `discoveryRuns` FC43 evidence with generic network scans.

Add bounded project collections:
- `networkHosts`
- `networkScans`
- `networkBaselines`
- `networkEvents`
- optional `networkTopology`

Persistence must:
- be version-tolerant
- preserve existing workspace v2 data
- use existing atomic workspace save behavior
- bound histories and evidence
- reject corrupt/oversized imported structures

## API design

Initial routes:
- `GET /api/network/interfaces`
- `POST /api/network/targets/preview`
- `POST /api/network/scan/start`
- `POST /api/network/scan/pause`
- `POST /api/network/scan/resume`
- `POST /api/network/scan/cancel`
- `GET /api/network/scan/status`
- `GET /api/network/hosts`
- `GET /api/network/hosts/:id`
- `POST /api/network/hosts/:id/modbus`
- `POST /api/network/hosts/:id/open-master`
- `GET /api/network/scans`
- `GET /api/network/scans/:id`
- `POST /api/network/scans/:id/baseline`
- `GET /api/network/compare?... `
- `GET /api/network/topology`

All mutation routes follow existing same-origin/body-limit/rate-limit controls.

## Engine architecture

Modules:
- `src/networkDiscovery/targetParser.js`
- `src/networkDiscovery/networkInterfaces.js`
- `src/networkDiscovery/hostDiscovery.js`
- `src/networkDiscovery/serviceScanner.js`
- `src/networkDiscovery/deviceFingerprint.js`
- `src/networkDiscovery/modbusVerifier.js`
- `src/networkDiscovery/scanManager.js`
- `src/networkDiscovery/networkDiscoveryRoutes.js`
- `src/networkDiscovery/networkStore.js` or project-store integration
- optional `src/networkDiscovery/nmapAdapter.js`

Execution stages:
1. target preview
2. host discovery
3. enrichment
4. service candidates
5. industrial classification
6. Modbus verification
7. optional Modbus identity continuation
8. persistence/evidence/correlation

Queues have independent concurrency limits so Modbus/device probes remain far lower than lightweight host discovery.

## Optional Nmap integration

Nmap is optional and never required for base operation.

If installed:
- detect executable/version
- safe host/service/OS enrichment only
- parse machine-readable XML output
- never run vulnerability/exploit categories by default
- display provenance as `external:nmap`

If absent, UI simply reports enhanced fingerprinting unavailable.

## QA strategy

### Unit
- compact-range/CIDR parsing
- exclusion/deduplication
- huge-target bounds
- profile validation
- private/public target classification
- host-state aggregation
- confidence/provenance merging
- duplicate-IP detection
- service classification
- Modbus verification false-positive rejection
- scan cancellation/pause/resume
- persistence bounds/migration compatibility

### Integration
- API validation and state transitions
- workspace persistence/restart
- network-host ↔ Modbus endpoint ↔ Unit correlation
- existing FC43 discovery reuse
- Open-in-Master prepared session
- evidence/history emission

### Browser/E2E
- target preview
- scan start/pause/resume/cancel
- live progress
- filters/columns/search
- device drawer
- Modbus workflow handoff
- history/baseline comparison
- responsive widths and no horizontal document overflow

### Negative/security
- invalid/public/huge ranges
- malformed hostname/service metadata
- HTML injection in device/banner data
- SSRF-like unsafe URL handling for Web UI action
- resource exhaustion
- cancellation races
- restart during partial scan
- corrupt persisted scan
- Nmap output injection/oversize

## Development lanes

### Lane N1 — Architecture / persistence
Plan, schema, target model, workspace compatibility.

### Lane N2 — Core scanner
Target parser, interface discovery, scan manager, host discovery.

### Lane N3 — Enrichment / industrial intelligence
Services, fingerprints, duplicate IP, HTTP/TLS/DNS metadata, optional SNMP hooks.

### Lane N4 — Modbus integration
Verified Modbus endpoint, Unit/FC43 continuation, project/device correlation, Master handoff.

### Lane N5 — UI/UX
Discovery tab shell, scan controls, table, drawer, filters, progress, topology/address map.

### Lane N6 — History/baseline/topology
Persistent scans, compare, events, baseline, evidence-driven topology.

### Lane N7 — QA / hardening
Unit/integration/E2E/security/performance/source-audit/release docs.

## Definition of source complete

Source implementation is complete only when:
- the large-range parser handles the required range syntaxes safely
- the scanner can find live hosts without depending only on ping
- results expose useful identity/service/provenance details
- verified Modbus detection cannot be triggered by TCP/502 alone
- Modbus Unit/FC43 discovery integrates with the current Discovery subsystem
- a discovered endpoint can be prepared in Master without automatic writes/polling
- results persist and survive restart
- baseline/compare and duplicate-IP diagnostics work
- UI supports large-result filtering/search without layout breakage
- cancellation/pause/resume are race-safe
- tests lock the core behaviors
- existing Modbus workflows remain regression-safe

Physical/OS-specific packet behavior and representative field-network acceptance remain release evidence, not fabricated source evidence.
