'use strict';

const FC_NAMES = {
  1: 'Read Coils', 2: 'Read Discrete Inputs', 3: 'Read Holding Registers', 4: 'Read Input Registers',
  5: 'Write Single Coil', 6: 'Write Single Register', 7: 'Read Exception Status', 8: 'Diagnostics',
  11: 'Get Comm Event Counter', 12: 'Get Comm Event Log', 15: 'Write Multiple Coils',
  16: 'Write Multiple Registers', 17: 'Report Server ID', 22: 'Mask Write Register',
  23: 'Read/Write Multiple Registers'
};

const EXCEPTION_NAMES = {
  1: 'Illegal Function', 2: 'Illegal Data Address', 3: 'Illegal Data Value', 4: 'Slave Device Failure',
  5: 'Acknowledge', 6: 'Slave Device Busy', 8: 'Memory Parity Error', 10: 'Gateway Path Unavailable',
  11: 'Gateway Target Failed to Respond'
};

function u16(buf, i) { return buf.readUInt16BE(i); }
function wordsFromData(data) {
  const words = [];
  for (let i = 0; i + 1 < data.length; i += 2) words.push(u16(data, i));
  return words;
}

function bitsFromData(data) {
  const bits = [];
  for (const b of data) for (let bit = 0; bit < 8; bit++) bits.push(Boolean(b & (1 << bit)));
  return bits;
}

function decodeFrame(frame) {
  const slaveId = frame[0];
  const rawFc = frame[1];
  const exception = Boolean(rawFc & 0x80);
  const fc = rawFc & 0x7F;
  const out = { slaveId, functionCode: fc, functionName: FC_NAMES[fc] || `Function ${fc}`, exception, raw: frame };

  if (exception) {
    out.kind = 'response';
    out.exceptionCode = frame[2];
    out.exceptionName = EXCEPTION_NAMES[out.exceptionCode] || 'Unknown Exception';
    return out;
  }

  switch (fc) {
    case 1: case 2: {
      // FC01/02 have one unavoidable wire-level ambiguity: a response with byteCount=3
      // is also 8 bytes long, exactly like a normal read request. Preserve both
      // interpretations and let the transaction tracker resolve it using pending-request
      // context and the expected response byte count.
      if (frame.length === 8 && frame[2] === 3) {
        out.kind = 'ambiguous-read';
        out.startAddress = u16(frame, 2);
        out.quantity = u16(frame, 4);
        out.byteCount = frame[2];
        out.data = frame.subarray(3, 3 + out.byteCount);
        out.bits = bitsFromData(out.data);
      } else if (frame.length === 8) {
        out.kind = 'request';
        out.startAddress = u16(frame, 2);
        out.quantity = u16(frame, 4);
      } else {
        out.kind = 'response';
        out.byteCount = frame[2];
        out.data = frame.subarray(3, 3 + out.byteCount);
        out.bits = bitsFromData(out.data);
      }
      break;
    }
    case 3: case 4:
      if (frame.length === 8) {
        out.kind = 'request'; out.startAddress = u16(frame, 2); out.quantity = u16(frame, 4);
      } else {
        out.kind = 'response'; out.byteCount = frame[2]; out.data = frame.subarray(3, 3 + out.byteCount);
        out.words = wordsFromData(out.data);
      }
      break;
    case 5: case 6:
      out.kind = 'ambiguous'; out.address = u16(frame, 2); out.value = u16(frame, 4); out.matchToken = `${out.address}:${out.value}`;
      break;
    case 7:
      if (frame.length === 4) out.kind = 'request';
      else { out.kind = 'response'; out.status = frame[2]; }
      break;
    case 8:
      out.kind = 'ambiguous'; out.subFunction = u16(frame, 2); out.dataWord = u16(frame, 4); out.matchToken = `${out.subFunction}:${out.dataWord}`;
      break;
    case 11:
      if (frame.length === 4) out.kind = 'request';
      else { out.kind = 'response'; out.status = u16(frame, 2); out.eventCount = u16(frame, 4); }
      break;
    case 12: case 17:
      if (frame.length === 4) out.kind = 'request';
      else { out.kind = 'response'; out.byteCount = frame[2]; out.data = frame.subarray(3, 3 + out.byteCount); }
      break;
    case 15: case 16:
      if (frame.length === 8) {
        out.kind = 'response'; out.startAddress = u16(frame, 2); out.quantity = u16(frame, 4);
      } else {
        out.kind = 'request'; out.startAddress = u16(frame, 2); out.quantity = u16(frame, 4); out.byteCount = frame[6];
        out.data = frame.subarray(7, 7 + out.byteCount); if (fc === 16) out.words = wordsFromData(out.data);
      }
      break;
    case 22:
      out.kind = 'ambiguous'; out.address = u16(frame, 2); out.andMask = u16(frame, 4); out.orMask = u16(frame, 6);
      out.matchToken = `${out.address}:${out.andMask}:${out.orMask}`;
      break;
    case 23:
      if (frame.length >= 13 && frame[10] + 13 === frame.length) {
        out.kind = 'request'; out.readStartAddress = u16(frame, 2); out.readQuantity = u16(frame, 4);
        out.writeStartAddress = u16(frame, 6); out.writeQuantity = u16(frame, 8); out.byteCount = frame[10];
        out.data = frame.subarray(11, 11 + out.byteCount); out.words = wordsFromData(out.data);
      } else {
        out.kind = 'response'; out.byteCount = frame[2]; out.data = frame.subarray(3, 3 + out.byteCount); out.words = wordsFromData(out.data);
      }
      break;
    default:
      out.kind = 'unknown'; out.payload = frame.subarray(2, -2);
  }

  return out;
}

module.exports = { decodeFrame, FC_NAMES, EXCEPTION_NAMES };
