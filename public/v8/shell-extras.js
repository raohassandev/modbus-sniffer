'use strict';

(() => {
  const extraStyles = document.createElement('link');
  extraStyles.rel = 'stylesheet';
  extraStyles.href = '/v8/shell-extras.css';
  document.head.appendChild(extraStyles);

  const discoveryScript = document.createElement('script');
  discoveryScript.src = '/v8/discovery.js';
  discoveryScript.defer = true;
  document.head.appendChild(discoveryScript);

  const simulatorScript = document.createElement('script');
  simulatorScript.src = '/v8/simulator.js';
  simulatorScript.defer = true;
  document.head.appendChild(simulatorScript);

  const trafficRegisterScript = document.createElement('script');
  trafficRegisterScript.src = '/v8/traffic-register.js';
  trafficRegisterScript.defer = true;
  document.head.appendChild(trafficRegisterScript);

  const workspaceLabels = new Map([
    ['connections', 'Connections'],
    ['master', 'Master'],
    ['simulator', 'Simulator'],
    ['traffic', 'Traffic'],
    ['registerLab', 'Register Lab'],
    ['testCenter', 'Test Center'],
    ['charts', 'Charts'],
    ['historian', 'Historian'],
    ['discovery', 'Discovery'],
    ['automation', 'Automation'],
    ['hmi', 'HMI'],
    ['settings', 'Settings'],
  ]);
  const openedTabs = new Set(['connections']);
  let activeTab = 'connections';
  let recommendationTimer = null;

  const navList = document.querySelector('#navList');
  const workspaceHost = document.querySelector('.workspace-host');
  if (!navList || !workspaceHost) return;

  const tabBar = document.createElement('div');
  tabBar.className = 'document-tabs';
  workspaceHost.prepend(tabBar);

  function renderTabs() {
    tabBar.replaceChildren();
    for (const workspace of openedTabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `document-tab${workspace === activeTab ? ' active' : ''}`;
      tab.dataset.workspaceTab = workspace;
      const label = document.createElement('span');
      label.textContent = workspaceLabels.get(workspace) || workspace;
      const tabState = document.createElement('span');
      tabState.className = 'document-state';
      tabState.textContent = 'Saved';
      tab.append(label, tabState);
      tabBar.appendChild(tab);
    }
  }

  function openWorkspace(workspace) {
    const nav = navList.querySelector(`[data-workspace="${workspace}"]`);
    if (!nav) return;
    openedTabs.add(workspace);
    activeTab = workspace;
    nav.click();
    renderTabs();
  }

  navList.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-workspace]');
    if (!nav) return;
    openedTabs.add(nav.dataset.workspace);
    activeTab = nav.dataset.workspace;
    renderTabs();
  });

  tabBar.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-workspace-tab]');
    if (tab) openWorkspace(tab.dataset.workspaceTab);
  });

  function createPalette() {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog command-palette';
    dialog.innerHTML = `
      <form method="dialog" class="palette-form">
        <label class="palette-search-label" for="paletteSearch">Quick open</label>
        <input id="paletteSearch" class="text-input palette-search" type="search" autocomplete="off" placeholder="Search workspaces or actions…">
        <div id="paletteResults" class="palette-results" role="listbox"></div>
      </form>`;
    document.body.appendChild(dialog);
    const input = dialog.querySelector('#paletteSearch');
    const results = dialog.querySelector('#paletteResults');
    const actions = [
      ...[...workspaceLabels].map(([key, label]) => ({ id: `workspace:${key}`, label: `Open ${label}`, keywords: `${label} workspace`, run: () => openWorkspace(key) })),
      { id: 'new-connection', label: 'New Connection', keywords: 'create profile serial tcp', run: () => document.querySelector('#newConnection')?.click() },
      { id: 'refresh-connections', label: 'Refresh Connection Center', keywords: 'reload profiles', run: () => document.querySelector('#refreshConnections')?.click() },
    ];

    function render() {
      const query = input.value.trim().toLowerCase();
      const filtered = actions.filter((item) => !query || `${item.label} ${item.keywords}`.toLowerCase().includes(query)).slice(0, 12);
      results.replaceChildren(...filtered.map((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `palette-item${index === 0 ? ' selected' : ''}`;
        button.dataset.paletteId = item.id;
        button.textContent = item.label;
        button.addEventListener('click', () => {
          dialog.close();
          item.run();
        });
        return button;
      }));
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const first = results.querySelector('.palette-item');
        if (first) {
          event.preventDefault();
          first.click();
        }
      } else if (event.key === 'Escape') dialog.close();
    });
    dialog.addEventListener('close', () => { input.value = ''; });
    render();
    return { dialog, input, render };
  }

  const palette = createPalette();
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (palette.dialog.open) palette.dialog.close();
      else {
        palette.render();
        palette.dialog.showModal();
        queueMicrotask(() => palette.input.focus());
      }
    }
  });

  async function recommendInterface() {
    const transport = document.querySelector('#connectionTransport')?.value;
    const target = document.querySelector('#tcpHost')?.value?.trim();
    const localAddress = document.querySelector('#tcpLocalAddress');
    if (transport !== 'tcp-client' || !target || !localAddress) return;
    try {
      const response = await fetch(`/api/v8/system/recommend-interface?target=${encodeURIComponent(target)}`);
      if (!response.ok) return;
      const payload = await response.json();
      const recommendation = payload.recommendation;
      if (!recommendation?.address) {
        localAddress.title = 'No subnet recommendation available for this target.';
        return;
      }
      if ([...localAddress.options].some((option) => option.value === recommendation.address)) {
        localAddress.value = recommendation.address;
      }
      localAddress.title = recommendation.reason === 'same-subnet'
        ? `Recommended: ${recommendation.interfaceName || recommendation.address} is on the target subnet.`
        : `Recommended: ${recommendation.interfaceName || recommendation.address} matches the target address family.`;
    } catch {
      // Recommendation is optional; leave manual interface selection available.
    }
  }

  const tcpHost = document.querySelector('#tcpHost');
  const transport = document.querySelector('#connectionTransport');
  tcpHost?.addEventListener('input', () => {
    clearTimeout(recommendationTimer);
    recommendationTimer = setTimeout(recommendInterface, 250);
  });
  transport?.addEventListener('change', () => {
    clearTimeout(recommendationTimer);
    recommendationTimer = setTimeout(recommendInterface, 0);
  });
  document.querySelector('#reloadPorts')?.addEventListener('click', () => setTimeout(recommendInterface, 250));

  renderTabs();
})();
