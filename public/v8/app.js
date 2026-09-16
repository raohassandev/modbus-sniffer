'use strict';

(() => {
  const state = {
    status: null,
    projects: [],
    connections: [],
    selectedConnectionId: null,
    activeWorkspace: 'connections',
    socket: null,
    reconnectTimer: null,
    realtimeRefreshTimer: null,
    serialPorts: [],
    networkInterfaces: [],
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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
      error.details = payload?.error?.details || null;
      throw error;
    }
    return payload;
  }

  function toast(message, kind = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    $('#toastHost').appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function setMessage(message = '') { $('#connectionMessage').textContent = message; }
  function capitalize(value) { return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1); }

  function runtimeStateClass(runtime) {
    if (runtime?.state === 'open') return 'active';
    if (runtime?.state === 'error') return 'danger';
    if (runtime?.state === 'opening' || runtime?.state === 'closing') return 'warning';
    return 'neutral';
  }

  function writesClass(runtime) { return runtime?.writeLock === 'ENABLED' ? 'danger' : 'safe'; }

  function transportOptions(profile, group) {
    const direct = profile?.[group];
    if (direct && typeof direct === 'object') return direct;
    return profile?.metadata?.transportOptions?.[group] || {};
  }

  function isNetworkKind(kind) { return kind !== 'virtual' && !kind.startsWith('serial-'); }
  function isClientKind(kind) { return kind.endsWith('-client'); }
  function isTlsKind(kind) { return kind === 'tls-client' || kind === 'tls-server'; }

  function endpointText(profile) {
    const kind = String(profile?.transportKind || '').toLowerCase();
    if (kind.startsWith('serial-')) {
      const serial = profile.serial || {};
      return `${serial.path || profile.endpoint || '—'} · ${serial.baudRate || 9600} · ${String(serial.parity || 'none').toUpperCase()}`;
    }
    if (kind === 'virtual') return profile.endpoint || 'virtual';
    let options = profile.tcp || {};
    if (kind.startsWith('udp-') || kind.includes('-udp-')) options = { ...transportOptions(profile, 'udp'), ...transportOptions(profile, 'tunnel') };
    else if (kind.startsWith('tls-')) options = transportOptions(profile, 'tls');
    else if (kind.includes('-tcp-')) options = { ...(profile.tcp || {}), ...transportOptions(profile, 'tunnel') };
    const defaultPort = kind.startsWith('tls-') ? 802 : 502;
    return `${options.host || profile.endpoint || '—'}:${options.port ?? defaultPort}`;
  }

  function transportLabel(profile) {
    const kind = String(profile?.transportKind || profile?.transport || '').toLowerCase();
    const labels = {
      'serial-rtu': 'Serial RTU',
      'serial-ascii': 'Serial ASCII',
      'tcp-client': 'Modbus TCP Client',
      'tcp-server': 'Modbus TCP Server',
      'udp-client': 'Modbus UDP Client',
      'udp-server': 'Modbus UDP Server',
      'tls-client': 'Modbus TCP Security / TLS Client',
      'tls-server': 'Modbus TCP Security / TLS Server',
      'rtu-tcp-client': 'RTU over TCP Client',
      'rtu-tcp-server': 'RTU over TCP Server',
      'ascii-tcp-client': 'ASCII over TCP Client',
      'ascii-tcp-server': 'ASCII over TCP Server',
      'rtu-udp-client': 'RTU over UDP Client',
      'rtu-udp-server': 'RTU over UDP Server',
      'ascii-udp-client': 'ASCII over UDP Client',
      'ascii-udp-server': 'ASCII over UDP Server',
      virtual: 'Virtual',
    };
    return labels[kind] || kind || 'Unknown';
  }

  function actionButton(label, action, connectionId, kind, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button small ${kind}`;
    button.dataset.action = action;
    button.dataset.connectionId = connectionId;
    button.textContent = label;
    button.disabled = disabled;
    return button;
  }

  function connectionRow(item) {
    const profile = item.profile;
    const runtime = item.runtime || {};
    const tr = document.createElement('tr');
    tr.dataset.connectionId = profile.connectionId;
    if (state.selectedConnectionId === profile.connectionId) tr.classList.add('selected');

    const profileCell = document.createElement('td');
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = profile.name || profile.connectionId;
    const sub = document.createElement('div');
    sub.className = 'row-subtitle';
    sub.textContent = profile.connectionId;
    profileCell.append(title, sub);

    const transportCell = document.createElement('td');
    transportCell.textContent = transportLabel(profile);
    const endpointCell = document.createElement('td');
    endpointCell.className = 'mono';
    endpointCell.textContent = endpointText(profile);

    const runtimeCell = document.createElement('td');
    const runtimeChip = document.createElement('span');
    runtimeChip.className = `status-chip ${runtimeStateClass(runtime)}`;
    runtimeChip.textContent = String(runtime.state || 'defined').toUpperCase();
    runtimeCell.appendChild(runtimeChip);

    const ownerCell = document.createElement('td');
    const ownerChip = document.createElement('span');
    ownerChip.className = `status-chip ${runtime.owner ? 'active' : 'neutral'}`;
    ownerChip.textContent = runtime.owner?.ownerMode ? runtime.owner.ownerMode.toUpperCase() : 'NONE';
    ownerCell.appendChild(ownerChip);

    const writesCell = document.createElement('td');
    const writeChip = document.createElement('span');
    writeChip.className = `status-chip ${writesClass(runtime)}`;
    writeChip.textContent = runtime.writeLock === 'ENABLED' ? 'ENABLED' : 'LOCKED';
    writesCell.appendChild(writeChip);

    const actions = document.createElement('td');
    actions.className = 'actions-column';
    const wrap = document.createElement('div');
    wrap.className = 'row-actions';
    const isOpen = runtime.state === 'open';
    wrap.append(
      actionButton(isOpen ? 'Close' : 'Open', isOpen ? 'close' : 'open', profile.connectionId, isOpen ? 'secondary' : 'primary'),
      actionButton('Test', 'test', profile.connectionId, 'secondary', isOpen),
      actionButton('Duplicate', 'duplicate', profile.connectionId, 'secondary', isOpen),
      actionButton('Delete', 'delete', profile.connectionId, 'destructive', isOpen),
    );
    actions.appendChild(wrap);
    tr.append(profileCell, transportCell, endpointCell, runtimeCell, ownerCell, writesCell, actions);
    return tr;
  }

  function renderConnections() {
    const filter = $('#connectionFilter').value.trim().toLowerCase();
    const visible = state.connections.filter((item) => {
      if (!filter) return true;
      return [item.profile.name, item.profile.connectionId, item.profile.transportKind, endpointText(item.profile)]
        .filter(Boolean).join(' ').toLowerCase().includes(filter);
    });
    const body = $('#connectionsBody');
    body.replaceChildren(...visible.map(connectionRow));
    $('#connectionsEmpty').hidden = state.connections.length !== 0;
    $('.table-wrap').hidden = state.connections.length === 0;

    const open = state.connections.filter((item) => item.runtime?.state === 'open');
    const serial = state.connections.filter((item) => String(item.profile.transportKind).startsWith('serial-'));
    const network = state.connections.filter((item) => isNetworkKind(String(item.profile.transportKind || '').toLowerCase()));
    const writes = state.connections.filter((item) => item.runtime?.writeLock === 'ENABLED');
    $('#metricProfiles').textContent = String(state.connections.length);
    $('#metricOpen').textContent = String(open.length);
    $('#metricSerial').textContent = String(serial.length);
    $('#metricTcp').textContent = String(network.length);
    $('#metricWrites').textContent = String(writes.length);

    const firstOpen = open[0];
    $('#activeConnectionChip').textContent = firstOpen ? (firstOpen.profile.name || firstOpen.profile.connectionId) : 'No active connection';
    $('#activeConnectionChip').className = `status-chip ${firstOpen ? 'active' : 'neutral'}`;
    $('#activeModeChip').textContent = firstOpen?.runtime?.owner?.ownerMode?.toUpperCase() || 'IDLE';
    $('#activeModeChip').className = `status-chip ${firstOpen ? 'active' : 'neutral'}`;
    $('#writeStateChip').textContent = firstOpen?.runtime?.writeLock === 'ENABLED' ? 'WRITES ENABLED' : 'WRITES LOCKED';
    $('#writeStateChip').className = `status-chip ${firstOpen?.runtime?.writeLock === 'ENABLED' ? 'danger' : 'safe'}`;
    renderInspector();
  }

  function renderInspector() {
    const item = state.connections.find((entry) => entry.profile.connectionId === state.selectedConnectionId);
    const host = $('#inspectorContent');
    if (!item) {
      host.innerHTML = '<div class="empty-inspector">Select a connection to inspect its profile, ownership and live transport diagnostics.</div>';
      return;
    }
    host.replaceChildren();
    const identity = document.createElement('div');
    identity.className = 'inspector-block';
    identity.innerHTML = '<h3>Connection</h3>';
    const details = document.createElement('dl');
    details.className = 'details-list';
    for (const [name, value] of [
      ['Name', item.profile.name || item.profile.connectionId],
      ['ID', item.profile.connectionId],
      ['Transport', transportLabel(item.profile)],
      ['Endpoint', endpointText(item.profile)],
      ['Runtime', item.runtime?.state || 'defined'],
      ['Owner', item.runtime?.owner?.ownerMode || 'none'],
      ['Writes', item.runtime?.writeLock || 'LOCKED'],
    ]) {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = name;
      dd.textContent = value;
      row.append(dt, dd);
      details.appendChild(row);
    }
    identity.appendChild(details);
    const diagnostics = document.createElement('div');
    diagnostics.className = 'inspector-block';
    diagnostics.innerHTML = '<h3>Diagnostics</h3>';
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.textContent = JSON.stringify(item.diagnostics || item.runtime || {}, null, 2);
    diagnostics.appendChild(pre);
    host.append(identity, diagnostics);
  }

  function renderProjects() {
    const select = $('#projectSelect');
    const activeId = state.status?.activeProjectId || state.projects.find((project) => project.active)?.id || '';
    select.replaceChildren(...state.projects.map((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      option.selected = project.id === activeId;
      return option;
    }));
    const active = state.projects.find((project) => project.id === activeId);
    $('#statusProject').textContent = `Project: ${active?.name || '—'}`;
    $('#statusSchema').textContent = `Schema: ${state.status?.schemaVersion ?? '—'}`;
  }

  function applyPreferences(ui = {}) {
    const theme = ['system', 'light', 'dark'].includes(ui.theme) ? ui.theme : 'system';
    const density = ['comfortable', 'compact', 'dense'].includes(ui.density) ? ui.density : 'comfortable';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
    $('#themeButton').textContent = `Theme: ${capitalize(theme)}`;
    $('#densityButton').textContent = `Density: ${capitalize(density)}`;
    $('#settingsTheme').value = theme;
    $('#settingsDensity').value = density;
    $('#contextInspector').classList.toggle('collapsed', Boolean(ui.layout?.inspectorCollapsed));
  }

  async function persistPreferences(patch) {
    const projectId = state.status?.activeProjectId;
    if (!projectId) return;
    const current = state.status?.activeProject?.ui || {};
    const next = {
      ...current,
      theme: document.documentElement.dataset.theme || 'system',
      density: document.documentElement.dataset.density || 'comfortable',
      layout: { ...(current.layout || {}), inspectorCollapsed: $('#contextInspector').classList.contains('collapsed') },
      ...patch,
    };
    const response = await api(`/api/v8/projects/${encodeURIComponent(projectId)}/ui`, { method: 'PATCH', body: JSON.stringify(next) });
    if (state.status?.activeProject) state.status.activeProject.ui = response.ui;
    applyPreferences(response.ui);
  }

  async function refresh({ quiet = false } = {}) {
    try {
      const [status, projects, connections] = await Promise.all([
        api('/api/v8/status'), api('/api/v8/projects'), api('/api/v8/connections'),
      ]);
      state.status = status;
      state.projects = projects.projects || [];
      state.connections = connections.connections || [];
      renderProjects();
      renderConnections();
      applyPreferences(status.activeProject?.ui || {});
      $('#statusLastUpdate').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
      setMessage(`${state.connections.length} profile${state.connections.length === 1 ? '' : 's'}`);
      if (!quiet) toast('Connection Center refreshed');
    } catch (error) {
      setMessage(error.message);
      if (!quiet) toast(error.message, 'error');
    }
  }

  function showWorkspace(name) {
    state.activeWorkspace = name;
    $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.workspace === name));
    $$('.workspace').forEach((node) => node.classList.remove('active'));
    if (name === 'connections') $('#workspace-connections').classList.add('active');
    else if (name === 'settings') $('#workspace-settings').classList.add('active');
    else {
      $('#workspace-placeholder').classList.add('active');
      $('#placeholderTitle').textContent = workspaceLabel(name);
      $('#placeholderName').textContent = workspaceLabel(name);
      const enabled = Boolean(state.status?.flags?.[`${name}Workspace`]);
      $('#placeholderText').textContent = enabled ? 'Runtime feature is enabled; browser integration is being completed.' : 'Feature-gated in the current v8 development build.';
    }
  }

  function workspaceLabel(name) {
    const labels = {
      master: 'Master Workstation', simulator: 'Slave / Server Simulator', traffic: 'Traffic', registerLab: 'Register Lab',
      testCenter: 'Test Center', charts: 'Charts & Logger', historian: 'Historian', discovery: 'Discovery', automation: 'Automation', hmi: 'HMI Builder',
    };
    return labels[name] || capitalize(name);
  }

  function updateTransportFields() {
    const kind = $('#connectionTransport').value;
    const serial = kind.startsWith('serial-');
    const network = isNetworkKind(kind);
    const client = network && isClientKind(kind);
    const tls = isTlsKind(kind);
    $$('.serial-field').forEach((node) => node.classList.toggle('hidden', !serial));
    $$('.network-field').forEach((node) => node.classList.toggle('hidden', !network));
    $$('.network-client-field').forEach((node) => node.classList.toggle('hidden', !client));
    $$('.tls-field').forEach((node) => node.classList.toggle('hidden', !tls));
    $$('.tls-client-field').forEach((node) => node.classList.toggle('hidden', kind !== 'tls-client'));
    $$('.tls-server-field').forEach((node) => node.classList.toggle('hidden', kind !== 'tls-server'));
    if (network && !client && $('#tcpHost').value === '') $('#tcpHost').value = '127.0.0.1';
    $('#tcpPort').value = kind.startsWith('tls-') ? '802' : ($('#tcpPort').dataset.lastKind === 'tls' ? '502' : $('#tcpPort').value || '502');
    $('#tcpPort').dataset.lastKind = kind.startsWith('tls-') ? 'tls' : 'other';
  }

  async function loadSystemOptions() {
    const [portsResult, interfacesResult] = await Promise.allSettled([
      api('/api/v8/system/serial-ports'), api('/api/v8/system/network-interfaces'),
    ]);
    state.serialPorts = portsResult.status === 'fulfilled' ? portsResult.value.ports || [] : [];
    state.networkInterfaces = interfacesResult.status === 'fulfilled' ? interfacesResult.value.interfaces || [] : [];
    const serialSelect = $('#serialPath');
    const prior = serialSelect.value;
    serialSelect.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = state.serialPorts.length ? 'Select port…' : 'No serial ports found';
    serialSelect.appendChild(empty);
    for (const port of state.serialPorts) {
      const option = document.createElement('option');
      option.value = port.path;
      option.textContent = [port.path, port.manufacturer].filter(Boolean).join(' — ');
      serialSelect.appendChild(option);
    }
    if (prior && state.serialPorts.some((port) => port.path === prior)) serialSelect.value = prior;

    const networkSelect = $('#tcpLocalAddress');
    networkSelect.replaceChildren();
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = 'Automatic';
    networkSelect.appendChild(automatic);
    for (const entry of state.networkInterfaces) {
      const option = document.createElement('option');
      option.value = entry.address;
      option.textContent = `${entry.interfaceName} — ${entry.address} (${entry.family})`;
      networkSelect.appendChild(option);
    }
  }

  async function openConnectionDialog() {
    $('#connectionForm').reset();
    $('#connectionId').disabled = false;
    $('#connectionDialogTitle').textContent = 'New Connection';
    $('#connectionTransport').value = 'serial-rtu';
    $('#serialBaud').value = '9600';
    $('#serialParity').value = 'none';
    $('#tcpHost').value = '127.0.0.1';
    $('#tcpPort').value = '502';
    $('#tcpPort').dataset.lastKind = 'other';
    $('#tlsVerifyServer').checked = true;
    $('#tlsRequestClient').checked = false;
    $('#tlsVerifyClient').checked = false;
    $('#dialogError').textContent = '';
    updateTransportFields();
    await loadSystemOptions();
    $('#connectionDialog').showModal();
  }

  function networkPayload(kind, host, port) {
    const localAddress = $('#tcpLocalAddress').value || null;
    if (kind === 'tcp-client' || kind === 'tcp-server') {
      return { tcp: { host, port, ...(kind === 'tcp-client' && localAddress ? { localAddress } : {}) } };
    }
    if (kind === 'udp-client' || kind === 'udp-server') {
      return { udp: { host, port, ...(kind === 'udp-client' && localAddress ? { localAddress } : {}) } };
    }
    if (kind === 'tls-client' || kind === 'tls-server') {
      return {
        tls: {
          host,
          port,
          ...(kind === 'tls-client' && localAddress ? { localAddress } : {}),
          caPath: $('#tlsCaPath').value.trim() || null,
          certPath: $('#tlsCertPath').value.trim() || null,
          keyPath: $('#tlsKeyPath').value.trim() || null,
          servername: kind === 'tls-client' ? ($('#tlsServername').value.trim() || null) : null,
          rejectUnauthorized: kind === 'tls-client' ? $('#tlsVerifyServer').checked : $('#tlsVerifyClient').checked,
          requestCert: kind === 'tls-server' ? $('#tlsRequestClient').checked : false,
          minVersion: 'TLSv1.2',
        },
      };
    }
    if (kind.includes('-tcp-') || kind.includes('-udp-')) {
      return { tunnel: { host, port, ...(localAddress && isClientKind(kind) ? { localAddress } : {}) } };
    }
    return {};
  }

  function connectionPayload() {
    const connectionId = $('#connectionId').value.trim();
    const name = $('#connectionName').value.trim();
    const transportKind = $('#connectionTransport').value;
    const payload = { connectionId, name: name || connectionId, transportKind, transport: transportKind.toUpperCase() };
    if (transportKind.startsWith('serial-')) {
      const path = $('#serialPath').value.trim();
      payload.endpoint = path;
      payload.serial = { path, baudRate: Number($('#serialBaud').value), dataBits: 8, stopBits: 1, parity: $('#serialParity').value };
    } else if (isNetworkKind(transportKind)) {
      const host = $('#tcpHost').value.trim();
      const port = Number($('#tcpPort').value);
      payload.endpoint = host;
      Object.assign(payload, networkPayload(transportKind, host, port));
    } else {
      payload.endpoint = 'virtual';
    }
    return payload;
  }

  async function saveConnection(event) {
    event.preventDefault();
    const payload = connectionPayload();
    $('#dialogError').textContent = '';
    try {
      await api('/api/v8/connections', { method: 'POST', body: JSON.stringify(payload) });
      $('#connectionDialog').close();
      toast(`Saved ${payload.name || payload.connectionId}`);
      await refresh({ quiet: true });
      state.selectedConnectionId = payload.connectionId;
      renderConnections();
    } catch (error) { $('#dialogError').textContent = error.message; }
  }

  async function runConnectionAction(action, connectionId) {
    const encoded = encodeURIComponent(connectionId);
    try {
      if (action === 'open') {
        await api(`/api/v8/connections/${encoded}/open`, { method: 'POST', body: JSON.stringify({ ownerMode: 'master' }) });
        toast(`Opened ${connectionId}`);
      } else if (action === 'close') {
        await api(`/api/v8/connections/${encoded}/close`, { method: 'POST', body: '{}' });
        toast(`Closed ${connectionId}`);
      } else if (action === 'test') {
        setMessage(`Testing ${connectionId}…`);
        const result = await api(`/api/v8/connections/${encoded}/test`, { method: 'POST', body: '{}' });
        toast(`Connection test passed in ${result.result.elapsedMs} ms`);
      } else if (action === 'duplicate') {
        const nextId = `${connectionId}-copy-${Date.now().toString(36).slice(-4)}`;
        await api(`/api/v8/connections/${encoded}/duplicate`, { method: 'POST', body: JSON.stringify({ connectionId: nextId }) });
        toast(`Duplicated ${connectionId}`);
      } else if (action === 'delete') {
        if (!window.confirm(`Delete connection profile “${connectionId}”?`)) return;
        await api(`/api/v8/connections/${encoded}`, { method: 'DELETE' });
        if (state.selectedConnectionId === connectionId) state.selectedConnectionId = null;
        toast(`Deleted ${connectionId}`);
      }
      await refresh({ quiet: true });
    } catch (error) {
      setMessage(error.message);
      toast(error.message, 'error');
    }
  }

  async function switchProject(projectId) {
    try {
      await api(`/api/v8/projects/${encodeURIComponent(projectId)}/active`, { method: 'POST', body: '{}' });
      state.selectedConnectionId = null;
      await refresh({ quiet: true });
      toast('Project switched');
    } catch (error) {
      toast(error.message, 'error');
      renderProjects();
    }
  }

  async function exportProfiles() {
    try {
      const payload = await api('/api/v8/connections/export');
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `modbus-v8-connections-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast('Connection profiles exported');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function importProfiles(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const result = await api('/api/v8/connections/import', { method: 'POST', body: JSON.stringify(payload) });
      toast(`Imported ${result.imported.length} profile${result.imported.length === 1 ? '' : 's'}`);
      await refresh({ quiet: true });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      $('#importFile').value = '';
    }
  }

  function connectRealtime() {
    if (state.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.socket.readyState)) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/ws/v8`);
    state.socket = socket;
    socket.addEventListener('open', () => {
      $('#wsStatusDot').className = 'status-dot online';
      $('#wsStatus').textContent = 'Realtime connected';
    });
    socket.addEventListener('message', (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === 'runtime.event' || payload.type?.startsWith('connection.') || payload.type?.startsWith('project.')) {
        clearTimeout(state.realtimeRefreshTimer);
        state.realtimeRefreshTimer = setTimeout(() => refresh({ quiet: true }), 100);
      }
    });
    socket.addEventListener('close', () => {
      $('#wsStatusDot').className = 'status-dot offline';
      $('#wsStatus').textContent = 'Realtime disconnected';
      state.socket = null;
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connectRealtime, 1500);
    });
    socket.addEventListener('error', () => socket.close());
  }

  function bindEvents() {
    $('#newConnection').addEventListener('click', openConnectionDialog);
    $$('[data-action="new-connection"]').forEach((button) => button.addEventListener('click', openConnectionDialog));
    $('#refreshConnections').addEventListener('click', () => refresh());
    $('#connectionFilter').addEventListener('input', renderConnections);
    $('#connectionTransport').addEventListener('change', updateTransportFields);
    $('#reloadPorts').addEventListener('click', () => loadSystemOptions().catch((error) => toast(error.message, 'error')));
    $('#connectionForm').addEventListener('submit', saveConnection);
    $('[data-dialog-cancel]').addEventListener('click', () => $('#connectionDialog').close());
    $('#projectSelect').addEventListener('change', (event) => switchProject(event.target.value));
    $('#exportConnections').addEventListener('click', exportProfiles);
    $('#importConnections').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (event) => importProfiles(event.target.files?.[0]));

    $('#connectionsBody').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action][data-connection-id]');
      if (button) {
        event.stopPropagation();
        runConnectionAction(button.dataset.action, button.dataset.connectionId);
        return;
      }
      const row = event.target.closest('tr[data-connection-id]');
      if (row) {
        state.selectedConnectionId = row.dataset.connectionId;
        renderConnections();
      }
    });

    $('#navList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-workspace]');
      if (button) showWorkspace(button.dataset.workspace);
    });

    $('#themeButton').addEventListener('click', async () => {
      const order = ['system', 'light', 'dark'];
      const current = document.documentElement.dataset.theme || 'system';
      document.documentElement.dataset.theme = order[(order.indexOf(current) + 1) % order.length];
      await persistPreferences({}).catch((error) => toast(error.message, 'error'));
    });

    $('#densityButton').addEventListener('click', async () => {
      const order = ['comfortable', 'compact', 'dense'];
      const current = document.documentElement.dataset.density || 'comfortable';
      document.documentElement.dataset.density = order[(order.indexOf(current) + 1) % order.length];
      await persistPreferences({}).catch((error) => toast(error.message, 'error'));
    });

    $('#saveSettings').addEventListener('click', async () => {
      document.documentElement.dataset.theme = $('#settingsTheme').value;
      document.documentElement.dataset.density = $('#settingsDensity').value;
      try {
        await persistPreferences({});
        toast('Workspace preferences saved');
      } catch (error) { toast(error.message, 'error'); }
    });

    $('#toggleInspector').addEventListener('click', async () => {
      $('#contextInspector').classList.toggle('collapsed');
      try { await persistPreferences({}); } catch (error) { toast(error.message, 'error'); }
    });
  }

  async function init() {
    bindEvents();
    showWorkspace('connections');
    await refresh({ quiet: true });
    connectRealtime();
  }

  init().catch((error) => {
    setMessage(error.message);
    toast(error.message, 'error');
  });
})();
