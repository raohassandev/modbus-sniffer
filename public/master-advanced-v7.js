'use strict';

(()=>{
  const root=document.getElementById('page-master');
  if(!root||document.getElementById('masterAdvancedPanel'))return;
  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const strip=root.querySelector('.master-write-strip');
  if(!strip)return;
  strip.insertAdjacentHTML('beforebegin',`
    <article class="master-card master-live" id="masterAdvancedPanel">
      <div class="master-card-head master-live-head">
        <div><h3><span class="master-section-number">5</span>Advanced Modbus</h3><p>Diagnostics, identity, file records and FIFO tests using the same active Master connection.</p></div>
        <span class="master-advanced-chip">PROTOCOL TEST</span>
      </div>
      <div class="master-card-body">
        <div class="master-advanced-grid">
          <label>Unit / Slave ID<input id="masterAdvancedUnit" type="number" min="1" max="255" value="1"></label>
          <label>Function<select id="masterAdvancedFc">
            <option value="43" selected>FC43/14 — Read Device Identification</option>
            <option value="7">FC07 — Read Exception Status (serial)</option>
            <option value="8">FC08 — Diagnostics (serial)</option>
            <option value="11">FC11 — Get Comm Event Counter (serial)</option>
            <option value="12">FC12 — Get Comm Event Log (serial)</option>
            <option value="17">FC17 — Report Server ID (serial)</option>
            <option value="20">FC20 — Read File Record</option>
            <option value="24">FC24 — Read FIFO Queue</option>
          </select></label>
          <label>Timeout (ms)<input id="masterAdvancedTimeout" type="number" min="50" max="60000" value="1000"></label>

          <label class="adv-fc43">Device ID level<select id="masterAdvancedDeviceCode"><option value="1">Basic (1)</option><option value="2">Regular (2)</option><option value="3">Extended (3)</option><option value="4">Specific object (4)</option></select></label>
          <label class="adv-fc43">Object ID<input id="masterAdvancedObjectId" type="number" min="0" max="255" value="0"></label>

          <label class="adv-fc08" hidden>Diagnostic Subfunction<input id="masterAdvancedSubFunction" type="number" min="0" max="65535" value="0"></label>
          <label class="adv-fc08" hidden>Diagnostic Data<input id="masterAdvancedData" type="number" min="0" max="65535" value="0"></label>
          <label class="adv-fc08 master-advanced-confirm" hidden><input id="masterAdvancedLabConfirm" type="checkbox"> LAB confirm non-zero diagnostic subfunction</label>

          <label class="adv-fc20 master-advanced-wide" hidden>FC20 records JSON
            <textarea id="masterAdvancedFileRecords" rows="4">[
  {"fileNumber":0,"recordNumber":0,"recordLength":2}
]</textarea>
          </label>

          <label class="adv-fc24" hidden>FIFO Pointer Address<input id="masterAdvancedFifoAddress" type="number" min="0" max="65535" value="0"></label>
        </div>
        <div class="master-button-row">
          <button class="master-primary" id="masterAdvancedSend" disabled>Send Advanced Request</button>
          <button class="master-secondary" id="masterAdvancedUseCurrent">Use Current Unit</button>
        </div>
        <div class="master-advanced-result" id="masterAdvancedResult">
          <div class="master-empty">Connect Master, choose an advanced function and send the request.</div>
        </div>
      </div>
    </article>`);

  const fc=q('masterAdvancedFc');

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(body.error||`HTTP ${response.status}`);e.code=body.code;e.details=body.details;throw e;}
    return body;
  }

  function connected(){
    return q('masterConnectionChip')?.classList.contains('connected')||q('masterConnectionChip')?.textContent?.includes('Connected');
  }

  function showFields(){
    const code=Number(fc.value);
    root.querySelectorAll('.adv-fc43').forEach(el=>el.hidden=code!==43);
    root.querySelectorAll('.adv-fc08').forEach(el=>el.hidden=code!==8);
    root.querySelectorAll('.adv-fc20').forEach(el=>el.hidden=code!==20);
    root.querySelectorAll('.adv-fc24').forEach(el=>el.hidden=code!==24);
  }

  function payload(){
    const code=Number(fc.value);
    const out={
      unitId:Number(q('masterAdvancedUnit').value||1),
      functionCode:code,
      timeoutMs:Number(q('masterAdvancedTimeout').value||1000),
    };
    if(code===43){
      out.readDeviceIdCode=Number(q('masterAdvancedDeviceCode').value||1);
      out.objectId=Number(q('masterAdvancedObjectId').value||0);
    }else if(code===8){
      out.subFunction=Number(q('masterAdvancedSubFunction').value||0);
      out.data=Number(q('masterAdvancedData').value||0);
      out.labConfirmed=q('masterAdvancedLabConfirm').checked;
    }else if(code===20){
      let records;
      try{records=JSON.parse(q('masterAdvancedFileRecords').value);}catch{throw new Error('FC20 records must be valid JSON.');}
      if(!Array.isArray(records)||!records.length)throw new Error('FC20 records JSON must be a non-empty array.');
      out.records=records;
    }else if(code===24){
      out.address=Number(q('masterAdvancedFifoAddress').value||0);
    }
    return out;
  }

  function pretty(value){
    return JSON.stringify(value,(key,val)=>{
      if(val&&val.type==='Buffer'&&Array.isArray(val.data))return '0x'+val.data.map(x=>Number(x).toString(16).padStart(2,'0')).join('').toUpperCase();
      return val;
    },2);
  }

  async function send(){
    const host=q('masterAdvancedResult');
    try{
      const req=payload();
      q('masterAdvancedSend').disabled=true;
      host.innerHTML='<div class="master-advanced-wait">Sending FC'+String(req.functionCode).padStart(2,'0')+'…</div>';
      const result=await api('/api/master/advanced',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});
      host.innerHTML=`
        <div class="master-advanced-evidence">
          <div><span>RTT</span><strong>${result.rttMs==null?'—':esc(result.rttMs+' ms')}</strong></div>
          <div><span>Request</span><code>${esc(result.requestRawHex||'—')}</code></div>
          <div><span>Response</span><code>${esc(result.responseRawHex||'—')}</code></div>
        </div>
        <pre>${esc(pretty(result.decoded))}</pre>`;
    }catch(error){
      host.innerHTML='<div class="master-advanced-error"><strong>Request failed.</strong> '+esc(error.message)+'</div>';
    }finally{
      q('masterAdvancedSend').disabled=!connected();
    }
  }

  function sync(){
    q('masterAdvancedSend').disabled=!connected();
  }

  fc.addEventListener('change',showFields);
  q('masterAdvancedSend').addEventListener('click',send);
  q('masterAdvancedUseCurrent').addEventListener('click',()=>{q('masterAdvancedUnit').value=q('masterUnitId')?.value||1;});
  const chip=q('masterConnectionChip');
  if(chip)new MutationObserver(sync).observe(chip,{attributes:true,childList:true,subtree:true});
  showFields();sync();
})();