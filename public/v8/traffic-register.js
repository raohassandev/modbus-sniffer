'use strict';

(() => {
  const ROW_HEIGHT = 36;
  const trafficState = { events: [], stats: null, selectedId: null, frozen: false, inspectorTab: 'decoded', refreshTimer: null };
  const registerState = { points: [], selectedKey: null, interpretations: [], refreshTimer: null };
  const $ = (selector, root = document) => root.querySelector(selector);

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/v8/traffic-register.css';
  document.head.appendChild(style);

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error?.message || `Request failed (${response.status})`);
      error.code = payload?.error?.code || `HTTP_${response.status}`;
      throw error;
    }
    return payload;
  }

  function toast(message, kind = 'success') {
    const host = $('#toastHost');
    if (!host) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    host.appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function trafficWorkspaceHtml() {
    return `<section id="workspace-traffic" class="workspace traffic-workspace" aria-labelledby="trafficTitle">
      <div class="workspace-header"><div><h1 id="trafficTitle">Unified Traffic</h1><p>Live bounded evidence across Master, Simulator, Discovery and shared runtime events.</p></div>
        <div class="traffic-toolbar"><button id="trafficFreeze" class="button secondary traffic-freeze" type="button">Freeze view</button><label class="check-field"><input id="trafficFreezeOnError" type="checkbox"><span>Freeze on error</span></label><button id="trafficRefresh" class="button secondary" type="button">Refresh</button><button id="trafficClear" class="button destructive" type="button">Clear live view</button></div></div>
      <div class="metric-strip"><div class="metric-card"><span class="metric-label">Retained</span><strong id="trafficRetained" class="traffic-metric-value">0</strong></div><div class="metric-card"><span class="metric-label">Tx</span><strong id="trafficTx">0</strong></div><div class="metric-card"><span class="metric-label">Rx</span><strong id="trafficRx">0</strong></div><div class="metric-card"><span class="metric-label">Errors</span><strong id="trafficErrors">0</strong></div><div class="metric-card"><span class="metric-label">Dropped</span><strong id="trafficDropped">0</strong></div></div>
      <div class="panel"><div class="traffic-filter">
        <label class="field"><span>Connection</span><input id="trafficConnection" class="text-input" placeholder="All"></label>
        <label class="field"><span>Mode</span><select id="trafficMode"><option value="">All</option><option>master</option><option>slave</option><option>discovery</option><option>proxy</option><option>analyzer</option><option>test</option><option>replay</option></select></label>
        <label class="field"><span>Direction</span><select id="trafficDirection"><option value="">Both</option><option value="tx">Tx</option><option value="rx">Rx</option></select></label>
        <label class="field"><span>Unit</span><input id="trafficUnit" class="text-input" type="number" min="0" max="255" placeholder="All"></label>
        <label class="field"><span>FC</span><input id="trafficFc" class="text-input" type="number" min="1" max="255" placeholder="All"></label>
        <label class="field"><span>Raw HEX</span><input id="trafficHex" class="text-input mono" placeholder="03 00 10"></label>
        <label class="field wide"><span>Text</span><input id="trafficText" class="text-input" placeholder="type, source, details…"></label>
        <label class="check-field"><input id="trafficErrorOnly" type="checkbox"><span>Errors only</span></label><label class="check-field"><input id="trafficBookmarksOnly" type="checkbox"><span>Bookmarks only</span></label>
      </div></div>
      <div class="traffic-split">
        <div class="panel"><div class="traffic-head"><span>★</span><span>Time</span><span>Connection</span><span>Mode</span><span>Dir</span><span>Unit/FC</span><span>Event</span><span>Raw HEX</span></div><div id="trafficViewport" class="traffic-viewport"><div id="trafficSpacer" class="traffic-spacer"><div id="trafficWindow" class="traffic-window"></div></div></div></div>
        <aside class="panel traffic-inspector"><div class="panel-title-row"><div><h2>Evidence inspector</h2><p id="trafficSelectedLabel">Select an event.</p></div><div class="row-actions"><button id="trafficPrevError" class="button small secondary" type="button">← Error</button><button id="trafficNextError" class="button small secondary" type="button">Error →</button></div></div><div class="traffic-inspector-tabs"><button class="button small secondary active" data-traffic-tab="decoded" type="button">Decoded</button><button class="button small secondary" data-traffic-tab="raw" type="button">Raw</button><button class="button small secondary" data-traffic-tab="timing" type="button">Timing</button></div><div id="trafficInspectorBody" class="compact-empty">No event selected.</div><div class="card-actions"><button id="trafficCopyHex" class="button small secondary" type="button">Copy HEX</button><button id="trafficCopyPdu" class="button small secondary" type="button">Copy PDU</button><button id="trafficCopyJson" class="button small secondary" type="button">Copy JSON</button></div></aside>
      </div></section>`;
  }

  function registerWorkspaceHtml() {
    return `<section id="workspace-registerLab" class="workspace register-lab-workspace" aria-labelledby="registerLabTitle">
      <div class="workspace-header"><div><h1 id="registerLabTitle">Register Lab</h1><p>Live register sources, interpretation matrix and reusable engineering definitions.</p></div><div class="register-toolbar"><button id="registerRefresh" class="button secondary" type="button">Refresh</button></div></div>
      <div class="metric-strip"><div class="metric-card"><span class="metric-label">Live points</span><strong id="registerMetricPoints">0</strong></div><div class="metric-card"><span class="metric-label">Definitions</span><strong id="registerMetricDefinitions">0</strong></div><div class="metric-card"><span class="metric-label">Connections</span><strong id="registerMetricConnections">0</strong></div><div class="metric-card"><span class="metric-label">Writable now</span><strong id="registerMetricWritable">0</strong></div></div>
      <div class="panel"><div class="traffic-filter"><label class="field"><span>Connection</span><input id="registerConnection" class="text-input" placeholder="All"></label><label class="field"><span>Unit</span><input id="registerUnit" class="text-input" type="number" min="0" max="255" placeholder="All"></label><label class="field"><span>Area</span><select id="registerArea"><option value="">All</option><option value="coils">Coils</option><option value="discreteInputs">Discrete Inputs</option><option value="holdingRegisters">Holding Registers</option><option value="inputRegisters">Input Registers</option></select></label><label class="field wide"><span>Search</span><input id="registerText" class="text-input" placeholder="name, address, unit…"></label></div></div>
      <div class="register-layout"><div class="panel register-table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Area</th><th>Address</th><th>Raw</th><th>Engineering</th><th>Quality</th><th>Updated</th></tr></thead><tbody id="registerBody"></tbody></table><div id="registerEmpty" class="compact-empty">No live register values yet. Run a Master read or simulator exchange.</div></div>
      <aside class="panel"><div class="panel-title-row"><div><h2>Interpret & define</h2><p id="registerSelectedLabel">Select a register source.</p></div><span id="registerWriteState" class="status-chip safe">READ ONLY</span></div><h3>Interpretation matrix</h3><div id="interpretationGrid" class="interpretation-grid"><div class="compact-empty">No source selected.</div></div><h3>Engineering definition</h3><form id="registerDefinitionForm" class="definition-form"><label class="field"><span>Name</span><input id="regDefName" class="text-input"></label><label class="field"><span>Type</span><select id="regDefType"><option>uint16</option><option>int16</option><option>uint32</option><option>int32</option><option>float32</option><option>uint64</option><option>int64</option><option>float64</option><option>ascii2</option><option>ascii4</option><option>ascii8</option><option>bool</option></select></label><label class="field"><span>Byte order</span><input id="regDefOrder" class="text-input mono" placeholder="ABCD"></label><label class="field"><span>Unit</span><input id="regDefUnit" class="text-input" placeholder="V, A, kW…"></label><label class="field"><span>Scale</span><input id="regDefScale" class="text-input" type="number" step="any" value="1"></label><label class="field"><span>Offset</span><input id="regDefOffset" class="text-input" type="number" step="any" value="0"></label><label class="field"><span>Precision</span><input id="regDefPrecision" class="text-input" type="number" min="0" max="12" value="3"></label><label class="field"><span>Min / Max</span><div class="input-action"><input id="regDefMin" class="text-input" type="number" step="any" placeholder="Min"><input id="regDefMax" class="text-input" type="number" step="any" placeholder="Max"></div></label><label class="field full"><span>Enum JSON</span><textarea id="regDefEnum" class="text-input mono" placeholder='{"0":"Off","1":"On"}'></textarea></label><label class="field full"><span>Bitfield JSON</span><textarea id="regDefBits" class="text-input mono" placeholder='{"0":"Ready","1":"Fault"}'></textarea></label><label class="field full"><span>Notes</span><textarea id="regDefNotes" class="text-input"></textarea></label><div class="card-actions full"><button id="regDefSave" class="button primary" type="submit">Save definition</button><button id="regDefDelete" class="button destructive" type="button">Remove definition</button></div></form><h3>Provenance</h3><div id="registerProvenance" class="provenance-list">—</div></aside></div></section>`;
  }

  function install() {
    const host = $('.workspace-host');
    if (!host) return;
    if (!$('#workspace-traffic')) host.insertAdjacentHTML('beforeend', trafficWorkspaceHtml());
    if (!$('#workspace-registerLab')) host.insertAdjacentHTML('beforeend', registerWorkspaceHtml());
  }

  function activate(name) {
    document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.workspace === name));
    document.querySelectorAll('.workspace').forEach((node) => node.classList.remove('active'));
    $(`#workspace-${name}`)?.classList.add('active');
  }

  function trafficQuery() {
    const params = new URLSearchParams({ limit: '5000' });
    const pairs = [['connectionId','#trafficConnection'],['ownerMode','#trafficMode'],['direction','#trafficDirection'],['unitId','#trafficUnit'],['functionCode','#trafficFc'],['rawSearch','#trafficHex'],['text','#trafficText']];
    for (const [name, selector] of pairs) { const value = $(selector)?.value?.trim(); if (value) params.set(name, value); }
    if ($('#trafficErrorOnly')?.checked) params.set('errorOnly', 'true');
    if ($('#trafficBookmarksOnly')?.checked) params.set('bookmarkedOnly', 'true');
    return params;
  }

  async function refreshTraffic({ force = false } = {}) {
    if (trafficState.frozen && !force) return;
    const result = await api(`/api/v8/traffic?${trafficQuery()}`);
    trafficState.events = result.events || [];
    trafficState.stats = result.stats || {};
    if (trafficState.selectedId && !trafficState.events.some((event) => event.eventId === trafficState.selectedId)) trafficState.selectedId = null;
    renderTrafficMetrics(); renderTrafficWindow(); renderTrafficInspector();
  }

  function renderTrafficMetrics() {
    const stats = trafficState.stats || {};
    $('#trafficRetained').textContent = String(stats.retained || 0); $('#trafficTx').textContent = String(stats.tx || 0); $('#trafficRx').textContent = String(stats.rx || 0); $('#trafficErrors').textContent = String(stats.errors || 0); $('#trafficDropped').textContent = String(stats.dropped || 0);
    const button = $('#trafficFreeze');
    button.textContent = trafficState.frozen ? 'Resume view' : 'Freeze view';
    button.classList.toggle('active', trafficState.frozen);
  }

  function renderTrafficWindow() {
    const viewport = $('#trafficViewport'); const spacer = $('#trafficSpacer'); const host = $('#trafficWindow');
    if (!viewport || !host) return;
    spacer.style.height = `${trafficState.events.length * ROW_HEIGHT}px`;
    const visible = Math.ceil(viewport.clientHeight / ROW_HEIGHT) + 12;
    const start = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - 6);
    const end = Math.min(trafficState.events.length, start + visible);
    host.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
    host.replaceChildren(...trafficState.events.slice(start, end).map(trafficRow));
  }

  function trafficRow(event) {
    const row = document.createElement('div');
    row.className = `traffic-row${event.error ? ' error' : ''}${event.eventId === trafficState.selectedId ? ' selected' : ''}`;
    row.dataset.eventId = event.eventId;
    const star = document.createElement('button'); star.type = 'button'; star.className = `bookmark-button${event.bookmark ? ' active' : ''}`; star.dataset.bookmarkEvent = event.eventId; star.textContent = event.bookmark ? '★' : '☆'; star.title = 'Bookmark evidence';
    const values = [new Date(event.timestamp).toLocaleTimeString(undefined,{hour12:false,fractionalSecondDigits:3}), event.connectionId || event.channelId || '—', String(event.ownerMode || event.source || '—').toUpperCase(), event.direction?.toUpperCase() || '—', `${event.unitId ?? '—'}/${event.functionCode == null ? '—' : `FC${String(event.functionCode).padStart(2,'0')}`}`, event.type, event.rawHex || '—'];
    row.appendChild(star);
    values.forEach((value, index) => { const cell = document.createElement('span'); cell.textContent = value; if ([6].includes(index)) cell.className = 'mono'; cell.title = value; row.appendChild(cell); });
    return row;
  }

  function selectedTraffic() { return trafficState.events.find((event) => event.eventId === trafficState.selectedId) || null; }
  function renderTrafficInspector() {
    const event = selectedTraffic();
    $('[data-traffic-tab="decoded"]')?.classList.toggle('active', trafficState.inspectorTab === 'decoded'); $('[data-traffic-tab="raw"]')?.classList.toggle('active', trafficState.inspectorTab === 'raw'); $('[data-traffic-tab="timing"]')?.classList.toggle('active', trafficState.inspectorTab === 'timing');
    if (!event) { $('#trafficSelectedLabel').textContent = 'Select an event.'; $('#trafficInspectorBody').innerHTML = '<div class="compact-empty">No event selected.</div>'; return; }
    $('#trafficSelectedLabel').textContent = `#${event.sequence} · ${event.type}`;
    if (trafficState.inspectorTab === 'raw') $('#trafficInspectorBody').innerHTML = `<pre class="code-block traffic-hex">${esc(event.rawHex || 'No raw payload')}</pre>`;
    else if (trafficState.inspectorTab === 'timing') $('#trafficInspectorBody').innerHTML = `<dl class="details-list"><div><dt>Timestamp</dt><dd>${esc(new Date(event.timestamp).toISOString())}</dd></div><div><dt>RTT</dt><dd>${esc(event.details?.rttMs == null ? '—' : `${event.details.rttMs} ms`)}</dd></div><div><dt>Sequence</dt><dd>${event.sequence}</dd></div><div><dt>Transaction</dt><dd>${esc(event.details?.transactionId ?? '—')}</dd></div></dl>`;
    else $('#trafficInspectorBody').innerHTML = `<dl class="details-list"><div><dt>Source</dt><dd>${esc(event.source)}</dd></div><div><dt>Connection</dt><dd>${esc(event.connectionId || '—')}</dd></div><div><dt>Mode</dt><dd>${esc(event.ownerMode || '—')}</dd></div><div><dt>Direction</dt><dd>${esc(event.direction || '—')}</dd></div><div><dt>Unit / FC</dt><dd>${esc(`${event.unitId ?? '—'} / ${event.functionCode ?? '—'}`)}</dd></div><div><dt>Status</dt><dd>${event.error ? 'ERROR' : 'OK'}</dd></div></dl><pre class="code-block">${esc(JSON.stringify(event.details || {}, null, 2))}</pre>`;
  }

  function extractPdu(event) {
    const raw = String(event?.rawHex || ''); const framing = String(event?.details?.framing || '').toLowerCase();
    if (framing === 'tcp' && raw.length >= 14) return raw.slice(14);
    if (framing === 'rtu' && raw.length >= 6) return raw.slice(2, -4);
    return raw;
  }

  async function copyText(text) { if (!text) return; await navigator.clipboard.writeText(text); toast('Copied'); }
  async function toggleBookmark(eventId) { const event = trafficState.events.find((entry) => entry.eventId === eventId); if (!event) return; if (event.bookmark) await api(`/api/v8/traffic/events/${encodeURIComponent(eventId)}/bookmark`, { method:'DELETE' }); else await api(`/api/v8/traffic/events/${encodeURIComponent(eventId)}/bookmark`, { method:'POST', body:'{}' }); await refreshTraffic({ force:true }); }
  function navigateError(step) { const errors = trafficState.events.filter((event) => event.error); if (!errors.length) return; const index = errors.findIndex((event) => event.eventId === trafficState.selectedId); const next = index < 0 ? (step > 0 ? 0 : errors.length - 1) : (index + step + errors.length) % errors.length; trafficState.selectedId = errors[next].eventId; const fullIndex = trafficState.events.findIndex((event) => event.eventId === trafficState.selectedId); $('#trafficViewport').scrollTop = Math.max(0, fullIndex * ROW_HEIGHT - ROW_HEIGHT * 3); renderTrafficWindow(); renderTrafficInspector(); }

  function registerQuery() { const params = new URLSearchParams({limit:'5000'}); for (const [name, selector] of [['connectionId','#registerConnection'],['unitId','#registerUnit'],['area','#registerArea'],['text','#registerText']]) { const value = $(selector)?.value?.trim(); if (value) params.set(name,value); } return params; }
  async function refreshRegisters() { const result = await api(`/api/v8/register-lab?${registerQuery()}`); registerState.points = result.points || []; if (registerState.selectedKey && !registerState.points.some((point) => point.sourceKey === registerState.selectedKey)) registerState.selectedKey = null; renderRegisterMetrics(result.definitions || {}); renderRegisterRows(); await renderRegisterSelection(); }
  function renderRegisterMetrics(definitions) { $('#registerMetricPoints').textContent=String(registerState.points.length); $('#registerMetricDefinitions').textContent=String(Object.keys(definitions).length); $('#registerMetricConnections').textContent=String(new Set(registerState.points.map((p)=>p.connectionId)).size); $('#registerMetricWritable').textContent=String(registerState.points.filter((p)=>p.writeAccess?.allowed).length); }
  function renderRegisterRows() { const body=$('#registerBody'); body.replaceChildren(...registerState.points.map((point)=>{const tr=document.createElement('tr');tr.className=`register-row${point.sourceKey===registerState.selectedKey?' selected':''}`;tr.dataset.sourceKey=point.sourceKey;const engineering=point.engineering?.available?`${point.engineering.display}${point.engineering.unit?` ${point.engineering.unit}`:''}`:'—';const cells=[`${point.definition?.name||`Unit ${point.unitId}`}\n${point.connectionId}`,point.area,point.address,String(point.rawValue),engineering,point.quality,new Date(point.lastSeen).toLocaleTimeString()];cells.forEach((value,index)=>{const td=document.createElement('td');if(index===0){td.className='register-source';const lines=String(value).split('\n');td.innerHTML=`<strong>${esc(lines[0])}</strong><small>${esc(lines[1])}</small>`;}else{td.textContent=value;if([2,3,4].includes(index))td.className='register-value';if(index===4&&point.engineering?.outOfLimits)td.classList.add('out');}tr.appendChild(td);});return tr;})); $('#registerEmpty').hidden=registerState.points.length!==0; }
  function selectedPoint(){return registerState.points.find((p)=>p.sourceKey===registerState.selectedKey)||null;}
  async function renderRegisterSelection(){const point=selectedPoint();if(!point){$('#registerSelectedLabel').textContent='Select a register source.';$('#interpretationGrid').innerHTML='<div class="compact-empty">No source selected.</div>';$('#registerProvenance').textContent='—';$('#registerWriteState').textContent='READ ONLY';$('#registerWriteState').className='status-chip safe';return;} $('#registerSelectedLabel').textContent=`${point.connectionId} · Unit ${point.unitId} · ${point.area} ${point.address}`; $('#registerWriteState').textContent=point.writeAccess?.allowed?'WRITE READY':'READ ONLY';$('#registerWriteState').className=`status-chip ${point.writeAccess?.allowed?'danger':'safe'}`;const response=await api(`/api/v8/register-lab/${encodeURIComponent(point.sourceKey)}/interpretations`);registerState.interpretations=response.interpretations||[];$('#interpretationGrid').replaceChildren(...registerState.interpretations.map((entry)=>{const card=document.createElement('button');card.type='button';card.className='interpretation-card';card.dataset.type=entry.type;card.dataset.order=entry.byteOrder||'';card.innerHTML=`<strong>${esc(entry.value)}</strong><span>${esc(entry.type)} · ${esc(entry.byteOrder||'native')} · ${entry.words} word${entry.words===1?'':'s'}</span>`;return card;})); fillDefinition(point.definition);$('#registerProvenance').innerHTML=`<span>Request: <code>${esc(point.requestEventId||'—')}</code></span><span>Response: <code>${esc(point.responseEventId||'—')}</code></span><span>Samples: ${point.sampleCount}</span><span>First seen: ${esc(new Date(point.firstSeen).toISOString())}</span><span>Last change: ${esc(new Date(point.changedAt).toISOString())}</span>`; }
  function fillDefinition(definition){const d=definition||{};$('#regDefName').value=d.name||'';$('#regDefType').value=d.type||'uint16';$('#regDefOrder').value=d.byteOrder||'';$('#regDefUnit').value=d.unit||'';$('#regDefScale').value=String(d.scale??1);$('#regDefOffset').value=String(d.offset??0);$('#regDefPrecision').value=String(d.precision??3);$('#regDefMin').value=d.limits?.min??'';$('#regDefMax').value=d.limits?.max??'';$('#regDefEnum').value=Object.keys(d.enum||{}).length?JSON.stringify(d.enum,null,2):'';$('#regDefBits').value=Object.keys(d.bitfield||{}).length?JSON.stringify(d.bitfield,null,2):'';$('#regDefNotes').value=d.notes||'';}
  function parseJsonField(selector){const text=$(selector).value.trim();if(!text)return{};const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JSON field must contain an object');return value;}
  async function saveDefinition(event){event.preventDefault();const point=selectedPoint();if(!point)throw new Error('Select a register source first');const payload={name:$('#regDefName').value.trim(),type:$('#regDefType').value,byteOrder:$('#regDefOrder').value.trim()||null,unit:$('#regDefUnit').value.trim(),scale:Number($('#regDefScale').value),offset:Number($('#regDefOffset').value),precision:Number($('#regDefPrecision').value),limits:{min:$('#regDefMin').value===''?null:Number($('#regDefMin').value),max:$('#regDefMax').value===''?null:Number($('#regDefMax').value)},enum:parseJsonField('#regDefEnum'),bitfield:parseJsonField('#regDefBits'),notes:$('#regDefNotes').value,provenance:{requestEventId:point.requestEventId,responseEventId:point.responseEventId}};await api(`/api/v8/register-lab/${encodeURIComponent(point.sourceKey)}/definition`,{method:'PUT',body:JSON.stringify(payload)});toast('Register definition saved');await refreshRegisters();}
  async function removeDefinition(){const point=selectedPoint();if(!point||!point.definition)return;await api(`/api/v8/register-lab/${encodeURIComponent(point.sourceKey)}/definition`,{method:'DELETE'});toast('Register definition removed');await refreshRegisters();}

  function showTraffic(event){event?.stopPropagation();activate('traffic');refreshTraffic({force:true}).catch((error)=>toast(error.message,'error'));}
  function showRegister(event){event?.stopPropagation();activate('registerLab');refreshRegisters().catch((error)=>toast(error.message,'error'));}
  function scheduleLiveRefresh(payload){const event=payload?.event;if ($('#trafficFreezeOnError')?.checked && event && (event.error || /error|timeout|exception|malformed/i.test(String(event.type||'')))) { trafficState.frozen=true;renderTrafficMetrics(); }
    if ($('#workspace-traffic')?.classList.contains('active')&&!trafficState.frozen){clearTimeout(trafficState.refreshTimer);trafficState.refreshTimer=setTimeout(()=>refreshTraffic().catch(()=>undefined),120);} if ($('#workspace-registerLab')?.classList.contains('active')){clearTimeout(registerState.refreshTimer);registerState.refreshTimer=setTimeout(()=>refreshRegisters().catch(()=>undefined),180);}}
  function connectSocket(){try{const scheme=location.protocol==='https:'?'wss':'ws';const ws=new WebSocket(`${scheme}://${location.host}/ws/v8`);ws.addEventListener('message',(message)=>{try{const payload=JSON.parse(message.data);if(payload.type==='runtime.event')scheduleLiveRefresh(payload);}catch{/* ignore malformed UI event */}});ws.addEventListener('close',()=>setTimeout(connectSocket,1500));}catch{/* polling remains available */}}

  function bind(){document.querySelector('.nav-item[data-workspace="traffic"]')?.addEventListener('click',showTraffic);document.querySelector('.nav-item[data-workspace="registerLab"]')?.addEventListener('click',showRegister);$('#trafficViewport')?.addEventListener('scroll',renderTrafficWindow);$('#trafficWindow')?.addEventListener('click',(event)=>{const bookmark=event.target.closest('[data-bookmark-event]');if(bookmark){event.stopPropagation();toggleBookmark(bookmark.dataset.bookmarkEvent).catch((error)=>toast(error.message,'error'));return;}const row=event.target.closest('[data-event-id]');if(row){trafficState.selectedId=row.dataset.eventId;renderTrafficWindow();renderTrafficInspector();}});$('#trafficFreeze')?.addEventListener('click',()=>{trafficState.frozen=!trafficState.frozen;renderTrafficMetrics();if(!trafficState.frozen)refreshTraffic({force:true}).catch(()=>undefined);});$('#trafficRefresh')?.addEventListener('click',()=>refreshTraffic({force:true}).catch((error)=>toast(error.message,'error')));$('#trafficClear')?.addEventListener('click',async()=>{if(!confirm('Clear the bounded live Traffic and Register Lab view?'))return;await api('/api/v8/traffic',{method:'DELETE'});trafficState.selectedId=null;await refreshTraffic({force:true});});for(const id of ['trafficConnection','trafficMode','trafficDirection','trafficUnit','trafficFc','trafficHex','trafficText','trafficErrorOnly','trafficBookmarksOnly'])$(`#${id}`)?.addEventListener('input',()=>{clearTimeout(trafficState.refreshTimer);trafficState.refreshTimer=setTimeout(()=>refreshTraffic({force:true}).catch(()=>undefined),160);});document.querySelectorAll('[data-traffic-tab]').forEach((button)=>button.addEventListener('click',()=>{trafficState.inspectorTab=button.dataset.trafficTab;renderTrafficInspector();}));$('#trafficPrevError')?.addEventListener('click',()=>navigateError(-1));$('#trafficNextError')?.addEventListener('click',()=>navigateError(1));$('#trafficCopyHex')?.addEventListener('click',()=>copyText(selectedTraffic()?.rawHex).catch(()=>undefined));$('#trafficCopyPdu')?.addEventListener('click',()=>copyText(extractPdu(selectedTraffic())).catch(()=>undefined));$('#trafficCopyJson')?.addEventListener('click',()=>copyText(JSON.stringify(selectedTraffic(),null,2)).catch(()=>undefined));$('#registerBody')?.addEventListener('click',(event)=>{const row=event.target.closest('[data-source-key]');if(row){registerState.selectedKey=row.dataset.sourceKey;renderRegisterRows();renderRegisterSelection().catch((error)=>toast(error.message,'error'));}});$('#registerRefresh')?.addEventListener('click',()=>refreshRegisters().catch((error)=>toast(error.message,'error')));for(const id of ['registerConnection','registerUnit','registerArea','registerText'])$(`#${id}`)?.addEventListener('input',()=>{clearTimeout(registerState.refreshTimer);registerState.refreshTimer=setTimeout(()=>refreshRegisters().catch(()=>undefined),180);});$('#interpretationGrid')?.addEventListener('click',(event)=>{const card=event.target.closest('[data-type]');if(card){$('#regDefType').value=card.dataset.type;$('#regDefOrder').value=card.dataset.order||'';}});$('#registerDefinitionForm')?.addEventListener('submit',(event)=>saveDefinition(event).catch((error)=>toast(error.message,'error')));$('#regDefDelete')?.addEventListener('click',()=>removeDefinition().catch((error)=>toast(error.message,'error')));}

  install();bind();connectSocket();
})();
