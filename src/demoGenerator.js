'use strict';

const { appendCrc } = require('./modbus/crc16');

function reqRead(slave, fc, address, qty) {
  return appendCrc(Buffer.from([slave, fc, address >> 8, address & 0xFF, qty >> 8, qty & 0xFF]));
}

function rspRead(slave, fc, words) {
  const data = [];
  for (const w of words) data.push((w >> 8) & 0xFF, w & 0xFF);
  return appendCrc(Buffer.from([slave, fc, data.length, ...data]));
}

function reqWrite(slave, address, value) {
  return appendCrc(Buffer.from([slave, 6, address >> 8, address & 0xFF, value >> 8, value & 0xFF]));
}

function exception(slave, fc, code) {
  return appendCrc(Buffer.from([slave, fc | 0x80, code]));
}

/**
 * Produce a realistic multi-drop RTU bus for UI/testing without hardware.
 * Ten slave IDs are polled automatically. Each slave has three stable poll
 * groups so the v4 device/polling model has useful cadence and register data.
 */
function startDemo({ onFrame, onNoise }) {
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    const current = tick;
    const slave = 1 + ((current - 1) % 10);      // Slave 1..10
    const cycle = Math.floor((current - 1) / 10);
    const group = cycle % 3;
    const fc = group === 2 ? 4 : 3;
    const base = 1000 * slave + group * 20;
    const qty = group === 0 ? 4 : group === 1 ? 6 : 3;
    const request = reqRead(slave, fc, base, qty);
    const requestAt = Date.now();
    onFrame(request, requestAt);

    // Intentionally omit a small number of replies so timeout diagnostics
    // and per-device missing-response counters can be evaluated in demo mode.
    const omitReply = current % 97 === 0 || (slave === 7 && cycle > 0 && cycle % 43 === 0);
    if (!omitReply) {
      const delay = 18 + (slave % 4) * 7 + (current % 5) * 3;
      setTimeout(() => {
        if (current % 61 === 0) {
          onFrame(exception(slave, fc, 2), Date.now());
          return;
        }
        const seed = 500 + slave * 100 + cycle * 2 + group * 25;
        const words = Array.from({ length: qty }, (_, i) => (seed + i * 7 + (i === qty - 1 ? current % 20 : 0)) & 0xFFFF);
        onFrame(rspRead(slave, fc, words), Date.now());
      }, delay);
    }

    // Periodic write command to a few slaves, echoed as normal FC06 response.
    if (current % 37 === 0) {
      const writeSlave = 1 + ((current / 37 | 0) % 10);
      const write = reqWrite(writeSlave, 5000 + writeSlave, (current * 7) % 101);
      setTimeout(() => {
        onFrame(write, Date.now());
        setTimeout(() => onFrame(write, Date.now()), 24 + (writeSlave % 3) * 4);
      }, 55);
    }

    if (current % 83 === 0) onNoise(2);
  }, 100);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startDemo };
