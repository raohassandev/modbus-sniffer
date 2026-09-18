'use strict';
(()=>{
  const page=document.getElementById('page-discovery');if(!page||document.getElementById('discoveryEngineeringPanel'))return;
  const q=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  page.insertAdjacentHTML('beforeend',`
    <article class="panel discovery-engineering" id="discoveryEngineeringPanel">
      <div class="panel-head"><div><h2>Engineering Discovery</h2><p>Uses the currently connected stable Master for safe Unit, range, function and quantity probes.</p></div><button class="secondary" id="deRefreshRuns">Refresh Runs</button></div>
      <div class="de-body">
        <div class="de-tabs" id="deTabs"><button class="active" data-mode="unit">Unit Scan</button><button data-mode="range">Range Scan</button><button data-mode="function">Function Probe</button><button data-mode="quantity">Quantity Probe</button></div>
        <div class="de-form">
          <label>Unit ID<input id="deUnit" type="number" min="1" max="255" value="1"></label>
          <label>Function<select id="deFc"><option value="3">FC03</option><option value="4">FC04</option><option value="1">FC01</option><option value="2">FC02</option></select></label>
          <label>Start Address<input id="deAddressStart" type="number" min="0" max="65535" value="0"></label>
          <label>End Address<input id="deAddressEnd" type="number" min="0" max="65535" value="31"></label>
          <label>Chunk / Quantity<input id="deQuantity" type="number" min="1" value="1"></label>
          <label>Timeout ms<input id="deTimeout" type="number" min="50" value="500"></label>
          <label>Inter-request ms<input id="deDelay" type="number" min="0" value="40"></label>
          <label class="de-unit-only">Unit Start<input id="deUnitStart" type="number" min="1" max="255" value="1"></label>
          <label class="de-unit-only">Unit End<input id="deUnitEnd" type="number" min="1" max="255" value="20"></label>
          <label class="de-function-only" hidden>Function codes CSV<input id="deFunctions" value="1,2,3,4,7,8,11,12,17,24,43"></label>
          <label class="de-quantity-only" hidden>Quantities CSV<input id="deQuantities" value="1,2,4,8,16,32,64,100,125"></label>
          <button class="primary de-wide" id="deRun">Run Engineering Scan</button>
          <div class="de-wide de-note" id="deNote">Connect Master first. These probes do not open a second connection.</div>
        </div>
        <div class="de-result" id="deResult"><div class="empty-state">No engineering scan yet.</div></div>
        <div class="de-run-head"><strong>Recent Runs</strong><span class="muted">Select one to inspect or adopt</span></div>
        <div class="de-runs" id="deRuns"><div class="empty-state">No runs.</div></div>
      </div>
    </article>`);
  let mode='unit',runs=[],activeRun=null;
  async function api(url,opt={}){const r=await fetch(url,opt),body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);return body;}
  function setMode(m){mode=m;q('deTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));document.querySelectorAll('.de-unit-only').forEach(x=>x.hidden=m!=='unit');document.querySelectorAll('.de-function-only').forEach(x=>x.hidden=m!=='function');document.querySelectorAll('.de-quantity-only').forEach(x=>x.hidden=m!=='quantity');q('deAddressEnd').parentElement.hidden=m!=='range';q('deQuantity').parentElement.hidden=m==='function';}
  q('deTabs').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b)setMode(b.dataset.mode);});
  function payload(){const base={unitId:Number(q('deUnit').value),functionCode:Number(q('deFc').value),address:Number(q('deAddressStart').value),addressStart:Number(q('deAddressStart').value),addressEnd:Number(q('deAddressEnd').value),timeoutMs:Number(q('deTimeout').value),interRequestMs:Number(q('deDelay').value)};if(mode==='unit')Object.assign(base,{unitStart:Number(q('deUnitStart').value),unitEnd:Number(q('deUnitEnd').value),quantity:Number(q('deQuantity').value)});if(mode==='range')base.chunk=Number(q('deQuantity').value);if(mode==='function')base.functionCodes=q('deFunctions').value.split(',').map(Number).filter(Number.isFinite);if(mode==='quantity')base.quantities=q('deQuantities').value.split(',').map(Number).filter(Number.isFinite);return base;}
  function renderRun(run){activeRun=run;const r=run.result||{};let html='<div class="de-summary"><span>Run</span><strong>'+esc(run.type)+'</strong><span>ID</span><code>'+esc(run.runId)+'</code></div>';
    if(run.type==='unit-scan')html+='<div class="de-table"><table><thead><tr><th>Unit</th><th>State</th><th>RTT</th><th>Values</th></tr></thead><tbody>'+r.results.map(x=>'<tr><td>'+x.unitId+'</td><td>'+(x.responded?'Responded':'Silent/Error')+'</td><td>'+esc(x.rttMs==null?'—':Number(x.rttMs).toFixed(1)+' ms')+'</td><td>'+esc((x.values||[]).join(', '))+'</td></tr>').join('')+'</tbody></table></div>';
    if(run.type==='range-scan')html+='<div class="de-actions"><button class="secondary" id="deAdoptMaster">Open Range in Master</button><button class="secondary" id="deAdoptSlave">Seed Built-in Slave</button></div><div class="de-table"><table><thead><tr><th>Address</th><th>Value</th><th>Reference</th></tr></thead><tbody>'+r.points.map(x=>'<tr><td>'+x.address+'</td><td>'+esc(x.value)+'</td><td>'+esc(x.reference||'')+'</td></tr>').join('')+'</tbody></table></div>';
    if(run.type==='function-probe')html+='<div class="de-table"><table><thead><tr><th>FC</th><th>Supported</th><th>Exception</th><th>RTT</th></tr></thead><tbody>'+r.results.map(x=>'<tr><td>FC'+String(x.functionCode).padStart(2,'0')+'</td><td>'+esc(x.supported)+'</td><td>'+esc(x.exceptionCode??'—')+'</td><td>'+esc(x.rttMs==null?'—':Number(x.rttMs).toFixed(1)+' ms')+'</td></tr>').join('')+'</tbody></table></div>';
    if(run.type==='quantity-probe')html+='<div class="de-summary"><span>Max working</span><strong>'+esc(r.maxWorkingQuantity??'—')+'</strong></div><div class="de-table"><table><thead><tr><th>Quantity</th><th>Result</th><th>RTT</th></tr></thead><tbody>'+r.results.map(x=>'<tr><td>'+x.quantity+'</td><td>'+(x.ok?'OK':'Failed')+'</td><td>'+esc(x.rttMs==null?'—':Number(x.rttMs).toFixed(1)+' ms')+'</td></tr>').join('')+'</tbody></table></div>';
    q('deResult').innerHTML=html;
    q('deAdoptMaster')?.addEventListener('click',adoptMaster);q('deAdoptSlave')?.addEventListener('click',adoptSlave);
  }
  async function run(){q('deRun').disabled=true;q('deNote').textContent='Running '+mode+' scan…';try{const endpoint={unit:'unit-scan',range:'range-scan',function:'function-probe',quantity:'quantity-probe'}[mode];const out=await api('/api/discovery/engineering/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});renderRun(out);q('deNote').textContent='Scan complete.';await loadRuns();}catch(e){q('deNote').textContent=e.message;}finally{q('deRun').disabled=false;}}
  async function loadRuns(){try{runs=await api('/api/discovery/engineering/runs');q('deRuns').innerHTML=runs.length?runs.map(x=>'<button class="de-run" data-run="'+esc(x.runId)+'"><strong>'+esc(x.type)+'</strong><span>'+new Date(x.createdAt).toLocaleTimeString([],{hour12:false})+'</span></button>').join(''):'<div class="empty-state">No runs.</div>';}catch{}}
  async function adoptMaster(){if(!activeRun)return;try{const d=await api('/api/discovery/engineering/'+encodeURIComponent(activeRun.runId)+'/monitor');if(typeof go==='function')go('master');const ids={masterUnitId:d.unitId,masterFunction:d.functionCode,masterAddress:d.address,masterQuantity:d.quantity};for(const [id,v] of Object.entries(ids)){const el=q(id);if(el){el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));}}}catch(e){q('deNote').textContent=e.message;}}
  async function adoptSlave(){if(!activeRun||!confirm('Seed this discovered range into the built-in Slave simulator? The Slave server must be stopped.'))return;try{await api('/api/discovery/engineering/'+encodeURIComponent(activeRun.runId)+'/adopt-simulator',{method:'POST',headers:{'content-type':'application/json'},body:'{"confirmed":true}'});q('deNote').textContent='Range adopted into built-in Slave memory.';}catch(e){q('deNote').textContent=e.message;}}
  q('deRun').addEventListener('click',run);q('deRefreshRuns').addEventListener('click',loadRuns);q('deRuns').addEventListener('click',e=>{const b=e.target.closest('[data-run]');if(b){const r=runs.find(x=>x.runId===b.dataset.run);if(r)renderRun(r);}});
  setMode('unit');loadRuns();
})();