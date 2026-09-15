'use strict';

const { toBuffer } = require('./model');

function lrc8(bytes) {
  const buf = toBuffer(bytes, 'bytes');
  let sum = 0;
  for (const byte of buf) sum = (sum + byte) & 0xFF;
  return ((-sum) & 0xFF) >>> 0;
}

function appendLrc(bytes) {
  const buf = toBuffer(bytes, 'bytes');
  return Buffer.concat([buf, Buffer.from([lrc8(buf)])]);
}

function hasValidLrc(frame) {
  const buf = toBuffer(frame, 'frame');
  if (buf.length < 2) return false;
  return lrc8(buf.subarray(0, -1)) === buf[buf.length - 1];
}

module.exports = {
  lrc8,
  appendLrc,
  hasValidLrc,
};
