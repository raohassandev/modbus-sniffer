'use strict';

(() => {
  const TOPICS = [
    {
      id: 'quickstart', title: 'Quick Start', group: 'Start here', keywords: 'start first connect read poll modbus poll modscan',
      html: `<h2>Quick Start — first successful read</h2><ol class="help-steps"><li><strong>Connections:</strong> create a Serial RTU/ASCII or Modbus TCP profile. Set COM port + baud/parity, or IP + port.</li><li>Click <strong>Open</strong> on the connection profile.</li><li>Open <strong>Master / Poll</strong> and select that connection.</li><li>In <strong>Standard Modbus Monitor</strong>, enter Slave/Unit ID, FC, zero-based address, quantity, scan rate and timeout.</li><li>Click <strong>Read once</strong>. If values are correct, click <strong>Start polling</strong>.</li><li>Use <strong>Display format</strong> for signed/unsigned/hex/binary/float interpretation. Use <strong>Open Traffic</strong> when communication fails.</li></ol><div class="help-callout"><strong>Example:</strong> manual says Holding Register 40001, Slave 1. Use FC03, address 0, quantity as required. The monitor shows both wire address and reference address.</div>`
    },
    {
      id: 'connections', title: 'Connections', group: 'Core workflow', keywords: 'serial rtu ascii tcp udp tls com port baud parity open close test',
      html: `<h2>Connections</h2><p>Connection profiles define how the Workbench reaches a Modbus device. Saving a profile does not open the port or enable writes.</p><h3>How to use</h3><ol class="help-steps"><li>Click <strong>New Connection</strong>.</li><li>Choose transport: Serial RTU/ASCII, Modbus TCP/UDP, TLS, tunnelling, or Virtual.</li><li>For serial select COM port, baud and parity. Data bits/stop bits follow the profile defaults.</li><li>For network enter host/listen IP and port. Standard Modbus TCP normally uses 502; TLS profiles may use a different configured port.</li><li>Save, then use <strong>Test</strong> before opening where practical.</li><li>Click <strong>Open</strong> to acquire the live transport. Click a row to see ownership/runtime diagnostics in Inspector.</li></ol><h3>Buttons</h3><dl class="help-defs"><div><dt>Open / Close</dt><dd>Acquire or release live transport ownership.</dd></div><div><dt>Test</dt><dd>Checks the configured transport without treating it as a register read.</dd></div><div><dt>Duplicate</dt><dd>Copies a profile for a similar device/site.</dd></div><div><dt>Import / Export</dt><dd>Moves connection configuration between projects/workstations; live armed state is not restored.</dd></div></dl>`
    },
    {
      id: 'master', title: 'Master / Poll', group: 'Core workflow', keywords: 'master poll read once polling scan rate slave unit function address quantity write',
      html: `<h2>Master / Poll</h2><p>This is the normal Modbus master workflow. Start with the <strong>Standard Modbus Monitor</strong>; use saved Polling Jobs only when you need multiple persistent groups.</p><h3>Standard Monitor</h3><ol class="help-steps"><li>Select a Master-compatible connection at the top.</li><li>Set Slave/Unit ID.</li><li>Select FC01 Coils, FC02 Discrete Inputs, FC03 Holding Registers or FC04 Input Registers.</li><li>Enter the <strong>zero-based wire address</strong>. The reference address is shown below the definition.</li><li>Set Quantity, Scan Rate and Timeout.</li><li>Choose display format, then Read once or Start polling.</li></ol><h3>Advanced polling jobs</h3><p>Use Polling Jobs to save multiple register blocks with independent intervals. Start/Pause/Resume/Stop controls the connection scheduler. Jobs persist with the project; runtime starts stopped.</p><h3>Writes</h3><p>Use Guarded Write for FC05, FC06, FC15, FC16, FC21, FC22 and FC23. Writes are locked by default and require explicit confirmation. Use Simulator first when testing an unknown map.</p><div class="help-warning"><strong>Important:</strong> a value problem is not automatically a communication problem. First confirm Tx/Rx in Traffic, then datatype/byte order in Register Lab.</div>`
    },
    {
      id: 'discovery', title: 'Scan / Discovery', group: 'Core workflow', keywords: 'slave scan unit scan address scan fc43 discovery find devices',
      html: `<h2>Scan / Discovery</h2><p>Use this when the Slave ID or valid address range is unknown.</p><h3>Unit / Slave scan</h3><ol class="help-steps"><li>Select connection.</li><li>Choose start/end Unit IDs.</li><li>Set timeout and inter-request delay conservatively.</li><li>FC43 device identification is attempted first; fallback read can be configured.</li><li>For serial production buses, confirm maintenance window and exclusive bus access.</li><li>Start scan and inspect confirmed results.</li></ol><h3>Address scan</h3><p>Select Unit ID, FC01–FC04, start/end address, strategy and block size. Adaptive blocks are faster where the device tolerates range reads. Export selected results for handover.</p><div class="help-warning"><strong>Silence is not proof of absence.</strong> Wrong baud/parity, wiring, Unit ID, gateway routing or timeouts can all look like silence.</div>`
    },
    {
      id: 'traffic', title: 'Traffic', group: 'Core workflow', keywords: 'traffic tx rx request response error timeout hex pdu timing evidence',
      html: `<h2>Traffic</h2><p>Traffic is the protocol evidence view. Use it before changing datatype or scaling.</p><ol class="help-steps"><li>Filter by connection, direction, Unit, FC, raw HEX or text.</li><li>Select an event to inspect decoded data, raw bytes and timing.</li><li>Use Errors only to isolate timeouts/exceptions.</li><li>Freeze view while examining a fault; Freeze on error is useful during intermittent problems.</li><li>Bookmark important frames and copy HEX/PDU/JSON for support evidence.</li></ol><p><strong>Expected troubleshooting order:</strong> connection → Tx frame → Rx frame → exception/timeout → timing → register interpretation.</p>`
    },
    {
      id: 'simulator', title: 'Slave / Simulator', group: 'Core workflow', keywords: 'slave simulator server virtual device memory coils holding registers fault lab',
      html: `<h2>Slave / Server Simulator</h2><p>Use Simulator to test a Master, PLC or HMI without risking a production device.</p><ol class="help-steps"><li>Create/save a simulator server and assign a compatible server/virtual connection.</li><li>Add one or more Unit IDs and memory sizes.</li><li>Use Memory Editor to seed coils/registers.</li><li>Add Dynamic Value Generators for counters, sine, random, timestamp or controlled formulas.</li><li>Start the server and connect your external Modbus master.</li><li>Inspect observed writes and clients.</li></ol><h3>LAB faults</h3><p>Fault injection can add delay, jitter, dropped responses, exceptions, duplicates or truncation. It is disabled by default and must stay in controlled LAB use.</p>`
    },
    {
      id: 'registerLab', title: 'Register Lab', group: 'Engineering tools', keywords: 'datatype byte order word order scale offset float int signed unsigned engineering unit enum bitfield',
      html: `<h2>Register Lab</h2><p>Use Register Lab after communication is proven. It converts raw register words into engineering meaning.</p><ol class="help-steps"><li>Perform a Master read or simulator exchange so live points exist.</li><li>Select a source row.</li><li>Compare interpretations such as uint/int/float and byte/word order.</li><li>Create an Engineering Definition with name, type, order, unit, scale, offset and precision.</li><li>Optionally define enums/bitfields and notes.</li><li>Save only after the interpretation is confirmed from documentation or controlled tests.</li></ol><p>Example: two raw holding registers may represent one Float32 value. Register Lab is where ABCD/CDAB/BADC/DCBA-style ordering should be verified.</p>`
    },
    {
      id: 'testCenter', title: 'Test Center', group: 'Engineering tools', keywords: 'test center raw frame custom hex recipe diagnostics crc lrc',
      html: `<h2>Test Center</h2><p>Use normal validated requests for ordinary testing and raw/custom frames only when you intentionally need protocol-level experiments.</p><ol class="help-steps"><li>Select the intended connection and target.</li><li>Prefer validated Modbus requests first.</li><li>For raw frames, review exact HEX and framing before transmit.</li><li>Use recipes for repeatable reads, guarded writes, delays, assertions and evidence.</li><li>Run recipes against Simulator before live equipment whenever practical.</li></ol><div class="help-warning">Raw transmission can send malformed or vendor-specific bytes. Treat it as an advanced commissioning function.</div>`
    },
    {
      id: 'charts', title: 'Live Trend', group: 'Engineering tools', keywords: 'chart trend logger graph realtime data',
      html: `<h2>Charts & Logger</h2><p>Use Charts for live engineering visibility after register definitions are correct.</p><ol class="help-steps"><li>Select/bind confirmed register points.</li><li>Choose sample/update interval appropriate to the device and network.</li><li>Keep protocol debugging in Traffic; a chart is not raw communication evidence.</li><li>Use Logger/Logger / Trend when data must survive beyond the current live chart window.</li></ol>`
    },
    {
      id: 'historian', title: 'Logger / Trend', group: 'Engineering tools', keywords: 'historian history sqlite logging retention export time range',
      html: `<h2>Logger / Trend</h2><p>Logger / Trend stores time-series samples for later review/export.</p><ol class="help-steps"><li>Configure a logger/history profile for confirmed points.</li><li>Choose sampling and retention deliberately; faster sampling increases disk growth.</li><li>Review time ranges and data quality before export.</li><li>For handover, export a bounded range instead of copying a live database while it is being written.</li></ol>`
    },
    {
      id: 'automation', title: 'Test Sequences / API', group: 'Advanced', keywords: 'automation api cli websocket sdk script',
      html: `<h2>Test Sequences / API</h2><p>Test Sequences exposes repeatable API/CLI workflows but does not bypass connection ownership or write safety.</p><ol class="help-steps"><li>Prove the equivalent operation manually first.</li><li>Prefer loopback/local API access.</li><li>Use stable connection IDs and explicit Unit/address definitions.</li><li>For writes, preserve the same confirmation/audit expectations as the UI.</li><li>Record errors/timeouts rather than retrying indefinitely.</li></ol>`
    },
    {
      id: 'settings', title: 'Settings', group: 'System', keywords: 'settings theme density dark light compact',
      html: `<h2>Settings</h2><p>Theme and density affect presentation only. They do not change protocol timing, addressing, transport ownership or write safety. Use Compact/Dense when many rows must be visible; use Comfortable for commissioning on a large display.</p>`
    },
    {
      id: 'addressing', title: 'Addressing', group: 'Reference', keywords: '40001 30001 10001 00001 zero based reference address offset',
      html: `<h2>Modbus Addressing</h2><p>The Workbench sends <strong>zero-based protocol addresses</strong>. Device manuals often show reference notation.</p><table class="help-table"><thead><tr><th>Area</th><th>Function</th><th>Manual reference example</th><th>Wire address</th></tr></thead><tbody><tr><td>Coils</td><td>FC01</td><td>00001</td><td>0</td></tr><tr><td>Discrete Inputs</td><td>FC02</td><td>10001</td><td>0</td></tr><tr><td>Input Registers</td><td>FC04</td><td>30001</td><td>0</td></tr><tr><td>Holding Registers</td><td>FC03</td><td>40001</td><td>0</td></tr></tbody></table><p>Example: manual register 40011 → FC03 address 10. Always verify whether a vendor manual already uses zero-based addresses before subtracting one.</p>`
    },
    {
      id: 'functionCodes', title: 'Function Codes', group: 'Reference', keywords: 'fc01 fc02 fc03 fc04 fc05 fc06 fc15 fc16 fc22 fc23 fc43',
      html: `<h2>Function Code Guide</h2><table class="help-table"><thead><tr><th>FC</th><th>Purpose</th><th>Workbench use</th></tr></thead><tbody><tr><td>01</td><td>Read Coils</td><td>Standard Monitor / polling</td></tr><tr><td>02</td><td>Read Discrete Inputs</td><td>Standard Monitor / polling</td></tr><tr><td>03</td><td>Read Holding Registers</td><td>Standard Monitor / polling</td></tr><tr><td>04</td><td>Read Input Registers</td><td>Standard Monitor / polling</td></tr><tr><td>05</td><td>Write Single Coil</td><td>Guarded Write</td></tr><tr><td>06</td><td>Write Single Register</td><td>Guarded Write</td></tr><tr><td>15</td><td>Write Multiple Coils</td><td>Guarded Write</td></tr><tr><td>16</td><td>Write Multiple Registers</td><td>Guarded Write</td></tr><tr><td>22</td><td>Mask Write Register</td><td>Guarded Write / Advanced Master</td></tr><tr><td>23</td><td>Read/Write Multiple Registers</td><td>Guarded Write / Advanced Master</td></tr><tr><td>43/14</td><td>Read Device Identification</td><td>Discovery path</td></tr></tbody></table><p>Advanced Master also exposes serial diagnostics/event-counter/server-ID functions, File Record, FIFO and Device Identification where transport-applicable.</p>`
    },
    {
      id: 'workflow', title: 'Recommended Workflow', group: 'Reference', keywords: 'workflow troubleshooting order standard modbus poll',
      html: `<h2>Recommended Standard Workflow</h2><div class="help-flow"><div><strong>1. Connect</strong><span>Create/test/open transport.</span></div><div><strong>2. Monitor</strong><span>Define Unit, FC, address, quantity, rate.</span></div><div><strong>3. Verify Traffic</strong><span>Confirm exact request/response.</span></div><div><strong>4. Interpret</strong><span>Datatype, byte order, scale, unit.</span></div><div><strong>5. Log / Chart</strong><span>Only after the value is proven.</span></div><div><strong>6. Write</strong><span>Guarded confirmation; simulator first.</span></div></div><p>This keeps ordinary Modbus work simple while leaving Slave, Test Center, Device Clone and Test Sequences as advanced Modbus tools.</p>`
    },
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  let activeTopic = 'quickstart';

  function workspaceHtml() {
    return `<section id="workspace-help" class="workspace help-workspace" aria-labelledby="helpTitle"><div class="workspace-header"><div><h1 id="helpTitle">Help & User Guide</h1><p>How to use the Modbus engineering functions for polling, simulation, analysis, discovery and protocol testing.</p></div><div class="toolbar"><span class="status-chip neutral">F1 CONTEXT HELP</span></div></div><div class="help-search-row"><input id="helpSearch" class="text-input" type="search" placeholder="Search help: polling, 40001, float, scan, traffic…" aria-label="Search help"></div><div class="help-layout"><aside class="panel help-nav" id="helpNav"></aside><article class="panel help-content" id="helpContent"></article></div></section>`;
  }

  function install() {
    if ($('#workspace-help')) return;
    $('.workspace-host')?.insertAdjacentHTML('beforeend', workspaceHtml());
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/v8/help.css'; document.head.appendChild(css);
    $('#helpSearch')?.addEventListener('input', renderNav);
    $('#helpNav')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-help-topic]');
      if (!button) return;
      activeTopic = button.dataset.helpTopic;
      renderNav(); renderTopic();
    });
    renderNav(); renderTopic();
  }

  function renderNav() {
    const host = $('#helpNav'); if (!host) return;
    const query = $('#helpSearch')?.value?.trim().toLowerCase() || '';
    const filtered = TOPICS.filter((topic) => !query || `${topic.title} ${topic.group} ${topic.keywords} ${topic.html.replace(/<[^>]+>/g, ' ')}`.toLowerCase().includes(query));
    const groups = new Map();
    for (const topic of filtered) {
      if (!groups.has(topic.group)) groups.set(topic.group, []);
      groups.get(topic.group).push(topic);
    }
    const fragment = document.createDocumentFragment();
    for (const [group, topics] of groups) {
      const label = document.createElement('div'); label.className = 'help-group-label'; label.textContent = group; fragment.appendChild(label);
      for (const topic of topics) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `help-topic${topic.id === activeTopic ? ' active' : ''}`; button.dataset.helpTopic = topic.id; button.textContent = topic.title; fragment.appendChild(button);
      }
    }
    if (!filtered.length) {
      const empty = document.createElement('div'); empty.className = 'help-no-results'; empty.textContent = 'No help topic matches this search.'; fragment.appendChild(empty);
    }
    host.replaceChildren(fragment);
  }

  function renderTopic() {
    const topic = TOPICS.find((item) => item.id === activeTopic) || TOPICS[0];
    const host = $('#helpContent'); if (!host) return;
    host.innerHTML = topic.html;
    host.scrollTop = 0;
  }

  function openHelp(topicId) {
    if (TOPICS.some((topic) => topic.id === topicId)) activeTopic = topicId;
    document.querySelector('[data-workspace="help"]')?.click();
    setTimeout(() => { renderNav(); renderTopic(); }, 0);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'F1') return;
    event.preventDefault();
    const current = document.querySelector('.nav-item.active')?.dataset.workspace || 'quickstart';
    const mapping = { help: activeTopic, registerLab: 'registerLab', testCenter: 'testCenter', charts: 'charts' };
    openHelp(mapping[current] || (TOPICS.some((topic) => topic.id === current) ? current : 'quickstart'));
  });

  window.modbusHelp = Object.freeze({ open: openHelp, topics: TOPICS.map(({ id, title, group }) => ({ id, title, group })) });
  const tryInstall = () => { install(); if (!$('#workspace-help')) setTimeout(tryInstall, 50); };
  tryInstall();
})();
