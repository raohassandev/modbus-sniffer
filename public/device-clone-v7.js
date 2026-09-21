'use strict';

(()=>{
  const meta=['Device Clone','Turn captured Modbus evidence into a controlled Slave simulator map.'];
  try{pageMeta.deviceClone=meta;}catch{/* stable shell unavailable */}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');
  if(!nav||!main||document.getElementById('page-deviceClone'))return;

  const slaveNav=nav.querySelector('[data-page="slave"]');
  const button=document.createElement('button');
  button.className='nav-item';button.dataset.page='deviceClone';
  button.innerHTML='<span>◇</span> Device Clone';
  if(slaveNav?.nextSibling)nav.insertBefore(button,slaveNav.nextSibling);else nav.appendChild(button);

  main.insertAdjacentHTML('beforeend',`
    <section class="page" id="page-deviceClone">
      <div class="clone-workspace">
        <div class="clone-intro">
          <div><h2>Device Clone / Capture → Simulator</h2><p>Build a controlled virtual Slave from register evidence already observed by the passive Sniffer.</p></div>
          <span class="clone-chip">MODBUS RESEARCH</span>
        </div>

        <div class="clone-grid">
          <article class="clone-card">
            <div class="clone-card-head"><h3>1. Source Evidence</h3><button class="secondary" id="cloneRefresh">Refresh Captured Devices</button></div>
            <div class="clone-card-body">
              <label>Captured Device<select id="cloneSource"><option value="">Select captured device…</option></select></label>
              <div id="cloneSourceInfo" class="clone-info">Passive capture must contain at least one confirmed Modbus device with register evidence.</div>
            </div>
          </article>

          <article class="clone-card">
            <div class="clone-card-head"><h3>2. Target Simulator</h3></div>
            <div class="clone-card-body clone-fields">
              <label>Target Unit ID<input id="cloneUnit" type="number" min="1" max="255" value="1"></label>
              <label>Listen IP<input id="cloneHost" value="127.0.0.1"></label>
              <label>TCP Port<input id="clonePort" type="number" min="0" max="65535" value="1502"></label>
              <label>Max Clients<input id="cloneClients" type="number" min="1" max="256" value="32"></label>
              <label class="clone-write-option"><input id="cloneAllowWrites" type="checkbox"> Make Coils/Holding Registers externally writable</label>
            </div>
          </article>

          <article class="clone-card clone-wide">
            <div class="clone-card-head"><h3>3. Preview & Provenance</h3><div><button class="secondary" id="clonePreview">Preview Clone</button><button class="primary" id="cloneApply" disabled>Apply to Slave</button></div></div>
            <div class="clone-card-body">
              <div id="cloneSummary" class="clone-summary"><div class="clone-empty">Choose a captured device and preview the clone.</div></div>
              <details class="clone-json"><summary>Simulator map JSON</summary><pre id="cloneJson">—</pre></details>
              <div id="cloneResult" class="clone-result" hidden></div>
            </div>
          </article>
        </div>
      </div>
    </section>`);

  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let sources=[],preview=null;

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(body.error||`HTTP ${response.status}`);e.code=body.code;e.details=body.details;throw e;}
    return body;
  }

  async function refresh(){
    const select=q('cloneSource'),current=select.value;
    try{
      sources=await api('/api/device-clone/sources');
      select.innerHTML='<option value="">Select captured device…</option>'+sources.map(item=>`<option value="${esc(item.deviceKey)}">${esc(item.channelName||item.channelId)} · Unit ${item.unitId} · ${item.registerCount} regs</option>`).join('');
      if(sources.some(x=>x.deviceKey===current))select.value=current;
      updateSource();
    }catch(error){
      q('cloneSourceInfo').innerHTML='<strong>Could not read capture inventory.</strong> '+esc(error.message);
    }
  }

  function updateSource(){
    const source=sources.find(x=>x.deviceKey===q('cloneSource').value);
    preview=null;q('cloneApply').disabled=true;q('cloneJson').textContent='—';
    if(!source){
      q('cloneSourceInfo').textContent='Passive capture must contain at least one confirmed Modbus device with register evidence.';
      q('cloneSummary').innerHTML='<div class="clone-empty">Choose a captured device and preview the clone.</div>';
      return;
    }
    q('cloneUnit').value=source.unitId;
    q('cloneSourceInfo').innerHTML=`<strong>${esc(source.name||'Unit '+source.unitId)}</strong><br>${esc(source.transport)} · ${esc(source.channelName||source.channelId)} · ${source.registerCount} observed registers · functions ${esc((source.functions||[]).join(', '))}`;
  }

  function options(){
    const source=sources.find(x=>x.deviceKey===q('cloneSource').value);
    if(!source)throw new Error('Select a captured device first.');
    return {
      deviceKey:source.deviceKey,
      channelId:source.channelId,
      targetUnitId:Number(q('cloneUnit').value),
      host:q('cloneHost').value.trim()||'127.0.0.1',
      port:Number(q('clonePort').value||1502),
      maxClients:Number(q('cloneClients').value||32),
      allowWrites:q('cloneAllowWrites').checked,
    };
  }

  function renderPreview(value){
    preview=value;
    const counts=value.areaCounts||{},src=value.source||{},policy=value.policy||{};
    q('cloneSummary').innerHTML=`
      <div><span>Source</span><strong>${esc(src.deviceKey||'—')}</strong></div>
      <div><span>Cloned points</span><strong>${src.clonedPoints??0}</strong></div>
      <div><span>Uncertain</span><strong>${src.uncertainPoints??0}</strong></div>
      <div><span>Coils</span><strong>${counts.coils??0}</strong></div>
      <div><span>Discrete</span><strong>${counts.discreteInputs??0}</strong></div>
      <div><span>Holding</span><strong>${counts.holdingRegisters??0}</strong></div>
      <div><span>Input</span><strong>${counts.inputRegisters??0}</strong></div>
      <div><span>Write policy</span><strong>${esc(policy.safeDefault||'—')}</strong></div>`;
    q('cloneJson').textContent=JSON.stringify(value.map,null,2);
    q('cloneApply').disabled=false;
  }

  async function doPreview(){
    try{
      q('cloneResult').hidden=true;
      const value=await api('/api/device-clone/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options())});
      renderPreview(value);
    }catch(error){
      preview=null;q('cloneApply').disabled=true;
      q('cloneSummary').innerHTML='<div class="clone-error"><strong>Preview failed.</strong> '+esc(error.message)+'</div>';
    }
  }

  async function apply(){
    try{
      const opts=options();
      if(opts.allowWrites&&!confirm('This clone will accept external Modbus writes to Coils/Holding Registers. Continue?'))return;
      if(!confirm('Apply this captured map to the built-in Slave? The Slave must be stopped and its current map will be replaced.'))return;
      q('cloneApply').disabled=true;
      const result=await api('/api/device-clone/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(opts)});
      renderPreview(result.preview);
      q('cloneResult').hidden=false;
      q('cloneResult').className='clone-result success';
      q('cloneResult').innerHTML=`<strong>Clone applied.</strong> Unit ${result.preview.map.devices[0].unitId} is loaded in Slave and remains stopped until you start it.`;
    }catch(error){
      q('cloneResult').hidden=false;q('cloneResult').className='clone-result error';
      q('cloneResult').innerHTML='<strong>Apply failed.</strong> '+esc(error.message);
      q('cloneApply').disabled=!preview;
    }
  }

  q('cloneRefresh').addEventListener('click',refresh);
  q('cloneSource').addEventListener('change',updateSource);
  q('clonePreview').addEventListener('click',doPreview);
  q('cloneApply').addEventListener('click',apply);
  refresh();
})();