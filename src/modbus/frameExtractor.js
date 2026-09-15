'use strict';

const { EventEmitter } = require('events');
const { hasValidCrc } = require('./crc16');

class FrameExtractor extends EventEmitter {
  constructor({ baudRate = 9600, dataBits = 8, parity = 'none', stopBits = 1 } = {}) {
    super();
    this.buffer = Buffer.alloc(0);
    this.timer = null;
    this.maxBuffer = 8192;
    const parityBits = parity === 'none' ? 0 : 1;
    const bitsPerChar = 1 + dataBits + parityBits + stopBits;
    this.charTimeMs = (bitsPerChar * 1000) / baudRate;
    // JavaScript timers cannot reliably schedule the sub-millisecond 3.5-char gap used
    // at high baud rates. Keep the exact calculated value for diagnostics while using
    // the smallest practical host timer for framing fallback.
    this.protocolGapMs = this.charTimeMs * 3.5;
    this.gapMs = Math.max(1, Math.ceil(this.protocolGapMs));
  }

  push(chunk, timestamp = Date.now()) {
    if (!chunk || chunk.length === 0) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxBuffer) {
      this.emit('noise', this.buffer.subarray(0, this.buffer.length - this.maxBuffer));
      this.buffer = this.buffer.subarray(-this.maxBuffer);
    }
    this._extract(false, timestamp);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._extract(true, Date.now()), this.gapMs);
  }

  flush() {
    clearTimeout(this.timer);
    this._extract(true, Date.now());
  }

  _fc43ResponseLength(buf){
    if(buf.length<8||buf[2]!==0x0E)return null;
    const count=buf[7];
    let pos=8;
    for(let i=0;i<count;i++){
      if(pos+2>buf.length)return null;
      const len=buf[pos+1];pos+=2;
      if(pos+len>buf.length)return null;
      pos+=len;
    }
    return pos+2;
  }

  _candidateLengths(buf) {
    if (buf.length < 2) return [];
    const fc = buf[1];
    const lengths = new Set();
    if (fc & 0x80) { lengths.add(5); return [...lengths]; }

    switch (fc) {
      case 1: case 2: case 3: case 4:
        lengths.add(8);
        if (buf.length >= 3) {
          const byteCount = buf[2];
          if (byteCount <= 250 && (fc <= 2 || byteCount % 2 === 0)) lengths.add(5 + byteCount);
        }
        break;
      case 5: case 6: lengths.add(8); break;
      case 7: lengths.add(4); lengths.add(5); break;
      case 8:
        lengths.add(8);
        // Most diagnostics are 8-byte RTU frames, but Return Query Data and vendor
        // diagnostic subfunctions may carry additional data. Wait until the observed
        // silent gap instead of discarding a valid longer FC08 frame as noise.
        if(buf.length>=8&&buf.length<256)lengths.add(buf.length+1);
        break;
      case 11: lengths.add(4); lengths.add(8); break;
      case 12: case 17:
        lengths.add(4); if (buf.length >= 3 && buf[2] <= 250) lengths.add(5 + buf[2]); break;
      case 15: case 16:
        lengths.add(8); if (buf.length >= 7 && buf[6] <= 246) lengths.add(9 + buf[6]); break;
      case 20: case 21:
        if(buf.length>=3&&buf[2]>=3&&buf[2]<=251)lengths.add(5+buf[2]);
        break;
      case 22: lengths.add(10); break;
      case 23:
        if (buf.length >= 3 && buf[2] <= 250) lengths.add(5 + buf[2]);
        if (buf.length >= 11 && buf[10] <= 242) lengths.add(13 + buf[10]);
        break;
      case 24:
        lengths.add(6); // request: FIFO pointer address
        if(buf.length>=4){
          const byteCount=buf.readUInt16BE(2);
          if(byteCount>=2&&byteCount<=64&&byteCount%2===0)lengths.add(6+byteCount);
        }
        break;
      case 43: {
        if(buf.length>=3&&buf[2]===0x0E){
          lengths.add(7); // request length
          const responseLength=this._fc43ResponseLength(buf);
          if(responseLength&&responseLength<=256)lengths.add(responseLength);
          else if(buf.length>=8&&buf.length<256)lengths.add(buf.length+1);
        }
        break;
      }
      default: break;
    }
    return [...lengths].sort((a, b) => a - b);
  }

  _findCrcLength(buf) {
    const max = Math.min(buf.length, 256);
    for (let len = 4; len <= max; len++) if (hasValidCrc(buf.subarray(0, len))) return len;
    return null;
  }

  _extract(final, timestamp) {
    while (this.buffer.length >= 4) {
      const lengths = this._candidateLengths(this.buffer);
      let matchedLength = null;
      for (const len of lengths) {
        if (len <= this.buffer.length && hasValidCrc(this.buffer.subarray(0, len))) { matchedLength = len; break; }
      }
      if (!matchedLength && (final || lengths.length === 0)) matchedLength = this._findCrcLength(this.buffer);
      if (matchedLength) {
        const frame = this.buffer.subarray(0, matchedLength);
        this.buffer = this.buffer.subarray(matchedLength);
        this.emit('frame', Buffer.from(frame), timestamp);
        continue;
      }
      const waitingForLonger = lengths.some(len => len > this.buffer.length);
      if (!final && waitingForLonger) break;
      this.emit('noise', this.buffer.subarray(0, 1));
      this.buffer = this.buffer.subarray(1);
    }
    if (final && this.buffer.length > 0) {
      this.emit('noise', this.buffer);
      this.buffer = Buffer.alloc(0);
    }
  }
}

module.exports = { FrameExtractor };
