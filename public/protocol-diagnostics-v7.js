'use strict';

(()=>{
  const page=document.getElementById('page-analysis');
  if(!page||document.getElementById('protocolDiagnosticsPanel'))return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';

  page.insertAdjacentHTML('beforeend',`
    <article class="panel protocol-diagnostics-panel" id="protocolDiagnosticsPanel">
      <div class="panel-head">
        <div><h2>Protocol Diagnostics</h2><p>CRC/LRC/MBAP validity, request/response matching, duplicates, TCP transaction ordering and RTU timing.</p></div>
        <button class="secondary" id="protocolDiagnosticsRefresh">Refresh</button>
      </div>
      <div class="protocol-diagnostics-body">
        <div class="protocol-kpis">
          <div><span>Invalid frames</span><strong id="pdInvalid">—</strong></div>
          <div><span>Unmatched requests</span><strong id="pdUnmatched">—</strong></div>
          <div><span>Orphan responses</span><strong id="pdOrphans">—</strong></div>
          <div><span>Duplicates</span><strong id="pdDuplicates">—</strong></div>
          <div><span>Mismatches</span><strong id="pdMismatches">—</strong></div>
          <div><span>Out-of-order TCP</span><strong id="pdOutOfOrder">—</strong></div>
          <div><span>Exceptions</span><strong id="pdExceptions">—</strong></div>
          <div><span>P95 RTT</span><strong id="pdP95">—</strong></div>
        </div>

        <div class="protocol-grid">
          <div class="protocol-subpanel">
            <div class="protocol-subhead"><strong>Frame / Matching Findings</strong><span id="pdFindingCount">0 findings</span></div>
            <div class="table-wrap"><table><thead><tr><th>Type</th><th>Source</th><th>Packet</th><th>Details</th></tr></thead><tbody id="pdFindingsBody"><tr><td colspan="4" class="muted">No diagnostics loaded.</td></tr></tbody></table></div>
          </div>

          <div class="protocol-subpanel">
            <div class="protocol-subhead"><strong>Connection Timing</strong><span>gap / jitter / RTU silent interval</span></div>
            <div class="table-wrap"><table><thead><tr><th>Connection</th><th>Transport</th><th>Median gap</th><th>P95 gap</th><th>Jitter</th><th>3.5 char</th><th>Violations</th></tr></thead><tbody id="pdGapBody"><tr><td colspan="7" class="muted">No timing data.</td></tr></tbody></table></div>
          </div>
        </div>
      </div>
    </article>`);

  async function api(url){
    const response=await fetch(url);
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
    return body;
  }

  function packetButton(id,label){
    if(id==null)return esc(label||'—');
    return '<button class="ghost protocol-packet-link" data-protocol-packet="'+Number(id)+'">'+esc(label||('#'+id))+'</button>';
  }

  function render(data){
    const t=data.totals||{},lat=data.latency||{};
    document.getElementById('pdInvalid').textContent=Number(t.invalidFrames||0).toLocaleString();
    document.getElementById('pdUnmatched').textContent=Number(t.unmatchedRequests||0).toLocaleString();
    document.getElementById('pdOrphans').textContent=Number(t.orphanResponses||0).toLocaleString();
    document.getElementById('pdDuplicates').textContent=Number((t.duplicateRequests||0)+(t.duplicateResponses||0)).toLocaleString();
    document.getElementById('pdMismatches').textContent=Number(t.mismatches||0).toLocaleString();
    document.getElementById('pdOutOfOrder').textContent=Number(t.outOfOrderTcpResponses||0).toLocaleString();
    document.getElementById('pdExceptions').textContent=Number(t.exceptions||0).toLocaleString();
    document.getElementById('pdP95').textContent=lat.p95Ms==null?'—':num(lat.p95Ms,1)+' ms';

    const findings=[];
    for(const x of data.frameIssues||[])findings.push({type:x.code||'Frame',source:x.sourceType,id:x.id,detail:x.message});
    for(const x of data.unmatchedRequests||[])findings.push({type:'Unmatched request',source:x.sourceType,id:x.id,detail:'Unit '+x.unitId+' · FC'+x.functionCode});
    for(const x of data.orphanResponses||[])findings.push({type:'Orphan response',source:x.sourceType,id:x.id,detail:'Unit '+x.unitId+' · FC'+x.functionCode});
    for(const x of data.duplicateRequests||[])findings.push({type:'Duplicate request',source:'Traffic',id:x.duplicateId,detail:'Duplicate of #'+x.firstId+' after '+num(x.gapMs,1)+' ms'});
    for(const x of data.duplicateResponses||[])findings.push({type:'Duplicate response',source:'Traffic',id:x.duplicateId,detail:'Duplicate of #'+x.firstId+' after '+num(x.gapMs,1)+' ms'});
    for(const x of data.mismatches||[])findings.push({type:'Request/response mismatch',source:'Traffic',id:x.responseId,detail:'Request #'+x.requestId+' · Unit '+x.unitId+' · FC'+x.functionCode});
    for(const x of data.outOfOrderTcpResponses||[])findings.push({type:'TCP response order',source:'TCP',id:x.responseId,detail:'TID '+x.transactionId+' after '+x.previousTransactionId});
    for(const x of data.exceptions||[])findings.push({type:'Modbus exception',source:x.sourceType,id:x.id,detail:'Unit '+x.unitId+' · FC'+x.functionCode+' · '+x.exceptionName});

    document.getElementById('pdFindingCount').textContent=findings.length.toLocaleString()+' findings';
    document.getElementById('pdFindingsBody').innerHTML=findings.length?findings.slice(-300).reverse().map(x=>
      '<tr><td><strong>'+esc(x.type)+'</strong></td><td>'+esc(x.source||'—')+'</td><td>'+packetButton(x.id,'#'+x.id)+'</td><td>'+esc(x.detail||'')+'</td></tr>'
    ).join(''):'<tr><td colspan="4" class="muted">No protocol anomalies detected in the analyzed traffic.</td></tr>';

    const gaps=data.gapAnalysis||[];
    document.getElementById('pdGapBody').innerHTML=gaps.length?gaps.map(x=>
      '<tr><td class="mono">'+esc(x.connectionId)+'</td><td>'+esc(x.transport||'—')+'</td><td>'+ (x.medianGapMs==null?'—':num(x.medianGapMs,2)+' ms') +'</td><td>'+ (x.p95GapMs==null?'—':num(x.p95GapMs,2)+' ms') +'</td><td>'+ (x.jitterPct==null?'—':num(x.jitterPct,1)+'%') +'</td><td>'+ (x.silentIntervalMs==null?'—':num(x.silentIntervalMs,3)+' ms') +'</td><td class="'+(x.silentIntervalViolations?'protocol-warn':'')+'">'+Number(x.silentIntervalViolations||0)+'</td></tr>'
    ).join(''):'<tr><td colspan="7" class="muted">No connection timing data.</td></tr>';
  }

  async function refresh(){
    const button=document.getElementById('protocolDiagnosticsRefresh');
    button.disabled=true;
    try{render(await api('/api/diagnostics/protocol?limit=10000'));}
    catch(error){document.getElementById('pdFindingsBody').innerHTML='<tr><td colspan="4" class="muted">'+esc(error.message)+'</td></tr>';}
    finally{button.disabled=false;}
  }

  document.getElementById('protocolDiagnosticsRefresh').addEventListener('click',refresh);
  document.getElementById('pdFindingsBody').addEventListener('click',event=>{
    const b=event.target.closest('[data-protocol-packet]');if(!b)return;
    if(typeof go==='function')go('traffic');
    if(typeof selectPacket==='function')selectPacket(Number(b.dataset.protocolPacket));
  });

  const observer=new MutationObserver(()=>{
    if(page.classList.contains('active'))refresh();
  });
  observer.observe(page,{attributes:true,attributeFilter:['class']});
  if(page.classList.contains('active'))refresh();
})();