'use strict';

(()=>{
  const STORAGE_KEY='modbus.master.register-meta.v1';
  const q=id=>document.getElementById(id);
  const root=q('page-master');
  const body=q('masterDataBody');
  if(!root||!body||q('masterRegisterMapDialog'))return;

  const liveHead=root.querySelector('.master-live-head');
  if(!liveHead)return;
  const tools=document.createElement('div');
  tools.className='master-map-actions';
  tools.innerHTML='<button type="button" class="master-secondary" id="masterMapEdit" disabled>Edit Mapping</button><button type="button" class="master-secondary" id="masterMapClear" disabled>Clear Mapping</button>';
  liveHead.appendChild(tools);

  root.insertAdjacentHTML('beforeend',`
    <dialog id="masterRegisterMapDialog" class="master-map-dialog">
      <form method="dialog" id="masterRegisterMapForm">
        <div class="master-map-head"><div><strong>Register Mapping</strong><span id="masterMapAddress">—</span></div><button type="button" class="master-secondary" id="masterMapClose">×</button></div>
        <label>Name / Alias<input id="masterMapName" maxlength="120" placeholder="Phase A Voltage"></label>
        <label>Engineering Unit<input id="masterMapUnit" maxlength="40" placeholder="V, A, kW, Hz, %, °C…"></label>
        <label>Notes<textarea id="masterMapNotes" maxlength="500" rows="3" placeholder="Manual page, scaling note, research observation…"></textarea></label>
        <div class="master-map-footer"><span>Saved locally for this Monitor Session, Unit ID, function and address.</span><div><button type="button" class="master-secondary" id="masterMapCancel">Cancel</button><button type="submit" class="master-primary">Save Mapping</button></div></div>
      </form>
    </dialog>`);

  const dialog=q('masterRegisterMapDialog');
  const edit=q('masterMapEdit'),clear=q('masterMapClear');
  let selected=null,rendering=false,store=load();

  function load(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(parsed&&parsed.version===1&&parsed.entries&&typeof parsed.entries==='object')return parsed;
    }catch{/* ignore invalid local data */}
    return {version:1,entries:{}};
  }
  function persist(){localStorage.setItem(STORAGE_KEY,JSON.stringify(store));}
  function activeSessionId(){return root.querySelector('.master-session-tab.active')?.dataset.sessionId||'default';}
  function unitId(){return Number(q('masterUnitId')?.value||1);}
  function functionCode(){return Number(q('masterFunction')?.value||3);}
  function key(address){return [activeSessionId(),unitId(),functionCode(),Number(address)].join('|');}
  function addressFromRow(row){
    const raw=String(row?.cells?.[0]?.textContent||'').trim();
    const value=Number(raw.replace(/[^0-9-]/g,''));
    return Number.isInteger(value)?value:null;
  }
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function descriptionHtml(meta){
    if(!meta?.name&&!meta?.unit)return '<span class="master-map-empty">Double-click to map</span>';
    const name=meta?.name?'<strong>'+esc(meta.name)+'</strong>':'<strong>Mapped register</strong>';
    const unit=meta?.unit?'<small>'+esc(meta.unit)+'</small>':'';
    return '<span class="master-map-description">'+name+unit+'</span>';
  }
  function apply(){
    if(rendering)return;
    rendering=true;
    try{
      for(const row of body.querySelectorAll('tr')){
        if(!row.cells||row.cells.length<8)continue;
        const address=addressFromRow(row);if(address==null)continue;
        row.dataset.masterAddress=String(address);
        const cell=row.cells[2],meta=store.entries[key(address)]||null;
        const html=descriptionHtml(meta);
        if(cell.innerHTML!==html)cell.innerHTML=html;
        cell.title=meta?.notes||'Double-click to edit register mapping';
      }
    }finally{rendering=false;}
  }
  function select(row){
    body.querySelectorAll('tr.master-map-selected').forEach(node=>node.classList.remove('master-map-selected'));
    const address=addressFromRow(row);
    selected=address==null?null:{row,address};
    if(selected)row.classList.add('master-map-selected');
    edit.disabled=!selected;clear.disabled=!selected||!store.entries[key(selected.address)];
  }
  function openEditor(){
    if(!selected)return;
    const meta=store.entries[key(selected.address)]||{};
    q('masterMapAddress').textContent='Unit '+unitId()+' · FC'+String(functionCode()).padStart(2,'0')+' · Address '+selected.address;
    q('masterMapName').value=meta.name||'';
    q('masterMapUnit').value=meta.unit||'';
    q('masterMapNotes').value=meta.notes||'';
    dialog.showModal();
    setTimeout(()=>q('masterMapName')?.focus(),0);
  }
  function close(){dialog.close();}
  function save(){
    if(!selected)return;
    const name=q('masterMapName').value.trim(),unit=q('masterMapUnit').value.trim(),notes=q('masterMapNotes').value.trim();
    const k=key(selected.address);
    if(!name&&!unit&&!notes)delete store.entries[k];
    else store.entries[k]={name,unit,notes,updatedAt:Date.now()};
    persist();close();apply();clear.disabled=!store.entries[k];
    root.dispatchEvent(new CustomEvent('master-register-map-change',{bubbles:true,detail:{address:selected.address,metadata:store.entries[k]||null}}));
  }

  body.addEventListener('click',event=>{const row=event.target.closest('tr');if(row&&row.cells?.length>=8)select(row);});
  body.addEventListener('dblclick',event=>{const row=event.target.closest('tr');if(!row||row.cells?.length<8)return;select(row);openEditor();});
  edit.addEventListener('click',openEditor);
  clear.addEventListener('click',()=>{
    if(!selected)return;
    const k=key(selected.address);if(!store.entries[k])return;
    if(!confirm('Clear the saved mapping for address '+selected.address+'?'))return;
    delete store.entries[k];persist();apply();clear.disabled=true;
  });
  q('masterMapClose').addEventListener('click',close);
  q('masterMapCancel').addEventListener('click',close);
  q('masterRegisterMapForm').addEventListener('submit',event=>{event.preventDefault();save();});

  const observer=new MutationObserver(()=>apply());
  observer.observe(body,{childList:true,subtree:true});
  q('masterUnitId')?.addEventListener('change',apply);
  q('masterFunction')?.addEventListener('change',apply);
  q('masterSessionTabs')?.addEventListener('click',()=>setTimeout(()=>{selected=null;edit.disabled=true;clear.disabled=true;apply();},0));

  window.ModbusMasterRegisterMap=Object.freeze({
    get:(address)=>store.entries[key(address)]||null,
    list:()=>Object.entries(store.entries).map(([id,metadata])=>({id,...metadata})),
  });
  apply();
})();