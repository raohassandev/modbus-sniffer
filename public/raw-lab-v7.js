'use strict';
(()=>{
  try{pageMeta.rawLab=['Raw Frame Lab','Compose, checksum, send and validate raw Modbus RTU/ASCII/TCP frames under explicit LAB controls.'];}catch{}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');if(!nav||!main||document.getElementById('page-rawLab'))return;
  const anchor=nav.querySelector('[data-page="transportLab"]');
  const b=document.createElement('button');b.className='nav-item';b.dataset.page='rawLab';b.innerHTML='<span>⌬</span> Raw Frame Lab';anchor?.after(b)||nav.appendChild(b);
  main.insertAdjacentHTML('beforeend',`
  <section class="page" id="page-rawLab"><div class="rawlab-workspace">
    <div class="rawlab-intro"><div><h2>Raw Frame / Conformance Lab</h2><p>Explicit LAB surface for raw Modbus frames. Normal Master polling/writes remain separate.</p></div><span class="rawlab-chip" id="rawLabState">CLOSED</span></div>
    <div class="rawlab-grid">
      <article class="rawlab-card"><div class="rawlab-head"><div><h3>1. Connection</h3><p>Own one RTU, ASCII or TCP endpoint.</p></div></div><div class="rawlab-body rawlab-form">
        <label>Transport<select id="rawLabType"><option value="rtu">RTU</option><option value="ascii">ASCII</option><option value="tcp">TCP</option></select></label>
        <label class="rawlab-serial">Serial port<select id="rawLabPort"><option value="">Select port…</option></select></label>
        <label class="rawlab-serial">Baud<input id="rawLabBaud" type="number" value="9600"></label>
        <label class="rawlab-serial">Parity<select id="rawLabParity"><option>none</option><option>even</option><option>odd</option><option>mark</option><option>space</option></select></label>
        <label class="rawlab-serial">Data bits<input id="rawLabDataBits" type="number" value="8" min="5" max="8"></label>
        <label class="rawlab-serial">Stop bits<select id="rawLabStopBits"><option value="1">1</option><option value="1.5">1.5</option><option value="2">2</option></select></label>
        <label class="rawlab-tcp" hidden>Host<input id="rawLabHost" value="127.0.0.1"></label>
        <label class="rawlab-tcp" hidden>Port<input id="rawLabTcpPort" type="number" value="502"></label>
        <label>Timeout ms<input id="rawLabTimeout" type="number" value="1000"></label>
        <div class="rawlab-wide rawlab-actions"><button class="primary" id="rawLabOpen">Open</button><button class="secondary" id="rawLabClose">Close</button></div>
        <div class="rawlab-wide rawlab-note" id="rawLabConnectionNote">Raw Lab will not silently steal a serial port from Sniffer, Master, Slave or Discovery.</div>
      </div></article>

      <article class="rawlab-card"><div class="rawlab-head"><div><h3>2. LAB Safety</h3><p>Malformed/vendor raw transmissions require timed LAB arming.</p></div></div><div class="rawlab-body rawlab-form">
        <label>Arm duration ms<input id="rawLabArmMs" type="number" value="60000" min="0"></label>
        <label class="rawlab-check"><input id="rawLabRawConfirm" type="checkbox"> I understand this enables manual raw transmission</label>
        <div class="rawlab-wide rawlab-actions"><button class="secondary" id="rawLabArm">Arm LAB</button><button class="secondary" id="rawLabDisarm">Disarm</button></div>
        <div class="rawlab-wide rawlab-note" id="rawLabSafetyNote">Validated read frames can be sent without LAB arming. Raw/malformed frames cannot.</div>
      </div></article>

      <article class="rawlab-card rawlab-wide"><div class="rawlab-head"><div><h3>3. Frame Composer</h3><p>HEX input with optional CRC/LRC, expected-response mask and repeat controls.</p></div><button class="secondary" id="rawLabPreview">Preview</button></div><div class="rawlab-body">
        <div class="rawlab-form">
          <label class="rawlab-wide">HEX frame<textarea id="rawLabHex" rows="4" placeholder="01 03 00 00 00 02"></textarea></label>
          <label class="rawlab-check"><input id="rawLabChecksum" type="checkbox" checked> Auto checksum</label>
          <label class="rawlab-check"><input id="rawLabExpect" type="checkbox" checked> Expect response</label>
          <label class="rawlab-wide">Expected response HEX <small>(optional)</small><input id="rawLabExpected"></label>
          <label class="rawlab-wide">Expected mask HEX <small>(FF = compare, 00 = ignore)</small><input id="rawLabMask"></label>
          <label>Repeat count<input id="rawLabRepeatCount" type="number" value="1" min="1" max="1000"></label>
          <label>Repeat interval ms<input id="rawLabRepeatInterval" type="number" value="0" min="0"></label>
          <label class="rawlab-check"><input id="rawLabWriteConfirm" type="checkbox"> Confirm validated write frame</label>
          <div class="rawlab-wide rawlab-actions"><button class="primary" id="rawLabSend">Send Once</button><button class="secondary" id="rawLabRepeat">Repeat</button></div>
        </div>
        <div id="rawLabPreviewResult" class="rawlab-result">No frame preview yet.</div>
      </div></article>

      <article class="rawlab-card rawlab-wide"><div class="rawlab-head"><div><h3>4. Reusable Cases</h3><p>Save/import/export raw regression strings with expectations.</p></div><div class="rawlab-actions"><button class="secondary" id="rawLabRefreshCases">Refresh</button><a class="button secondary" href="/api/raw-lab/cases/export.json">Export Cases</a></div></div><div class="rawlab-body rawlab-form">
        <label>Case name<input id="rawLabCaseName" placeholder="FC03 basic read"></label><button class="secondary" id="rawLabSaveCase">Save Current</button>
        <label class="rawlab-wide">Import case bundle<input id="rawLabCaseImportFile" type="file" accept=".json,application/json"></label><button class="secondary" id="rawLabImportCases">Import / Merge</button>
        <div class="rawlab-wide rawlab-table-wrap"><table><thead><tr><th>Name</th><th>Framing</th><th>HEX</th><th>Actions</th></tr></thead><tbody id="rawLabCasesBody"><tr><td colspan="4" class="muted">No cases.</td></tr></tbody></table></div>
      </div></article>

      <article class="rawlab-card rawlab-wide"><div class="rawlab-head"><div><h3>5. Conformance Presets</h3><p>Boundary and exception-response checks generated for the active RTU/ASCII/TCP framing.</p></div><div class="rawlab-actions"><button class="secondary" id="rawLabLoadPresets">Refresh Presets</button><button class="primary" id="rawLabRunSuite">Run Selected Suite</button></div></div><div class="rawlab-body">
        <div class="rawlab-form"><label>Target Unit ID<input id="rawLabPresetUnit" type="number" min="1" max="255" value="1"></label><div class="rawlab-wide rawlab-note">Safe boundary reads run normally. Illegal-function/address/value cases require LAB armed + raw confirmation. Skipped LAB cases remain visible in the evidence result.</div></div>
        <div class="rawlab-table-wrap"><table><thead><tr><th>Run</th><th>Preset</th><th>Category</th><th>LAB</th><th>Description</th><th>Action</th></tr></thead><tbody id="rawLabPresetBody"><tr><td colspan="6" class="muted">Open a connection to generate framing-specific presets.</td></tr></tbody></table></div>
        <div id="rawLabSuiteResult" class="rawlab-result">No conformance run yet.</div>
        <div class="rawlab-run-list" id="rawLabRuns"></div>
      </div></article>

      <article class="rawlab-card rawlab-wide"><div class="rawlab-head"><div><h3>6. Audit</h3><p>Every Raw Lab transmission remains visible and auditable.</p></div><button class="secondary" id="rawLabRefreshAudit">Refresh</button></div><div class="rawlab-body rawlab-table-wrap"><table><thead><tr><th>Time</th><th>Intent</th><th>Result</th><th>Request</th><th>Response</th><th>Error</th></tr></thead><tbody id="rawLabAuditBody"><tr><td colspan="6" class="muted">No transmissions yet.</td></tr></tbody></table></div></article>
    </div>
  </div></section>`);
  const q=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let cases=[],presets=[],runs=[];
  async function api(url,opt={}){const r=await fetch(url,opt),body=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(body.error||`HTTP ${r.status}`);e.code=body.code;e.details=body.details;throw e;}return body;}
  async function ports(){try{const rows=await api('/api/ports');q('rawLabPort').innerHTML='<option value="">Select port…</option>'+rows.map(x=>'<option value="'+esc(x.path)+'">'+esc(x.path)+(x.manufacturer?' — '+esc(x.manufacturer):'')+'</option>').join('');}catch{}}
  function syncType(){const serial=q('rawLabType').value!=='tcp';document.querySelectorAll('.rawlab-serial').forEach(x=>x.hidden=!serial);document.querySelectorAll('.rawlab-tcp').forEach(x=>x.hidden=serial);}
  function connPayload(){const type=q('rawLabType').value;const p={type,timeoutMs:Number(q('rawLabTimeout').value)};if(type==='tcp'){p.host=q('rawLabHost').value.trim();p.port=Number(q('rawLabTcpPort').value);}else{p.path=q('rawLabPort').value;p.baudRate=Number(q('rawLabBaud').value);p.parity=q('rawLabParity').value;p.dataBits=Number(q('rawLabDataBits').value);p.stopBits=Number(q('rawLabStopBits').value);}return p;}
  function framePayload(){return {hex:q('rawLabHex').value,autoChecksum:q('rawLabChecksum').checked,expectResponse:q('rawLabExpect').checked,timeoutMs:Number(q('rawLabTimeout').value),expectedHex:q('rawLabExpected').value.trim()||null,expectedMaskHex:q('rawLabMask').value.trim()||null,confirmation:{raw:q('rawLabRawConfirm').checked,write:q('rawLabWriteConfirm').checked}};}
  function renderStatus(s){const chip=q('rawLabState');chip.textContent=s?.studio?.connectionState==='open'?(s.studio.labArmed?'OPEN · LAB ARMED':'OPEN'):'CLOSED';chip.classList.toggle('armed',Boolean(s?.studio?.labArmed));}
  async function refreshStatus(){try{renderStatus(await api('/api/raw-lab/status'));}catch{}}
  async function open(){try{const p={...connPayload()};let r=await api('/api/raw-lab/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});renderStatus(r);q('rawLabConnectionNote').textContent='Raw Lab connection opened.';}catch(e){if(['PASSIVE_CAPTURE_ACTIVE','MASTER_ACTIVE','SLAVE_ACTIVE'].includes(e.code)&&e.details?.requiresConfirmation){if(confirm(e.message)){const key=e.code==='PASSIVE_CAPTURE_ACTIVE'?'confirmPassiveDisconnect':e.code==='MASTER_ACTIVE'?'confirmMasterDisconnect':'confirmSlaveStop';const p={...connPayload(),[key]:true};const r=await api('/api/raw-lab/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});renderStatus(r);return;}}q('rawLabConnectionNote').textContent=e.message;}}
  async function preview(){try{const r=await api('/api/raw-lab/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(framePayload())});q('rawLabPreviewResult').innerHTML='<strong>'+esc(r.classification.category.toUpperCase())+'</strong> · valid '+esc(r.classification.valid)+' · FC '+esc(r.classification.functionCode??'—')+' · Unit '+esc(r.classification.unitId??'—')+'<br><code>'+esc(r.rawHex)+'</code>';}catch(e){q('rawLabPreviewResult').textContent=e.message;}}
  async function send(repeat=false){try{const p=framePayload();if(repeat){p.count=Number(q('rawLabRepeatCount').value);p.intervalMs=Number(q('rawLabRepeatInterval').value);}const r=await api(repeat?'/api/raw-lab/repeat':'/api/raw-lab/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});const last=Array.isArray(r)?r.at(-1):r;q('rawLabPreviewResult').innerHTML='<strong>PASS</strong> · intent '+esc(last.intent)+' · RTT '+esc(last.rttMs==null?'—':Number(last.rttMs).toFixed(2)+' ms')+'<br><code>TX '+esc(last.requestRawHex||'')+'</code><br><code>RX '+esc(last.responseRawHex||'—')+'</code>';await audit();}catch(e){q('rawLabPreviewResult').innerHTML='<strong>FAILED</strong> · '+esc(e.message);}}
  async function loadCases(){try{cases=await api('/api/raw-lab/cases');q('rawLabCasesBody').innerHTML=cases.length?cases.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.framing)+'</td><td class="mono">'+esc(x.hex)+'</td><td><button class="ghost" data-case-load="'+esc(x.id)+'">Load</button> <button class="ghost" data-case-remove="'+esc(x.id)+'">Remove</button></td></tr>').join(''):'<tr><td colspan="4" class="muted">No cases.</td></tr>';}catch{}}
  async function saveCase(){const p=framePayload();p.name=q('rawLabCaseName').value.trim()||'Raw case';p.framing=q('rawLabType').value;await api('/api/raw-lab/cases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});await loadCases();}
  async function importCases(){
    const file=q('rawLabCaseImportFile').files?.[0];if(!file)return;
    try{const bundle=JSON.parse(await file.text());await api('/api/raw-lab/cases/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bundle,replace:false})});await loadCases();q('rawLabPreviewResult').textContent='Case bundle imported.';}catch(e){q('rawLabPreviewResult').textContent='Case import failed: '+e.message;}
  }
  async function loadPresets(){
    try{
      presets=await api('/api/raw-lab/presets?unitId='+encodeURIComponent(q('rawLabPresetUnit').value||1)+'&timeoutMs='+encodeURIComponent(q('rawLabTimeout').value||1000));
      q('rawLabPresetBody').innerHTML=presets.map(x=>'<tr><td><input type="checkbox" class="rawlab-preset-select" data-preset-id="'+esc(x.id)+'" checked></td><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.category)+'</td><td>'+(x.labRequired?'Required':'No')+'</td><td>'+esc(x.description)+'</td><td><button class="ghost" data-preset-load="'+esc(x.id)+'">Load</button></td></tr>').join('')||'<tr><td colspan="6" class="muted">No presets.</td></tr>';
    }catch(e){q('rawLabPresetBody').innerHTML='<tr><td colspan="6" class="muted">'+esc(e.message)+'</td></tr>';}
  }
  function loadPreset(id){
    const x=presets.find(p=>p.id===id);if(!x)return;q('rawLabHex').value=x.hex;q('rawLabChecksum').checked=false;q('rawLabExpect').checked=x.expectResponse!==false;q('rawLabExpected').value=x.expectedHex||'';q('rawLabMask').value=x.expectedMaskHex||'';q('rawLabPreviewResult').textContent='Loaded preset: '+x.name+(x.labRequired?' · LAB required':'');
  }
  async function loadRuns(){
    try{runs=await api('/api/raw-lab/runs');q('rawLabRuns').innerHTML=runs.slice(0,10).map(r=>'<div class="rawlab-run-row"><div><strong>'+esc(r.runId)+'</strong><small>'+new Date(r.completedAt).toLocaleString()+' · '+r.summary.passed+' passed · '+r.summary.failed+' failed · '+r.summary.skipped+' skipped</small></div><a class="button ghost" href="/api/raw-lab/runs/'+encodeURIComponent(r.runId)+'/export.json">Evidence JSON</a></div>').join('');}catch{}
  }
  async function runSuite(){
    const ids=[...document.querySelectorAll('.rawlab-preset-select:checked')].map(x=>x.dataset.presetId);if(!ids.length)return;
    q('rawLabRunSuite').disabled=true;q('rawLabSuiteResult').textContent='Running selected conformance cases…';
    try{
      const run=await api('/api/raw-lab/suite/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({presetIds:ids,unitId:Number(q('rawLabPresetUnit').value||1),timeoutMs:Number(q('rawLabTimeout').value||1000),interCaseMs:50,confirmation:{raw:q('rawLabRawConfirm').checked}})});
      q('rawLabSuiteResult').innerHTML='<strong>Run complete.</strong> '+run.summary.passed+' passed · '+run.summary.failed+' failed · '+run.summary.skipped+' skipped · <a href="/api/raw-lab/runs/'+encodeURIComponent(run.runId)+'/export.json">Export exact evidence</a>';
      await Promise.all([audit(),loadRuns()]);
    }catch(e){q('rawLabSuiteResult').innerHTML='<strong>Suite failed.</strong> '+esc(e.message);}
    finally{q('rawLabRunSuite').disabled=false;}
  }

  async function audit(){try{const rows=await api('/api/raw-lab/audit?limit=200');q('rawLabAuditBody').innerHTML=rows.length?[...rows].reverse().map(x=>'<tr><td>'+new Date(x.transmittedAt).toLocaleTimeString([],{hour12:false})+'</td><td>'+esc(x.intent)+'</td><td>'+esc(x.result)+'</td><td class="mono">'+esc(x.requestRawHex)+'</td><td class="mono">'+esc(x.responseRawHex||'—')+'</td><td>'+esc(x.error?.message||'—')+'</td></tr>').join(''):'<tr><td colspan="6" class="muted">No transmissions yet.</td></tr>';}catch{}}
  q('rawLabType').addEventListener('change',syncType);q('rawLabOpen').addEventListener('click',open);q('rawLabClose').addEventListener('click',async()=>renderStatus(await api('/api/raw-lab/close',{method:'POST'})));
  q('rawLabArm').addEventListener('click',async()=>{try{renderStatus(await api('/api/raw-lab/arm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmation:{confirmed:true,raw:q('rawLabRawConfirm').checked},durationMs:Number(q('rawLabArmMs').value)})}));}catch(e){q('rawLabSafetyNote').textContent=e.message;}});
  q('rawLabDisarm').addEventListener('click',async()=>renderStatus(await api('/api/raw-lab/disarm',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})));
  q('rawLabPreview').addEventListener('click',preview);q('rawLabSend').addEventListener('click',()=>send(false));q('rawLabRepeat').addEventListener('click',()=>send(true));q('rawLabSaveCase').addEventListener('click',saveCase);q('rawLabRefreshCases').addEventListener('click',loadCases);q('rawLabImportCases').addEventListener('click',importCases);q('rawLabLoadPresets').addEventListener('click',loadPresets);q('rawLabRunSuite').addEventListener('click',runSuite);q('rawLabRefreshAudit').addEventListener('click',audit);
  q('rawLabPresetBody').addEventListener('click',e=>{const b=e.target.closest('[data-preset-load]');if(b)loadPreset(b.dataset.presetLoad);});
  q('rawLabCasesBody').addEventListener('click',async e=>{const load=e.target.closest('[data-case-load]');if(load){const x=cases.find(c=>c.id===load.dataset.caseLoad);if(x){q('rawLabHex').value=x.hex;q('rawLabChecksum').checked=x.autoChecksum!==false;q('rawLabExpect').checked=x.expectResponse!==false;q('rawLabExpected').value=x.expectedHex||'';q('rawLabMask').value=x.expectedMaskHex||'';}return;}const rem=e.target.closest('[data-case-remove]');if(rem){await api('/api/raw-lab/cases/'+encodeURIComponent(rem.dataset.caseRemove),{method:'DELETE'});loadCases();}});
  ports();syncType();refreshStatus();loadCases();loadRuns();audit();
})();