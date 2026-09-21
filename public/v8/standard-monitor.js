'use strict';

(() => {
  const state = {
    running: false,
    timer: null,
    busy: false,
    requests: 0,
    successes: 0,
    errors: 0,
    lastRttMs: null,
    lastResult: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

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

  function workspaceHtml() {
    return `
      <section id="standardMonitor" class="panel standard-monitor" aria-labelledby="standardMonitorTitle">
        <div class="standard-monitor-heading">
          <div>
            <div class="standard-kicker">STANDARD MODBUS MONITOR</div>
            <h2 id="standardMonitorTitle">Read / Poll Definition</h2>
            <p>Familiar Modbus Poll / ModScan-style workflow. Select the Master connection above, define the read, then read once or poll continuously.</p>
          </div>
          <div class="standard-monitor-actions">
            <button id="standardReadOnce" class="button secondary" type="button">Read once</button>
            <button id="standardStart" class="button primary" type="button">Start polling</button>
            <button id="standardStop" class="button secondary" type="button" disabled>Stop</button>
            <button id="standardTraffic" class="button secondary" type="button">Open Traffic</button>
          </div>
        </div>

        <div class="standard-definition-grid">
          <label class="field"><span>Slave / Unit ID</span><input id="standardUnit" class="text-input" type="number" min="1" max="255" value="1"></label>
          <label class="field"><span>Function</span><select id="standardFc"><option value="1">FC01 Read Coils</option><option value="2">FC02 Read Discrete Inputs</option><option value="3" selected>FC03 Read Holding Registers</option><option value="4">FC04 Read Input Registers</option></select></label>
          <label class="field"><span>Address (zero-based)</span><input id="standardAddress" class="text-input" type="number" min="0" max="65535" value="0"></label>
          <label class="field"><span>Quantity</span><input id="standardQuantity" class="text-input" type="number" min="1" max="125" value="10"></label>
          <label class="field"><span>Scan rate ms</span><input id="standardScanRate" class="text-input" type="number" min="10" max="3600000" value="1000"></label>
          <label class="field"><span>Timeout ms</span><input id="standardTimeout" class="text-input" type="number" min="1" max="60000" value="1000"></label>
          <label class="field"><span>Display format</span><select id="standardFormat"><option value="unsigned">Unsigned 16-bit</option><option value="signed">Signed 16-bit</option><option value="hex">Hexadecimal</option><option value="binary">Binary</option><option value="float-abcd">Float32 ABCD</option><option value="float-cdab">Float32 CDAB</option></select></label>
          <label class="check-field standard-error-toggle"><input id="standardStopOnError" type="checkbox"><span>Stop on error</span></label>
        </div>

        <div class="standard-address-hint" id="standardAddressHint">Holding Register reference: 40001 (wire address 0)</div>

        <div class="standard-status-strip" role="status" aria-live="polite">
          <div><span>State</span><strong id="standardState">STOPPED</strong></div>
          <div><span>Requests</span><strong id="standardRequests">0</strong></div>
          <div><span>OK</span><strong id="standardSuccesses">0</strong></div>
          <div><span>Errors</span><strong id="standardErrors">0</strong></div>
          <div><span>Last RTT</span><strong id="standardRtt">—</strong></div>
        </div>

        <div class="standard-values-wrap">
          <table class="data-table standard-values-table">
            <thead><tr><th>Address</th><th>Reference</th><th>Raw</th><th>Value</th></tr></thead>
            <tbody id="standardValuesBody"><tr><td colspan="4" class="standard-empty">No data yet. Click Read once or Start polling.</td></tr></tbody>
          </table>
        </div>
        <div id="standardError" class="standard-error" role="alert"></div>
      </section>`;
  }

  function install() {
    if ($('#standardMonitor')) return;
    const master = $('#workspace-master');
    if (!master) return;
    const metrics = master.querySelector('.metric-strip');
    if (!metrics) return;
    metrics.insertAdjacentHTML('afterend', workspaceHtml());
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/v8/standard-monitor.css';
    document.head.appendChild(css);
    bind();
    syncFunctionLimits();
    renderAddressHint();
  }

  function selectedConnectionId() {
    return $('#masterConnection')?.value || '';
  }

  function currentDefinition() {
    const functionCode = Number($('#standardFc').value);
    const address = Number($('#standardAddress').value);
    const quantity = Number($('#standardQuantity').value);
    const unitId = Number($('#standardUnit').value);
    const timeoutMs = Number($('#standardTimeout').value);
    const scanRateMs = Number($('#standardScanRate').value);
    if (!selectedConnectionId()) throw new Error('Select or create a Master-compatible connection first.');
    if (!Number.isInteger(unitId) || unitId < 1 || unitId > 255) throw new Error('Slave / Unit ID must be 1..255.');
    if (![1, 2, 3, 4].includes(functionCode)) throw new Error('Standard Monitor supports FC01, FC02, FC03 and FC04 reads.');
    const maxQuantity = functionCode <= 2 ? 2000 : 125;
    if (!Number.isInteger(address) || address < 0 || address > 65535) throw new Error('Address must be 0..65535.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) throw new Error(`Quantity must be 1..${maxQuantity} for this function.`);
    if (address + quantity - 1 > 65535) throw new Error('Address + quantity exceeds 65535.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Timeout must be 1..60000 ms.');
    if (!Number.isInteger(scanRateMs) || scanRateMs < 10 || scanRateMs > 3600000) throw new Error('Scan rate must be 10..3600000 ms.');
    return { connectionId: selectedConnectionId(), unitId, functionCode, address, quantity, timeoutMs, scanRateMs };
  }

  function referenceAddress(functionCode, address) {
    const bases = { 1: 1, 2: 10001, 3: 40001, 4: 30001 };
    return (bases[functionCode] || 0) + address;
  }

  function areaLabel(functionCode) {
    return ({ 1: 'Coil', 2: 'Discrete Input', 3: 'Holding Register', 4: 'Input Register' })[functionCode] || 'Address';
  }

  function renderAddressHint() {
    const functionCode = Number($('#standardFc')?.value || 3);
    const address = Number($('#standardAddress')?.value || 0);
    const hint = $('#standardAddressHint');
    if (hint) hint.textContent = `${areaLabel(functionCode)} reference: ${referenceAddress(functionCode, address)} (wire address ${address})`;
  }

  function syncFunctionLimits() {
    const functionCode = Number($('#standardFc')?.value || 3);
    const quantity = $('#standardQuantity');
    const format = $('#standardFormat');
    if (!quantity || !format) return;
    quantity.max = functionCode <= 2 ? '2000' : '125';
    if (Number(quantity.value) > Number(quantity.max)) quantity.value = quantity.max;
    for (const option of format.options) option.disabled = functionCode <= 2 && option.value.startsWith('float-');
    if (functionCode <= 2 && format.value.startsWith('float-')) format.value = 'unsigned';
  }

  function toSigned16(value) { return value & 0x8000 ? value - 0x10000 : value; }
  function hex16(value) { return `0x${Number(value).toString(16).toUpperCase().padStart(4, '0')}`; }
  function binary16(value) { return Number(value).toString(2).padStart(16, '0'); }
  function float32(first, second, order) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    if (order === 'cdab') {
      view.setUint16(0, second, false);
      view.setUint16(2, first, false);
    } else {
      view.setUint16(0, first, false);
      view.setUint16(2, second, false);
    }
    return view.getFloat32(0, false);
  }

  function formatValue(values, index, functionCode) {
    const raw = values[index];
    if (functionCode <= 2) return raw ? 'ON' : 'OFF';
    switch ($('#standardFormat').value) {
      case 'signed': return String(toSigned16(raw));
      case 'hex': return hex16(raw);
      case 'binary': return binary16(raw);
      case 'float-abcd': return index + 1 < values.length ? String(float32(raw, values[index + 1], 'abcd')) : '—';
      case 'float-cdab': return index + 1 < values.length ? String(float32(raw, values[index + 1], 'cdab')) : '—';
      default: return String(raw);
    }
  }

  function renderValues(definition, result) {
    const values = Array.isArray(result?.decoded?.values) ? result.decoded.values : [];
    const body = $('#standardValuesBody');
    if (!values.length) {
      body.innerHTML = '<tr><td colspan="4" class="standard-empty">Response contained no displayable values.</td></tr>';
      return;
    }
    const rows = values.map((raw, index) => {
      const address = definition.address + index;
      const tr = document.createElement('tr');
      const cells = [address, referenceAddress(definition.functionCode, address), definition.functionCode <= 2 ? (raw ? '1' : '0') : raw, formatValue(values, index, definition.functionCode)];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = String(value);
        tr.appendChild(td);
      }
      return tr;
    });
    body.replaceChildren(...rows);
  }

  function renderStatus() {
    $('#standardState').textContent = state.running ? 'RUNNING' : 'STOPPED';
    $('#standardRequests').textContent = String(state.requests);
    $('#standardSuccesses').textContent = String(state.successes);
    $('#standardErrors').textContent = String(state.errors);
    $('#standardRtt').textContent = state.lastRttMs == null ? '—' : `${state.lastRttMs.toFixed(1)} ms`;
    $('#standardStart').disabled = state.running;
    $('#standardStop').disabled = !state.running;
  }

  async function performRead() {
    if (state.busy) return;
    state.busy = true;
    $('#standardError').textContent = '';
    let definition;
    try {
      definition = currentDefinition();
      state.requests += 1;
      renderStatus();
      const payload = await api('/api/v8/master/read', {
        method: 'POST',
        body: JSON.stringify({
          connectionId: definition.connectionId,
          unitId: definition.unitId,
          functionCode: definition.functionCode,
          address: definition.address,
          quantity: definition.quantity,
          timeoutMs: definition.timeoutMs,
        }),
      });
      state.successes += 1;
      state.lastResult = payload.result;
      state.lastRttMs = Number.isFinite(payload.result?.rttMs) ? Number(payload.result.rttMs) : null;
      renderValues(definition, payload.result);
    } catch (error) {
      state.errors += 1;
      $('#standardError').textContent = error.message;
      if ($('#standardStopOnError')?.checked) stop();
    } finally {
      state.busy = false;
      renderStatus();
    }
  }

  function scheduleNext() {
    clearTimeout(state.timer);
    if (!state.running) return;
    let rate = 1000;
    try { rate = currentDefinition().scanRateMs; } catch { /* performRead reports validation */ }
    state.timer = setTimeout(async () => {
      await performRead();
      scheduleNext();
    }, rate);
  }

  async function start() {
    if (state.running) return;
    try { currentDefinition(); } catch (error) { $('#standardError').textContent = error.message; return; }
    state.running = true;
    renderStatus();
    await performRead();
    scheduleNext();
  }

  function stop() {
    state.running = false;
    clearTimeout(state.timer);
    state.timer = null;
    renderStatus();
  }

  function bind() {
    $('#standardReadOnce').addEventListener('click', performRead);
    $('#standardStart').addEventListener('click', start);
    $('#standardStop').addEventListener('click', stop);
    $('#standardTraffic').addEventListener('click', () => document.querySelector('[data-workspace="traffic"]')?.click());
    $('#standardFc').addEventListener('change', () => { syncFunctionLimits(); renderAddressHint(); });
    $('#standardAddress').addEventListener('input', renderAddressHint);
    $('#standardFormat').addEventListener('change', () => {
      if (!state.lastResult) return;
      try { renderValues(currentDefinition(), state.lastResult); } catch { /* ignore until next valid definition */ }
    });
    $('#masterConnection')?.addEventListener('change', () => { if (state.running) stop(); });
    window.addEventListener('beforeunload', stop);
  }

  const tryInstall = () => {
    install();
    if (!$('#standardMonitor')) setTimeout(tryInstall, 50);
  };
  tryInstall();
})();
