'use strict';

(() => {
  const masterState = {
    snapshot: null,
    connectionId: '',
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
      <section id="workspace-master" class="workspace master-workspace" aria-labelledby="masterTitle">
        <div class="workspace-header">
          <div>
            <h1 id="masterTitle">Master Workstation</h1>
            <p>One-shot reads, persistent polling jobs and guarded writes on the selected connection.</p>
          </div>
          <div class="toolbar">
            <label class="field-inline"><span>Connection</span><select id="masterConnection"></select></label>
            <button id="masterRefresh" class="button secondary" type="button">Refresh</button>
            <button id="masterDisconnect" class="button secondary" type="button">Disconnect</button>
          </div>
        </div>

        <div class="metric-strip">
          <div class="metric-card"><span class="metric-label">Poll jobs</span><strong id="masterMetricJobs">0</strong></div>
          <div class="metric-card"><span class="metric-label">Enabled</span><strong id="masterMetricEnabled">0</strong></div>
          <div class="metric-card"><span class="metric-label">Scheduler</span><strong id="masterMetricScheduler">STOPPED</strong></div>
          <div class="metric-card"><span class="metric-label">Connection</span><strong id="masterMetricConnection">CLOSED</strong></div>
          <div class="metric-card"><span class="metric-label">Writes</span><strong id="masterMetricWrites">LOCKED</strong></div>
        </div>

        <div class="master-grid">
          <div class="panel master-card">
            <div class="panel-title-row"><div><h2>One-shot read</h2><p>Read coils, inputs or registers without creating a poll job.</p></div><span class="status-chip safe">READ ONLY</span></div>
            <div class="master-form-grid">
              <label class="field"><span>Unit ID</span><input id="masterReadUnit" class="text-input" type="number" min="1" max="255" value="1"></label>
              <label class="field"><span>Function</span><select id="masterReadFc"><option value="1">FC01 Coils</option><option value="2">FC02 Discrete Inputs</option><option value="3" selected>FC03 Holding Registers</option><option value="4">FC04 Input Registers</option></select></label>
              <label class="field"><span>Address</span><input id="masterReadAddress" class="text-input" type="number" min="0" max="65535" value="0"></label>
              <label class="field"><span>Quantity</span><input id="masterReadQuantity" class="text-input" type="number" min="1" max="2000" value="1"></label>
              <label class="field"><span>Timeout ms</span><input id="masterReadTimeout" class="text-input" type="number" min="1" max="60000" value="1000"></label>
            </div>
            <div class="card-actions"><button id="masterReadNow" class="button primary" type="button">Read now</button></div>
          </div>

          <div class="panel master-card">
            <div class="panel-title-row"><div><h2>Latest result</h2><p>Decoded values and exact request/response evidence.</p></div><span id="masterRtt" class="status-chip neutral">RTT —</span></div>
            <div id="masterResultEmpty" class="compact-empty">No read result yet.</div>
            <div id="masterResult" hidden>
              <div id="masterValues" class="value-grid"></div>
              <details class="raw-details"><summary>Raw request / response</summary><pre id="masterRaw" class="code-block"></pre></details>
            </div>
          </div>
        </div>

        <div class="panel master-poll-panel">
          <div class="workspace-header compact-header">
            <div><h2>Polling jobs</h2><p>Jobs are saved with the active project. Runtime starts stopped.</p></div>
            <div class="toolbar">
              <button id="masterSchedulerStart" class="button primary" type="button">Run</button>
              <button id="masterSchedulerPause" class="button secondary" type="button">Pause</button>
              <button id="masterSchedulerResume" class="button secondary" type="button">Resume</button>
              <button id="masterSchedulerStop" class="button secondary" type="button">Stop</button>
            </div>
          </div>
          <form id="masterJobForm" class="master-job-form">
            <input id="masterJobId" class="text-input" placeholder="Job ID" required maxlength="120">
            <input id="masterJobLabel" class="text-input" placeholder="Label" maxlength="200">
            <input id="masterJobUnit" class="text-input" type="number" min="1" max="255" value="1" title="Unit ID">
            <select id="masterJobFc" title="Function"><option value="1">FC01</option><option value="2">FC02</option><option value="3" selected>FC03</option><option value="4">FC04</option></select>
            <input id="masterJobAddress" class="text-input" type="number" min="0" max="65535" value="0" title="Address">
            <input id="masterJobQuantity" class="text-input" type="number" min="1" max="2000" value="1" title="Quantity">
            <input id="masterJobInterval" class="text-input" type="number" min="10" value="1000" title="Interval ms">
            <button class="button primary" type="submit">Add / Update</button>
          </form>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Job</th><th>Unit</th><th>FC</th><th>Address</th><th>Qty</th><th>Interval</th><th>State</th><th class="actions-column">Actions</th></tr></thead>
              <tbody id="masterJobsBody"></tbody>
            </table>
          </div>
          <div id="masterJobsEmpty" class="compact-empty">No poll jobs for this connection.</div>
        </div>

        <div class="panel master-write-panel">
          <div class="panel-title-row"><div><h2>Guarded write</h2><p>Writes require explicit confirmation and return to locked after the operation.</p></div><span class="status-chip danger">ACTIVE OPERATION</span></div>
          <div class="master-form-grid write-grid">
            <label class="field"><span>Unit ID</span><input id="masterWriteUnit" class="text-input" type="number" min="1" max="255" value="1"></label>
            <label class="field"><span>Function</span><select id="masterWriteFc"><option value="5">FC05 Single Coil</option><option value="6" selected>FC06 Single Register</option><option value="15">FC15 Multiple Coils</option><option value="16">FC16 Multiple Registers</option></select></label>
            <label class="field"><span>Address</span><input id="masterWriteAddress" class="text-input" type="number" min="0" max="65535" value="0"></label>
            <label class="field master-write-single"><span>Value</span><input id="masterWriteValue" class="text-input" value="0"></label>
            <label class="field master-write-multiple" hidden><span>Values (comma separated)</span><input id="masterWriteValues" class="text-input" placeholder="1, 2, 3"></label>
            <label class="check-field"><input id="masterWriteReadback" type="checkbox" checked><span>Verify by read-back</span></label>
            <label class="check-field"><input id="masterWriteConfirm" type="checkbox"><span>I confirm this write</span></label>
          </div>
          <div class="card-actions"><button id="masterWriteNow" class="button destructive" type="button">Execute write</button></div>
        </div>
      </section>`;
  }

  function installWorkspace() {
    if ($('#workspace-master')) return;
    const host = $('.workspace-host');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', workspaceHtml());
  }

  function showMasterWorkspace(event) {
    if (event) event.stopPropagation();
    document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.workspace === 'master'));
    document.querySelectorAll('.workspace').forEach((node) => node.classList.remove('active'));
    $('#workspace-master')?.classList.add('active');
    refreshMaster().catch((error) => toast(error.message, 'error'));
  }

  function selectedConnection() {
    return masterState.snapshot?.connections?.find((entry) => entry.connectionId === masterState.connectionId) || null;
  }

  function selectedJobs() {
    return (masterState.snapshot?.jobs || []).filter((job) => job.connectionId === masterState.connectionId);
  }

  function renderConnections() {
    const select = $('#masterConnection');
    const eligible = (masterState.snapshot?.connections || []).filter((entry) => entry.masterEligible);
    if (!masterState.connectionId || !eligible.some((entry) => entry.connectionId === masterState.connectionId)) masterState.connectionId = eligible[0]?.connectionId || '';
    select.replaceChildren(...eligible.map((entry) => {
      const option = document.createElement('option');
      option.value = entry.connectionId;
      option.textContent = `${entry.name || entry.connectionId} · ${entry.transportKind}`;
      option.selected = entry.connectionId === masterState.connectionId;
      return option;
    }));
    if (!eligible.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Create a Master-compatible connection first';
      select.appendChild(option);
    }
  }

  function renderMetrics() {
    const connection = selectedConnection();
    const jobs = selectedJobs();
    $('#masterMetricJobs').textContent = String(jobs.length);
    $('#masterMetricEnabled').textContent = String(jobs.filter((job) => job.enabled !== false).length);
    const scheduler = connection?.scheduler;
    $('#masterMetricScheduler').textContent = scheduler?.running ? (scheduler.paused ? 'PAUSED' : 'RUNNING') : 'STOPPED';
    $('#masterMetricConnection').textContent = String(connection?.runtime?.state || 'closed').toUpperCase();
    $('#masterMetricWrites').textContent = connection?.runtime?.writeLock === 'ENABLED' ? 'ENABLED' : 'LOCKED';
  }

  function renderJobs() {
    const jobs = selectedJobs();
    const tbody = $('#masterJobsBody');
    tbody.replaceChildren(...jobs.map((job) => {
      const tr = document.createElement('tr');
      const schedulerJob = selectedConnection()?.schedulerJobs?.find?.((entry) => entry.jobId === job.jobId);
      const fields = [job.label || job.jobId, job.unitId, `FC${String(job.functionCode).padStart(2, '0')}`, job.address, job.quantity, `${job.intervalMs} ms`, schedulerJob?.state || (job.enabled === false ? 'disabled' : 'saved')];
      fields.forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = String(value);
        if (index === 0) td.title = job.jobId;
        tr.appendChild(td);
      });
      const actions = document.createElement('td');
      actions.className = 'actions-column';
      actions.innerHTML = `<div class="row-actions"><button class="button small primary" data-master-action="read" data-job-id="${escapeHtml(job.jobId)}" type="button">Read</button><button class="button small secondary" data-master-action="edit" data-job-id="${escapeHtml(job.jobId)}" type="button">Edit</button><button class="button small destructive" data-master-action="delete" data-job-id="${escapeHtml(job.jobId)}" type="button">Delete</button></div>`;
      tr.appendChild(actions);
      return tr;
    }));
    $('#masterJobsEmpty').hidden = jobs.length !== 0;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function renderResult(result) {
    if (!result) return;
    $('#masterResultEmpty').hidden = true;
    $('#masterResult').hidden = false;
    $('#masterRtt').textContent = result.rttMs == null ? 'RTT —' : `RTT ${Number(result.rttMs).toFixed(1)} ms`;
    const values = Array.isArray(result.decoded?.values) ? result.decoded.values : [];
    const host = $('#masterValues');
    if (values.length) {
      host.replaceChildren(...values.map((value, index) => {
        const node = document.createElement('div');
        node.className = 'value-cell';
        node.innerHTML = `<span>${index}</span><strong>${escapeHtml(value)}</strong>`;
        return node;
      }));
    } else {
      const node = document.createElement('div');
      node.className = 'value-cell wide';
      node.innerHTML = `<span>Decoded</span><strong>${escapeHtml(JSON.stringify(result.decoded ?? {}))}</strong>`;
      host.replaceChildren(node);
    }
    $('#masterRaw').textContent = `TX  ${result.requestRawHex || '—'}\nRX  ${result.responseRawHex || '—'}`;
  }

  function render() {
    renderConnections();
    renderMetrics();
    renderJobs();
  }

  async function refreshMaster() {
    const response = await api('/api/v8/master');
    masterState.snapshot = response;
    render();
  }

  function requireConnection() {
    if (!masterState.connectionId) throw new Error('Select a Master-compatible connection');
    return masterState.connectionId;
  }

  async function oneShotRead() {
    const connectionId = requireConnection();
    const payload = {
      connectionId,
      unitId: Number($('#masterReadUnit').value),
      functionCode: Number($('#masterReadFc').value),
      address: Number($('#masterReadAddress').value),
      quantity: Number($('#masterReadQuantity').value),
      timeoutMs: Number($('#masterReadTimeout').value),
    };
    const response = await api('/api/v8/master/read', { method: 'POST', body: JSON.stringify(payload) });
    renderResult(response.result);
    toast('Read completed');
    await refreshMaster();
  }

  async function saveJob(event) {
    event.preventDefault();
    const connectionId = requireConnection();
    const payload = {
      jobId: $('#masterJobId').value.trim(),
      label: $('#masterJobLabel').value.trim(),
      connectionId,
      unitId: Number($('#masterJobUnit').value),
      functionCode: Number($('#masterJobFc').value),
      address: Number($('#masterJobAddress').value),
      quantity: Number($('#masterJobQuantity').value),
      intervalMs: Number($('#masterJobInterval').value),
      timeoutMs: 1000,
      retries: 1,
      retryDelayMs: 100,
      enabled: true,
    };
    await api('/api/v8/master/jobs', { method: 'POST', body: JSON.stringify(payload) });
    toast('Poll job saved');
    $('#masterJobForm').reset();
    $('#masterJobUnit').value = '1';
    $('#masterJobFc').value = '3';
    $('#masterJobAddress').value = '0';
    $('#masterJobQuantity').value = '1';
    $('#masterJobInterval').value = '1000';
    await refreshMaster();
  }

  function editJob(jobId) {
    const job = (masterState.snapshot?.jobs || []).find((entry) => entry.jobId === jobId);
    if (!job) return;
    masterState.connectionId = job.connectionId;
    $('#masterConnection').value = job.connectionId;
    $('#masterJobId').value = job.jobId;
    $('#masterJobLabel').value = job.label || '';
    $('#masterJobUnit').value = String(job.unitId);
    $('#masterJobFc').value = String(job.functionCode);
    $('#masterJobAddress').value = String(job.address);
    $('#masterJobQuantity').value = String(job.quantity);
    $('#masterJobInterval').value = String(job.intervalMs);
    $('#masterJobId').focus();
  }

  async function jobAction(action, jobId) {
    if (action === 'read') {
      const response = await api(`/api/v8/master/jobs/${encodeURIComponent(jobId)}/read`, { method: 'POST', body: '{}' });
      renderResult(response.result);
      toast('Poll job read completed');
    } else if (action === 'delete') {
      if (!window.confirm(`Delete poll job “${jobId}”?`)) return;
      await api(`/api/v8/master/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      toast('Poll job deleted');
    } else if (action === 'edit') {
      editJob(jobId);
      return;
    }
    await refreshMaster();
  }

  async function schedulerAction(action) {
    const connectionId = requireConnection();
    await api(`/api/v8/master/runtime/${encodeURIComponent(connectionId)}/${action}`, { method: 'POST', body: '{}' });
    toast(`Scheduler ${action}`);
    await refreshMaster();
  }

  async function disconnect() {
    const connectionId = requireConnection();
    await api(`/api/v8/master/runtime/${encodeURIComponent(connectionId)}/disconnect`, { method: 'POST', body: '{}' });
    toast('Master session disconnected');
    await refreshMaster();
  }

  function updateWriteFields() {
    const multiple = [15, 16].includes(Number($('#masterWriteFc').value));
    document.querySelectorAll('.master-write-single').forEach((node) => { node.hidden = multiple; });
    document.querySelectorAll('.master-write-multiple').forEach((node) => { node.hidden = !multiple; });
  }

  async function executeWrite() {
    const connectionId = requireConnection();
    const functionCode = Number($('#masterWriteFc').value);
    if (!$('#masterWriteConfirm').checked) throw new Error('Confirm the write before executing');
    const payload = {
      connectionId,
      unitId: Number($('#masterWriteUnit').value),
      functionCode,
      address: Number($('#masterWriteAddress').value),
      readBack: $('#masterWriteReadback').checked,
      confirmation: {
        confirmed: true,
        bulk: [15, 16].includes(functionCode),
      },
    };
    if ([15, 16].includes(functionCode)) {
      payload.values = $('#masterWriteValues').value.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => functionCode === 15 ? ['1', 'true', 'on'].includes(entry.toLowerCase()) : Number(entry));
    } else {
      const text = $('#masterWriteValue').value.trim();
      payload.value = functionCode === 5 ? ['1', 'true', 'on'].includes(text.toLowerCase()) : Number(text);
    }
    const response = await api('/api/v8/master/write', { method: 'POST', body: JSON.stringify(payload) });
    $('#masterWriteConfirm').checked = false;
    renderResult(response.result);
    toast('Write completed and relocked');
    await refreshMaster();
  }

  function bind() {
    const nav = document.querySelector('.nav-item[data-workspace="master"]');
    nav?.addEventListener('click', showMasterWorkspace);
    $('#masterRefresh')?.addEventListener('click', () => refreshMaster().catch((error) => toast(error.message, 'error')));
    $('#masterConnection')?.addEventListener('change', (event) => {
      masterState.connectionId = event.target.value;
      renderMetrics();
      renderJobs();
    });
    $('#masterReadNow')?.addEventListener('click', () => oneShotRead().catch((error) => toast(error.message, 'error')));
    $('#masterJobForm')?.addEventListener('submit', (event) => saveJob(event).catch((error) => toast(error.message, 'error')));
    $('#masterJobsBody')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-master-action][data-job-id]');
      if (button) jobAction(button.dataset.masterAction, button.dataset.jobId).catch((error) => toast(error.message, 'error'));
    });
    for (const action of ['start', 'pause', 'resume', 'stop']) {
      $(`#masterScheduler${action.charAt(0).toUpperCase()}${action.slice(1)}`)?.addEventListener('click', () => schedulerAction(action).catch((error) => toast(error.message, 'error')));
    }
    $('#masterDisconnect')?.addEventListener('click', () => disconnect().catch((error) => toast(error.message, 'error')));
    $('#masterWriteFc')?.addEventListener('change', updateWriteFields);
    $('#masterWriteNow')?.addEventListener('click', () => executeWrite().catch((error) => toast(error.message, 'error')));
  }

  function connectRefreshBridge() {
    const observer = new MutationObserver(() => {
      if ($('#workspace-master')?.classList.contains('active')) {
        clearTimeout(masterState.refreshTimer);
        masterState.refreshTimer = setTimeout(() => refreshMaster().catch(() => undefined), 200);
      }
    });
    const status = $('#statusLastUpdate');
    if (status) observer.observe(status, { childList: true, subtree: true, characterData: true });
  }

  installWorkspace();
  bind();
  connectRefreshBridge();
})();
