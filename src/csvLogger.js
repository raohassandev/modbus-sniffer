'use strict';

const fs = require('fs');
const path = require('path');

function q(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

class CsvLogger {
  constructor(file) {
    this.file = file;
    if (!file) return;
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      fs.appendFileSync(file, 'timestamp,direction,slave,function,function_name,start_address,quantity,rtt_ms,exception,registers,raw_hex\n');
    }
  }

  write(tx, timestamp, raw) {
    if (!this.file) return;
    const d = tx.decoded;
    const r = tx.request;
    const startAddress = r?.startAddress ?? r?.readStartAddress ?? d.startAddress ?? d.address ?? '';
    const quantity = r?.quantity ?? r?.readQuantity ?? d.quantity ?? '';
    const registers = Array.isArray(d.registers)
      ? d.registers.map(x => `${x.address}=${x.value}`).join(';')
      : '';
    const row = [
      new Date(timestamp).toISOString(), tx.direction, d.slaveId, d.functionCode, d.functionName,
      startAddress, quantity, tx.rttMs ?? '', d.exceptionName ?? '', registers,
      raw.toString('hex').toUpperCase()
    ].map(q).join(',') + '\n';
    fs.appendFileSync(this.file, row);
  }
}

module.exports = { CsvLogger };
