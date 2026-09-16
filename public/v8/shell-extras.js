'use strict';

(() => {
  const loadStyle = (href) => { const node = document.createElement('link'); node.rel = 'stylesheet'; node.href = href; document.head.appendChild(node); };
  const loadScript = (src) => { const node = document.createElement('script'); node.src = src; node.defer = true; document.head.appendChild(node); };
  loadStyle('/v8/shell-extras.css');
  loadScript('/v8/discovery.js');
  loadScript('/v8/simulator.js');
  loadScript('/v8/traffic-register.js');
  loadScript('/v8/diagnostics-workspace.js');
  loadScript('/v8/history-workspace.js');
  loadScript('/v8/hmi-workspace.js');

  const workspaceLabels = new Map([
    ['connections', 'Connections'], ['master', 'Master'], ['simulator', 'Simulator'], ['traffic', 'Traffic'],
    ['registerLab', 'Register Lab'], ['testCenter', 'Test Center'], ['charts', 'Charts'], ['historian', 'Historian'],
    ['discovery', 'Discovery'], ['automation', 'Automation'], ['hmi', 'HMI'], ['settings', 'Settings'],
  ]);
  const openedTabs = new Set(['connections']);
  let activeTab = 'connections';
  let recommendationTimer = null;
  const navList = document.querySelector('#navList');
  const workspaceHost = document.querySelector('.workspace-host');
  if (!navList || !workspaceHost) return;

  const brandSubtitle = document.querySelector('.brand-subtitle');
  if (brandSubtitle) brandSubtitle.textContent = 'v8.0.0 release-candidate workspace · Ctrl/Cmd+K quick open';
  for (const row of document.querySelectorAll('#workspace-settings .details-list > div')) {
    const term = row.querySelector('dt');
    const value = row.querySelector('dd');
    if (!term || !value) continue;
    if (term.textContent.trim() === 'Stable product') {
      term.textContent = 'Release candidate';
      value.textContent = 'v8.0.0';
    } else if (term.textContent.trim() === 'Workbench') {
      value.textContent = 'v8.0.0';
    }
  }

  const connectionsBody = document.querySelector('#connectionsBody');
  function connectionRows() { return connectionsBody ? [...connectionsBody.querySelectorAll('tr[data-connection-id]')] : []; }
  function syncConnectionRowAccessibility() {
    for (const row of connectionRows()) {
      row.tabIndex = 0;
      row.setAttribute('aria-selected', row.classList.contains('selected') ? 'true' : 'false');
      row.setAttribute('aria-label', `Connection ${row.dataset.connectionId}`);
    }
  }
  function focusConnectionRow(connectionId) {
    const row = connectionRows().find((candidate) => candidate.dataset.connectionId === connectionId);
    row?.focus();
  }
  if (connectionsBody) {
    new MutationObserver(syncConnectionRowAccessibility).observe(connectionsBody, { childList: true });
    connectionsBody.addEventListener('keydown', (event) => {
      const row = event.target.closest('tr[data-connection-id]');
      if (!row || event.target.closest('button, input, select, a')) return;
      const rows = connectionRows();
      const currentIndex = rows.indexOf(row);
      if (['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        const connectionId = row.dataset.connectionId;
        row.click();
        queueMicrotask(() => focusConnectionRow(connectionId));
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || currentIndex < 0) return;
      event.preventDefault();
      let nextIndex = currentIndex;
      if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
      if (event.key === 'ArrowDown') nextIndex = Math.min(rows.length - 1, currentIndex + 1);
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = rows.length - 1;
      const connectionId = rows[nextIndex]?.dataset.connectionId;
      if (!connectionId) return;
      rows[nextIndex].click();
      queueMicrotask(() => focusConnectionRow(connectionId));
    });
    syncConnectionRowAccessibility();
  }

  const tabBar = document.createElement('div');
  tabBar.className = 'document-tabs';
  tabBar.setAttribute('role', 'tablist');
  tabBar.setAttribute('aria-label', 'Open workspaces');
  workspaceHost.prepend(tabBar);

  function renderTabs() {
    tabBar.replaceChildren();
    for (const workspace of openedTabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `document-tab${workspace === activeTab ? ' active' : ''}`;
      tab.dataset.workspaceTab = workspace;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', workspace === activeTab ? 'true' : 'false');
      tab.tabIndex = workspace === activeTab ? 0 : -1;
      const label = document.createElement('span'); label.textContent = workspaceLabels.get(workspace) || workspace;
      const tabState = document.createElement('span'); tabState.className = 'document-state'; tabState.textContent = 'Saved';
      tab.append(label, tabState); tabBar.appendChild(tab);
    }
  }

  function openWorkspace(workspace) {
    const nav = navList.querySelector(`[data-workspace="${workspace}"]`);
    if (!nav) return;
    openedTabs.add(workspace); activeTab = workspace; nav.click(); renderTabs();
  }

  navList.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-workspace]'); if (!nav) return;
    openedTabs.add(nav.dataset.workspace); activeTab = nav.dataset.workspace; renderTabs();
  });
  tabBar.addEventListener('click', (event) => { const tab = event.target.closest('[data-workspace-tab]'); if (tab) openWorkspace(tab.dataset.workspaceTab); });
  tabBar.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...tabBar.querySelectorAll('[role="tab"]')];
    if (!tabs.length) return;
    const current = event.target.closest('[role="tab"]');
    const index = Math.max(0, tabs.indexOf(current));
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    event.preventDefault();
    tabs[nextIndex].click();
    queueMicrotask(() => tabBar.querySelector(`[data-workspace-tab="${activeTab}"]`)?.focus());
  });

  function createPalette() {
    const dialog = document.createElement('dialog'); dialog.className = 'dialog command-palette';
    dialog.innerHTML = '<form method="dialog" class="palette-form"><label class="palette-search-label" for="paletteSearch">Quick open</label><input id="paletteSearch" class="text-input palette-search" type="search" autocomplete="off" placeholder="Search workspaces or actions…"><div id="paletteResults" class="palette-results" role="listbox"></div></form>';
    document.body.appendChild(dialog);
    const input = dialog.querySelector('#paletteSearch'); const results = dialog.querySelector('#paletteResults');
    const actions = [
      ...[...workspaceLabels].map(([key, label]) => ({ id: `workspace:${key}`, label: `Open ${label}`, keywords: `${label} workspace`, run: () => openWorkspace(key) })),
      { id: 'new-connection', label: 'New Connection', keywords: 'create profile serial tcp udp tls tunnel', run: () => document.querySelector('#newConnection')?.click() },
      { id: 'refresh-connections', label: 'Refresh Connection Center', keywords: 'reload profiles', run: () => document.querySelector('#refreshConnections')?.click() },
    ];
    function render() {
      const query = input.value.trim().toLowerCase();
      const filtered = actions.filter((item) => !query || `${item.label} ${item.keywords}`.toLowerCase().includes(query)).slice(0, 12);
      results.replaceChildren(...filtered.map((item, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = `palette-item${index === 0 ? ' selected' : ''}`; button.dataset.paletteId = item.id; button.textContent = item.label;
        button.addEventListener('click', () => { dialog.close(); item.run(); }); return button;
      }));
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { const first = results.querySelector('.palette-item'); if (first) { event.preventDefault(); first.click(); } }
      else if (event.key === 'Escape') dialog.close();
    });
    dialog.addEventListener('close', () => { input.value = ''; }); render(); return { dialog, input, render };
  }

  const palette = createPalette();
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (palette.dialog.open) palette.dialog.close();
      else { palette.render(); palette.dialog.showModal(); queueMicrotask(() => palette.input.focus()); }
    }
  });

  async function recommendInterface() {
    const transport = document.querySelector('#connectionTransport')?.value || '';
    const target = document.querySelector('#tcpHost')?.value?.trim();
    const localAddress = document.querySelector('#tcpLocalAddress');
    if (!transport.endsWith('-client') || transport === 'virtual' || transport.startsWith('serial-') || !target || !localAddress) return;
    try {
      const response = await fetch(`/api/v8/system/recommend-interface?target=${encodeURIComponent(target)}`); if (!response.ok) return;
      const payload = await response.json(); const recommendation = payload.recommendation;
      if (!recommendation?.address) { localAddress.title = 'No subnet recommendation available for this target.'; return; }
      if ([...localAddress.options].some((option) => option.value === recommendation.address)) localAddress.value = recommendation.address;
      localAddress.title = recommendation.reason === 'same-subnet'
        ? `Recommended: ${recommendation.interfaceName || recommendation.address} is on the target subnet.`
        : `Recommended: ${recommendation.interfaceName || recommendation.address} matches the target address family.`;
    } catch { /* optional hint only */ }
  }

  const tcpHost = document.querySelector('#tcpHost'); const transport = document.querySelector('#connectionTransport');
  tcpHost?.addEventListener('input', () => { clearTimeout(recommendationTimer); recommendationTimer = setTimeout(recommendInterface, 250); });
  transport?.addEventListener('change', () => { clearTimeout(recommendationTimer); recommendationTimer = setTimeout(recommendInterface, 0); });
  document.querySelector('#reloadPorts')?.addEventListener('click', () => setTimeout(recommendInterface, 250));
  renderTabs();
})();
