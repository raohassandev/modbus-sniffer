'use strict';

(()=>{
  const q=id=>document.getElementById(id),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async(url,opt={})=>{const r=await fetch(url,{cache:'no-store',...opt});const ct=r.headers.get('content-type')||'';const b=ct.includes('json')?await r.json():await r.text();if(!r.ok){const e=new Error(b?.error||b||`HTTP ${r.status}`);e.code=b?.code||null;throw e;}return b;};
  const notify=(m,bad=false)=>{try{toast(m,bad);}catch{console[bad?'error':'log'](m);}};
  const page=q('page-discovery');if(!page)return;
  const anchor=page.querySelector('.discovery-head');
  if(anchor&&!q('activeDiscoveryPanel'))anchor.insertAdjacentHTML('afterend',`
    <article class="panel active-discovery-panel" id="activeDiscoveryPanel">
      <div class="panel-head"><div><div class="active-discovery-title"><h2>Active Device ID Scan</h2><span class="device-status warn">READ-ONLY TX</span></div><p>Optional FC43 / MEI 0x0E identification scan. It never sends Modbus write functions. Passive Discovery above remains RX-only.</p></div></div>
      <form id="activeDiscoveryForm">
        <div class="active-discovery-grid">
          <label>Transport<select id="activeDiscoveryTransport"><option value="TCP">Modbus TCP</option><option value="RTU">Modbus RTU / RS485</option></select></label>
          <label>Unit / Slave start<input id="activeDiscoveryStartUnit" type="number" min="0" max="255" value="1"></label>
          <label>Unit / Slave end<input id="activeDiscoveryEndUnit" type="number" min="0" max="255" value="20"></label>
          <label>Read Device ID code<select id="activeDiscoveryCode"><option value="1">1 · Basic</option><option value="2">2 · Regular</option><option value="3">3 · Extended</option><option value="4">4 · Specific</option></select></label>
          <div id="activeDiscoveryTcpFields" class="active-discovery-wide" style="display:contents">
            <label class="active-discovery-wide">TCP target host<input id="activeDiscoveryTcpHost" placeholder="192.168.1.50"></label>
            <label>TCP port<input id="activeDiscoveryTcpPort" type="number" min="1" max="65535" value="502"></label>
          </div>
          <div id="activeDiscoveryRtuFields" style="display:none;grid-column:1/-1">
            <div class="active-discovery-grid">
              <label class="active-discovery-wide">Serial port<div class="v6-row"><select id="activeDiscoveryRtuPort"></select><button id="activeDiscoveryRefreshPorts" type="button" class="secondary">Refresh</button></div></label>
              <label>Baud<input id="activeDiscoveryBaud" type="number" value="9600"></label>
              <label>Parity<select id="activeDiscoveryParity"><option>none</option><option>even</option><option>odd</option><option>mark</option><option>space</option></select></label>
              <label>Data bits<select id="activeDiscoveryDataBits"><option>8</option><option>7</option><option>6</option><option>5</option></select></label>
              <label>Stop bits<select id="activeDiscoveryStopBits"><option>1</option><option>2</option></select></label>
              <div class="active-discovery-safety" id="activeRtuSafety">
                <strong>RTU transmission safety gate</strong>
                <p>Disconnect passive capture first. Use this only during a maintenance window when this PC has exclusive control of the serial bus.</p>
                <label class="active-discovery-check"><input id="activeDiscoveryMaintenance" type="checkbox"> Maintenance mode is active and transmitting FC43 identification requests is approved.</label>
                <label class="active-discovery-check"><input id="activeDiscoveryExclusive" type="checkbox"> This scanner has exclusive bus-master control; no PLC/master is simultaneously transmitting.</label>
              </div>
            </div>
          </div>
          <label>Response timeout ms<input id="activeDiscoveryTimeout" type="number" min="100" max="10000" value="750"></label>
          <label>Inter-request delay ms<input id="activeDiscoveryDelay" type="number" min="20" max="10000" value="75"></label>
          <label>Max FC43 segments<input id="activeDiscoverySegments" type="number" min="1" max="32" value="8"></label>
        </div>
        <div class="active-discovery-actions"><button id="activeDiscoveryStart" class="primary" type="submit">Start active scan</button><button id="activeDiscoveryCancel" class="danger-outline" type="button" disabled>Cancel</button><span id="activeDiscoveryModeNote" class="muted">TCP sends read-only FC43 identification requests sequentially.</span></div>
      </form>
      <div class="active-discovery-status" id="activeDiscoveryStatus"><strong>Idle</strong><div class="active-discovery-progress"><i id="activeDiscoveryProgressBar"></i></div><div id="activeDiscoveryProgressText" class="muted">No active scan running.</div></div>
      <div class="table-wrap active-discovery-results"><table><thead><tr><th>Address</th><th>State</th><th>Identification</th><th>RTT</th></tr></thead><tbody id="activeDiscoveryResults"><tr><td colspan="4" class="muted">No active discovery results yet.</td></tr></tbody></table></div>
      <div class="active-discovery-evidence-head"><div><h3>Project Discovery Evidence</h3><p class="muted">Completed scans are preserved in the project as unassigned evidence. They are never auto-mapped to a device.</p></div><button id="activeDiscoveryRefreshEvidence" type="button" class="secondary">Refresh evidence</button></div>
      <div id="activeDiscoveryEvidence" class="active-discovery-evidence"><div class="empty-state">No saved discovery evidence.</div></div>
    </article>`);

  const transport=q('activeDiscoveryTransport'),tcpFields=q('activeDiscoveryTcpFields'),rtuFields=q('activeDiscoveryRtuFields'),startBtn=q('activeDiscoveryStart'),cancelBtn=q('activeDiscoveryCancel');
  let lastStatus=null,pollTimer=null,lastEvidenceId=null;

  function mode(){const rtu=transport.value==='RTU';tcpFields.style.display=rtu?'none':'contents';rtuFields.style.display=rtu?'block':'none';q('activeDiscoveryTimeout').value=rtu?'500':'750';q('activeDiscoveryDelay').value=rtu?'100':'75';q('activeDiscoveryStartUnit').min=rtu?'1':'0';q('activeDiscoveryEndUnit').max=rtu?'247':'255';q('activeDiscoveryModeNote').textContent=rtu?'RTU active scan requires both confirmations and passive capture disconnected.':'TCP sends read-only FC43 identification requests sequentially.';}
  transport.addEventListener('change',mode);mode();

  async function loadPorts(){try{const [ports,cfg]=await Promise.all([api('/api/ports'),api('/api/config')]);const sel=q('activeDiscoveryRtuPort'),current=sel.value||cfg.port||'';sel.innerHTML=ports.map(p=>`<option value="${safe(p.path)}">${safe(p.path)}${p.manufacturer?` · ${safe(p.manufacturer)}`:''}</option>`).join('')||'<option value="">No serial ports detected</option>';if([...sel.options].some(o=>o.value===current))sel.value=current;q('activeDiscoveryBaud').value=cfg.baudRate||9600;q('activeDiscoveryParity').value=cfg.parity||'none';q('activeDiscoveryDataBits').value=cfg.dataBits||8;q('activeDiscoveryStopBits').value=cfg.stopBits||1;}catch(e){notify(`Discovery ports: ${e.message}`,true);}}
  q('activeDiscoveryRefreshPorts').addEventListener('click',loadPorts);loadPorts();

  function rows(status){const list=status?.results?.length?status.results:(status?.result?.results||[]);if(!list.length)return'<tr><td colspan="4" class="muted">No active discovery results yet.</td></tr>';return list.map(r=>{const identified=[r.identification?.vendorName,r.identification?.productCode,r.identification?.modelName,r.identification?.revision].filter(Boolean).join(' · ');const state=!r.responded?'Silent':r.identificationSupported===false?'Responded · FC43 unsupported':identified?'Identified':'Responded';return`<tr><td><strong>${status.transport==='RTU'?'Slave':'Unit'} ${safe(r.unitId)}</strong></td><td>${safe(state)}</td><td>${safe(identified||'—')}</td><td>${r.avgRttMs==null?'—':`${safe(r.avgRttMs)} ms`}</td></tr>`;}).join('');}
  function render(status){lastStatus=status;const running=Boolean(status?.running),p=status?.progress||{},sum=status?.summary||{};startBtn.disabled=running;cancelBtn.disabled=!running;const pct=p.total?Math.max(0,Math.min(100,p.current/p.total*100)):0;q('activeDiscoveryProgressBar').style.width=`${pct}%`;let title='Idle';if(status?.state==='running')title=`${status.transport} scan running`;else if(status?.state==='cancelling')title='Cancelling scan…';else if(status?.state==='completed')title='Scan completed';else if(status?.state==='cancelled')title='Scan cancelled';else if(status?.state==='error')title='Scan failed';q('activeDiscoveryStatus').querySelector('strong').textContent=title;let detail='No active scan running.';if(running)detail=`${p.current||0}/${p.total||0} addresses checked${p.unitId!=null?` · current ${status.transport==='RTU'?'Slave':'Unit'} ${p.unitId}`:''} · ${sum.responding||0} responding · ${sum.identified||0} identified`;else if(status?.state==='completed')detail=`${sum.checked||0} checked · ${sum.responding||0} responding · ${sum.identified||0} identified · ${sum.unsupported||0} FC43 unsupported · ${sum.silent||0} silent${status.savedEvidenceId?' · saved to project':''}`;else if(status?.state==='error')detail=status.error?.message||'Active discovery failed.';else if(status?.state==='cancelled')detail=`Cancelled after ${sum.checked||0} address(es).`;q('activeDiscoveryProgressText').textContent=detail;q('activeDiscoveryResults').innerHTML=rows(status);if(status?.savedEvidenceId&&status.savedEvidenceId!==lastEvidenceId){lastEvidenceId=status.savedEvidenceId;loadEvidence().catch(()=>{});}}
  async function refreshStatus(){try{render(await api('/api/discovery/active/status'));}catch(e){q('activeDiscoveryProgressText').textContent=e.message;}}

  function evidenceTarget(run){return run.transport==='TCP'?`${run.target?.host||'?'}:${run.target?.port||502}`:`${run.target?.port||'?'} · ${run.target?.serial?.baudRate||'?'} baud`;}
  async function loadEvidence(){const runs=await api('/api/discovery/runs'),box=q('activeDiscoveryEvidence');box.innerHTML=runs.length?runs.map(run=>{const s=run.summary||{};return`<div class="v6-card active-discovery-evidence-row" data-run-id="${safe(run.id)}"><div><strong>${safe(run.transport)} · ${safe(evidenceTarget(run))}</strong><small>${run.completedAt?new Date(run.completedAt).toLocaleString():'Saved scan'} · range ${safe(run.unitStart??'—')}–${safe(run.unitEnd??'—')} · ${s.responding||0} responding · ${s.identified||0} identified · ${s.silent||0} silent</small></div><div class="button-row"><a class="button secondary" href="/api/discovery/runs/${encodeURIComponent(run.id)}/export.json">Export JSON</a><button class="danger-outline" type="button" data-delete-discovery="${safe(run.id)}">Delete</button></div></div>`;}).join(''):'<div class="empty-state">No saved discovery evidence.</div>';}
  q('activeDiscoveryRefreshEvidence').addEventListener('click',()=>loadEvidence().catch(e=>notify(e.message,true)));
  q('activeDiscoveryEvidence').addEventListener('click',async e=>{const b=e.target.closest('[data-delete-discovery]');if(!b)return;if(!confirm('Delete this saved discovery evidence? Device engineering data will not be changed.'))return;try{await api(`/api/discovery/runs/${encodeURIComponent(b.dataset.deleteDiscovery)}`,{method:'DELETE'});await loadEvidence();notify('Discovery evidence deleted');}catch(x){notify(x.message,true);}});

  function ensurePolling(){if(pollTimer)return;pollTimer=setInterval(()=>{if(location.hash==='#discovery'||lastStatus?.running)refreshStatus();},900);}
  ensurePolling();refreshStatus();loadEvidence().catch(()=>{});

  q('activeDiscoveryForm').addEventListener('submit',async e=>{e.preventDefault();const t=transport.value;if(t==='RTU'&&(!q('activeDiscoveryMaintenance').checked||!q('activeDiscoveryExclusive').checked))return notify('Confirm both RTU maintenance and exclusive-bus safety checks before transmitting.',true);const common={transport:t,unitStart:Number(q('activeDiscoveryStartUnit').value),unitEnd:Number(q('activeDiscoveryEndUnit').value),readDeviceIdCode:Number(q('activeDiscoveryCode').value),timeoutMs:Number(q('activeDiscoveryTimeout').value),interRequestMs:Number(q('activeDiscoveryDelay').value),maxSegments:Number(q('activeDiscoverySegments').value)};const body=t==='TCP'?{...common,host:q('activeDiscoveryTcpHost').value.trim(),port:Number(q('activeDiscoveryTcpPort').value)}:{...common,port:q('activeDiscoveryRtuPort').value,baudRate:Number(q('activeDiscoveryBaud').value),parity:q('activeDiscoveryParity').value,dataBits:Number(q('activeDiscoveryDataBits').value),stopBits:Number(q('activeDiscoveryStopBits').value),maintenanceConfirmed:q('activeDiscoveryMaintenance').checked,exclusiveBusConfirmed:q('activeDiscoveryExclusive').checked};try{const s=await api('/api/discovery/active/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});render(s);notify(`${t} active identification scan started`);}catch(x){notify(x.message,true);await refreshStatus();}});
  cancelBtn.addEventListener('click',async()=>{try{render(await api('/api/discovery/active/cancel',{method:'POST'}));}catch(e){notify(e.message,true);}});
  window.addEventListener('hashchange',()=>{if(location.hash==='#discovery'){refreshStatus();loadEvidence().catch(()=>{});}});
})();
