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
  analysis: ['Analysis', 'Protocol health, latency, devices and communication behavior'],
  registers: ['Registers', 'Automatically discovered addresses and live raw values'],
  settings: ['Settings', 'Serial interface, capture controls and workstation status']
};

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function n(v, fallback = '—') { return v == null || Number.isNaN(v) ? fallback : v; }
function ms(v) { return v == null ? '—' : `${Number(v).toFixed(Number(v) < 10 ? 1 : 0)} ms`; }
function pct(v) { return `${Number(v || 0).toFixed(Number(v || 0) < 1 ? 3 : 1)}%`; }
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
  const el = $('toast'); el.textContent = message; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = 'toast'; }, 3000);
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
  $(`page-${page}`).classList.add('active');
  $('pageTitle').textContent = pageMeta[page][0]; $('pageSubtitle').textContent = pageMeta[page][1];
  if (location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  if (page === 'traffic') renderTraffic();
  if (page === 'analysis') renderAnalysis();
  if (page === 'registers') refreshRegisters();
  if (page === 'settings') { loadPorts(); loadConfigIntoForm(); }
}

document.querySelectorAll('.nav-item').forEach(x => x.addEventListener('click', () => go(x.dataset.page)));
document.querySelectorAll('[data-go]').forEach(x => x.addEventListener('click', () => go(x.dataset.go)));
window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'dashboard'));

function setRing(id, score) {
  const el = $(id); if (el) el.style.setProperty('--score', Math.max(0, Math.min(100, Number(score || 0))));
}

function renderStatus() {
  if (!state.status) return;
  const s = state.status; const t = s.totals || {}; const c = s.connection || {};
  $('kpiFrames').textContent = Number(t.frames || 0).toLocaleString();
  $('kpiFps').textContent = `${n(t.framesPerSecond, 0)} fps`;
  $('kpiSlaves').textContent = t.slaves || 0;
  $('kpiRegisters').textContent = `${Number(t.registers || 0).toLocaleString()} registers found`;
  $('kpiRtt').textContent = ms(t.avgRttMs);
  $('kpiP95').textContent = `P95 ${ms(t.p95RttMs)}`;
  $('kpiExceptions').textContent = Number(t.exceptions || 0).toLocaleString();
  $('kpiNoise').textContent = `${Number(t.noiseBytes || 0).toLocaleString()} noise bytes`;
  $('kpiBytes').textContent = bytes(t.bytes);
  $('kpiUptime').textContent = `${uptime(s.uptimeMs)} uptime`;

  const pill = $('connectionPill'); pill.className = `connection-pill ${c.status || 'idle'}`;
  $('connectionText').textContent = (c.status || 'idle').replace(/^./, x => x.toUpperCase());
  const cfg = s.config || {};
  $('serialSummary').textContent = c.status === 'demo' ? 'SIMULATOR' : cfg.port ? `${cfg.port} · ${cfg.baudRate} · ${cfg.dataBits}${String(cfg.parity || 'none')[0].toUpperCase()}${cfg.stopBits}` : 'No port selected';
  drawLine($('trafficChart'), s.timeline || []);
}

function renderDashboard() {
  renderStatus();
  const a = state.analysis || {};
  const score = a.healthScore ?? 100;
  $('dashHealthScore').textContent = score; setRing('dashHealthRing', score);
  $('dashExceptionRate').textContent = pct(a.rates?.exceptionRate);
  $('dashUnmatchedRate').textContent = pct(a.rates?.unmatchedResponseRate);
  $('dashNoiseRate').textContent = pct(a.rates?.noiseRatio);

  const slaveRows = (a.slaves || []).slice(0, 10).map(s => `<tr><td><strong>${esc(s.slaveId)}</strong></td><td>${s.frames}</td><td>${s.exceptions}</td><td>${ms(s.avgRttMs)}</td><td>${ago(s.lastSeen)}</td></tr>`).join('');
  $('dashboardSlaves').innerHTML = slaveRows || `<tr><td colspan="5" class="muted">No Modbus slaves detected yet.</td></tr>`;
  const recent = state.transactions.slice(-10).reverse();
  $('dashboardTraffic').innerHTML = recent.map(t => `<tr><td class="mono">${time(t.timestamp, true)}</td><td>${dirBadge(t)}</td><td>${esc(t.slaveId)}</td><td>${esc(t.functionCode)}</td><td>${esc(detail(t))}</td><td>${ms(t.rttMs)}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">Waiting for traffic…</td></tr>`;
}

function trafficFilters() {
  return {
    slave: $('trafficSlave').value.trim(), fc: $('trafficFc').value.trim(),
    direction: $('trafficDirection').value, q: $('trafficSearch').value.trim().toLowerCase()
  };
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
  $('inspectorContent').innerHTML = `
    <div class="inspect-grid">
      <div class="inspect-kv"><span>Direction</span><strong>${esc(t.direction)}</strong></div>
      <div class="inspect-kv"><span>Slave</span><strong>${esc(t.slaveId)}</strong></div>
      <div class="inspect-kv"><span>Function</span><strong>FC${String(t.functionCode).padStart(2, '0')}</strong></div>
      <div class="inspect-kv"><span>RTT</span><strong>${ms(t.rttMs)}</strong></div>
      <div class="inspect-kv"><span>Matched</span><strong>${t.matched ? 'Yes' : 'No'}</strong></div>
      <div class="inspect-kv"><span>Length</span><strong>${t.byteLength} bytes</strong></div>
    </div>
    ${t.exception ? `<div class="inspect-section"><h3>Modbus exception</h3><div class="hex-box">${esc(t.exceptionName)} (${esc(t.exceptionCode)})</div></div>` : ''}
    <div class="inspect-section"><h3>Raw RTU frame</h3><div class="hex-box">${esc(t.rawHex)}</div></div>
    <div class="inspect-section"><h3>Decoded packet</h3><div class="json-box">${esc(decoded)}</div></div>
    <div class="inspect-section"><h3>Matched request context</h3><div class="json-box">${esc(request)}</div></div>`;
}

function healthClass(score) { return score >= 90 ? ['good', 'Healthy capture'] : score >= 70 ? ['warn', 'Review recommended'] : ['bad', 'Capture quality degraded']; }
function renderAnalysis() {
  const a = state.analysis; if (!a) return;
  const score = a.healthScore ?? 100; $('analysisHealthScore').textContent = score; setRing('analysisHealthRing', score);
  const hc = healthClass(score); $('healthLabel').className = `status-label ${hc[0]}`; $('healthLabel').textContent = hc[1];
  $('rttP50').textContent = ms(a.rtt?.p50Ms); $('rttP95').textContent = ms(a.rtt?.p95Ms); $('rttP99').textContent = ms(a.rtt?.p99Ms);
  drawBars($('functionChart'), (a.functions || []).slice(0, 10).map(f => ({ label: `FC${String(f.functionCode).padStart(2, '0')}`, value: f.frames })));

  $('analysisSlaves').innerHTML = (a.slaves || []).map(s => `<tr><td><strong>${s.slaveId}</strong></td><td>${s.frames}</td><td>${s.requests}</td><td>${s.responses}</td><td>${s.exceptions}</td><td>${s.unmatchedResponses}</td><td>${ms(s.avgRttMs)}</td><td>${ms(s.p95RttMs)}</td><td>${ago(s.lastSeen)}</td></tr>`).join('') || `<tr><td colspan="9" class="muted">No slave data yet.</td></tr>`;
  $('analysisFunctions').innerHTML = (a.functions || []).map(f => `<tr><td><strong>FC${String(f.functionCode).padStart(2, '0')}</strong></td><td>${esc(f.name)}</td><td>${f.frames}</td><td>${f.requests}</td><td>${f.responses}</td><td>${f.exceptions}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">No function codes observed yet.</td></tr>`;
  $('analysisRanges').innerHTML = (a.ranges || []).slice(0, 100).map(r => `<tr><td>${r.slaveId}</td><td>${r.functionCode}</td><td class="mono">${r.startAddress}</td><td class="mono">${r.endAddress}</td><td>${r.count}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">No register ranges discovered yet.</td></tr>`;
  renderObservations(a);
}
function renderObservations(a) {
  const obs = [];
  const totals = state.status?.totals || {};
  if (!totals.frames) obs.push(['good', 'Ready for capture', 'No valid frames have been recorded yet. Verify serial settings and wiring when hardware is connected.']);
  else obs.push(['good', `${totals.slaves} slave${totals.slaves === 1 ? '' : 's'} detected`, `${Number(totals.frames).toLocaleString()} valid RTU frames have been decoded.`]);
  if ((a.rates?.noiseRatio || 0) > .1) obs.push(['bad', 'Line noise detected', `${pct(a.rates.noiseRatio)} of captured bytes are not part of valid RTU frames. Check baud, parity, A/B polarity and grounding.`]);
  else if ((totals.noiseBytes || 0) > 0) obs.push(['warn', 'Some undecodable bytes', `${totals.noiseBytes} noise byte(s) were seen; the overall ratio is ${pct(a.rates?.noiseRatio)}.`]);
  if ((a.rates?.exceptionRate || 0) > 1) obs.push(['bad', 'Modbus exceptions are significant', `${pct(a.rates.exceptionRate)} of responses are exceptions. Inspect exception codes and requested addresses.`]);
  else if ((totals.exceptions || 0) > 0) obs.push(['warn', 'Modbus exceptions observed', `${totals.exceptions} exception response(s) are present in the capture.`]);
  if ((a.rates?.unmatchedResponseRate || 0) > 1) obs.push(['warn', 'Unmatched responses', `${pct(a.rates.unmatchedResponseRate)} of responses could not be paired with a request. The capture may have started mid-transaction or frames may be missing.`]);
  if ((a.rtt?.p95Ms || 0) > 500) obs.push(['warn', 'Slow response tail', `P95 response time is ${ms(a.rtt.p95Ms)}. Compare this with the master's timeout and polling interval.`]);
  const writes = (a.functions || []).filter(f => [5, 6, 15, 16, 22, 23].includes(f.functionCode)).reduce((s, f) => s + f.requests, 0);
  if (writes) obs.push(['good', 'Write traffic identified', `${writes} write request(s) were observed. Use the packet inspector to review commanded addresses and values.`]);
  $('analysisObservations').innerHTML = obs.map(([cls, title, body]) => `<div class="observation ${cls}"><i></i><div><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`).join('');
}

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
  const ratio = Math.min(window.devicePixelRatio || 1, 2); const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(300, rect.width); const cssH = Number(canvas.getAttribute('height') || 220);
  canvas.width = Math.floor(cssW * ratio); canvas.height = Math.floor(cssH * ratio); canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); return { ctx, w: cssW, h: cssH };
}
function drawLine(canvas, timeline) {
  const c = setupCanvas(canvas); if (!c) return; const { ctx, w, h } = c; const pad = { l: 34, r: 12, t: 14, b: 25 };
  ctx.clearRect(0, 0, w, h); ctx.font = '9px system-ui'; ctx.fillStyle = '#718195'; ctx.strokeStyle = '#233142'; ctx.lineWidth = 1;
  const points = []; const now = Math.floor(Date.now() / 1000) * 1000; const by = new Map((timeline || []).map(x => [x.timestamp, x.frames]));
  for (let i = 59; i >= 0; i--) points.push({ t: now - i * 1000, v: by.get(now - i * 1000) || 0 });
  const max = Math.max(5, ...points.map(x => x.v));
  for (let i = 0; i <= 4; i++) { const y = pad.t + (h - pad.t - pad.b) * i / 4; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); const label = Math.round(max * (1 - i / 4)); ctx.fillText(String(label), 4, y + 3); }
  const xOf = i => pad.l + i * (w - pad.l - pad.r) / (points.length - 1); const yOf = v => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b); grad.addColorStop(0, 'rgba(54,211,153,.22)'); grad.addColorStop(1, 'rgba(54,211,153,0)');
  ctx.beginPath(); points.forEach((p, i) => { const x = xOf(i), y = yOf(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.lineTo(xOf(points.length - 1), h - pad.b); ctx.lineTo(xOf(0), h - pad.b); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => { const x = xOf(i), y = yOf(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = '#36d399'; ctx.lineWidth = 1.7; ctx.stroke();
  ctx.fillStyle = '#718195'; ctx.fillText('-60s', pad.l, h - 7); ctx.fillText('now', w - pad.r - 20, h - 7);
}
function drawBars(canvas, data) {
  const c = setupCanvas(canvas); if (!c) return; const { ctx, w, h } = c; const pad = { l: 50, r: 20, t: 15, b: 22 };
  ctx.clearRect(0, 0, w, h); const items = data.length ? data : [{ label: 'No data', value: 0 }]; const max = Math.max(1, ...items.map(x => x.value)); const rowH = (h - pad.t - pad.b) / items.length;
  ctx.font = '9px system-ui';
  items.forEach((d, i) => { const y = pad.t + i * rowH + rowH * .2; const bh = rowH * .55; const bw = (w - pad.l - pad.r) * d.value / max; ctx.fillStyle = '#718195'; ctx.fillText(d.label, 7, y + bh * .75); ctx.fillStyle = '#1d2a38'; ctx.fillRect(pad.l, y, w - pad.l - pad.r, bh); ctx.fillStyle = '#5cc8ff'; ctx.fillRect(pad.l, y, bw, bh); ctx.fillStyle = '#aeb9c8'; ctx.fillText(String(d.value), Math.min(w - pad.r - 25, pad.l + bw + 5), y + bh * .75); });
}

async function loadPorts() {
  try {
    state.ports = await api('/api/ports');
    const select = $('serialPort'); const active = state.config.port || state.status?.config?.port || '';
    select.innerHTML = `<option value="">Select port…</option>` + state.ports.map(p => `<option value="${esc(p.path)}" ${p.path === active ? 'selected' : ''}>${esc(p.path)}${p.manufacturer ? ` — ${esc(p.manufacturer)}` : ''}</option>`).join('');
    $('portsList').innerHTML = state.ports.map(p => `<div class="port-card"><strong>${esc(p.path)}</strong><p>${esc(p.manufacturer || 'Serial device')} ${p.vendorId ? `· VID ${esc(p.vendorId)}` : ''} ${p.productId ? `· PID ${esc(p.productId)}` : ''}${p.serialNumber ? `<br>Serial: ${esc(p.serialNumber)}` : ''}</p></div>`).join('') || `<div class="empty-state">No serial ports detected.</div>`;
  } catch (err) { toast(`Cannot list ports: ${err.message}`, true); }
}
async function loadConfigIntoForm() {
  try { state.config = await api('/api/config'); } catch (_) { state.config = state.status?.config || {}; }
  const c = state.config; $('serialBaud').value = c.baudRate || 9600; $('serialParity').value = c.parity || 'none'; $('serialDataBits').value = c.dataBits || 8; $('serialStopBits').value = c.stopBits || 1; $('serialReconnect').value = c.reconnectMs || 2000;
  if (c.port && [...$('serialPort').options].some(o => o.value === c.port)) $('serialPort').value = c.port;
  const disabled = Boolean(c.demo); $('serialForm').querySelectorAll('input,select,button').forEach(el => el.disabled = disabled);
  if (disabled) $('serialFormNote').textContent = 'Serial configuration is disabled while --demo is active. Run npm start for real hardware capture.';
}

async function clearCapture() {
  if (!confirm('Clear all in-memory packet, analysis and register-discovery data?')) return;
  try { await api('/api/capture/clear', { method: 'POST' }); state.transactions = []; state.registers = []; state.selectedId = null; await refreshAll(); toast('Capture cleared.'); } catch (err) { toast(err.message, true); }
}

function scheduleRefresh() {
  if (state.refreshTimer) return;
  state.refreshTimer = setTimeout(async () => {
    state.refreshTimer = null;
    try {
      const [status, analysis] = await Promise.all([api('/api/status'), api('/api/analysis')]); state.status = status; state.analysis = analysis;
      renderDashboard(); if ($('page-analysis').classList.contains('active')) renderAnalysis();
      if ($('page-registers').classList.contains('active')) refreshRegisters();
    } catch (_) {}
  }, 650);
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'; const ws = new WebSocket(`${proto}//${location.host}/ws`); state.ws = ws;
  ws.addEventListener('message', e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'hello') { state.status = msg.payload.status; state.analysis = msg.payload.analysis; renderDashboard(); renderAnalysis(); return; }
    if (msg.type === 'transaction') {
      state.transactions.push(msg.payload); if (state.transactions.length > 2000) state.transactions.splice(0, state.transactions.length - 2000);
      if (!state.paused && $('page-traffic').classList.contains('active')) renderTraffic();
      scheduleRefresh();
    }
    if (msg.type === 'port') { if (state.status) state.status.connection = msg.payload; renderStatus(); }
    if (msg.type === 'clear') { state.transactions = []; state.registers = []; state.selectedId = null; renderTraffic(); renderRegisters(); scheduleRefresh(); }
    if (msg.type === 'config') { state.config = msg.payload; if (state.status) state.status.config = msg.payload; renderStatus(); }
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 1500));
  ws.addEventListener('error', () => ws.close());
}

async function refreshAll() {
  const [status, analysis, transactions, registers] = await Promise.all([
    api('/api/status'), api('/api/analysis'), api('/api/transactions?limit=1000'), api('/api/registers?limit=5000')
  ]);
  state.status = status; state.analysis = analysis; state.transactions = transactions; state.registers = registers;
  renderDashboard(); renderTraffic(); renderAnalysis(); renderRegisters();
}

['trafficSlave', 'trafficFc', 'trafficDirection', 'trafficSearch'].forEach(id => $(id).addEventListener('input', renderTraffic));
['regSlave', 'regFc', 'regSearch'].forEach(id => $(id).addEventListener('input', () => { clearTimeout(refreshRegisters.timer); refreshRegisters.timer = setTimeout(refreshRegisters, 220); }));
$('pauseTraffic').addEventListener('click', () => { state.paused = !state.paused; $('pauseTraffic').textContent = state.paused ? 'Resume' : 'Pause'; $('trafficLiveBadge').textContent = state.paused ? 'PAUSED' : 'LIVE'; if (!state.paused) renderTraffic(); });
$('clearCapture').addEventListener('click', clearCapture); $('settingsClearCapture').addEventListener('click', clearCapture);
$('refreshPorts').addEventListener('click', async () => { await loadPorts(); await loadConfigIntoForm(); toast('Serial ports refreshed.'); });
$('serialForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { port: $('serialPort').value, baudRate: Number($('serialBaud').value), parity: $('serialParity').value, dataBits: Number($('serialDataBits').value), stopBits: Number($('serialStopBits').value), reconnectMs: Number($('serialReconnect').value) };
  try { const result = await api('/api/serial/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); state.config = result.config; toast(`Applying ${body.port} @ ${body.baudRate}…`); scheduleRefresh(); } catch (err) { toast(err.message, true); }
});
window.addEventListener('resize', () => { renderStatus(); renderAnalysis(); });
setInterval(() => { renderStatus(); if (state.analysis) { renderDashboard(); if ($('page-analysis').classList.contains('active')) renderAnalysis(); } }, 3000);

(async function init() {
  try {
    await refreshAll(); await loadPorts(); await loadConfigIntoForm(); connectWs(); go(location.hash.slice(1) || 'dashboard');
  } catch (err) { toast(`Startup error: ${err.message}`, true); connectWs(); }
})();
