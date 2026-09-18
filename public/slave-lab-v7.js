'use strict';
(()=>{
  const page=document.getElementById('page-slave');if(!page||document.getElementById('slaveLabPanel'))return;
  const grid=page.querySelector('.slave-grid');if(!grid)return;const q=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  grid.insertAdjacentHTML('beforeend',`
    <article class="slave-card slave-wide" id="slaveLabPanel">
      <div class="slave-card-head"><div><h3>Advanced LAB Behavior</h3><p>Disabled by default. Inject deterministic delay/exceptions or generate simulator values for protocol testing.</p></div><span class="slave-lab-chip" id="slaveLabChip">DISARMED</span></div>
      <div class="slave-card-body slave-lab-grid">
        <div class="slave-lab-box">
          <h4>Fault / Exception Policy</h4>
          <div class="slave-lab-form">
            <label>Response delay ms<input id="slaveLabDelay" type="number" min="0" max="60000" value="0"></label>
            <label>Jitter ms<input id="slaveLabJitter" type="number" min="0" max="60000" value="0"></label>
            <label>Force exception code<input id="slaveLabException" type="number" min="0" max="255" value="0"></label>
            <label>Exception every N<input id="slaveLabExceptionEvery" type="number" min="0" value="0"></label>
            <label>Drop every N<input id="slaveLabDropEvery" type="number" min="0" value="0"></label>
            <label>Duplicate every N<input id="slaveLabDuplicateEvery" type="number" min="0" value="0"></label>
            <label>Wrong Unit ID<input id="slaveLabWrongUnit" type="number" min="0" max="255" placeholder="off"></label>
            <label>Wrong FC<input id="slaveLabWrongFc" type="number" min="1" max="255" placeholder="off"></label>
            <label>Corrupt checksum every N<input id="slaveLabCorruptEvery" type="number" min="0" value="0"></label>
            <label>Truncate response bytes<input id="slaveLabTruncate" type="number" min="0" max="250" value="0"></label>
            <label class="slave-lab-check"><input id="slaveLabConfirm" type="checkbox"> I confirm LAB fault injection</label>
            <div class="slave-lab-actions"><button class="secondary" id="slaveLabArm">Arm LAB</button><button class="secondary" id="slaveLabDisarm">Disarm</button></div>
          </div>
        </div>
        <div class="slave-lab-box">
          <h4>Dynamic Value Generator</h4>
          <div class="slave-lab-form">
            <label>Generator ID<input id="slaveGenId" value="gen-1"></label>
            <label>Unit ID<input id="slaveGenUnit" type="number" min="1" max="255" value="1"></label>
            <label>Area<select id="slaveGenArea"><option>holdingRegisters</option><option>inputRegisters</option><option>coils</option><option>discreteInputs</option></select></label>
            <label>Address<input id="slaveGenAddress" type="number" min="0" max="65535" value="0"></label>
            <label>Quantity<input id="slaveGenQuantity" type="number" min="1" max="125" value="1"></label>
            <label>Kind<select id="slaveGenKind"><option>constant</option><option>counter</option><option>sawtooth</option><option>sine</option><option>random</option><option>timestamp</option><option>formula</option><option>schedule</option></select></label>
            <label>Interval ms<input id="slaveGenInterval" type="number" min="20" value="250"></label>
            <label class="slave-lab-wide">Params JSON<textarea id="slaveGenParams" rows="4">{"start":0,"step":1,"min":0,"max":100}</textarea></label>
            <button class="primary slave-lab-wide" id="slaveGenSave">Save Generator</button>
          </div>
          <div class="slave-gen-list" id="slaveGenList"><div class="muted">No generators.</div></div>
        </div>
      </div>
    </article>`);
  async function api(url,opt={}){const r=await fetch(url,opt),body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);return body;}
  function policy(){const nullable=id=>q(id).value===''?null:Number(q(id).value);return{responseDelayMs:Number(q('slaveLabDelay').value||0),jitterMs:Number(q('slaveLabJitter').value||0),forceExceptionCode:Number(q('slaveLabException').value||0),forceExceptionEveryN:Number(q('slaveLabExceptionEvery').value||0),dropEveryN:Number(q('slaveLabDropEvery').value||0),duplicateEveryN:Number(q('slaveLabDuplicateEvery').value||0),wrongUnitId:nullable('slaveLabWrongUnit'),wrongFunctionCode:nullable('slaveLabWrongFc'),corruptChecksumEveryN:Number(q('slaveLabCorruptEvery').value||0),truncateBytes:Number(q('slaveLabTruncate').value||0)};}
  function renderLab(s){q('slaveLabChip').textContent=s?.enabled?'ARMED':'DISARMED';q('slaveLabChip').classList.toggle('armed',Boolean(s?.enabled));}
  async function refresh(){try{const [lab,gens]=await Promise.all([api('/api/slave/lab/status'),api('/api/slave/generators')]);renderLab(lab);q('slaveGenList').innerHTML=gens.length?gens.map(g=>'<div class="slave-gen-row"><div><strong>'+esc(g.generatorId)+'</strong><small>Unit '+g.unitId+' · '+esc(g.area)+' '+g.address+' · '+esc(g.kind)+' · '+g.intervalMs+' ms</small></div><button class="ghost" data-gen-remove="'+esc(g.generatorId)+'">Remove</button></div>').join(''):'<div class="muted">No generators.</div>';}catch{}}
  q('slaveLabArm').addEventListener('click',async()=>{try{renderLab(await api('/api/slave/lab/arm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:q('slaveLabConfirm').checked,policy:policy()})}));}catch(e){alert(e.message);}});
  q('slaveLabDisarm').addEventListener('click',async()=>{try{renderLab(await api('/api/slave/lab/disarm',{method:'POST'}));}catch(e){alert(e.message);}});
  q('slaveGenSave').addEventListener('click',async()=>{try{const params=JSON.parse(q('slaveGenParams').value||'{}');await api('/api/slave/generators',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({generatorId:q('slaveGenId').value.trim(),unitId:Number(q('slaveGenUnit').value),area:q('slaveGenArea').value,address:Number(q('slaveGenAddress').value),quantity:Number(q('slaveGenQuantity').value),kind:q('slaveGenKind').value,intervalMs:Number(q('slaveGenInterval').value),params,enabled:true})});refresh();}catch(e){alert(e.message);}});
  q('slaveGenList').addEventListener('click',async e=>{const b=e.target.closest('[data-gen-remove]');if(!b)return;await api('/api/slave/generators/'+encodeURIComponent(b.dataset.genRemove),{method:'DELETE'});refresh();});
  refresh();
})();