'use strict';

(()=>{
  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
  const api=async(url,opt={})=>{const r=await fetch(url,{cache:'no-store',...opt});const ct=r.headers.get('content-type')||'',body=ct.includes('json')?await r.json():await r.text();if(!r.ok){const e=new Error(body?.error||body||`HTTP ${r.status}`);e.code=body?.code||null;e.payload=body;throw e;}return body;};
  const notify=(m,bad=false)=>{try{toast(m,bad);}catch{console[bad?'error':'log'](m);}};
  const page=q('page-discovery');if(!page||q('networkDiscoveryRoot'))return;
  try{pageMeta.discovery=['Discovery','Industrial network scan, inventory, topology and Modbus identification'];}catch{}

  const oldChildren=[...page.children];
  const root=document.createElement('div');root.id='networkDiscoveryRoot';root.className='network-discovery-root';
  page.prepend(root);
  root.innerHTML=`
    <div class="nd-hero">
      <div><div class="nd-eyebrow">INDUSTRIAL NETWORK DISCOVERY</div><h2>Find unknown devices, verify services, then continue into Modbus engineering</h2><p>Large IPv4/IPv6-ready target scanning with evidence-based identity. Open TCP 502 is treated only as a candidate until a valid Modbus response is verified.</p></div>
      <div class="nd-capabilities" id="ndCapabilities"><span>Loading capabilities…</span></div>
    </div>
    <div class="nd-tabs" role="tablist">
      <button class="active" data-nd-tab="scan">Network Scan</button>
      <button data-nd-tab="devices">Devices</button>
      <button data-nd-tab="topology">Topology</button>
      <button data-nd-tab="modbus">Modbus Discovery</button>
      <button data-nd-tab="history">History</button>
    </div>
    <section class="nd-view active" data-nd-view="scan">
      <article class="panel nd-control-card">
        <div class="nd-control-grid">
          <label>Network Interface<select id="ndInterface"><option value="">Auto / all interfaces</option></select></label>
          <label class="nd-target-field">Target / CIDR / Range<textarea id="ndTarget" rows="2" spellcheck="false" placeholder="192.168.1-254.1-254">192.168.1.0/24</textarea></label>
          <label>Scan Profile<select id="ndProfile"><option value="quick">Quick</option><option value="standard" selected>Standard Industrial</option><option value="modbus">Modbus Focus</option><option value="deep">Deep</option><option value="custom">Custom</option></select></label>
          <div class="nd-primary-actions"><button class="secondary" id="ndPreview">Preview</button><button class="primary" id="ndStart">Start Scan</button></div>
        </div>
        <div class="nd-preview" id="ndPreviewBox">Preview the target before scanning.</div>
        <details class="nd-advanced"><summary>Advanced scan controls</summary>
          <div class="nd-advanced-grid">
            <label>Exclude targets<textarea id="ndExclude" rows="2" placeholder="192.168.10.1, 192.168.20.0/24"></textarea></label>
            <label>Timeout ms<input id="ndTimeout" type="number" min="80" max="5000" value="350"></label>
            <label>Host concurrency<input id="ndHostConcurrency" type="number" min="1" max="256" value="72"></label>
            <label>Service concurrency<input id="ndServiceConcurrency" type="number" min="1" max="32" value="8"></label>
            <label>Custom TCP ports<input id="ndCustomPorts" placeholder="502, 802, 1502"></label>
            <label>Expected DHCP servers<input id="ndExpectedDhcp" placeholder="192.168.1.1, 192.168.1.2"></label>
            <label class="nd-check"><input id="ndIcmp" type="checkbox" checked> Use ICMP fallback</label>
            <label class="nd-check"><input id="ndVerifyModbus" type="checkbox" checked> Verify Modbus protocol</label>
            <label class="nd-check"><input id="ndEnrichWeb" type="checkbox" checked> HTTP/TLS metadata</label>
            <label class="nd-check warning"><input id="ndConfirmPublic" type="checkbox"> I explicitly authorize public/non-local targets</label>
          </div>
        </details>
      </article>

      <article class="panel nd-progress-card">
        <div class="nd-progress-head"><div><strong id="ndProgressTitle">Idle</strong><span id="ndProgressStage">No scan running</span></div><div class="nd-scan-actions"><button class="secondary" id="ndPause" disabled>Pause</button><button class="secondary" id="ndResume" disabled>Resume</button><button class="danger-outline" id="ndCancel" disabled>Stop</button><button class="secondary" id="ndAux">Discover SSDP / mDNS / WSD</button></div></div>
        <div class="nd-progress-track"><i id="ndProgressBar"></i></div>
        <div class="nd-kpis">
          <div><span>Targets</span><strong id="ndKpiTargets">0</strong></div><div><span>Scanned</span><strong id="ndKpiScanned">0</strong></div><div><span>Online</span><strong id="ndKpiOnline">0</strong></div><div><span>Industrial</span><strong id="ndKpiIndustrial">0</strong></div><div><span>Verified Modbus</span><strong id="ndKpiModbus">0</strong></div><div><span>Unknown</span><strong id="ndKpiUnknown">0</strong></div><div><span>Warnings</span><strong id="ndKpiWarnings">0</strong></div>
        </div>
        <div class="nd-findings" id="ndFindings"></div>
      </article>

      <article class="panel nd-results-card">
        <div class="panel-head nd-results-head"><div><h3>Live Results</h3><p>Observed and verified facts are kept separate from inferred identity.</p></div><div class="nd-inline"><input id="ndScanSearch" placeholder="IP / MAC / host / vendor / service"><select id="ndScanFilter"><option value="">All</option><option value="modbus">Modbus</option><option value="industrial">Industrial</option><option value="unknown">Unknown</option></select><details class="nd-column-menu"><summary>Columns</summary><div><label><input type="checkbox" data-nd-column="1" checked> State</label><label><input type="checkbox" data-nd-column="2" checked> IP</label><label><input type="checkbox" data-nd-column="3" checked> Name</label><label><input type="checkbox" data-nd-column="4" checked> MAC/Vendor</label><label><input type="checkbox" data-nd-column="5" checked> Type</label><label><input type="checkbox" data-nd-column="6" checked> Services</label><label><input type="checkbox" data-nd-column="7" checked> Modbus</label><label><input type="checkbox" data-nd-column="8" checked> RTT</label><label><input type="checkbox" data-nd-column="9" checked> Last Seen</label></div></details><a class="button secondary" href="/api/network/hosts.csv">Export CSV</a></div></div>
        <div class="table-wrap nd-table-wrap"><table class="nd-table"><thead><tr><th>State</th><th>IP</th><th>Name</th><th>MAC / Vendor</th><th>Type</th><th>Services</th><th>Modbus</th><th>RTT</th><th>Last Seen</th></tr></thead><tbody id="ndScanRows"><tr><td colspan="9" class="muted">No network scan results yet.</td></tr></tbody></table></div>
      </article>
    </section>

    <section class="nd-view" data-nd-view="devices">
      <article class="panel">
        <div class="panel-head nd-results-head"><div><h3>Network Inventory</h3><p>Persistent device inventory for the active project.</p></div><div class="nd-inline"><input id="ndInventorySearch" placeholder="Search inventory"><select id="ndInventoryClass"><option value="">All classifications</option><option>trusted</option><option>unknown</option><option>unexpected</option><option>ignored</option><option>decommissioned</option></select><button class="secondary" id="ndRefreshInventory">Refresh</button></div></div>
        <div class="nd-inventory-filters" id="ndInventoryFilters"></div>
        <div class="table-wrap nd-table-wrap"><table class="nd-table"><thead><tr><th>Status</th><th>IP</th><th>Identity</th><th>MAC</th><th>Classification</th><th>Services</th><th>Modbus</th><th>Changed</th></tr></thead><tbody id="ndInventoryRows"></tbody></table></div>
      </article>
    </section>

    <section class="nd-view" data-nd-view="topology">
      <div class="nd-topology-grid">
        <article class="panel"><div class="panel-head nd-topology-head"><div><h3>Logical / Evidence Topology</h3><p>Subnet membership is logical. Physical links appear only when evidence such as LLDP/SNMP exists.</p></div><div class="nd-topology-tools"><input id="ndTopologySearch" placeholder="Search node"><select id="ndTopologyStatus"><option value="">All status</option><option value="online">Online</option><option value="offline">Offline</option></select><select id="ndTopologyProtocol"><option value="">All devices</option><option value="modbus">Verified Modbus</option><option value="industrial">Industrial</option></select><button class="secondary" id="ndZoomOut">−</button><button class="secondary" id="ndZoomReset">100%</button><button class="secondary" id="ndZoomIn">+</button><button class="secondary" id="ndRefreshTopology">Refresh</button></div></div><div id="ndTopologyCanvas" class="nd-topology-canvas"><div id="ndTopologyViewport" class="nd-topology-viewport"></div></div></article>
        <article class="panel"><div class="panel-head"><div><h3>Address Utilization</h3><p>Click a /24 subnet to inspect its usable host addresses.</p></div></div><div id="ndUtilization" class="nd-utilization"></div></article>
      </div>
      <article class="panel" style="margin-top:14px"><div class="panel-head"><div><h3>Topology Evidence</h3><p>Every relationship exposes source and confidence.</p></div></div><div class="table-wrap"><table class="nd-table"><thead><tr><th>From</th><th>To</th><th>Kind</th><th>Source</th><th>Confidence</th><th>Physical</th></tr></thead><tbody id="ndTopologyEdges"></tbody></table></div></article>
    </section>

    <section class="nd-view" data-nd-view="modbus" id="ndModbusHost"></section>

    <section class="nd-view" data-nd-view="history">
      <div class="nd-history-grid">
        <article class="panel"><div class="panel-head"><div><h3>Scan History</h3><p>Completed and partial scans for the active project.</p></div><button class="secondary" id="ndRefreshHistory">Refresh</button></div><div id="ndScanHistory" class="nd-history-list"></div></article>
        <article class="panel"><div class="panel-head"><div><h3>Reference / Compare</h3><p>Compare a scan against a saved commissioning baseline or another scan.</p></div></div><div class="nd-compare-controls"><label>Baseline<select id="ndBaseline"></select></label><label>Current Scan<select id="ndCompareScan"></select></label><button class="primary" id="ndCompare">Compare</button></div><div id="ndCompareResult" class="nd-compare-result"></div></article>
      </div>
      <article class="panel" style="margin-top:14px"><div class="panel-head"><div><h3>Network Event Timeline</h3><p>Discovery, identity, service and availability changes.</p></div></div><div id="ndEvents" class="nd-events"></div></article>
    </section>

    <aside class="nd-drawer" id="ndDrawer" aria-hidden="true"><div class="nd-drawer-head"><div><small>NETWORK DEVICE</small><h3 id="ndDrawerTitle">Device</h3><p id="ndDrawerSub"></p></div><button id="ndDrawerClose" class="secondary">×</button></div><div id="ndDrawerBody"></div></aside>
    <div class="nd-drawer-backdrop" id="ndDrawerBackdrop"></div>
  `;

  const modbusHost=q('ndModbusHost');
  for(const child of oldChildren)modbusHost.appendChild(child);

  let scanStatus=null,scanHosts=[],inventory=[],capabilities=null,pollTimer=null,currentDevice=null,topologyState={nodes:[],edges:[],zoom:1,panX:0,panY:0};

  function tab(name){
    root.querySelectorAll('[data-nd-tab]').forEach(b=>b.classList.toggle('active',b.dataset.ndTab===name));
    root.querySelectorAll('[data-nd-view]').forEach(v=>v.classList.toggle('active',v.dataset.ndView===name));
    if(name==='devices')loadInventory().catch(e=>notify(e.message,true));
    if(name==='topology')loadTopology().catch(e=>notify(e.message,true));
    if(name==='history')loadHistory().catch(e=>notify(e.message,true));
  }
  root.querySelector('.nd-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-nd-tab]');if(b)tab(b.dataset.ndTab);});

  function fmtTime(v){if(!v)return'—';try{return new Date(v).toLocaleString();}catch{return String(v);}}
  function svcText(h){return(h.services||[]).slice(0,5).map(s=>`${s.port} ${s.name||''}`.trim()).join(' · ')||'—';}
  function hostMatch(h,query,filter){
    const hay=[h.ip,h.mac,h.macVendor,h.hostname,h.type,h.classification,...(h.hostnames||[]),...(h.services||[]).map(s=>`${s.port} ${s.name}`)].join(' ').toLowerCase();
    if(query&&!hay.includes(query.toLowerCase()))return false;
    if(filter==='modbus'&&!h.modbus?.verified)return false;if(filter==='industrial'&&!h.industrial)return false;if(filter==='unknown'&&h.type!=='Unknown')return false;return true;
  }
  function renderScanRows(){
    const query=q('ndScanSearch').value.trim(),filter=q('ndScanFilter').value,rows=scanHosts.filter(h=>hostMatch(h,query,filter));
    q('ndScanRows').innerHTML=rows.length?rows.map(h=>`<tr data-nd-host="${esc(h.id||'')}"><td><span class="nd-state ${h.state==='online'?'online':'unknown'}">${esc((h.state||'unknown').toUpperCase())}</span></td><td class="mono"><strong>${esc(h.ip)}</strong></td><td>${esc(h.hostname||'—')}</td><td><span class="mono">${esc(h.mac||'—')}</span><small>${esc(h.macVendor||'')}</small></td><td>${esc(h.type||'Unknown')}<small>${h.typeConfidence?esc(h.typeConfidence+'% inferred'):''}</small></td><td>${esc(svcText(h))}</td><td>${h.modbus?.verified?'<span class="nd-badge good">VERIFIED</span>':(h.services||[]).some(s=>s.port===502)?'<span class="nd-badge warn">CANDIDATE</span>':'—'}</td><td>${h.avgRttMs==null?'—':esc(h.avgRttMs+' ms')}</td><td>${esc(fmtTime(h.lastSeen))}</td></tr>`).join(''):'<tr><td colspan="9" class="muted">No matching devices.</td></tr>';applyScanColumns();
  }
  q('ndScanSearch').addEventListener('input',renderScanRows);q('ndScanFilter').addEventListener('change',renderScanRows);
  const columnKey='modbus.network.discovery.columns.v1';
  function applyScanColumns(){
    let saved={};try{saved=JSON.parse(localStorage.getItem(columnKey)||'{}')||{};}catch{}
    root.querySelectorAll('[data-nd-column]').forEach(input=>{const index=Number(input.dataset.ndColumn);if(saved[index]===false)input.checked=false;const show=input.checked;root.querySelectorAll(`.nd-results-card .nd-table tr > *:nth-child(${index})`).forEach(cell=>cell.style.display=show?'':'none');});
  }
  root.querySelector('.nd-column-menu').addEventListener('change',e=>{const input=e.target.closest('[data-nd-column]');if(!input)return;let saved={};try{saved=JSON.parse(localStorage.getItem(columnKey)||'{}')||{};}catch{}saved[input.dataset.ndColumn]=input.checked;localStorage.setItem(columnKey,JSON.stringify(saved));applyScanColumns();});
  q('ndScanRows').addEventListener('click',e=>{const tr=e.target.closest('[data-nd-host]');if(tr)openDevice(tr.dataset.ndHost);});

  function renderStatus(s){
    scanStatus=s;const p=s?.progress||{},sum=s?.summary||{},running=Boolean(s?.running),paused=Boolean(s?.paused),pct=p.total?Math.max(0,Math.min(100,Number(p.scanned||0)/Number(p.total)*100)):0;
    q('ndProgressBar').style.width=`${pct}%`;q('ndProgressTitle').textContent=s?.state==='completed'?'Completed':s?.state==='cancelled'?'Cancelled':s?.state==='error'?'Failed':paused?'Paused':running?'Scanning':'Idle';q('ndProgressStage').textContent=running?`${p.stage||'scan'} · ${Number(p.scanned||0).toLocaleString()} / ${Number(p.total||0).toLocaleString()}`:(s?.error?.message||'No scan running');
    for(const [id,key] of [['ndKpiTargets','targets'],['ndKpiScanned','scanned'],['ndKpiOnline','online'],['ndKpiIndustrial','industrial'],['ndKpiModbus','modbus'],['ndKpiUnknown','unknown'],['ndKpiWarnings','warnings']])q(id).textContent=Number(sum[key]??(key==='scanned'?p.scanned:0)).toLocaleString();
    q('ndPause').disabled=!running||paused;q('ndResume').disabled=!running||!paused;q('ndCancel').disabled=!running;
    const findings=Array.isArray(s?.findings)?s.findings:[];q('ndFindings').innerHTML=findings.slice(0,12).map(f=>`<div class="${f.severity==='critical'?'critical':'warning'}"><strong>${esc(String(f.severity||'warning').toUpperCase())}</strong><span>${esc(f.message||f.type||'Network finding')}</span></div>`).join('');
    if(Array.isArray(s?.hosts)){scanHosts=s.hosts;renderScanRows();}
  }
  async function refreshStatus(){try{renderStatus(await api('/api/network/scan/status'));}catch{}}
  function ensurePolling(){if(pollTimer)return;pollTimer=setInterval(()=>{if(location.hash==='#discovery'||q('page-discovery')?.classList.contains('active'))refreshStatus();},1000);}

  async function loadInterfaces(){
    const out=await api('/api/network/interfaces'),sel=q('ndInterface');sel.innerHTML='<option value="">Auto / all interfaces</option>'+out.interfaces.map(i=>`<option value="${esc(i.suggestedTarget||'')}">${esc(i.name)} · ${esc(i.address)}${i.cidr?` · ${esc(i.cidr)}`:''}</option>`).join('');
  }
  q('ndInterface').addEventListener('change',()=>{if(q('ndInterface').value)q('ndTarget').value=q('ndInterface').value;});
  async function loadCapabilities(){
    capabilities=await api('/api/network/capabilities');const chips=[capabilities.scannerId?`Scanner ${capabilities.scannerId}`:'',capabilities.ipv4?'IPv4':'',capabilities.ipv6?`IPv6 ${capabilities.ipv6Model||''}`:'',capabilities.snmp?'SNMP/LLDP':'',capabilities.multicastDiscovery?'SSDP/mDNS/WSD':'',capabilities.oui?.available?`MAC vendors ${Number(capabilities.oui.count||0).toLocaleString()}`:'MAC vendor DB optional',capabilities.nmap?.available?`Nmap ${capabilities.nmap.version||''}`:'Nmap optional'].filter(Boolean);q('ndCapabilities').innerHTML=chips.map(x=>`<span>${esc(x)}</span>`).join('');
  }
  async function preview(){
    try{const out=await api('/api/network/targets/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targets:q('ndTarget').value,exclude:q('ndExclude').value,maxTargets:262144})});q('ndPreviewBox').className='nd-preview'+(out.hasPublicTargets?' warning':'');q('ndPreviewBox').innerHTML=`<strong>${Number(out.count).toLocaleString()} unique target(s)</strong> · ${Number(out.privateCount).toLocaleString()} local/private · ${Number(out.publicCount).toLocaleString()} public · samples: <span class="mono">${out.samples.map(esc).join(', ')}</span>`;return out;}catch(e){q('ndPreviewBox').className='nd-preview error';q('ndPreviewBox').textContent=e.message;throw e;}
  }
  q('ndPreview').addEventListener('click',()=>preview().catch(()=>{}));
  function customPorts(){return q('ndCustomPorts').value.split(/[ ,;]+/).map(Number).filter(n=>Number.isInteger(n)&&n>0&&n<=65535);}
  q('ndStart').addEventListener('click',async()=>{
    try{const pre=await preview();if(pre.hasPublicTargets&&!q('ndConfirmPublic').checked)throw new Error('Public targets require explicit authorization checkbox.');
      const body={targets:q('ndTarget').value,exclude:q('ndExclude').value,profile:q('ndProfile').value,timeoutMs:Number(q('ndTimeout').value),hostConcurrency:Number(q('ndHostConcurrency').value),serviceConcurrency:Number(q('ndServiceConcurrency').value),customPorts:customPorts(),useIcmp:q('ndIcmp').checked,verifyModbus:q('ndVerifyModbus').checked,enrichWeb:q('ndEnrichWeb').checked,confirmPublicTargets:q('ndConfirmPublic').checked};
      renderStatus(await api('/api/network/scan/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));ensurePolling();notify('Network scan started');
    }catch(e){notify(e.message,true);}
  });
  q('ndPause').addEventListener('click',async()=>renderStatus(await api('/api/network/scan/pause',{method:'POST'})));
  q('ndResume').addEventListener('click',async()=>renderStatus(await api('/api/network/scan/resume',{method:'POST'})));
  q('ndCancel').addEventListener('click',async()=>renderStatus(await api('/api/network/scan/cancel',{method:'POST'})));
  q('ndAux').addEventListener('click',async()=>{try{q('ndAux').disabled=true;const expectedDhcpServers=q('ndExpectedDhcp').value.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);const out=await api('/api/network/aux-discovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({timeoutMs:1500,expectedDhcpServers})});const findingText=out.findings?.length?` · ${out.findings.length} DHCP finding(s)`:'';notify(`Aux discovery found ${out.summary?.ips||0} unique IP(s)${findingText}`,Boolean(out.findings?.some(x=>x.severity==='critical')));await loadInventory();}catch(e){notify(e.message,true);}finally{q('ndAux').disabled=false;}});

  async function loadInventory(){
    const params=new URLSearchParams();if(q('ndInventorySearch').value.trim())params.set('search',q('ndInventorySearch').value.trim());if(q('ndInventoryClass').value)params.set('classification',q('ndInventoryClass').value);
    inventory=await api('/api/network/hosts?'+params.toString());const counts={all:inventory.length,online:inventory.filter(x=>x.state==='online').length,modbus:inventory.filter(x=>x.modbus?.verified).length,industrial:inventory.filter(x=>x.industrial).length,unknown:inventory.filter(x=>x.type==='Unknown').length};
    q('ndInventoryFilters').innerHTML=Object.entries(counts).map(([k,v])=>`<span><b>${v}</b> ${esc(k)}</span>`).join('');
    q('ndInventoryRows').innerHTML=inventory.length?inventory.map(h=>`<tr data-nd-host="${esc(h.id)}"><td><span class="nd-state ${h.state==='online'?'online':'unknown'}">${esc(h.state||'unknown')}</span></td><td class="mono"><strong>${esc(h.ip)}</strong></td><td>${esc(h.hostname||h.type||'Unknown')}<small>${esc(h.macVendor||'')}</small></td><td class="mono">${esc(h.mac||'—')}</td><td><span class="nd-badge">${esc(h.classification||'unknown')}</span></td><td>${esc(svcText(h))}</td><td>${h.modbus?.verified?'<span class="nd-badge good">Verified</span>':'—'}</td><td>${esc(fmtTime(h.lastChanged))}</td></tr>`).join(''):'<tr><td colspan="8" class="muted">No devices in inventory.</td></tr>';
  }
  q('ndInventorySearch').addEventListener('input',()=>loadInventory().catch(()=>{}));q('ndInventoryClass').addEventListener('change',()=>loadInventory().catch(()=>{}));q('ndRefreshInventory').addEventListener('click',()=>loadInventory().catch(e=>notify(e.message,true)));q('ndInventoryRows').addEventListener('click',e=>{const tr=e.target.closest('[data-nd-host]');if(tr)openDevice(tr.dataset.ndHost);});

  async function openDevice(id){
    try{currentDevice=await api('/api/network/hosts/'+encodeURIComponent(id));renderDrawer(currentDevice);q('ndDrawer').classList.add('open');q('ndDrawerBackdrop').classList.add('open');q('ndDrawer').setAttribute('aria-hidden','false');}catch(e){notify(e.message,true);}
  }
  function closeDrawer(){q('ndDrawer').classList.remove('open');q('ndDrawerBackdrop').classList.remove('open');q('ndDrawer').setAttribute('aria-hidden','true');currentDevice=null;}
  q('ndDrawerClose').addEventListener('click',closeDrawer);q('ndDrawerBackdrop').addEventListener('click',closeDrawer);

  function evidenceRows(h){return(h.evidence||[]).slice(0,50).map(x=>`<tr><td>${esc(x.field)}</td><td>${esc(x.value)}</td><td>${esc(x.source)}</td><td>${esc(x.status)}</td><td>${esc(x.confidence)}%</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No property evidence stored.</td></tr>';}
  function renderDrawer(h){
    q('ndDrawerTitle').textContent=h.hostname||h.ip||'Device';q('ndDrawerSub').textContent=[h.ip,h.mac,h.macVendor].filter(Boolean).join(' · ');
    const services=h.services||[],units=h.modbusUnits||[],metadata=h.metadata||{};
    q('ndDrawerBody').innerHTML=`
      <div class="nd-drawer-actions"><button data-action="master" class="primary">Open in Master</button><button data-action="copy-ip" class="secondary">Copy IP</button><button data-action="copy-mac" class="secondary" ${h.mac?'':'disabled'}>Copy MAC</button><button data-action="ping" class="secondary">Ping</button><button data-action="traceroute" class="secondary">Traceroute</button><button data-action="modbus" class="secondary">Scan Modbus Units</button><button data-action="monitor" class="secondary">Monitor</button><button data-action="nmap" class="secondary" ${capabilities?.nmap?.available?'':'disabled'}>Deep Scan / Nmap</button><button data-action="snmp" class="secondary">SNMP / LLDP</button><button data-action="web" class="secondary">Open Web UI</button></div>
      <div class="nd-drawer-tabs"><button class="active" data-drawer-tab="overview">Overview</button><button data-drawer-tab="services">Services</button><button data-drawer-tab="modbus">Modbus</button><button data-drawer-tab="network">Network</button><button data-drawer-tab="evidence">Evidence</button><button data-drawer-tab="notes">Notes</button></div>
      <div class="nd-detail-grid nd-drawer-panel active" data-drawer-panel="overview"><div><span>Status</span><strong>${esc(h.state||'unknown')}</strong></div><div><span>Classification</span><strong>${esc(h.classification||'unknown')}</strong></div><div><span>Type</span><strong>${esc(h.type||'Unknown')}</strong></div><div><span>Confidence</span><strong>${esc(h.confidence||0)}%</strong></div><div><span>First Seen</span><strong>${esc(fmtTime(h.firstSeen))}</strong></div><div><span>Last Seen</span><strong>${esc(fmtTime(h.lastSeen))}</strong></div></div>
      <section class="nd-drawer-section nd-drawer-panel" data-drawer-panel="services"><h4>Services</h4><div class="nd-service-list">${services.length?services.map(s=>`<span><b>${esc(s.port)}/${esc(s.protocol||'tcp')}</b> ${esc(s.name||'')} <small>${esc(s.category||'')}</small></span>`).join(''):'<span class="muted">No open services recorded.</span>'}</div></section>
      <section class="nd-drawer-section nd-drawer-panel" data-drawer-panel="modbus"><h4>Modbus</h4>${h.modbus?.verified?`<div class="nd-callout good"><b>Verified Modbus TCP</b><span>${esc(h.ip)}:${esc(h.modbus.port||502)} · initial Unit ${esc(h.modbus.unitId??'—')}</span></div>`:'<div class="nd-callout">Modbus not protocol-verified.</div>'}<div class="nd-unit-list">${units.map(u=>`<span>Unit <b>${esc(u.unitId)}</b> · ${esc([u.identification?.vendorName,u.identification?.modelName||u.identification?.productName,u.identification?.revision].filter(Boolean).join(' · ')||'responding')}</span>`).join('')}</div></section>
      <section class="nd-drawer-section nd-drawer-panel" data-drawer-panel="network"><h4>Network Diagnostics</h4><pre id="ndDiagnosticOutput">${esc(JSON.stringify(h.diagnostics||{},null,2))}</pre></section>
      <section class="nd-drawer-section nd-drawer-panel active" data-drawer-panel="overview"><h4>Project Correlation</h4><div class="nd-correlation">${(h.correlations?.channels||[]).length?`<div class="nd-callout good"><b>Matched existing TCP channel</b><span>${(h.correlations.channels||[]).map(x=>esc(x.name+' · '+(x.endpoint||x.channelId))).join('<br>')}</span></div>`:'<div class="nd-callout">No existing project TCP channel is correlated with this host yet.</div>'}${(h.correlations?.devices||[]).map(d=>`<span class="nd-badge good">Unit ${esc(d.unitId)} · ${esc([d.manufacturer,d.model].filter(Boolean).join(' ')||d.deviceKey)}</span>`).join(' ')}</div></section>
      <section class="nd-drawer-section nd-drawer-panel" data-drawer-panel="network"><h4>HTTP / TLS / Nmap / SNMP metadata</h4><pre>${esc(JSON.stringify({metadata,nmap:h.nmap||null,snmp:h.snmp||null},null,2))}</pre></section>
      <section class="nd-drawer-section nd-drawer-panel" data-drawer-panel="evidence"><h4>Evidence / Provenance</h4><div class="table-wrap"><table class="nd-table compact"><thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Status</th><th>Confidence</th></tr></thead><tbody>${evidenceRows(h)}</tbody></table></div></section>
      <section class="nd-drawer-section nd-drawer-panel" data-drawer-panel="notes"><h4>Classification & Notes</h4><div class="nd-inline"><select id="ndDrawerClass"><option>trusted</option><option>unknown</option><option>unexpected</option><option>ignored</option><option>decommissioned</option></select><button class="secondary" data-action="save-meta">Save</button></div><textarea id="ndDrawerNotes" rows="3" placeholder="Engineering notes">${esc(h.notes||'')}</textarea></section>
    `;
    q('ndDrawerClass').value=h.classification||'unknown';
  }
  q('ndDrawerBody').addEventListener('click',async e=>{
    const tabButton=e.target.closest('[data-drawer-tab]');
    if(tabButton){
      const name=tabButton.dataset.drawerTab;
      q('ndDrawerBody').querySelectorAll('[data-drawer-tab]').forEach(x=>x.classList.toggle('active',x===tabButton));
      q('ndDrawerBody').querySelectorAll('[data-drawer-panel]').forEach(x=>x.classList.toggle('active',x.dataset.drawerPanel===name));
      return;
    }
    const b=e.target.closest('[data-action]');if(!b||!currentDevice)return;const action=b.dataset.action,h=currentDevice;
    try{
      if(action==='master'){const out=await api('/api/network/hosts/'+encodeURIComponent(h.id)+'/open-master',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unitId:h.modbus?.unitId||h.modbusUnits?.[0]?.unitId||1})});closeDrawer();try{go('master');}catch{location.hash='#master';}setTimeout(()=>{document.querySelector('[data-master-type="tcp"]')?.click();const host=q('masterTcpHost'),port=q('masterTcpPort'),unit=q('masterUnitId');if(host)host.value=out.prepared.host;if(port)port.value=out.prepared.port;if(unit)unit.value=out.prepared.unitId;notify('Master prepared from Network Discovery; press Connect when ready.');},300);}
      if(action==='copy-ip'){await navigator.clipboard.writeText(h.ip);notify('IP copied');}
      if(action==='copy-mac'){if(!h.mac)throw new Error('No MAC address is recorded for this device.');await navigator.clipboard.writeText(h.mac);notify('MAC copied');}
      if(action==='ping'){b.disabled=true;const out=await api('/api/network/hosts/'+encodeURIComponent(h.id)+'/ping',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({timeoutMs:1200})});const box=q('ndDiagnosticOutput');if(box)box.textContent=JSON.stringify({ping:out},null,2);notify(out.responded?`Ping response · ${out.rttMs??'—'} ms`:'No ICMP response',!out.responded);}
      if(action==='traceroute'){b.disabled=true;const out=await api('/api/network/hosts/'+encodeURIComponent(h.id)+'/traceroute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({maxHops:24,perHopTimeoutMs:1000,timeoutMs:30000})});const box=q('ndDiagnosticOutput');if(box)box.textContent=JSON.stringify({traceroute:{ok:out.ok,hops:out.hops,error:out.error||null}},null,2);notify(`Traceroute returned ${out.hops?.length||0} hop(s)`,!out.ok);}
      if(action==='modbus'){if(!confirm(`Run read-only FC43 Unit scan on ${h.ip}? This actively transmits Modbus identification requests.`))return;b.disabled=true;const out=await api('/api/network/hosts/'+encodeURIComponent(h.id)+'/modbus',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unitStart:1,unitEnd:247,port:h.modbus?.port||502})});currentDevice=out.host;renderDrawer(currentDevice);notify(`${out.result.responding?.length||0} responding Unit(s) found`);}
      if(action==='nmap'){const allowOsDetect=confirm('Include Nmap OS fingerprinting? This sends additional active probes and may require elevated privileges. Choose Cancel for service/version enrichment only.');b.disabled=true;const out=await api('/api/network/hosts/'+encodeURIComponent(h.id)+'/nmap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({allowOsDetect})});currentDevice=out.host;renderDrawer(currentDevice);notify(allowOsDetect?'Nmap service + OS enrichment complete':'Nmap service enrichment complete');}
      if(action==='snmp'){const community=prompt('SNMP community (used for this read-only query only):','public');if(!community)return;b.disabled=true;const out=await api('/api/network/hosts/'+encodeURIComponent(h.id)+'/snmp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({community,readLldp:true})});currentDevice=out.host;renderDrawer(currentDevice);notify(`SNMP read complete · ${out.neighbors?.length||0} LLDP neighbor(s)`);}
      if(action==='monitor'){await api('/api/network/hosts/'+encodeURIComponent(h.id)+'/monitor',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intervalMs:30000})});notify('Device monitoring enabled at 30 s interval');}
      if(action==='web'){const httpsSvc=(h.services||[]).find(s=>s.port===443),httpSvc=(h.services||[]).find(s=>s.port===80);const svc=httpsSvc||httpSvc;if(!svc)throw new Error('No HTTP/HTTPS service recorded for this device.');window.open(`${svc.port===443?'https':'http'}://${h.ip}${[80,443].includes(svc.port)?'':':'+svc.port}`,'_blank','noopener');}
      if(action==='save-meta'){const updated=await api('/api/network/hosts/'+encodeURIComponent(h.id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({classification:q('ndDrawerClass').value,notes:q('ndDrawerNotes').value})});currentDevice=updated;renderDrawer(updated);notify('Device metadata saved');}
    }catch(err){notify(err.message,true);}finally{if(document.body.contains(b))b.disabled=false;}
  });

  function topologyVisibleHosts(){
    const query=q('ndTopologySearch').value.trim().toLowerCase(),status=q('ndTopologyStatus').value,protocol=q('ndTopologyProtocol').value;
    return topologyState.nodes.filter(n=>n.kind==='host').filter(n=>{
      if(query&&![n.label,n.ip,n.mac,n.type].some(v=>String(v||'').toLowerCase().includes(query)))return false;
      if(status&&n.state!==status)return false;
      if(protocol==='modbus'&&!n.modbus)return false;
      if(protocol==='industrial'&&!n.industrial)return false;
      return true;
    });
  }
  function renderTopologyGraph(){
    const viewport=q('ndTopologyViewport'),hosts=topologyVisibleHosts(),hostIds=new Set(hosts.map(h=>h.id)),memberships=topologyState.edges.filter(e=>e.kind==='logical-membership'&&hostIds.has(e.to)),subnetIds=[...new Set(memberships.map(e=>e.from))],subnets=subnetIds.map(id=>topologyState.nodes.find(n=>n.id===id)).filter(Boolean);
    if(!hosts.length){viewport.innerHTML='<div class="empty-state">No topology nodes match the current filters.</div>';return;}
    const positions=new Map(),subnetWidth=300,width=Math.max(900,subnets.length*subnetWidth+120);let maxY=300;
    subnets.forEach((s,si)=>{
      const x=100+si*subnetWidth+subnetWidth/2;positions.set(s.id,{x,y:65});
      const children=memberships.filter(e=>e.from===s.id).map(e=>topologyState.nodes.find(n=>n.id===e.to)).filter(Boolean);
      children.forEach((h,hi)=>{const col=hi%3,row=Math.floor(hi/3),hx=100+si*subnetWidth+55+col*80,hy=155+row*78;positions.set(h.id,{x:hx,y:hy});maxY=Math.max(maxY,hy+70);});
    });
    for(const h of hosts)if(!positions.has(h.id)){positions.set(h.id,{x:100+(positions.size%8)*105,y:maxY});maxY+=Math.floor(positions.size/8)?0:0;}
    const resolveId=value=>{
      if(positions.has(value))return value;
      const target=hosts.find(n=>[n.id,n.label,n.ip,n.mac].some(v=>String(v||'')===String(value||'')));
      return target?.id||null;
    };
    const visibleEdges=topologyState.edges.filter(e=>{
      const a=resolveId(e.from),b=resolveId(e.to);return a&&b&&positions.has(a)&&positions.has(b);
    });
    const edgeSvg=visibleEdges.map(e=>{const a=positions.get(resolveId(e.from)),b=positions.get(resolveId(e.to)),physical=Boolean(e.physical);return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${physical?'nd-edge-physical':'nd-edge-logical'}"><title>${esc(e.kind+' · '+e.source+' · '+e.confidence+'%')}</title></line>`;}).join('');
    const subnetSvg=subnets.map(s=>{const p=positions.get(s.id);return `<g class="nd-node nd-subnet-node"><rect x="${p.x-80}" y="${p.y-22}" width="160" height="44" rx="9"></rect><text x="${p.x}" y="${p.y-2}" text-anchor="middle">${esc(s.label||s.subnet||s.id)}</text><text class="small" x="${p.x}" y="${p.y+13}" text-anchor="middle">logical subnet</text></g>`;}).join('');
    const hostSvg=hosts.map(h=>{const p=positions.get(h.id),label=String(h.label||h.ip||h.id).slice(0,22),state=h.state==='online'?'online':'offline',kind=h.modbus?'modbus':h.industrial?'industrial':'normal';return `<g class="nd-node nd-host-node ${state} ${kind}" data-top-host="${esc(h.id)}" tabindex="0"><rect x="${p.x-43}" y="${p.y-25}" width="86" height="50" rx="8"></rect><circle cx="${p.x-32}" cy="${p.y-13}" r="4"></circle><text x="${p.x}" y="${p.y-2}" text-anchor="middle">${esc(label)}</text><text class="small" x="${p.x}" y="${p.y+13}" text-anchor="middle">${esc(h.ip||'')}</text></g>`;}).join('');
    viewport.innerHTML=`<svg class="nd-topology-svg" viewBox="0 0 ${width} ${Math.max(360,maxY)}" aria-label="Network topology"><g id="ndTopologyTransform" transform="translate(${topologyState.panX} ${topologyState.panY}) scale(${topologyState.zoom})">${edgeSvg}${subnetSvg}${hostSvg}</g></svg><div class="nd-topology-legend"><span><i class="logical"></i>Logical</span><span><i class="physical"></i>Physical evidence</span><span><b class="dot modbus"></b>Verified Modbus</span><span><b class="dot online"></b>Online</span></div>`;
    q('ndZoomReset').textContent=Math.round(topologyState.zoom*100)+'%';
  }
  async function loadTopology(){
    const [top,u]=await Promise.all([api('/api/network/topology'),api('/api/network/utilization')]);topologyState={...topologyState,nodes:top.nodes||[],edges:top.edges||[]};renderTopologyGraph();
    q('ndTopologyEdges').innerHTML=topologyState.edges.length?topologyState.edges.map(e=>`<tr><td>${esc(e.from)}</td><td>${esc(e.to)}</td><td>${esc(e.kind)}</td><td>${esc(e.source)}</td><td>${esc(e.confidence)}%</td><td>${e.physical?'Yes':'No'}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">No topology edges.</td></tr>';
    q('ndUtilization').innerHTML=(u.subnets||[]).map(s=>`<button class="nd-util-card" data-subnet="${esc(s.subnet)}"><strong>${esc(s.subnet)}</strong><span>${s.used} used · ${s.free} free</span><small>${s.modbus} Modbus · ${s.industrial} industrial · ${s.conflicts} conflict</small></button>`).join('')||'<div class="empty-state">No subnet utilization data.</div>';
  }
  q('ndRefreshTopology').addEventListener('click',()=>loadTopology().catch(e=>notify(e.message,true)));
  q('ndTopologyCanvas').addEventListener('click',e=>{const b=e.target.closest('[data-top-host]');if(b)openDevice(b.dataset.topHost);});
  for(const id of ['ndTopologySearch','ndTopologyStatus','ndTopologyProtocol'])q(id).addEventListener(id==='ndTopologySearch'?'input':'change',renderTopologyGraph);
  q('ndZoomIn').addEventListener('click',()=>{topologyState.zoom=Math.min(2.5,Math.round((topologyState.zoom+.15)*100)/100);renderTopologyGraph();});
  q('ndZoomOut').addEventListener('click',()=>{topologyState.zoom=Math.max(.45,Math.round((topologyState.zoom-.15)*100)/100);renderTopologyGraph();});
  q('ndZoomReset').addEventListener('click',()=>{topologyState.zoom=1;topologyState.panX=0;topologyState.panY=0;renderTopologyGraph();});
  let topoDrag=null;
  q('ndTopologyCanvas').addEventListener('pointerdown',e=>{if(e.target.closest('[data-top-host]'))return;topoDrag={x:e.clientX,y:e.clientY,panX:topologyState.panX,panY:topologyState.panY};q('ndTopologyCanvas').setPointerCapture?.(e.pointerId);});
  q('ndTopologyCanvas').addEventListener('pointermove',e=>{if(!topoDrag)return;topologyState.panX=topoDrag.panX+(e.clientX-topoDrag.x);topologyState.panY=topoDrag.panY+(e.clientY-topoDrag.y);const g=q('ndTopologyTransform');if(g)g.setAttribute('transform',`translate(${topologyState.panX} ${topologyState.panY}) scale(${topologyState.zoom})`);});
  q('ndTopologyCanvas').addEventListener('pointerup',()=>{topoDrag=null;});
  q('ndTopologyCanvas').addEventListener('wheel',e=>{e.preventDefault();topologyState.zoom=Math.max(.45,Math.min(2.5,topologyState.zoom+(e.deltaY<0?.08:-.08)));renderTopologyGraph();},{passive:false});
  q('ndUtilization').addEventListener('click',async e=>{const b=e.target.closest('[data-subnet]');if(!b)return;const out=await api('/api/network/utilization'),row=(out.subnets||[]).find(x=>x.subnet===b.dataset.subnet);if(!row)return;const base=row.subnet.replace('.0/24','.'),used=new Set(row.usedHosts||[]);q('ndUtilization').innerHTML=`<button class="secondary" id="ndUtilBack">← Subnets</button><div class="nd-address-grid">${Array.from({length:254},(_,i)=>i+1).map(n=>`<span class="${used.has(n)?'used':'free'}" title="${base+n}">${n}</span>`).join('')}</div>`;q('ndUtilBack').onclick=()=>loadTopology().catch(()=>{});});

  async function loadHistory(){
    const [scans,baselines,events]=await Promise.all([api('/api/network/scans'),api('/api/network/baselines'),api('/api/network/events?limit=300')]);
    q('ndScanHistory').innerHTML=scans.length?scans.map(s=>`<div class="nd-history-row"><div><strong>${esc(s.profile)} · ${esc(s.target)}</strong><small>${esc(fmtTime(s.completedAt))} · ${s.hostCount} host(s) · ${s.findingsCount} finding(s)</small></div><div><a class="button secondary" href="/api/network/scans/${encodeURIComponent(s.id)}/export.json">JSON</a><button class="secondary" data-baseline-scan="${esc(s.id)}">Save Baseline</button></div></div>`).join(''):'<div class="empty-state">No saved network scans.</div>';
    q('ndBaseline').innerHTML='<option value="">Choose baseline…</option>'+baselines.map(b=>`<option value="${esc(b.id)}">${esc(b.name)} · ${esc(fmtTime(b.createdAt))}</option>`).join('');q('ndCompareScan').innerHTML='<option value="">Choose scan…</option>'+scans.map(s=>`<option value="${esc(s.id)}">${esc(fmtTime(s.completedAt))} · ${esc(s.target)}</option>`).join('');
    q('ndEvents').innerHTML=events.length?events.map(e=>`<div class="nd-event"><i></i><div><strong>${esc(e.type)}</strong><span>${esc(e.ip||'')} ${esc(e.source||'')}</span><small>${esc(fmtTime(e.at))}</small></div></div>`).join(''):'<div class="empty-state">No network events.</div>';
  }
  q('ndRefreshHistory').addEventListener('click',()=>loadHistory().catch(e=>notify(e.message,true)));q('ndScanHistory').addEventListener('click',async e=>{const b=e.target.closest('[data-baseline-scan]');if(!b)return;const name=prompt('Baseline name:','Commissioning Reference')||'Commissioning Reference';try{await api('/api/network/scans/'+encodeURIComponent(b.dataset.baselineScan)+'/baseline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});await loadHistory();notify('Reference baseline saved');}catch(err){notify(err.message,true);}});
  q('ndCompare').addEventListener('click',async()=>{try{const baseline=q('ndBaseline').value,right=q('ndCompareScan').value;if(!baseline||!right)throw new Error('Select both a baseline and a current scan.');const out=await api('/api/network/compare?baseline='+encodeURIComponent(baseline)+'&right='+encodeURIComponent(right));q('ndCompareResult').innerHTML=`<div class="nd-compare-kpis"><span><b>${out.summary.added}</b> Added</span><span><b>${out.summary.removed}</b> Missing</span><span><b>${out.summary.changed}</b> Changed</span><span><b>${out.summary.unchanged}</b> Unchanged</span></div><div class="nd-compare-list">${out.changed.slice(0,30).map(x=>`<div><strong>${esc(x.after.ip||x.after.hostname)}</strong><small>${x.changes.map(c=>esc(c.field)).join(', ')}</small></div>`).join('')}</div>`;}catch(e){notify(e.message,true);}});

  q('ndProfile').addEventListener('change',()=>{const p=q('ndProfile').value,defaults={quick:[250,128,4,false,false],standard:[350,72,8,true,true],modbus:[400,64,4,true,false],deep:[500,32,10,true,true],custom:[350,64,8,false,false]}[p];if(defaults){q('ndTimeout').value=defaults[0];q('ndHostConcurrency').value=defaults[1];q('ndServiceConcurrency').value=defaults[2];q('ndVerifyModbus').checked=defaults[3];q('ndEnrichWeb').checked=defaults[4];}});

  Promise.all([loadInterfaces(),loadCapabilities(),refreshStatus()]).then(()=>{applyScanColumns();ensurePolling();preview().catch(()=>{});}).catch(()=>{});
})();
