'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { snapshot: null, sources: [], selectedChart: null, selectedSeries: null, selectedTag: null };

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error?.message || `Request failed (${response.status})`);
      error.code = payload?.error?.code || `HTTP_${response.status}`;
      throw error;
    }
    return payload;
  }

  function toast(message, kind = 'success') {
    const host = $('#toastHost');
    if (!host) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    host.appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function install() {
    if ($('#workspace-charts')) return;
    $('.workspace-host')?.insertAdjacentHTML('beforeend', `
      <section id="workspace-charts" class="workspace" aria-labelledby="chartsTitle">
        <div class="workspace-header"><div><h1 id="chartsTitle">Charts & Logger</h1><p>Live engineering trends and bounded JSONL logging sourced from Register Lab points.</p></div><div class="toolbar"><button id="historyRefresh" class="button secondary" type="button">Refresh</button></div></div>
        <div class="metric-strip"><div class="metric-card"><span class="metric-label">Charts</span><strong id="historyChartCount">0</strong></div><div class="metric-card"><span class="metric-label">Logger streams</span><strong id="historyLoggerCount">0</strong></div><div class="metric-card"><span class="metric-label">Samples written</span><strong id="historyWritten">0</strong></div><div class="metric-card"><span class="metric-label">SQLite</span><strong id="historySqlite">—</strong></div></div>
        <div class="history-grid">
          <div class="panel history-card"><h2>New live chart</h2><label class="field"><span>Register source</span><select id="historyChartSource"></select></label><label class="field"><span>Chart title</span><input id="historyChartTitle" class="text-input" value="Live trend"></label><button id="historyAddChart" class="button primary" type="button">Add chart</button></div>
          <div class="panel history-card"><h2>New logger stream</h2><label class="field"><span>Register source</span><select id="historyLoggerSource"></select></label><label class="field"><span>Mode</span><select id="historyLoggerMode"><option value="fixed">Fixed interval</option><option value="every">Every sample</option><option value="change-only">Change only</option></select></label><label class="field"><span>Interval ms</span><input id="historyLoggerInterval" class="text-input" type="number" min="1" value="1000"></label><button id="historyAddLogger" class="button primary" type="button">Add logger</button></div>
        </div>
        <div class="panel history-card"><div class="panel-title-row"><div><h2>Charts</h2><p class="history-subtitle">Series are decimated by the backend for bounded rendering.</p></div></div><div id="historyCharts" class="history-chart-list"></div></div>
        <div class="panel table-panel"><div class="panel-title-row"><div><h2>Logger streams</h2><p class="history-subtitle">Rotated JSONL storage with retention and optional SQLite historian.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Stream</th><th>Source</th><th>Mode</th><th>Interval</th><th>Historian</th><th></th></tr></thead><tbody id="historyLoggerBody"></tbody></table></div></div>
      </section>
      <section id="workspace-historian" class="workspace" aria-labelledby="historianTitle">
        <div class="workspace-header"><div><h1 id="historianTitle">Historian</h1><p>Indexed time-range samples backed by SQLite when supported by the runtime.</p></div><div class="toolbar"><button id="historianRefresh" class="button secondary" type="button">Refresh</button></div></div>
        <div class="panel history-card"><div class="history-query"><label class="field"><span>Historian tag</span><select id="historianTag"></select></label><label class="field"><span>Limit</span><input id="historianLimit" class="text-input" type="number" min="1" max="100000" value="1000"></label><button id="historianQuery" class="button primary" type="button">Query</button></div><div id="historianMessage" class="inline-message"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Timestamp</th><th>Value</th><th>Quality</th></tr></thead><tbody id="historianBody"></tbody></table></div></div>
      </section>`);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/v8/history-workspace.css'; document.head.appendChild(css);
  }

  function sourceLabel(point) {
    const name = point.definition?.name || `${point.area} ${point.address}`;
    const value = point.engineering?.available ? `${point.engineering.display}${point.engineering.unit ? ` ${point.engineering.unit}` : ''}` : String(point.rawValue);
    return `${name} · Unit ${point.unitId} · ${value}`;
  }

  function fillSources() {
    for (const selector of ['#historyChartSource', '#historyLoggerSource']) {
      const select = $(selector); if (!select) continue;
      const previous = select.value;
      select.replaceChildren(...state.sources.map((point) => { const option = document.createElement('option'); option.value = point.sourceKey; option.textContent = sourceLabel(point); return option; }));
      if (state.sources.some((point) => point.sourceKey === previous)) select.value = previous;
    }
  }

  function render() {
    const snap = state.snapshot;
    if (!snap) return;
    $('#historyChartCount').textContent = String(snap.charts?.length || 0);
    $('#historyLoggerCount').textContent = String(snap.loggerProfiles?.length || 0);
    $('#historyWritten').textContent = String(snap.logger?.stats?.written || 0);
    $('#historySqlite').textContent = snap.sqliteAvailable ? 'READY' : 'UNAVAILABLE';

    const chartsHost = $('#historyCharts');
    chartsHost.replaceChildren(...(snap.charts || []).map((chart) => {
      const card = document.createElement('div'); card.className = 'history-chart'; card.dataset.chartId = chart.documentId;
      const head = document.createElement('div'); head.className = 'panel-title-row';
      const title = document.createElement('div'); title.innerHTML = `<strong>${escapeHtml(chart.title || chart.documentId)}</strong><div class="row-subtitle">${chart.series?.length || 0} series · ${chart.live?.series?.reduce((sum, s) => sum + (s.pointCount || 0), 0) || 0} samples</div>`;
      const actions = document.createElement('div'); actions.className = 'row-actions'; actions.innerHTML = `<button class="button secondary small" data-history-view="${escapeAttr(chart.documentId)}">View</button><button class="button destructive small" data-history-delete-chart="${escapeAttr(chart.documentId)}">Delete</button>`;
      head.append(title, actions);
      const plot = document.createElement('div'); plot.className = 'history-plot'; plot.dataset.plot = chart.documentId; plot.textContent = 'Select View to load recent samples.';
      card.append(head, plot); return card;
    }));
    if (!(snap.charts || []).length) chartsHost.innerHTML = '<div class="empty-state"><p>No charts yet. Select a live Register Lab source above.</p></div>';

    const loggerBody = $('#historyLoggerBody');
    loggerBody.replaceChildren(...(snap.loggerProfiles || []).map((profile) => {
      const tr = document.createElement('tr');
      for (const value of [profile.label || profile.streamId, profile.sourceKey, profile.mode, `${profile.intervalMs} ms`, profile.historian ? 'On' : 'Off']) { const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td); }
      const actions = document.createElement('td'); actions.innerHTML = `<button class="button destructive small" data-history-delete-logger="${escapeAttr(profile.streamId)}">Delete</button>`; tr.appendChild(actions); return tr;
    }));

    const tags = snap.historian?.available === false ? [] : (snap.loggerProfiles || []).filter((p) => p.historian);
    const tagSelect = $('#historianTag'); const previous = tagSelect.value;
    tagSelect.replaceChildren(...tags.map((tag) => { const option = document.createElement('option'); option.value = tag.streamId; option.textContent = tag.label || tag.streamId; return option; }));
    if (tags.some((tag) => tag.streamId === previous)) tagSelect.value = previous;
    $('#historianMessage').textContent = snap.sqliteAvailable ? `${tags.length} historian tag(s)` : 'SQLite historian requires a Node runtime with node:sqlite support; JSONL logging remains available.';
  }

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function escapeAttr(value) { return escapeHtml(value); }

  async function refresh() {
    const [historyResult, sourcesResult] = await Promise.all([api('/api/v8/history'), api('/api/v8/register-lab?limit=5000')]);
    state.snapshot = historyResult; state.sources = sourcesResult.points || []; fillSources(); render();
  }

  async function addChart() {
    const sourceKey = $('#historyChartSource').value; if (!sourceKey) return toast('No Register Lab source is available yet.', 'error');
    const point = state.sources.find((item) => item.sourceKey === sourceKey); const id = `chart-${Date.now().toString(36)}`;
    await api('/api/v8/history/charts', { method: 'POST', body: JSON.stringify({ documentId: id, title: $('#historyChartTitle').value.trim() || 'Live trend', maxPoints: 10000, series: [{ seriesId: 'value', sourceKey, label: point?.definition?.name || `${point?.area || 'register'} ${point?.address ?? ''}`, unit: point?.engineering?.unit || point?.definition?.unit || null }] }) });
    toast('Chart added'); await refresh();
  }

  async function addLogger() {
    const sourceKey = $('#historyLoggerSource').value; if (!sourceKey) return toast('No Register Lab source is available yet.', 'error');
    const point = state.sources.find((item) => item.sourceKey === sourceKey); const id = `log-${Date.now().toString(36)}`;
    await api('/api/v8/history/loggers', { method: 'POST', body: JSON.stringify({ streamId: id, sourceKey, label: point?.definition?.name || `${point?.area || 'register'} ${point?.address ?? ''}`, unit: point?.engineering?.unit || point?.definition?.unit || null, mode: $('#historyLoggerMode').value, intervalMs: Number($('#historyLoggerInterval').value) || 1000, historian: true }) });
    toast('Logger stream added'); await refresh();
  }

  function svgFor(points) {
    if (!points.length) return '<div class="history-plot-empty">Waiting for samples…</div>';
    const width = 900, height = 220, pad = 28; const values = points.map((p) => Number(p.value)).filter(Number.isFinite);
    if (!values.length) return '<div class="history-plot-empty">No numeric samples.</div>';
    let min = Math.min(...values), max = Math.max(...values); if (min === max) { min -= 1; max += 1; }
    const first = points[0].timestamp, last = points.at(-1).timestamp; const span = Math.max(1, last - first);
    const path = points.filter((p) => Number.isFinite(Number(p.value))).map((p) => { const x = pad + ((p.timestamp - first) / span) * (width - pad * 2); const y = height - pad - ((Number(p.value) - min) / (max - min)) * (height - pad * 2); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Live chart"><polyline points="${path}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="6" y="18">${max.toFixed(3)}</text><text x="6" y="${height - 8}">${min.toFixed(3)}</text></svg>`;
  }

  async function viewChart(documentId) {
    const chart = state.snapshot?.charts?.find((item) => item.documentId === documentId); if (!chart?.series?.length) return;
    const series = chart.series[0]; const result = await api(`/api/v8/history/charts/${encodeURIComponent(documentId)}/series/${encodeURIComponent(series.seriesId)}?maxPoints=600`);
    const host = $(`[data-plot="${CSS.escape(documentId)}"]`); if (host) host.innerHTML = svgFor(result.points || []);
  }

  async function queryHistorian() {
    const tag = $('#historianTag').value; if (!tag) return;
    try {
      const result = await api(`/api/v8/history/historian/${encodeURIComponent(tag)}?limit=${encodeURIComponent($('#historianLimit').value || '1000')}`);
      $('#historianBody').replaceChildren(...(result.samples || []).slice().reverse().map((sample) => { const tr = document.createElement('tr'); for (const value of [new Date(sample.timestamp).toLocaleString(), sample.value, sample.quality]) { const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td); } return tr; }));
      $('#historianMessage').textContent = `${result.samples?.length || 0} sample(s)`;
    } catch (error) { $('#historianMessage').textContent = error.message; toast(error.message, 'error'); }
  }

  install();
  $('#historyRefresh')?.addEventListener('click', () => refresh().catch((e) => toast(e.message, 'error')));
  $('#historianRefresh')?.addEventListener('click', () => refresh().catch((e) => toast(e.message, 'error')));
  $('#historyAddChart')?.addEventListener('click', () => addChart().catch((e) => toast(e.message, 'error')));
  $('#historyAddLogger')?.addEventListener('click', () => addLogger().catch((e) => toast(e.message, 'error')));
  $('#historianQuery')?.addEventListener('click', queryHistorian);
  $('#historyCharts')?.addEventListener('click', (event) => {
    const view = event.target.closest('[data-history-view]'); if (view) return viewChart(view.dataset.historyView).catch((e) => toast(e.message, 'error'));
    const del = event.target.closest('[data-history-delete-chart]'); if (del) api(`/api/v8/history/charts/${encodeURIComponent(del.dataset.historyDeleteChart)}`, { method: 'DELETE' }).then(refresh).catch((e) => toast(e.message, 'error'));
  });
  $('#historyLoggerBody')?.addEventListener('click', (event) => { const del = event.target.closest('[data-history-delete-logger]'); if (del) api(`/api/v8/history/loggers/${encodeURIComponent(del.dataset.historyDeleteLogger)}`, { method: 'DELETE' }).then(refresh).catch((e) => toast(e.message, 'error')); });
  document.querySelector('#navList')?.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-workspace]'); if (!nav || !['charts', 'historian'].includes(nav.dataset.workspace)) return;
    queueMicrotask(() => { document.querySelectorAll('.workspace').forEach((node) => node.classList.remove('active')); $(`#workspace-${nav.dataset.workspace}`)?.classList.add('active'); refresh().catch((e) => toast(e.message, 'error')); });
  });
  refresh().catch(() => undefined);
})();
