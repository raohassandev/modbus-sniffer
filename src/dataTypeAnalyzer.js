'use strict';

function clampWords(words, count) {
  return (Array.isArray(words) ? words : []).slice(0, count).map(v => Number(v) & 0xFFFF);
}

function wordsToBytes(words) {
  const out = [];
  for (const word of words) {
    out.push((word >> 8) & 0xFF, word & 0xFF);
  }
  return out;
}

const ORDER_32 = {
  ABCD: [0, 1, 2, 3],
  BADC: [1, 0, 3, 2],
  CDAB: [2, 3, 0, 1],
  DCBA: [3, 2, 1, 0]
};

const ORDER_64 = {
  ABCDEFGH: [0, 1, 2, 3, 4, 5, 6, 7],
  BADCFEHG: [1, 0, 3, 2, 5, 4, 7, 6],
  CDABGHEF: [2, 3, 0, 1, 6, 7, 4, 5],
  EFGHABCD: [4, 5, 6, 7, 0, 1, 2, 3],
  GHEFCDAB: [6, 7, 4, 5, 2, 3, 0, 1],
  HGFEDCBA: [7, 6, 5, 4, 3, 2, 1, 0]
};

function reorder(bytes, map) {
  return Buffer.from(map.map(i => bytes[i]));
}

function safeNumber(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function scoreNumeric(type, value) {
  if (typeof value === 'bigint') return 45;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const a = Math.abs(value);
  let score = 50;
  if (type.includes('float') || type.includes('double')) {
    if (a === 0) score += 8;
    else if (a >= 1e-6 && a <= 1e9) score += 28;
    else if (a < 1e-20 || a > 1e20) score -= 35;
    if (Number.isInteger(value)) score -= 4;
  } else {
    if (a <= 1e9) score += 18;
    if (a <= 65535) score += 8;
  }
  return Math.max(0, Math.min(100, score));
}

function scaledSuggestions(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return [];
  const factors = [1, 0.1, 0.01, 0.001, 0.0001, 10, 100];
  return factors.map(scale => ({ scale, value: value * scale }));
}

function decode16(words) {
  if (!words.length) return [];
  const w = words[0];
  const signed = w & 0x8000 ? w - 0x10000 : w;
  return [
    { type: 'uint16', order: 'AB', value: w, score: scoreNumeric('uint16', w), scales: scaledSuggestions(w) },
    { type: 'int16', order: 'AB', value: signed, score: scoreNumeric('int16', signed), scales: scaledSuggestions(signed) }
  ];
}

function decode32(words) {
  const w = clampWords(words, 2);
  if (w.length < 2) return [];
  const bytes = wordsToBytes(w);
  const out = [];
  for (const [order, map] of Object.entries(ORDER_32)) {
    const b = reorder(bytes, map);
    const u = b.readUInt32BE(0);
    const i = b.readInt32BE(0);
    const f = b.readFloatBE(0);
    out.push(
      { type: 'uint32', order, value: u, score: scoreNumeric('uint32', u), scales: scaledSuggestions(u) },
      { type: 'int32', order, value: i, score: scoreNumeric('int32', i), scales: scaledSuggestions(i) },
      { type: 'float32', order, value: safeNumber(f), score: scoreNumeric('float32', f), scales: scaledSuggestions(f) }
    );
  }
  return out;
}

function decode64(words) {
  const w = clampWords(words, 4);
  if (w.length < 4) return [];
  const bytes = wordsToBytes(w);
  const out = [];
  for (const [order, map] of Object.entries(ORDER_64)) {
    const b = reorder(bytes, map);
    const u = b.readBigUInt64BE(0);
    const i = b.readBigInt64BE(0);
    const d = b.readDoubleBE(0);
    out.push(
      { type: 'uint64', order, value: u.toString(), score: scoreNumeric('uint64', u), scales: [] },
      { type: 'int64', order, value: i.toString(), score: scoreNumeric('int64', i), scales: [] },
      { type: 'float64', order, value: safeNumber(d), score: scoreNumeric('double64', d), scales: scaledSuggestions(d) }
    );
  }
  return out;
}

function analyzeWords(words) {
  const normalized = clampWords(words, 4);
  const interpretations = [
    ...decode16(normalized),
    ...decode32(normalized),
    ...decode64(normalized)
  ].filter(x => x.value !== null);
  interpretations.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.order.localeCompare(b.order));
  return {
    words: normalized.map((value, index) => ({ index, value, hex: `0x${value.toString(16).toUpperCase().padStart(4, '0')}` })),
    interpretations
  };
}

module.exports = { analyzeWords, ORDER_32, ORDER_64 };
