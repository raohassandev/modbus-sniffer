'use strict';

(()=>{
  const page=document.getElementById('page-traffic');
  if(!page||document.getElementById('trafficSource'))return;
  const filters=page.querySelector('.filters');
  if(!filters)return;

  const label=document.createElement('label');
  label.className='traffic-source-filter';
  label.innerHTML='Source<select id="trafficSource"><option value="">All sources</option><option value="Sniffer">Sniffer</option><option value="Master">Master</option><option value="Slave">Slave</option><option value="Discovery">Discovery</option><option value="Test Sequence">Test Sequence</option></select>';
  filters.insertBefore(label,filters.firstChild);

  const direction=document.getElementById('trafficDirection');
  if(direction){
    for(const value of ['TEST','DISCOVERY']){
      if(![...direction.options].some(option=>option.value===value)){
        const option=document.createElement('option');option.value=value;option.textContent=value;direction.appendChild(option);
      }
    }
  }

  const baseTrafficFilters=trafficFilters;
  trafficFilters=function(){const f=baseTrafficFilters();f.sourceType=document.getElementById('trafficSource')?.value||'';return f;};

  filteredTransactions=function(){
    const f=trafficFilters();
    return state.transactions.filter(t=>{
      if(f.sourceType&&String(t.sourceType||'Sniffer')!==f.sourceType)return false;
      if(f.channelId&&t.channelId!==f.channelId)return false;
      if(f.slave&&Number(t.unitId??t.slaveId)!==Number(f.slave))return false;
      if(f.fc&&Number(t.functionCode)!==Number(f.fc))return false;
      if(f.direction&&t.direction!==f.direction)return false;
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

  const baseRenderTraffic=renderTraffic;
  renderTraffic=function(){
    baseRenderTraffic();
    for(const row of document.querySelectorAll('#trafficBody tr[data-packet]')){
      const t=state.transactions.find(item=>item.id===Number(row.dataset.packet));if(!t)continue;
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
  };

  document.getElementById('trafficSource').addEventListener('change',renderTraffic);
  const head=page.querySelector('.traffic-panel .panel-head p');
  if(head)head.insertAdjacentHTML('beforeend',' <span class="evidence-unified-note">· unified passive + active evidence</span>');
  renderTraffic();
})();