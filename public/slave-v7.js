'use strict';

(()=>{
  const meta=['Modbus Slave / Server','Simulate RTU, ASCII and TCP devices, edit memory and inspect incoming Modbus requests.'];
  try{pageMeta.slave=meta;}catch{/* shell unavailable */}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');
  if(!nav||!main||document.getElementById('page-slave'))return;

  const masterNav=nav.querySelector('[data-page="master"]');
  const button=document.createElement('button');
  button.className='nav-item';button.dataset.page='slave';
  button.innerHTML='<span>◧</span> Slave';
  if(masterNav?.nextSibling)nav.insertBefore(button,masterNav.nextSibling);else nav.appendChild(button);

  main.insertAdjacentHTML('beforeend',`
  <section class="page" id="page-slave">
    <div class="slave-workspace">
      <div class="slave-intro">
        <div><h2>Modbus Slave / Server</h2><p>Run controlled Modbus RTU, ASCII, TCP, TLS, UDP and tunnel simulators. This mode receives Master requests and transmits protocol responses.</p></div>
        <div class="slave-statuses">
          <span class="slave-chip" id="slaveRunChip"><i></i><span>Stopped</span></span>
          <span class="slave-chip active">ACTIVE SERVER MODE</span>
          <a class="button secondary" href="/api/slave/export.json">Export Map</a>
        </div>
      </div>

      <div class="slave-grid">
        <article class="slave-card">
          <div class="slave-card-head"><div><h3><span>1</span>Server Connection</h3><p>Choose framing and the physical/listening interface.</p></div></div>
          <div class="slave-card-body">
            <div class="slave-warning">ACTIVE MODE — the Slave sends Modbus responses. Serial resources cannot be shared silently with Sniffer, Master or Discovery.</div>
            <div class="slave-segments" id="slaveType"><button type="button" class="active" data-slave-type="tcp">TCP</button><button type="button" data-slave-type="rtu">RTU</button><button type="button" data-slave-type="ascii">ASCII</button><button type="button" data-slave-type="tls">TLS</button><button type="button" data-slave-type="udp">UDP</button><button type="button" data-slave-type="rtu-tcp">RTU/TCP</button><button type="button" data-slave-type="ascii-tcp">ASCII/TCP</button><button type="button" data-slave-type="rtu-udp">RTU/UDP</button><button type="button" data-slave-type="ascii-udp">ASCII/UDP</button></div>
            <div id="slaveTcpFields" class="slave-fields">
              <label>Listen IP<input id="slaveTcpHost" value="127.0.0.1"></label>
              <label>TCP Port<input id="slaveTcpPort" type="number" min="0" max="65535" value="502"></label>
              <label>Max Clients<input id="slaveMaxClients" type="number" min="1" max="256" value="32"></label>
              <label>Idle Timeout (ms)<input id="slaveIdleTimeout" type="number" min="0" value="0"></label>
              <label id="slaveMaxPeersRow" hidden>Max UDP Peers<input id="slaveMaxPeers" type="number" min="1" max="4096" value="256"></label>
              <label id="slaveTlsServernameRow" hidden>TLS minimum<select id="slaveTlsMinVersion"><option value="TLSv1.2">TLS 1.2+</option><option value="TLSv1.3">TLS 1.3</option></select></label>
              <label id="slaveTlsVerifyRow" class="slave-check" hidden><input id="slaveTlsRequestCert" type="checkbox"> Request client certificate</label>
              <label id="slaveTlsRejectRow" class="slave-check" hidden><input id="slaveTlsRejectUnauthorized" type="checkbox"> Require trusted client certificate</label>
              <label id="slaveTlsCertRow" class="slave-wide" hidden>Server Certificate PEM<textarea id="slaveTlsCert" rows="4"></textarea></label>
              <label id="slaveTlsKeyRow" class="slave-wide" hidden>Server Private Key PEM<textarea id="slaveTlsKey" rows="4"></textarea></label>
              <label id="slaveTlsCaRow" class="slave-wide" hidden>Client CA PEM <small>(for mTLS)</small><textarea id="slaveTlsCa" rows="4"></textarea></label>
            </div>
            <div id="slaveSerialFields" class="slave-fields" hidden>
              <label>COM / Serial Port<select id="slaveSerialPort"><option value="">Select port…</option></select></label>
              <label>Baud<select id="slaveBaud"><option>2400</option><option>4800</option><option selected>9600</option><option>19200</option><option>38400</option><option>57600</option><option>115200</option></select></label>
              <label>Parity<select id="slaveParity"><option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option><option value="mark">Mark</option><option value="space">Space</option></select></label>
              <label>Data Bits<select id="slaveDataBits"><option selected>8</option><option>7</option><option>6</option><option>5</option></select></label>
              <label>Stop Bits<select id="slaveStopBits"><option selected>1</option><option>2</option></select></label>
              <label>Echo Suppression<select id="slaveEcho"><option value="false" selected>Off</option><option value="true">On</option></select></label>
              <label>RTS TX Mode<select id="slaveRtsMode"><option value="none" selected>None</option><option value="high-during-tx">High during TX</option><option value="low-during-tx">Low during TX</option></select></label>
              <label>RTS Settle (ms)<input id="slaveRtsSettle" type="number" min="0" max="60000" value="0"></label>
            </div>
            <div class="slave-actions"><button class="primary" id="slaveStart">Start Server</button><button class="secondary" id="slaveStop" disabled>Stop Server</button><button class="secondary" id="slaveRefreshPorts">Refresh Ports</button></div>
            <div class="slave-note" id="slaveNote"><strong>Stopped.</strong> Configure a transport and press Start Server.</div>
          </div>
        </article>

        <article class="slave-card">
          <div class="slave-card-head"><div><h3><span>2</span>Server Statistics</h3><p>Live protocol behavior from the running simulator.</p></div></div>
          <div class="slave-card-body">
            <div class="slave-counters">
              <div><span>Requests</span><strong id="slaveRequests">0</strong></div>
              <div><span>Responses</span><strong id="slaveResponses">0</strong></div>
              <div><span>Broadcasts</span><strong id="slaveBroadcasts">0</strong></div>
              <div><span>Exceptions</span><strong id="slaveExceptions">0</strong></div>
              <div><span>Malformed</span><strong id="slaveMalformed">0</strong></div>
              <div><span>TCP Clients</span><strong id="slaveClientCount">0</strong></div>
            </div>
            <dl class="slave-details"><div><dt>Listen address</dt><dd id="slaveListenAddress">—</dd></div><div><dt>Units</dt><dd id="slaveUnitsSummary">—</dd></div><div><dt>Framing</dt><dd id="slaveFraming">—</dd></div><div><dt>Runtime errors</dt><dd id="slaveRuntimeErrors">0</dd></div></dl>
          </div>
        </article>

        <article class="slave-card slave-wide">
          <div class="slave-card-head"><div><h3><span>3</span>Unit / Device Management</h3><p>Each Unit ID has independent coils and register memory.</p></div><div class="slave-inline-actions"><button class="secondary" id="slaveAddDevice">Add Unit</button><button class="secondary" id="slaveRemoveDevice" disabled>Remove Selected</button></div></div>
          <div class="slave-card-body">
            <div class="slave-add-device">
              <label>Unit ID<input id="slaveNewUnitId" type="number" min="1" max="255" value="1"></label>
              <label>Coils<input id="slaveSizeCoils" type="number" min="0" max="65536" value="1024"></label>
              <label>Discrete Inputs<input id="slaveSizeDiscrete" type="number" min="0" max="65536" value="1024"></label>
              <label>Holding Registers<input id="slaveSizeHolding" type="number" min="0" max="65536" value="1024"></label>
              <label>Input Registers<input id="slaveSizeInput" type="number" min="0" max="65536" value="1024"></label>
            </div>
            <div class="slave-table-wrap"><table class="slave-table"><thead><tr><th>Unit</th><th>Coils</th><th>Discrete</th><th>Holding</th><th>Input</th><th>Writes</th></tr></thead><tbody id="slaveDevicesBody"><tr><td colspan="6" class="muted">Start or configure the Slave to create Unit IDs.</td></tr></tbody></table></div>
          </div>
        </article>

        <article class="slave-card slave-wide">
          <div class="slave-card-head"><div><h3><span>4</span>Memory Editor</h3><p>Edit simulator values directly; this does not bypass Modbus write policy for external Masters.</p></div></div>
          <div class="slave-card-body">
            <div class="slave-memory-controls">
              <label>Unit<select id="slaveMemoryUnit"></select></label>
              <label>Area<select id="slaveMemoryArea"><option value="holdingRegisters">Holding Registers (4xxxx)</option><option value="inputRegisters">Input Registers (3xxxx)</option><option value="coils">Coils (0xxxx)</option><option value="discreteInputs">Discrete Inputs (1xxxx)</option></select></label>
              <label>Start Address<input id="slaveMemoryAddress" type="number" min="0" max="65535" value="0"></label>
              <label>Quantity<input id="slaveMemoryQuantity" type="number" min="1" max="128" value="16"></label>
              <button class="secondary" id="slaveLoadMemory">Load</button>
              <button class="primary" id="slaveSaveMemory" disabled>Save Page</button>
            </div>
            <div class="slave-table-wrap slave-memory-wrap"><table class="slave-table"><thead><tr><th>Address</th><th>Reference</th><th>Value</th><th>HEX / State</th></tr></thead><tbody id="slaveMemoryBody"><tr><td colspan="4" class="muted">Select a Unit and load memory.</td></tr></tbody></table></div>
          </div>
        </article>

        <article class="slave-card">
          <div class="slave-card-head"><div><h3><span>5</span>TCP Clients</h3><p>Live client sessions connected to the TCP Slave.</p></div></div>
          <div class="slave-card-body"><div class="slave-table-wrap"><table class="slave-table"><thead><tr><th>Client</th><th>Remote</th><th>RX</th><th>TX</th><th>Last TID</th></tr></thead><tbody id="slaveClientsBody"><tr><td colspan="5" class="muted">No connected TCP clients.</td></tr></tbody></table></div></div>
        </article>

        <article class="slave-card">
          <div class="slave-card-head"><div><h3><span>6</span>Recent Protocol Events</h3><p>Requests, responses, broadcasts and simulator diagnostics.</p></div></div>
          <div class="slave-card-body"><div class="slave-table-wrap slave-events-wrap"><table class="slave-table"><thead><tr><th>Time</th><th>Dir</th><th>Unit</th><th>FC</th><th>Type</th><th>Raw</th></tr></thead><tbody id="slaveEventsBody"><tr><td colspan="6" class="muted">No Slave events yet.</td></tr></tbody></table></div></div>
        </article>

        <article class="slave-card slave-wide">
          <div class="slave-card-head"><div><h3>Simulator Map</h3><p>Save or restore connection, Unit IDs and non-zero memory as JSON.</p></div></div>
          <div class="slave-card-body slave-import-row"><input id="slaveImportFile" type="file" accept=".json,application/json"><button class="secondary" id="slaveImport">Import Map</button><a class="button secondary" href="/api/slave/export.json">Export JSON</a><span class="muted">Import requires the server to be stopped.</span></div>
        </article>
      </div>
    </div>
  </section>`);

  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={type:'tcp',running:false,configured:false,selectedUnit:null,lastMemory:null,timer:null,connectionDirty:true,tlsKeyConfigured:false};

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(body.error||`HTTP ${response.status}`);e.code=body.code;e.details=body.details;throw e;}
    return body;
  }

  function note(html,kind=''){q('slaveNote').className=`slave-note${kind?' '+kind:''}`;q('slaveNote').innerHTML=html;}

  function config(){
    const network=['tcp','tls','udp','rtu-tcp','ascii-tcp','rtu-udp','ascii-udp'].includes(state.type);
    if(network){
      const out={type:state.type,host:q('slaveTcpHost').value.trim()||'127.0.0.1',port:Number(q('slaveTcpPort').value||(state.type==='tls'?802:502)),maxClients:Number(q('slaveMaxClients').value||32),maxPeers:Number(q('slaveMaxPeers').value||256),idleTimeoutMs:Number(q('slaveIdleTimeout').value||0)};
      if(state.type==='tls'){
        const key=q('slaveTlsKey').value;
        if(!key&&state.tlsKeyConfigured&&state.connectionDirty)throw new Error('TLS private key is stored only in the running backend. Re-enter the private key before changing TLS server settings.');
        Object.assign(out,{cert:q('slaveTlsCert').value,key,ca:q('slaveTlsCa').value||null,requestCert:q('slaveTlsRequestCert').checked,rejectUnauthorized:q('slaveTlsRejectUnauthorized').checked,minVersion:q('slaveTlsMinVersion').value});
      }
      return out;
    }
    return {type:state.type,path:q('slaveSerialPort').value,baudRate:Number(q('slaveBaud').value||9600),parity:q('slaveParity').value,dataBits:Number(q('slaveDataBits').value||8),stopBits:Number(q('slaveStopBits').value||1),echoSuppression:q('slaveEcho').value==='true',rtsTxMode:q('slaveRtsMode').value,rtsSettleMs:Number(q('slaveRtsSettle').value||0)};
  }

  async function loadPorts(){
    try{
      const ports=await api('/api/ports'),current=q('slaveSerialPort').value;
      q('slaveSerialPort').innerHTML='<option value="">Select port…</option>'+ports.map(p=>`<option value="${esc(p.path)}">${esc(p.path)}${p.manufacturer?' — '+esc(p.manufacturer):''}</option>`).join('');
      if(ports.some(p=>p.path===current))q('slaveSerialPort').value=current;
    }catch(error){note('<strong>Port enumeration failed.</strong> '+esc(error.message),'error');}
  }

  function reference(area,address){
    const a=Number(address);
    if(area==='coils')return String(a+1).padStart(5,'0');
    if(area==='discreteInputs')return String(10001+a);
    if(area==='inputRegisters')return String(30001+a);
    return String(40001+a);
  }

  function renderStatus(status){
    state.running=Boolean(status.running);state.configured=Boolean(status.configured);
    const chip=q('slaveRunChip');chip.classList.toggle('running',state.running);chip.querySelector('span').textContent=state.running?'Running':'Stopped';
    q('slaveStart').disabled=state.running;q('slaveStop').disabled=!state.running;
    q('slaveType').querySelectorAll('button').forEach(b=>b.disabled=state.running);
    for(const id of ['slaveTcpHost','slaveTcpPort','slaveMaxClients','slaveMaxPeers','slaveIdleTimeout','slaveSerialPort','slaveBaud','slaveParity','slaveDataBits','slaveStopBits','slaveEcho','slaveRtsMode','slaveRtsSettle','slaveTlsMinVersion','slaveTlsRequestCert','slaveTlsRejectUnauthorized','slaveTlsCert','slaveTlsKey','slaveTlsCa']){const el=q(id);if(el)el.disabled=state.running;}
    const stats=status.server?.stats||{};
    q('slaveRequests').textContent=Number(stats.requests||0).toLocaleString();
    q('slaveResponses').textContent=Number(stats.responses||0).toLocaleString();
    q('slaveBroadcasts').textContent=Number(stats.broadcasts||0).toLocaleString();
    q('slaveExceptions').textContent=Number(stats.exceptions||0).toLocaleString();
    q('slaveMalformed').textContent=Number(stats.malformed||0).toLocaleString();
    q('slaveRuntimeErrors').textContent=Number(stats.runtimeErrors||0).toLocaleString();
    q('slaveClientCount').textContent=Number(status.clients?.length||0).toLocaleString();
    const addr=status.listenAddress;q('slaveListenAddress').textContent=addr?`${addr.address}:${addr.port}`:(status.config?.path||'—');
    q('slaveUnitsSummary').textContent=(status.devices||[]).map(d=>d.unitId).join(', ')||'—';
    q('slaveFraming').textContent=(status.config?.type||'—').toUpperCase();
    renderDevices(status.devices||[]);renderClients(status.clients||[]);
  }

  function renderDevices(devices){
    const body=q('slaveDevicesBody');
    body.innerHTML=devices.length?devices.map(d=>`<tr data-unit-id="${d.unitId}" class="${state.selectedUnit===d.unitId?'selected':''}"><td><strong>${d.unitId}</strong></td><td>${d.sizes.coils}</td><td>${d.sizes.discreteInputs}</td><td>${d.sizes.holdingRegisters}</td><td>${d.sizes.inputRegisters}</td><td>${d.writableAreas.coils?'Coils ':''}${d.writableAreas.holdingRegisters?'Holding':''}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">No Unit IDs configured.</td></tr>';
    const select=q('slaveMemoryUnit'),current=Number(select.value||state.selectedUnit||0);
    select.innerHTML=devices.map(d=>`<option value="${d.unitId}">Unit ${d.unitId}</option>`).join('');
    if(devices.some(d=>d.unitId===current))select.value=String(current);
    else if(devices[0]){select.value=String(devices[0].unitId);state.selectedUnit=devices[0].unitId;}
    q('slaveRemoveDevice').disabled=!state.selectedUnit||devices.length<=1;
  }

  function renderClients(clients){
    q('slaveClientsBody').innerHTML=clients.length?clients.map(c=>`<tr><td>${esc(c.clientId)}</td><td class="mono">${esc(c.remoteAddress||'')}:${c.remotePort??''}</td><td>${c.framesRx||0}</td><td>${c.framesTx||0}</td><td>${c.lastTransactionId??'—'}</td></tr>`).join(''):'<tr><td colspan="5" class="muted">No connected TCP clients.</td></tr>';
  }

  function renderEvents(events){
    q('slaveEventsBody').innerHTML=events.length?[...events].reverse().map(e=>`<tr><td>${new Date(e.timestamp).toLocaleTimeString([],{hour12:false})}</td><td>${esc((e.direction||'—').toUpperCase())}</td><td>${e.unitId??'—'}</td><td>${e.functionCode==null?'—':'FC'+String(e.functionCode&0x7F).padStart(2,'0')}</td><td>${esc(e.type)}</td><td class="mono slave-raw">${esc(e.rawHex||'')}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">No Slave events yet.</td></tr>';
  }

  async function refresh(){
    try{
      const [status,events]=await Promise.all([api('/api/slave/status'),api('/api/slave/events?limit=80')]);
      renderStatus(status);renderEvents(events);
    }catch{/* server may be older during rolling checkout */}
  }

  async function start(extra={}){
    try{
      note('<strong>Starting…</strong> Opening the active Slave server.');
      const body=state.configured&&!state.connectionDirty?{reuseConfigured:true,...extra}:{...config(),...extra};
      const status=await api('/api/slave/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      state.connectionDirty=false;
      if(state.type==='tls'){state.tlsKeyConfigured=true;q('slaveTlsKey').value='';}
      renderStatus(status);note('<strong>Running.</strong> The Slave is ready for external Modbus Master requests.','good');
      await loadMemory();
    }catch(error){
      if(error.code==='PASSIVE_CAPTURE_ACTIVE'){
        if(confirm(`Passive Sniffer currently owns ${error.details?.port||'this serial port'}. Switch it to active Slave mode?`))return start({...extra,confirmPassiveDisconnect:true});
      }
      if(error.code==='MASTER_ACTIVE'){
        if(confirm(`Modbus Master currently owns ${error.details?.port||'this serial port'}. Disconnect Master and start Slave mode?`))return start({...extra,confirmMasterDisconnect:true});
      }
      if(error.code==='RAW_LAB_ACTIVE'){
        if(confirm(`Raw Frame Lab currently owns ${error.details?.port||'this serial port'}. Close Raw Lab and start Slave mode?`))return start({...extra,confirmRawLabClose:true});
      }
      note('<strong>Start failed.</strong> '+esc(error.message),'error');
    }
  }

  async function stop(){
    try{const status=await api('/api/slave/stop',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});renderStatus(status);note('<strong>Stopped.</strong> Memory and Unit definitions are retained until reconfiguration.');}
    catch(error){note('<strong>Stop failed.</strong> '+esc(error.message),'error');}
  }

  async function ensureConfigured(){
    if(state.configured)return;
    const status=await api('/api/slave/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(config())});
    renderStatus(status);state.connectionDirty=false;if(state.type==='tls'){state.tlsKeyConfigured=true;q('slaveTlsKey').value='';}
  }

  async function addDevice(){
    try{
      await ensureConfigured();
      const payload={unitId:Number(q('slaveNewUnitId').value),sizes:{coils:Number(q('slaveSizeCoils').value),discreteInputs:Number(q('slaveSizeDiscrete').value),holdingRegisters:Number(q('slaveSizeHolding').value),inputRegisters:Number(q('slaveSizeInput').value)},writableAreas:{coils:true,holdingRegisters:true}};
      await api('/api/slave/devices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      state.selectedUnit=payload.unitId;await refresh();await loadMemory();
    }catch(error){note('<strong>Add Unit failed.</strong> '+esc(error.message),'error');}
  }

  async function removeDevice(){
    if(!state.selectedUnit)return;
    if(!confirm(`Remove Unit ${state.selectedUnit} from this simulator?`))return;
    try{await api('/api/slave/devices/'+state.selectedUnit,{method:'DELETE'});state.selectedUnit=null;await refresh();await loadMemory();}
    catch(error){note('<strong>Remove Unit failed.</strong> '+esc(error.message),'error');}
  }

  async function loadMemory(){
    const unit=Number(q('slaveMemoryUnit').value||state.selectedUnit||0);if(!unit){q('slaveMemoryBody').innerHTML='<tr><td colspan="4" class="muted">No Unit selected.</td></tr>';q('slaveSaveMemory').disabled=true;return;}
    const area=q('slaveMemoryArea').value,address=Number(q('slaveMemoryAddress').value||0),quantity=Number(q('slaveMemoryQuantity').value||16);
    try{
      const memory=await api(`/api/slave/memory?unitId=${unit}&area=${encodeURIComponent(area)}&address=${address}&quantity=${quantity}`);
      state.lastMemory=memory;state.selectedUnit=unit;
      q('slaveMemoryBody').innerHTML=memory.values.map((value,index)=>{
        const a=memory.address+index,isBit=area==='coils'||area==='discreteInputs',numeric=isBit?(value?1:0):Number(value);
        return `<tr><td class="mono"><strong>${a}</strong></td><td class="mono">${reference(area,a)}</td><td><input class="slave-memory-value" data-index="${index}" type="number" ${isBit?'min="0" max="1"':'min="0" max="65535"'} value="${numeric}"></td><td class="mono">${isBit?(numeric?'ON / 1':'OFF / 0'):'0x'+numeric.toString(16).toUpperCase().padStart(4,'0')}</td></tr>`;
      }).join('');
      q('slaveSaveMemory').disabled=false;
    }catch(error){q('slaveMemoryBody').innerHTML='<tr><td colspan="4" class="muted">'+esc(error.message)+'</td></tr>';q('slaveSaveMemory').disabled=true;}
  }

  async function saveMemory(){
    if(!state.lastMemory)return;
    const values=[...q('slaveMemoryBody').querySelectorAll('.slave-memory-value')].map(input=>Number(input.value));
    try{
      const memory=await api('/api/slave/memory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unitId:state.lastMemory.unitId,area:state.lastMemory.area,address:state.lastMemory.address,values})});
      state.lastMemory=memory;await loadMemory();note('<strong>Memory updated.</strong> Simulator values are ready for the next Modbus request.','good');
    }catch(error){note('<strong>Memory update failed.</strong> '+esc(error.message),'error');}
  }

  async function importMap(){
    const file=q('slaveImportFile').files?.[0];if(!file)return note('<strong>Select a JSON simulator map first.</strong>','error');
    try{
      const payload=JSON.parse(await file.text());
      if(payload?.config?.type==='tls'&&!payload?.config?.tls?.key){
        const key=q('slaveTlsKey').value.trim();
        if(!key)throw new Error('TLS exports intentionally exclude the private key. Paste the server private key in the TLS field before importing this map.');
        payload.config.tls={...(payload.config.tls||{}),key};
      }
      const status=await api('/api/slave/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      if(status.config){state.type=status.config.type||'tcp';syncTypeUi();applyConfig(status.config);}
      state.connectionDirty=false;
      if(state.type==='tls'){state.tlsKeyConfigured=true;q('slaveTlsKey').value='';}
      renderStatus(status);await loadMemory();note('<strong>Map imported.</strong> Review the connection and press Start Server.','good');
    }catch(error){note('<strong>Import failed.</strong> '+esc(error.message),'error');}
  }

  function applyConfig(cfg){
    if(!cfg)return;
    const network=['tcp','tls','udp','rtu-tcp','ascii-tcp','rtu-udp','ascii-udp'].includes(cfg.type);
    if(network){
      q('slaveTcpHost').value=cfg.host||'127.0.0.1';q('slaveTcpPort').value=cfg.port??(cfg.type==='tls'?802:502);q('slaveMaxClients').value=cfg.maxClients??32;q('slaveMaxPeers').value=cfg.maxPeers??256;q('slaveIdleTimeout').value=cfg.idleTimeoutMs??0;
      if(cfg.tls){
        q('slaveTlsCert').value=cfg.tls.cert||'';q('slaveTlsKey').value='';q('slaveTlsCa').value=cfg.tls.ca||'';q('slaveTlsRequestCert').checked=Boolean(cfg.tls.requestCert);q('slaveTlsRejectUnauthorized').checked=Boolean(cfg.tls.rejectUnauthorized);q('slaveTlsMinVersion').value=cfg.tls.minVersion||'TLSv1.2';
        state.tlsKeyConfigured=Boolean(cfg.tls.keyConfigured);
        q('slaveTlsKey').placeholder=state.tlsKeyConfigured?'Private key stored in backend; re-enter only to change TLS settings':'Server private key PEM';
      }
    } else {q('slaveSerialPort').value=cfg.path||'';q('slaveBaud').value=cfg.baudRate||9600;q('slaveParity').value=cfg.parity||'none';q('slaveDataBits').value=cfg.dataBits||8;q('slaveStopBits').value=cfg.stopBits||1;q('slaveEcho').value=String(Boolean(cfg.echoSuppression));q('slaveRtsMode').value=cfg.rtsTxMode||'none';q('slaveRtsSettle').value=cfg.rtsSettleMs||0;}
    state.connectionDirty=false;
  }

  function syncTypeUi(){
    const network=['tcp','tls','udp','rtu-tcp','ascii-tcp','rtu-udp','ascii-udp'].includes(state.type),tls=state.type==='tls',udp=state.type.includes('udp');
    q('slaveTcpFields').hidden=!network;q('slaveSerialFields').hidden=network;
    for(const id of ['slaveTlsServernameRow','slaveTlsVerifyRow','slaveTlsRejectRow','slaveTlsCertRow','slaveTlsKeyRow','slaveTlsCaRow'])q(id).hidden=!tls;
    q('slaveMaxPeersRow').hidden=!udp;
    if(network&&document.activeElement?.id!=='slaveTcpPort')q('slaveTcpPort').value=state.type==='tls'?802:(q('slaveTcpPort').value||502);
    q('slaveType').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.slaveType===state.type));
  }

  q('slaveType').addEventListener('click',e=>{const b=e.target.closest('[data-slave-type]');if(!b||state.running)return;state.type=b.dataset.slaveType;state.connectionDirty=true;syncTypeUi();});
  q('slaveStart').addEventListener('click',()=>start());
  q('slaveStop').addEventListener('click',stop);
  q('slaveRefreshPorts').addEventListener('click',loadPorts);
  q('slaveAddDevice').addEventListener('click',addDevice);
  q('slaveRemoveDevice').addEventListener('click',removeDevice);
  q('slaveDevicesBody').addEventListener('click',e=>{const row=e.target.closest('[data-unit-id]');if(!row)return;state.selectedUnit=Number(row.dataset.unitId);q('slaveMemoryUnit').value=String(state.selectedUnit);refresh();loadMemory();});
  q('slaveMemoryUnit').addEventListener('change',()=>{state.selectedUnit=Number(q('slaveMemoryUnit').value);loadMemory();});
  q('slaveMemoryArea').addEventListener('change',loadMemory);
  q('slaveLoadMemory').addEventListener('click',loadMemory);
  q('slaveSaveMemory').addEventListener('click',saveMemory);
  q('slaveImport').addEventListener('click',importMap);
  for(const id of ['slaveTcpHost','slaveTcpPort','slaveMaxClients','slaveMaxPeers','slaveIdleTimeout','slaveSerialPort','slaveBaud','slaveParity','slaveDataBits','slaveStopBits','slaveEcho','slaveRtsMode','slaveRtsSettle','slaveTlsMinVersion','slaveTlsRequestCert','slaveTlsRejectUnauthorized','slaveTlsCert','slaveTlsKey','slaveTlsCa']){
    q(id)?.addEventListener('input',()=>{state.connectionDirty=true;});
    q(id)?.addEventListener('change',()=>{state.connectionDirty=true;});
  }

  window.addEventListener('message',()=>{});
  syncTypeUi();loadPorts();
  refresh().then(async()=>{try{const status=await api('/api/slave/status');if(status.config){state.type=status.config.type||'tcp';syncTypeUi();applyConfig(status.config);}if(status.configured)await loadMemory();}catch{}});
  state.timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},1000);
})();