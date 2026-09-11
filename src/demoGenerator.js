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

function startDemo({ onFrame, onNoise }) {
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    const slave = 1 + (tick % 3);
    const base = slave === 1 ? 32000 : slave === 2 ? 4000 : 1000;
    const qty = 4;
    const fc = tick % 5 === 0 ? 4 : 3;
    const request = reqRead(slave, fc, base + (tick % 6) * 4, qty);
    onFrame(request, Date.now());
    setTimeout(() => {
      if (tick % 29 === 0) onFrame(exception(slave, fc, 2), Date.now());
      else {
        const seed = 1000 + tick * 3 + slave * 100;
        onFrame(rspRead(slave, fc, [seed, seed + 4, (seed * 2) & 0xFFFF, 2300 + (tick % 25)]), Date.now());
      }
    }, 18 + (tick % 7) * 6);

    if (tick % 13 === 0) {
      const write = reqWrite(1, 5000, (tick * 7) % 101);
      onFrame(write, Date.now());
      setTimeout(() => onFrame(write, Date.now()), 25);
    }
    if (tick % 41 === 0) onNoise(2);
  }, 260);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { startDemo };
