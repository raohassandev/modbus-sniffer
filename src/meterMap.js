'use strict';

const fs = require('fs');

function wordsToBuffer(words) {
  const b = Buffer.alloc(words.length * 2);
  words.forEach((w, i) => b.writeUInt16BE(w & 0xFFFF, i * 2));
  return b;
}

function reorder(buf, order) {
  const text = String(order || '').toUpperCase();
  if (buf.length === 4) {
    const map = {
      ABCD: [0, 1, 2, 3],
      BADC: [1, 0, 3, 2],
      CDAB: [2, 3, 0, 1],
      DCBA: [3, 2, 1, 0]
    };
    const idx = map[text || 'ABCD'] || map.ABCD;
    return Buffer.from(idx.map(i => buf[i]));
  }

  if (buf.length === 8) {
    const map = {
      ABCDEFGH: [0, 1, 2, 3, 4, 5, 6, 7],
      BADCFEHG: [1, 0, 3, 2, 5, 4, 7, 6],
      GHEFCDAB: [6, 7, 4, 5, 2, 3, 0, 1],
      HGFEDCBA: [7, 6, 5, 4, 3, 2, 1, 0]
    };
    const idx = map[text || 'ABCDEFGH'] || map.ABCDEFGH;
    return Buffer.from(idx.map(i => buf[i]));
  }

  return buf;
}

function decodeMapped(words, type, byteOrder) {
  type = (type || 'uint16').toLowerCase();
  if (type === 'uint16') return words[0];
  if (type === 'int16') return words[0] & 0x8000 ? words[0] - 0x10000 : words[0];

  if (['uint32', 'int32', 'float32'].includes(type)) {
    if (words.length < 2) return null;
    const b = reorder(wordsToBuffer(words.slice(0, 2)), byteOrder || 'ABCD');
    if (type === 'uint32') return b.readUInt32BE(0);
    if (type === 'int32') return b.readInt32BE(0);
    return b.readFloatBE(0);
  }

  if (type === 'uint64' || type === 'int64') {
    if (words.length < 4) return null;
    const b = reorder(wordsToBuffer(words.slice(0, 4)), byteOrder || 'ABCDEFGH');
    return type === 'uint64' ? b.readBigUInt64BE(0) : b.readBigInt64BE(0);
  }

  return null;
}

class MeterMap {
  constructor(meters = []) { this.meters = meters; }

  static fromFile(path) {
    if (!path) return new MeterMap([]);
    const json = JSON.parse(fs.readFileSync(path, 'utf8'));
    return new MeterMap(Array.isArray(json) ? json : (json.meters || []));
  }

  resolve(transaction) {
    const d = transaction.decoded;
    const req = transaction.request;
    if (transaction.direction !== 'RSP' || !req || !Array.isArray(d.words)) return [];

    const baseAddress = d.functionCode === 23 ? req.readStartAddress : req.startAddress;
    if (baseAddress === undefined) return [];

    const out = [];
    for (const m of this.meters) {
      if (Number(m.slaveId) !== d.slaveId) continue;
      if (m.function && Number(m.function) !== d.functionCode) continue;
      const offset = Number(m.address) - baseAddress;
      if (offset < 0 || offset >= d.words.length) continue;

      const t = String(m.type || 'uint16').toLowerCase();
      const width = ['uint32', 'int32', 'float32'].includes(t) ? 2 : ['uint64', 'int64'].includes(t) ? 4 : 1;
      if (offset + width > d.words.length) continue;

      const raw = decodeMapped(d.words.slice(offset, offset + width), t, m.byteOrder);
      if (raw === null) continue;

      let value = raw;
      const scale = m.scale === undefined ? 1 : Number(m.scale);
      const add = m.offset === undefined ? 0 : Number(m.offset);
      if (typeof raw === 'bigint') {
        value = (scale === 1 && add === 0) ? raw.toString() : Number(raw) * scale + add;
      } else {
        value = raw * scale + add;
      }

      out.push({ ...m, raw, value });
    }
    return out;
  }
}

module.exports = { MeterMap, decodeMapped, reorder };
