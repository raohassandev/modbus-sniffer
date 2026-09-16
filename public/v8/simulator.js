'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { connections: [], servers: [], devices: [], selectedServerId: null, selectedDeviceId: null, memory: null, audit: [], clients: [] };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
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
    <section id="workspace-simulator" class="workspace" aria-labelledby="simulatorTitle">
      <div class="workspace-header">
        <div><h1 id="simulatorTitle">Slave / Server Simulator</h1><p>Persistent virtual devices, editable memory, dynamic values and an isolated LAB fault-injection mode.</p></div>
        <div class="toolbar"><button id="simulatorRefresh" class="button secondary" type="button">Refresh</button></div>
      </div>
      <div class="metric-strip">
        <div class="metric-card"><span class="metric-label">Servers</span><strong id="simMetricServers">0</strong></div>
        <div class="metric-card"><span class="metric-label">Running</span><strong id="simMetricRunning">0</strong></div>
        <div class="metric-card"><span class="metric-label">Devices</span><strong id="simMetricDevices">0</strong></div>
        <div class="metric-card"><span class="metric-label">LAB faults</span><strong id="simMetricLab">OFF</strong></div>
        <div class="metric-card"><span class="metric-label">Write audit</span><strong id="simMetricAudit">0</strong></div>
      </div>

      <div class="simulator-layout">
        <div class="simulator-stack">
          <div class="panel simulator-card">
            <div class="panel-title-row"><div><h2>Servers</h2><p class="simulator-subtitle">One simulator owner per connection.</p></div></div>
            <div class="simulator-form-grid">
              <label class="field"><span>Server ID</span><input id="simServerId" class="text-input" value="sim-1"></label>
              <label class="field"><span>Name</span><input id="simServerName" class="text-input" value="Simulator 1"></label>
              <label class="field"><span>Framing</span><select id="simServerFraming"><option value="rtu">RTU</option><option value="ascii">ASCII</option><option value="tcp">TCP</option></select></label>
              <label class="field"><span>Connection</span><select id="simServerConnection"></select></label>
              <label class="field"><span>Receive poll ms</span><input id="simReceivePoll" class="text-input" type="number" min="1" max="60000" value="10"></label>
            </div>
            <div class="simulator-actions"><button id="simSaveServer" class="button primary" type="button">Save server</button><button id="simStartServer" class="button secondary" type="button" disabled>Start</button><button id="simStopServer" class="button secondary" type="button" disabled>Stop</button><button id="simDeleteServer" class="button destructive" type="button" disabled>Delete</button></div>
            <div id="simServerList" class="simulator-list"></div>
          </div>

          <div class="panel simulator-card">
            <div class="panel-title-row"><div><h2>Devices</h2><p class="simulator-subtitle">Unit identity and memory sizes are persisted per server.</p></div></div>
            <div class="simulator-form-grid">
              <label class="field"><span>Unit ID</span><input id="simDeviceUnit" class="text-input" type="number" min="1" max="255" value="1"></label>
              <label class="field"><span>Name</span><input id="simDeviceName" class="text-input" value="Virtual Unit 1"></label>
              <label class="field"><span>Vendor</span><input id="simVendor" class="text-input" value="Automatrix"></label>
              <label class="field"><span>Product code</span><input id="simProduct" class="text-input" value="SIM-V8"></label>
              <label class="field"><span>Revision</span><input id="simRevision" class="text-input" value="8.0"></label>
            </div>
            <div class="simulator-form-grid compact" style="margin-top:10px">
              <label class="field"><span>Coils</span><input id="simSizeCoils" class="text-input" type="number" value="256"></label>
              <label class="field"><span>Discrete inputs</span><input id="simSizeDiscrete" class="text-input" type="number" value="256"></label>
              <label class="field"><span>Holding registers</span><input id="simSizeHolding" class="text-input" type="number" value="256"></label>
              <label class="field"><span>Input registers</span><input id="simSizeInput" class="text-input" type="number" value="256"></label>
            </div>
            <div class="simulator-actions"><button id="simSaveDevice" class="button primary" type="button" disabled>Save device</button><button id="simDeleteDevice" class="button destructive" type="button" disabled>Delete device</button></div>
            <div id="simDeviceList" class="simulator-list"></div>
          </div>
        </div>

        <div class="simulator-stack">
          <div class="panel simulator-card">
            <div class="panel-title-row"><div><h2>Memory editor</h2><p class="simulator-subtitle">Local simulator data only; editing here is not a bus write command.</p></div><span class="status-chip safe">SIMULATOR DATA</span></div>
            <div class="simulator-form-grid compact">
              <label class="field"><span>Area</span><select id="simMemoryArea"><option value="holdingRegisters">Holding registers</option><option value="inputRegisters">Input registers</option><option value="coils">Coils</option><option value="discreteInputs">Discrete inputs</option></select></label>
              <label class="field"><span>Start address</span><input id="simMemoryAddress" class="text-input" type="number" min="0" value="0"></label>
              <label class="field"><span>Quantity</span><input id="simMemoryQuantity" class="text-input" type="number" min="1" max="64" value="16"></label>
              <label class="field"><span>Seed values</span><input id="simMemorySeed" class="text-input" placeholder="10,20,30,40"></label>
            </div>
            <div class="simulator-actions"><button id="simReadMemory" class="button secondary" type="button" disabled>Read window</button><button id="simSeedMemory" class="button primary" type="button" disabled>Seed values</button></div>
            <div id="simMemoryValues" class="simulator-memory-values"></div>
          </div>

          <div class="panel simulator-card">
            <div class="panel-title-row"><div><h2>Dynamic value generators</h2><p class="simulator-subtitle">Timer-driven updates never block the protocol response path.</p></div></div>
            <div class="simulator-form-grid compact">
              <label class="field"><span>Generator ID</span><input id="simGeneratorId" class="text-input" value="gen-1"></label>
              <label class="field"><span>Kind</span><select id="simGeneratorKind"><option>constant</option><option selected>counter</option><option>sawtooth</option><option>sine</option><option>random</option><option>timestamp</option><option>formula</option><option>schedule</option></select></label>
              <label class="field"><span>Area</span><select id="simGeneratorArea"><option value="holdingRegisters">Holding registers</option><option value="inputRegisters">Input registers</option><option value="coils">Coils</option><option value="discreteInputs">Discrete inputs</option></select></label>
              <label class="field"><span>Address</span><input id="simGeneratorAddress" class="text-input" type="number" value="0"></label>
              <label class="field"><span>Interval ms</span><input id="simGeneratorInterval" class="text-input" type="number" min="20" value="250"></label>
              <label class="field"><span>Parameters JSON</span><textarea id="simGeneratorParams" class="text-input simulator-json">{"start":0,"step":1,"min":0,"max":100,"wrap":true}</textarea></label>
            </div>
            <div class="simulator-actions"><button id="simSaveGenerator" class="button primary" type="button" disabled>Save generator</button></div>
            <div id="simGeneratorList" class="simulator-list"></div>
          </div>

          <div class="panel simulator-card">
            <div class="simulator-warning"><strong>FAULT INJECTION LAB — disabled by default</strong><p>Faults apply only inside this Simulator runtime. Arming requires explicit confirmation and is never persisted.</p></div>
            <div class="simulator-lab-grid">
              <label class="field"><span>Delay ms</span><input id="simFaultDelay" class="text-input" type="number" min="0" value="0"></label>
              <label class="field"><span>Jitter ms</span><input id="simFaultJitter" class="text-input" type="number" min="0" value="0"></label>
              <label class="field"><span>Drop every N</span><input id="simFaultDrop" class="text-input" type="number" min="0" value="0"></label>
              <label class="field"><span>Exception code</span><input id="simFaultExceptionCode" class="text-input" type="number" min="0" max="255" value="0"></label>
              <label class="field"><span>Exception every N</span><input id="simFaultExceptionEvery" class="text-input" type="number" min="0" value="0"></label>
              <label class="field"><span>Duplicate every N</span><input id="simFaultDuplicate" class="text-input" type="number" min="0" value="0"></label>
              <label class="field"><span>Truncate bytes</span><input id="simFaultTruncate" class="text-input" type="number" min="0" value="0"></label>
              <label class="check-field"><input id="simFaultConfirm" type="checkbox"><span>I confirm LAB-only fault injection</span></label>
            </div>
            <div class="simulator-actions"><button id="simArmFault" class="button destructive" type="button" disabled>Arm LAB faults</button><button id="simDisarmFault" class="button secondary" type="button" disabled>Disarm</button><span id="simFaultState" class="status-chip safe">LAB OFF</span></div>
          </div>

          <div class="panel simulator-card">
            <div class="panel-title-row"><div><h2>Observed writes & TCP clients</h2><p class="simulator-subtitle">Exact incoming write evidence is retained in-process for the running server.</p></div></div>
            <div class="table-wrap simulator-audit"><table class="data-table"><thead><tr><th>Time</th><th>Unit</th><th>FC</th><th>Client</th><th>Raw HEX</th></tr></thead><tbody id="simAuditBody"></tbody></table></div>
            <div id="simClients" class="simulator-list"></div>
          </div>
        </div>
      </div>
    </section>`;
  }

  function install() {
    if ($('#workspace-simulator')) return;
    $('.workspace-host')?.insertAdjacentHTML('beforeend', workspaceHtml());
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/v8/simulator.css'; document.head.appendChild(css);
  }

  function selectedServer() { return state.servers.find((item) => item.serverId === state.selectedServerId) || null; }
  function selectedDevice() { return state.devices.find((item) => item.deviceId === state.selectedDeviceId) || null; }
  function running(server) { return Boolean(server?.runtime?.running); }

  function renderConnections() {
    const select = $('#simServerConnection');
    const previous = select.value;
    const eligible = state.connections.filter((item) => ['serial-rtu', 'serial-ascii', 'tcp-server', 'virtual'].includes(item.profile?.transportKind));
    select.replaceChildren(...eligible.map((item) => {
      const option = document.createElement('option'); option.value = item.profile.connectionId; option.textContent = `${item.profile.name || item.profile.connectionId} · ${item.profile.transportKind}`; return option;
    }));
    if (eligible.some((item) => item.profile.connectionId === previous)) select.value = previous;
  }

  function renderServers() {
    const host = $('#simServerList');
    host.replaceChildren(...state.servers.map((server) => {
      const row = document.createElement('div'); row.className = `simulator-list-item${server.serverId === state.selectedServerId ? ' selected' : ''}`;
      row.innerHTML = `<div><strong>${server.name || server.serverId}</strong><small>${server.serverId} · ${server.framing.toUpperCase()} · ${server.connectionId}</small></div><span class="status-chip ${running(server) ? 'active' : 'neutral'}">${running(server) ? 'RUNNING' : 'STOPPED'}</span>`;
      row.addEventListener('click', () => { selectServer(server.serverId).catch((error) => toast(error.message, 'error')); });
      return row;
    }));
    const server = selectedServer();
    $('#simStartServer').disabled = !server || running(server);
    $('#simStopServer').disabled = !server || !running(server);
    $('#simDeleteServer').disabled = !server || running(server);
    $('#simSaveDevice').disabled = !server || running(server);
    $('#simMetricServers').textContent = String(state.servers.length);
    $('#simMetricRunning').textContent = String(state.servers.filter(running).length);
    $('#simMetricLab').textContent = state.servers.some((item) => item.runtime?.faultLab?.enabled) ? 'ARMED' : 'OFF';
    $('#simFaultState').textContent = server?.runtime?.faultLab?.enabled ? 'LAB ARMED' : 'LAB OFF';
    $('#simFaultState').className = `status-chip ${server?.runtime?.faultLab?.enabled ? 'danger' : 'safe'}`;
    $('#simArmFault').disabled = !server || !running(server) || server.runtime?.faultLab?.enabled;
    $('#simDisarmFault').disabled = !server || !running(server) || !server.runtime?.faultLab?.enabled;
  }

  function renderDevices() {
    const host = $('#simDeviceList');
    const serverDevices = state.devices.filter((item) => item.serverId === state.selectedServerId);
    host.replaceChildren(...serverDevices.map((device) => {
      const row = document.createElement('div'); row.className = `simulator-list-item${device.deviceId === state.selectedDeviceId ? ' selected' : ''}`;
      row.innerHTML = `<div><strong>${device.name || `Unit ${device.unitId}`}</strong><small>Unit ${device.unitId} · HR ${device.sizes?.holdingRegisters ?? 0} · IR ${device.sizes?.inputRegisters ?? 0}</small></div><span class="status-chip neutral">U${device.unitId}</span>`;
      row.addEventListener('click', () => { state.selectedDeviceId = device.deviceId; populateDevice(device); renderDevices(); refreshMemory().catch(() => undefined); });
      return row;
    }));
    const device = selectedDevice();
    const server = selectedServer();
    $('#simDeleteDevice').disabled = !device || running(server);
    $('#simReadMemory').disabled = !device;
    $('#simSeedMemory').disabled = !device;
    $('#simSaveGenerator').disabled = !device;
    $('#simMetricDevices').textContent = String(state.devices.length);
    renderGenerators(device);
  }

  function populateDevice(device) {
    $('#simDeviceUnit').value = device.unitId;
    $('#simDeviceName').value = device.name || '';
    $('#simVendor').value = device.identity?.vendorName || '';
    $('#simProduct').value = device.identity?.productCode || '';
    $('#simRevision').value = device.identity?.revision || '';
    $('#simSizeCoils').value = device.sizes?.coils ?? 0;
    $('#simSizeDiscrete').value = device.sizes?.discreteInputs ?? 0;
    $('#simSizeHolding').value = device.sizes?.holdingRegisters ?? 0;
    $('#simSizeInput').value = device.sizes?.inputRegisters ?? 0;
  }

  function renderGenerators(device) {
    const host = $('#simGeneratorList');
    host.replaceChildren(...((device?.generators || []).map((generator) => {
      const row = document.createElement('div'); row.className = 'simulator-list-item';
      row.innerHTML = `<div><strong>${generator.generatorId}</strong><small>${generator.kind} · ${generator.area} @ ${generator.address} · ${generator.intervalMs} ms</small></div>`;
      const button = document.createElement('button'); button.className = 'button small destructive'; button.type = 'button'; button.textContent = 'Remove';
      button.addEventListener('click', (event) => { event.stopPropagation(); removeGenerator(generator.generatorId).catch((error) => toast(error.message, 'error')); });
      row.appendChild(button); return row;
    })));
  }

  function renderMemory() {
    const host = $('#simMemoryValues');
    const memory = state.memory;
    if (!memory) { host.replaceChildren(); return; }
    host.replaceChildren(...memory.values.map((value, index) => {
      const cell = document.createElement('div'); cell.className = 'simulator-memory-cell';
      cell.innerHTML = `<span>${memory.address + index}</span><strong>${String(value)}</strong>`; return cell;
    }));
  }

  function renderAudit() {
    const body = $('#simAuditBody');
    body.replaceChildren(...state.audit.slice().reverse().map((item) => {
      const row = document.createElement('tr');
      for (const value of [new Date(item.timestamp).toLocaleTimeString(), item.unitId, `FC${String(item.functionCode).padStart(2, '0')}`, item.clientId || 'serial', item.rawHex]) { const td = document.createElement('td'); td.textContent = String(value); row.appendChild(td); }
      return row;
    }));
    $('#simMetricAudit').textContent = String(state.audit.length);
    const clients = $('#simClients');
    clients.replaceChildren(...state.clients.map((item) => {
      const row = document.createElement('div'); row.className = 'simulator-list-item'; row.innerHTML = `<div><strong>${item.clientId}</strong><small>${item.remoteAddress || '—'}:${item.remotePort || '—'} · requests ${item.requests}</small></div><span class="status-chip active">TCP</span>`; return row;
    }));
  }

  async function refresh() {
    const [connections, servers, devices] = await Promise.all([api('/api/v8/connections'), api('/api/v8/simulator/servers'), api('/api/v8/simulator/devices')]);
    state.connections = connections.connections || []; state.servers = servers.servers || []; state.devices = devices.devices || [];
    if (state.selectedServerId && !state.servers.some((item) => item.serverId === state.selectedServerId)) state.selectedServerId = null;
    if (!state.selectedServerId && state.servers.length) state.selectedServerId = state.servers[0].serverId;
    if (state.selectedDeviceId && !state.devices.some((item) => item.deviceId === state.selectedDeviceId)) state.selectedDeviceId = null;
    renderConnections(); renderServers(); renderDevices();
    if (state.selectedServerId && running(selectedServer())) await refreshRuntimeEvidence();
  }

  async function selectServer(serverId) {
    state.selectedServerId = serverId; state.selectedDeviceId = null; state.memory = null; state.audit = []; state.clients = [];
    const server = selectedServer();
    $('#simServerId').value = server.serverId; $('#simServerName').value = server.name || ''; $('#simServerFraming').value = server.framing; $('#simServerConnection').value = server.connectionId; $('#simReceivePoll').value = server.receivePollMs;
    renderServers(); renderDevices(); renderMemory(); renderAudit();
    if (running(server)) await refreshRuntimeEvidence();
  }

  async function saveServer() {
    const payload = { serverId: $('#simServerId').value.trim(), name: $('#simServerName').value.trim(), framing: $('#simServerFraming').value, connectionId: $('#simServerConnection').value, receivePollMs: Number($('#simReceivePoll').value) };
    const response = await api('/api/v8/simulator/servers', { method: 'POST', body: JSON.stringify(payload) }); state.selectedServerId = response.server.serverId; toast('Simulator server saved'); await refresh();
  }

  async function saveDevice() {
    const server = selectedServer(); if (!server) return;
    const unitId = Number($('#simDeviceUnit').value);
    const payload = { deviceId: state.selectedDeviceId || `${server.serverId}:unit:${unitId}`, serverId: server.serverId, unitId, name: $('#simDeviceName').value.trim(), identity: { vendorName: $('#simVendor').value.trim(), productCode: $('#simProduct').value.trim(), revision: $('#simRevision').value.trim() }, sizes: { coils: Number($('#simSizeCoils').value), discreteInputs: Number($('#simSizeDiscrete').value), holdingRegisters: Number($('#simSizeHolding').value), inputRegisters: Number($('#simSizeInput').value) } };
    const response = await api('/api/v8/simulator/devices', { method: 'POST', body: JSON.stringify(payload) }); state.selectedDeviceId = response.device.deviceId; toast('Virtual device saved'); await refresh();
  }

  async function startServer() { const server = selectedServer(); if (!server) return; await api(`/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/start`, { method: 'POST' }); toast('Simulator started'); await refresh(); }
  async function stopServer() { const server = selectedServer(); if (!server) return; await api(`/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/stop`, { method: 'POST' }); toast('Simulator stopped'); await refresh(); }
  async function deleteServer() { const server = selectedServer(); if (!server) return; await api(`/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}`, { method: 'DELETE' }); state.selectedServerId = null; state.selectedDeviceId = null; toast('Simulator server deleted'); await refresh(); }
  async function deleteDevice() { const device = selectedDevice(); if (!device) return; await api(`/api/v8/simulator/devices/${encodeURIComponent(device.deviceId)}`, { method: 'DELETE' }); state.selectedDeviceId = null; toast('Virtual device deleted'); await refresh(); }

  async function refreshMemory() {
    const device = selectedDevice(); if (!device) return;
    const area = $('#simMemoryArea').value, address = Number($('#simMemoryAddress').value), quantity = Number($('#simMemoryQuantity').value);
    const response = await api(`/api/v8/simulator/devices/${encodeURIComponent(device.deviceId)}/memory?area=${encodeURIComponent(area)}&address=${address}&quantity=${quantity}`); state.memory = response.memory; renderMemory();
  }

  function parseSeed(area, text) {
    return text.split(',').map((part) => part.trim()).filter(Boolean).map((part) => ['coils', 'discreteInputs'].includes(area) ? ['1', 'true', 'on'].includes(part.toLowerCase()) : Number(part));
  }

  async function seedMemory() {
    const device = selectedDevice(); if (!device) return;
    const area = $('#simMemoryArea').value, address = Number($('#simMemoryAddress').value), values = parseSeed(area, $('#simMemorySeed').value);
    if (!values.length) throw new Error('Enter comma-separated seed values');
    const response = await api(`/api/v8/simulator/devices/${encodeURIComponent(device.deviceId)}/memory`, { method: 'POST', body: JSON.stringify({ area, address, values }) }); state.memory = response.memory; renderMemory(); toast('Simulator memory updated'); await refresh();
  }

  async function saveGenerator() {
    const device = selectedDevice(); if (!device) return;
    let params; try { params = JSON.parse($('#simGeneratorParams').value || '{}'); } catch { throw new Error('Generator parameters must be valid JSON'); }
    const payload = { generatorId: $('#simGeneratorId').value.trim(), kind: $('#simGeneratorKind').value, area: $('#simGeneratorArea').value, address: Number($('#simGeneratorAddress').value), quantity: 1, intervalMs: Number($('#simGeneratorInterval').value), enabled: true, params };
    await api(`/api/v8/simulator/devices/${encodeURIComponent(device.deviceId)}/generators`, { method: 'POST', body: JSON.stringify(payload) }); toast('Generator saved'); await refresh();
  }
  async function removeGenerator(generatorId) { const device = selectedDevice(); if (!device) return; await api(`/api/v8/simulator/devices/${encodeURIComponent(device.deviceId)}/generators/${encodeURIComponent(generatorId)}`, { method: 'DELETE' }); toast('Generator removed'); await refresh(); }

  async function armFaults() {
    const server = selectedServer(); if (!server) return;
    if (!$('#simFaultConfirm').checked) throw new Error('Confirm LAB-only fault injection first');
    const policy = { responseDelayMs: Number($('#simFaultDelay').value), jitterMs: Number($('#simFaultJitter').value), dropEveryN: Number($('#simFaultDrop').value), forceExceptionCode: Number($('#simFaultExceptionCode').value), forceExceptionEveryN: Number($('#simFaultExceptionEvery').value), duplicateEveryN: Number($('#simFaultDuplicate').value), truncateBytes: Number($('#simFaultTruncate').value) };
    await api(`/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/fault-lab/arm`, { method: 'POST', body: JSON.stringify({ confirmed: true, policy }) }); $('#simFaultConfirm').checked = false; toast('FAULT INJECTION LAB armed', 'error'); await refresh();
  }
  async function disarmFaults() { const server = selectedServer(); if (!server) return; await api(`/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/fault-lab/disarm`, { method: 'POST' }); toast('Fault lab disarmed'); await refresh(); }

  async function refreshRuntimeEvidence() {
    const server = selectedServer(); if (!server || !running(server)) { state.audit = []; state.clients = []; renderAudit(); return; }
    const [audit, clients] = await Promise.all([api(`/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/write-audit?limit=100`), api(`/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/clients`)]);
    state.audit = audit.audit || []; state.clients = clients.clients || []; renderAudit();
  }

  function showWorkspace(event) {
    event?.stopPropagation();
    document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.workspace === 'simulator'));
    document.querySelectorAll('.workspace').forEach((node) => node.classList.remove('active'));
    $('#workspace-simulator')?.classList.add('active');
    refresh().catch((error) => toast(error.message, 'error'));
  }

  function bind() {
    document.querySelector('.nav-item[data-workspace="simulator"]')?.addEventListener('click', showWorkspace);
    $('#simulatorRefresh').addEventListener('click', () => refresh().catch((error) => toast(error.message, 'error')));
    $('#simSaveServer').addEventListener('click', () => saveServer().catch((error) => toast(error.message, 'error')));
    $('#simStartServer').addEventListener('click', () => startServer().catch((error) => toast(error.message, 'error')));
    $('#simStopServer').addEventListener('click', () => stopServer().catch((error) => toast(error.message, 'error')));
    $('#simDeleteServer').addEventListener('click', () => deleteServer().catch((error) => toast(error.message, 'error')));
    $('#simSaveDevice').addEventListener('click', () => saveDevice().catch((error) => toast(error.message, 'error')));
    $('#simDeleteDevice').addEventListener('click', () => deleteDevice().catch((error) => toast(error.message, 'error')));
    $('#simReadMemory').addEventListener('click', () => refreshMemory().catch((error) => toast(error.message, 'error')));
    $('#simSeedMemory').addEventListener('click', () => seedMemory().catch((error) => toast(error.message, 'error')));
    $('#simSaveGenerator').addEventListener('click', () => saveGenerator().catch((error) => toast(error.message, 'error')));
    $('#simArmFault').addEventListener('click', () => armFaults().catch((error) => toast(error.message, 'error')));
    $('#simDisarmFault').addEventListener('click', () => disarmFaults().catch((error) => toast(error.message, 'error')));
    $('#simMemoryArea').addEventListener('change', () => refreshMemory().catch(() => undefined));
  }

  install(); bind();
})();
