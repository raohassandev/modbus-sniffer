'use strict';

(() => {
  const nativeFetch = window.fetch.bind(window);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function isUdpKind(kind) {
    return kind === 'udp-client' || kind === 'udp-server';
  }

  function isNetworkKind(kind) {
    return String(kind || '').startsWith('tcp') || isUdpKind(kind);
  }

  function enrichUdpConnectionBody(input, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input?.url || '';
    if (method !== 'POST' || !/\/api\/v8\/connections(?:\?|$)/.test(url) || typeof init.body !== 'string') return init;

    let payload;
    try { payload = JSON.parse(init.body); } catch { return init; }
    const kind = String(payload?.transportKind || '').toLowerCase();
    if (!isUdpKind(kind)) return init;

    const host = $('#tcpHost')?.value?.trim() || (Number($('#udpFamily')?.value) === 6 ? '::1' : '127.0.0.1');
    const port = Number($('#tcpPort')?.value || 502);
    const family = Number($('#udpFamily')?.value || 4);
    const localAddress = $('#tcpLocalAddress')?.value || '';
    payload.endpoint = host;
    payload.udp = {
      host,
      port,
      family,
      ...(kind === 'udp-client' && localAddress ? { localAddress } : {}),
    };
    delete payload.tcp;
    return { ...init, body: JSON.stringify(payload) };
  }

  window.fetch = function patchedFetch(input, init = {}) {
    return nativeFetch(input, enrichUdpConnectionBody(input, init));
  };

  function updateFields() {
    const kind = $('#connectionTransport')?.value || '';
    const network = isNetworkKind(kind);
    const client = kind === 'tcp-client' || kind === 'udp-client';
    const udp = isUdpKind(kind);
    $$('.tcp-field').forEach((node) => node.classList.toggle('hidden', !network));
    $$('.tcp-client-field').forEach((node) => node.classList.toggle('hidden', !client));
    $$('.udp-field').forEach((node) => node.classList.toggle('hidden', !udp));
    if ((kind === 'tcp-server' || kind === 'udp-server') && !$('#tcpHost')?.value) {
      $('#tcpHost').value = udp && Number($('#udpFamily')?.value) === 6 ? '::1' : '127.0.0.1';
    }
  }

  function updateFamilyHost() {
    const kind = $('#connectionTransport')?.value || '';
    if (!isUdpKind(kind)) return;
    const family = Number($('#udpFamily')?.value || 4);
    const host = $('#tcpHost');
    if (!host) return;
    if (family === 6 && (!host.value || host.value === '127.0.0.1')) host.value = '::1';
    if (family === 4 && (!host.value || host.value === '::1')) host.value = '127.0.0.1';
  }

  let decorateTimer = null;
  async function decorateUdpRows() {
    const metric = $('#metricUdp');
    const body = $('#connectionsBody');
    if (!metric || !body) return;
    try {
      const response = await nativeFetch('/api/v8/connections');
      const payload = await response.json();
      const rows = Array.isArray(payload?.connections) ? payload.connections : [];
      const udpRows = rows.filter((item) => isUdpKind(String(item.profile?.transportKind || '').toLowerCase()));
      metric.textContent = String(udpRows.length);
      for (const item of udpRows) {
        const row = [...body.querySelectorAll('tr[data-connection-id]')].find((node) => node.dataset.connectionId === item.profile.connectionId);
        if (!row) continue;
        const cells = row.querySelectorAll('td');
        if (cells[1]) cells[1].textContent = item.profile.transportKind === 'udp-server' ? 'UDP Server' : 'UDP Client';
        const udp = item.profile.udp || {};
        if (cells[2]) cells[2].textContent = `${udp.host || item.profile.endpoint || '—'}:${udp.port ?? 502}`;
      }
    } catch {
      // Connection Center remains usable if decoration refresh fails.
    }
  }

  function scheduleDecorate() {
    clearTimeout(decorateTimer);
    decorateTimer = setTimeout(decorateUdpRows, 0);
  }

  function bind() {
    const transport = $('#connectionTransport');
    if (transport) transport.addEventListener('change', () => {
      queueMicrotask(updateFields);
      queueMicrotask(updateFamilyHost);
    });
    const family = $('#udpFamily');
    if (family) family.addEventListener('change', updateFamilyHost);
    updateFields();

    const body = $('#connectionsBody');
    if (body) new MutationObserver(scheduleDecorate).observe(body, { childList: true, subtree: true });
    scheduleDecorate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
