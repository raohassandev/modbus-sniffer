'use strict';

function crc16Modbus(buf, start = 0, end = buf.length) {
  let crc = 0xFFFF;
  for (let i = start; i < end; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xA001;
      else crc >>>= 1;
    }
  }
  return crc & 0xFFFF;
}

function hasValidCrc(frame) {
  if (!frame || frame.length < 4) return false;
  const calculated = crc16Modbus(frame, 0, frame.length - 2);
  const received = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
  return calculated === received;
}

function appendCrc(payload) {
  const crc = crc16Modbus(payload);
  return Buffer.concat([Buffer.from(payload), Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF])]);
}

module.exports = { crc16Modbus, hasValidCrc, appendCrc };
