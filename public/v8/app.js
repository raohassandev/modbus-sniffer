'use strict';

(() => {
  const state = {
    status: null,
    projects: [],
    activeProjectId: null,
    connections: [],
    workspace: 'connections',
    ownerSelections: new Map(),
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    projectSelect: $('projectSelect'),
    connectionChip: $('connectionChip'),
    modeChip: $('modeChip'),
    writeChip: $('writeChip'),
    themeButton: $('themeButton'),
    densityButton: $('densityButton'),
    profileCount: $('profileCount'),
    openCount: $('openCount'),
    writeMetric: $('writeMetric'),
    schemaMetric: $('schemaMetric'),
    notice: $('notice'),
    connectionRows: $('connectionRows'),
    emptyConnections: $('emptyConnections'),
    newConnectionButton: $('newConnectionButton'),
    refreshButton: $('refreshButton'),
    connectionsWorkspace: $('connectionsWorkspace'),
    projectsWorkspace: $('projectsWorkspace'),
    comingSoonWorkspace: $('comingSoonWorkspace'),
    comingSoonTitle: $('comingSoonTitle'),
    comingSoonText: $('comingSoonText'),
    projectCards: $('projectCards'),
    footerProject: $('footerProject'),
    footerConnection: $('footerConnection'),
    footerMode: $('footerMode'),
    footerWrite: $('footerWrite'),
    connectionDialog: $('connectionDialog'),
    connectionForm: $('connectionForm'),
    transportKind: $('transportKind'),
    closeDialogButton: $('closeDialogButton'),
    cancelDialogButton: $('cancelDialogButton'),
  };

  const workspaceNames = {
    master: 'Master',
    simulator: 'Simulator',
    traffic: 'Traffic',
    registers: 'Register Lab',
    discovery: 'Discovery',
    test: 'Test Center',
    charts: 'Charts',
  };

  const workspaceDescriptions = {
    master: 'The tested Master runtime exists, but its production workspace remains feature-gated until Poll Documents, write drawer and evidence integration are complete.',
    simulator: 'The virtual Slave/server runtime exists, but its production memory editor and client-session workspace are still staged.',
    traffic: 'Unified v8 runtime traffic will be enabled after Master, Slave, Analyzer and Test Center event sources are joined without losing raw evidence.',
    registers: 'Register Lab will consume the shared engineering model after the unified traffic/source adapter is complete.',
    discovery: 'Existing discovery remains available in stable v7. The v8 workspace will move scans onto the shared Master engine with the same safety interlocks.',
    test: 'Raw Frame Studio and recipe execution remain disabled until LAB/raw safety boundaries and evidence rules are complete.',
    charts: 'Charts, logger and historian are staged until the v8 sampling/event pipeline and bounded-storage path are complete.',
  };

  function safeLocalStorageGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }

  function safeLocalStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* preferences are non-critical */ }
  }

  async function api(path, options = {}) {
    const request = {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    };
    if (Object.prototype.hasOwnProperty.call(options, 'body')) {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, request);
    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { error: text }; }
    }
    if (!response.ok) {
      const error = new Error(payload?.error || `${response.status} ${response.statusText}`);
      error.code = payload?.code || `HTTP_${response.status}`;
      error.details = payload?.details || null;
      throw error;
    }
    return payload;
  }

  function showNotice(message, type = 'success') {
    els.notice.textContent = message;
    els.notice.className = `notice ${type}`;
  }

  function clearNotice() {
    els.notice.textContent = '';
    els.notice.className = 'notice hidden';
  }

  function errorNotice(error) {
    showNotice(`${error?.code ? `${error.code}: ` : ''}${error?.message || error}`, 'error');
  }

  function endpointText(profile) {
    if (profile.endpoint) return String(profile.endpoint);
    if (profile.serial?.port) return String(profile.serial.port);
    if (profile.tcp?.host) return `${profile.tcp.host}:${profile.tcp.port ?? 502}`;
    if (profile.transportKind === 'virtual') return profile.metadata?.resourceKey || 'Virtual loopback';
    return '—';
  }

  function chip(text, className = 'neutral') {
    const span = document.createElement('span');
    span.className = `chip ${className}`;
    span.textContent = text;
    return span;
  }

  function activeRuntimeEntry() {
    return state.connections.find((entry) => ['open', 'opening', 'error'].includes(entry.runtime?.state)) || null;
  }

  function writeStateClass(value) {
    return value === 'LOCKED' ? 'locked' : value === 'ENABLED' ? 'error' : 'neutral';
  }

  function renderTopStatus() {
    const project = state.projects.find((entry) => entry.id === state.activeProjectId) || null;
    const active = activeRuntimeEntry();
    const runtime = active?.runtime || null;
    const profile = active?.profile || null;
    const mode = runtime?.owner?.ownerMode || 'none';
    const write = runtime?.writeLock || 'LOCKED';

    els.connectionChip.textContent = profile?.name || 'NO CONNECTION';
    els.connectionChip.className = `chip ${runtime?.state === 'open' ? 'open' : runtime?.state === 'error' ? 'error' : 'neutral'}`;
    els.modeChip.textContent = `MODE ${mode.toUpperCase()}`;
    els.modeChip.className = `chip ${mode === 'none' ? 'neutral' : 'open'}`;
    els.writeChip.textContent = `WRITE ${write}`;
    els.writeChip.className = `chip ${writeStateClass(write)}`;

    els.footerProject.textContent = `Project ${project?.name || '—'}`;
    els.footerConnection.textContent = `Connection ${profile?.name || '—'}`;
    els.footerMode.textContent = `Owner ${mode.toUpperCase()}`;
    els.footerWrite.textContent = `WRITE ${write}`;

    els.profileCount.textContent = String(state.connections.length);
    els.openCount.textContent = String(state.connections.filter((entry) => entry.runtime?.state === 'open').length);
    els.writeMetric.textContent = write;
    els.schemaMetric.textContent = String(state.status?.schemaVersion ?? 3);
  }

  function renderProjectSelect() {
    els.projectSelect.replaceChildren();
    for (const project of state.projects) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name || project.id;
      option.selected = project.id === state.activeProjectId;
      els.projectSelect.append(option);
    }
    els.projectSelect.disabled = state.projects.length < 2;
  }

  function allowedSelection(entry) {
    const allowed = entry.allowedOwnerModes || [];
    const existing = state.ownerSelections.get(entry.profile.connectionId);
    if (existing && allowed.includes(existing)) return existing;
    const preferred = allowed.includes('analyzer') ? 'analyzer' : allowed[0] || '';
    state.ownerSelections.set(entry.profile.connectionId, preferred);
    return preferred;
  }

  function renderConnectionRows() {
    els.connectionRows.replaceChildren();
    els.emptyConnections.classList.toggle('hidden', state.connections.length !== 0);

    for (const entry of state.connections) {
      const profile = entry.profile;
      const runtime = entry.runtime;
      const row = document.createElement('tr');
      row.dataset.connectionId = profile.connectionId;

      const nameCell = document.createElement('td');
      const nameWrap = document.createElement('div');
      nameWrap.className = 'connection-name';
      const strong = document.createElement('strong');
      strong.textContent = profile.name || profile.connectionId;
      const small = document.createElement('small');
      small.textContent = profile.connectionId;
      nameWrap.append(strong, small);
      nameCell.append(nameWrap);

      const transportCell = document.createElement('td');
      transportCell.textContent = profile.transportKind || profile.transport || '—';
      const endpointCell = document.createElement('td');
      endpointCell.className = 'mono';
      endpointCell.textContent = endpointText(profile);

      const stateCell = document.createElement('td');
      stateCell.append(chip(String(runtime.state || 'closed').toUpperCase(), runtime.state === 'open' ? 'open' : runtime.state === 'error' ? 'error' : 'neutral'));
      const ownerCell = document.createElement('td');
      ownerCell.textContent = runtime.owner?.ownerMode || 'none';
      const capabilityCell = document.createElement('td');
      capabilityCell.textContent = runtime.transmitCapability || 'none';
      const writeCell = document.createElement('td');
      writeCell.append(chip(runtime.writeLock || 'LOCKED', writeStateClass(runtime.writeLock || 'LOCKED')));

      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions-col';
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const isActive = ['open', 'opening', 'closing', 'error'].includes(runtime.state);

      if (!isActive) {
        const select = document.createElement('select');
        select.dataset.ownerFor = profile.connectionId;
        select.setAttribute('aria-label', `Owner mode for ${profile.name || profile.connectionId}`);
        for (const mode of entry.allowedOwnerModes || []) {
          const option = document.createElement('option');
          option.value = mode;
          option.textContent = mode.toUpperCase();
          option.selected = mode === allowedSelection(entry);
          select.append(option);
        }
        select.disabled = !entry.supported || !(entry.allowedOwnerModes || []).length;
        actions.append(select);

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'mini-button primary';
        open.dataset.action = 'open';
        open.textContent = 'Open';
        open.disabled = !entry.supported || !(entry.allowedOwnerModes || []).length;
        actions.append(open);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mini-button';
        remove.dataset.action = 'remove';
        remove.textContent = 'Remove';
        actions.append(remove);
      } else {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'mini-button';
        close.dataset.action = 'close';
        close.textContent = runtime.state === 'closing' ? 'Closing…' : 'Close';
        close.disabled = runtime.state === 'closing';
        actions.append(close);
      }

      actionsCell.append(actions);
      row.append(nameCell, transportCell, endpointCell, stateCell, ownerCell, capabilityCell, writeCell, actionsCell);
      els.connectionRows.append(row);
    }
  }

  function renderProjects() {
    els.projectCards.replaceChildren();
    for (const project of state.projects) {
      const card = document.createElement('article');
      card.className = `project-card${project.id === state.activeProjectId ? ' active' : ''}`;
      const title = document.createElement('strong');
      title.textContent = project.name || project.id;
      const place = document.createElement('p');
      place.textContent = [project.site, project.bus].filter(Boolean).join(' · ') || 'No site/bus metadata';
      const meta = document.createElement('div');
      meta.className = 'project-meta';
      meta.textContent = `${project.connectionCount ?? 0} connections · ${project.deviceCount ?? 0} devices · ${project.registerCount ?? 0} registers`;
      card.append(title, place, meta);
      if (project.id !== state.activeProjectId) {
        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'secondary-button';
        select.dataset.projectSelect = project.id;
        select.textContent = 'Select project';
        card.append(select);
      } else {
        card.append(chip('ACTIVE PROJECT', 'open'));
      }
      els.projectCards.append(card);
    }
  }

  function renderFeatureNavigation() {
    const features = state.status?.features || {};
    document.querySelectorAll('.nav-item[data-feature]').forEach((button) => {
      const enabled = Boolean(features[button.dataset.feature]);
      button.dataset.disabled = enabled ? 'false' : 'true';
      button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    });
  }

  function showWorkspace(workspace) {
    state.workspace = workspace;
    document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.workspace === workspace));
    els.connectionsWorkspace.classList.add('hidden');
    els.projectsWorkspace.classList.add('hidden');
    els.comingSoonWorkspace.classList.add('hidden');

    if (workspace === 'connections') {
      els.connectionsWorkspace.classList.remove('hidden');
      return;
    }
    if (workspace === 'projects') {
      els.projectsWorkspace.classList.remove('hidden');
      return;
    }
    els.comingSoonTitle.textContent = workspaceNames[workspace] || 'Workspace';
    els.comingSoonText.textContent = workspaceDescriptions[workspace] || 'This module remains feature-gated until its runtime and acceptance tests are complete.';
    els.comingSoonWorkspace.classList.remove('hidden');
  }

  function render() {
    renderProjectSelect();
    renderFeatureNavigation();
    renderConnectionRows();
    renderProjects();
    renderTopStatus();
    showWorkspace(state.workspace);
  }

  async function refresh({ quiet = false } = {}) {
    if (!quiet) clearNotice();
    const [status, projects, connections] = await Promise.all([
      api('/api/v8/status'),
      api('/api/v8/projects'),
      api('/api/v8/connections'),
    ]);
    state.status = status;
    state.projects = projects.projects || [];
    state.activeProjectId = projects.activeProjectId || status.activeProject?.id || null;
    state.connections = connections || [];
    render();
  }

  async function openConnection(connectionId) {
    const entry = state.connections.find((item) => item.profile.connectionId === connectionId);
    if (!entry) return;
    const ownerMode = state.ownerSelections.get(connectionId) || allowedSelection(entry);
    if (!ownerMode) throw new Error('Select an owner mode before opening this connection.');
    await api(`/api/v8/connections/${encodeURIComponent(connectionId)}/open`, { method: 'POST', body: { ownerMode } });
    await refresh({ quiet: true });
    showNotice(`${entry.profile.name || connectionId} opened as ${ownerMode.toUpperCase()}. WRITE remains LOCKED.`, 'success');
  }

  async function closeConnection(connectionId) {
    const entry = state.connections.find((item) => item.profile.connectionId === connectionId);
    await api(`/api/v8/connections/${encodeURIComponent(connectionId)}/close`, { method: 'POST', body: {} });
    await refresh({ quiet: true });
    showNotice(`${entry?.profile.name || connectionId} closed and ownership released.`, 'success');
  }

  async function removeConnection(connectionId) {
    const entry = state.connections.find((item) => item.profile.connectionId === connectionId);
    const label = entry?.profile.name || connectionId;
    if (!window.confirm(`Remove saved connection profile “${label}”? This does not delete v7 channel evidence.`)) return;
    await api(`/api/v8/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    state.ownerSelections.delete(connectionId);
    await refresh({ quiet: true });
    showNotice(`${label} profile removed.`, 'success');
  }

  function updateTransportFields() {
    const kind = els.transportKind.value;
    const serial = kind === 'serial-rtu' || kind === 'serial-ascii';
    const tcp = kind === 'tcp-client' || kind === 'tcp-server';
    document.querySelectorAll('.serial-field').forEach((field) => field.classList.toggle('hidden', !serial));
    document.querySelectorAll('.tcp-field').forEach((field) => field.classList.toggle('hidden', !tcp));
  }

  function formPayload(form) {
    const data = new FormData(form);
    const connectionId = String(data.get('connectionId') || '').trim();
    const name = String(data.get('name') || '').trim() || connectionId;
    const transportKind = String(data.get('transportKind') || 'serial-rtu');
    const payload = { connectionId, name, transportKind, metadata: {} };

    if (transportKind === 'serial-rtu' || transportKind === 'serial-ascii') {
      const port = String(data.get('serialPort') || '').trim();
      const baudRate = Number(data.get('baudRate') || 9600);
      const parity = String(data.get('parity') || 'none').toLowerCase();
      payload.transport = transportKind === 'serial-ascii' ? 'ASCII' : 'RTU';
      payload.endpoint = port;
      payload.serial = { port, baudRate, parity, dataBits: 8, stopBits: 1 };
    } else if (transportKind === 'tcp-client' || transportKind === 'tcp-server') {
      const host = String(data.get('tcpHost') || '').trim();
      const port = Number(data.get('tcpPort') || 502);
      payload.transport = 'TCP';
      payload.endpoint = `${host}:${port}`;
      payload.tcp = { host, port };
    } else if (transportKind === 'virtual') {
      payload.transport = 'VIRTUAL';
      payload.endpoint = 'Virtual loopback';
      payload.metadata.resourceKey = `virtual:${connectionId}`;
    }
    return payload;
  }

  function applyPreferences() {
    const theme = safeLocalStorageGet('modbus-v8-theme', 'system');
    const density = safeLocalStorageGet('modbus-v8-density', 'comfortable');
    document.documentElement.dataset.theme = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
    document.documentElement.dataset.density = ['comfortable', 'compact', 'dense'].includes(density) ? density : 'comfortable';
    els.themeButton.textContent = `Theme: ${document.documentElement.dataset.theme}`;
    els.densityButton.textContent = `Density: ${document.documentElement.dataset.density}`;
  }

  function cyclePreference(attribute, values, storageKey, button, label) {
    const current = document.documentElement.dataset[attribute];
    const next = values[(Math.max(0, values.indexOf(current)) + 1) % values.length];
    document.documentElement.dataset[attribute] = next;
    safeLocalStorageSet(storageKey, next);
    button.textContent = `${label}: ${next}`;
  }

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => showWorkspace(button.dataset.workspace));
  });

  els.projectSelect.addEventListener('change', async () => {
    try {
      await api(`/api/v8/projects/${encodeURIComponent(els.projectSelect.value)}/select`, { method: 'POST', body: {} });
      state.ownerSelections.clear();
      await refresh({ quiet: true });
      showNotice('Active project changed. Live v8 connections were closed before the switch.', 'success');
    } catch (error) { errorNotice(error); }
  });

  els.connectionRows.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-owner-for]');
    if (select) state.ownerSelections.set(select.dataset.ownerFor, select.value);
  });

  els.connectionRows.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('tr[data-connection-id]');
    const connectionId = row?.dataset.connectionId;
    if (!connectionId) return;
    button.disabled = true;
    try {
      if (button.dataset.action === 'open') await openConnection(connectionId);
      if (button.dataset.action === 'close') await closeConnection(connectionId);
      if (button.dataset.action === 'remove') await removeConnection(connectionId);
    } catch (error) {
      errorNotice(error);
      button.disabled = false;
    }
  });

  els.projectCards.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-project-select]');
    if (!button) return;
    try {
      await api(`/api/v8/projects/${encodeURIComponent(button.dataset.projectSelect)}/select`, { method: 'POST', body: {} });
      state.ownerSelections.clear();
      await refresh({ quiet: true });
      showNotice('Active project changed. Live v8 connections were closed before the switch.', 'success');
    } catch (error) { errorNotice(error); }
  });

  els.newConnectionButton.addEventListener('click', () => {
    els.connectionForm.reset();
    updateTransportFields();
    els.connectionDialog.showModal();
  });
  els.closeDialogButton.addEventListener('click', () => els.connectionDialog.close());
  els.cancelDialogButton.addEventListener('click', () => els.connectionDialog.close());
  els.transportKind.addEventListener('change', updateTransportFields);

  els.connectionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = formPayload(els.connectionForm);
      if (!payload.connectionId) throw new Error('Connection ID is required.');
      await api('/api/v8/connections', { method: 'POST', body: payload });
      els.connectionDialog.close();
      await refresh({ quiet: true });
      showNotice(`${payload.name} saved. It is inactive, unowned and WRITE LOCKED until explicitly opened.`, 'success');
    } catch (error) { errorNotice(error); }
  });

  els.refreshButton.addEventListener('click', () => refresh().catch(errorNotice));
  els.themeButton.addEventListener('click', () => cyclePreference('theme', ['system', 'light', 'dark'], 'modbus-v8-theme', els.themeButton, 'Theme'));
  els.densityButton.addEventListener('click', () => cyclePreference('density', ['comfortable', 'compact', 'dense'], 'modbus-v8-density', els.densityButton, 'Density'));

  applyPreferences();
  updateTransportFields();
  refresh().catch((error) => {
    errorNotice(error);
    renderTopStatus();
  });
})();
