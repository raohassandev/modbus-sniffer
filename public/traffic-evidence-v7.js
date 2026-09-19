'use strict';

(()=>{
  const page=document.getElementById('page-traffic');
  if(!page||document.getElementById('trafficSource'))return;
  const filters=page.querySelector('.filters');
  if(!filters)return;

  const label=document.createElement('label');
  label.className='traffic-source-filter';
  label.innerHTML='Source<select id="trafficSource"><option value="">All sources</option><option value="Sniffer">Sniffer</option><option value="Master">Master</option><option value="Slave">Slave</option><option value="Discovery">Discovery</option><option value="Test Sequence">Test Sequence</option><option value="Raw Lab">Raw Lab</option></select>';
  filters.insertBefore(label,filters.firstChild);
  const connectionLabel=document.createElement('label');
  connectionLabel.innerHTML='Connection<select id="trafficConnection"><option value="">All connections</option></select>';
  filters.insertBefore(connectionLabel,label.nextSibling);
  const addressMin=document.createElement('label');addressMin.innerHTML='Address from<input id="trafficAddressMin" type="number" min="0" max="65535" placeholder="Any">';
  const addressMax=document.createElement('label');addressMax.innerHTML='Address to<input id="trafficAddressMax" type="number" min="0" max="65535" placeholder="Any">';
  filters.append(addressMin,addressMax);

  const panelHead=page.querySelector('.traffic-panel .panel-head');
  if(panelHead){
    const actions=document.createElement('div');actions.className='traffic-evidence-actions';
    actions.innerHTML='<button class="secondary" id="trafficSelectVisible">Select visible</button><button class="secondary" id="trafficClearSelected">Clear selected</button><button class="secondary" id="trafficBookmarkCurrent">Bookmark current</button><button class="secondary" id="trafficExportSelected">Export selected CSV</button><span id="trafficSelectedCount" class="evidence-selected-count">0 selected</span>';
    panelHead.appendChild(actions);
  }

  const direction=document.getElementById('trafficDirection');
  if(direction){
    for(const value of ['TEST','DISCOVERY']){
      if(![...direction.options].some(option=>option.value===value)){
        const option=document.createElement('option');option.value=value;option.textContent=value;direction.appendChild(option);
      }
    }
  }

  const baseTrafficFilters=trafficFilters;
  trafficFilters=function(){const f=baseTrafficFilters();f.sourceType=document.getElementById('trafficSource')?.value||'';f.connectionId=document.getElementById('trafficConnection')?.value||'';const amin=document.getElementById('trafficAddressMin')?.value,amax=document.getElementById('trafficAddressMax')?.value;f.addressMin=amin===''?null:Number(amin);f.addressMax=amax===''?null:Number(amax);return f;};

  function evidenceAddress(t){
    const d=t.decoded||{},r=t.request||{};
    const values=[d.startAddress,r.startAddress,d.address,r.address,d.readStartAddress,r.readStartAddress,d.writeStartAddress,r.writeStartAddress];
    const first=values.find(Number.isFinite);return Number.isFinite(first)?Number(first):null;
  }
  filteredTransactions=function(){
    const f=trafficFilters();
    return state.transactions.filter(t=>{
      if(f.sourceType&&String(t.sourceType||'Sniffer')!==f.sourceType)return false;
      if(f.connectionId&&String(t.connectionId||t.channelId||'')!==f.connectionId)return false;
      if(f.channelId&&t.channelId!==f.channelId)return false;
      if(f.slave&&Number(t.unitId??t.slaveId)!==Number(f.slave))return false;
      if(f.fc&&Number(t.functionCode)!==Number(f.fc))return false;
      if(f.direction&&t.direction!==f.direction)return false;
      const address=evidenceAddress(t);
      if(f.addressMin!=null&&(address==null||address<f.addressMin))return false;
      if(f.addressMax!=null&&(address==null||address>f.addressMax))return false;
      if(f.q){
        const hay=[t.rawHex,t.functionName,t.exceptionName,t.deviceKey,t.sourceType,t.source,t.connectionId,detail(t),JSON.stringify(t.decoded||{})].join(' ').toLowerCase();
        if(!hay.includes(f.q))return false;
      }
      return true;
    }).slice(-2000);
  };

  const baseDirBadge=dirBadge;
  dirBadge=function(t){
    if(t.direction==='TEST')return '<span class="badge evidence-test">TEST</span>';
    if(t.direction==='DISCOVERY')return '<span class="badge evidence-discovery">DISCOVERY</span>';
    return baseDirBadge(t);
  };

  const EVIDENCE_STORE='modbus.traffic.evidence-marks.v1';
  const selectedEvidence=new Set();
  let marks={};
  try{marks=JSON.parse(localStorage.getItem(EVIDENCE_STORE)||'{}')||{};}catch{marks={};}
  const evidenceKey=t=>String(t.sourceType||'Sniffer')+'|'+String(t.id)+'|'+String(t.timestamp||'');
  function persistMarks(){localStorage.setItem(EVIDENCE_STORE,JSON.stringify(marks));}
  function syncSelectedCount(){const el=document.getElementById('trafficSelectedCount');if(el)el.textContent=selectedEvidence.size.toLocaleString()+' selected';}
  function syncConnections(){
    const select=document.getElementById('trafficConnection');if(!select)return;const current=select.value;
    const values=[...new Set(state.transactions.map(t=>String(t.connectionId||t.channelId||'')).filter(Boolean))].sort();
    select.innerHTML='<option value="">All connections</option>'+values.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
    if(values.includes(current))select.value=current;
  }

  const baseRenderTraffic=renderTraffic;
  renderTraffic=function(){
    baseRenderTraffic();
    syncConnections();
    const table=page.querySelector('#trafficBody')?.closest('table'),head=table?.querySelector('thead tr');
    if(head&&!head.querySelector('.evidence-select-head')){const th=document.createElement('th');th.className='evidence-select-head';th.textContent='Sel';head.prepend(th);}
    for(const row of document.querySelectorAll('#trafficBody tr[data-packet]')){
      const t=state.transactions.find(item=>item.id===Number(row.dataset.packet));if(!t)continue;
      const key=evidenceKey(t);
      if(!row.querySelector('.evidence-select-cell')){const td=document.createElement('td');td.className='evidence-select-cell';td.innerHTML='<input type="checkbox" class="evidence-select" aria-label="Select evidence">';row.prepend(td);td.querySelector('input').checked=selectedEvidence.has(key);}
      row.classList.toggle('evidence-bookmarked',Boolean(marks[key]?.bookmarked));
      row.classList.toggle('evidence-selected',selectedEvidence.has(key));
      const source=String(t.sourceType||'Sniffer');
      row.dataset.sourceType=source;
      row.classList.add('evidence-source-'+source.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
      const cell=row.children[5];
      if(cell&&!cell.querySelector('.evidence-source-badge')){
        const br=document.createElement('br');cell.appendChild(br);
        const badge=document.createElement('span');badge.className='evidence-source-badge';badge.textContent=source;cell.appendChild(badge);
        if(t.connectionId){const conn=document.createElement('span');conn.className='evidence-connection';conn.textContent=' · '+t.connectionId;cell.appendChild(conn);}
      }
    }
    syncSelectedCount();
  };

  const baseSelectPacket=selectPacket;
  selectPacket=function(id){
    baseSelectPacket(id);
    const t=state.transactions.find(item=>item.id===Number(id));if(!t)return;
    const grid=document.querySelector('#inspectorContent .inspect-grid');
    if(grid&&!grid.querySelector('[data-evidence-source]')){
      const source=document.createElement('div');source.className='inspect-kv';source.dataset.evidenceSource='1';source.innerHTML='<span>Source</span><strong>'+esc(t.sourceType||'Sniffer')+'</strong>';
      const connection=document.createElement('div');connection.className='inspect-kv';connection.innerHTML='<span>Connection</span><strong>'+esc(t.connectionId||t.channelId||'—')+'</strong>';
      const event=document.createElement('div');event.className='inspect-kv';event.innerHTML='<span>Event</span><strong>'+esc(t.eventType||'passive.transaction')+'</strong>';
      grid.prepend(event);grid.prepend(connection);grid.prepend(source);
    }
    const key=evidenceKey(t),mark=marks[key]||{};
    const inspector=document.getElementById('inspectorContent');
    if(inspector&&!inspector.querySelector('[data-evidence-annotation]')){
      const box=document.createElement('div');box.className='evidence-annotation-box';box.dataset.evidenceAnnotation='1';
      box.innerHTML='<label>Evidence annotation<textarea id="trafficEvidenceAnnotation" rows="3" placeholder="Engineering note…">'+esc(mark.annotation||'')+'</textarea></label><div><label><input id="trafficEvidenceBookmark" type="checkbox" '+(mark.bookmarked?'checked':'')+'> Bookmark packet</label><button class="secondary" id="trafficEvidenceSaveMark">Save note</button></div>';
      inspector.appendChild(box);
      box.querySelector('#trafficEvidenceSaveMark').addEventListener('click',()=>{marks[key]={bookmarked:box.querySelector('#trafficEvidenceBookmark').checked,annotation:box.querySelector('#trafficEvidenceAnnotation').value.trim(),savedAt:Date.now()};persistMarks();renderTraffic();});
    }
  };

  document.getElementById('trafficSource').addEventListener('change',renderTraffic);
  document.getElementById('trafficConnection').addEventListener('change',renderTraffic);
  for(const id of ['trafficAddressMin','trafficAddressMax'])document.getElementById(id)?.addEventListener('input',renderTraffic);
  document.getElementById('trafficBody')?.addEventListener('click',e=>{
    const checkbox=e.target.closest('.evidence-select');if(!checkbox)return;e.stopPropagation();
    const row=checkbox.closest('tr[data-packet]'),t=state.transactions.find(item=>item.id===Number(row?.dataset.packet));if(!t)return;
    const key=evidenceKey(t);checkbox.checked?selectedEvidence.add(key):selectedEvidence.delete(key);row.classList.toggle('evidence-selected',checkbox.checked);syncSelectedCount();
  });
  document.getElementById('trafficSelectVisible')?.addEventListener('click',()=>{for(const t of filteredTransactions())selectedEvidence.add(evidenceKey(t));renderTraffic();});
  document.getElementById('trafficClearSelected')?.addEventListener('click',()=>{selectedEvidence.clear();renderTraffic();});
  document.getElementById('trafficBookmarkCurrent')?.addEventListener('click',()=>{const t=state.transactions.find(item=>item.id===Number(state.selectedPacket));if(!t)return;const key=evidenceKey(t);marks[key]={...(marks[key]||{}),bookmarked:true,savedAt:Date.now()};persistMarks();renderTraffic();});
  document.getElementById('trafficExportSelected')?.addEventListener('click',()=>{
    const rows=state.transactions.filter(t=>selectedEvidence.has(evidenceKey(t)));if(!rows.length)return;
    const cols=['timestamp','sourceType','connectionId','direction','unitId','functionCode','rttMs','exceptionName','rawHex','annotation'];
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const csv=[cols.join(',')].concat(rows.map(t=>{const m=marks[evidenceKey(t)]||{};return [new Date(t.timestamp).toISOString(),t.sourceType||'Sniffer',t.connectionId||t.channelId||'',t.direction||'',t.unitId??t.slaveId??'',t.functionCode??'',t.rttMs??'',t.exceptionName||'',t.rawHex||'',m.annotation||''].map(quote).join(',');})).join('\n')+'\n';
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='modbus-selected-evidence.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
  const head=page.querySelector('.traffic-panel .panel-head p');
  if(head)head.insertAdjacentHTML('beforeend',' <span class="evidence-unified-note">· unified passive + active evidence</span>');
  renderTraffic();
})();