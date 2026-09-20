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
          <button class="master-secondary" id="masterSessionDelete" type="button">Delete</button><button class="master-secondary" id="masterSessionCounterReset" type="button">Reset Counters</button>
        </div>
      </div>
      <div class="master-session-tabs" id="masterSessionTabs" role="tablist"></div>
      <div class="master-session-foot"><span id="masterSessionState" class="saved">Saved on this workstation.</span><span class="master-session-pill">Active session: <code id="masterSessionActiveName">—</code></span></div>
    </section>`);

  const els={
    tabs:q('masterSessionTabs'),state:q('masterSessionState'),activeName:q('masterSessionActiveName'),
    new:q('masterSessionNew'),save:q('masterSessionSave'),duplicate:q('masterSessionDuplicate'),rename:q('masterSessionRename'),delete:q('masterSessionDelete'),counterReset:q('masterSessionCounterReset')
  };

  const monitoredIds=[
    'masterSerialPort','masterBaud','masterParity','masterDataBits','masterStopBits','masterEcho','masterRtsMode','masterRtsSettle','masterTcpHost','masterTcpPort',
    'masterTimeout','masterPollInterval','masterRetries','masterRetryDelay','masterInterRequestDelay','masterUnitId','masterFunction','masterAddress','masterQuantity','masterFormat','masterScale','masterOffset','masterPrecision'
  ];
  let dirty=false,switching=false,store=loadStore();
  let remotePersistChain=Promise.resolve(),remotePersistenceAvailable=false;

  function id(){return `monitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function safeName(value){const s=String(value||'').trim().replace(/\s+/g,' ');return s.slice(0,80)||'Untitled Monitor';}
  function defaultName(index=store.sessions.length+1){return `Monitor ${index}`;}

  function normalizeLoadedStore(parsed){
    if(parsed&&parsed.version===1&&Array.isArray(parsed.sessions)&&parsed.sessions.length){
      const ids=new Set(parsed.sessions.map(session=>session&&session.id).filter(Boolean));
      const activeId=ids.has(parsed.activeId)?parsed.activeId:parsed.sessions[0].id;
      return {version:1,activeId,sessions:parsed.sessions};
    }
    return {version:1,activeId:null,sessions:[]};
  }

  function storeFreshness(value){
    return Math.max(0,...(value?.sessions||[]).map(session=>Number(session?.updatedAt||0)).filter(Number.isFinite));
  }

  function loadStore(){
    try{return normalizeLoadedStore(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}
    catch{/* invalid local state is ignored */}
    return {version:1,activeId:null,sessions:[]};
  }

  async function loadRemoteStore(){
    const response=await fetch('/api/master/monitor-sessions',{cache:'no-store'});
    if(!response.ok)throw new Error('Monitor Session storage returned HTTP '+response.status);
    const parsed=normalizeLoadedStore(await response.json());
    remotePersistenceAvailable=true;
    return parsed;
  }

  function queueRemotePersist(){
    const payload=clone(store);
    remotePersistChain=remotePersistChain
      .catch(()=>undefined)
      .then(async()=>{
        const response=await fetch('/api/master/monitor-sessions',{
          method:'PUT',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(payload)
        });
        if(!response.ok)throw new Error('Monitor Session storage returned HTTP '+response.status);
        remotePersistenceAvailable=true;
        if(!dirty)setState('Saved on this workstation.','saved');
      })
      .catch(()=>{
        remotePersistenceAvailable=false;
        if(!dirty)setState('Saved in browser fallback only; workstation session file is unavailable.','dirty');
      });
  }

  function persist(){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(store));
    queueRemotePersist();
    dirty=false;
    setState(remotePersistenceAvailable?'Saved on this workstation.':'Saving on this workstation…','saved');
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
      dataBits:num('masterDataBits',8),stopBits:num('masterStopBits',1),echoSuppression:value('masterEcho','false')==='true',rtsTxMode:value('masterRtsMode','none'),rtsSettleMs:num('masterRtsSettle',0),
      host:value('masterTcpHost'),port:num('masterTcpPort',502),timeoutMs:num('masterTimeout',1000),retries:num('masterRetries',0),retryDelayMs:num('masterRetryDelay',100),interRequestDelayMs:num('masterInterRequestDelay',0)
    };
  }

  function definitionFromDom(){
    return {
      unitId:num('masterUnitId',1),functionCode:num('masterFunction',3),address:num('masterAddress',0),addressMode:addressMode(),
      quantity:num('masterQuantity',1),pollIntervalMs:num('masterPollInterval',1000),timeoutMs:num('masterTimeout',1000),retries:num('masterRetries',0),retryDelayMs:num('masterRetryDelay',100),interRequestDelayMs:num('masterInterRequestDelay',0)
    };
  }

  function formatFromDom(){
    return {
      type:value('masterFormat','uint16'),scale:num('masterScale',1),offset:num('masterOffset',0),precision:num('masterPrecision',3),
      byteOrder:window.ModbusMasterFormat?.getByteOrder?.()||'ABCD'
    };
  }
  function snapshotFromDom(){
    return {
      // Persist definitions/counters only. Never store rendered live-table HTML
      // from field-derived values in browser or workstation state.
      rowsHtml:'',gridSummary:q('masterGridSummary')?.textContent||'No data',
      counters:{tx:q('masterTx')?.textContent||'0',rx:q('masterRx')?.textContent||'0',errors:q('masterErrors')?.textContent||'0',timeouts:q('masterTimeouts')?.textContent||'0',avgRtt:q('masterAvgRtt')?.textContent||'—'},
      capturedAt:Date.now()
    };
  }

  function buildSession(name){
    const now=Date.now();
    return {id:id(),name:safeName(name),createdAt:now,updatedAt:now,connection:connectionFromDom(),definition:definitionFromDom(),format:formatFromDom(),snapshot:snapshotFromDom(),counterBaseline:null};
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
    if(q('masterDataBody'))q('masterDataBody').innerHTML='<tr><td colspan="8"><div class="master-empty-snapshot">Saved monitor loaded. Press Read Once or Start Polling to refresh live values.</div></td></tr>';
    if(q('masterGridSummary'))q('masterGridSummary').textContent='No live data';
    const c=snap.counters||{};
    if(q('masterTx'))q('masterTx').textContent=c.tx||'0';if(q('masterRx'))q('masterRx').textContent=c.rx||'0';
    if(q('masterErrors'))q('masterErrors').textContent=c.errors||'0';if(q('masterTimeouts'))q('masterTimeouts').textContent=c.timeouts||'0';if(q('masterAvgRtt'))q('masterAvgRtt').textContent=c.avgRtt||'—';
  }

  function applyDefinition(session){
    const c=session.connection||{},d=session.definition||{},f=session.format||{};
    clickSelector('[data-master-type]',c.type||'rtu','data-master-type');
    setValue('masterSerialPort',c.path||'');setValue('masterBaud',c.baudRate??9600);setValue('masterParity',c.parity||'none');
    setValue('masterDataBits',c.dataBits??8);setValue('masterStopBits',c.stopBits??1);setValue('masterEcho',String(Boolean(c.echoSuppression)));setValue('masterRtsMode',c.rtsTxMode||'none');setValue('masterRtsSettle',c.rtsSettleMs??0);
    setValue('masterTcpHost',c.host||'');setValue('masterTcpPort',c.port??502);setValue('masterTimeout',d.timeoutMs??c.timeoutMs??1000);setValue('masterPollInterval',d.pollIntervalMs??1000);setValue('masterRetries',d.retries??c.retries??0);setValue('masterRetryDelay',d.retryDelayMs??c.retryDelayMs??100);setValue('masterInterRequestDelay',d.interRequestDelayMs??c.interRequestDelayMs??0);
    setValue('masterUnitId',d.unitId??1);setValue('masterFunction',d.functionCode??3);setValue('masterAddress',d.address??0);setValue('masterQuantity',d.quantity??1);
    clickSelector('[data-address-mode]',d.addressMode||'raw','data-address-mode');
    setValue('masterFormat',f.type||'uint16');setValue('masterScale',f.scale??1);setValue('masterOffset',f.offset??0);setValue('masterPrecision',f.precision??3);
    window.ModbusMasterFormat?.setByteOrder?.(f.byteOrder||'ABCD');
    restoreSnapshot(session);
    window.ModbusMasterFormat?.render?.();
  }

  async function switchTo(sessionId,{force=false}={}){
    if(switching||(!force&&sessionId===store.activeId))return;
    const next=store.sessions.find(x=>x.id===sessionId);if(!next)return;
    const same=sessionId===store.activeId;
    switching=true;
    try{
      const current=active();if(current&&!same)captureInto(current);
      await stopPollingIfNeeded();
      await disconnectIfConnectionChanges(next);
      store.activeId=next.id;applyDefinition(next);persist();renderTabs();
      setState('Session loaded. Saved values are a snapshot until the next live read.','saved');
    }catch(error){setState(error.message,'dirty');}
    finally{switching=false;}
  }

  function renderTabs(){
    els.tabs.innerHTML=store.sessions.map(session=>{
      const d=session.definition||{},c=session.connection||{},f=session.format||{};
      const subtitle=`${String(c.type||'rtu').toUpperCase()} · Unit ${d.unitId??1} · FC${String(d.functionCode??3).padStart(2,'0')} · ${d.address??0}+${d.quantity??1} · ${f.type||'uint16'} ${f.byteOrder||'ABCD'} · ${d.pollIntervalMs??1000} ms`;
      return `<button type="button" role="tab" aria-selected="${session.id===store.activeId}" class="master-session-tab${session.id===store.activeId?' active':''}" data-session-id="${session.id}"><span class="master-session-tab-main"><strong>${escapeHtml(session.name)}</strong><small>${escapeHtml(subtitle)}</small></span><i class="session-dot"></i></button>`;
    }).join('');
    const a=active();els.activeName.textContent=a?.name||'—';
    els.delete.disabled=store.sessions.length<=1;
  }

  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function markDirty(){if(switching)return;dirty=true;setState('Unsaved changes in the active monitor.','dirty');}

  let lastAbsoluteStats=null;
  window.ModbusMasterSessionCounters={
    apply(stats={}){
      lastAbsoluteStats={...stats};
      const session=active();if(!session)return stats;
      const connectedAt=Number(stats.connectedAt||0);
      const base=session.counterBaseline;
      if(!base||Number(base.connectedAt||0)!==connectedAt){
        session.counterBaseline={connectedAt,txRequests:0,rxResponses:0,errors:0,timeouts:0,retryAttempts:0};
        localStorage.setItem(STORAGE_KEY,JSON.stringify(store));
      }
      const b=session.counterBaseline||{};
      return {...stats,
        txRequests:Math.max(0,Number(stats.txRequests||0)-Number(b.txRequests||0)),
        rxResponses:Math.max(0,Number(stats.rxResponses||0)-Number(b.rxResponses||0)),
        errors:Math.max(0,Number(stats.errors||0)-Number(b.errors||0)),
        timeouts:Math.max(0,Number(stats.timeouts||0)-Number(b.timeouts||0)),
        retryAttempts:Math.max(0,Number(stats.retryAttempts||0)-Number(b.retryAttempts||0))
      };
    },
    async resetCurrent(){
      const session=active();if(!session)return;
      let stats=lastAbsoluteStats;
      try{const status=await fetch('/api/master/status').then(r=>r.ok?r.json():null);if(status?.stats)stats=status.stats;}catch{}
      stats=stats||{};
      session.counterBaseline={connectedAt:Number(stats.connectedAt||0),txRequests:Number(stats.txRequests||0),rxResponses:Number(stats.rxResponses||0),errors:Number(stats.errors||0),timeouts:Number(stats.timeouts||0),retryAttempts:Number(stats.retryAttempts||0)};
      persist();
      for(const id of ['masterTx','masterRx','masterErrors','masterTimeouts','masterRetryCount'])if(q(id))q(id).textContent='0';
      setState('Current Monitor counters reset. Runtime connection statistics remain intact.','saved');
    }
  };
  els.counterReset?.addEventListener('click',()=>window.ModbusMasterSessionCounters.resetCurrent());

  async function ensureInitial(){
    try{
      const local=store;
      const remote=await loadRemoteStore();
      if(remote.sessions.length&&(!local.sessions.length||storeFreshness(remote)>=storeFreshness(local))){
        store=remote;
        localStorage.setItem(STORAGE_KEY,JSON.stringify(store));
      }else if(local.sessions.length){
        store=local;
        queueRemotePersist();
      }
    }catch{
      remotePersistenceAvailable=false;
      setState('Workstation session storage unavailable; using browser fallback.','dirty');
    }
    if(!store.sessions.length){const first=buildSession('Monitor 1');store.sessions.push(first);store.activeId=first.id;persist();}
    if(!active())store.activeId=store.sessions[0].id;
    let runtimeStatus=null;
    try{runtimeStatus=await fetch('/api/master/status').then(r=>r.ok?r.json():null);}catch{/* offline/older checkout */}
    if(runtimeStatus?.connected&&fingerprint(runtimeStatus.config)!==fingerprint(active().connection)){
      renderTabs();persist();
      setState('A live Master connection is already open with a different profile. Disconnect it or click the active monitor tab to switch safely.','dirty');
      return;
    }
    applyDefinition(active());renderTabs();persist();
  }

  els.tabs.addEventListener('click',event=>{const tab=event.target.closest('[data-session-id]');if(tab)switchTo(tab.dataset.sessionId,{force:true});});
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
    await stopPollingIfNeeded();
    const index=store.sessions.findIndex(x=>x.id===a.id),next=store.sessions[index>0?index-1:index+1];
    if(!next)return;
    try{await disconnectIfConnectionChanges(next);}catch(error){setState(error.message,'dirty');return;}
    store.sessions.splice(index,1);store.activeId=next.id;persist();applyDefinition(next);renderTabs();
  });

  for(const id of monitoredIds){const el=q(id);if(!el)continue;el.addEventListener('input',markDirty);el.addEventListener('change',markDirty);}
  q('masterConnectionType')?.addEventListener('click',event=>{if(event.target.closest('[data-master-type]'))markDirty();});
  q('masterAddressMode')?.addEventListener('click',event=>{if(event.target.closest('[data-address-mode]'))markDirty();});
  root.addEventListener('master-format-change',markDirty);

  const snapshotObserver=new MutationObserver(()=>{
    if(switching)return;const a=active();if(!a)return;a.snapshot=snapshotFromDom();a.updatedAt=Date.now();localStorage.setItem(STORAGE_KEY,JSON.stringify(store));
  });
  if(q('masterDataBody'))snapshotObserver.observe(q('masterDataBody'),{childList:true,subtree:true,characterData:true});

  window.addEventListener('beforeunload',()=>{
    const a=active();if(!a)return;
    captureInto(a);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(store));
  });
  ensureInitial();
})();