'use strict';

(()=>{
  const q=id=>document.getElementById(id),safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async url=>{const r=await fetch(url,{cache:'no-store'});const b=await r.json();if(!r.ok)throw new Error(b?.error||`HTTP ${r.status}`);return b;};
  const keyOf=x=>x?.deviceKey||(x?.channelId!=null&&(x?.unitId??x?.slaveId)!=null?`${x.channelId}|${x.unitId??x.slaveId}`:null);
  const unit=x=>x?.unitId??x?.slaveId;
  const fcName=fc=>({1:'Read Coils',2:'Read Discrete Inputs',3:'Read Holding Registers',4:'Read Input Registers',5:'Write Single Coil',6:'Write Single Register',15:'Write Multiple Coils',16:'Write Multiple Registers',23:'Read/Write Multiple Registers',43:'Device Identification'}[fc]||`FC${fc}`);
  let lastModel=null;

  try{pageMeta.discovery=['Discovery','Passive RTU/TCP topology, Unit/Slave IDs, register blocks and device identification'];}catch{}
  const nav=document.querySelector('.nav'),tcp=nav?.querySelector('[data-page="tcp"]'),settings=nav?.querySelector('[data-page="settings"]');
  if(nav&&!nav.querySelector('[data-page="discovery"]')){
    const b=document.createElement('button');b.className='nav-item';b.dataset.page='discovery';b.innerHTML='<span>⌁</span> Discovery';nav.insertBefore(b,tcp||settings);b.addEventListener('click',()=>{go('discovery');refresh();});
  }
  const main=document.querySelector('main');
  if(main&&!q('page-discovery'))main.insertAdjacentHTML('beforeend',`
    <section class="page" id="page-discovery">
      <article class="panel discovery-head"><div><div class="discovery-title-row"><h2>Passive Discovery</h2><span class="device-status online">RX ONLY</span></div><p>Builds topology only from observed Modbus traffic. No discovery request is transmitted.</p></div><div class="button-row"><button class="secondary" id="discoveryRefresh" type="button">Refresh</button><button class="secondary" id="discoveryExport" type="button">Export JSON</button></div></article>
      <div class="discovery-summary" id="discoverySummary"></div>
      <div id="discoveryChannels"></div>
    </section>`);

  function identify(device,txs){
    const vals=new Map(),segments=[];
    for(const t of txs){const d=t.decoded||{};if(keyOf(t)!==device.deviceKey||t.direction!=='RSP'||Number(t.functionCode??d.functionCode)!==43||Number(d.meiType)!==14||!Array.isArray(d.objects))continue;
      segments.push({moreFollows:Boolean(d.moreFollows),nextObjectId:d.nextObjectId,readDeviceIdCode:d.readDeviceIdCode,objects:d.objects.map(o=>o.objectId)});
      for(const o of d.objects){const id=Number(o.objectId),v=String(o.value??'').trim();if(!vals.has(id))vals.set(id,new Set());if(v)vals.get(id).add(v);}}
    const get=id=>[...(vals.get(id)||[])].at(-1)||null,conflicts=[];for(const[id,set]of vals)if(set.size>1)conflicts.push({objectId:id,values:[...set]});
    return{available:vals.size>0,vendorName:get(0),productCode:get(1),revision:get(2),vendorUrl:get(3),productName:get(4),modelName:get(5),userApplicationName:get(6),segmented:segments.some(s=>s.moreFollows),segments,conflicts,conflict:conflicts.length>0};
  }

  function blocksFor(device,polls,regs){
    const p=polls.filter(x=>keyOf(x)===device.deviceKey).map(x=>({functionCode:Number(x.functionCode),startAddress:Number(x.startAddress),endAddress:Number.isFinite(Number(x.endAddress))?Number(x.endAddress):Number(x.startAddress)+(Number(x.quantity)||1)-1,quantity:Number(x.quantity)||null,medianIntervalMs:x.medianIntervalMs??null,jitterPct:x.jitterPct??null,requests:Number(x.requests||0),responses:Number(x.responses||0),timeouts:Number(x.timeouts||0)}));
    if(p.length)return p.sort((a,b)=>a.functionCode-b.functionCode||a.startAddress-b.startAddress);
    const by=new Map();for(const r of regs.filter(x=>keyOf(x)===device.deviceKey)){const fc=Number(r.functionCode),a=Number(r.address);if(!Number.isInteger(a))continue;if(!by.has(fc))by.set(fc,[]);by.get(fc).push(a);}
    const out=[];for(const[fc,arr]of by){const s=[...new Set(arr)].sort((a,b)=>a-b);let first=null,last=null;const flush=()=>{if(first!=null)out.push({functionCode:fc,startAddress:first,endAddress:last,quantity:last-first+1,medianIntervalMs:null,jitterPct:null,requests:0,responses:0,timeouts:0});};for(const a of s){if(first==null){first=last=a;}else if(a===last+1)last=a;else{flush();first=last=a;}}flush();}return out;
  }

  async function model(){
    const [channels,devices,polls,regs,txs]=await Promise.all([api('/api/channels'),api('/api/devices'),api('/api/polls'),api('/api/registers?limit=50000'),api('/api/transactions?limit=50000')]);
    const cs=channels.map(c=>{const ds=devices.filter(d=>d.channelId===c.channelId).map(d=>{const identity=identify(d,txs),blocks=blocksFor(d,polls,regs),functions=[...new Set([...blocks.map(b=>b.functionCode),...txs.filter(t=>keyOf(t)===d.deviceKey).map(t=>Number(t.functionCode??t.decoded?.functionCode)).filter(Number.isFinite)])].sort((a,b)=>a-b);return{...d,identification:identity,registerBlocks:blocks,functionCodes:functions,suspectedConflict:identity.conflict};}).sort((a,b)=>unit(a)-unit(b));return{...c,devices:ds};});
    const flat=cs.flatMap(c=>c.devices);return{generatedAt:Date.now(),mode:'passive',transmit:false,summary:{channels:cs.length,observedUnitIds:flat.length,confirmedDevices:flat.filter(d=>d.confirmed).length,unconfirmedDevices:flat.filter(d=>!d.confirmed).length,identifiedDevices:flat.filter(d=>d.identification.available).length,suspectedConflicts:flat.filter(d=>d.suspectedConflict).length},channels:cs};
  }

  const badge=(text,cls='')=>`<span class="status-label ${cls}">${safe(text)}</span>`;
  function render(m){
    lastModel=m;const s=m.summary;
    q('discoverySummary').innerHTML=[['Channels',s.channels],['Confirmed devices',s.confirmedDevices],['Unconfirmed IDs',s.unconfirmedDevices],['Identified',s.identifiedDevices],['Conflicts',s.suspectedConflicts]].map(([a,b])=>`<article class="discovery-stat"><span>${a}</span><strong>${b}</strong></article>`).join('');
    q('discoveryChannels').innerHTML=m.channels.map(c=>`<article class="panel discovery-channel"><div class="panel-head"><div><h2>${safe(c.transport)} · ${safe(c.name||c.endpoint||c.channelId)}</h2><p>${safe(c.endpoint||c.channelId)} · ${c.devices.length} observed Unit/Slave ID(s)</p></div>${badge(c.transport,c.transport==='TCP'?'':'good')}</div><div class="discovery-device-list">${c.devices.map(d=>{const id=d.identification||{},title=id.productName||id.modelName||id.productCode||id.vendorName||null;return`<div class="discovery-device ${d.confirmed?'confirmed':'unconfirmed'}"><div class="discovery-device-head"><div><strong>${c.transport==='TCP'?'Unit':'Slave'} ${unit(d)}${title?` · ${safe(title)}`:''}</strong><small>${safe(d.status||'unknown')} · ${d.responses||0} response(s) · ${d.registerCount||0} register(s)</small></div><div>${d.confirmed?badge('CONFIRMED','good'):badge('UNCONFIRMED','warn')}${id.conflict?badge('ID CONFLICT','warn'):''}</div></div><div class="discovery-meta"><span>Functions: ${d.functionCodes.length?d.functionCodes.map(fc=>safe(fcName(fc))).join(', '):'—'}</span><span>Blocks: ${d.registerBlocks.length?d.registerBlocks.map(b=>`FC${String(b.functionCode).padStart(2,'0')} ${b.startAddress}…${b.endAddress}${b.medianIntervalMs!=null?` @ ${Math.round(b.medianIntervalMs)} ms`:''}`).join(' · '):'—'}</span><span>Device ID: ${id.available?safe([id.vendorName,id.productCode,id.modelName,id.revision].filter(Boolean).join(' · ')):'Not observed'}</span>${id.segmented?'<span>FC43: segmented response observed</span>':''}</div><button class="secondary discovery-engineer" data-device-key="${encodeURIComponent(d.deviceKey)}" type="button">Open Engineering</button></div>`;}).join('')||'<div class="empty-state">No Unit/Slave IDs observed on this channel yet.</div>'}</div></article>`).join('')||'<article class="panel empty-state">No Modbus channels observed yet.</article>';
  }

  async function refresh(){if(!q('page-discovery'))return;try{q('discoveryChannels').innerHTML='<article class="panel empty-state">Building passive topology…</article>';render(await model());}catch(e){q('discoveryChannels').innerHTML=`<article class="panel empty-state">${safe(e.message)}</article>`;}}
  q('discoveryRefresh')?.addEventListener('click',refresh);
  q('discoveryExport')?.addEventListener('click',()=>{if(!lastModel)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(lastModel,null,2)],{type:'application/json'}));a.download=`modbus-discovery-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
  q('discoveryChannels')?.addEventListener('click',e=>{const b=e.target.closest('[data-device-key]');if(!b)return;const key=decodeURIComponent(b.dataset.deviceKey);go('engineering');setTimeout(()=>{const s=q('mapDevice');if(s&&[...s.options].some(o=>o.value===key))s.value=key;},600);});
  window.addEventListener('hashchange',()=>{if(location.hash==='#discovery')refresh();});
  if(location.hash==='#discovery')refresh();
})();
