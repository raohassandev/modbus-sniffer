# PCAP / PCAPNG Feasibility Decision

**Status date:** 2026-09-18  
**Decision:** do not generate synthetic PCAP/PCAPNG from the current evidence model.

## Why

The current application records Modbus engineering evidence at the ADU / transaction level:

- RTU and ASCII serial frames
- Modbus TCP/TLS/UDP ADUs
- timestamps, Unit IDs, function codes, raw HEX, RTT, timeout and decoded context
- connection/channel metadata

That is sufficient for the application's native `.mbcap`, JSON and CSV evidence workflows, but it is not the same as a packet capture.

For Modbus TCP, the application receives a byte stream after the operating system TCP stack. It does not retain Ethernet/IP/TCP headers, TCP sequence/acknowledgement numbers, packet segmentation or retransmission packets. Constructing those fields afterward would fabricate network evidence.

For RTU/ASCII serial, ordinary PCAP has no universally interoperable native representation for the application's serial-wire timing/framing model. A PCAPNG custom block or private link type could be invented, but third-party tooling support would be weak and it would not improve evidentiary quality over the existing native capture.

## Supported evidence instead

The canonical evidence formats remain:

- `.mbcap` for application capture/replay
- Traffic raw HEX plus decoded ADU/PDU context
- CSV/JSON exports
- selected Traffic evidence export
- Raw Lab / conformance exact-run JSON
- Logger/Trend CSV and rotating JSONL
- capture/register-map/test-run comparison

## Future condition for real PCAP support

PCAP/PCAPNG should be added only if the product gains a real packet-capture backend that records original packet-layer data before stream reassembly, with clear privilege/platform handling and without fabricating headers.

Until then, fake PCAP output is intentionally excluded from the product.
