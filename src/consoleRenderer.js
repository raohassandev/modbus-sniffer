'use strict';

function ts(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function hex(buf) {
  return [...buf].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function renderTransaction(tx, timestamp, raw, options = {}) {
  const d = tx.decoded;
  const r = tx.request;
  const parts = [`[${ts(timestamp)}]`, tx.direction, `S=${d.slaveId}`, `FC=${String(d.functionCode).padStart(2, '0')}`, d.functionName];

  if (d.exception) {
    parts.push(`EXCEPTION=${d.exceptionCode} (${d.exceptionName})`);
  } else if (tx.direction === 'REQ') {
    if (d.startAddress !== undefined) parts.push(`addr=${d.startAddress}`);
    if (d.quantity !== undefined) parts.push(`qty=${d.quantity}`);
    if (d.address !== undefined) parts.push(`addr=${d.address}`);
    if (d.value !== undefined) parts.push(`value=${d.value}`);
    if (d.readStartAddress !== undefined) parts.push(`read=${d.readStartAddress}+${d.readQuantity}`);
    if (d.writeStartAddress !== undefined) parts.push(`write=${d.writeStartAddress}+${d.writeQuantity}`);
    if (d.subFunction !== undefined) parts.push(`sub=${d.subFunction}`);
  } else if (tx.direction === 'RSP') {
    if (tx.rttMs !== null) parts.push(`RTT=${tx.rttMs}ms`);
    if (r?.startAddress !== undefined) parts.push(`addr=${r.startAddress}`);
    if (r?.readStartAddress !== undefined) parts.push(`addr=${r.readStartAddress}`);
    if (Array.isArray(d.registers)) {
      const preview = d.registers.slice(0, 12).map(x => `${x.address}=${x.value}(${x.hex})`).join(' ');
      parts.push(preview);
      if (d.registers.length > 12) parts.push(`... +${d.registers.length - 12} regs`);
    }
    if (d.status !== undefined) parts.push(`status=${d.status}`);
    if (d.eventCount !== undefined) parts.push(`events=${d.eventCount}`);
  }

  console.log(parts.join(' | '));
  if (options.raw) console.log(`  RAW: ${hex(raw)}`);
}

function renderMeters(meters) {
  for (const m of meters) {
    const val = typeof m.value === 'number' && Number.isFinite(m.value)
      ? Number(m.value.toFixed(m.decimals ?? 3))
      : m.value;
    console.log(`  METER: ${m.name} = ${val}${m.unit ? ' ' + m.unit : ''}  [S${m.slaveId} @${m.address} ${m.type || 'uint16'}]`);
  }
}

function renderPorts(ports) {
  if (!ports.length) {
    console.log('No serial ports found.');
    return;
  }
  console.log('Available serial ports:');
  ports.forEach((p, i) => {
    const meta = [
      p.manufacturer,
      p.productId && `PID:${p.productId}`,
      p.vendorId && `VID:${p.vendorId}`,
      p.serialNumber && `SN:${p.serialNumber}`
    ].filter(Boolean).join(' | ');
    console.log(`  [${i + 1}] ${p.path}${meta ? '  -  ' + meta : ''}`);
  });
}

module.exports = { renderTransaction, renderMeters, renderPorts, hex };
