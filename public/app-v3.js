'use strict';

const $ = id => document.getElementById(id);
const state = {
  status: null,
  analysis: null,
  transactions: [],
  registers: [],
  ports: [],
  config: {},
  paused: false,
  selectedId: null,
  refreshTimer: null,
  ws: null
};

const pageMeta = {
  dashboard: ['Dashboard', 'Live RS485 / Modbus RTU visibility'],
  traffic: ['Live Traffic', 'Decoded request / response stream and packet inspection'],
  analysis: ['Analysis', 'Engineering diagnostics for timing, devices, exceptions and address activity'],
  registers: ['Registers', 'Automatically discovered addresses and live raw values'],
  settings: ['Settings', 'Serial interface, capture controls and workstation status']
};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function n(v, fallback = '—') { return v == null || Number.isNaN(Number(v)) ? fallback : v; }
function ms(v) { return v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(Number(v) < 10 ? 1 : 0)} ms`; }
function pct(v, digits) {
  const x = Number(v || 0);
  const d = digits == null ? (Math.abs(x) < 1 ? 3 : 1) : digits;
  return `${x.toFixed(d)}%`;
}
function bytes(v) {
  let x = Number(v || 0); const units = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function time(v, withMs = false) {
  if (!v) return '—';
  const d = new Date(v);
  const base = d.toLocaleTimeString([], { hour12: false });
  return withMs ? `${base}.${String(d.getMilliseconds()).padStart(3, '0')}` : base;
}
function ago(v) {
  if (!v) return '—';
  const s = Math.max(0, Math.floor((Date.now() - v) / 1000));
  if (s < 2) return 'now'; if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; return time(v);
}
function uptime(msValue) {
  const sec = Math.floor((msValue || 0) / 1000); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  return [h, m, s].map(x => String(x).padStart(2, '0')).join(':');
}
function detail(t) {
  const d = t.decoded || {}; const r = t.request || {};
  if (t.exception) return `${t.exceptionName || 'Exception'} (${t.exceptionCode})`;
  if (Number.isInteger(d.startAddress)) return `addr ${d.startAddress} · qty ${d.quantity ?? ''}`;
  if (Number.isInteger(r.startAddress)) return `addr ${r.startAddress} · qty ${r.quantity ?? ''}`;
  if (Number.isInteger(d.address)) return `addr ${d.address} · value ${d.value ?? ''}`;
  if (Array.isArray(d.registers) && d.registers.length) return `${d.registers[0].address}…${d.registers.at(-1).address}`;
  return t.functionName || `Function ${t.functionCode}`;
}
function dirBadge(t) {
  const cls = t.exception ? 'err' : t.direction === 'REQ' ? 'req' : t.direction === 'RSP' ? 'rsp' : '';
  return `<span class="badge ${cls}">${esc(t.direction)}</span>`;
}
function toast(message, error = false) {
  const node = $('toast'); if (!node) return;
  node.textContent = message; node.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.className = 'toast'; }, 3200);
}
async function api(url, options) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || body || `HTTP ${res.status}`);
  return body;
}

function go(page) {
  if (!pageMeta[page]) page = 'dashboard';
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.page === page));
  $(`page-${page}`)?.classList.add('active');
  if ($('pageTitle')) $('pageTitle').textContent = pageMeta[page][0];
  if ($('pageSubtitle')) $('pageSubtitle').textContent = pageMeta[page][1];
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  if (page === 'traffic') renderTraffic();
  if (page === 'analysis') renderAnalysis();
  if (page === 'registers') refreshRegisters();
  if (page === 'settings') loadPorts();
}

function setRing(id, score) {
  const node = $(id); if (node) node.style.setProperty('--score', Math.max(0, Math.min(100, Number(score || 0))));
}

function renderStatus() {
  if (!state.status) return;
  const s = state.status; const t = s.totals || {}; const c = s.connection || {};
  $('kpiFrames').textContent = Number(t.frames || 0).toLocaleString();
  $('kpiFps').textContent = `${Number(t.framesPerSecond || 0).toFixed(1)} fps`;
  $('kpiSlaves').textContent = t.slaves || 0;
  $('kpiRegisters').textContent = `${Number(t.registers || 0).toLocaleString()} registers found`;
  $('kpiRtt').textContent = ms(t.avgRttMs);
  $('kpiP95').textContent = `P95 ${ms(t.p95RttMs)}`;
  $('kpiExceptions').textContent = Number(t.exceptions || 0).toLocaleString();
  $('kpiNoise').textContent = `${Number(t.noiseBytes || 0).toLocaleString()} noise bytes`;
  $('kpiBytes').textContent = bytes(t.bytes);
  $('kpiUptime').textContent = `${uptime(s.uptimeMs)} uptime`;

  const pill = $('connectionPill');
  pill.className = `connection-pill ${c.status || 'idle'}`;
  $('connectionText').textContent = (c.status || 'idle').replace(/^./, x => x.toUpperCase());
  const cfg = s.config || state.config || {};
  $('serialSummary').textContent = c.status === 'demo' ? 'SIMULATOR' : cfg.port ? `${cfg.port} · ${cfg.baudRate} · ${cfg.dataBits}${String(cfg.parity || 'none')[0].toUpperCase()}${cfg.stopBits}` : 'No port selected';
  drawLine($('trafficChart'), s.timeline || []);
}

function renderDashboard() {
  if (!state.status) return;
  renderStatus();
  const a = state.analysis || {}; const score = a.healthScore ?? 100;
  $('dashHealthScore').textContent = score; setRing('dashHealthRing', score);
  $('dashExceptionRate').textContent = pct(a.rates?.exceptionRate);
  $('dashUnmatchedRate').textContent = pct(a.rates?.unmatchedResponseRate);
  $('dashNoiseRate').textContent = pct(a.rates?.noiseRatio);
  $('dashboardSlaves').innerHTML = (a.slaves || []).slice(0, 10).map(s => `<tr><td><strong>${esc(s.slaveId)}</strong></td><td>${s.frames}</td><td>${s.exceptions}</td><td>${ms(s.avgRttMs)}</td><td>${ago(s.lastSeen)}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">No Modbus slaves detected yet.</td></tr>`;
  const recent = state.transactions.slice(-10).reverse();
  $('dashboardTraffic').innerHTML = recent.map(t => `<tr><td class="mono">${time(t.timestamp, true)}</td><td>${dirBadge(t)}</td><td>${esc(t.slaveId)}</td><td>${esc(t.functionCode)}</td><td>${esc(detail(t))}</td><td>${ms(t.rttMs)}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">Waiting for traffic…</td></tr>`;
}

function trafficFilters() {
  return { slave: $('trafficSlave').value.trim(), fc: $('trafficFc').value.trim(), direction: $('trafficDirection').value, q: $('trafficSearch').value.trim().toLowerCase() };
}
function filteredTransactions() {
  const f = trafficFilters();
  return state.transactions.filter(t => {
    if (f.slave && t.slaveId !== Number(f.slave)) return false;
    if (f.fc && t.functionCode !== Number(f.fc)) return false;
    if (f.direction && t.direction !== f.direction) return false;
    if (f.q && !`${t.rawHex} ${t.functionName} ${t.exceptionName || ''} ${detail(t)}`.toLowerCase().includes(f.q)) return false;
    return true;
  }).slice(-1000);
}
function renderTraffic() {
  const rows = filteredTransactions(); $('trafficCount').textContent = rows.length.toLocaleString();
  $('trafficBody').innerHTML = rows.slice().reverse().map(t => `<tr data-id="${t.id}" class="${state.selectedId === t.id ? 'selected' : ''}"><td class="muted">${t.id}</td><td class="mono">${time(t.timestamp, true)}</td><td>${dirBadge(t)}</td><td><strong>${esc(t.slaveId)}</strong></td><td>${esc(t.functionCode)}</td><td>${esc(t.functionName)}<br><span class="muted">${esc(detail(t))}</span></td><td>${ms(t.rttMs)}</td><td>${t.byteLength}</td><td class="mono raw-cell">${esc(t.rawHex)}</td></tr>`).join('') || `<tr><td colspan="9" class="muted">No transactions match the current filters.</td></tr>`;
  $('trafficBody').querySelectorAll('tr[data-id]').forEach(row => row.addEventListener('click', () => selectPacket(Number(row.dataset.id))));
}
function selectPacket(id) {
  state.selectedId = id; const t = state.transactions.find(x => x.id === id); if (!t) return;
  renderTraffic();
  const decoded = JSON.stringify(t.decoded, null, 2); const request = t.request ? JSON.stringify(t.request, null, 2) : 'No matched request';
  $('inspectorContent').className = 'inspector-content';
  $('inspectorContent').innerHTML = `<div class="inspect-grid"><div class="inspect-kv"><span>Direction</span><strong>${esc(t.direction)}</strong></div><div class="inspect-kv"><span>Slave</span><strong>${esc(t.slaveId)}</strong></div><div class="inspect-kv"><span>Function</span><strong>FC${String(t.functionCode).padStart(2, '0')}</strong></div><div class="inspect-kv"><span>RTT</span><strong>${ms(t.rttMs)}</strong></div><div class="inspect-kv"><span>Matched</span><strong>${t.matched ? 'Yes' : 'No'}</strong></div><div class="inspect-kv"><span>Length</span><strong>${t.byteLength} bytes</strong></div></div>${t.exception ? `<div class="inspect-section"><h3>Modbus exception</h3><div class="hex-box">${esc(t.exceptionName)} (${esc(t.exceptionCode)})</div></div>` : ''}<div class="inspect-section"><h3>Raw RTU frame</h3><div class="hex-box">${esc(t.rawHex)}</div></div><div class="inspect-section"><h3>Decoded packet</h3><div class="json-box">${esc(decoded)}</div></div><div class="inspect-section"><h3>Matched request context</h3><div class="json-box">${esc(request)}</div></div>`;
}

function healthClass(score) { return score >= 90 ? ['good', 'Healthy capture'] : score >= 70 ? ['warn', 'Review recommended'] : ['bad', 'Capture quality degraded']; }
function rttTransactions() { return state.transactions.filter(t => Number.isFinite(Number(t.rttMs)) && Number(t.rttMs) >= 0); }
function renderAnalysis() {
  const a = state.analysis; if (!a || !$('analysisFrames')) return;
  const t = state.status?.totals || {};
  const score = a.healthScore ?? 100; const hc = healthClass(score);
  $('analysisHealthScore').textContent = score; setRing('analysisHealthRing', score);
  $('healthLabel').className = `status-label ${hc[0]}`; $('healthLabel').textContent = hc[1];
  $('rttP50').textContent = ms(a.rtt?.p50Ms); $('rttP95').textContent = ms(a.rtt?.p95Ms); $('rttP99').textContent = ms(a.rtt?.p99Ms);

  const rsp = Number(t.responses || 0), unmatched = Number(t.unmatchedResponses || 0), exceptions = Number(t.exceptions || 0);
  const matchRate = rsp ? Math.max(0, (rsp - unmatched) / rsp * 100) : 100;
  const exceptionFree = rsp ? Math.max(0, (rsp - exceptions) / rsp * 100) : 100;
  const cleanLine = Math.max(0, 100 - Number(a.rates?.noiseRatio || 0));
  $('analysisMatchRate').textContent = pct(matchRate, 1); $('analysisExceptionFree').textContent = pct(exceptionFree, 1); $('analysisCleanLine').textContent = pct(cleanLine, 2);
  $('analysisFrames').textContent = Number(t.frames || 0).toLocaleString(); $('analysisRequests').textContent = Number(t.requests || 0).toLocaleString(); $('analysisResponses').textContent = rsp.toLocaleString(); $('analysisSlaveCount').textContent = Number(t.slaves || 0); $('analysisRegisterCount').textContent = Number(t.registers || 0).toLocaleString(); $('analysisFps').textContent = `${Number(t.framesPerSecond || 0).toFixed(1)} fps`;
  $('analysisRttAvg').textContent = ms(a.rtt?.avgMs); $('analysisRttMin').textContent = ms(a.rtt?.minMs); $('analysisRttMax').textContent = ms(a.rtt?.maxMs); $('analysisRttP95').textContent = ms(a.rtt?.p95Ms); $('analysisRttSamples').textContent = `${Number(a.rtt?.samples || 0).toLocaleString()} SAMPLES`;

  let verdictTitle = 'Bus communication looks healthy';
  let verdictBody = `${Number(t.slaves || 0)} slave(s), ${Number(t.registers || 0).toLocaleString()} discovered registers and ${Number(t.frames || 0).toLocaleString()} valid frames.`;
  if (!Number(t.frames || 0)) { verdictTitle = 'Waiting for valid Modbus traffic'; verdictBody = 'Select the correct COM port and serial format. Then the analyzer will populate from real request/response traffic.'; }
  else if (Number(a.rates?.noiseRatio || 0) > 1) { verdictTitle = 'Serial framing or wiring needs attention'; verdictBody = 'A significant amount of captured data is outside valid CRC frames. Verify baud, parity, A/B polarity and common reference.'; }
  else if (Number(a.rates?.exceptionRate || 0) > 2) { verdictTitle = 'Slave exception replies need investigation'; verdictBody = 'Exception responses are frequent. Check addresses, quantities, function codes and device state.'; }
  else if (Number(a.rtt?.p95Ms || 0) > 500) { verdictTitle = 'Communication works, but the slow tail is high'; verdictBody = 'Some replies may collide with the master timeout or poll interval. Inspect the slowest-response table below.'; }
  $('analysisVerdictTitle').textContent = verdictTitle; $('analysisVerdictBody').textContent = verdictBody;

  const rtts = rttTransactions().map(x => Number(x.rttMs));
  const defs = [['<10', v => v < 10, ''], ['10–25', v => v >= 10 && v < 25, ''], ['25–50', v => v >= 25 && v < 50, ''], ['50–100', v => v >= 50 && v < 100, ''], ['100–250', v => v >= 100 && v < 250, 'slow'], ['250–500', v => v >= 250 && v < 500, 'slow'], ['>500', v => v >= 500, 'critical']];
  const buckets = defs.map(([label, test, cls]) => ({ label, cls, count: rtts.filter(test).length })); const maxBucket = Math.max(1, ...buckets.map(x => x.count));
  $('analysisLatencyHistogram').innerHTML = buckets.map(x => `<div class="latency-col ${x.cls}"><div class="latency-value">${x.count}</div><div class="latency-track"><div class="latency-bar" style="height:${Math.max(2, x.count / maxBucket * 100)}%"></div></div><div class="latency-label">${x.label} ms</div></div>`).join('');

  const diagnostics = [
    ['Line / CRC cleanliness', Number(a.rates?.noiseRatio || 0) < .1 ? 'good' : Number(a.rates?.noiseRatio || 0) < 1 ? 'warn' : 'bad', pct(a.rates?.noiseRatio, 3), `${Number(t.noiseBytes || 0)} noise bytes`],
    ['Modbus exceptions', Number(a.rates?.exceptionRate || 0) < .2 ? 'good' : Number(a.rates?.exceptionRate || 0) < 2 ? 'warn' : 'bad', pct(a.rates?.exceptionRate, 2), `${exceptions} exception replies`],
    ['Request matching', Number(a.rates?.unmatchedResponseRate || 0) < .2 ? 'good' : Number(a.rates?.unmatchedResponseRate || 0) < 2 ? 'warn' : 'bad', pct(a.rates?.unmatchedResponseRate, 2), `${unmatched} unmatched replies`],
    ['P95 latency', Number(a.rtt?.p95Ms || 0) <= 250 ? 'good' : Number(a.rtt?.p95Ms || 0) <= 500 ? 'warn' : 'bad', ms(a.rtt?.p95Ms), 'Compare with master timeout'],
    ['Unknown frames', Number(t.unknown || 0) ? 'warn' : 'good', String(Number(t.unknown || 0)), 'CRC-valid vendor/unknown layouts']
  ];
  $('analysisDiagnostics').innerHTML = diagnostics.map(([name, cls, value, note]) => `<div class="diagnostic-row ${cls}"><i class="diagnostic-dot"></i><div><strong>${esc(name)}</strong><span>${esc(note)}</span></div><b>${esc(value)}</b></div>`).join('');

  const slaves = a.slaves || [];
  $('analysisDevices').innerHTML = slaves.length ? slaves.map(s => {
    const sr = Number(s.responses || 0); const sm = sr ? Math.max(0, (sr - Number(s.unmatchedResponses || 0)) / sr * 100) : 100;
    const sev = Number(s.exceptions || 0) > 0 || Number(s.p95RttMs || 0) > 500 ? 'warn' : 'good';
    return `<div class="device-health-card ${sev}" tabindex="0" data-analysis-slave="${s.slaveId}"><div class="device-card-head"><strong>Slave ${s.slaveId}</strong><span class="health-mini-badge">${sev === 'good' ? 'HEALTHY' : 'WATCH'}</span></div><div class="device-metrics"><div><span>Frames</span><strong>${s.frames}</strong></div><div><span>Match</span><strong>${pct(sm, 1)}</strong></div><div><span>P95</span><strong>${ms(s.p95RttMs)}</strong></div><div><span>Exceptions</span><strong>${s.exceptions}</strong></div><div><span>Average</span><strong>${ms(s.avgRttMs)}</strong></div><div><span>Last seen</span><strong>${ago(s.lastSeen)}</strong></div></div></div>`;
  }).join('') : '<div class="analysis-empty">No slaves detected yet.</div>';

  const funcs = a.functions || []; const maxFrames = Math.max(1, ...funcs.map(f => Number(f.frames || 0)));
  $('analysisProtocolMix').innerHTML = funcs.length ? funcs.slice(0, 12).map(f => `<div class="protocol-row" data-analysis-fc="${f.functionCode}"><div class="protocol-fc">FC${String(f.functionCode).padStart(2, '0')}</div><div><div class="protocol-name">${esc(f.name)}</div><div class="protocol-track"><div class="protocol-fill" style="width:${Math.max(2, Number(f.frames || 0) / maxFrames * 100)}%"></div></div></div><div class="protocol-count">${f.frames}</div></div>`).join('') : '<div class="analysis-empty">No function codes observed yet.</div>';

  const slow = rttTransactions().sort((x, y) => Number(y.rttMs) - Number(x.rttMs)).slice(0, 12);
  $('analysisSlowRows').innerHTML = slow.map(x => `<tr class="analysis-click-row" data-analysis-packet="${x.id}"><td><strong>${x.slaveId}</strong></td><td>FC${String(x.functionCode).padStart(2, '0')}</td><td class="${Number(x.rttMs) > 500 ? 'critical-rtt' : Number(x.rttMs) > 250 ? 'slow-rtt' : ''}">${ms(x.rttMs)}</td><td>${esc(detail(x))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No matched latency samples yet.</td></tr>';

  $('analysisSlaves').innerHTML = slaves.map(s => {
    const sr = Number(s.responses || 0); const sm = sr ? Math.max(0, (sr - Number(s.unmatchedResponses || 0)) / sr * 100) : 100;
    return `<tr class="analysis-click-row" data-analysis-slave="${s.slaveId}"><td><strong>${s.slaveId}</strong></td><td>${s.frames}</td><td>${s.requests}</td><td>${s.responses}</td><td>${pct(sm, 1)}</td><td>${s.exceptions}</td><td>${s.unmatchedResponses}</td><td>${ms(s.avgRttMs)}</td><td>${ms(s.p95RttMs)}</td><td>${ago(s.lastSeen)}</td></tr>`;
  }).join('') || '<tr><td colspan="10" class="muted">No slave data yet.</td></tr>';
  $('analysisFunctions').innerHTML = funcs.map(f => `<tr class="analysis-click-row" data-analysis-fc="${f.functionCode}"><td><strong>FC${String(f.functionCode).padStart(2, '0')}</strong></td><td>${esc(f.name)}</td><td>${f.frames}</td><td>${f.requests}</td><td>${f.responses}</td><td>${f.exceptions}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No function data yet.</td></tr>';
  $('analysisRanges').innerHTML = (a.ranges || []).slice(0, 150).map(r => `<tr class="analysis-click-row" data-analysis-range="1" data-slave="${r.slaveId}" data-fc="${r.functionCode}" data-address="${r.startAddress}"><td>${r.slaveId}</td><td>${r.functionCode}</td><td class="mono"><strong>${r.startAddress}</strong></td><td class="mono">${r.endAddress}</td><td>${r.count}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No address ranges yet.</td></tr>';

  const findings = [];
  if (!Number(t.frames || 0)) findings.push(['good', 'Ready for capture', 'Select a serial port and verify communication format.']);
  else findings.push(['good', 'Valid Modbus traffic is being decoded', `${Number(t.frames).toLocaleString()} valid frames from ${Number(t.slaves || 0)} slave(s).`]);
  if (Number(a.rates?.noiseRatio || 0) > .1) findings.push([Number(a.rates.noiseRatio) > 1 ? 'bad' : 'warn', 'Serial noise detected', `${pct(a.rates.noiseRatio, 3)} of observed bytes are outside valid frames.`]);
  if (exceptions) findings.push([Number(a.rates?.exceptionRate || 0) > 2 ? 'bad' : 'warn', 'Modbus exceptions observed', `${exceptions} exception response(s); open Latest exception to inspect one.`]);
  if (unmatched) findings.push([Number(a.rates?.unmatchedResponseRate || 0) > 2 ? 'bad' : 'warn', 'Unmatched responses observed', `${unmatched} response(s) could not be paired with a request.`]);
  if (Number(a.rtt?.p95Ms || 0) > 500) findings.push(['warn', 'Slow response tail', `P95 is ${ms(a.rtt.p95Ms)}; compare with master timeout and inter-call delay.`]);
  const writes = funcs.filter(f => [5, 6, 15, 16, 22, 23].includes(f.functionCode)).reduce((sum, f) => sum + Number(f.requests || 0), 0);
  if (writes) findings.push(['good', 'Write traffic identified', `${writes} write request(s) were captured.`]);
  $('analysisFindingCount').textContent = `${findings.length} FINDING${findings.length === 1 ? '' : 'S'}`;
  $('analysisObservations').innerHTML = findings.map(([cls, title, body]) => `<div class="observation ${cls}"><i></i><div><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`).join('');
}

function openSlaveTraffic(id) { $('trafficSlave').value = id; $('trafficFc').value = ''; $('trafficDirection').value = ''; $('trafficSearch').value = ''; go('traffic'); renderTraffic(); }
function openFunctionTraffic(id) { $('trafficSlave').value = ''; $('trafficFc').value = id; $('trafficDirection').value = ''; $('trafficSearch').value = ''; go('traffic'); renderTraffic(); }

async function refreshRegisters() {
  const p = new URLSearchParams({ limit: '5000' });
  if ($('regSlave').value) p.set('slave', $('regSlave').value); if ($('regFc').value) p.set('fc', $('regFc').value); if ($('regSearch').value) p.set('q', $('regSearch').value);
  try { state.registers = await api(`/api/registers?${p}`); renderRegisters(); } catch (err) { toast(err.message, true); }
}
function renderRegisters() {
  $('registerCount').textContent = `${Number(state.registers.length).toLocaleString()} registers`;
  $('registerBody').innerHTML = state.registers.map(r => `<tr><td><strong>${r.slaveId}</strong></td><td>${r.functionCode}</td><td class="mono"><strong>${r.address}</strong></td><td class="mono">${n(r.lastValue)}</td><td class="mono muted">${esc(r.lastHex || '—')}</td><td>${n(r.min)}</td><td>${n(r.max)}</td><td>${r.reads}</td><td>${r.writes}</td><td>${r.changes}</td><td>${ago(r.lastSeen)}</td></tr>`).join('') || `<tr><td colspan="11" class="muted">No registers discovered for this filter.</td></tr>`;
}

function setupCanvas(canvas) {
  if (!canvas) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2); const rect = canvas.getBoundingClientRect(); const cssW = Math.max(300, rect.width); const cssH = Number(canvas.getAttribute('height') || 220);
  canvas.width = Math.floor(cssW * ratio); canvas.height = Math.floor(cssH * ratio); canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); return { ctx, w: cssW, h: cssH };
}
function drawLine(canvas, timeline) {
  const c = setupCanvas(canvas); if (!c) return; const { ctx, w, h } = c; const pad = { l: 34, r: 12, t: 14, b: 25 };
  ctx.clearRect(0, 0, w, h); ctx.font = '9px system-ui'; ctx.fillStyle = '#718195'; ctx.strokeStyle = '#233142'; ctx.lineWidth = 1;
  const points = []; const now = Math.floor(Date.now() / 1000) * 1000; const by = new Map((timeline || []).map(x => [x.timestamp, x.frames]));
  for (let i = 59; i >= 0; i--) points.push({ t: now - i * 1000, v: by.get(now - i * 1000) || 0 });
  const max = Math.max(5, ...points.map(x => x.v));
  for (let i = 0; i <= 4; i++) { const y = pad.t + (h - pad.t - pad.b) * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText(String(Math.round(max * (1 - i / 4))), 4, y + 3); }
  const xOf = i => pad.l + i * (w - pad.l - pad.r) / (points.length - 1); const yOf = v => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b); grad.addColorStop(0, 'rgba(54,211,153,.22)'); grad.addColorStop(1, 'rgba(54,211,153,0)');
  ctx.beginPath(); points.forEach((p, i) => { const x = xOf(i), y = yOf(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.lineTo(xOf(points.length - 1), h - pad.b); ctx.lineTo(xOf(0), h - pad.b); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => { const x = xOf(i), y = yOf(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = '#36d399'; ctx.lineWidth = 1.7; ctx.stroke();
  ctx.fillStyle = '#718195'; ctx.fillText('-60s', pad.l, h - 7); ctx.fillText('now', w - pad.r - 20, h - 7);
}

function selectedPort() { return $('serialPort')?.value || ''; }
function activePort() { return state.status?.config?.port || state.config?.port || ''; }
function renderPortCards() {
  const list = $('portsList'); if (!list) return;
  const selected = selectedPort(); const active = activePort(); const isOpen = state.status?.connection?.status === 'open'; const disabled = Boolean(state.config?.demo);
  if (!state.ports.length) { list.innerHTML = '<div class="empty-state">No serial ports detected.</div>'; return; }
  list.innerHTML = state.ports.map(p => {
    const isSelected = p.path === selected; const isActive = p.path === active && isOpen;
    const cls = isActive ? 'active-port' : isSelected ? 'selected-port' : '';
    const label = isActive ? 'ACTIVE' : isSelected ? 'SELECTED' : 'SELECT';
    return `<div class="port-card ${cls}" data-port="${esc(p.path)}" tabindex="0" role="button" aria-label="Select ${esc(p.path)}"><strong>${esc(p.path)}</strong><span class="port-card-state">${label}</span><p>${esc(p.manufacturer || 'Serial device')} ${p.vendorId ? `· VID ${esc(p.vendorId)}` : ''} ${p.productId ? `· PID ${esc(p.productId)}` : ''}${p.serialNumber ? `<br>Serial: ${esc(p.serialNumber)}` : ''}</p><button class="port-connect" type="button" data-connect-port="${esc(p.path)}" ${disabled ? 'disabled' : ''}>CONNECT</button></div>`;
  }).join('') + '<div class="port-click-hint">Click anywhere on a port card to select it. Use CONNECT for one-click apply/reconnect with the serial settings shown on the left.</div>';
}
function selectPort(path) {
  if (state.config?.demo) return toast('Port selection is disabled in demo mode.', true);
  const select = $('serialPort'); if (!select || ![...select.options].some(o => o.value === path)) return toast(`${path} is no longer available. Refresh ports.`, true);
  select.value = path; renderPortCards(); $('serialFormNote').textContent = `${path} selected. Adjust baud/parity if required, then Apply & reconnect — or press CONNECT on the card.`; toast(`${path} selected.`);
}
async function loadPorts() {
  try {
    state.ports = await api('/api/ports');
    const select = $('serialPort'); const currentSelection = select.value; const active = state.config.port || state.status?.config?.port || '';
    select.innerHTML = `<option value="">Select port…</option>` + state.ports.map(p => `<option value="${esc(p.path)}">${esc(p.path)}${p.manufacturer ? ` — ${esc(p.manufacturer)}` : ''}</option>`).join('');
    const preferred = state.ports.some(p => p.path === currentSelection) ? currentSelection : state.ports.some(p => p.path === active) ? active : '';
    select.value = preferred; renderPortCards();
  } catch (err) { toast(`Cannot list ports: ${err.message}`, true); }
}
async function loadConfigIntoForm() {
  try { state.config = await api('/api/config'); } catch (_) { state.config = state.status?.config || {}; }
  const c = state.config; $('serialBaud').value = c.baudRate || 9600; $('serialParity').value = c.parity || 'none'; $('serialDataBits').value = c.dataBits || 8; $('serialStopBits').value = c.stopBits || 1; $('serialReconnect').value = c.reconnectMs || 2000;
  const disabled = Boolean(c.demo); $('serialForm').querySelectorAll('input,select,button').forEach(node => node.disabled = disabled);
  $('serialFormNote').textContent = disabled ? 'Serial configuration is disabled while --demo is active. Run npm start for real hardware capture.' : 'Click a detected port card to select it, confirm the serial format, then Apply & reconnect.';
}
function serialBody(pathOverride) {
  return { port: pathOverride || $('serialPort').value, baudRate: Number($('serialBaud').value), parity: $('serialParity').value, dataBits: Number($('serialDataBits').value), stopBits: Number($('serialStopBits').value), reconnectMs: Number($('serialReconnect').value) };
}
async function configureSerial(pathOverride) {
  if (pathOverride) selectPort(pathOverride);
  const body = serialBody(pathOverride); if (!body.port) return toast('Select a serial port first.', true);
  try {
    $('serialFormNote').textContent = `Opening ${body.port} @ ${body.baudRate} ${body.dataBits}${body.parity[0].toUpperCase()}${body.stopBits}…`;
    const result = await api('/api/serial/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    state.config = result.config; if (state.status) state.status.config = result.config;
    toast(`${body.port} configuration applied.`); await new Promise(resolve => setTimeout(resolve, 250)); await refreshStatusAnalysis(); await loadPorts();
    $('serialFormNote').textContent = `${body.port} applied. Connection status is shown at the top right.`;
  } catch (err) { $('serialFormNote').textContent = `Failed: ${err.message}`; toast(err.message, true); }
}

async function clearCapture() {
  if (!confirm('Clear all in-memory packet, analysis and register-discovery data?')) return;
  try { await api('/api/capture/clear', { method: 'POST' }); state.transactions = []; state.registers = []; state.selectedId = null; await refreshAll(); toast('Capture cleared.'); } catch (err) { toast(err.message, true); }
}
async function refreshStatusAnalysis() {
  const [status, analysis] = await Promise.all([api('/api/status'), api('/api/analysis')]); state.status = status; state.analysis = analysis; renderDashboard(); if ($('page-analysis').classList.contains('active')) renderAnalysis();
}
function scheduleRefresh() {
  if (state.refreshTimer) return;
  state.refreshTimer = setTimeout(async () => { state.refreshTimer = null; try { await refreshStatusAnalysis(); if ($('page-registers').classList.contains('active')) refreshRegisters(); if ($('page-settings').classList.contains('active')) renderPortCards(); } catch (_) {} }, 650);
}
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'; const ws = new WebSocket(`${proto}//${location.host}/ws`); state.ws = ws;
  ws.addEventListener('message', e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'hello') { state.status = msg.payload.status; state.analysis = msg.payload.analysis; renderDashboard(); renderAnalysis(); renderPortCards(); return; }
    if (msg.type === 'transaction') { state.transactions.push(msg.payload); if (state.transactions.length > 3000) state.transactions.splice(0, state.transactions.length - 3000); if (!state.paused && $('page-traffic').classList.contains('active')) renderTraffic(); scheduleRefresh(); }
    if (msg.type === 'port') { if (state.status) state.status.connection = msg.payload; renderStatus(); renderPortCards(); }
    if (msg.type === 'clear') { state.transactions = []; state.registers = []; state.selectedId = null; renderTraffic(); renderRegisters(); scheduleRefresh(); }
    if (msg.type === 'config') { state.config = msg.payload; if (state.status) state.status.config = msg.payload; renderStatus(); renderPortCards(); }
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 1500)); ws.addEventListener('error', () => ws.close());
}
async function refreshAll() {
  const [status, analysis, transactions, registers] = await Promise.all([api('/api/status'), api('/api/analysis'), api('/api/transactions?limit=1500'), api('/api/registers?limit=5000')]);
  state.status = status; state.analysis = analysis; state.transactions = transactions; state.registers = registers; renderDashboard(); renderTraffic(); renderAnalysis(); renderRegisters();
}

// Navigation / standard controls
document.querySelectorAll('.nav-item').forEach(x => x.addEventListener('click', () => go(x.dataset.page)));
document.querySelectorAll('[data-go]').forEach(x => x.addEventListener('click', () => go(x.dataset.go)));
window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'dashboard'));
['trafficSlave', 'trafficFc', 'trafficDirection', 'trafficSearch'].forEach(id => $(id).addEventListener('input', renderTraffic));
['regSlave', 'regFc', 'regSearch'].forEach(id => $(id).addEventListener('input', () => { clearTimeout(refreshRegisters.timer); refreshRegisters.timer = setTimeout(refreshRegisters, 220); }));
$('pauseTraffic').addEventListener('click', () => { state.paused = !state.paused; $('pauseTraffic').textContent = state.paused ? 'Resume' : 'Pause'; $('trafficLiveBadge').textContent = state.paused ? 'PAUSED' : 'LIVE'; if (!state.paused) renderTraffic(); });
$('clearCapture').addEventListener('click', clearCapture); $('settingsClearCapture').addEventListener('click', clearCapture);
$('refreshPorts').addEventListener('click', async () => { await loadPorts(); toast('Serial ports refreshed.'); });
$('serialPort').addEventListener('change', () => { renderPortCards(); if ($('serialPort').value) $('serialFormNote').textContent = `${$('serialPort').value} selected. Confirm settings and Apply & reconnect.`; });
$('serialForm').addEventListener('submit', e => { e.preventDefault(); configureSerial(); });

// Direct clickable port cards.
$('portsList').addEventListener('click', e => {
  const connect = e.target.closest('[data-connect-port]');
  if (connect) { e.stopPropagation(); return configureSerial(connect.dataset.connectPort); }
  const card = e.target.closest('[data-port]'); if (card) selectPort(card.dataset.port);
});
$('portsList').addEventListener('keydown', e => { const card = e.target.closest('[data-port]'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectPort(card.dataset.port); } });

// Analysis drill-down controls.
$('analysisLatestException').addEventListener('click', () => { const tx = [...state.transactions].reverse().find(x => x.exception); if (!tx) return toast('No Modbus exception in the current capture.'); go('traffic'); selectPacket(tx.id); });
$('analysisSlowestPacket').addEventListener('click', () => { const tx = rttTransactions().sort((a, b) => Number(b.rttMs) - Number(a.rttMs))[0]; if (!tx) return toast('No matched response-time sample yet.'); go('traffic'); selectPacket(tx.id); });
$('analysisShowWrites').addEventListener('click', () => { $('trafficSlave').value = ''; $('trafficFc').value = ''; $('trafficDirection').value = 'REQ'; $('trafficSearch').value = 'write'; go('traffic'); renderTraffic(); });
$('page-analysis').addEventListener('click', e => {
  const packet = e.target.closest('[data-analysis-packet]'); if (packet) { go('traffic'); return selectPacket(Number(packet.dataset.analysisPacket)); }
  const range = e.target.closest('[data-analysis-range]'); if (range) { $('regSlave').value = range.dataset.slave; $('regFc').value = range.dataset.fc; $('regSearch').value = range.dataset.address; go('registers'); return refreshRegisters(); }
  const slave = e.target.closest('[data-analysis-slave]'); if (slave) return openSlaveTraffic(Number(slave.dataset.analysisSlave));
  const fc = e.target.closest('[data-analysis-fc]'); if (fc) return openFunctionTraffic(Number(fc.dataset.analysisFc));
});
$('page-analysis').addEventListener('keydown', e => { const slave = e.target.closest('[data-analysis-slave]'); if (slave && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSlaveTraffic(Number(slave.dataset.analysisSlave)); } });

window.addEventListener('resize', () => { renderStatus(); if ($('page-analysis').classList.contains('active')) renderAnalysis(); });
setInterval(() => { renderStatus(); if (state.analysis) { renderDashboard(); if ($('page-analysis').classList.contains('active')) renderAnalysis(); if ($('page-settings').classList.contains('active')) renderPortCards(); } }, 3000);

(async function init() {
  try {
    await refreshAll(); await loadConfigIntoForm(); await loadPorts(); connectWs(); go(location.hash.slice(1) || 'dashboard');
  } catch (err) { toast(`Startup error: ${err.message}`, true); connectWs(); }
})();
