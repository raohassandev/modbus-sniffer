(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const state = {
    status: null,
    projects: [],
    activeProjectId: null,
    connections: [],
    serialPorts: [],
    interfaces: [],
    selectedId: null,
    socket: null,
    reconnectTimer: null,
  };

  const els = {
    shell: $('#appShell'), projectSelect: $('#projectSelect'), theme: $('#themeSelect'), density: $('#densitySelect'),
    modeChip: $('#activeModeChip'), connectionChip: $('#activeConnectionChip'), writeChip: $('#writeStateChip'),
    ownerMode: $('#ownerModeSelect'), refresh: $('#refreshButton'), newConnection: $('#newConnectionButton'), emptyNew: $('#emptyNewButton'),
    profileCount: $('#profileCount'), openCount: $('#openCount'), serialCount: $('#serialCount'), networkCount: $('#networkCount'),
    search: $('#connectionSearch'), body: $('#connectionsBody'), empty: $('#emptyState'), inspector: $('#inspector'), inspectorTitle: $('#inspectorTitle'), inspectorContent: $('#inspectorContent'),
    toggleInspector: $('#toggleInspector'), closeInspector: $('#closeInspector'), serverState: $('#serverState'), schemaState: $('#schemaState'), projectState: $('#projectState'), eventState: $('#eventState'),
    importButton: $('#importButton'), exportButton: $('#exportButton'), importFile: $('#importFile'),
    dialog: $('#connectionDialog'), form: $('#connectionForm'), dialogTitle: $('#dialogTitle'), formError: $('#formError'), save: $('#saveProfileButton'),
    profileId: $('#profileId'), profileName: $('#profileName'), profileDescription: $('#profileDescription'), transportKind: $('#transportKind'), serialFields: $('#serialFields'), tcpFields: $('#tcpFields'),
    serialPath: $('#serialPath'), baudRate: $('#baudRate'), parity: $('#parity'), dataBits: $('#dataBits'), stopBits: $('#stopBits'), echoSuppression: $('#echoSuppression'), serialList: $('#serialPortsList'),
    tcpHost: $('#tcpHost'), tcpPort: $('#tcpPort'), localAddress: $('#localAddress'), localAddressLabel: $('#localAddressLabel'), connectTimeout: $('#connectTimeout'), networkList: $('#networkInterfacesList'),
    commandButton: $('#commandButton'), commandDialog: $('#commandDialog'), commandInput: $('#commandInput'), commandList: $('#commandList'), toast: $('#toastRegion'),
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  async function api(url, options = {}) {
    const init = { ...options, headers: { ...(options.headers || {}) } };
    if (init.body && typeof init.body !== 'string') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    const response = await fetch(url, init);
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(payload?.error || payload || `${response.status} ${response.statusText}`);
      error.code = payload?.code || `HTTP_${response.status}`;
      error.details = payload?.details;
      throw error;
    }
    return payload;
  }

  function toast(message, kind = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    els.toast.append(node);
    setTimeout(() => node.remove(), 3600);
  }

  function setEvent(message, isError = false) {
    els.eventState.textContent = message;
    els.eventState.style.color = isError ? 'var(--danger)' : '';
  }

  function activeProject() {
    return state.projects.find((project) => project.id === state.activeProjectId) || null;
  }

  function endpointText(profile) {
    const kind = String(profile.transportKind || '').toLowerCase();
    if (kind.startsWith('serial-')) return profile.serial?.path || profile.serial?.port || profile.endpoint || 'Not configured';
    if (kind === 'tcp-client') return `${profile.tcp?.host || profile.tcp?.targetHost || profile.endpoint || '—'}:${profile.tcp?.port || profile.tcp?.targetPort || 502}`;
    if (kind === 'tcp-server') return `${profile.tcp?.host || profile.tcp?.listenHost || profile.endpoint || '127.0.0.1'}:${profile.tcp?.port ?? profile.tcp?.listenPort ?? 502}`;
    if (kind.startsWith('virtual')) return profile.name || profile.connectionId;
    return profile.endpoint || '—';
  }

  function transportLabel(profile) {
    const kind = String(profile.transportKind || profile.transport || '').toLowerCase();
    return ({ 'serial-rtu': 'Serial RTU', 'serial-ascii': 'Serial ASCII', 'tcp-client': 'TCP Client', 'tcp-server': 'TCP Server', 'virtual-rtu': 'Virtual RTU', virtual: 'Virtual' })[kind] || kind || 'Unknown';
  }

  function currentOpen() {
    return state.connections.find((item) => item.runtime?.state === 'open') || null;
  }

  function renderTopState() {
    const open = currentOpen();
    const project = activeProject();
    els.modeChip.dataset.state = open ? 'open' : 'neutral';
    els.modeChip.querySelector('span:last-child').textContent = open ? String(open.runtime.ownerMode || 'mode').toUpperCase() : 'NO MODE';
    els.connectionChip.dataset.state = open ? 'open' : 'neutral';
    els.connectionChip.querySelector('span:last-child').textContent = open ? open.profile.name.toUpperCase() : 'NO CONNECTION';
    const writeLock = open?.runtime?.writeLock || 'LOCKED';
    els.writeChip.dataset.state = writeLock === 'ENABLED' ? 'warning' : 'safe';
    els.writeChip.querySelector('span:last-child').textContent = writeLock === 'ENABLED' ? 'WRITES ENABLED' : 'WRITES LOCKED';
    els.projectState.textContent = `Project ${project?.name || '—'}`;
  }

  function stateBadge(item) {
    if (item.validationError) return '<span class="state-badge error">Invalid</span>';
    const value = item.runtime?.state || 'closed';
    return `<span class="state-badge ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
  }

  function filteredConnections() {
    const query = els.search.value.trim().toLowerCase();
    if (!query) return state.connections;
    return state.connections.filter((item) => {
      const haystack = [item.profile.connectionId, item.profile.name, item.profile.transportKind, item.profile.transport, endpointText(item.profile), item.runtime?.ownerMode, item.runtime?.state].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderTable() {
    const rows = filteredConnections();
    els.body.innerHTML = rows.map((item) => {
      const profile = item.profile;
      const open = item.runtime?.state === 'open';
      const selected = state.selectedId === profile.connectionId;
      const mode = item.runtime?.ownerMode ? String(item.runtime.ownerMode).toUpperCase() : '—';
      const lock = item.runtime?.writeLock || 'LOCKED';
      return `<tr data-id="${escapeHtml(profile.connectionId)}" class="${selected ? 'selected' : ''}" tabindex="0">
        <td>${stateBadge(item)}</td>
        <td><div class="row-title">${escapeHtml(profile.name || profile.connectionId)}</div><div class="row-sub mono">${escapeHtml(profile.connectionId)}</div></td>
        <td>${escapeHtml(transportLabel(profile))}</td>
        <td class="mono">${escapeHtml(endpointText(profile))}</td>
        <td>${escapeHtml(mode)}</td>
        <td><span class="status-chip" data-state="${lock === 'LOCKED' ? 'safe' : 'warning'}">${lock === 'LOCKED' ? '🔒 LOCKED' : '⚠ ENABLED'}</span></td>
        <td><div class="table-actions">
          <button class="button small secondary" data-action="test" data-id="${escapeHtml(profile.connectionId)}" ${open ? 'disabled' : ''}>Test</button>
          <button class="button small ${open ? 'danger' : 'primary'}" data-action="${open ? 'close' : 'open'}" data-id="${escapeHtml(profile.connectionId)}">${open ? 'Close' : 'Open'}</button>
          <button class="button small ghost" data-action="more" data-id="${escapeHtml(profile.connectionId)}">Inspect</button>
        </div></td>
      </tr>`;
    }).join('');
    els.empty.hidden = state.connections.length !== 0;
    els.profileCount.textContent = String(state.connections.length);
    els.openCount.textContent = String(state.connections.filter((item) => item.runtime?.state === 'open').length);
    renderTopState();
    renderInspector();
  }

  function renderInspector() {
    const item = state.connections.find((entry) => entry.profile.connectionId === state.selectedId);
    if (!item) {
      els.inspectorTitle.textContent = 'No selection';
      els.inspectorContent.innerHTML = '<div class="inspector-empty">Select a connection to inspect its saved configuration, broker ownership, transport state and diagnostics.</div>';
      return;
    }
    const p = item.profile;
    const r = item.runtime;
    els.inspectorTitle.textContent = p.name || p.connectionId;
    const live = r ? [
      ['State', r.state], ['Transport', r.transportState], ['Mode', r.ownerMode || '—'], ['Capability', r.transmitCapability], ['Write lock', r.writeLock], ['Fault injection', r.faultInjectionEnabled ? 'ENABLED' : 'OFF'],
    ] : [['State', 'closed'], ['Mode', '—'], ['Write lock', 'LOCKED'], ['Capability', 'none']];
    els.inspectorContent.innerHTML = `
      <section class="inspector-section"><h3>Runtime truth</h3><dl class="kv">${live.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl></section>
      <section class="inspector-section"><h3>Saved profile</h3><dl class="kv"><dt>ID</dt><dd>${escapeHtml(p.connectionId)}</dd><dt>Transport</dt><dd>${escapeHtml(transportLabel(p))}</dd><dt>Endpoint</dt><dd>${escapeHtml(endpointText(p))}</dd><dt>Activation</dt><dd>${escapeHtml(p.activation || 'manual')}</dd></dl></section>
      ${item.validationError ? `<section class="inspector-section"><h3>Validation</h3><div class="form-error">${escapeHtml(item.validationError.error)}</div></section>` : ''}
      <section class="inspector-section"><h3>Actions</h3><div class="inspector-actions">
        <button class="button small secondary" data-inspector-action="edit">Edit</button>
        <button class="button small secondary" data-inspector-action="duplicate">Duplicate</button>
        <button class="button small danger" data-inspector-action="delete" ${r ? 'disabled' : ''}>Delete</button>
      </div></section>
      <section class="inspector-section"><h3>Exact profile JSON</h3><div class="raw-box">${escapeHtml(JSON.stringify(p, null, 2))}</div></section>`;
  }

  function renderProjects() {
    els.projectSelect.innerHTML = state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === state.activeProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('');
  }

  function renderEnumerations() {
    els.serialCount.textContent = String(state.serialPorts.length);
    els.networkCount.textContent = String(state.interfaces.length);
    els.serialList.innerHTML = state.serialPorts.map((port) => `<option value="${escapeHtml(port.path)}">${escapeHtml([port.manufacturer, port.serialNumber].filter(Boolean).join(' · '))}</option>`).join('');
    els.networkList.innerHTML = state.interfaces.map((entry) => `<option value="${escapeHtml(entry.address)}">${escapeHtml(`${entry.interfaceName} · ${entry.family}`)}</option>`).join('');
  }

  function applyUi(ui = {}) {
    const theme = ['system', 'light', 'dark'].includes(ui.theme) ? ui.theme : 'system';
    const density = ['comfortable', 'compact', 'dense'].includes(ui.density) ? ui.density : 'comfortable';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
    els.theme.value = theme;
    els.density.value = density;
  }

  async function saveUi() {
    try {
      await api('/api/v8/ui', { method: 'PUT', body: { theme: els.theme.value, density: els.density.value, layout: { inspectorCollapsed: els.shell.classList.contains('inspector-collapsed') } } });
    } catch (error) { toast(error.message, 'error'); }
  }

  async function refresh({ quiet = false } = {}) {
    try {
      const [status, projectsResult, connectionsResult, ui] = await Promise.all([
        api('/api/v8/status'), api('/api/v8/projects'), api('/api/v8/connections'), api('/api/v8/ui'),
      ]);
      state.status = status;
      state.projects = projectsResult.projects || [];
      state.activeProjectId = projectsResult.activeProjectId;
      state.connections = connectionsResult.connections || [];
      renderProjects(); renderTable(); applyUi(ui);
      if (ui?.layout?.inspectorCollapsed) els.shell.classList.add('inspector-collapsed');
      els.schemaState.textContent = `Schema v${status.schemaVersion}`;
      els.serverState.innerHTML = '<span class="status-led ok" aria-hidden="true"></span>Preview API connected';
      if (!quiet) setEvent('Connection inventory refreshed');
    } catch (error) {
      els.serverState.innerHTML = '<span class="status-led error" aria-hidden="true"></span>Preview API unavailable';
      setEvent(error.message, true); toast(error.message, 'error');
    }
    Promise.allSettled([api('/api/v8/system/serial-ports'), api('/api/v8/system/network-interfaces')]).then(([serial, network]) => {
      if (serial.status === 'fulfilled') state.serialPorts = serial.value;
      if (network.status === 'fulfilled') state.interfaces = network.value;
      renderEnumerations();
    });
  }

  async function openConnection(id) {
    try {
      setEvent(`Opening ${id}…`);
      const result = await api(`/api/v8/connections/${encodeURIComponent(id)}/open`, { method: 'POST', body: { projectId: state.activeProjectId, ownerMode: els.ownerMode.value } });
      toast(`${id} opened as ${result.ownerMode}.`); await refresh({ quiet: true }); setEvent(`${id} is open · writes ${result.writeLock.toLowerCase()}`);
    } catch (error) { setEvent(error.message, true); toast(error.message, 'error'); await refresh({ quiet: true }); }
  }

  async function closeConnection(id) {
    try {
      setEvent(`Closing ${id}…`);
      await api(`/api/v8/connections/${encodeURIComponent(id)}/close`, { method: 'POST', body: { projectId: state.activeProjectId } });
      toast(`${id} closed.`); await refresh({ quiet: true }); setEvent(`${id} closed safely`);
    } catch (error) { setEvent(error.message, true); toast(error.message, 'error'); }
  }

  async function testConnection(id) {
    try {
      setEvent(`Testing ${id} without transmitting Modbus data…`);
      const result = await api(`/api/v8/connections/${encodeURIComponent(id)}/test`, { method: 'POST', body: { projectId: state.activeProjectId } });
      toast(`${id}: transport opened successfully in ${result.elapsedMs} ms.`); setEvent(`${id} test passed · writes remained locked`);
    } catch (error) { setEvent(error.message, true); toast(`Test failed: ${error.message}`, 'error'); }
  }

  function updateTransportFields() {
    const kind = els.transportKind.value;
    const serial = kind.startsWith('serial-');
    const tcp = kind.startsWith('tcp-');
    els.serialFields.hidden = !serial;
    els.tcpFields.hidden = !tcp;
    els.localAddressLabel.hidden = kind !== 'tcp-client';
    els.tcpPort.min = kind === 'tcp-server' ? '0' : '1';
  }

  function clearFormError() { els.formError.hidden = true; els.formError.textContent = ''; }
  function showFormError(message) { els.formError.textContent = message; els.formError.hidden = false; }

  function openEditor(profile = null) {
    clearFormError();
    els.form.reset();
    els.dialogTitle.textContent = profile ? 'Edit connection' : 'New connection';
    els.profileId.disabled = Boolean(profile);
    els.profileId.value = profile?.connectionId || '';
    els.profileName.value = profile?.name || '';
    els.profileDescription.value = profile?.metadata?.description || '';
    els.transportKind.value = profile?.transportKind || 'serial-rtu';
    els.serialPath.value = profile?.serial?.path || profile?.serial?.port || (String(profile?.transportKind || '').startsWith('serial-') ? profile?.endpoint || '' : '');
    els.baudRate.value = profile?.serial?.baudRate || 9600;
    els.parity.value = profile?.serial?.parity || 'none';
    els.dataBits.value = profile?.serial?.dataBits || 8;
    els.stopBits.value = profile?.serial?.stopBits || 1;
    els.echoSuppression.checked = Boolean(profile?.serial?.echoSuppression);
    els.tcpHost.value = profile?.tcp?.host || profile?.tcp?.targetHost || profile?.tcp?.listenHost || '';
    els.tcpPort.value = profile?.tcp?.port ?? profile?.tcp?.targetPort ?? profile?.tcp?.listenPort ?? 502;
    els.localAddress.value = profile?.tcp?.localAddress || '';
    els.connectTimeout.value = profile?.tcp?.connectTimeoutMs || 3000;
    updateTransportFields();
    els.dialog.showModal();
    setTimeout(() => (profile ? els.profileName : els.profileId).focus(), 0);
  }

  function profilePayload() {
    const id = els.profileId.value.trim();
    const name = els.profileName.value.trim();
    if (!id) throw new Error('Connection ID is required.');
    if (!/^[A-Za-z0-9._:-]+$/.test(id)) throw new Error('Connection ID may use letters, numbers, dot, underscore, colon and hyphen.');
    if (!name) throw new Error('Name is required.');
    const kind = els.transportKind.value;
    const payload = { connectionId: id, id, name, transportKind: kind, metadata: { description: els.profileDescription.value.trim() } };
    if (kind.startsWith('serial-')) {
      payload.transport = kind === 'serial-ascii' ? 'ASCII' : 'RTU';
      payload.endpoint = els.serialPath.value.trim();
      payload.serial = {
        path: els.serialPath.value.trim(), baudRate: Number(els.baudRate.value), parity: els.parity.value,
        dataBits: Number(els.dataBits.value), stopBits: Number(els.stopBits.value), echoSuppression: els.echoSuppression.checked,
      };
    } else if (kind.startsWith('tcp-')) {
      payload.transport = 'TCP';
      const host = els.tcpHost.value.trim();
      const port = Number(els.tcpPort.value);
      payload.endpoint = host ? `${host}:${port}` : '';
      payload.tcp = kind === 'tcp-client'
        ? { host, port, localAddress: els.localAddress.value.trim() || null, connectTimeoutMs: Number(els.connectTimeout.value) }
        : { host: host || '127.0.0.1', port };
    } else {
      payload.transport = 'VIRTUAL';
      payload.endpoint = name;
    }
    return payload;
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (event.submitter?.value === 'cancel') { els.dialog.close(); return; }
    clearFormError();
    try {
      const payload = profilePayload();
      await api(`/api/v8/projects/${encodeURIComponent(state.activeProjectId)}/connections/${encodeURIComponent(payload.connectionId)}`, { method: 'PUT', body: payload });
      els.dialog.close(); state.selectedId = payload.connectionId; toast(`${payload.name} saved.`); await refresh({ quiet: true }); setEvent(`${payload.name} profile saved · runtime state not persisted`);
    } catch (error) { showFormError(error.message); }
  }

  async function duplicateSelected() {
    const item = state.connections.find((entry) => entry.profile.connectionId === state.selectedId);
    if (!item) return;
    const base = `${item.profile.connectionId}-copy`;
    let id = base;
    let n = 2;
    while (state.connections.some((entry) => entry.profile.connectionId === id)) id = `${base}-${n++}`;
    try {
      const saved = await api(`/api/v8/projects/${encodeURIComponent(state.activeProjectId)}/connections/${encodeURIComponent(item.profile.connectionId)}/duplicate`, { method: 'POST', body: { connectionId: id, name: `${item.profile.name} Copy` } });
      state.selectedId = saved.connectionId; toast(`Duplicated as ${saved.name}.`); await refresh({ quiet: true });
    } catch (error) { toast(error.message, 'error'); }
  }

  async function deleteSelected() {
    const item = state.connections.find((entry) => entry.profile.connectionId === state.selectedId);
    if (!item || item.runtime) return;
    if (!window.confirm(`Delete saved connection profile “${item.profile.name}”?`)) return;
    try {
      await api(`/api/v8/projects/${encodeURIComponent(state.activeProjectId)}/connections/${encodeURIComponent(item.profile.connectionId)}`, { method: 'DELETE' });
      state.selectedId = null; toast('Connection profile deleted.'); await refresh({ quiet: true });
    } catch (error) { toast(error.message, 'error'); }
  }

  async function changeProject() {
    const id = els.projectSelect.value;
    if (id === state.activeProjectId) return;
    try {
      await api(`/api/v8/projects/${encodeURIComponent(id)}/select`, { method: 'POST' });
      state.selectedId = null; await refresh({ quiet: true }); toast('Active project changed.');
    } catch (error) { els.projectSelect.value = state.activeProjectId; toast(error.message, 'error'); }
  }

  async function importProfiles(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const result = await api(`/api/v8/projects/${encodeURIComponent(state.activeProjectId)}/connections/import`, { method: 'POST', body: parsed });
      toast(`Imported ${result.imported} connection profile${result.imported === 1 ? '' : 's'}.`); await refresh({ quiet: true });
    } catch (error) { toast(`Import failed: ${error.message}`, 'error'); }
    finally { els.importFile.value = ''; }
  }

  function openCommandPalette() {
    els.commandInput.value = '';
    renderCommands('');
    els.commandDialog.showModal();
    setTimeout(() => els.commandInput.focus(), 0);
  }

  const commands = [
    { name: 'New connection', hint: 'Connection Center', run: () => openEditor() },
    { name: 'Refresh connections', hint: 'Connection Center', run: () => refresh() },
    { name: 'Use system theme', hint: 'Appearance', run: () => { els.theme.value = 'system'; applyUi({ theme: 'system', density: els.density.value }); saveUi(); } },
    { name: 'Use dark theme', hint: 'Appearance', run: () => { els.theme.value = 'dark'; applyUi({ theme: 'dark', density: els.density.value }); saveUi(); } },
    { name: 'Toggle inspector', hint: 'Layout', run: () => { els.shell.classList.toggle('inspector-collapsed'); saveUi(); } },
  ];

  function renderCommands(query) {
    const q = query.trim().toLowerCase();
    const list = commands.filter((command) => !q || `${command.name} ${command.hint}`.toLowerCase().includes(q));
    els.commandList.innerHTML = list.map((command, index) => `<button class="command-item" data-command="${index}"><span>${escapeHtml(command.name)}</span><small>${escapeHtml(command.hint)}</small></button>`).join('') || '<div class="inspector-empty">No matching command.</div>';
    els.commandList.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => { els.commandDialog.close(); list[Number(button.dataset.command)].run(); });
    });
  }

  function connectSocket() {
    clearTimeout(state.reconnectTimer);
    state.socket?.close();
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/v8/ws`);
    state.socket = ws;
    ws.addEventListener('open', () => { els.serverState.innerHTML = '<span class="status-led ok" aria-hidden="true"></span>Preview API connected'; });
    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (['connection-state', 'profiles', 'project'].includes(message.type)) refresh({ quiet: true });
      } catch { /* ignore malformed live message */ }
    });
    ws.addEventListener('close', () => {
      els.serverState.innerHTML = '<span class="status-led error" aria-hidden="true"></span>Live updates reconnecting';
      state.reconnectTimer = setTimeout(connectSocket, 1500);
    });
    ws.addEventListener('error', () => ws.close());
  }

  els.refresh.addEventListener('click', () => refresh());
  els.newConnection.addEventListener('click', () => openEditor());
  els.emptyNew.addEventListener('click', () => openEditor());
  els.search.addEventListener('input', renderTable);
  els.projectSelect.addEventListener('change', changeProject);
  els.transportKind.addEventListener('change', updateTransportFields);
  els.form.addEventListener('submit', saveProfile);
  els.theme.addEventListener('change', () => { applyUi({ theme: els.theme.value, density: els.density.value }); saveUi(); });
  els.density.addEventListener('change', () => { applyUi({ theme: els.theme.value, density: els.density.value }); saveUi(); });
  els.toggleInspector.addEventListener('click', () => { els.shell.classList.toggle('inspector-collapsed'); saveUi(); });
  els.closeInspector.addEventListener('click', () => { els.shell.classList.add('inspector-collapsed'); saveUi(); });
  els.importButton.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => importProfiles(els.importFile.files?.[0]));
  els.exportButton.addEventListener('click', () => { location.href = `/api/v8/projects/${encodeURIComponent(state.activeProjectId)}/connections/export.json`; });
  els.commandButton.addEventListener('click', openCommandPalette);
  els.commandInput.addEventListener('input', () => renderCommands(els.commandInput.value));

  els.body.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    const row = event.target.closest('tr[data-id]');
    if (row) { state.selectedId = row.dataset.id; renderTable(); }
    if (!actionButton) return;
    event.stopPropagation();
    const id = actionButton.dataset.id;
    if (actionButton.dataset.action === 'open') openConnection(id);
    else if (actionButton.dataset.action === 'close') closeConnection(id);
    else if (actionButton.dataset.action === 'test') testConnection(id);
    else if (actionButton.dataset.action === 'more') { state.selectedId = id; els.shell.classList.remove('inspector-collapsed'); renderTable(); saveUi(); }
  });
  els.body.addEventListener('keydown', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); state.selectedId = row.dataset.id; renderTable(); }
  });
  els.inspectorContent.addEventListener('click', (event) => {
    const action = event.target.closest('[data-inspector-action]')?.dataset.inspectorAction;
    const item = state.connections.find((entry) => entry.profile.connectionId === state.selectedId);
    if (!item || !action) return;
    if (action === 'edit') openEditor(item.profile);
    else if (action === 'duplicate') duplicateSelected();
    else if (action === 'delete') deleteSelected();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (els.commandDialog.open) els.commandDialog.close(); else openCommandPalette(); }
    if (event.key === 'Escape' && els.commandDialog.open) els.commandDialog.close();
  });

  refresh({ quiet: true }).then(connectSocket);
})();
