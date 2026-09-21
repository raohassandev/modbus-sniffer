'use strict';

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');

function jsonSafe(value) {
  return JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2);
}

function safeName(value) {
  let s = String(value || 'modbus-project').normalize('NFKC').trim();
  s = s.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').replace(/-+/g, '-');
  if (!s) s = 'modbus-project';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) s = `_${s}`;
  return Array.from(s).slice(0, 80).join('');
}

function spreadsheetSafeText(value) {
  const s = String(value ?? '');
  return /^[\s]*[=+\-@]/.test(s) ? `'${s}` : s;
}

function csvEscape(v) {
  if (v == null) return '';
  const raw = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const s = spreadsheetSafeText(raw);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows, columns) {
  const out = [columns.map(c => csvEscape(c.label)).join(',')];
  for (const row of rows) out.push(columns.map(c => csvEscape(c.value(row))).join(','));
  return out.join('\r\n');
}

function channelMap(project) {
  return new Map(Object.values(project?.channels || {}).map(c => [c.channelId, c]));
}

function rowIdentity(row, project) {
  const channels = channelMap(project), channel = channels.get(row?.channelId) || null;
  const transport = String(row?.transport || channel?.transport || '').toUpperCase() || 'RTU';
  const unitId = row?.unitId ?? row?.slaveId ?? '';
  return {
    transport,
    channelId: row?.channelId || channel?.channelId || '',
    endpoint: row?.endpoint || channel?.endpoint || channel?.serial?.port || '',
    deviceKey: row?.deviceKey || '',
    unitId,
    idLabel: transport === 'TCP' ? 'Unit' : 'Slave'
  };
}

function namedDevice(model, row) {
  const key = row?.deviceKey;
  if (key && model.project?.devices?.[key]) return model.project.devices[key];
  const uid = row?.unitId ?? row?.slaveId;
  const matches = Object.values(model.project?.devices || {}).filter(d => Number(d.unitId ?? d.slaveId) === Number(uid));
  return matches.length === 1 ? matches[0] : null;
}

function discoveryTarget(run) {
  if (String(run?.transport).toUpperCase() === 'TCP') return `${run?.target?.host || ''}${run?.target?.port ? `:${run.target.port}` : ''}`;
  return run?.target?.port || run?.target?.serial?.port || '';
}

function flattenDiscovery(project) {
  const rows = [];
  for (const run of project?.discoveryRuns || []) {
    const adoptions = Array.isArray(run.adoptions) ? run.adoptions : [];
    for (const result of run.results || []) {
      const i = result.identification || {};
      const adoption = adoptions.find(a => Number(a.unitId) === Number(result.unitId)) || null;
      rows.push({
        runId: run.id,
        jobId: run.jobId || '',
        savedAt: run.savedAt || '',
        completedAt: run.completedAt || '',
        transport: String(run.transport || '').toUpperCase(),
        target: discoveryTarget(run),
        unitId: result.unitId,
        responded: Boolean(result.responded),
        identificationSupported: result.identificationSupported === true ? 'yes' : result.identificationSupported === false ? 'no' : 'unknown',
        vendorName: i.vendorName || '',
        productCode: i.productCode || '',
        productName: i.productName || '',
        modelName: i.modelName || '',
        revision: i.revision || '',
        vendorUrl: i.vendorUrl || '',
        userApplicationName: i.userApplicationName || '',
        avgRttMs: result.avgRttMs ?? '',
        objectCount: Array.isArray(result.objects) ? result.objects.length : 0,
        adopted: Boolean(adoption),
        adoptedDeviceKey: adoption?.deviceKey || '',
        adoptedChannelId: adoption?.channelId || '',
        adoptedAt: adoption?.adoptedAt || '',
        overwriteExisting: adoption ? Boolean(adoption.overwriteExisting) : false,
        overwrittenFields: Array.isArray(adoption?.overwrittenFields) ? adoption.overwrittenFields.join(', ') : ''
      });
    }
  }
  return rows;
}

function flattenAdoptions(project) {
  const rows = [];
  for (const run of project?.discoveryRuns || []) {
    for (const adoption of run.adoptions || []) {
      const device = project?.devices?.[adoption.deviceKey] || {};
      const id = device.identification || {};
      rows.push({
        runId: run.id,
        jobId: run.jobId || '',
        transport: String(run.transport || '').toUpperCase(),
        target: discoveryTarget(run),
        channelId: adoption.channelId || '',
        deviceKey: adoption.deviceKey || '',
        unitId: adoption.unitId,
        adoptedAt: adoption.adoptedAt || '',
        overwriteExisting: Boolean(adoption.overwriteExisting),
        overwrittenFields: Array.isArray(adoption.overwrittenFields) ? adoption.overwrittenFields.join(', ') : '',
        vendorName: id.vendorName || device.manufacturer || '',
        productCode: id.productCode || device.productCode || '',
        productName: id.productName || device.productName || '',
        modelName: id.modelName || device.model || '',
        revision: id.revision || device.revision || ''
      });
    }
  }
  return rows;
}

function normalizeChannels(project, status) {
  const runtime = new Map((status?.channels || []).map(c => [c.channelId, c]));
  return Object.values(project?.channels || {}).map(c => {
    const live = runtime.get(c.channelId) || {};
    return {
      ...c,
      healthScore: live.healthScore ?? c.healthScore ?? '',
      state: live.state || live.status || c.state || (c.active === false ? 'inactive' : 'active'),
      frames: live.frames ?? live.totals?.frames ?? '',
      requests: live.requests ?? live.totals?.requests ?? '',
      responses: live.responses ?? live.totals?.responses ?? '',
      timeouts: live.timeouts ?? live.totals?.timeouts ?? '',
      exceptions: live.exceptions ?? live.totals?.exceptions ?? '',
      avgRttMs: live.avgRttMs ?? live.totals?.avgRttMs ?? '',
      p95RttMs: live.p95RttMs ?? live.totals?.p95RttMs ?? '',
      mbapErrors: live.mbapErrors ?? live.tcp?.mbapErrors ?? '',
      disconnects: live.disconnects ?? live.tcp?.disconnects ?? '',
      bytesPerSec: live.bytesPerSec ?? live.throughput?.bytesPerSec ?? ''
    };
  });
}

function collectExportModel({ project, state, diagnostics, mappings = [], history = [], workspaceBackup = null, networkSnapshot = null }) {
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
  const channels = normalizeChannels(project, status);
  const discovery = flattenDiscovery(project);
  const adoptions = flattenAdoptions(project);
  const networkHosts = Array.isArray(networkSnapshot?.hosts) ? networkSnapshot.hosts : [];
  const networkEvents = Array.isArray(networkSnapshot?.events) ? networkSnapshot.events : [];
  const networkScans = Array.isArray(networkSnapshot?.scans) ? networkSnapshot.scans : [];

  const summary = [
    ['Project', project?.name || 'Default'],
    ['Site', project?.site || ''],
    ['Bus', project?.bus || ''],
    ['Generated', new Date().toISOString()],
    ['Health score', analysis?.healthScore ?? ''],
    ['Channels', channels.length],
    ['Frames', status?.totals?.frames ?? 0],
    ['Devices', devices.length],
    ['Registers', registers.length],
    ['Polling groups', polls.length],
    ['Discovery runs', (project?.discoveryRuns || []).length],
    ['Discovery results', discovery.length],
    ['Adopted identities', adoptions.length],
    ['Network hosts', networkHosts.length],
    ['Network scans', networkScans.length],
    ['Network events', networkEvents.length],
    ['Requests', status?.totals?.requests ?? 0],
    ['Responses', status?.totals?.responses ?? 0],
    ['Timeouts', status?.totals?.timeouts ?? timeouts.length],
    ['Exceptions', status?.totals?.exceptions ?? exceptions.length],
    ['RTU noise bytes', status?.totals?.noiseBytes ?? 0],
    ['Average RTT ms', status?.totals?.avgRttMs ?? ''],
    ['P95 RTT ms', status?.totals?.p95RttMs ?? ''],
    ['Timeout rate %', analysis?.rates?.timeoutRate ?? ''],
    ['Unmatched response rate %', analysis?.rates?.unmatchedResponseRate ?? ''],
    ['Health aggregation', analysis?.healthAggregation || ''],
    ['Estimated RTU utilization %', diagnostics?.utilizationPct ?? '']
  ];

  return { project, status, analysis, diagnostics, channels, devices, polls, registers, mappings, transactions, timeouts, exceptions, discovery, adoptions, history, capture, workspaceBackup, networkSnapshot, networkHosts, networkEvents, networkScans, summary };
}

function sheetColumns(name) {
  const id = [['Transport','transport'],['Channel','channelId'],['Endpoint','endpoint'],['Device Key','deviceKey'],['Unit/Slave ID','unitId']];
  const defs = {
    Channels: [
      ['Transport','transport'],['Channel','channelId'],['Name','name'],['Mode','mode'],['Endpoint','endpoint'],['State','state'],['Health','healthScore'],['Frames','frames'],['Requests','requests'],['Responses','responses'],['Timeouts','timeouts'],['Exceptions','exceptions'],['Avg RTT ms','avgRttMs'],['P95 RTT ms','p95RttMs'],['MBAP Errors','mbapErrors'],['Disconnects','disconnects'],['Bytes/s','bytesPerSec']
    ],
    Devices: [...id,['Name','deviceName'],['Manufacturer','manufacturer'],['Model','model'],['Revision','revision'],['Status','status'],['Health','healthScore'],['Requests','requests'],['Responses','responses'],['Timeouts','timeouts'],['Exceptions','exceptions'],['Registers','registerCount'],['Poll Groups','pollGroupCount'],['Avg RTT ms','avgRttMs'],['P95 RTT ms','p95RttMs'],['Last Seen','lastSeen']],
    'Polling Groups': [...id,['FC','functionCode'],['Operation','operation'],['Start','startAddress'],['End','endAddress'],['Quantity','quantity'],['Requests','requests'],['Responses','responses'],['Timeouts','timeouts'],['Exceptions','exceptions'],['Median Interval ms','medianIntervalMs'],['P95 Interval ms','p95IntervalMs'],['Jitter %','jitterPct'],['Avg RTT ms','avgRttMs'],['P95 RTT ms','p95RttMs']],
    Registers: [...id,['FC','functionCode'],['Address','address'],['Last Value','lastValue'],['HEX','lastHex'],['Min','min'],['Max','max'],['Reads','reads'],['Writes','writes'],['Changes','changes'],['Poll Interval ms','pollIntervalMs'],['Last Seen','lastSeen']],
    'Engineering Values': [...id,['FC','functionCode'],['Address','address'],['Name','name'],['Type','type'],['Byte Order','byteOrder'],['Scale','scale'],['Offset','offset'],['Unit','unit'],['Raw Words','rawWordsText'],['Engineering Value','engineeringValue'],['Available','available'],['Notes','notes']],
    Timeouts: [...id,['Timestamp','timestampIso'],['FC','functionCode'],['Address','address'],['Quantity','quantity'],['Timeout ms','timeoutMs'],['Details','details']],
    Exceptions: [...id,['Timestamp','timestampIso'],['FC','functionCode'],['Code','exceptionCode'],['Exception','exceptionName'],['RTT ms','rttMs'],['Raw HEX','rawHex']],
    Traffic: [['ID','id'],['Timestamp','timestampIso'],...id,['Direction','direction'],['FC','functionCode'],['Function','functionName'],['RTT ms','rttMs'],['Timeout ms','timeoutMs'],['Exception','exceptionName'],['Session','sessionId'],['Raw HEX','rawHex']],
    Discovery: [['Run ID','runId'],['Job ID','jobId'],['Saved','savedAt'],['Completed','completedAt'],['Transport','transport'],['Target','target'],['Unit/Slave ID','unitId'],['Responded','responded'],['FC43 Support','identificationSupported'],['Vendor','vendorName'],['Product Code','productCode'],['Product Name','productName'],['Model','modelName'],['Revision','revision'],['Vendor URL','vendorUrl'],['Application','userApplicationName'],['Avg RTT ms','avgRttMs'],['Object Count','objectCount'],['Adopted','adopted'],['Adopted Device Key','adoptedDeviceKey'],['Adopted Channel','adoptedChannelId'],['Adopted At','adoptedAt'],['Overwrite Existing','overwriteExisting'],['Overwritten Fields','overwrittenFields']],
    'Adoption Audit': [['Run ID','runId'],['Job ID','jobId'],['Transport','transport'],['Target','target'],['Channel','channelId'],['Device Key','deviceKey'],['Unit/Slave ID','unitId'],['Adopted At','adoptedAt'],['Overwrite Existing','overwriteExisting'],['Overwritten Fields','overwrittenFields'],['Vendor','vendorName'],['Product Code','productCode'],['Product Name','productName'],['Model','modelName'],['Revision','revision']],
    'Project History': [['Timestamp','timestampIso'],['Channel','channelId'],['Transport','transport'],['Health','healthScore'],['Frames','frames'],['Devices','devices'],['Timeouts','timeouts'],['Timeout Rate %','timeoutRate'],['Avg RTT ms','avgRttMs'],['Connection','connection']],
    'Network Hosts': [['State','state'],['IP','ip'],['MAC','mac'],['Vendor','macVendor'],['Hostname','hostname'],['Type','type'],['Classification','classification'],['Industrial','industrialText'],['Modbus','modbusText'],['Services','servicesText'],['Avg RTT ms','avgRttMs'],['First Seen','firstSeen'],['Last Seen','lastSeen'],['Last Changed','lastChanged']],
    'Network Events': [['Time','at'],['Type','type'],['Severity','severity'],['IP','ip'],['Host ID','hostId'],['Source','source'],['Details','detailsText']]
  };
  return defs[name];
}

function withIdentity(model, row) {
  const i = rowIdentity(row, model.project);
  return { ...row, ...i };
}

function normalizeRows(model, sheet) {
  if (sheet === 'Channels') return model.channels;
  if (sheet === 'Devices') return model.devices.map(x => {
    const i = rowIdentity(x, model.project), named = namedDevice(model, x) || {};
    const fallback = `${i.idLabel} ${i.unitId}`;
    return { ...x, ...i, deviceName:named.name || x.name || fallback, manufacturer:named.manufacturer || x.manufacturer || '', model:named.model || x.model || '', revision:named.revision || x.revision || '' };
  });
  if (sheet === 'Polling Groups') return model.polls.map(x => withIdentity(model,x));
  if (sheet === 'Registers') return model.registers.map(x => withIdentity(model,x));
  if (sheet === 'Engineering Values') return model.mappings.map(x => ({ ...withIdentity(model,x), rawWordsText: Array.isArray(x.rawWords) ? x.rawWords.join(' ') : '' }));
  if (sheet === 'Timeouts') return model.timeouts.map(x => ({ ...withIdentity(model,x), timestampIso: x.timestamp ? new Date(x.timestamp).toISOString() : '', address: x.request?.startAddress ?? x.request?.address ?? x.decoded?.startAddress ?? x.decoded?.address ?? '', quantity: x.request?.quantity ?? x.decoded?.quantity ?? '', details: x.reason || x.functionName || '' }));
  if (sheet === 'Exceptions') return model.exceptions.map(x => ({ ...withIdentity(model,x), timestampIso: x.timestamp ? new Date(x.timestamp).toISOString() : '' }));
  if (sheet === 'Traffic') return model.transactions.map(x => ({ ...withIdentity(model,x), timestampIso: x.timestamp ? new Date(x.timestamp).toISOString() : '' }));
  if (sheet === 'Discovery') return model.discovery;
  if (sheet === 'Adoption Audit') return model.adoptions;
  if (sheet === 'Project History') return model.history.map(x => ({ timestampIso: x.recordedAt ? new Date(x.recordedAt).toISOString() : '', channelId:x.channelId || '', transport:x.transport || '', healthScore: x.healthScore, frames: x.totals?.frames, devices: x.totals?.devices ?? x.devices?.length, timeouts: x.totals?.timeouts, timeoutRate: x.rates?.timeoutRate, avgRttMs: x.totals?.avgRttMs, connection: x.connection?.status }));
  if (sheet === 'Network Hosts') return (model.networkHosts||[]).map(x=>({...x,industrialText:x.industrial?'yes':'no',modbusText:x.modbus?.verified?'verified':'no',servicesText:(x.services||[]).map(s=>`${s.port}/${s.protocol||'tcp'} ${s.name||''}`.trim()).join('; ')}));
  if (sheet === 'Network Events') return (model.networkEvents||[]).map(x=>({...x,detailsText:JSON.stringify(x.details??x.changes??'')}));
  return [];
}

function excelValue(v) {
  if (v == null) return '';
  if (typeof v === 'bigint') return spreadsheetSafeText(v.toString());
  if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) return spreadsheetSafeText(JSON.stringify(v));
  if (typeof v === 'string') return spreadsheetSafeText(v);
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
  for (const [metric, value] of model.summary) summary.addRow({ metric:excelValue(metric), value:excelValue(value) });
  applySheetStyle(summary);
  summary.getColumn(1).font = { bold: true };

  for (const name of ['Channels','Devices','Polling Groups','Registers','Engineering Values','Timeouts','Exceptions','Traffic','Discovery','Adoption Audit','Project History','Network Hosts','Network Events']) {
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
  const totalWeight = columns.reduce((a,b)=>a+(b.width||1),0);
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = columns.map(c => (c.width || 1) * pageWidth / totalWeight);
  const drawHeader = () => {
    let x = doc.page.margins.left;
    doc.font('Helvetica-Bold').fontSize(7.2);
    columns.forEach((c,i) => { doc.text(c.label, x, doc.y, { width: widths[i], continued: false }); x += widths[i]; });
    doc.moveDown(1.25).font('Helvetica').fontSize(7);
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
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#000000').text('Modbus Engineering Diagnostic Report');
    doc.font('Helvetica').fontSize(9).fillColor('#444444').text(`Project: ${model.project?.name || 'Default'}   Site: ${model.project?.site || '—'}   Bus: ${model.project?.bus || '—'}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`).fillColor('#000000').moveDown();
    const summaryObj = Object.fromEntries(model.summary);
    doc.font('Helvetica-Bold').fontSize(11).text(`Health ${summaryObj['Health score']}/100    Channels ${summaryObj.Channels}    Devices ${summaryObj.Devices}    Frames ${summaryObj.Frames}    Timeouts ${summaryObj.Timeouts}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(13).text('Diagnostic findings').moveDown(0.3);
    const findings = model.diagnostics?.findings || [];
    if (!findings.length) doc.font('Helvetica').fontSize(8.5).text('No diagnostic findings recorded for this export.');
    for (const f of findings) doc.font('Helvetica-Bold').fontSize(9).text(`${String(f.severity || '').toUpperCase()} — ${f.title}`).font('Helvetica').fontSize(8.5).text(f.detail).moveDown(0.3);

    addPdfTable(doc, 'Channels and transport health', [
      {label:'Transport',width:.75,value:r=>r.transport},{label:'Channel',width:1.7,value:r=>r.name||r.channelId},{label:'Mode',width:.7,value:r=>r.mode},{label:'Endpoint',width:1.5,value:r=>r.endpoint||'—'},{label:'State',width:.7,value:r=>r.state},{label:'Health',width:.6,value:r=>r.healthScore},{label:'REQ',width:.55,value:r=>r.requests},{label:'TO',width:.45,value:r=>r.timeouts},{label:'Avg RTT',width:.7,value:r=>r.avgRttMs}
    ], model.channels, 80);

    addPdfTable(doc, 'Devices', [
      {label:'Tr',width:.35,value:r=>rowIdentity(r,model.project).transport},{label:'Channel',width:1.15,value:r=>rowIdentity(r,model.project).channelId},{label:'ID',width:.35,value:r=>rowIdentity(r,model.project).unitId},{label:'Name',width:1.3,value:r=>namedDevice(model,r)?.name||r.name||`${rowIdentity(r,model.project).idLabel} ${rowIdentity(r,model.project).unitId}`},{label:'Status',width:.65,value:r=>r.status},{label:'Regs',width:.45,value:r=>r.registerCount},{label:'Polls',width:.45,value:r=>r.pollGroupCount},{label:'TO',width:.4,value:r=>r.timeouts},{label:'RTT',width:.55,value:r=>r.avgRttMs}
    ], model.devices, 100);

    addPdfTable(doc, 'Polling groups', [
      {label:'Tr',width:.35,value:r=>rowIdentity(r,model.project).transport},{label:'Channel',width:1.1,value:r=>rowIdentity(r,model.project).channelId},{label:'ID',width:.35,value:r=>rowIdentity(r,model.project).unitId},{label:'FC',width:.35,value:r=>r.functionCode},{label:'Range',width:.9,value:r=>`${r.startAddress??'—'}…${r.endAddress??'—'}`},{label:'REQ',width:.45,value:r=>r.requests},{label:'RSP',width:.45,value:r=>r.responses},{label:'TO',width:.4,value:r=>r.timeouts},{label:'Median',width:.6,value:r=>r.medianIntervalMs},{label:'Jitter',width:.5,value:r=>r.jitterPct}
    ], model.polls, 140);

    addPdfTable(doc, 'Engineering values', [
      {label:'Tr',width:.3,value:r=>rowIdentity(r,model.project).transport},{label:'Channel',width:1,value:r=>rowIdentity(r,model.project).channelId},{label:'ID',width:.3,value:r=>rowIdentity(r,model.project).unitId},{label:'FC',width:.3,value:r=>r.functionCode},{label:'Addr',width:.55,value:r=>r.address},{label:'Name',width:1.2,value:r=>r.name},{label:'Type',width:.6,value:r=>r.type},{label:'Value',width:.8,value:r=>Array.isArray(r.engineeringValue)?JSON.stringify(r.engineeringValue):r.engineeringValue},{label:'Unit',width:.45,value:r=>r.unit}
    ], model.mappings, 160);

    addPdfTable(doc, 'Discovery evidence', [
      {label:'Run',width:.8,value:r=>r.runId},{label:'Tr',width:.35,value:r=>r.transport},{label:'Target',width:1.1,value:r=>r.target},{label:'ID',width:.35,value:r=>r.unitId},{label:'State',width:.7,value:r=>r.responded?'responded':'silent'},{label:'Vendor',width:1,value:r=>r.vendorName},{label:'Model',width:1,value:r=>r.modelName||r.productName||r.productCode},{label:'Rev',width:.7,value:r=>r.revision},{label:'Adopted',width:.55,value:r=>r.adopted?'yes':'no'}
    ], model.discovery, 120);

    if (model.adoptions.length) addPdfTable(doc, 'Identification adoption audit', [
      {label:'Run',width:.8,value:r=>r.runId},{label:'Tr',width:.35,value:r=>r.transport},{label:'Channel',width:1.2,value:r=>r.channelId},{label:'ID',width:.35,value:r=>r.unitId},{label:'Vendor',width:1,value:r=>r.vendorName},{label:'Model',width:1,value:r=>r.modelName||r.productName||r.productCode},{label:'Adopted',width:1,value:r=>r.adoptedAt},{label:'Overwrite',width:.6,value:r=>r.overwriteExisting?'yes':'no'}
    ], model.adoptions, 120);

    if (model.networkHosts?.length) addPdfTable(doc, 'Network discovery inventory', [
      {label:'State',width:.55,value:r=>r.state},{label:'IP',width:1,value:r=>r.ip},{label:'Name',width:1.1,value:r=>r.hostname||r.type},{label:'MAC',width:1.2,value:r=>r.mac},{label:'Vendor',width:1.15,value:r=>r.macVendor},{label:'Type',width:1,value:r=>r.type},{label:'Modbus',width:.55,value:r=>r.modbus?.verified?'yes':'no'},{label:'RTT',width:.55,value:r=>r.avgRttMs}
    ], model.networkHosts, 160);
    doc.end();
  });
}

const identityCsv = [
  {label:'transport',value:x=>x.transport||''},{label:'channelId',value:x=>x.channelId||''},{label:'endpoint',value:x=>x.endpoint||''},{label:'deviceKey',value:x=>x.deviceKey||''},{label:'unitId',value:x=>x.unitId??x.slaveId??''}
];
const columns = {
  channels: [{label:'transport',value:x=>x.transport},{label:'channelId',value:x=>x.channelId},{label:'name',value:x=>x.name},{label:'mode',value:x=>x.mode},{label:'endpoint',value:x=>x.endpoint},{label:'state',value:x=>x.state},{label:'healthScore',value:x=>x.healthScore},{label:'requests',value:x=>x.requests},{label:'responses',value:x=>x.responses},{label:'timeouts',value:x=>x.timeouts},{label:'exceptions',value:x=>x.exceptions},{label:'avgRttMs',value:x=>x.avgRttMs},{label:'p95RttMs',value:x=>x.p95RttMs}],
  devices: [...identityCsv,{label:'name',value:x=>x.deviceName},{label:'manufacturer',value:x=>x.manufacturer},{label:'model',value:x=>x.model},{label:'revision',value:x=>x.revision},{label:'status',value:x=>x.status},{label:'healthScore',value:x=>x.healthScore},{label:'requests',value:x=>x.requests},{label:'responses',value:x=>x.responses},{label:'timeouts',value:x=>x.timeouts},{label:'registerCount',value:x=>x.registerCount},{label:'pollGroupCount',value:x=>x.pollGroupCount},{label:'avgRttMs',value:x=>x.avgRttMs},{label:'p95RttMs',value:x=>x.p95RttMs}],
  polls: [...identityCsv,{label:'function',value:x=>x.functionCode},{label:'operation',value:x=>x.operation},{label:'startAddress',value:x=>x.startAddress},{label:'quantity',value:x=>x.quantity},{label:'requests',value:x=>x.requests},{label:'responses',value:x=>x.responses},{label:'timeouts',value:x=>x.timeouts},{label:'medianIntervalMs',value:x=>x.medianIntervalMs},{label:'jitterPct',value:x=>x.jitterPct},{label:'avgRttMs',value:x=>x.avgRttMs}],
  registers: [...identityCsv,{label:'function',value:x=>x.functionCode},{label:'address',value:x=>x.address},{label:'lastValue',value:x=>x.lastValue},{label:'lastHex',value:x=>x.lastHex},{label:'min',value:x=>x.min},{label:'max',value:x=>x.max},{label:'reads',value:x=>x.reads},{label:'writes',value:x=>x.writes},{label:'changes',value:x=>x.changes},{label:'pollIntervalMs',value:x=>x.pollIntervalMs}],
  engineering: [...identityCsv,{label:'function',value:x=>x.functionCode},{label:'address',value:x=>x.address},{label:'name',value:x=>x.name},{label:'type',value:x=>x.type},{label:'byteOrder',value:x=>x.byteOrder},{label:'scale',value:x=>x.scale},{label:'offset',value:x=>x.offset},{label:'unit',value:x=>x.unit},{label:'engineeringValue',value:x=>x.engineeringValue},{label:'available',value:x=>x.available}],
  traffic: [{label:'id',value:x=>x.id},{label:'timestamp',value:x=>x.timestamp?new Date(x.timestamp).toISOString():''},...identityCsv,{label:'direction',value:x=>x.direction},{label:'function',value:x=>x.functionCode},{label:'functionName',value:x=>x.functionName},{label:'sessionId',value:x=>x.sessionId||''},{label:'rttMs',value:x=>x.rttMs},{label:'timeoutMs',value:x=>x.timeoutMs},{label:'exception',value:x=>x.exceptionName||''},{label:'rawHex',value:x=>x.rawHex}],
  discovery: [{label:'runId',value:x=>x.runId},{label:'jobId',value:x=>x.jobId},{label:'savedAt',value:x=>x.savedAt},{label:'completedAt',value:x=>x.completedAt},{label:'transport',value:x=>x.transport},{label:'target',value:x=>x.target},{label:'unitId',value:x=>x.unitId},{label:'responded',value:x=>x.responded},{label:'identificationSupported',value:x=>x.identificationSupported},{label:'vendorName',value:x=>x.vendorName},{label:'productCode',value:x=>x.productCode},{label:'productName',value:x=>x.productName},{label:'modelName',value:x=>x.modelName},{label:'revision',value:x=>x.revision},{label:'avgRttMs',value:x=>x.avgRttMs},{label:'adopted',value:x=>x.adopted},{label:'adoptedDeviceKey',value:x=>x.adoptedDeviceKey},{label:'adoptedChannelId',value:x=>x.adoptedChannelId},{label:'adoptedAt',value:x=>x.adoptedAt}],
  adoptions: [{label:'runId',value:x=>x.runId},{label:'jobId',value:x=>x.jobId},{label:'transport',value:x=>x.transport},{label:'target',value:x=>x.target},{label:'channelId',value:x=>x.channelId},{label:'deviceKey',value:x=>x.deviceKey},{label:'unitId',value:x=>x.unitId},{label:'adoptedAt',value:x=>x.adoptedAt},{label:'overwriteExisting',value:x=>x.overwriteExisting},{label:'overwrittenFields',value:x=>x.overwrittenFields},{label:'vendorName',value:x=>x.vendorName},{label:'productCode',value:x=>x.productCode},{label:'productName',value:x=>x.productName},{label:'modelName',value:x=>x.modelName},{label:'revision',value:x=>x.revision}],
  networkHosts: [{label:'state',value:x=>x.state},{label:'ip',value:x=>x.ip},{label:'mac',value:x=>x.mac},{label:'vendor',value:x=>x.macVendor},{label:'hostname',value:x=>x.hostname},{label:'type',value:x=>x.type},{label:'classification',value:x=>x.classification},{label:'industrial',value:x=>x.industrial},{label:'modbusVerified',value:x=>x.modbus?.verified},{label:'services',value:x=>(x.services||[]).map(s=>`${s.port}/${s.protocol||'tcp'} ${s.name||''}`.trim()).join('; ')},{label:'avgRttMs',value:x=>x.avgRttMs},{label:'firstSeen',value:x=>x.firstSeen},{label:'lastSeen',value:x=>x.lastSeen},{label:'lastChanged',value:x=>x.lastChanged}],
  networkEvents: [{label:'at',value:x=>x.at},{label:'type',value:x=>x.type},{label:'severity',value:x=>x.severity},{label:'ip',value:x=>x.ip},{label:'hostId',value:x=>x.hostId},{label:'source',value:x=>x.source},{label:'details',value:x=>x.details??x.changes??''}]
};

async function streamProjectZip(res, model, reportHtml) {
  const projectName = safeName(model.project?.name); const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${projectName}-${stamp}-results.zip"`);
  const zip = archiver('zip', { zlib: { level: 9 } });
  zip.on('error', err => res.destroy(err)); zip.pipe(res);

  const files = [
    'results/modbus-results.xlsx','results/modbus-report.pdf','results/modbus-report.html','results/diagnostics.json',
    'capture/current.mbcap','project/project.json','project/all-workspaces-and-profiles.json','project/history.json',
    'project/discovery-evidence.json','project/discovery-adoptions.json','project/network-discovery.json',
    'csv/channels.csv','csv/devices.csv','csv/polling-groups.csv','csv/registers.csv','csv/engineering-values.csv','csv/traffic.csv','csv/discovery.csv','csv/discovery-adoptions.csv','csv/network-hosts.csv','csv/network-events.csv'
  ];

  zip.append(await buildWorkbook(model), { name: files[0] });
  zip.append(await buildPdf(model), { name: files[1] });
  zip.append(reportHtml, { name: files[2] });
  zip.append(jsonSafe(model.diagnostics), { name: files[3] });
  zip.append(jsonSafe(model.capture), { name: files[4] });
  zip.append(jsonSafe(model.project), { name: files[5] });
  zip.append(jsonSafe(model.workspaceBackup || {}), { name: files[6] });
  zip.append(jsonSafe(model.history), { name: files[7] });
  zip.append(jsonSafe(model.discovery), { name: files[8] });
  zip.append(jsonSafe(model.adoptions), { name: files[9] });
  zip.append(jsonSafe(model.networkSnapshot||{}), { name: files[10] });
  zip.append(csv(model.channels, columns.channels), { name: files[11] });
  zip.append(csv(normalizeRows(model,'Devices'), columns.devices), { name: files[12] });
  zip.append(csv(normalizeRows(model,'Polling Groups'), columns.polls), { name: files[13] });
  zip.append(csv(normalizeRows(model,'Registers'), columns.registers), { name: files[14] });
  zip.append(csv(normalizeRows(model,'Engineering Values'), columns.engineering), { name: files[15] });
  zip.append(csv(normalizeRows(model,'Traffic'), columns.traffic), { name: files[16] });
  zip.append(csv(model.discovery, columns.discovery), { name: files[17] });
  zip.append(csv(model.adoptions, columns.adoptions), { name: files[18] });
  zip.append(csv(model.networkHosts||[], columns.networkHosts), { name: files[19] });
  zip.append(csv(model.networkEvents||[], columns.networkEvents), { name: files[20] });
  zip.append(jsonSafe({ format:'modbus-engineering-tool-export', version:3, generatedAt:new Date().toISOString(), project:model.project?.name, channelCount:model.channels.length, discoveryResultCount:model.discovery.length, adoptionCount:model.adoptions.length, networkHostCount:model.networkHosts?.length||0, networkScanCount:model.networkScans?.length||0, formulaInjectionProtection:true, files }), { name: 'manifest.json' });
  await zip.finalize();
}

module.exports = { collectExportModel, buildWorkbook, buildPdf, streamProjectZip, safeName, csv, normalizeRows, flattenDiscovery, flattenAdoptions, normalizeChannels, rowIdentity, spreadsheetSafeText, excelValue };
