'use strict';

(()=>{
  const STORAGE_KEY='modbus.master.monitor-sessions.v1';
  const q=id=>document.getElementById(id);
  const root=q('page-master');
  if(!root||q('masterSessionBar'))return;

  const intro=root.querySelector('.master-intro');
  if(!intro)return;
  intro.insertAdjacentHTML('afterend',`
    <section class="master-session-bar" id="masterSessionBar" aria-label="Saved monitor sessions">
      <div class="master-session-toolbar">
        <div class="master-session-title"><strong>Monitor Sessions</strong><span>Save familiar Modbus Poll-style definitions and switch between monitors without rebuilding them.</span></div>
        <div class="master-session-actions">
          <button class="master-secondary" id="masterSessionNew" type="button">＋ New</button>
          <button class="master-primary" id="masterSessionSave" type="button">Save Session</button>
          <button class="master-secondary" id="masterSessionDuplicate" type="button">Duplicate</button>
          <button class="master-secondary" id="masterSessionRename" type="button">Rename</button>
          <button class="master-secondary" id="masterSessionDelete" type="button">Delete</button>
        </div>
      </div>
      <div class="master-session-tabs" id="masterSessionTabs" role="tablist"></div>
      <div class="master-session-foot"><span id="masterSessionState" class="saved">Saved locally on this workstation.</span><span class="master-session-pill">Active session: <code id="masterSessionActiveName">—</code></span></div>
    </section>`);

  const els={
    tabs:q('masterSessionTabs'),state:q('masterSessionState'),activeName:q('masterSessionActiveName'),
    new:q('masterSessionNew'),save:q('masterSessionSave'),duplicate:q('masterSessionDuplicate'),rename:q('masterSessionRename'),delete:q('masterSessionDelete')
  };

  const monitoredIds=[
    'masterSerialPort','masterBaud','masterParity','masterDataBits','masterStopBits','masterEcho','masterTcpHost','masterTcpPort',
    'masterTimeout','masterPollInterval','masterUnitId','masterFunction','masterAddress','masterQuantity','masterFormat','masterScale','masterOffset'
  ];
  let dirty=false,switching=false,store=loadStore();

  function id(){return `monitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function safeName(value){const s=String(value||'').trim().replace(/\s+/g,' ');return s.slice(0,80)||'Untitled Monitor';}
  function defaultName(index=store.sessions.length+1){return `Monitor ${index}`;}

  function loadStore(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(parsed&&parsed.version===1&&Array.isArray(parsed.sessions)&&parsed.sessions.length){
        return {version:1,activeId:parsed.activeId||parsed.sessions[0].id,sessions:parsed.sessions};
      }
    }catch{/* invalid local state is ignored */}
    return {version:1,activeId:null,sessions:[]};
  }

  function persist(){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(store));
    dirty=false;setState('Saved locally on this workstation.','saved');
  }

  function setState(text,kind=''){
    els.state.textContent=text;els.state.className=kind||'';
  }

  function connectionType(){return root.querySelector('[data-master-type].active')?.dataset.masterType||'rtu';}
  function addressMode(){return root.querySelector('[data-address-mode].active')?.dataset.addressMode||'raw';}
  function value(id,fallback=''){const el=q(id);return el?el.value:fallback;}
  function num(id,fallback=0){const n=Number(value(id,fallback));return Number.isFinite(n)?n:fallback;}

  function connectionFromDom(){
    return {
      type:connectionType(),path:value('masterSerialPort'),baudRate:num('masterBaud',9600),parity:value('masterParity','none'),
      dataBits:num('masterDataBits',8),stopBits:num('masterStopBits',1),echoSuppression:value('masterEcho','false')==='true',
      host:value('masterTcpHost'),port:num('masterTcpPort',502),timeoutMs:num('masterTimeout',1000)
    };
  }

  function definitionFromDom(){
    return {
      unitId:num('masterUnitId',1),functionCode:num('masterFunction',3),address:num('masterAddress',0),addressMode:addressMode(),
      quantity:num('masterQuantity',1),pollIntervalMs:num('masterPollInterval',1000),timeoutMs:num('masterTimeout',1000)
    };
  }

  function formatFromDom(){return {type:value('masterFormat','uint16'),scale:num('masterScale',1),offset:num('masterOffset',0)};}
  function snapshotFromDom(){
    return {
      rowsHtml:q('masterDataBody')?.innerHTML||'',gridSummary:q('masterGridSummary')?.textContent||'No data',
      counters:{tx:q('masterTx')?.textContent||'0',rx:q('masterRx')?.textContent||'0',errors:q('masterErrors')?.textContent||'0',timeouts:q('masterTimeouts')?.textContent||'0',avgRtt:q('masterAvgRtt')?.textContent||'—'},
      capturedAt:Date.now()
    };
  }

  function buildSession(name){
    const now=Date.now();
    return {id:id(),name:safeName(name),createdAt:now,updatedAt:now,connection:connectionFromDom(),definition:definitionFromDom(),format:formatFromDom(),snapshot:snapshotFromDom()};
  }

  function active(){return store.sessions.find(x=>x.id===store.activeId)||null;}
  function captureInto(session){
    if(!session)return;
    session.connection=connectionFromDom();session.definition=definitionFromDom();session.format=formatFromDom();session.snapshot=snapshotFromDom();session.updatedAt=Date.now();
  }

  function fingerprint(connection){
    if(!connection)return'';
    return connection.type==='tcp'
      ?`tcp|${String(connection.host||'').trim().toLowerCase()}|${Number(connection.port||502)}`
      :`${connection.type}|${connection.path||''}|${Number(connection.baudRate||9600)}|${connection.parity||'none'}|${Number(connection.dataBits||8)}|${Number(connection.stopBits||1)}|${Boolean(connection.echoSuppression)}`;
  }

  function connected(){return Boolean(q('masterDisconnect')&&!q('masterDisconnect').disabled);}
  function polling(){return Boolean(q('masterStopPolling')&&!q('masterStopPolling').disabled);}
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function waitFor(predicate,timeoutMs=1800){const start=Date.now();while(Date.now()-start<timeoutMs){if(predicate())return true;await sleep(35);}return Boolean(predicate());}

  async function stopPollingIfNeeded(){
    if(!polling())return;
    q('masterStopPolling')?.click();
    await waitFor(()=>!polling(),500);
  }

  async function disconnectIfConnectionChanges(target){
    if(!connected())return;
    if(fingerprint(connectionFromDom())===fingerprint(target.connection))return;
    q('masterDisconnect')?.click();
    const ok=await waitFor(()=>!connected(),2200);
    if(!ok)throw new Error('Could not disconnect the active Master connection before switching connection profiles.');
  }

  function setValue(id,value){const el=q(id);if(!el)return;el.value=value==null?'':String(value);el.dispatchEvent(new Event('change',{bubbles:true}));}
  function clickSelector(selector,value,key){const button=root.querySelector(`${selector}[${key}="${value}"]`);if(button)button.click();}

  function restoreSnapshot(session){
    const snap=session.snapshot||{};
    if(q('masterDataBody'))q('masterDataBody').innerHTML=snap.rowsHtml||'<tr><td colspan="8"><div class="master-empty-snapshot">Saved monitor loaded. Press Read Once or Start Polling to refresh live values.</div></td></tr>';
    if(q('masterGridSummary'))q('masterGridSummary').textContent=snap.rowsHtml?`${snap.gridSummary||'Saved data'} · saved snapshot`:'No live data';
    const c=snap.counters||{};
    if(q('masterTx'))q('masterTx').textContent=c.tx||'0';if(q('masterRx'))q('masterRx').textContent=c.rx||'0';
    if(q('masterErrors'))q('masterErrors').textContent=c.errors||'0';if(q('masterTimeouts'))q('masterTimeouts').textContent=c.timeouts||'0';if(q('masterAvgRtt'))q('masterAvgRtt').textContent=c.avgRtt||'—';
  }

  function applyDefinition(session){
    const c=session.connection||{},d=session.definition||{},f=session.format||{};
    clickSelector('[data-master-type]',c.type||'rtu','data-master-type');
    setValue('masterSerialPort',c.path||'');setValue('masterBaud',c.baudRate??9600);setValue('masterParity',c.parity||'none');
    setValue('masterDataBits',c.dataBits??8);setValue('masterStopBits',c.stopBits??1);setValue('masterEcho',String(Boolean(c.echoSuppression)));
    setValue('masterTcpHost',c.host||'');setValue('masterTcpPort',c.port??502);setValue('masterTimeout',d.timeoutMs??c.timeoutMs??1000);setValue('masterPollInterval',d.pollIntervalMs??1000);
    setValue('masterUnitId',d.unitId??1);setValue('masterFunction',d.functionCode??3);setValue('masterAddress',d.address??0);setValue('masterQuantity',d.quantity??1);
    clickSelector('[data-address-mode]',d.addressMode||'raw','data-address-mode');
    setValue('masterFormat',f.type||'uint16');setValue('masterScale',f.scale??1);setValue('masterOffset',f.offset??0);
    restoreSnapshot(session);
  }

  async function switchTo(sessionId){
    if(switching||sessionId===store.activeId)return;
    const next=store.sessions.find(x=>x.id===sessionId);if(!next)return;
    switching=true;
    try{
      const current=active();if(current)captureInto(current);
      await stopPollingIfNeeded();
      await disconnectIfConnectionChanges(next);
      store.activeId=next.id;applyDefinition(next);persist();renderTabs();
      setState('Session loaded. Saved values are a snapshot until the next live read.','saved');
    }catch(error){setState(error.message,'dirty');}
    finally{switching=false;}
  }

  function renderTabs(){
    els.tabs.innerHTML=store.sessions.map(session=>{
      const d=session.definition||{},c=session.connection||{};
      const subtitle=`${String(c.type||'rtu').toUpperCase()} · Unit ${d.unitId??1} · FC${String(d.functionCode??3).padStart(2,'0')} · ${d.address??0}+${d.quantity??1} · ${d.pollIntervalMs??1000} ms`;
      return `<button type="button" role="tab" aria-selected="${session.id===store.activeId}" class="master-session-tab${session.id===store.activeId?' active':''}" data-session-id="${session.id}"><span class="master-session-tab-main"><strong>${escapeHtml(session.name)}</strong><small>${escapeHtml(subtitle)}</small></span><i class="session-dot"></i></button>`;
    }).join('');
    const a=active();els.activeName.textContent=a?.name||'—';
    els.delete.disabled=store.sessions.length<=1;
  }

  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function markDirty(){if(switching)return;dirty=true;setState('Unsaved changes in the active monitor.','dirty');}

  function ensureInitial(){
    if(!store.sessions.length){const first=buildSession('Monitor 1');store.sessions.push(first);store.activeId=first.id;persist();}
    if(!active())store.activeId=store.sessions[0].id;
    applyDefinition(active());renderTabs();persist();
  }

  els.tabs.addEventListener('click',event=>{const tab=event.target.closest('[data-session-id]');if(tab)switchTo(tab.dataset.sessionId);});
  els.new.addEventListener('click',async()=>{
    if(active())captureInto(active());await stopPollingIfNeeded();
    const session=buildSession(defaultName());store.sessions.push(session);store.activeId=session.id;applyDefinition(session);persist();renderTabs();setState('New monitor created from the current definition.','saved');
  });
  els.save.addEventListener('click',()=>{const a=active();if(!a)return;captureInto(a);persist();renderTabs();});
  els.duplicate.addEventListener('click',async()=>{
    const a=active();if(!a)return;captureInto(a);await stopPollingIfNeeded();
    const copy=clone(a);copy.id=id();copy.name=safeName(`${a.name} Copy`);copy.createdAt=Date.now();copy.updatedAt=copy.createdAt;store.sessions.push(copy);store.activeId=copy.id;persist();applyDefinition(copy);renderTabs();
  });
  els.rename.addEventListener('click',()=>{
    const a=active();if(!a)return;const name=prompt('Monitor session name',a.name);if(name==null)return;a.name=safeName(name);a.updatedAt=Date.now();persist();renderTabs();
  });
  els.delete.addEventListener('click',async()=>{
    if(store.sessions.length<=1)return;const a=active();if(!a)return;if(!confirm(`Delete saved monitor “${a.name}”?`))return;
    await stopPollingIfNeeded();const index=store.sessions.findIndex(x=>x.id===a.id);store.sessions.splice(index,1);store.activeId=store.sessions[Math.max(0,index-1)]?.id||store.sessions[0].id;persist();applyDefinition(active());renderTabs();
  });

  for(const id of monitoredIds){const el=q(id);if(!el)continue;el.addEventListener('input',markDirty);el.addEventListener('change',markDirty);}
  q('masterConnectionType')?.addEventListener('click',event=>{if(event.target.closest('[data-master-type]'))markDirty();});
  q('masterAddressMode')?.addEventListener('click',event=>{if(event.target.closest('[data-address-mode]'))markDirty();});

  const snapshotObserver=new MutationObserver(()=>{
    if(switching)return;const a=active();if(!a)return;a.snapshot=snapshotFromDom();a.updatedAt=Date.now();localStorage.setItem(STORAGE_KEY,JSON.stringify(store));
  });
  if(q('masterDataBody'))snapshotObserver.observe(q('masterDataBody'),{childList:true,subtree:true,characterData:true});

  window.addEventListener('beforeunload',()=>{const a=active();if(a){captureInto(a);localStorage.setItem(STORAGE_KEY,JSON.stringify(store));}});
  ensureInitial();
})();
