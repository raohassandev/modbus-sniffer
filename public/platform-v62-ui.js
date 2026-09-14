'use strict';

(()=>{
  const THEME_KEY='modbus-analyzer-theme';
  const root=document.documentElement;
  const cssLink=document.createElement('link');cssLink.rel='stylesheet';cssLink.href='/platform-v62.css?v=20260914-1';document.head.appendChild(cssLink);
  const colorMeta=document.querySelector('meta[name="color-scheme"]');if(colorMeta)colorMeta.content='light dark';

  const enc=v=>encodeURIComponent(String(v??'')),dec=v=>decodeURIComponent(String(v??''));
  const deviceUnit=d=>Number(d?.unitId??d?.slaveId);
  const deviceLabel=d=>`${d?.transport==='TCP'?'Unit':'Slave'} ${deviceUnit(d)}`;
  const channelLabel=d=>d?.channelName||d?.channel?.name||d?.channelId||d?.transport||'Unknown channel';
  const deviceContext=d=>`${d?.transport||'RTU'} · ${channelLabel(d)}`;
  const deviceKeyOf=d=>d?.deviceKey||((d?.channelId&&Number.isInteger(deviceUnit(d)))?`${d.channelId}|${deviceUnit(d)}`:String(deviceUnit(d)));
  const findDevice=key=>state.devices.find(d=>deviceKeyOf(d)===key)||null;
  const txDevice=t=>({transport:t?.transport||'RTU',channelId:t?.channelId,channelName:t?.channel?.name,unitId:t?.unitId??t?.slaveId,slaveId:t?.unitId??t?.slaveId,deviceKey:t?.deviceKey});

  function requestedTheme(){const v=localStorage.getItem(THEME_KEY);return ['system','light','dark'].includes(v)?v:'system';}
  function resolvedTheme(mode){return mode==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):mode;}
  function applyTheme(mode=requestedTheme()){
    localStorage.setItem(THEME_KEY,mode);root.dataset.themeMode=mode;root.dataset.theme=resolvedTheme(mode);
    document.querySelectorAll('[data-theme-mode]').forEach(b=>b.classList.toggle('active',b.dataset.themeMode===mode));
    requestAnimationFrame(()=>{try{renderStatus();}catch{}});
  }
  function installThemeControl(){
    const host=document.querySelector('.top-actions');if(!host||host.querySelector('.theme-control'))return;
    const control=document.createElement('div');control.className='theme-control';control.setAttribute('aria-label','Appearance');
    control.innerHTML='<button type="button" data-theme-mode="system" title="Follow system theme">Auto</button><button type="button" data-theme-mode="light" title="Light theme">☀</button><button type="button" data-theme-mode="dark" title="Dark theme">☾</button>';
    control.addEventListener('click',e=>{const b=e.target.closest('[data-theme-mode]');if(b)applyTheme(b.dataset.themeMode);});
    host.insertBefore(control,host.firstChild);applyTheme();
  }
  const mq=matchMedia('(prefers-color-scheme: light)');mq.addEventListener?.('change',()=>{if(requestedTheme()==='system')applyTheme('system');});

  try{
    pageMeta.dashboard=['Dashboard','Live Modbus RTU / TCP engineering visibility'];
    pageMeta.devices=['Devices','Transport-aware devices, polling groups and registers'];
    pageMeta.traffic=['Live Traffic','Decoded RTU/TCP requests, responses, exceptions and missing replies'];
    pageMeta.analysis=['Analysis','Transport-aware timing, polling cadence, latency and protocol health'];
    pageMeta.registers=['Registers','Discovered values isolated by channel and Unit/Slave ID'];
    pageMeta.decoder=['Decoder','16/32/64-bit register analysis by transport-aware device'];
  }catch{}

  const oldSetupCanvas=setupCanvas;
  setupCanvas=function(canvas){
    if(!canvas)return null;
    const ratio=Math.min(window.devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();
    const w=Math.max(300,Math.floor(rect.width||canvas.parentElement?.clientWidth||600));
    const h=Math.max(180,Math.min(300,Math.floor(rect.height||240)));
    const pw=Math.floor(w*ratio),ph=Math.floor(h*ratio);
    if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return{ctx,w,h};
  };
  drawLine=function(canvas,timeline){
    const c=setupCanvas(canvas);if(!c)return;const{ctx,w,h}=c,p={l:36,r:12,t:14,b:25};
    const styles=getComputedStyle(root),grid=styles.getPropertyValue('--chart-grid').trim()||'#233142',axis=styles.getPropertyValue('--chart-axis').trim()||'#718195',line=styles.getPropertyValue('--chart-line').trim()||'#36d399',fillTop=styles.getPropertyValue('--chart-fill-top').trim()||'rgba(54,211,153,.22)',fillBottom=styles.getPropertyValue('--chart-fill-bottom').trim()||'rgba(54,211,153,0)';
    ctx.clearRect(0,0,w,h);ctx.font='9px system-ui';ctx.fillStyle=axis;ctx.strokeStyle=grid;
    const points=[],now=Math.floor(Date.now()/1000)*1000,by=new Map((timeline||[]).map(x=>[Number(x.timestamp),Number(x.frames||0)]));for(let i=59;i>=0;i--)points.push({v:by.get(now-i*1000)||0});
    const max=Math.max(5,...points.map(x=>x.v));for(let i=0;i<=4;i++){const y=p.t+(h-p.t-p.b)*i/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillText(String(Math.round(max*(1-i/4))),4,y+3);}
    const xo=i=>p.l+i*(w-p.l-p.r)/(points.length-1),yo=v=>p.t+(1-v/max)*(h-p.t-p.b),grad=ctx.createLinearGradient(0,p.t,0,h-p.b);grad.addColorStop(0,fillTop);grad.addColorStop(1,fillBottom);
    ctx.beginPath();points.forEach((x,i)=>i?ctx.lineTo(xo(i),yo(x.v)):ctx.moveTo(xo(i),yo(x.v)));ctx.lineTo(xo(points.length-1),h-p.b);ctx.lineTo(xo(0),h-p.b);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
    ctx.beginPath();points.forEach((x,i)=>i?ctx.lineTo(xo(i),yo(x.v)):ctx.moveTo(xo(i),yo(x.v)));ctx.strokeStyle=line;ctx.lineWidth=1.7;ctx.stroke();ctx.fillStyle=axis;ctx.fillText('-60s',p.l,h-7);ctx.fillText('now',w-p.r-20,h-7);
  };

  function channelOptions(selected='',allLabel='All channels'){
    const channels=state.status?.channels||[];return `<option value="">${allLabel}</option>`+channels.map(c=>`<option value="${esc(c.channelId)}" ${c.channelId===selected?'selected':''}>${esc(c.transport)} · ${esc(c.name||c.endpoint||c.channelId)}</option>`).join('');
  }
  function refreshChannelSelectors(){
    for(const id of ['trafficChannel','regChannel']){const s=document.getElementById(id);if(!s)continue;const old=s.value;s.innerHTML=channelOptions(old);if([...s.options].some(o=>o.value===old))s.value=old;}
  }
  function installChannelFilters(){
    const tf=document.querySelector('#page-traffic .filters');if(tf&&!document.getElementById('trafficChannel')){const l=document.createElement('label');l.textContent='Channel';l.className='v62-channel-filter';l.innerHTML+=' <select id="trafficChannel"></select>';tf.insertBefore(l,tf.firstChild);l.querySelector('select').addEventListener('change',renderTraffic);}
    const rf=document.querySelector('#page-registers .filters');if(rf&&!document.getElementById('regChannel')){const l=document.createElement('label');l.textContent='Channel';l.className='v62-channel-filter';l.innerHTML+=' <select id="regChannel"></select>';rf.insertBefore(l,rf.firstChild);l.querySelector('select').addEventListener('change',refreshRegisters);}
    refreshChannelSelectors();
  }

  const baseTrafficFilters=trafficFilters;
  trafficFilters=function(){const f=baseTrafficFilters();f.channelId=document.getElementById('trafficChannel')?.value||'';return f;};
  filteredTransactions=function(){const f=trafficFilters();return state.transactions.filter(t=>{if(f.channelId&&t.channelId!==f.channelId)return false;if(f.slave&&Number(t.unitId??t.slaveId)!==Number(f.slave))return false;if(f.fc&&t.functionCode!==Number(f.fc))return false;if(f.direction&&t.direction!==f.direction)return false;if(f.q&&!`${t.rawHex||''} ${t.functionName||''} ${t.exceptionName||''} ${t.deviceKey||''} ${detail(t)} ${JSON.stringify(t.decoded||{})}`.toLowerCase().includes(f.q))return false;return true;}).slice(-2000);};

  const baseRenderTraffic=renderTraffic;
  renderTraffic=function(){baseRenderTraffic();const rows=document.querySelectorAll('#trafficBody tr[data-packet]');rows.forEach(row=>{const t=state.transactions.find(x=>x.id===Number(row.dataset.packet));if(!t)return;const cell=row.children[3];if(cell)cell.innerHTML=`<strong>${esc(deviceLabel(txDevice(t)))}</strong><span class="device-context">${esc(t.transport||'RTU')} · ${esc(t.channel?.name||t.channelId||'')}</span>`;});const th=document.querySelector('#page-traffic thead th:nth-child(4)');if(th)th.textContent='Device';};
  const baseSelectPacket=selectPacket;
  selectPacket=function(id){baseSelectPacket(id);const t=state.transactions.find(x=>x.id===Number(id));if(!t)return;const grid=document.querySelector('#inspectorContent .inspect-grid');if(grid){grid.insertAdjacentHTML('afterbegin',`<div class="inspect-kv"><span>Transport</span><strong>${esc(t.transport||'RTU')}</strong></div><div class="inspect-kv"><span>Channel</span><strong>${esc(t.channel?.name||t.channelId||'—')}</strong></div>`);const slave=[...grid.querySelectorAll('.inspect-kv')].find(x=>x.querySelector('span')?.textContent==='Slave');if(slave){slave.querySelector('span').textContent=t.transport==='TCP'?'Unit ID':'Slave ID';slave.querySelector('strong').textContent=String(t.unitId??t.slaveId);}}document.querySelectorAll('#inspectorContent h3').forEach(h=>{if(h.textContent==='Raw RTU frame')h.textContent='Raw Modbus frame';});};

  const baseRenderStatus=renderStatus;
  renderStatus=function(){baseRenderStatus();refreshChannelSelectors();updateTransportChrome();};
  function updateTransportChrome(){
    const c=state.status?.connection||{},tr=state.status?.transports||{},rtu=Number(tr.RTU?.frames||0)>0,tcp=Number(tr.TCP?.frames||0)>0;
    const badge=document.querySelector('.passive-badge'),small=document.querySelector('.sidebar-foot small');if(!badge)return;
    let cls='rtu',label='RTU PASSIVE / RX ONLY',detailText='Analyzer does not transmit RTU frames';
    if(c.status==='replay'||c.status==='capture'){cls='replay';label=c.status==='replay'?'CAPTURE REPLAY':'OFFLINE CAPTURE';detailText='Offline analysis — no field transmission';}
    else if(rtu&&tcp){cls='mixed';label='MULTI-TRANSPORT';detailText='RTU passive + TCP inline analysis';}
    else if(tcp){cls='tcp';label='TCP INLINE ANALYZER';detailText='Forwards client bytes unchanged';}
    badge.className=`passive-badge transport-badge ${cls}`;badge.innerHTML=`<i></i>${label}`;if(small)small.textContent=detailText;
    const summary=document.getElementById('serialSummary');if(summary&&tcp&&!rtu&&c.status!=='replay'&&c.status!=='capture'){const ch=(state.status?.channels||[]).find(x=>x.transport==='TCP');summary.textContent=ch?.endpoint?`TCP · ${ch.endpoint}`:'Modbus TCP';}
  }

  const baseRenderDashboard=renderDashboard;
  renderDashboard=function(){baseRenderDashboard();const title=document.querySelector('#page-dashboard .grid-2.wide-left .panel:first-child .panel-head h2'),sub=document.querySelector('#page-dashboard .grid-2.wide-left .panel:first-child .panel-head p');if(title)title.textContent='Traffic activity';if(sub)sub.textContent='Valid Modbus frames per second · last 60 seconds';const rows=[...document.querySelectorAll('#dashboardDevices tr[data-dash-device]')],devices=state.devices.slice(0,12);rows.forEach((row,i)=>{const d=devices[i];if(!d)return;row.removeAttribute('data-dash-device');row.dataset.v62Device=enc(deviceKeyOf(d));const first=row.children[0];if(first)first.innerHTML=`<strong>${esc(deviceLabel(d))}</strong><span class="device-context">${esc(deviceContext(d))}</span>`;});const head=document.querySelector('#page-dashboard #dashboardDevices')?.closest('table')?.querySelector('th:first-child');if(head)head.textContent='Device';};

  renderDevices=function(){
    const list=$('deviceList');$('deviceCount').textContent=state.devices.length;
    list.innerHTML=state.devices.map(d=>{const key=deviceKeyOf(d);return `<div class="device-list-item ${state.selectedDevice===key?'active':''}" data-v62-device="${enc(key)}" tabindex="0"><div><strong>${esc(deviceLabel(d))}</strong><small>${esc(deviceContext(d))} · ${d.registerCount} regs · ${d.pollGroupCount} polls · ${ms(d.expectedPollIntervalMs)}</small></div>${statusChip(d)}</div>`;}).join('')||'<div class="empty-state">No devices detected.</div>';
    if(state.selectedDevice==null&&state.devices.length)openDevice(deviceKeyOf(state.devices[0]),false);
  };
  openDevice=async function(ref,navigate=true){const key=String(ref);state.selectedDevice=key;if(navigate)go('devices');renderDevices();$('deviceDetail').innerHTML='<article class="panel empty-state">Loading device analysis…</article>';try{state.deviceDetail=await api(`/api/devices/${enc(key)}`);renderDeviceDetail();}catch(err){$('deviceDetail').innerHTML=`<article class="panel empty-state">${esc(err.message)}</article>`;}};
  const baseRenderDeviceDetail=renderDeviceDetail;
  renderDeviceDetail=function(){baseRenderDeviceDetail();const s=state.deviceDetail?.summary;if(!s)return;const key=deviceKeyOf(s),h=document.querySelector('#deviceDetail .device-title h2');if(h&&h.firstChild)h.firstChild.nodeValue=`${deviceLabel(s)} `;const p=document.querySelector('#deviceDetail .device-title p');if(p)p.textContent=`${deviceContext(s)} · health ${s.healthScore}/100 · last seen ${ago(s.lastSeen)}`;document.querySelectorAll('#deviceDetail [data-device-traffic]').forEach(b=>{b.removeAttribute('data-device-traffic');b.dataset.v62Traffic=enc(key);});document.querySelectorAll('#deviceDetail [data-device-decoder]').forEach(b=>{b.removeAttribute('data-device-decoder');b.dataset.v62Decoder=enc(key);});document.querySelectorAll('#deviceDetail [data-decode-reg]').forEach(b=>{const a=b.dataset.decodeReg,f=b.dataset.decodeFc;b.removeAttribute('data-decode-reg');b.removeAttribute('data-decode-slave');b.dataset.v62Decode=`${enc(key)};${f};${a}`;});document.querySelectorAll('#deviceDetail h2').forEach(x=>{if(x.textContent.includes('Register groups'))x.nextElementSibling;});};

  const baseRenderAnalysis=renderAnalysis;
  renderAnalysis=function(){baseRenderAnalysis();const polls=state.analysis?.polls||[],prows=[...document.querySelectorAll('#analysisPolls tr[data-analysis-device]')];prows.forEach((row,i)=>{const p=polls[i];if(!p)return;row.removeAttribute('data-analysis-device');row.dataset.v62Device=enc(p.deviceKey||`${p.channelId}|${p.unitId??p.slaveId}`);const cell=row.children[0];if(cell)cell.innerHTML=`<strong>${esc(p.transport==='TCP'?'Unit '+(p.unitId??p.slaveId):'Slave '+(p.unitId??p.slaveId))}</strong><span class="device-context">${esc(p.transport||'RTU')} · ${esc(p.channelId||'')}</span>`;});const cards=[...document.querySelectorAll('#analysisDeviceCards [data-analysis-device]')];cards.forEach((card,i)=>{const d=state.devices[i];if(!d)return;card.removeAttribute('data-analysis-device');card.dataset.v62Device=enc(deviceKeyOf(d));const strong=card.querySelector('.device-card-head strong');if(strong)strong.textContent=deviceLabel(d);card.querySelector('.device-card-head')?.insertAdjacentHTML('beforeend',`<span class="channel-tag">${esc(channelLabel(d))}</span>`);});};

  refreshRegisters=async function(){const p=new URLSearchParams({limit:'10000'}),channel=document.getElementById('regChannel')?.value||'';if(channel)p.set('channelId',channel);if($('regSlave').value)p.set('unitId',$('regSlave').value);if($('regFc').value)p.set('fc',$('regFc').value);if($('regSearch').value)p.set('q',$('regSearch').value);try{state.registers=await api(`/api/registers?${p}`);renderRegisters();}catch(err){toast(err.message,true);}};
  renderRegisters=function(){
    $('registerCount').textContent=`${state.registers.length.toLocaleString()} registers`;
    $('registerBody').innerHTML=state.registers.map(r=>`<tr><td><strong>${esc(r.transport==='TCP'?'Unit '+(r.unitId??r.slaveId):'Slave '+(r.unitId??r.slaveId))}</strong><span class="device-context">${esc(r.transport||'RTU')} · ${esc(r.channelId||'')}</span></td><td>${r.functionCode}</td><td class="mono"><strong>${r.address}</strong></td><td class="mono">${num(r.lastValue)}</td><td class="mono muted">${esc(r.lastHex||'—')}</td><td>${num(r.min)}</td><td>${num(r.max)}</td><td>${r.reads}</td><td>${r.writes}</td><td>${r.changes}</td><td>${ms(r.pollIntervalMs)}</td><td><button class="ghost" data-v62-reg-decode="${enc(r.deviceKey)};${r.functionCode};${r.address}">Decode</button></td></tr>`).join('')||'<tr><td colspan="12" class="muted">No registers discovered for this filter.</td></tr>';
    const th=document.querySelector('#page-registers thead th:first-child');if(th)th.textContent='Device';
  };

  populateDecoderSlaves=function(){const select=$('decoderSlave'),current=select.value;select.innerHTML='<option value="">Select device…</option>'+state.devices.map(d=>`<option value="${esc(deviceKeyOf(d))}">${esc(deviceLabel(d))} — ${esc(channelLabel(d))}</option>`).join('');if(state.devices.some(d=>deviceKeyOf(d)===current))select.value=current;};
  openDecoder=function(deviceKey,fc,address){go('decoder');populateDecoderSlaves();$('decoderSlave').value=deviceKey;$('decoderFc').value=fc||'';$('decoderAddress').value=address;runDecoder();};
  runDecoder=async function(){const deviceKey=$('decoderSlave').value,address=$('decoderAddress').value;if(!deviceKey||address==='')return toast('Select a device and address.',true);const p=new URLSearchParams({deviceKey,address,count:$('decoderCount').value});if($('decoderFc').value)p.set('fc',$('decoderFc').value);try{const result=await api(`/api/decode?${p}`);$('decoderWords').className='word-grid';$('decoderWords').innerHTML=(result.words||[]).map(w=>`<div class="word-card"><span>Register +${w.index}</span><strong>${w.value}</strong><small>${w.hex}</small></div>`).join('')||'<div class="empty-state">No contiguous captured words are available from this address.</div>';$('decoderBody').innerHTML=(result.interpretations||[]).map(x=>{const scales=new Map((x.scales||[]).map(s=>[String(s.scale),s.value]));return `<tr><td><span class="score-pill">${x.score}</span></td><td><strong>${esc(x.type)}</strong></td><td class="mono">${esc(x.order)}</td><td class="decode-value">${esc(x.value)}</td><td class="decode-value">${esc(scales.get('0.1')??'—')}</td><td class="decode-value">${esc(scales.get('0.01')??'—')}</td><td class="decode-value">${esc(scales.get('0.001')??'—')}</td></tr>`;}).join('')||'<tr><td colspan="7" class="muted">Not enough contiguous words for decoding.</td></tr>';}catch(err){toast(err.message,true);}};

  document.addEventListener('click',e=>{
    const open=e.target.closest('[data-v62-device]');if(open){e.preventDefault();e.stopImmediatePropagation();openDevice(dec(open.dataset.v62Device));return;}
    const t=e.target.closest('[data-v62-traffic]');if(t){e.preventDefault();e.stopImmediatePropagation();const key=dec(t.dataset.v62Traffic),d=findDevice(key);if(d){const channel=document.getElementById('trafficChannel');if(channel)channel.value=d.channelId||'';$('trafficSlave').value=deviceUnit(d);go('traffic');renderTraffic();}return;}
    const d=e.target.closest('[data-v62-decoder]');if(d){e.preventDefault();e.stopImmediatePropagation();openDecoder(dec(d.dataset.v62Decoder),'','');return;}
    const x=e.target.closest('[data-v62-decode]');if(x){e.preventDefault();e.stopImmediatePropagation();const [key,fc,address]=x.dataset.v62Decode.split(';');openDecoder(dec(key),fc,address);return;}
    const r=e.target.closest('[data-v62-reg-decode]');if(r){e.preventDefault();e.stopImmediatePropagation();const [key,fc,address]=r.dataset.v62RegDecode.split(';');openDecoder(dec(key),fc,address);}
  },true);

  installThemeControl();installChannelFilters();
  const ro=new ResizeObserver(()=>{cancelAnimationFrame(ro.raf);ro.raf=requestAnimationFrame(()=>{try{renderStatus();}catch{}});});const canvas=document.getElementById('trafficChart');if(canvas)ro.observe(canvas.parentElement||canvas);
  window.addEventListener('hashchange',()=>{installChannelFilters();requestAnimationFrame(()=>{try{renderDashboard();if(location.hash==='#devices')renderDevices();if(location.hash==='#analysis')renderAnalysis();}catch{}});});
  setTimeout(()=>{installThemeControl();installChannelFilters();try{renderDashboard();renderDevices();renderAnalysis();renderRegisters();populateDecoderSlaves();}catch{}},50);
})();
