'use strict';

(()=>{
  const meta = ['Modbus Master', 'Direct polling, live values and guarded writes for RTU, ASCII and TCP devices'];
  try { pageMeta.master = meta; } catch { /* stable shell unavailable */ }

  const nav = document.querySelector('.nav');
  const main = document.querySelector('main');
  if (!nav || !main || document.getElementById('page-master')) return;

  const analysisNav = nav.querySelector('[data-page="analysis"]');
  const masterNav = document.createElement('button');
  masterNav.className = 'nav-item';
  masterNav.dataset.page = 'master';
  masterNav.innerHTML = '<span>▶</span> Master';
  if (analysisNav?.nextSibling) nav.insertBefore(masterNav, analysisNav.nextSibling);
  else nav.appendChild(masterNav);

  main.insertAdjacentHTML('beforeend', `
    <section class="page" id="page-master">
      <div class="master-workspace">
        <div class="master-intro">
          <div><h2>Modbus Master</h2><p>Connect directly to a Modbus device, read FC01–FC04, and monitor live values. This mode actively transmits requests.</p></div>
          <div class="master-top-status">
            <span class="master-status-chip" id="masterConnectionChip"><i></i><span>Disconnected</span></span>
            <span class="master-status-chip locked">🔒 WRITES LOCKED</span>
            <span class="master-status-chip">Active polling mode</span>
          </div>
        </div>

        <div class="master-grid">
          <article class="master-card">
            <div class="master-card-head"><div><h3><span class="master-section-number">1</span>Connection & Session</h3><p>Choose RTU, ASCII or TCP and connect directly to the target.</p></div></div>
            <div class="master-card-body">
              <label class="master-mode-hint active">ACTIVE MODE — Master transmits Modbus requests. Passive Analyzer remains a separate RX-only mode.</label>
              <div class="master-fields" style="margin-top:11px">
                <div class="span-2"><label>Connection Type</label><div class="master-segments" id="masterConnectionType"><button type="button" data-master-type="rtu" class="active">RTU</button><button type="button" data-master-type="ascii">ASCII</button><button type="button" data-master-type="tcp">TCP</button></div></div>
                <div class="master-connection-fields span-2" id="masterSerialFields">
                  <div class="master-fields">
                    <label>COM / Serial Port<select id="masterSerialPort"><option value="">Select port…</option></select></label>
                    <label>Baud Rate<select id="masterBaud"><option>2400</option><option>4800</option><option selected>9600</option><option>19200</option><option>38400</option><option>57600</option><option>115200</option></select></label>
                    <label>Parity<select id="masterParity"><option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option><option value="mark">Mark</option><option value="space">Space</option></select></label>
                    <label>Data Bits<select id="masterDataBits"><option selected>8</option><option>7</option></select></label>
                    <label>Stop Bits<select id="masterStopBits"><option selected>1</option><option>2</option></select></label>
                    <label>Echo Suppression<select id="masterEcho"><option value="false" selected>Off</option><option value="true">On</option></select></label>
                    <label>RS-485 RTS Mode<select id="masterRtsMode"><option value="none" selected>None</option><option value="high-during-tx">High during TX</option><option value="low-during-tx">Low during TX</option></select></label>
                    <label>RTS Settle (ms)<input id="masterRtsSettle" type="number" min="0" max="60000" value="0"></label>
                  </div>
                </div>
                <div class="master-connection-fields span-2" id="masterTcpFields" hidden>
                  <div class="master-fields"><label>IP / Host<input id="masterTcpHost" placeholder="192.168.1.50"></label><label>TCP Port<input id="masterTcpPort" type="number" min="1" max="65535" value="502"></label></div>
                </div>
                <label>Timeout (ms)<input id="masterTimeout" type="number" min="50" max="60000" value="1000"></label>
                <label>Poll Interval (ms)<input id="masterPollInterval" type="number" min="50" max="60000" value="1000"></label>
                <label>Read Retries<input id="masterRetries" type="number" min="0" max="10" value="0"></label>
                <label>Retry Delay (ms)<input id="masterRetryDelay" type="number" min="0" max="60000" value="100"></label>
                <label>Inter-request Delay (ms)<input id="masterInterRequestDelay" type="number" min="0" max="60000" value="0"></label>
              </div>
              <div class="master-button-row"><button class="master-primary" id="masterConnect">Connect</button><button class="master-secondary" id="masterDisconnect" disabled>Disconnect</button><button class="master-secondary" id="masterRefreshPorts">Refresh Ports</button></div>
              <div class="master-note" id="masterConnectionNote" style="margin-top:11px"><strong>Disconnected.</strong> Choose a connection and press Connect.</div>
            </div>
          </article>

          <article class="master-card">
            <div class="master-card-head"><div><h3><span class="master-section-number">2</span>Read Monitor</h3><p>Define a normal Modbus Poll / ModScan style read.</p></div></div>
            <div class="master-card-body">
              <div class="master-fields">
                <label>Unit / Slave ID<input id="masterUnitId" type="number" min="1" max="247" value="1"></label>
                <label>Function Code<select id="masterFunction"><option value="1">FC01 — Read Coils</option><option value="2">FC02 — Read Discrete Inputs</option><option value="3" selected>FC03 — Read Holding Registers</option><option value="4">FC04 — Read Input Registers</option></select></label>
                <label>Start Address<input id="masterAddress" type="number" min="0" max="65535" value="0"></label>
                <label>Quantity<input id="masterQuantity" type="number" min="1" max="125" value="10"></label>
                <div class="span-2"><label>Address Mode</label><div class="master-segments" id="masterAddressMode"><button type="button" class="active" data-address-mode="raw">0-based (PDU)</button><button type="button" data-address-mode="reference">Reference (0xxxx / 1xxxx / 3xxxx / 4xxxx)</button><button type="button" disabled id="masterAddressHint">Raw request uses PDU address</button></div></div>
              </div>
              <div class="master-button-row"><button class="master-secondary" id="masterReadOnce" disabled>▶ Read Once</button><button class="master-primary" id="masterStartPolling" disabled>↻ Start Polling</button><button class="master-secondary" id="masterPausePolling" disabled>Ⅱ Pause</button><button class="master-secondary" id="masterStopPolling" disabled>■ Stop</button></div>
              <div class="master-counters"><div class="master-counter"><span>Tx Requests</span><strong id="masterTx">0</strong></div><div class="master-counter"><span>Rx Responses</span><strong id="masterRx">0</strong></div><div class="master-counter"><span>Errors</span><strong id="masterErrors">0</strong></div><div class="master-counter"><span>Timeouts</span><strong id="masterTimeouts">0</strong></div><div class="master-counter"><span>Retries</span><strong id="masterRetryCount">0</strong></div><div class="master-counter"><span>Avg RTT</span><strong id="masterAvgRtt">—</strong></div></div>
            </div>
          </article>

          <article class="master-card master-format-card">
            <div class="master-card-head"><div><h3><span class="master-section-number">3</span>Quick Format</h3><p>Fast display formatting for the selected monitor.</p></div></div>
            <div class="master-card-body master-format">
              <label>Data Type<select id="masterFormat"><option value="uint16">uint16 (0–65535)</option><option value="int16">int16</option><option value="hex">HEX</option><option value="binary">Binary</option></select></label>
              <div><label>Byte Order</label><div class="master-byte-order"><button type="button" class="active">ABCD</button><button type="button" disabled>BADC</button><button type="button" disabled>CDAB</button><button type="button" disabled>DCBA</button></div></div>
              <div class="master-format-grid"><label>Scale<input id="masterScale" type="number" step="any" value="1"></label><label>Offset<input id="masterOffset" type="number" step="any" value="0"></label></div>
              <div class="master-note">Quick Format is intentionally compact. Use Decoder / Data Lab for 32/64-bit values, byte/word permutations, strings, BCD, timestamps, enums and bitfields.</div>
            </div>
          </article>

          <article class="master-card master-live">
            <div class="master-card-head master-live-head"><div><h3><span class="master-section-number">4</span>Live Data Grid</h3><p>Values returned by the current read definition.</p></div><div><strong id="masterGridSummary">No data</strong></div></div>
            <div class="master-table-wrap"><table class="master-table"><thead><tr><th>Address</th><th>Reference</th><th>Description</th><th>Raw / HEX</th><th>Formatted Value</th><th>Type</th><th>Quality</th><th>Updated</th></tr></thead><tbody id="masterDataBody"><tr><td colspan="8"><div class="master-empty">Connect to a target, define Unit/Function/Address/Quantity, then choose Read Once or Start Polling.</div></td></tr></tbody></table></div>
          </article>

          <div class="master-write-strip"><div><strong>🔒 WRITES LOCKED</strong><div class="master-mode-hint">Guarded write workflow will be enabled only after the read/polling foundation is accepted.</div></div><button class="master-secondary" disabled>Unlock Writes…</button></div>
        </div>
      </div>
    </section>`);

  const q = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const app = {
    type: 'rtu', connected: false, polling: false, paused: false, timer: null, busy: false,
    rows: [], lastRequest: null, lastEvidence: null, addressMode: 'raw'
  };

  async function request(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.code = body.code || null;
      error.details = body.details || null;
      error.category = body.category || null;
      error.retryable = Boolean(body.retryable);
      error.hint = body.hint || null;
      error.httpStatus = response.status;
      throw error;
    }
    return body;
  }

  function describeMasterError(error) {
    const code = String(error?.code || '');
    if (error?.hint) return error.hint;
    if (code === 'TIMEOUT') return 'No matching Modbus response was received. Verify Unit ID, function, address, target port and timeout.';
    if (code === 'MODBUS_EXCEPTION') return 'The device rejected this Modbus request. Check its register map and requested function/address/quantity.';
    if (['CONNECTION_LOST','CONNECTION_NOT_OPEN','NOT_OPEN','CLOSED','RECONNECTING','CONNECT_FAILED','CONNECT_TIMEOUT','WRITE_FAILED'].includes(code)) return 'The transport is unavailable. Verify the device/network path and reconnect.';
    if (code.startsWith('INVALID_')) return 'Check the connection and read definition fields before retrying.';
    return '';
  }

  function setNote(message, kind = '') {
    const node = q('masterConnectionNote');
    node.className = `master-note${kind ? ` ${kind}` : ''}`;
    node.innerHTML = message;
  }

  function setConnected(connected, status = null) {
    app.connected = Boolean(connected);
    const chip = q('masterConnectionChip');
    chip.classList.toggle('connected', app.connected);
    chip.querySelector('span').textContent = app.connected ? 'Connected' : 'Disconnected';
    q('masterConnect').disabled = app.connected;
    q('masterDisconnect').disabled = !app.connected;
    q('masterReadOnce').disabled = !app.connected;
    q('masterStartPolling').disabled = !app.connected || app.polling;
    q('masterPausePolling').disabled = !app.polling;
    q('masterStopPolling').disabled = !app.polling;
    if (status?.stats) renderStats(status.stats);
  }

  function renderStats(stats = {}) {
    const display = window.ModbusMasterSessionCounters?.apply?.(stats) || stats;
    q('masterTx').textContent = Number(display.txRequests || 0).toLocaleString();
    q('masterRx').textContent = Number(display.rxResponses || 0).toLocaleString();
    q('masterErrors').textContent = Number(display.errors || 0).toLocaleString();
    q('masterTimeouts').textContent = Number(display.timeouts || 0).toLocaleString();
    if(q('masterRetryCount'))q('masterRetryCount').textContent=Number(display.retryAttempts||0).toLocaleString();
    q('masterAvgRtt').textContent = display.avgRttMs == null ? '—' : `${Number(display.avgRttMs).toFixed(Number(display.avgRttMs) < 10 ? 1 : 0)} ms`;
  }

  function connectionPayload() {
    const common = { type: app.type, timeoutMs: Number(q('masterTimeout').value || 1000), retries:Number(q('masterRetries').value||0), retryDelayMs:Number(q('masterRetryDelay').value||100), interRequestDelayMs:Number(q('masterInterRequestDelay').value||0) };
    if (app.type === 'tcp') return { ...common, host: q('masterTcpHost').value.trim(), port: Number(q('masterTcpPort').value || 502) };
    return {
      ...common,
      path: q('masterSerialPort').value,
      baudRate: Number(q('masterBaud').value || 9600),
      parity: q('masterParity').value,
      dataBits: Number(q('masterDataBits').value || 8),
      stopBits: Number(q('masterStopBits').value || 1),
      echoSuppression: q('masterEcho').value === 'true',
      rtsTxMode:q('masterRtsMode').value,
      rtsSettleMs:Number(q('masterRtsSettle').value||0),
    };
  }

  function referenceBase(functionCode) {
    if (functionCode === 1) return 1;
    if (functionCode === 2) return 10001;
    if (functionCode === 3) return 40001;
    if (functionCode === 4) return 30001;
    return 0;
  }

  function normalizedPduAddress() {
    const functionCode = Number(q('masterFunction').value || 3);
    const entered = Number(q('masterAddress').value);
    if (!Number.isInteger(entered)) throw new Error('Start Address must be an integer.');
    if (app.addressMode === 'raw') {
      if (entered < 0 || entered > 65535) throw new Error('Raw PDU Start Address must be 0..65535.');
      return entered;
    }
    const base = referenceBase(functionCode);
    const address = entered - base;
    if (address < 0 || address > 65535) {
      const prefix = functionCode === 1 ? '00001' : functionCode === 2 ? '10001' : functionCode === 3 ? '40001' : '30001';
      throw new Error(`Reference address for FC${String(functionCode).padStart(2,'0')} must begin at ${prefix}.`);
    }
    return address;
  }

  function readPayload() {
    return {
      unitId: Number(q('masterUnitId').value || 1),
      functionCode: Number(q('masterFunction').value || 3),
      address: normalizedPduAddress(),
      quantity: Number(q('masterQuantity').value || 1),
      timeoutMs: Number(q('masterTimeout').value || 1000),
      retries:Number(q('masterRetries').value||0),
      retryDelayMs:Number(q('masterRetryDelay').value||100),
      interRequestDelayMs:Number(q('masterInterRequestDelay').value||0),
    };
  }

  function formatValue(row) {
    const format = q('masterFormat').value;
    const scale = Number(q('masterScale').value || 1);
    const offset = Number(q('masterOffset').value || 0);
    const raw = Number(row.rawValue || 0);
    if (typeof row.value === 'boolean') return row.value ? 'ON / 1' : 'OFF / 0';
    if (format === 'hex') return row.rawHex;
    if (format === 'binary') return `0b${raw.toString(2).padStart(16, '0')}`;
    let value = format === 'int16' && raw > 0x7FFF ? raw - 0x10000 : raw;
    value = value * scale + offset;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }

  function renderRows(rows, requestInfo = null) {
    app.rows = Array.isArray(rows) ? rows : [];
    app.lastRequest = requestInfo || app.lastRequest;
    const updated = new Date().toLocaleTimeString([], { hour12:false });
    q('masterDataBody').innerHTML = app.rows.length ? app.rows.map(row => `
      <tr><td class="mono"><strong>${row.address}</strong></td><td class="mono">${esc(row.reference)}</td><td class="muted">—</td><td class="mono">${esc(row.rawHex)}</td><td><strong>${esc(formatValue(row))}</strong></td><td>${typeof row.value === 'boolean' ? 'bool' : esc(q('masterFormat').value)}</td><td><span class="master-quality"><i></i>Good</span></td><td>${updated}</td></tr>`).join('') : '<tr><td colspan="8"><div class="master-empty">No values returned.</div></td></tr>';
    q('masterGridSummary').textContent = app.lastRequest ? `${app.rows.length} values · FC${String(app.lastRequest.functionCode).padStart(2,'0')} · Unit ${app.lastRequest.unitId}` : `${app.rows.length} values`;
  }

  async function loadPorts() {
    try {
      const ports = await request('/api/ports');
      const current = q('masterSerialPort').value;
      q('masterSerialPort').innerHTML = '<option value="">Select port…</option>' + ports.map(port => `<option value="${esc(port.path)}">${esc(port.path)}${port.manufacturer ? ` — ${esc(port.manufacturer)}` : ''}</option>`).join('');
      if (ports.some(port => port.path === current)) q('masterSerialPort').value = current;
    } catch (error) {
      setNote(`<strong>Port enumeration failed.</strong> ${esc(error.message)}`, 'master-error');
    }
  }

  async function refreshStatus() {
    try {
      const status = await request('/api/master/status');
      setConnected(Boolean(status.connected), status);
      if (status.connected && status.config) {
        app.type = status.config.type || app.type;
        setNote(`<strong>Master connected.</strong> ${esc(status.config.type.toUpperCase())} active session.`, '');
      }
    } catch { /* Master backend may not be installed on an older local checkout */ }
  }

  async function connect(extra = {}) {
    try {
      const payload = { ...connectionPayload(), ...extra };
      setNote('<strong>Connecting…</strong> Opening the active Master connection.');
      const status = await request('/api/master/connect', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) });
      setConnected(true, status);
      setNote(`<strong>Connected.</strong> ${esc(app.type.toUpperCase())} Master is ready. Reads now actively transmit Modbus requests.`);
    } catch (error) {
      if (error.code === 'SLAVE_ACTIVE') {
        const port = error.details?.port || q('masterSerialPort').value;
        if (confirm(`Modbus Slave currently owns ${port}. Stop Slave and switch this port to active Master mode?`)) {
          return connect({ ...extra, confirmSlaveStop: true });
        }
      }
      if (error.code === 'RAW_LAB_ACTIVE') {
        const port = error.details?.port || q('masterSerialPort').value;
        if (confirm(`Raw Frame Lab currently owns ${port}. Close Raw Lab and switch this port to active Master mode?`)) return connect({ ...extra, confirmRawLabClose:true });
      }
      if (error.code === 'PASSIVE_CAPTURE_ACTIVE') {
        const port = error.details?.port || q('masterSerialPort').value;
        if (confirm(`The passive Analyzer currently owns ${port}. Switch this port to ACTIVE Master mode? Passive capture will disconnect.`)) {
          try {
            await request('/api/serial/disconnect', { method:'POST' });
            setNote(`<strong>Passive Analyzer disconnected.</strong> Opening ${esc(port)} in active Master mode…`, 'master-active-warning');
            return connect();
          } catch (disconnectError) {
            setConnected(false);
            setNote(`<strong>Could not release passive Analyzer.</strong> ${esc(disconnectError.message)}`, 'master-error');
            return;
          }
        }
      }
      setConnected(false);
      setNote(`<strong>Connection failed.</strong> ${esc(error.message)}`, 'master-error');
    }
  }

  async function disconnect() {
    stopPolling();
    try { await request('/api/master/disconnect', { method:'POST' }); } catch { /* reflect disconnected locally */ }
    setConnected(false);
    setNote('<strong>Disconnected.</strong> Master is no longer transmitting.');
  }

  async function readOnce({ silent = false } = {}) {
    if (!app.connected || app.busy) return null;
    app.busy = true;
    try {
      const result = await request('/api/master/read', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(readPayload()) });
      renderRows(result.rows, result.request);
      renderStats(result.stats);
      app.lastEvidence = { requestRawHex: result.requestRawHex, responseRawHex: result.responseRawHex, rttMs: result.rttMs };
      if (!silent) setNote(`<strong>Read successful.</strong> ${result.rows.length} values in ${Number(result.rttMs || 0).toFixed(1)} ms.`);
      return result;
    } catch (error) {
      let status = null;
      try {
        status = await request('/api/master/status');
        renderStats(status.stats);
        setConnected(Boolean(status.connected), status);
      } catch { /* keep the current local state if status is unavailable */ }
      if (status && !status.connected) stopPolling();
      const guidance = describeMasterError(error);
      const retryText = error.retryable ? ' Retry is safe for this read.' : '';
      setNote(`<strong>Read failed${error.code ? ` (${esc(error.code)})` : ''}.</strong> ${esc(error.message)}${guidance ? `<br><span>${esc(guidance + retryText)}</span>` : ''}`, 'master-error');
      return null;
    } finally {
      app.busy = false;
    }
  }

  function scheduleNextPoll() {
    clearTimeout(app.timer);
    if (!app.polling || app.paused) return;
    const delay = Math.max(50, Number(q('masterPollInterval').value || 1000));
    app.timer = setTimeout(async () => {
      await readOnce({ silent:true });
      scheduleNextPoll();
    }, delay);
  }

  async function startPolling() {
    if (!app.connected || app.polling) return;
    app.polling = true;
    app.paused = false;
    setConnected(true);
    q('masterStartPolling').disabled = true;
    q('masterPausePolling').disabled = false;
    q('masterStopPolling').disabled = false;
    setNote('<strong>Polling active.</strong> Requests are serialized; a new poll is scheduled only after the previous read completes.', 'master-active-warning');
    await readOnce({ silent:true });
    scheduleNextPoll();
  }

  function pausePolling() {
    if (!app.polling) return;
    app.paused = !app.paused;
    clearTimeout(app.timer);
    q('masterPausePolling').textContent = app.paused ? '▶ Resume' : 'Ⅱ Pause';
    if (!app.paused) scheduleNextPoll();
    setNote(app.paused ? '<strong>Polling paused.</strong> Connection remains open.' : '<strong>Polling resumed.</strong>');
  }

  function stopPolling() {
    clearTimeout(app.timer);
    app.timer = null;
    app.polling = false;
    app.paused = false;
    if (q('masterPausePolling')) q('masterPausePolling').textContent = 'Ⅱ Pause';
    if (q('masterStartPolling')) q('masterStartPolling').disabled = !app.connected;
    if (q('masterPausePolling')) q('masterPausePolling').disabled = true;
    if (q('masterStopPolling')) q('masterStopPolling').disabled = true;
  }

  function updateAddressHint() {
    const fc = Number(q('masterFunction').value || 3);
    const prefix = fc === 1 ? '00001' : fc === 2 ? '10001' : fc === 3 ? '40001' : '30001';
    q('masterAddressHint').textContent = app.addressMode === 'raw' ? 'Raw request uses PDU address' : `FC${String(fc).padStart(2,'0')} starts at ${prefix}`;
  }

  function setType(type) {
    app.type = type;
    document.querySelectorAll('[data-master-type]').forEach(button => button.classList.toggle('active', button.dataset.masterType === type));
    q('masterSerialFields').hidden = type === 'tcp';
    q('masterTcpFields').hidden = type !== 'tcp';
    q('masterRefreshPorts').hidden = type === 'tcp';
    q('masterUnitId').max = type === 'tcp' ? '255' : '247';
  }

  masterNav.addEventListener('click', () => { try { go('master'); } catch {} refreshStatus(); loadPorts(); });
  q('masterConnectionType').addEventListener('click', event => { const button = event.target.closest('[data-master-type]'); if (button && !app.connected) setType(button.dataset.masterType); });
  q('masterConnect').addEventListener('click', connect);
  q('masterDisconnect').addEventListener('click', disconnect);
  q('masterRefreshPorts').addEventListener('click', loadPorts);
  q('masterReadOnce').addEventListener('click', () => readOnce());
  q('masterStartPolling').addEventListener('click', startPolling);
  q('masterPausePolling').addEventListener('click', pausePolling);
  q('masterStopPolling').addEventListener('click', stopPolling);
  q('masterFormat').addEventListener('change', () => renderRows(app.rows, app.lastRequest));
  q('masterScale').addEventListener('input', () => renderRows(app.rows, app.lastRequest));
  q('masterOffset').addEventListener('input', () => renderRows(app.rows, app.lastRequest));
  q('masterFunction').addEventListener('change', () => {
    const fc = Number(q('masterFunction').value);
    q('masterQuantity').max = fc <= 2 ? '2000' : '125';
    updateAddressHint();
  });
  q('masterAddressMode').addEventListener('click', event => {
    const button = event.target.closest('[data-address-mode]');
    if (!button) return;
    app.addressMode = button.dataset.addressMode;
    q('masterAddressMode').querySelectorAll('[data-address-mode]').forEach(node => node.classList.toggle('active', node === button));
    updateAddressHint();
  });
  window.addEventListener('hashchange', () => { if (location.hash !== '#master') stopPolling(); });

  setType('rtu');
  updateAddressHint();
  loadPorts();
  refreshStatus();
})();
