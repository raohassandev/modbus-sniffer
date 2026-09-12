'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');

function jsonSafe(value) {
  return JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2);
}

function safeName(value) {
  const s = String(value || 'modbus-project').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'modbus-project').slice(0, 80);
}

function csvEscape(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows, columns) {
  const out = [columns.map(c => csvEscape(c.label)).join(',')];
  for (const row of rows) out.push(columns.map(c => csvEscape(c.value(row))).join(','));
  return out.join('\r\n');
}

function collectExportModel({ project, state, diagnostics, mappings = [], history = [], workspaceBackup = null }) {
  const status = state.getStatus();
  const analysis = state.getAnalysis();
  const devices = state.getDevices();
  const polls = state.getPollGroups();
  const registers = state.getRegisters({ limit: 50000 });
  const transactions = state.getTransactions({ limit: 100000 });
  const timeouts = transactions.filter(x => x.direction === 'TIMEOUT');
  const exceptions = transactions.filter(x => x.exception || x.exceptionCode != null);
  const capture = state.exportCapture();
  capture.project = project;

  const summary = [
    ['Project', project?.name || 'Default'],
    ['Site', project?.site || ''],
    ['Bus', project?.bus || ''],
    ['Generated', new Date().toISOString()],
    ['Health score', analysis?.healthScore ?? ''],
    ['Frames', status?.totals?.frames ?? 0],
    ['Devices', devices.length],
    ['Registers', registers.length],
    ['Polling groups', polls.length],
    ['Requests', status?.totals?.requests ?? 0],
    ['Responses', status?.totals?.responses ?? 0],
    ['Timeouts', status?.totals?.timeouts ?? timeouts.length],
    ['Exceptions', status?.totals?.exceptions ?? exceptions.length],
    ['Noise bytes', status?.totals?.noiseBytes ?? 0],
    ['Average RTT ms', status?.totals?.avgRttMs ?? ''],
    ['P95 RTT ms', status?.totals?.p95RttMs ?? ''],
    ['Timeout rate %', analysis?.rates?.timeoutRate ?? ''],
    ['Unmatched response rate %', analysis?.rates?.unmatchedResponseRate ?? ''],
    ['Estimated RTU utilization %', diagnostics?.utilizationPct ?? '']
  ];

  return { project, status, analysis, diagnostics, devices, polls, registers, mappings, transactions, timeouts, exceptions, history, capture, workspaceBackup, summary };
}

function sheetColumns(name) {
  const defs = {
    Devices: [
      ['Slave','slaveId'],['Name','deviceName'],['Status','status'],['Health','healthScore'],['Requests','requests'],['Responses','responses'],['Timeouts','timeouts'],['Exceptions','exceptions'],['Registers','registerCount'],['Poll Groups','pollGroupCount'],['Avg RTT ms','avgRttMs'],['P95 RTT ms','p95RttMs'],['Last Seen','lastSeen']
    ],
    'Polling Groups': [
      ['Slave','slaveId'],['FC','functionCode'],['Operation','operation'],['Start','startAddress'],['End','endAddress'],['Quantity','quantity'],['Requests','requests'],['Responses','responses'],['Timeouts','timeouts'],['Exceptions','exceptions'],['Median Interval ms','medianIntervalMs'],['P95 Interval ms','p95IntervalMs'],['Jitter %','jitterPct'],['Avg RTT ms','avgRttMs'],['P95 RTT ms','p95RttMs']
    ],
    Registers: [
      ['Slave','slaveId'],['FC','functionCode'],['Address','address'],['Last Value','lastValue'],['HEX','lastHex'],['Min','min'],['Max','max'],['Reads','reads'],['Writes','writes'],['Changes','changes'],['Poll Interval ms','pollIntervalMs'],['Last Seen','lastSeen']
    ],
    'Engineering Values': [
      ['Slave','slaveId'],['FC','functionCode'],['Address','address'],['Name','name'],['Type','type'],['Byte Order','byteOrder'],['Scale','scale'],['Offset','offset'],['Unit','unit'],['Raw Words','rawWordsText'],['Engineering Value','engineeringValue'],['Available','available'],['Notes','notes']
    ],
    Timeouts: [
      ['Timestamp','timestampIso'],['Transport','transport'],['Slave','slaveId'],['FC','functionCode'],['Address','address'],['Quantity','quantity'],['Timeout ms','timeoutMs'],['Details','details']
    ],
    Exceptions: [
      ['Timestamp','timestampIso'],['Transport','transport'],['Slave','slaveId'],['FC','functionCode'],['Code','exceptionCode'],['Exception','exceptionName'],['RTT ms','rttMs'],['Raw HEX','rawHex']
    ],
    Traffic: [
      ['ID','id'],['Timestamp','timestampIso'],['Transport','transport'],['Direction','direction'],['Slave','slaveId'],['FC','functionCode'],['Function','functionName'],['RTT ms','rttMs'],['Timeout ms','timeoutMs'],['Exception','exceptionName'],['Raw HEX','rawHex']
    ],
    'Project History': [
      ['Timestamp','timestampIso'],['Health','healthScore'],['Frames','frames'],['Devices','devices'],['Timeouts','timeouts'],['Timeout Rate %','timeoutRate'],['Avg RTT ms','avgRttMs'],['Connection','connection']
    ]
  };
  return defs[name];
}

function normalizeRows(model, sheet) {
  const named = model.project?.devices || {};
  if (sheet === 'Devices') return model.devices.map(x => ({ ...x, deviceName: named[String(x.slaveId)]?.name || `Slave ${x.slaveId}` }));
  if (sheet === 'Polling Groups') return model.polls;
  if (sheet === 'Registers') return model.registers;
  if (sheet === 'Engineering Values') return model.mappings.map(x => ({ ...x, rawWordsText: Array.isArray(x.rawWords) ? x.rawWords.join(' ') : '' }));
  if (sheet === 'Timeouts') return model.timeouts.map(x => ({ ...x, timestampIso: x.timestamp ? new Date(x.timestamp).toISOString() : '', address: x.request?.startAddress ?? x.request?.address ?? x.decoded?.startAddress ?? x.decoded?.address ?? '', quantity: x.request?.quantity ?? x.decoded?.quantity ?? '', details: x.functionName || '' }));
  if (sheet === 'Exceptions') return model.exceptions.map(x => ({ ...x, timestampIso: x.timestamp ? new Date(x.timestamp).toISOString() : '' }));
  if (sheet === 'Traffic') return model.transactions.map(x => ({ ...x, timestampIso: x.timestamp ? new Date(x.timestamp).toISOString() : '' }));
  if (sheet === 'Project History') return model.history.map(x => ({ timestampIso: x.recordedAt ? new Date(x.recordedAt).toISOString() : '', healthScore: x.healthScore, frames: x.totals?.frames, devices: x.totals?.devices ?? x.devices?.length, timeouts: x.totals?.timeouts, timeoutRate: x.rates?.timeoutRate, avgRttMs: x.totals?.avgRttMs, connection: x.connection?.status }));
  return [];
}

function excelValue(v) {
  if (v == null) return '';
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) return JSON.stringify(v);
  return v;
}

function applySheetStyle(ws) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, ws.columnCount) } };
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  for (const col of ws.columns) {
    let width = 12;
    col.eachCell({ includeEmpty: false }, cell => { width = Math.max(width, Math.min(45, String(cell.value ?? '').length + 2)); });
    col.width = width;
  }
}

async function buildWorkbook(model) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Modbus Engineering Analyzer';
  wb.created = new Date();
  wb.subject = `${model.project?.name || 'Modbus'} engineering results`;
  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ header: 'Metric', key: 'metric', width: 32 }, { header: 'Value', key: 'value', width: 32 }];
  for (const [metric, value] of model.summary) summary.addRow({ metric, value:excelValue(value) });
  applySheetStyle(summary);
  summary.getColumn(1).font = { bold: true };

  for (const name of ['Devices','Polling Groups','Registers','Engineering Values','Timeouts','Exceptions','Traffic','Project History']) {
    const defs = sheetColumns(name); const ws = wb.addWorksheet(name);
    ws.columns = defs.map(([header,key]) => ({ header, key }));
    for (const source of normalizeRows(model, name)) {
      const row={}; for(const [,key] of defs) row[key]=excelValue(source[key]); ws.addRow(row);
    }
    applySheetStyle(ws);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addPdfTable(doc, title, columns, rows, maxRows = 120) {
  doc.moveDown(0.7).font('Helvetica-Bold').fontSize(13).text(title).moveDown(0.35);
  const shown = rows.slice(0, maxRows);
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = columns.map(c => (c.width || 1) * pageWidth / columns.reduce((a,b)=>a+(b.width||1),0));
  const drawHeader = () => {
    let x = doc.page.margins.left;
    doc.font('Helvetica-Bold').fontSize(7.5);
    columns.forEach((c,i) => { doc.text(c.label, x, doc.y, { width: widths[i], continued: false }); x += widths[i]; });
    doc.moveDown(1.25).font('Helvetica').fontSize(7.2);
  };
  drawHeader();
  for (const row of shown) {
    if (doc.y > doc.page.height - 55) { doc.addPage(); drawHeader(); }
    const y = doc.y; let x = doc.page.margins.left; let h = 0;
    columns.forEach((c,i) => { const text = String(c.value(row) ?? ''); h = Math.max(h, doc.heightOfString(text, { width: widths[i] - 3 })); doc.text(text, x, y, { width: widths[i] - 3 }); x += widths[i]; });
    doc.y = y + Math.max(11, h + 3);
  }
  if (rows.length > shown.length) doc.font('Helvetica-Oblique').fontSize(8).text(`Table truncated in PDF: ${shown.length} of ${rows.length} rows shown. Full data is included in the Excel/ZIP exports.`);
}

function buildPdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: 'Modbus Engineering Diagnostic Report', Author: 'Modbus Engineering Analyzer' } });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(20).text('Modbus Engineering Diagnostic Report');
    doc.font('Helvetica').fontSize(9).fillColor('#444444').text(`Project: ${model.project?.name || 'Default'}   Site: ${model.project?.site || '—'}   Bus: ${model.project?.bus || '—'}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`).fillColor('#000000').moveDown();
    const summaryObj = Object.fromEntries(model.summary);
    doc.font('Helvetica-Bold').fontSize(11).text(`Health ${summaryObj['Health score']}/100    Devices ${summaryObj.Devices}    Frames ${summaryObj.Frames}    Timeouts ${summaryObj.Timeouts}    Exceptions ${summaryObj.Exceptions}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(13).text('Diagnostic findings').moveDown(0.3);
    for (const f of model.diagnostics?.findings || []) doc.font('Helvetica-Bold').fontSize(9).text(`${String(f.severity || '').toUpperCase()} — ${f.title}`).font('Helvetica').fontSize(8.5).text(f.detail).moveDown(0.3);
    addPdfTable(doc, 'Devices', [
      {label:'Slave',width:0.6,value:r=>r.slaveId},{label:'Name',width:1.5,value:r=>(model.project?.devices?.[String(r.slaveId)]?.name||`Slave ${r.slaveId}`)},{label:'Status',width:0.9,value:r=>r.status},{label:'Regs',width:0.7,value:r=>r.registerCount},{label:'Polls',width:0.7,value:r=>r.pollGroupCount},{label:'TO',width:0.6,value:r=>r.timeouts},{label:'Avg RTT',width:0.9,value:r=>r.avgRttMs},{label:'P95 RTT',width:0.9,value:r=>r.p95RttMs}
    ], model.devices, 100);
    addPdfTable(doc, 'Polling groups', [
      {label:'Slave',width:0.6,value:r=>r.slaveId},{label:'FC',width:0.5,value:r=>r.functionCode},{label:'Range',width:1.1,value:r=>`${r.startAddress??'—'}…${r.endAddress??'—'}`},{label:'REQ',width:0.7,value:r=>r.requests},{label:'RSP',width:0.7,value:r=>r.responses},{label:'TO',width:0.6,value:r=>r.timeouts},{label:'Median ms',width:0.9,value:r=>r.medianIntervalMs},{label:'Jitter %',width:0.8,value:r=>r.jitterPct},{label:'RTT ms',width:0.8,value:r=>r.avgRttMs}
    ], model.polls, 140);
    addPdfTable(doc, 'Engineering values', [
      {label:'Slave',width:0.5,value:r=>r.slaveId},{label:'FC',width:0.4,value:r=>r.functionCode},{label:'Address',width:0.8,value:r=>r.address},{label:'Name',width:1.6,value:r=>r.name},{label:'Type',width:0.8,value:r=>r.type},{label:'Order',width:0.8,value:r=>r.byteOrder},{label:'Value',width:1,value:r=>Array.isArray(r.engineeringValue)?JSON.stringify(r.engineeringValue):r.engineeringValue},{label:'Unit',width:0.6,value:r=>r.unit}
    ], model.mappings, 160);
    doc.end();
  });
}

const columns = {
  devices: [{label:'slave',value:x=>x.slaveId},{label:'name',value:x=>x.deviceName},{label:'status',value:x=>x.status},{label:'healthScore',value:x=>x.healthScore},{label:'requests',value:x=>x.requests},{label:'responses',value:x=>x.responses},{label:'timeouts',value:x=>x.timeouts},{label:'registerCount',value:x=>x.registerCount},{label:'pollGroupCount',value:x=>x.pollGroupCount},{label:'avgRttMs',value:x=>x.avgRttMs},{label:'p95RttMs',value:x=>x.p95RttMs}],
  polls: [{label:'slave',value:x=>x.slaveId},{label:'function',value:x=>x.functionCode},{label:'operation',value:x=>x.operation},{label:'startAddress',value:x=>x.startAddress},{label:'quantity',value:x=>x.quantity},{label:'requests',value:x=>x.requests},{label:'responses',value:x=>x.responses},{label:'timeouts',value:x=>x.timeouts},{label:'medianIntervalMs',value:x=>x.medianIntervalMs},{label:'jitterPct',value:x=>x.jitterPct},{label:'avgRttMs',value:x=>x.avgRttMs}],
  registers: [{label:'slave',value:x=>x.slaveId},{label:'function',value:x=>x.functionCode},{label:'address',value:x=>x.address},{label:'lastValue',value:x=>x.lastValue},{label:'lastHex',value:x=>x.lastHex},{label:'min',value:x=>x.min},{label:'max',value:x=>x.max},{label:'reads',value:x=>x.reads},{label:'writes',value:x=>x.writes},{label:'changes',value:x=>x.changes},{label:'pollIntervalMs',value:x=>x.pollIntervalMs}],
  engineering: [{label:'slave',value:x=>x.slaveId},{label:'function',value:x=>x.functionCode},{label:'address',value:x=>x.address},{label:'name',value:x=>x.name},{label:'type',value:x=>x.type},{label:'byteOrder',value:x=>x.byteOrder},{label:'scale',value:x=>x.scale},{label:'offset',value:x=>x.offset},{label:'unit',value:x=>x.unit},{label:'engineeringValue',value:x=>x.engineeringValue},{label:'available',value:x=>x.available}],
  traffic: [{label:'id',value:x=>x.id},{label:'timestamp',value:x=>x.timestamp?new Date(x.timestamp).toISOString():''},{label:'transport',value:x=>x.transport||'RTU'},{label:'direction',value:x=>x.direction},{label:'slave',value:x=>x.slaveId},{label:'function',value:x=>x.functionCode},{label:'functionName',value:x=>x.functionName},{label:'rttMs',value:x=>x.rttMs},{label:'timeoutMs',value:x=>x.timeoutMs},{label:'exception',value:x=>x.exceptionName||''},{label:'rawHex',value:x=>x.rawHex}]
};

async function streamProjectZip(res, model, reportHtml) {
  const xlsx = await buildWorkbook(model); const pdf = await buildPdf(model);
  const projectName = safeName(model.project?.name); const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${projectName}-${stamp}-results.zip"`);
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', err => res.destroy(err)); zip.pipe(res);
  zip.append(xlsx, { name: 'results/modbus-results.xlsx' });
  zip.append(pdf, { name: 'results/modbus-report.pdf' });
  zip.append(reportHtml, { name: 'results/modbus-report.html' });
  zip.append(jsonSafe(model.diagnostics), { name: 'results/diagnostics.json' });
  zip.append(jsonSafe(model.capture), { name: 'capture/current.mbcap' });
  zip.append(jsonSafe(model.project), { name: 'project/project.json' });
  zip.append(jsonSafe(model.workspaceBackup || {}), { name: 'project/all-workspaces-and-profiles.json' });
  zip.append(jsonSafe(model.history), { name: 'project/history.json' });
  zip.append(csv(normalizeRows(model,'Devices'), columns.devices), { name: 'csv/devices.csv' });
  zip.append(csv(model.polls, columns.polls), { name: 'csv/polling-groups.csv' });
  zip.append(csv(model.registers, columns.registers), { name: 'csv/registers.csv' });
  zip.append(csv(model.mappings, columns.engineering), { name: 'csv/engineering-values.csv' });
  zip.append(csv(model.transactions, columns.traffic), { name: 'csv/traffic.csv' });
  zip.append(jsonSafe({ format:'modbus-engineering-analyzer-export', version:1, generatedAt:new Date().toISOString(), project:model.project?.name, files:['results/modbus-results.xlsx','results/modbus-report.pdf','results/modbus-report.html','results/diagnostics.json','capture/current.mbcap','project/project.json','project/all-workspaces-and-profiles.json','project/history.json','csv/devices.csv','csv/polling-groups.csv','csv/registers.csv','csv/engineering-values.csv','csv/traffic.csv'] }), { name: 'manifest.json' });
  await zip.finalize();
}

module.exports = { collectExportModel, buildWorkbook, buildPdf, streamProjectZip, safeName, csv, normalizeRows };
