'use strict';

(()=>{
  const meta=['Logger / Trend','Log Modbus register values and communication evidence, then trend selected sources.'];
  try{pageMeta.loggerTrend=meta;}catch{}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');
  if(!nav||!main||document.getElementById('page-loggerTrend'))return;

  const seqNav=nav.querySelector('[data-page="testSequences"]');
  const button=document.createElement('button');
  button.className='nav-item';button.dataset.page='loggerTrend';
  button.innerHTML='<span>⌁</span> Logger / Trend';
  if(seqNav?.nextSibling)nav.insertBefore(button,seqNav.nextSibling);else nav.appendChild(button);

  main.insertAdjacentHTML('beforeend',`
    <section class="page" id="page-loggerTrend">
      <div class="logger-workspace">
        <div class="logger-intro">
          <div><h2>Modbus Logger / Trend</h2><p>Persistent JSONL logging for register streams and protocol events, with bounded live trend data and CSV export.</p></div>
          <div class="logger-chip-row"><span class="logger-chip" id="loggerStatusChip"><i></i><span>Ready</span></span><span class="logger-chip active">MODBUS EVIDENCE ONLY</span></div>
        </div>

        <div class="logger-grid">
          <article class="logger-card">
            <div class="logger-card-head"><div><h3>1. Add Register Stream</h3><p>Choose a passive Sniffer or active Master register source.</p></div></div>
            <div class="logger-card-body logger-form">
              <label>Source<select id="loggerSourceMode"><option value="sniffer">Sniffer</option><option value="master">Master</option></select></label>
              <label>Stream ID<input id="loggerStreamId" placeholder="phase-a-voltage"></label>
              <label>Label<input id="loggerLabel" placeholder="Phase A Voltage"></label>
              <label>Unit<input id="loggerUnit" placeholder="V, A, kW..."></label>
              <label>Unit / Slave ID<input id="loggerUnitId" type="number" min="0" max="255" value="1"></label>
              <label>Function<input id="loggerFc" type="number" min="1" max="255" value="3"></label>
              <label>Address<input id="loggerAddress" type="number" min="0" max="65535" value="0"></label>
              <label>Device Key <small>(optional Sniffer)</small><input id="loggerDeviceKey" placeholder="RTU:COM5:1"></label>
              <label>Mode<select id="loggerMode"><option value="fixed" selected>Fixed interval</option><option value="every">Every sample</option><option value="change-only">Change only</option></select></label>
              <label>Interval (ms)<input id="loggerInterval" type="number" min="1" value="1000"></label>
              <button class="primary logger-wide" id="loggerSave">Save Stream</button>
              <div class="logger-note logger-wide" id="loggerNote">Streams persist across application restarts. Logger/Trend does not control the Modbus process.</div>
            </div>
          </article>

          <article class="logger-card">
            <div class="logger-card-head"><div><h3>2. Logger Status</h3><p>Bounded disk logging with automatic file rotation.</p></div><button class="secondary" id="loggerRefresh">Refresh</button></div>
            <div class="logger-card-body">
              <div class="logger-stats">
                <div><span>Streams</span><strong id="loggerStreamCount">0</strong></div>
                <div><span>Written</span><strong id="loggerWritten">0</strong></div>
                <div><span>Skipped</span><strong id="loggerSkipped">0</strong></div>
                <div><span>Protocol events</span><strong id="loggerEventCount">0</strong></div>
              </div>
              <dl class="logger-details"><div><dt>Current file</dt><dd id="loggerCurrentFile">—</dd></div><div><dt>Current bytes</dt><dd id="loggerCurrentBytes">0</dd></div><div><dt>Log directory</dt><dd id="loggerDirectory">—</dd></div></dl>
            </div>
          </article>

          <article class="logger-card logger-wide">
            <div class="logger-card-head"><div><h3>3. Register Streams</h3><p>Select a stream to view its live trend.</p></div></div>
            <div class="logger-card-body"><div class="logger-table-wrap"><table class="logger-table"><thead><tr><th>Stream</th><th>Source</th><th>Unit</th><th>FC</th><th>Address</th><th>Mode</th><th>Interval</th><th>Actions</th></tr></thead><tbody id="loggerProfilesBody"><tr><td colspan="8" class="muted">No logger streams configured.</td></tr></tbody></table></div></div>
          </article>

          <article class="logger-card logger-wide">
            <div class="logger-card-head"><div><h3>4. Live Trend</h3><p id="loggerTrendLabel">Select a stream.</p></div><div class="logger-actions"><select id="loggerTrendStream"><option value="">Select stream…</option></select><a class="button secondary" id="loggerExportCsv" href="#" aria-disabled="true">Export CSV</a></div></div>
            <div class="logger-card-body">
              <canvas id="loggerTrendCanvas" height="280"></canvas>
              <div class="logger-trend-stats"><span>Points <strong id="loggerTrendPoints">0</strong></span><span>Latest <strong id="loggerTrendLatest">—</strong></span><span>Min <strong id="loggerTrendMin">—</strong></span><span>Max <strong id="loggerTrendMax">—</strong></span></div>
            </div>
          </article>

          <article class="logger-card logger-wide">
            <div class="logger-card-head"><div><h3>5. Recent Communication Evidence</h3><p>Master, Slave, Sniffer, Discovery and Test Sequence events logged independently of register streams.</p></div></div>
            <div class="logger-card-body"><div class="logger-table-wrap logger-events-wrap"><table class="logger-table"><thead><tr><th>Time</th><th>Source</th><th>Direction</th><th>Unit</th><th>FC</th><th>RTT</th><th>Exception</th></tr></thead><tbody id="loggerEventsBody"><tr><td colspan="7" class="muted">No communication events logged yet.</td></tr></tbody></table></div></div>
          </article>
        </div>
      </div>
    </section>`);

  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let profiles=[],selectedStream='',timer=null;

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
    return body;
  }

  function safeStreamId(value){
    return String(value||'').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);
  }

  function profilePayload(){
    const mode=q('loggerSourceMode').value;
    const streamId=safeStreamId(q('loggerStreamId').value||q('loggerLabel').value);
    if(!streamId)throw new Error('Stream ID or Label is required.');
    const source={mode,unitId:Number(q('loggerUnitId').value),functionCode:Number(q('loggerFc').value),address:Number(q('loggerAddress').value)};
    if(mode==='sniffer'&&q('loggerDeviceKey').value.trim())source.deviceKey=q('loggerDeviceKey').value.trim();
    return {streamId,label:q('loggerLabel').value.trim()||streamId,unit:q('loggerUnit').value.trim(),source,mode:q('loggerMode').value,intervalMs:Number(q('loggerInterval').value||1000),enabled:true,maxPoints:10000};
  }

  async function saveProfile(){
    try{
      const profile=await api('/api/logger-trend/profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(profilePayload())});
      q('loggerNote').className='logger-note good';
      q('loggerNote').textContent='Saved '+profile.streamId+'. Matching Modbus samples will now be logged.';
      selectedStream=profile.streamId;
      await refresh();
    }catch(error){
      q('loggerNote').className='logger-note error';q('loggerNote').textContent=error.message;
    }
  }

  async function removeProfile(id){
    if(!confirm('Remove logger stream "'+id+'"? Existing log files are not deleted.'))return;
    try{await api('/api/logger-trend/profiles/'+encodeURIComponent(id),{method:'DELETE'});if(selectedStream===id)selectedStream='';await refresh();}
    catch(error){q('loggerNote').className='logger-note error';q('loggerNote').textContent=error.message;}
  }

  function renderProfiles(){
    q('loggerProfilesBody').innerHTML=profiles.length?profiles.map(p=>
      '<tr><td><strong>'+esc(p.label)+'</strong><br><span class="muted">'+esc(p.streamId)+'</span></td><td>'+esc(p.source.mode)+'</td><td>'+p.source.unitId+'</td><td>FC'+String(p.source.functionCode).padStart(2,'0')+'</td><td class="mono">'+p.source.address+'</td><td>'+esc(p.mode)+'</td><td>'+p.intervalMs+' ms</td><td><button class="ghost" data-logger-view="'+esc(p.streamId)+'">Trend</button> <a class="button ghost" href="/api/logger-trend/export/'+encodeURIComponent(p.streamId)+'.csv">CSV</a> <button class="ghost" data-logger-remove="'+esc(p.streamId)+'">Remove</button></td></tr>'
    ).join(''):'<tr><td colspan="8" class="muted">No logger streams configured.</td></tr>';
    const select=q('loggerTrendStream'),current=selectedStream||select.value;
    select.innerHTML='<option value="">Select stream…</option>'+profiles.map(p=>'<option value="'+esc(p.streamId)+'">'+esc(p.label)+'</option>').join('');
    if(profiles.some(p=>p.streamId===current)){select.value=current;selectedStream=current;}
    else if(profiles[0]&&!selectedStream){select.value=profiles[0].streamId;selectedStream=profiles[0].streamId;}
    syncExport();
  }

  function syncExport(){
    const link=q('loggerExportCsv');
    if(!selectedStream){link.href='#';link.setAttribute('aria-disabled','true');return;}
    link.href='/api/logger-trend/export/'+encodeURIComponent(selectedStream)+'.csv';link.removeAttribute('aria-disabled');
  }

  function drawTrend(points){
    const canvas=q('loggerTrendCanvas'),rect=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2),w=Math.max(320,rect.width),h=280;
    canvas.width=Math.floor(w*ratio);canvas.height=Math.floor(h*ratio);canvas.style.height=h+'px';
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
    const pad={l:52,r:16,t:16,b:30};
    if(!points.length){ctx.fillStyle='#92a2b5';ctx.font='12px system-ui';ctx.fillText('No samples yet for this stream.',pad.l,40);return;}
    const values=points.map(p=>Number(p.value)).filter(Number.isFinite),min=Math.min(...values),max=Math.max(...values),range=max-min||1;
    const t0=points[0].timestamp,t1=points.at(-1).timestamp,dt=t1-t0||1;
    ctx.strokeStyle='#243244';ctx.fillStyle='#92a2b5';ctx.font='10px system-ui';
    for(let i=0;i<=4;i++){const y=pad.t+(h-pad.t-pad.b)*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText((max-range*i/4).toFixed(2),4,y+3);}
    const x=p=>pad.l+(Number(p.timestamp)-t0)/dt*(w-pad.l-pad.r),y=p=>pad.t+(1-(Number(p.value)-min)/range)*(h-pad.t-pad.b);
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x(p),y(p)):ctx.moveTo(x(p),y(p)));ctx.strokeStyle='#36d399';ctx.lineWidth=1.6;ctx.stroke();
    ctx.fillStyle='#92a2b5';ctx.fillText(new Date(t0).toLocaleTimeString([],{hour12:false}),pad.l,h-8);const right=new Date(t1).toLocaleTimeString([],{hour12:false});ctx.fillText(right,w-pad.r-55,h-8);
  }

  async function refreshTrend(){
    if(!selectedStream){drawTrend([]);return;}
    try{
      const points=await api('/api/logger-trend/series/'+encodeURIComponent(selectedStream)+'?maxPoints=1000');
      drawTrend(points);
      q('loggerTrendPoints').textContent=points.length.toLocaleString();
      const values=points.map(p=>Number(p.value)).filter(Number.isFinite);
      q('loggerTrendLatest').textContent=values.length?values.at(-1).toFixed(3):'—';
      q('loggerTrendMin').textContent=values.length?Math.min(...values).toFixed(3):'—';
      q('loggerTrendMax').textContent=values.length?Math.max(...values).toFixed(3):'—';
      const profile=profiles.find(p=>p.streamId===selectedStream);
      q('loggerTrendLabel').textContent=profile?(profile.label+(profile.unit?' · '+profile.unit:'')):'Select a stream.';
    }catch{drawTrend([]);}
  }

  async function refreshEvents(){
    try{
      const rows=await api('/api/logger-trend/events?limit=100');
      q('loggerEventsBody').innerHTML=rows.length?[...rows].reverse().map(e=>
        '<tr><td>'+new Date(e.timestamp).toLocaleTimeString([],{hour12:false})+'</td><td>'+esc(e.sourceType)+'</td><td>'+esc(e.direction||'—')+'</td><td>'+esc(e.unitId??'—')+'</td><td>'+esc(e.functionCode==null?'—':'FC'+String(e.functionCode).padStart(2,'0'))+'</td><td>'+esc(e.rttMs==null?'—':Number(e.rttMs).toFixed(1)+' ms')+'</td><td>'+(e.exception?'YES':'—')+'</td></tr>'
      ).join(''):'<tr><td colspan="7" class="muted">No communication events logged yet.</td></tr>';
    }catch{}
  }

  async function refresh(){
    try{
      const status=await api('/api/logger-trend/status');
      profiles=status.profiles||[];renderProfiles();
      q('loggerStreamCount').textContent=profiles.length.toLocaleString();
      q('loggerWritten').textContent=Number(status.logger?.stats?.written||0).toLocaleString();
      q('loggerSkipped').textContent=Number(status.logger?.stats?.skipped||0).toLocaleString();
      q('loggerEventCount').textContent=Number(status.eventCount||0).toLocaleString();
      q('loggerCurrentFile').textContent=status.logger?.currentPath||'—';
      q('loggerCurrentBytes').textContent=Number(status.logger?.currentBytes||0).toLocaleString();
      q('loggerDirectory').textContent=status.dataDir||'—';
      q('loggerStatusChip').classList.add('running');
      await Promise.all([refreshTrend(),refreshEvents()]);
    }catch(error){
      q('loggerStatusChip').classList.remove('running');q('loggerStatusChip').querySelector('span').textContent='Unavailable';
      q('loggerNote').className='logger-note error';q('loggerNote').textContent=error.message;
    }
  }

  q('loggerSave').addEventListener('click',saveProfile);
  q('loggerRefresh').addEventListener('click',refresh);
  q('loggerProfilesBody').addEventListener('click',e=>{
    const view=e.target.closest('[data-logger-view]');if(view){selectedStream=view.dataset.loggerView;q('loggerTrendStream').value=selectedStream;syncExport();refreshTrend();return;}
    const remove=e.target.closest('[data-logger-remove]');if(remove)removeProfile(remove.dataset.loggerRemove);
  });
  q('loggerTrendStream').addEventListener('change',()=>{selectedStream=q('loggerTrendStream').value;syncExport();refreshTrend();});

  window.openLoggerTrendFromMaster=()=>{
    q('loggerSourceMode').value='master';
    q('loggerUnitId').value=document.getElementById('masterUnitId')?.value||1;
    q('loggerFc').value=document.getElementById('masterFunction')?.value||3;
    const selected=document.querySelector('#masterDataBody tr.master-map-selected');
    q('loggerAddress').value=selected?.dataset.masterAddress??document.getElementById('masterAddress')?.value??0;
    const mapName=selected?.cells?.[2]?.querySelector('strong')?.textContent||'';
    q('loggerLabel').value=mapName;
    q('loggerStreamId').value=safeStreamId(mapName||('master-'+q('loggerUnitId').value+'-'+q('loggerFc').value+'-'+q('loggerAddress').value));
    if(typeof go==='function')go('loggerTrend');
  };

  function installMasterShortcut(){
    const masterStrip=document.querySelector('#page-master .master-write-actions');
    if(!masterStrip||document.getElementById('masterOpenLoggerTrend'))return Boolean(masterStrip);
    const b=document.createElement('button');b.type='button';b.className='master-secondary';b.id='masterOpenLoggerTrend';b.textContent='Logger / Trend';b.addEventListener('click',window.openLoggerTrendFromMaster);masterStrip.insertBefore(b,masterStrip.firstChild);
    return true;
  }
  if(!installMasterShortcut()){
    const observer=new MutationObserver(()=>{if(installMasterShortcut())observer.disconnect();});
    observer.observe(document.getElementById('page-master')||document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),10000);
  }

  refresh();
  timer=setInterval(()=>{if(document.visibilityState==='visible'&&document.getElementById('page-loggerTrend')?.classList.contains('active'))refresh();},1500);
})();