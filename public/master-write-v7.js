'use strict';

(()=>{
  const root=document.getElementById('page-master');
  if(!root||document.getElementById('masterWriteDialog'))return;
  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const strip=root.querySelector('.master-write-strip');
  if(!strip)return;

  strip.innerHTML=`
    <div><strong>🔒 WRITES LOCKED</strong><div class="master-mode-hint">One-shot guarded writes. Every operation requires confirmation and the runtime relocks immediately.</div></div>
    <div class="master-write-actions">
      <button class="master-secondary" id="masterOpenTraffic">Open Traffic</button>
      <button class="master-secondary" id="masterResetCounters">Reset Counters</button>
      <button class="master-primary master-write-button" id="masterOpenWrite" disabled>Guarded Write…</button>
    </div>`;

  root.insertAdjacentHTML('beforeend',`
    <dialog id="masterWriteDialog" class="master-write-dialog">
      <form id="masterWriteForm" method="dialog">
        <div class="master-write-head">
          <div><h3>Guarded Modbus Write</h3><p>FC05 / FC06 / FC15 / FC16 / FC21 / FC22 / FC23 with explicit confirmation, automatic re-lock and write audit.</p></div>
          <button type="button" class="master-secondary" id="masterWriteClose">×</button>
        </div>

        <div class="master-write-grid">
          <label>Unit / Slave ID<input id="masterWriteUnit" type="number" min="0" max="255" value="1"></label>
          <label>Function<select id="masterWriteFc">
            <option value="6" selected>FC06 — Write Single Register</option>
            <option value="5">FC05 — Write Single Coil</option>
            <option value="16">FC16 — Write Multiple Registers</option>
            <option value="15">FC15 — Write Multiple Coils</option>
            <option value="21">FC21 — Write File Record</option>\n            <option value="22">FC22 — Mask Write Register</option>
            <option value="23">FC23 — Read/Write Multiple Registers</option>
          </select></label>
          <label id="masterWriteAddressLabel">Address<input id="masterWriteAddress" type="number" min="0" max="65535" value="0"></label>
          <label id="masterWriteValueLabel">Value<input id="masterWriteValue" placeholder="0..65535"></label>

          <label id="masterWriteValuesLabel" hidden>Values (comma/space separated)<textarea id="masterWriteValues" rows="3" placeholder="100, 200, 300"></textarea></label>
          <label id="masterWriteFileRecordsLabel" class="master-write-wide" hidden>FC21 records JSON<textarea id="masterWriteFileRecords" rows="4">[\n  {"fileNumber":0,"recordNumber":0,"values":[1,2]}\n]</textarea></label>\n          <label id="masterWriteAndMaskLabel" hidden>AND Mask<input id="masterWriteAndMask" value="65535"></label>
          <label id="masterWriteOrMaskLabel" hidden>OR Mask<input id="masterWriteOrMask" value="0"></label>
          <label id="masterWriteReadAddressLabel" hidden>FC23 Read Address<input id="masterWriteReadAddress" type="number" min="0" max="65535" value="0"></label>
          <label id="masterWriteReadQtyLabel" hidden>FC23 Read Quantity<input id="masterWriteReadQty" type="number" min="1" max="125" value="1"></label>

          <label class="master-write-wide">Operator comment<input id="masterWriteComment" maxlength="500" placeholder="Reason / test note / work reference"></label>
        </div>

        <div class="master-write-options">
          <label><input id="masterWriteReadback" type="checkbox" checked> Read-back verify after write</label>
          <label id="masterWriteBulkConfirmWrap" hidden><input id="masterWriteBulkConfirm" type="checkbox"> I confirm this is a bulk write</label>
          <label id="masterWriteBroadcastConfirmWrap" hidden><input id="masterWriteBroadcastConfirm" type="checkbox"> I confirm Unit 0 broadcast write (no response)</label>
          <label class="master-write-final-confirm"><input id="masterWriteConfirm" type="checkbox"> I confirm these values will be transmitted to the connected Modbus device</label>
        </div>

        <div class="master-write-preview" id="masterWritePreview">Review the target and values before sending.</div>
        <div class="master-write-result" id="masterWriteResult" hidden></div>

        <div class="master-write-footer">
          <span>Write state returns to <strong>LOCKED</strong> immediately after this operation.</span>
          <div><button type="button" class="master-secondary" id="masterWriteCancel">Cancel</button><button type="submit" class="master-primary master-write-danger" id="masterWriteSend">Confirm & Send</button></div>
        </div>

        <div class="master-write-audit">
          <div class="master-write-audit-head"><strong>Recent Write Audit</strong><button type="button" class="master-secondary" id="masterWriteAuditRefresh">Refresh</button></div>
          <div class="master-table-wrap"><table class="master-table"><thead><tr><th>Time</th><th>Unit</th><th>FC</th><th>Address</th><th>Old</th><th>Requested</th><th>Verify</th><th>Result</th></tr></thead><tbody id="masterWriteAuditBody"><tr><td colspan="8">No write evidence yet.</td></tr></tbody></table></div>
        </div>
      </form>
    </dialog>`);

  const dialog=q('masterWriteDialog');
  const fc=q('masterWriteFc');
  const unit=q('masterWriteUnit');

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(body.error||`HTTP ${response.status}`);e.code=body.code;e.details=body.details;throw e;}
    return body;
  }

  function connected(){
    return q('masterConnectionChip')?.classList.contains('connected')||q('masterConnectionChip')?.textContent?.includes('Connected');
  }

  function selectedAddress(){
    const row=q('masterDataBody')?.querySelector('tr.master-map-selected');
    if(row?.dataset.masterAddress!=null)return Number(row.dataset.masterAddress);
    return Number(q('masterAddress')?.value||0);
  }

  function parseValues(text,{coil=false}={}){
    const parts=String(text||'').split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
    if(!parts.length)throw new Error('Enter at least one value.');
    if(coil)return parts.map(v=>{
      if(['1','true','on'].includes(v.toLowerCase()))return true;
      if(['0','false','off'].includes(v.toLowerCase()))return false;
      throw new Error(`Invalid coil value "${v}". Use 0/1, true/false or on/off.`);
    });
    return parts.map(v=>{const n=Number(v);if(!Number.isInteger(n)||n<0||n>65535)throw new Error(`Register value "${v}" must be 0..65535.`);return n;});
  }

  function showFields(){
    const code=Number(fc.value),bulk=[15,16,21,23].includes(code),broadcast=Number(unit.value)===0;
    q('masterWriteValuesLabel').hidden=![15,16,23].includes(code);
    q('masterWriteFileRecordsLabel').hidden=code!==21;
    q('masterWriteValueLabel').hidden=![5,6].includes(code);
    q('masterWriteAndMaskLabel').hidden=code!==22;
    q('masterWriteOrMaskLabel').hidden=code!==22;
    q('masterWriteReadAddressLabel').hidden=code!==23;
    q('masterWriteReadQtyLabel').hidden=code!==23;
    q('masterWriteBulkConfirmWrap').hidden=!bulk;
    q('masterWriteBroadcastConfirmWrap').hidden=!broadcast;
    q('masterWriteReadback').disabled=broadcast;
    if(broadcast)q('masterWriteReadback').checked=false;
    q('masterWriteAddressLabel').querySelector('span')?.remove();
    updatePreview();
  }

  function summaryPayload(){
    const code=Number(fc.value),unitId=Number(unit.value),address=Number(q('masterWriteAddress').value);
    const payload={unitId,functionCode:code,address,comment:q('masterWriteComment').value,readBack:q('masterWriteReadback').checked,autoLockMs:10000};
    if(code===5)payload.value=['1','true','on'].includes(String(q('masterWriteValue').value).trim().toLowerCase());
    if(code===6){const n=Number(q('masterWriteValue').value);if(!Number.isInteger(n)||n<0||n>65535)throw new Error('FC06 value must be 0..65535.');payload.value=n;}
    if(code===15)payload.values=parseValues(q('masterWriteValues').value,{coil:true});
    if(code===16)payload.values=parseValues(q('masterWriteValues').value);
    if(code===21){
      let records;
      try{records=JSON.parse(q('masterWriteFileRecords').value);}catch{throw new Error('FC21 records must be valid JSON.');}
      if(!Array.isArray(records)||!records.length)throw new Error('FC21 records JSON must be a non-empty array.');
      payload.records=records;
    }
    if(code===22){
      const andMask=Number(q('masterWriteAndMask').value),orMask=Number(q('masterWriteOrMask').value);
      if(!Number.isInteger(andMask)||andMask<0||andMask>65535)throw new Error('AND mask must be 0..65535.');
      if(!Number.isInteger(orMask)||orMask<0||orMask>65535)throw new Error('OR mask must be 0..65535.');
      payload.andMask=andMask;payload.orMask=orMask;
    }
    if(code===23){
      payload.readAddress=Number(q('masterWriteReadAddress').value);
      payload.readQuantity=Number(q('masterWriteReadQty').value);
      payload.writeAddress=address;
      payload.values=parseValues(q('masterWriteValues').value);
    }
    payload.confirmation={
      confirmed:q('masterWriteConfirm').checked,
      bulk:[15,16,21,23].includes(code)?q('masterWriteBulkConfirm').checked:false,
      broadcast:unitId===0?q('masterWriteBroadcastConfirm').checked:false
    };
    return payload;
  }

  function updatePreview(){
    try{
      const code=Number(fc.value),unitId=Number(unit.value),address=Number(q('masterWriteAddress').value);
      const connectionType=q('masterConnectionType')?.querySelector('button.active')?.textContent?.trim()||'Connection';
      let values='—';
      if([5,6].includes(code))values=q('masterWriteValue').value||'—';
      else if([15,16,23].includes(code))values=q('masterWriteValues').value||'—';
      else if(code===21)values=q('masterWriteFileRecords').value||'—';
      else if(code===22)values=`AND ${q('masterWriteAndMask').value} / OR ${q('masterWriteOrMask').value}`;
      q('masterWritePreview').innerHTML=`<strong>Target:</strong> ${esc(connectionType)} · Unit ${unitId} · FC${String(code).padStart(2,'0')} · Address ${address}<br><strong>Requested:</strong> ${esc(values)}`;
    }catch{/* preview is advisory */}
  }

  async function openDialog(){
    if(!connected())return;
    q('masterWriteUnit').value=q('masterUnitId')?.value||1;
    q('masterWriteAddress').value=selectedAddress();
    q('masterWriteReadAddress').value=selectedAddress();
    q('masterWriteValue').value='';
    q('masterWriteValues').value='';
    q('masterWriteConfirm').checked=false;
    q('masterWriteBulkConfirm').checked=false;
    q('masterWriteBroadcastConfirm').checked=false;
    q('masterWriteResult').hidden=true;
    showFields();dialog.showModal();await loadAudit();
  }

  async function sendWrite(event){
    event.preventDefault();
    try{
      const payload=summaryPayload();
      if(!payload.confirmation.confirmed)throw new Error('Confirm the final transmission checkbox before sending.');
      if(payload.confirmation.bulk!==true&&[15,16,21,23].includes(payload.functionCode))throw new Error('Confirm the bulk-write checkbox.');
      if(payload.unitId===0&&payload.confirmation.broadcast!==true)throw new Error('Confirm the Unit 0 broadcast checkbox.');
      q('masterWriteSend').disabled=true;
      q('masterWriteResult').hidden=false;
      q('masterWriteResult').className='master-write-result';
      q('masterWriteResult').textContent='Writing…';
      const result=await api('/api/master/write',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const verify=result.verification?.requested?(result.verification.matched?'Read-back matched':'Read-back mismatch'):'Not requested';
      q('masterWriteResult').className='master-write-result success';
      q('masterWriteResult').innerHTML=`<strong>Write completed and relocked.</strong><br>Response: <code>${esc(result.responseRawHex||'broadcast/no response')}</code><br>Verification: ${esc(verify)}`;
      q('masterWriteConfirm').checked=false;q('masterWriteBulkConfirm').checked=false;q('masterWriteBroadcastConfirm').checked=false;
      await loadAudit();
    }catch(error){
      q('masterWriteResult').hidden=false;
      q('masterWriteResult').className='master-write-result error';
      q('masterWriteResult').innerHTML='<strong>Write blocked/failed.</strong> '+esc(error.message);
    }finally{q('masterWriteSend').disabled=false;}
  }

  async function loadAudit(){
    try{
      const rows=await api('/api/master/write-audit?limit=30');
      q('masterWriteAuditBody').innerHTML=rows.length?[...rows].reverse().map(row=>{
        const verify=row.verification?.requested?(row.verification.matched?'MATCH':'MISMATCH'):'—';
        return `<tr><td>${new Date(row.timestamp).toLocaleTimeString([],{hour12:false})}</td><td>${row.unitId}</td><td>FC${String(row.functionCode).padStart(2,'0')}</td><td>${row.address}</td><td class="mono">${esc(JSON.stringify(row.oldValues??[]))}</td><td class="mono">${esc(JSON.stringify(row.requestedValues??row.maskWrite??[]))}</td><td>${verify}</td><td class="${row.result==='success'?'write-ok':'write-fail'}">${esc(row.result)}</td></tr>`;
      }).join(''):'<tr><td colspan="8">No write evidence yet.</td></tr>';
    }catch(error){q('masterWriteAuditBody').innerHTML='<tr><td colspan="8">'+esc(error.message)+'</td></tr>';}
  }

  async function resetCounters(){
    try{
      if(window.ModbusMasterSessionCounters?.resetCurrent){
        await window.ModbusMasterSessionCounters.resetCurrent();
        return;
      }
      const status=await api('/api/master/stats/reset',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      for(const [id,value] of [['masterTx',0],['masterRx',0],['masterErrors',0],['masterTimeouts',0],['masterRetryCount',0]])if(q(id))q(id).textContent=String(value);
      if(q('masterAvgRtt'))q('masterAvgRtt').textContent='—';
      root.dispatchEvent(new CustomEvent('master-stats-reset',{detail:status}));
    }catch(error){alert('Could not reset counters: '+error.message);}
  }

  function openTraffic(){
    const slave=q('trafficSlave'),fcFilter=q('trafficFc'),search=q('trafficSearch');
    if(slave)slave.value=q('masterUnitId')?.value||'';
    if(fcFilter)fcFilter.value=q('masterFunction')?.value||'';
    if(search)search.value=String(q('masterAddress')?.value||'');
    document.querySelector('.nav-item[data-page="traffic"]')?.click();
  }

  function syncConnected(){
    q('masterOpenWrite').disabled=!connected();
  }

  fc.addEventListener('change',showFields);
  unit.addEventListener('input',showFields);
  for(const id of ['masterWriteAddress','masterWriteValue','masterWriteValues','masterWriteFileRecords','masterWriteAndMask','masterWriteOrMask','masterWriteReadAddress','masterWriteReadQty'])q(id)?.addEventListener('input',updatePreview);
  q('masterOpenWrite').addEventListener('click',openDialog);
  q('masterWriteClose').addEventListener('click',()=>dialog.close());
  q('masterWriteCancel').addEventListener('click',()=>dialog.close());
  q('masterWriteForm').addEventListener('submit',sendWrite);
  q('masterWriteAuditRefresh').addEventListener('click',loadAudit);
  q('masterResetCounters').addEventListener('click',resetCounters);
  q('masterOpenTraffic').addEventListener('click',openTraffic);

  const chip=q('masterConnectionChip');
  if(chip)new MutationObserver(syncConnected).observe(chip,{attributes:true,childList:true,subtree:true});
  syncConnected();
})();