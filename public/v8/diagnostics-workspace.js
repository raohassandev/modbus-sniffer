'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { snapshot: null, connectionId: null };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error?.message || `Request failed (${response.status})`);
      error.code = payload?.error?.code || `HTTP_${response.status}`;
      error.details = payload?.error?.details || null;
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
    setTimeout(() => node.remove(), 4000);
  }

  function workspaceHtml() {
    return `
      <section id="workspace-testCenter" class="workspace" aria-labelledby="testCenterTitle">
        <div class="workspace-header">
          <div><h1 id="testCenterTitle">Test Center</h1><p>Raw-frame diagnostics and deterministic recipes with explicit LAB/write interlocks and audit evidence.</p></div>
          <div class="toolbar"><button id="tcRefresh" class="button secondary" type="button">Refresh</button></div>
        </div>

        <div class="metric-strip" aria-live="polite">
          <div class="metric-card"><span class="metric-label">Session</span><strong id="tcMetricSession">CLOSED</strong></div>
          <div class="metric-card"><span class="metric-label">LAB raw</span><strong id="tcMetricLab">OFF</strong></div>
          <div class="metric-card"><span class="metric-label">Writes</span><strong id="tcMetricWrites">LOCKED</strong></div>
          <div class="metric-card"><span class="metric-label">Recipe</span><strong id="tcMetricRecipe">IDLE</strong></div>
          <div class="metric-card"><span class="metric-label">Audit</span><strong id="tcMetricAudit">0</strong></div>
        </div>

        <div class="tc-grid">
          <div class="tc-stack">
            <div class="panel tc-card">
              <div class="panel-title-row"><div><h2>Test session</h2><p class="tc-subtitle">Test Center takes exclusive TEST ownership. Opening never enables writes or LAB raw traffic.</p></div><span id="tcSessionChip" class="status-chip safe">CLOSED</span></div>
              <label class="field"><span>Connection</span><select id="tcConnection"></select></label>
              <div id="tcConnectionInfo" class="tc-info">Select an eligible Serial RTU/ASCII, TCP client or virtual profile.</div>
              <div class="tc-actions"><button id="tcOpen" class="button primary" type="button">Open test session</button><button id="tcDisconnect" class="button secondary" type="button" disabled>Disconnect</button></div>
            </div>

            <div class="panel tc-card">
              <div class="panel-title-row"><div><h2>Raw Frame Studio</h2><p class="tc-subtitle">Validated reads are normal test traffic. Writes require the write latch. Malformed/vendor raw frames additionally require LAB arming.</p></div></div>
              <label class="field"><span>HEX frame</span><textarea id="tcRawHex" class="text-input tc-hex" spellcheck="false" placeholder="01 03 00 00 00 02"></textarea></label>
              <div class="tc-inline-grid">
                <label class="check-field"><input id="tcAutoChecksum" type="checkbox" checked><span>Auto CRC/LRC</span></label>
                <label class="check-field"><input id="tcExpectResponse" type="checkbox" checked><span>Expect response</span></label>
                <label class="field"><span>Timeout ms</span><input id="tcTimeout" class="text-input" type="number" min="1" max="60000" value="1000"></label>
              </div>
              <div class="tc-confirm-grid">
                <label class="check-field warning-check"><input id="tcConfirmWrite" type="checkbox"><span>Confirm this send if it is a write</span></label>
                <label class="check-field danger-check"><input id="tcConfirmRaw" type="checkbox"><span>Confirm this send if it is raw/LAB traffic</span></label>
              </div>
              <div class="tc-actions"><button id="tcSend" class="button primary" type="button" disabled>Send once</button><label class="field compact-field"><span>Count</span><input id="tcRepeatCount" class="text-input" type="number" min="1" max="10000" value="2"></label><label class="field compact-field"><span>Gap ms</span><input id="tcRepeatGap" class="text-input" type="number" min="0" value="100"></label><button id="tcRepeat" class="button secondary" type="button" disabled>Repeat</button></div>
              <pre id="tcRawResult" class="code-block tc-result">No frame sent.</pre>
            </div>

            <div class="panel tc-card danger-zone">
              <div class="panel-title-row"><div><h2>Safety interlocks</h2><p class="tc-subtitle">Both latches are OFF by default, are not persisted, and are locked on disconnect/reopen.</p></div></div>
              <div class="tc-safety-row">
                <div><strong>LAB raw transmission</strong><p>Required only for malformed/vendor/manual raw frames.</p></div>
                <span id="tcLabChip" class="status-chip safe">LAB OFF</span>
              </div>
              <label class="check-field danger-check"><input id="tcLabConfirm" type="checkbox"><span>I understand this enables LAB/raw transmission on the selected test connection</span></label>
              <div class="tc-actions"><button id="tcArmLab" class="button destructive" type="button" disabled>Arm LAB for 10 min</button><button id="tcDisarmLab" class="button secondary" type="button" disabled>Disarm LAB</button></div>
              <hr class="tc-divider">
              <div class="tc-safety-row">
                <div><strong>Validated Modbus writes</strong><p>Required before FC05/06/15/16/21/22/23 transmission.</p></div>
                <span id="tcWriteChip" class="status-chip safe">LOCKED</span>
              </div>
              <label class="check-field warning-check"><input id="tcWriteConfirm" type="checkbox"><span>I explicitly enable validated writes on this test connection</span></label>
              <div class="tc-actions"><button id="tcArmWrites" class="button destructive" type="button" disabled>Enable writes for 30 sec</button><button id="tcLockWrites" class="button secondary" type="button" disabled>Lock now</button></div>
            </div>
          </div>

          <div class="tc-stack">
            <div class="panel tc-card">
              <div class="panel-title-row"><div><h2>Recipe Engine</h2><p class="tc-subtitle">JSON recipe runner with pause/resume/stop and per-step evidence. The default sample is read-only.</p></div></div>
              <textarea id="tcRecipe" class="text-input tc-recipe" spellcheck="false"></textarea>
              <div class="tc-actions"><button id="tcRunRecipe" class="button primary" type="button" disabled>Run recipe</button><button id="tcPauseRecipe" class="button secondary" type="button">Pause</button><button id="tcResumeRecipe" class="button secondary" type="button">Resume</button><button id="tcStopRecipe" class="button destructive" type="button">Stop</button></div>
              <pre id="tcRecipeResult" class="code-block tc-result">No recipe run.</pre>
            </div>

            <div class="panel tc-card">
              <div class="panel-title-row"><div><h2>Transmission audit</h2><p class="tc-subtitle">Exact raw-frame and safe-write evidence for the selected open test session.</p></div><button id="tcRefreshAudit" class="button secondary small" type="button" disabled>Refresh audit</button></div>
              <div class="table-wrap tc-audit-wrap"><table class="data-table"><thead><tr><th>Kind</th><th>Result</th><th>Intent/FC</th><th>Request HEX</th><th>Response HEX</th></tr></thead><tbody id="tcAuditBody"></tbody></table></div>
              <div id="tcAuditEmpty" class="empty-state"><p>No transmission evidence yet.</p></div>
            </div>
          </div>
        </div>
      </section>`;
  }

  function install() {
    if ($('#workspace-testCenter')) return;
    $('.workspace-host')?.insertAdjacentHTML('beforeend', workspaceHtml());
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/v8/test-center.css';
    document.head.appendChild(css);
    $('#tcRecipe').value = JSON.stringify({
      schemaVersion: 1,
      id: 'read-smoke',
      name: 'Read-only smoke test',
      steps: [
        { id: 'connect', type: 'connect' },
        { id: 'read', type: 'read', unitId: 1, functionCode: 3, address: 0, quantity: 2, saveAs: 'values' },
        { id: 'disconnect', type: 'disconnect' },
      ],
    }, null, 2);
  }

  function connection() {
    return state.snapshot?.connections?.find((item) => item.connectionId === state.connectionId) || null;
  }

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function render() {
    const select = $('#tcConnection');
    const eligible = (state.snapshot?.connections || []).filter((item) => item.eligible);
    const previous = state.connectionId;
    select.replaceChildren(...eligible.map((item) => {
      const option = document.createElement('option');
      option.value = item.connectionId;
      option.textContent = `${item.name || item.connectionId} · ${item.transportKind}`;
      return option;
    }));
    if (eligible.some((item) => item.connectionId === previous)) select.value = previous;
    else state.connectionId = select.value || null;

    const item = connection();
    const session = item?.session || null;
    const open = Boolean(session);
    const lab = Boolean(session?.raw?.labArmed);
    const writes = session?.writes?.writeLock === 'ENABLED' || session?.raw?.writeLock === 'ENABLED';
    const recipeState = String(state.snapshot?.recipe?.state || (state.snapshot?.recipe?.running ? 'running' : 'idle')).toUpperCase();
    const auditCount = (session?.rawAuditEntries || 0) + (session?.writeAuditEntries || 0);

    $('#tcConnectionInfo').textContent = item ? `${item.transportKind} · ${item.endpoint || 'configured endpoint'} · runtime ${item.runtime?.state || 'defined'} · owner ${item.runtime?.owner?.ownerMode || 'none'}` : 'No eligible connection profile. Create one in Connection Center.';
    $('#tcMetricSession').textContent = open ? 'OPEN' : 'CLOSED';
    $('#tcMetricLab').textContent = lab ? 'ARMED' : 'OFF';
    $('#tcMetricWrites').textContent = writes ? 'ENABLED' : 'LOCKED';
    $('#tcMetricRecipe').textContent = recipeState;
    $('#tcMetricAudit').textContent = String(auditCount);
    $('#tcSessionChip').textContent = open ? 'TEST OPEN' : 'CLOSED';
    $('#tcSessionChip').className = `status-chip ${open ? 'active' : 'safe'}`;
    $('#tcLabChip').textContent = lab ? 'LAB ARMED' : 'LAB OFF';
    $('#tcLabChip').className = `status-chip ${lab ? 'danger' : 'safe'}`;
    $('#tcWriteChip').textContent = writes ? 'WRITES ENABLED' : 'LOCKED';
    $('#tcWriteChip').className = `status-chip ${writes ? 'danger' : 'safe'}`;

    $('#tcOpen').disabled = !item || open;
    $('#tcDisconnect').disabled = !open;
    $('#tcSend').disabled = !open;
    $('#tcRepeat').disabled = !open;
    $('#tcRunRecipe').disabled = !item;
    $('#tcRefreshAudit').disabled = !open;
    $('#tcArmLab').disabled = !open || lab;
    $('#tcDisarmLab').disabled = !open || !lab;
    $('#tcArmWrites').disabled = !open || writes;
    $('#tcLockWrites').disabled = !open || !writes;
  }

  async function refresh({ quiet = false } = {}) {
    try {
      const payload = await api('/api/v8/test-center');
      state.snapshot = payload;
      if (!state.connectionId) state.connectionId = payload.connections?.find((item) => item.eligible)?.connectionId || null;
      render();
      if (!quiet) toast('Test Center refreshed');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function refreshAudit() {
    const item = connection();
    if (!item?.session) return;
    try {
      const payload = await api(`/api/v8/test-center/audit/${encodeURIComponent(item.connectionId)}?limit=100`);
      const rows = [];
      for (const record of payload.audit?.raw || []) rows.push({ kind: 'RAW', result: record.result, intent: record.intent || record.classification?.functionCode || 'raw', request: record.requestRawHex, response: record.responseRawHex });
      for (const record of payload.audit?.writes || []) rows.push({ kind: 'WRITE', result: record.result, intent: record.functionCode == null ? 'write' : `FC${record.functionCode}`, request: record.requestRawHex || record.pduHex, response: record.responseRawHex });
      const body = $('#tcAuditBody');
      body.replaceChildren(...rows.slice(-100).reverse().map((row) => {
        const tr = document.createElement('tr');
        for (const value of [row.kind, row.result || '—', row.intent, row.request || '—', row.response || '—']) {
          const td = document.createElement('td');
          td.textContent = String(value);
          if (String(value).length > 24) td.className = 'mono tc-hex-cell';
          tr.appendChild(td);
        }
        return tr;
      }));
      $('#tcAuditEmpty').hidden = rows.length > 0;
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function withRefresh(action, success) {
    try {
      await action();
      await refresh({ quiet: true });
      await refreshAudit();
      if (success) toast(success);
    } catch (error) {
      toast(`${error.code ? `${error.code}: ` : ''}${error.message}`, 'error');
    }
  }

  install();

  $('#tcConnection').addEventListener('change', () => {
    state.connectionId = $('#tcConnection').value || null;
    render();
    refreshAudit();
  });
  $('#tcRefresh').addEventListener('click', () => refresh());
  $('#tcOpen').addEventListener('click', () => withRefresh(() => api(`/api/v8/test-center/session/${encodeURIComponent(state.connectionId)}/open`, { method: 'POST', body: '{}' }), 'Test session opened; writes and LAB remain locked'));
  $('#tcDisconnect').addEventListener('click', () => withRefresh(() => api(`/api/v8/test-center/session/${encodeURIComponent(state.connectionId)}/disconnect`, { method: 'POST', body: '{}' }), 'Test session disconnected'));
  $('#tcRefreshAudit').addEventListener('click', refreshAudit);

  $('#tcArmLab').addEventListener('click', () => {
    if (!$('#tcLabConfirm').checked) return toast('Confirm LAB/raw transmission first', 'error');
    withRefresh(() => api(`/api/v8/test-center/lab/${encodeURIComponent(state.connectionId)}/arm`, { method: 'POST', body: JSON.stringify({ durationMs: 600000, confirmation: { confirmed: true, raw: true } }) }), 'LAB raw transmission armed for 10 minutes');
  });
  $('#tcDisarmLab').addEventListener('click', () => withRefresh(() => api(`/api/v8/test-center/lab/${encodeURIComponent(state.connectionId)}/disarm`, { method: 'POST', body: JSON.stringify({ reason: 'browser-manual' }) }), 'LAB raw transmission disarmed'));
  $('#tcArmWrites').addEventListener('click', () => {
    if (!$('#tcWriteConfirm').checked) return toast('Confirm write enable first', 'error');
    withRefresh(() => api(`/api/v8/test-center/writes/${encodeURIComponent(state.connectionId)}/arm`, { method: 'POST', body: JSON.stringify({ durationMs: 30000, confirmation: { confirmed: true } }) }), 'Writes enabled for 30 seconds');
  });
  $('#tcLockWrites').addEventListener('click', () => withRefresh(() => api(`/api/v8/test-center/writes/${encodeURIComponent(state.connectionId)}/lock`, { method: 'POST', body: JSON.stringify({ reason: 'browser-manual' }) }), 'Writes locked'));

  async function sendRaw(repeat = false) {
    const body = {
      connectionId: state.connectionId,
      hex: $('#tcRawHex').value,
      autoChecksum: $('#tcAutoChecksum').checked,
      expectResponse: $('#tcExpectResponse').checked,
      timeoutMs: Number($('#tcTimeout').value || 1000),
      confirmation: { write: $('#tcConfirmWrite').checked, raw: $('#tcConfirmRaw').checked },
    };
    if (repeat) {
      body.count = Number($('#tcRepeatCount').value || 1);
      body.intervalMs = Number($('#tcRepeatGap').value || 0);
    }
    try {
      const payload = await api(repeat ? '/api/v8/test-center/raw/repeat' : '/api/v8/test-center/raw/send', { method: 'POST', body: JSON.stringify(body) });
      $('#tcRawResult').textContent = pretty(repeat ? payload.results : payload.result);
      await refresh({ quiet: true });
      await refreshAudit();
      toast(repeat ? 'Raw sequence completed' : 'Frame completed');
    } catch (error) {
      $('#tcRawResult').textContent = pretty({ ok: false, code: error.code, message: error.message, details: error.details });
      await refresh({ quiet: true });
      await refreshAudit();
      toast(`${error.code ? `${error.code}: ` : ''}${error.message}`, 'error');
    }
  }
  $('#tcSend').addEventListener('click', () => sendRaw(false));
  $('#tcRepeat').addEventListener('click', () => sendRaw(true));

  $('#tcRunRecipe').addEventListener('click', async () => {
    try {
      const recipe = JSON.parse($('#tcRecipe').value);
      const payload = await api('/api/v8/test-center/recipe/run', { method: 'POST', body: JSON.stringify({ recipe, defaultConnectionId: state.connectionId }) });
      $('#tcRecipeResult').textContent = pretty(payload.result);
      await refresh({ quiet: true });
      toast(payload.result?.passed ? 'Recipe passed' : 'Recipe completed');
    } catch (error) {
      $('#tcRecipeResult').textContent = pretty({ ok: false, code: error.code, message: error.message, details: error.details });
      await refresh({ quiet: true });
      toast(`${error.code ? `${error.code}: ` : ''}${error.message}`, 'error');
    }
  });
  for (const action of ['pause', 'resume', 'stop']) {
    $(`#tc${action[0].toUpperCase()}${action.slice(1)}Recipe`).addEventListener('click', () => withRefresh(() => api(`/api/v8/test-center/recipe/${action}`, { method: 'POST', body: '{}' }), `Recipe ${action} requested`));
  }

  document.querySelector('#navList')?.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-workspace="testCenter"]');
    if (!nav) return;
    queueMicrotask(() => {
      document.querySelectorAll('.workspace').forEach((node) => node.classList.remove('active'));
      $('#workspace-testCenter')?.classList.add('active');
      refresh({ quiet: true }).then(refreshAudit);
    });
  });

  refresh({ quiet: true });
})();
