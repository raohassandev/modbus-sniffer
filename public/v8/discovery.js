'use strict';

(() => {
  const state = {
    connections: [],
    runs: [],
    selectedRunId: null,
    activeRunId: null,
    refreshTimer: null,
  };
  const $ = (selector, root = document) => root.querySelector(selector);

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
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

  function workspaceHtml() {
    return `
      <section id="workspace-discovery" class="workspace" aria-labelledby="discoveryTitle">
        <div class="workspace-header">
          <div>
            <h1 id="discoveryTitle">Discovery</h1>
            <p>Guarded read-only Unit/Slave and address scanning using the shared v8 Master protocol engine.</p>
          </div>
          <div class="toolbar">
            <button id="discoveryRefresh" class="button secondary" type="button">Refresh</button>
            <button id="discoveryCancel" class="button destructive" type="button" disabled>Cancel active scan</button>
          </div>
        </div>

        <div class="metric-strip">
          <div class="metric-card"><span class="metric-label">Runs</span><strong id="discoveryMetricRuns">0</strong></div>
          <div class="metric-card"><span class="metric-label">Active</span><strong id="discoveryMetricActive">NO</strong></div>
          <div class="metric-card"><span class="metric-label">Progress</span><strong id="discoveryMetricProgress">—</strong></div>
          <div class="metric-card"><span class="metric-label">Confirmed</span><strong id="discoveryMetricConfirmed">0</strong></div>
          <div class="metric-card"><span class="metric-label">Transmit mode</span><strong>READ ONLY</strong></div>
        </div>

        <div class="master-grid">
          <div class="panel master-card">
            <div class="panel-title-row"><div><h2>Unit / Slave scan</h2><p>FC43 identity first, then one read-only fallback probe.</p></div><span class="status-chip safe">READ ONLY</span></div>
            <div class="master-form-grid">
              <label class="field"><span>Connection</span><select id="discoveryUnitConnection"></select></label>
              <label class="field"><span>Start Unit</span><input id="discoveryStartUnit" class="text-input" type="number" min="1" max="255" value="1"></label>
              <label class="field"><span>End Unit</span><input id="discoveryEndUnit" class="text-input" type="number" min="1" max="255" value="10"></label>
              <label class="field"><span>Timeout ms</span><input id="discoveryUnitTimeout" class="text-input" type="number" min="10" max="60000" value="250"></label>
              <label class="field"><span>Inter-request delay ms</span><input id="discoveryUnitDelay" class="text-input" type="number" min="0" max="60000" value="20"></label>
              <label class="field"><span>Fallback read</span><select id="discoveryFallbackFc"><option value="1">FC01</option><option value="2">FC02</option><option value="3" selected>FC03</option><option value="4">FC04</option></select></label>
              <label class="field"><span>Fallback address</span><input id="discoveryFallbackAddress" class="text-input" type="number" min="0" max="65535" value="0"></label>
            </div>
            <div class="serial-discovery-confirmations">
              <label class="check-field"><input id="discoveryUnitMaintenance" type="checkbox"><span>Maintenance window confirmed</span></label>
              <label class="check-field"><input id="discoveryUnitExclusive" type="checkbox"><span>Exclusive serial bus access confirmed</span></label>
            </div>
            <div class="card-actions"><button id="discoveryStartUnits" class="button primary" type="button">Start Unit scan</button></div>
          </div>

          <div class="panel master-card">
            <div class="panel-title-row"><div><h2>Address scan</h2><p>Read-only FC01–FC04 scan with optional adaptive block splitting.</p></div><span class="status-chip safe">NO WRITES</span></div>
            <div class="master-form-grid">
              <label class="field"><span>Connection</span><select id="discoveryAddressConnection"></select></label>
              <label class="field"><span>Unit ID</span><input id="discoveryAddressUnit" class="text-input" type="number" min="1" max="255" value="1"></label>
              <label class="field"><span>Function</span><select id="discoveryAddressFc"><option value="1">FC01</option><option value="2">FC02</option><option value="3" selected>FC03</option><option value="4">FC04</option></select></label>
              <label class="field"><span>Start address</span><input id="discoveryStartAddress" class="text-input" type="number" min="0" max="65535" value="0"></label>
              <label class="field"><span>End address</span><input id="discoveryEndAddress" class="text-input" type="number" min="0" max="65535" value="31"></label>
              <label class="field"><span>Strategy</span><select id="discoveryStrategy"><option value="one-by-one">One by one</option><option value="adaptive" selected>Adaptive blocks</option></select></label>
              <label class="field"><span>Block size</span><input id="discoveryBlockSize" class="text-input" type="number" min="1" max="125" value="16"></label>
              <label class="field"><span>Timeout ms</span><input id="discoveryAddressTimeout" class="text-input" type="number" min="10" max="60000" value="250"></label>
              <label class="field"><span>Delay ms</span><input id="discoveryAddressDelay" class="text-input" type="number" min="0" max="60000" value="20"></label>
            </div>
            <div class="serial-discovery-confirmations">
              <label class="check-field"><input id="discoveryAddressMaintenance" type="checkbox"><span>Maintenance window confirmed</span></label>
              <label class="check-field"><input id="discoveryAddressExclusive" type="checkbox"><span>Exclusive serial bus access confirmed</span></label>
            </div>
            <div class="card-actions"><button id="discoveryStartAddresses" class="button primary" type="button">Start address scan</button></div>
          </div>
        </div>

        <div class="panel table-panel">
          <div class="workspace-header compact-header">
            <div><h2>Scan runs</h2><p>Completed/cancelled runs are retained with the project.</p></div>
            <div class="toolbar"><button id="discoveryExport" class="button secondary" type="button" disabled>Export selected</button></div>
          </div>
          <div class="table-wrap">
            <table class="data-table"><thead><tr><th>Run</th><th>Type</th><th>Connection</th><th>State</th><th>Progress</th><th>Confirmed</th><th>Started</th></tr></thead><tbody id="discoveryRunsBody"></tbody></table>
          </div>
          <div id="discoveryRunsEmpty" class="compact-empty">No discovery runs yet.</div>
        </div>

        <div class="panel table-panel">
          <div class="workspace-header compact-header"><div><h2>Selected results</h2><p id="discoveryResultSubtitle">Select a run to inspect evidence.</p></div></div>
          <div class="table-wrap">
            <table class="data-table"><thead id="discoveryResultsHead"></thead><tbody id="discoveryResultsBody"></tbody></table>
          </div>
          <div id="discoveryResultsEmpty" class="compact-empty">No results selected.</div>
        </div>
      </section>`;
  }

  function installWorkspace() {
    if ($('#workspace-discovery')) return;
    $('.workspace-host')?.insertAdjacentHTML('beforeend', workspaceHtml());
  }

  function isSerial(connectionId) {
    const item = state.connections.find((entry) => entry.profile?.connectionId === connectionId);
    return ['serial-rtu', 'serial-ascii', 'virtual'].includes(item?.profile?.transportKind);
  }

  function syncSerialHints(selectId, maintenanceId, exclusiveId) {
    const serial = isSerial($(selectId)?.value);
    for (const id of [maintenanceId, exclusiveId]) {
      const input = $(id);
      if (input) {
        input.disabled = !serial;
        if (!serial) input.checked = false;
      }
    }
  }

  function renderConnections() {
    const eligible = state.connections.filter((entry) => ['serial-rtu', 'serial-ascii', 'tcp-client', 'virtual'].includes(entry.profile?.transportKind));
    for (const selector of ['#discoveryUnitConnection', '#discoveryAddressConnection']) {
      const select = $(selector);
      if (!select) continue;
      const previous = select.value;
      select.replaceChildren(...eligible.map((entry) => {
        const option = document.createElement('option');
        option.value = entry.profile.connectionId;
        option.textContent = `${entry.profile.name || entry.profile.connectionId} · ${entry.profile.transportKind}`;
        return option;
      }));
      if (eligible.some((entry) => entry.profile.connectionId === previous)) select.value = previous;
    }
    syncSerialHints('#discoveryUnitConnection', '#discoveryUnitMaintenance', '#discoveryUnitExclusive');
    syncSerialHints('#discoveryAddressConnection', '#discoveryAddressMaintenance', '#discoveryAddressExclusive');
  }

  function activeRun() {
    return state.runs.find((run) => ['queued', 'running', 'cancelling'].includes(run.state)) || null;
  }

  function renderMetrics() {
    const active = activeRun();
    $('#discoveryMetricRuns').textContent = String(state.runs.length);
    $('#discoveryMetricActive').textContent = active ? active.state.toUpperCase() : 'NO';
    $('#discoveryMetricProgress').textContent = active ? `${active.progress?.percent ?? 0}%` : '—';
    $('#discoveryMetricConfirmed').textContent = String(active?.stats?.confirmed ?? state.runs.find((run) => run.runId === state.selectedRunId)?.stats?.confirmed ?? 0);
    $('#discoveryCancel').disabled = !active;
    state.activeRunId = active?.runId || null;
  }

  function renderRuns() {
    const body = $('#discoveryRunsBody');
    body.replaceChildren(...state.runs.slice().reverse().map((run) => {
      const row = document.createElement('tr');
      row.dataset.runId = run.runId;
      if (run.runId === state.selectedRunId) row.classList.add('selected');
      const cells = [
        run.runId,
        run.type,
        run.connectionId,
        run.state,
        `${run.progress?.completed ?? 0}/${run.progress?.total ?? 0} (${run.progress?.percent ?? 0}%)`,
        String(run.stats?.confirmed ?? 0),
        run.startedAt ? new Date(run.startedAt).toLocaleString() : '—',
      ];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = value;
        row.appendChild(td);
      }
      row.addEventListener('click', () => {
        state.selectedRunId = run.runId;
        renderRuns();
        renderResults();
      });
      return row;
    }));
    $('#discoveryRunsEmpty').hidden = state.runs.length > 0;
    $('#discoveryExport').disabled = !state.selectedRunId;
  }

  function renderResults() {
    const run = state.runs.find((entry) => entry.runId === state.selectedRunId);
    const head = $('#discoveryResultsHead');
    const body = $('#discoveryResultsBody');
    head.replaceChildren();
    body.replaceChildren();
    if (!run || !(run.results || []).length) {
      $('#discoveryResultsEmpty').hidden = false;
      $('#discoveryResultSubtitle').textContent = run ? `${run.type} · ${run.state}` : 'Select a run to inspect evidence.';
      return;
    }
    $('#discoveryResultsEmpty').hidden = true;
    $('#discoveryResultSubtitle').textContent = `${run.type} · ${run.state} · ${run.results.length} result rows`;
    const headers = run.type === 'unit-scan'
      ? ['Unit', 'Classification', 'Identity / probe', 'RTT', 'Action']
      : ['Address', 'Classification', 'Value', 'Exception', 'Block'];
    const headerRow = document.createElement('tr');
    for (const label of headers) {
      const th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    }
    head.appendChild(headerRow);

    for (const result of run.results) {
      const row = document.createElement('tr');
      if (run.type === 'unit-scan') {
        const identity = (result.identity || []).map((item) => `${item.id}: ${item.text}`).join(' · ') || (result.probe ? `FC${String(result.probe.functionCode).padStart(2, '0')} @ ${result.probe.address}` : '—');
        const values = [String(result.unitId), result.classification || '—', identity, result.rttMs == null ? '—' : `${Math.round(result.rttMs * 10) / 10} ms`];
        for (const value of values) {
          const td = document.createElement('td'); td.textContent = value; row.appendChild(td);
        }
        const action = document.createElement('td');
        if (result.confirmed) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'button secondary'; button.textContent = 'Create poll job';
          button.addEventListener('click', (event) => { event.stopPropagation(); createMasterJob(run, result.unitId).catch((error) => toast(error.message, 'error')); });
          action.appendChild(button);
        } else action.textContent = '—';
        row.appendChild(action);
      } else {
        const values = [String(result.address), result.classification || '—', result.value == null ? '—' : String(result.value), result.exceptionCode == null ? '—' : String(result.exceptionCode), result.blockStart == null ? '—' : `${result.blockStart}+${result.blockQuantity}`];
        for (const value of values) { const td = document.createElement('td'); td.textContent = value; row.appendChild(td); }
      }
      body.appendChild(row);
    }
  }

  async function refresh() {
    const [connections, runs] = await Promise.all([api('/api/v8/connections'), api('/api/v8/discovery/runs')]);
    state.connections = connections.connections || [];
    state.runs = runs.runs || [];
    if (state.selectedRunId && !state.runs.some((run) => run.runId === state.selectedRunId)) state.selectedRunId = null;
    if (!state.selectedRunId && state.runs.length) state.selectedRunId = state.runs[state.runs.length - 1].runId;
    renderConnections(); renderMetrics(); renderRuns(); renderResults();
    scheduleRefresh();
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    if (activeRun()) state.refreshTimer = setTimeout(() => refresh().catch(() => undefined), 350);
  }

  function serialInterlock(connectionId, maintenanceSelector, exclusiveSelector, target) {
    if (!isSerial(connectionId)) return;
    target.maintenanceConfirmed = Boolean($(maintenanceSelector)?.checked);
    target.exclusiveBusConfirmed = Boolean($(exclusiveSelector)?.checked);
  }

  async function startUnitScan() {
    const connectionId = $('#discoveryUnitConnection').value;
    const payload = {
      connectionId,
      startUnit: Number($('#discoveryStartUnit').value),
      endUnit: Number($('#discoveryEndUnit').value),
      timeoutMs: Number($('#discoveryUnitTimeout').value),
      interRequestDelayMs: Number($('#discoveryUnitDelay').value),
      fallbackFunctionCode: Number($('#discoveryFallbackFc').value),
      fallbackAddress: Number($('#discoveryFallbackAddress').value),
    };
    serialInterlock(connectionId, '#discoveryUnitMaintenance', '#discoveryUnitExclusive', payload);
    const response = await api('/api/v8/discovery/unit-scan', { method: 'POST', body: JSON.stringify(payload) });
    state.selectedRunId = response.run.runId;
    toast('Unit scan started');
    await refresh();
  }

  async function startAddressScan() {
    const connectionId = $('#discoveryAddressConnection').value;
    const payload = {
      connectionId,
      unitId: Number($('#discoveryAddressUnit').value),
      functionCode: Number($('#discoveryAddressFc').value),
      startAddress: Number($('#discoveryStartAddress').value),
      endAddress: Number($('#discoveryEndAddress').value),
      strategy: $('#discoveryStrategy').value,
      blockSize: Number($('#discoveryBlockSize').value),
      timeoutMs: Number($('#discoveryAddressTimeout').value),
      interRequestDelayMs: Number($('#discoveryAddressDelay').value),
    };
    serialInterlock(connectionId, '#discoveryAddressMaintenance', '#discoveryAddressExclusive', payload);
    const response = await api('/api/v8/discovery/address-scan', { method: 'POST', body: JSON.stringify(payload) });
    state.selectedRunId = response.run.runId;
    toast('Address scan started');
    await refresh();
  }

  async function cancelActive() {
    const active = activeRun();
    if (!active) return;
    await api(`/api/v8/discovery/runs/${encodeURIComponent(active.runId)}/cancel`, { method: 'POST' });
    toast('Cancellation requested');
    await refresh();
  }

  async function createMasterJob(run, unitId) {
    const jobId = `discovery-${unitId}-${Date.now().toString(36)}`;
    await api(`/api/v8/discovery/runs/${encodeURIComponent(run.runId)}/units/${unitId}/master-job`, {
      method: 'POST',
      body: JSON.stringify({ jobId, label: `Discovered Unit ${unitId}`, functionCode: 3, address: 0, quantity: 1 }),
    });
    toast(`Master poll job ${jobId} created`);
  }

  async function exportSelected() {
    const runId = state.selectedRunId;
    if (!runId) return;
    const payload = await api(`/api/v8/discovery/runs/${encodeURIComponent(runId)}/export`);
    const blob = new Blob([JSON.stringify(payload.export, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${runId}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function showWorkspace(event) {
    event?.stopPropagation();
    document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.workspace === 'discovery'));
    document.querySelectorAll('.workspace').forEach((node) => node.classList.remove('active'));
    $('#workspace-discovery')?.classList.add('active');
    refresh().catch((error) => toast(error.message, 'error'));
  }

  function bind() {
    document.querySelector('.nav-item[data-workspace="discovery"]')?.addEventListener('click', showWorkspace);
    $('#discoveryRefresh')?.addEventListener('click', () => refresh().catch((error) => toast(error.message, 'error')));
    $('#discoveryCancel')?.addEventListener('click', () => cancelActive().catch((error) => toast(error.message, 'error')));
    $('#discoveryStartUnits')?.addEventListener('click', () => startUnitScan().catch((error) => toast(error.message, 'error')));
    $('#discoveryStartAddresses')?.addEventListener('click', () => startAddressScan().catch((error) => toast(error.message, 'error')));
    $('#discoveryExport')?.addEventListener('click', () => exportSelected().catch((error) => toast(error.message, 'error')));
    $('#discoveryUnitConnection')?.addEventListener('change', () => syncSerialHints('#discoveryUnitConnection', '#discoveryUnitMaintenance', '#discoveryUnitExclusive'));
    $('#discoveryAddressConnection')?.addEventListener('change', () => syncSerialHints('#discoveryAddressConnection', '#discoveryAddressMaintenance', '#discoveryAddressExclusive'));
    $('#discoveryAddressFc')?.addEventListener('change', () => {
      const bit = [1, 2].includes(Number($('#discoveryAddressFc').value));
      $('#discoveryBlockSize').max = bit ? '2000' : '125';
    });
  }

  installWorkspace();
  bind();
})();
