'use strict';

(() => {
  const el = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtMs = v => v == null ? '—' : `${Number(v).toFixed(Number(v) < 10 ? 1 : 0)} ms`;
  const fmtPct = (v, d = 1) => `${Number(v || 0).toFixed(d)}%`;
  const ago = v => {
    if (!v) return '—';
    const s = Math.max(0, Math.floor((Date.now() - v) / 1000));
    if (s < 2) return 'now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return new Date(v).toLocaleTimeString([], {hour12:false});
  };

  function injectStyles() {
    if (el('analysis-v3-styles')) return;
    const style = document.createElement('style');
    style.id = 'analysis-v3-styles';
    style.textContent = `
      .analysis-commandbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;padding:12px 14px;border:1px solid var(--line2);border-radius:10px;background:linear-gradient(90deg,rgba(92,200,255,.06),rgba(54,211,153,.025))}
      .analysis-commandbar h2{margin:0 0 4px;font-size:13px}.analysis-commandbar p{margin:0;color:var(--muted);font-size:10px;line-height:1.45}.analysis-command-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
      .analysis-overview-v3{display:grid;grid-template-columns:minmax(360px,1.55fr) repeat(3,minmax(145px,.65fr));gap:12px;margin-bottom:14px}
      .analysis-health-main{padding:18px;display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:center;overflow:hidden;position:relative}.analysis-health-main:after{content:"";position:absolute;width:190px;height:190px;right:-85px;top:-100px;border-radius:50%;background:rgba(54,211,153,.055);pointer-events:none}.analysis-health-copy{position:relative;z-index:1;min-width:0}.analysis-health-copy h2{margin:0 0 5px;font-size:16px}.analysis-verdict{margin:8px 0 0;color:var(--soft);font-size:11px;line-height:1.55}
      .analysis-quality-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:13px}.quality-chip{border:1px solid var(--line2);background:#0d151e;border-radius:7px;padding:8px 9px}.quality-chip span{display:block;color:var(--muted);font-size:8px;text-transform:uppercase;letter-spacing:.45px}.quality-chip strong{display:block;margin-top:4px;font-size:12px}
      .analysis-stat-v3{border:1px solid var(--line2);background:linear-gradient(180deg,#121c28,#0f1721);border-radius:10px;padding:14px 15px;min-width:0;position:relative;overflow:hidden;box-shadow:var(--shadow)}.analysis-stat-v3:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--accent2)}.analysis-stat-v3.warn:before{background:var(--warn)}.analysis-stat-v3.bad:before{background:var(--danger)}.analysis-stat-v3 span{color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.45px}.analysis-stat-v3 strong{display:block;margin-top:8px;font-size:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.analysis-stat-v3 small{display:block;color:#697a8e;font-size:9px;margin-top:5px;line-height:1.4}
      .analysis-summary-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px;margin-bottom:14px}.analysis-summary-tile{border:1px solid var(--line2);background:#0f1822;border-radius:8px;padding:11px 12px}.analysis-summary-tile span{display:block;color:var(--muted);font-size:8px;text-transform:uppercase;letter-spacing:.45px}.analysis-summary-tile strong{display:block;font-size:15px;margin-top:5px}
      .analysis-main-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(330px,.75fr);gap:14px;margin-top:14px}.analysis-panel-body{padding:14px 15px}.latency-head{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-bottom:14px}.latency-kpi{border:1px solid var(--line2);border-radius:7px;padding:8px 9px;background:#0c141d}.latency-kpi span{color:var(--muted);font-size:8px;text-transform:uppercase}.latency-kpi strong{display:block;margin-top:4px;font-size:12px}
      .latency-histogram{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;align-items:end;min-height:180px;padding:10px 3px 2px;border-top:1px solid var(--line2)}.latency-col{height:158px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px}.latency-value{color:#8ea1b6;font-size:8px;min-height:12px}.latency-track{width:100%;height:118px;border-radius:5px 5px 3px 3px;background:#0b121a;border:1px solid #1c2836;display:flex;align-items:flex-end;overflow:hidden}.latency-bar{width:100%;min-height:2px;background:linear-gradient(180deg,var(--accent2),#277da5);border-radius:4px 4px 0 0}.latency-col.slow .latency-bar{background:linear-gradient(180deg,var(--warn),#9b6b12)}.latency-col.critical .latency-bar{background:linear-gradient(180deg,var(--danger),#9f354c)}.latency-label{color:var(--muted);font-size:8px;white-space:nowrap}
      .diagnostic-stack{display:grid;gap:8px}.diagnostic-row{display:grid;grid-template-columns:9px 1fr auto;gap:9px;align-items:center;border:1px solid var(--line2);background:#0d151f;border-radius:7px;padding:10px}.diagnostic-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(54,211,153,.06)}.diagnostic-row.warn .diagnostic-dot{background:var(--warn);box-shadow:0 0 0 4px rgba(251,191,36,.06)}.diagnostic-row.bad .diagnostic-dot{background:var(--danger);box-shadow:0 0 0 4px rgba(251,113,133,.06)}.diagnostic-row span{display:block;color:var(--muted);font-size:8px;margin-top:2px}.diagnostic-row strong{display:block;font-size:10px}.diagnostic-row>b{font-size:11px}
      .device-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.device-health-card{border:1px solid var(--line2);background:#0d151f;border-radius:8px;padding:11px;cursor:pointer;transition:.15s ease;outline:none}.device-health-card:hover,.device-health-card:focus-visible{border-color:#3b5268;transform:translateY(-1px);background:#101b27}.device-health-card.good{box-shadow:inset 2px 0 var(--accent)}.device-health-card.warn{box-shadow:inset 2px 0 var(--warn)}.device-health-card.bad{box-shadow:inset 2px 0 var(--danger)}.device-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.health-mini-badge{font-size:8px;font-weight:800;border-radius:999px;padding:3px 6px;color:var(--accent);background:rgba(54,211,153,.07)}.device-health-card.warn .health-mini-badge{color:var(--warn);background:rgba(251,191,36,.07)}.device-health-card.bad .health-mini-badge{color:var(--danger);background:rgba(251,113,133,.07)}.device-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:10px}.device-metrics span{display:block;color:var(--muted);font-size:7px;text-transform:uppercase}.device-metrics strong{display:block;margin-top:3px;font-size:9px;overflow:hidden;text-overflow:ellipsis}
      .protocol-mix{display:grid;gap:9px}.protocol-row{display:grid;grid-template-columns:44px minmax(100px,1fr) 54px;gap:8px;align-items:center;cursor:pointer;padding:3px 0}.protocol-fc{font:700 9px Consolas,monospace;color:var(--accent2)}.protocol-name{font-size:9px;color:var(--soft);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.protocol-track{height:5px;background:#0b121a;border-radius:999px;overflow:hidden;border:1px solid #1c2836}.protocol-fill{height:100%;background:linear-gradient(90deg,var(--accent2),var(--accent));border-radius:999px}.protocol-count{text-align:right;color:var(--muted);font-size:9px}.analysis-click-row{cursor:pointer}.analysis-click-row:hover{box-shadow:inset 2px 0 var(--accent2)}.slow-rtt{color:var(--warn);font-weight:700}.critical-rtt{color:var(--danger);font-weight:700}.analysis-empty{color:var(--muted);font-size:10px;padding:18px;text-align:center;border:1px dashed var(--line);border-radius:7px}
      .port-card{position:relative;cursor:pointer;transition:.14s ease;padding-right:86px;user-select:none;outline:none}.port-card:hover,.port-card:focus-visible{border-color:#466079;background:#121d29;transform:translateY(-1px)}.port-card.selected-port{border-color:rgba(92,200,255,.5);background:rgba(92,200,255,.055);box-shadow:inset 3px 0 var(--accent2)}.port-card.active-port{border-color:rgba(54,211,153,.42);box-shadow:inset 3px 0 var(--accent)}.port-card-state{position:absolute;right:10px;top:10px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 6px;font-size:7px;font-weight:800;letter-spacing:.45px}.port-card.selected-port .port-card-state{color:var(--accent2);border-color:rgba(92,200,255,.32)}.port-card.active-port .port-card-state{color:var(--accent);border-color:rgba(54,211,153,.32)}.port-click-hint{color:var(--muted);font-size:9px;line-height:1.5;padding:4px 2px 0}
      #functionChart{display:none}
      @media(max-width:1250px){.analysis-overview-v3{grid-template-columns:1.4fr repeat(2,1fr)}.analysis-overview-v3 .analysis-stat-v3:last-child{grid-column:span 1}.analysis-summary-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:900px){.analysis-overview-v3,.analysis-main-grid{grid-template-columns:1fr}.analysis-summary-grid{grid-template-columns:repeat(2,1fr)}.analysis-health-main{grid-template-columns:1fr;text-align:center}.analysis-health-main .health-ring{margin:auto}.analysis-quality-row{grid-template-columns:1fr 1fr 1fr}.device-card-grid{grid-template-columns:1fr}}
      @media(max-width:650px){.analysis-commandbar{align-items:stretch;flex-direction:column}.analysis-command-actions{justify-content:flex-start}.analysis-overview-v3,.analysis-summary-grid{grid-template-columns:1fr 1fr}.analysis-overview-v3 .analysis-health-main{grid-column:1/-1}.analysis-quality-row,.latency-head{grid-template-columns:1fr 1fr}.latency-histogram{overflow-x:auto;grid-template-columns:repeat(7,72px)}}
    `;
    document.head.appendChild(style);
  }

  function upgradeAnalysisMarkup() {
    const page = el('page-analysis');
    if (!page || el('analysisFrames')) return;
    page.innerHTML = `
      <div class="analysis-commandbar">
        <div><h2>Engineering analysis</h2><p>Turn captured Modbus RTU traffic into faults, timing, device health and register-discovery evidence.</p></div>
        <div class="analysis-command-actions">
          <button class="secondary" id="analysisLatestException">Latest exception</button>
          <button class="secondary" id="analysisSlowestPacket">Slowest response</button>
          <button class="secondary" id="analysisShowWrites">Show writes</button>
          <a class="button secondary" href="/api/export/transactions.csv">Export capture</a>
        </div>
      </div>

      <div class="analysis-overview-v3">
        <article class="panel analysis-health-main">
          <div class="health-ring large" id="analysisHealthRing"><span id="analysisHealthScore">100</span><small>/100</small></div>
          <div class="analysis-health-copy">
            <h2 id="analysisVerdictTitle">Waiting for bus traffic</h2>
            <div id="healthLabel" class="status-label good">Healthy capture</div>
            <p class="analysis-verdict" id="analysisVerdictBody">Connect to a live bus or run demo mode to start protocol analysis.</p>
            <div class="analysis-quality-row">
              <div class="quality-chip"><span>Request match</span><strong id="analysisMatchRate">100%</strong></div>
              <div class="quality-chip"><span>Exception-free</span><strong id="analysisExceptionFree">100%</strong></div>
              <div class="quality-chip"><span>Clean line</span><strong id="analysisCleanLine">100%</strong></div>
            </div>
          </div>
        </article>
        <article class="analysis-stat-v3"><span>P50 RTT</span><strong id="rttP50">—</strong><small>Typical response latency</small></article>
        <article class="analysis-stat-v3"><span>P95 RTT</span><strong id="rttP95">—</strong><small>Slow-response boundary</small></article>
        <article class="analysis-stat-v3"><span>P99 RTT</span><strong id="rttP99">—</strong><small>Worst response tail</small></article>
      </div>

      <div class="analysis-summary-grid">
        <div class="analysis-summary-tile"><span>Valid frames</span><strong id="analysisFrames">0</strong></div>
        <div class="analysis-summary-tile"><span>Requests</span><strong id="analysisRequests">0</strong></div>
        <div class="analysis-summary-tile"><span>Responses</span><strong id="analysisResponses">0</strong></div>
        <div class="analysis-summary-tile"><span>Slaves</span><strong id="analysisSlaveCount">0</strong></div>
        <div class="analysis-summary-tile"><span>Registers</span><strong id="analysisRegisterCount">0</strong></div>
        <div class="analysis-summary-tile"><span>Bus activity</span><strong id="analysisFps">0 fps</strong></div>
      </div>

      <div class="analysis-main-grid">
        <article class="panel">
          <div class="panel-head"><div><h2>Response-time distribution</h2><p>Matched request → response samples, grouped by latency</p></div><strong id="analysisRttSamples" class="muted">0 SAMPLES</strong></div>
          <div class="analysis-panel-body">
            <div class="latency-head">
              <div class="latency-kpi"><span>Average</span><strong id="analysisRttAvg">—</strong></div>
              <div class="latency-kpi"><span>Minimum</span><strong id="analysisRttMin">—</strong></div>
              <div class="latency-kpi"><span>Maximum</span><strong id="analysisRttMax">—</strong></div>
              <div class="latency-kpi"><span>P95</span><strong id="analysisRttP95Mirror">—</strong></div>
            </div>
            <div id="latencyHistogram" class="latency-histogram"></div>
          </div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h2>Communication diagnostics</h2><p>Immediate indicators that usually explain unstable Modbus</p></div></div>
          <div id="analysisDiagnostics" class="analysis-panel-body diagnostic-stack"></div>
        </article>
      </div>

      <div class="grid-2">
        <article class="panel">
          <div class="panel-head"><div><h2>Device health</h2><p>Click a slave to open its packet traffic</p></div></div>
          <div id="analysisDeviceCards" class="analysis-panel-body device-card-grid"></div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h2>Protocol mix</h2><p>Function-code activity — click to filter traffic</p></div></div>
          <div id="analysisProtocolMix" class="analysis-panel-body protocol-mix"></div>
          <canvas id="functionChart" height="1"></canvas>
        </article>
      </div>

      <div class="grid-2">
        <article class="panel">
          <div class="panel-head"><div><h2>Analyzer findings</h2><p>Actionable observations from this capture</p></div><span class="live-dot" id="analysisFindingCount">0 FINDINGS</span></div>
          <div id="analysisObservations" class="observation-list"></div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h2>Slowest responses</h2><p>Click a row to inspect the actual RTU packet</p></div></div>
          <div class="table-wrap compact"><table><thead><tr><th>Time</th><th>Slave</th><th>FC</th><th>RTT</th><th>Details</th></tr></thead><tbody id="analysisSlowest"></tbody></table></div>
        </article>
      </div>

      <article class="panel" style="margin-top:14px">
        <div class="panel-head"><div><h2>Slave performance</h2><p>Requests, replies, matching and timing per Modbus slave</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Slave</th><th>Frames</th><th>REQ</th><th>RSP</th><th>Match</th><th>Exceptions</th><th>Unmatched</th><th>Avg RTT</th><th>P95 RTT</th><th>Last seen</th></tr></thead><tbody id="analysisSlaves"></tbody></table></div>
      </article>

      <div class="grid-2">
        <article class="panel"><div class="panel-head"><div><h2>Function codes</h2><p>Click an operation to inspect matching packets</p></div></div><div class="table-wrap compact"><table><thead><tr><th>FC</th><th>Name</th><th>Frames</th><th>REQ</th><th>RSP</th><th>Exceptions</th></tr></thead><tbody id="analysisFunctions"></tbody></table></div></article>
        <article class="panel"><div class="panel-head"><div><h2>Discovered address ranges</h2><p>Click a range to open its register explorer</p></div></div><div class="table-wrap compact"><table><thead><tr><th>Slave</th><th>FC</th><th>Start</th><th>End</th><th>Count</th></tr></thead><tbody id="analysisRanges"></tbody></table></div></article>
      </div>`;
  }

  const totals = () => state.status?.totals || {};
  const rttTransactions = () => state.transactions.filter(t => Number.isFinite(Number(t.rttMs)) && Number(t.rttMs) >= 0);

  function verdict(a, t) {
    if (!Number(t.frames || 0)) return ['Waiting for bus traffic', 'No valid RTU frame has been decoded yet. Confirm the selected COM port and serial format.'];
    if (Number(a.rates?.noiseRatio || 0) > 1) return ['Serial framing needs attention', 'A meaningful part of the byte stream is not forming valid CRC frames. Verify baud, parity, stop bits, A/B polarity and grounding.'];
    if (Number(a.rates?.exceptionRate || 0) > 2) return ['Slave errors are affecting the bus', 'Modbus exception replies are frequent enough to investigate requested addresses, quantities and function codes.'];
    if (Number(a.rates?.unmatchedResponseRate || 0) > 2) return ['Request / response matching is weak', 'Responses are being observed without enough matching request context. Missing frames or marginal line settings are possible.'];
    if (Number(a.rtt?.p95Ms || 0) > 500) return ['Communication works, but the response tail is slow', 'Most traffic is valid, but slow replies may collide with PLC/HMI timeout and polling settings.'];
    return ['Bus communication looks healthy', `${Number(t.slaves || 0)} slave(s), ${Number(t.registers || 0).toLocaleString()} discovered registers and ${Number(t.frames || 0).toLocaleString()} valid frames are currently represented.`];
  }

  function renderHistogram() {
    const samples = rttTransactions().map(t => Number(t.rttMs));
    const defs = [
      ['<10', v => v < 10, ''], ['10–25', v => v >= 10 && v < 25, ''], ['25–50', v => v >= 25 && v < 50, ''],
      ['50–100', v => v >= 50 && v < 100, ''], ['100–250', v => v >= 100 && v < 250, 'slow'], ['250–500', v => v >= 250 && v < 500, 'slow'], ['>500', v => v >= 500, 'critical']
    ];
    const buckets = defs.map(([label, test, cls]) => ({label, cls, n:samples.filter(test).length}));
    const max = Math.max(1, ...buckets.map(b => b.n));
    el('latencyHistogram').innerHTML = buckets.map(b => `<div class="latency-col ${b.cls}"><div class="latency-value">${b.n}</div><div class="latency-track"><div class="latency-bar" style="height:${Math.max(2, b.n / max * 100)}%"></div></div><div class="latency-label">${b.label} ms</div></div>`).join('');
  }

  function renderDiagnostics(a, t) {
    const rows = [
      ['Line / CRC cleanliness', Number(a.rates?.noiseRatio || 0) < .1 ? 'good' : Number(a.rates?.noiseRatio || 0) < 1 ? 'warn' : 'bad', formatPct(a.rates?.noiseRatio, 3), `${Number(t.noiseBytes || 0).toLocaleString()} noise bytes`],
      ['Modbus exception replies', Number(a.rates?.exceptionRate || 0) < .2 ? 'good' : Number(a.rates?.exceptionRate || 0) < 2 ? 'warn' : 'bad', formatPct(a.rates?.exceptionRate, 2), `${Number(t.exceptions || 0).toLocaleString()} exception responses`],
      ['Request / response matching', Number(a.rates?.unmatchedResponseRate || 0) < .2 ? 'good' : Number(a.rates?.unmatchedResponseRate || 0) < 2 ? 'warn' : 'bad', formatPct(a.rates?.unmatchedResponseRate, 2), `${Number(t.unmatchedResponses || 0).toLocaleString()} unmatched replies`],
      ['P95 response latency', Number(a.rtt?.p95Ms || 0) <= 250 ? 'good' : Number(a.rtt?.p95Ms || 0) <= 500 ? 'warn' : 'bad', fmtMs(a.rtt?.p95Ms), 'Compare with master timeout'],
      ['Unknown / vendor frames', Number(t.unknown || 0) === 0 ? 'good' : 'warn', Number(t.unknown || 0).toLocaleString(), 'CRC-valid frames not explicitly decoded']
    ];
    el('analysisDiagnostics').innerHTML = rows.map(([name, cls, value, note]) => `<div class="diagnostic-row ${cls}"><i class="diagnostic-dot"></i><div><strong>${esc(name)}</strong><span>${esc(note)}</span></div><b>${esc(value)}</b></div>`).join('');
  }

  function slaveHealth(s) {
    const resp = Number(s.responses || 0), badMatch = resp ? Number(s.unmatchedResponses || 0) / resp * 100 : 0, ex = resp ? Number(s.exceptions || 0) / resp * 100 : 0, p95 = Number(s.p95RttMs || 0);
    if (ex > 2 || badMatch > 3 || p95 > 1000) return ['bad','CHECK'];
    if (ex > .2 || badMatch > .5 || p95 > 500) return ['warn','WATCH'];
    return ['good','HEALTHY'];
  }

  function renderDevices(slaves) {
    if (!slaves.length) { el('analysisDeviceCards').innerHTML = '<div class="analysis-empty">No Modbus slave has been detected yet.</div>'; return; }
    el('analysisDeviceCards').innerHTML = slaves.map(s => {
      const [cls,label] = slaveHealth(s), resp = Number(s.responses || 0), match = resp ? Math.max(0,(resp-Number(s.unmatchedResponses||0))/resp*100) : 100;
      return `<div class="device-health-card ${cls}" tabindex="0" data-analysis-slave-card="${s.slaveId}"><div class="device-card-head"><strong>Slave ${s.slaveId}</strong><span class="health-mini-badge">${label}</span></div><div class="device-metrics"><div><span>Frames</span><strong>${Number(s.frames||0).toLocaleString()}</strong></div><div><span>Match</span><strong>${fmtPct(match,1)}</strong></div><div><span>P95</span><strong>${fmtMs(s.p95RttMs)}</strong></div><div><span>Exceptions</span><strong>${s.exceptions||0}</strong></div><div><span>Avg RTT</span><strong>${fmtMs(s.avgRttMs)}</strong></div><div><span>Last seen</span><strong>${ago(s.lastSeen)}</strong></div></div></div>`;
    }).join('');
  }

  function renderProtocolMix(functions) {
    if (!functions.length) { el('analysisProtocolMix').innerHTML = '<div class="analysis-empty">No function-code activity yet.</div>'; return; }
    const max = Math.max(1, ...functions.map(f => Number(f.frames || 0)));
    el('analysisProtocolMix').innerHTML = functions.slice(0,12).map(f => `<div class="protocol-row" data-analysis-fc-card="${f.functionCode}"><div class="protocol-fc">FC${String(f.functionCode).padStart(2,'0')}</div><div><div class="protocol-name">${esc(f.name)}</div><div class="protocol-track"><div class="protocol-fill" style="width:${Math.max(2,Number(f.frames||0)/max*100)}%"></div></div></div><div class="protocol-count">${Number(f.frames||0).toLocaleString()}</div></div>`).join('');
  }

  function detailText(t) {
    const d=t.decoded||{}, r=t.request||{};
    if (t.exception) return t.exceptionName || `Exception ${t.exceptionCode}`;
    if (Number.isInteger(d.startAddress)) return `addr ${d.startAddress} · qty ${d.quantity ?? ''}`;
    if (Number.isInteger(r.startAddress)) return `addr ${r.startAddress} · qty ${r.quantity ?? ''}`;
    if (Number.isInteger(d.address)) return `addr ${d.address} · value ${d.value ?? ''}`;
    return t.functionName || `FC${t.functionCode}`;
  }

  function renderSlowest() {
    const rows = rttTransactions().sort((a,b) => Number(b.rttMs)-Number(a.rttMs)).slice(0,12);
    el('analysisSlowest').innerHTML = rows.map(t => `<tr class="analysis-click-row" data-analysis-packet="${t.id}"><td class="mono">${new Date(t.timestamp).toLocaleTimeString([], {hour12:false})}</td><td><strong>${t.slaveId}</strong></td><td>FC${String(t.functionCode).padStart(2,'0')}</td><td class="${Number(t.rttMs)>500?'critical-rtt':Number(t.rttMs)>250?'slow-rtt':''}">${fmtMs(t.rttMs)}</td><td>${esc(detailText(t))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No matched response-time samples yet.</td></tr>';
  }

  function renderTables(a) {
    el('analysisSlaves').innerHTML = (a.slaves||[]).map(s => {
      const resp=Number(s.responses||0), match=resp?Math.max(0,(resp-Number(s.unmatchedResponses||0))/resp*100):100;
      return `<tr class="analysis-click-row" data-analysis-slave="${s.slaveId}"><td><strong>${s.slaveId}</strong></td><td>${s.frames}</td><td>${s.requests}</td><td>${s.responses}</td><td>${fmtPct(match,1)}</td><td>${s.exceptions}</td><td>${s.unmatchedResponses}</td><td>${fmtMs(s.avgRttMs)}</td><td>${fmtMs(s.p95RttMs)}</td><td>${ago(s.lastSeen)}</td></tr>`;
    }).join('') || '<tr><td colspan="10" class="muted">No slave data yet.</td></tr>';
    el('analysisFunctions').innerHTML = (a.functions||[]).map(f => `<tr class="analysis-click-row" data-analysis-fc="${f.functionCode}"><td><strong>FC${String(f.functionCode).padStart(2,'0')}</strong></td><td>${esc(f.name)}</td><td>${f.frames}</td><td>${f.requests}</td><td>${f.responses}</td><td>${f.exceptions}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No function codes observed yet.</td></tr>';
    el('analysisRanges').innerHTML = (a.ranges||[]).slice(0,150).map(r => `<tr class="analysis-click-row" data-analysis-range="1" data-slave="${r.slaveId}" data-fc="${r.functionCode}" data-address="${r.startAddress}"><td>${r.slaveId}</td><td>${r.functionCode}</td><td class="mono"><strong>${r.startAddress}</strong></td><td class="mono">${r.endAddress}</td><td>${r.count}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No register ranges discovered yet.</td></tr>';
  }

  function renderFindings(a) {
    const t=totals(), out=[];
    if (!Number(t.frames||0)) out.push(['good','Ready for capture','Select a serial port and verify baud/parity, or use demo mode to exercise the analyzer.']);
    else out.push(['good','Valid Modbus traffic is being decoded',`${Number(t.frames).toLocaleString()} valid RTU frames across ${Number(t.slaves||0)} slave(s).`]);
    if (Number(a.rates?.noiseRatio||0) > 1) out.push(['bad','High serial noise / wrong framing likely',`${fmtPct(a.rates.noiseRatio,3)} of observed bytes are outside valid CRC frames. Check serial format and RS485 wiring first.`]);
    else if (Number(a.rates?.noiseRatio||0) > .1) out.push(['warn','Serial noise is present',`Noise ratio is ${fmtPct(a.rates.noiseRatio,3)}. Watch whether it grows continuously.`]);
    if (Number(a.rates?.exceptionRate||0) > 2) out.push(['bad','Frequent Modbus exceptions',`${fmtPct(a.rates.exceptionRate,2)} of responses are exception replies. Inspect requested addresses and exception codes.`]);
    else if (Number(t.exceptions||0) > 0) out.push(['warn','Modbus exception replies exist',`${t.exceptions} exception response(s) are present. Use “Latest exception” above to jump to one.`]);
    if (Number(a.rates?.unmatchedResponseRate||0) > 2) out.push(['bad','Many replies do not match requests',`${fmtPct(a.rates.unmatchedResponseRate,2)} of responses could not be paired. Missing frames or marginal serial settings are possible.`]);
    else if (Number(a.rates?.unmatchedResponseRate||0) > .5) out.push(['warn','Some request context is missing',`${fmtPct(a.rates.unmatchedResponseRate,2)} of replies are unmatched. Continue capture and check whether the ratio falls.`]);
    if (Number(a.rtt?.p95Ms||0) > 1000) out.push(['bad','Very slow device response',`P95 is ${fmtMs(a.rtt.p95Ms)}. This may exceed PLC/HMI timeout values.`]);
    else if (Number(a.rtt?.p95Ms||0) > 500) out.push(['warn','Response-time tail is slow',`P95 is ${fmtMs(a.rtt.p95Ms)}. Compare the slowest slave with master timeout and polling interval.`]);
    const writes=(a.functions||[]).filter(f=>[5,6,15,16,22,23].includes(f.functionCode)).reduce((s,f)=>s+Number(f.requests||0),0);
    if (writes) out.push(['good','Write commands identified',`${writes} write request(s) were observed. “Show writes” opens them in Live Traffic.`]);
    if (Number(t.unknown||0)) out.push(['warn','Vendor / unknown function frames present',`${t.unknown} CRC-valid frame(s) use layouts not explicitly decoded; raw HEX remains available.`]);
    el('analysisFindingCount').textContent=`${out.length} FINDING${out.length===1?'':'S'}`;
    el('analysisObservations').innerHTML=out.map(([cls,title,body])=>`<div class="observation ${cls}"><i></i><div><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`).join('');
  }

  function renderEnhancedAnalysis() {
    const a=state.analysis;
    if (!a || !el('analysisFrames')) return;
    const t=totals(), responses=Number(t.responses||0), unmatched=Number(t.unmatchedResponses||0), exceptions=Number(t.exceptions||0);
    const match=responses?Math.max(0,(responses-unmatched)/responses*100):100;
    const exceptionFree=responses?Math.max(0,(responses-exceptions)/responses*100):100;
    el('analysisMatchRate').textContent=fmtPct(match,1); el('analysisExceptionFree').textContent=fmtPct(exceptionFree,1); el('analysisCleanLine').textContent=fmtPct(Math.max(0,100-Number(a.rates?.noiseRatio||0)),2);
    const [title,body]=verdict(a,t); el('analysisVerdictTitle').textContent=title; el('analysisVerdictBody').textContent=body;
    el('analysisFrames').textContent=Number(t.frames||0).toLocaleString(); el('analysisRequests').textContent=Number(t.requests||0).toLocaleString(); el('analysisResponses').textContent=responses.toLocaleString(); el('analysisSlaveCount').textContent=Number(t.slaves||0).toLocaleString(); el('analysisRegisterCount').textContent=Number(t.registers||0).toLocaleString(); el('analysisFps').textContent=`${Number(t.framesPerSecond||0).toFixed(1)} fps`;
    el('analysisRttAvg').textContent=fmtMs(a.rtt?.avgMs); el('analysisRttMin').textContent=fmtMs(a.rtt?.minMs); el('analysisRttMax').textContent=fmtMs(a.rtt?.maxMs); el('analysisRttP95Mirror').textContent=fmtMs(a.rtt?.p95Ms); el('analysisRttSamples').textContent=`${Number(a.rtt?.samples||0).toLocaleString()} SAMPLES`;
    renderHistogram(); renderDiagnostics(a,t); renderDevices(a.slaves||[]); renderProtocolMix(a.functions||[]); renderSlowest(); renderTables(a); renderFindings(a);
  }

  function openSlave(id) { el('trafficSlave').value=id; el('trafficFc').value=''; el('trafficDirection').value=''; el('trafficSearch').value=''; go('traffic'); renderTraffic(); }
  function openFc(fc) { el('trafficSlave').value=''; el('trafficFc').value=fc; el('trafficDirection').value=''; el('trafficSearch').value=''; go('traffic'); renderTraffic(); }
  function openRange(slave,fc,address) { el('regSlave').value=slave; el('regFc').value=fc; el('regSearch').value=address; go('registers'); refreshRegisters(); }
  function openPacket(id) { go('traffic'); selectPacket(id); }

  function decoratePorts() {
    const list=el('portsList'), select=el('serialPort');
    if (!list || !select) return;
    const selected=select.value, active=state.status?.config?.port || state.config?.port || '', open=['open','demo'].includes(state.status?.connection?.status);
    list.querySelectorAll('.port-card').forEach(card => {
      const strong=card.querySelector('strong'); if (!strong) return;
      const path=strong.textContent.trim(); card.dataset.portPath=path; card.tabIndex=0; card.setAttribute('role','button'); card.setAttribute('aria-label',`Select serial port ${path}`);
      let badge=card.querySelector('.port-card-state'); if (!badge){badge=document.createElement('span');badge.className='port-card-state';card.appendChild(badge);}
      const sel=path===selected, act=path===active&&open; card.classList.toggle('selected-port',sel); card.classList.toggle('active-port',act); badge.textContent=act?'ACTIVE':sel?'SELECTED':'SELECT';
    });
    if (list.querySelector('.port-card') && !list.querySelector('.port-click-hint')) { const hint=document.createElement('div'); hint.className='port-click-hint'; hint.textContent='Click a port card to select it. Then verify baud/parity and press Apply & reconnect.'; list.appendChild(hint); }
  }

  function choosePort(path) {
    const select=el('serialPort'); if (!select || state.config?.demo) return;
    if (![...select.options].some(o=>o.value===path)) return;
    select.value=path; decoratePorts();
    if (el('serialFormNote')) el('serialFormNote').textContent=`${path} selected. Verify baud, parity, data bits and stop bits, then click Apply & reconnect.`;
    toast(`${path} selected.`);
  }

  function bindEvents() {
    const page=el('page-analysis');
    page.addEventListener('click', e => {
      const d=e.target.closest('[data-analysis-slave-card]'); if(d) return openSlave(Number(d.dataset.analysisSlaveCard));
      const p=e.target.closest('[data-analysis-fc-card]'); if(p) return openFc(Number(p.dataset.analysisFcCard));
      const s=e.target.closest('[data-analysis-slave]'); if(s) return openSlave(Number(s.dataset.analysisSlave));
      const f=e.target.closest('[data-analysis-fc]'); if(f) return openFc(Number(f.dataset.analysisFc));
      const r=e.target.closest('[data-analysis-range]'); if(r) return openRange(Number(r.dataset.slave),Number(r.dataset.fc),Number(r.dataset.address));
      const t=e.target.closest('[data-analysis-packet]'); if(t) return openPacket(Number(t.dataset.analysisPacket));
    });
    page.addEventListener('keydown', e => { const d=e.target.closest('[data-analysis-slave-card]'); if(d && (e.key==='Enter'||e.key===' ')){e.preventDefault();openSlave(Number(d.dataset.analysisSlaveCard));} });
    el('analysisLatestException').addEventListener('click',()=>{const t=[...state.transactions].reverse().find(x=>x.exception);if(!t)return toast('No Modbus exception is present in this capture.');openPacket(t.id);});
    el('analysisSlowestPacket').addEventListener('click',()=>{const t=rttTransactions().sort((a,b)=>Number(b.rttMs)-Number(a.rttMs))[0];if(!t)return toast('No matched response-time sample is available yet.');openPacket(t.id);});
    el('analysisShowWrites').addEventListener('click',()=>{el('trafficSlave').value='';el('trafficFc').value='';el('trafficDirection').value='REQ';el('trafficSearch').value='write';go('traffic');renderTraffic();});
    const ports=el('portsList');
    ports.addEventListener('click',e=>{const c=e.target.closest('.port-card');if(c?.dataset.portPath)choosePort(c.dataset.portPath);});
    ports.addEventListener('keydown',e=>{const c=e.target.closest('.port-card');if(c?.dataset.portPath&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choosePort(c.dataset.portPath);}});
    el('serialPort').addEventListener('change',decoratePorts);
    new MutationObserver(decoratePorts).observe(ports,{childList:true,subtree:true});
  }

  injectStyles();
  upgradeAnalysisMarkup();
  const baseRenderAnalysis=renderAnalysis;
  renderAnalysis=function(){baseRenderAnalysis();renderEnhancedAnalysis();};
  bindEvents();
  setTimeout(()=>{decoratePorts();renderEnhancedAnalysis();},0);
  setInterval(()=>{decoratePorts();if(el('page-analysis')?.classList.contains('active'))renderEnhancedAnalysis();},1500);
})();
