# Modbus Function / Product Matrix

**Status date:** 2026-09-18  
**Applies to:** unified runtime on `src/index-v7.js`

This matrix documents the implemented source behavior. It is not a hardware-interoperability PASS record.

| FC | Function | Master | Slave | Discovery / LAB | Notes |
|---:|---|---|---|---|---|
| 01 | Read Coils | Basic Read/Poll | Yes | Unit/range/conformance | Max read quantity 2000 |
| 02 | Read Discrete Inputs | Basic Read/Poll | Yes | Unit/range/conformance | Max read quantity 2000 |
| 03 | Read Holding Registers | Basic Read/Poll | Yes | Unit/range/conformance | Max read quantity 125 |
| 04 | Read Input Registers | Basic Read/Poll | Yes | Unit/range/conformance | Max read quantity 125 |
| 05 | Write Single Coil | Guarded write | Yes | Raw Lab | Serial broadcast supported |
| 06 | Write Single Register | Guarded write | Yes | Raw Lab | Serial broadcast supported |
| 07 | Read Exception Status | Advanced, serial | Yes | Function probe / Transport Lab | Serial diagnostic use |
| 08 | Diagnostics | Advanced, serial | Yes | Function probe / Transport Lab | Non-zero subfunctions require LAB confirmation |
| 11 | Get Comm Event Counter | Advanced, serial | Yes | Function probe / Transport Lab | Serial diagnostic use |
| 12 | Get Comm Event Log | Advanced, serial | Yes | Function probe / Transport Lab | Serial diagnostic use |
| 15 | Write Multiple Coils | Guarded write | Yes | Raw Lab | Bulk confirmation; serial broadcast supported |
| 16 | Write Multiple Registers | Guarded write | Yes | Raw Lab | Bulk confirmation; serial broadcast supported |
| 17 | Report Server ID | Advanced, serial | Yes | Function probe / Transport Lab | Serial diagnostic use |
| 20 | Read File Record | Advanced | Yes | Transport Lab / Raw Lab | Structured record list |
| 21 | Write File Record | Guarded write | Yes | Raw Lab | Bulk confirmation |
| 22 | Mask Write Register | Guarded write | Yes | Raw Lab | Read-back/audit path |
| 23 | Read/Write Multiple Registers | Guarded write | Yes | Raw Lab | Bulk confirmation |
| 24 | Read FIFO Queue | Advanced | Yes | Function probe / Transport Lab | FIFO simulator support |
| 43/14 | Read Device Identification | Advanced | Yes | Identity Discovery / function probe / Transport Lab | Basic/regular/extended/specific object modes supported by protocol core |

## Broadcast behavior

For serial RTU/ASCII, Unit ID 0 is handled only for FC05, FC06, FC15 and FC16. The Slave applies the write without returning a response. The Master requires a separate explicit broadcast confirmation and disables read-back.

## Exceptions

The Slave returns Modbus exceptions for unsupported functions, invalid ranges/values, device errors and unsupported diagnostic subfunctions. The Advanced Slave LAB can additionally force deterministic exception responses, latency, drops, duplicate responses, wrong Unit/FC, truncation and checksum corruption.

## Raw / conformance testing

Raw Frame Lab can compose RTU, ASCII and TCP ADUs, apply CRC/LRC automatically where applicable, validate expected responses/masks, repeat cases, save/import/export cases and run conformance presets. Risky or malformed transmissions require explicit LAB arming.

## Transport exposure

Normal Master: RTU, ASCII, TCP.  
Slave: RTU, ASCII, TCP, TLS, UDP, RTU-over-TCP, ASCII-over-TCP, RTU-over-UDP and ASCII-over-UDP.  
Transport Lab: Modbus TCP, Modbus TCP Security/TLS, UDP MBAP, and the RTU/ASCII tunnel variants.

The UDP/tunnel variants are explicitly labelled convenience/non-standard encapsulations where applicable.
