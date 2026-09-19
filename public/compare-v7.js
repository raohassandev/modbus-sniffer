'use strict';

(()=>{
  const meta=['Replay / Compare','Compare Modbus captures, register maps and Test Sequence evidence without modifying the active session.'];
  try{pageMeta.compare=meta;}catch{}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');
  if(!nav||!main||document.getElementById('page-compare'))return;

  const loggerNav=nav.querySelector('[data-page="loggerTrend"]');
  const button=document.createElement('button');
  button.className='nav-item';button.dataset.page='compare';
  button.innerHTML='<span>⇄</span> Replay / Compare';
  if(loggerNav?.nextSibling)nav.insertBefore(button,loggerNav.nextSibling);else nav.appendChild(button);

  main.insertAdjacentHTML('beforeend',`
    <section class="page" id="page-compare">
      <div class="compare-workspace">
        <div class="compare-intro">
          <div><h2>Replay / Compare</h2><p>Compare Modbus evidence offline. Comparison never starts a connection, write, replay or simulator.</p></div>
          <span class="compare-chip">READ-ONLY ANALYSIS</span>
        </div>

        <div class="compare-tabs" id="compareTabs">
          <button class="active" data-compare-mode="captures">Captures</button>
          <button data-compare-mode="maps">Register Maps</button>
          <button data-compare-mode="runs">Test Runs</button>
        </div>

        <article class="compare-card" data-compare-panel="captures">
          <div class="compare-card-head"><div><h3>Capture vs Capture</h3><p>Compare traffic totals, Unit IDs, function codes and inferred register values from two .mbcap files.</p></div><button class="primary" id="compareCapturesRun">Compare Captures</button></div>
          <div class="compare-card-body">
            <div class="compare-files"><label>Left capture<input id="compareCaptureLeft" type="file" accept=".mbcap,.json,application/json"></label><label>Right capture<input id="compareCaptureRight" type="file" accept=".mbcap,.json,application/json"></label></div>
            <div id="compareCaptureResult" class="compare-result"><div class="compare-empty">Select two capture files.</div></div>
          </div>
        </article>

        <article class="compare-card" data-compare-panel="maps" hidden>
          <div class="compare-card-head"><div><h3>Register Map vs Register Map</h3><p>JSON arrays should contain device/unit, function, address and value/lastValue fields.</p></div><button class="primary" id="compareMapsRun">Compare Maps</button></div>
          <div class="compare-card-body compare-text-grid">
            <label>Left map JSON<textarea id="compareMapLeft" rows="12">[]</textarea></label>
            <label>Right map JSON<textarea id="compareMapRight" rows="12">[]</textarea></label>
            <div id="compareMapResult" class="compare-result compare-wide"><div class="compare-empty">Paste two register-map arrays.</div></div>
          </div>
        </article>

        <article class="compare-card" data-compare-panel="runs" hidden>
          <div class="compare-card-head"><div><h3>Test Run vs Test Run</h3><p>Compare pass/fail state, elapsed time and step evidence from two Test Sequence results.</p></div><button class="primary" id="compareRunsRun">Compare Runs</button></div>
          <div class="compare-card-body compare-text-grid">
            <label>Left run JSON<textarea id="compareRunLeft" rows="12">{}</textarea></label>
            <label>Right run JSON<textarea id="compareRunRight" rows="12">{}</textarea></label>
            <div id="compareRunResult" class="compare-result compare-wide"><div class="compare-empty">Paste two Test Sequence run objects.</div></div>
          </div>
        </article>
      </div>
    </section>`);

  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function api(url,body){
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    return payload;
  }
  async function readJsonFile(input,label){
    const file=input.files?.[0];if(!file)throw new Error('Select '+label+'.');
    try{return JSON.parse(await file.text());}catch(error){throw new Error(label+' is not valid JSON: '+error.message);}
  }
  function parseJson(text,label){
    try{return JSON.parse(text);}catch(error){throw new Error(label+' is not valid JSON: '+error.message);}
  }
  function metric(label,value,cls=''){return '<div><span>'+esc(label)+'</span><strong class="'+cls+'">'+esc(value)+'</strong></div>';}
  function delta(value){const n=Number(value||0);return (n>0?'+':'')+n;}

  function renderCapture(result){
    const d=result.deltas||{},rd=result.registerDiff?.totals||{};
    q('compareCaptureResult').innerHTML=
      '<div class="compare-metrics">'+
      metric('Transactions Δ',delta(d.transactions),d.transactions?'compare-changed':'')+
      metric('Timeouts Δ',delta(d.timeouts),d.timeouts?'compare-warn':'')+
      metric('Exceptions Δ',delta(d.exceptions),d.exceptions?'compare-warn':'')+
      metric('Registers Δ',delta(d.registers),d.registers?'compare-changed':'')+
      metric('Added regs',rd.added||0,rd.added?'compare-changed':'')+
      metric('Removed regs',rd.removed||0,rd.removed?'compare-changed':'')+
      metric('Changed values',rd.changed||0,rd.changed?'compare-changed':'')+
      metric('Unchanged',rd.unchanged||0)+
      '</div>'+
      '<div class="compare-section"><strong>Unit IDs</strong><p>Added: '+esc((result.units?.added||[]).join(', ')||'—')+' · Removed: '+esc((result.units?.removed||[]).join(', ')||'—')+'</p></div>'+
      '<div class="compare-section"><strong>Function codes</strong><p>Added: '+esc((result.functions?.added||[]).join(', ')||'—')+' · Removed: '+esc((result.functions?.removed||[]).join(', ')||'—')+'</p></div>'+
      renderChangedRegisters(result.registerDiff?.changed||[]);
  }

  function renderChangedRegisters(rows){
    return '<div class="compare-section"><strong>Changed register values</strong><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Register</th><th>Before</th><th>After</th></tr></thead><tbody>'+
      (rows.length?rows.slice(0,300).map(x=>'<tr><td class="mono">'+esc(x.key)+'</td><td>'+esc(x.beforeValue)+'</td><td>'+esc(x.afterValue)+'</td></tr>').join(''):'<tr><td colspan="3" class="muted">No changed register values.</td></tr>')+
      '</tbody></table></div></div>';
  }

  function renderMap(result){
    const t=result.totals||{};
    q('compareMapResult').innerHTML='<div class="compare-metrics">'+metric('Left',t.left||0)+metric('Right',t.right||0)+metric('Added',t.added||0,t.added?'compare-changed':'')+metric('Removed',t.removed||0,t.removed?'compare-changed':'')+metric('Changed',t.changed||0,t.changed?'compare-changed':'')+metric('Unchanged',t.unchanged||0)+'</div>'+renderChangedRegisters(result.changed||[]);
  }

  function renderRuns(result){
    const changed=(result.steps||[]).filter(x=>x.status!=='unchanged');
    q('compareRunResult').innerHTML=
      '<div class="compare-metrics">'+
      metric('Left result',result.left?.passed?'PASS':'FAIL',result.left?.passed?'compare-pass':'compare-fail')+
      metric('Right result',result.right?.passed?'PASS':'FAIL',result.right?.passed?'compare-pass':'compare-fail')+
      metric('Elapsed Δ',result.elapsedDeltaMs==null?'—':delta(result.elapsedDeltaMs)+' ms',result.elapsedDeltaMs?'compare-changed':'')+
      metric('Changed steps',changed.length,changed.length?'compare-changed':'')+
      '</div>'+
      '<div class="compare-section"><strong>Step differences</strong><div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Step</th><th>Status</th><th>Left</th><th>Right</th></tr></thead><tbody>'+
      (changed.length?changed.map(x=>'<tr><td>'+esc(x.stepId)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.left?.result||'—')+'</td><td>'+esc(x.right?.result||'—')+'</td></tr>').join(''):'<tr><td colspan="4" class="muted">No step differences.</td></tr>')+
      '</tbody></table></div></div>';
  }

  q('compareTabs').addEventListener('click',e=>{
    const b=e.target.closest('[data-compare-mode]');if(!b)return;
    q('compareTabs').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('[data-compare-panel]').forEach(p=>p.hidden=p.dataset.comparePanel!==b.dataset.compareMode);
  });
  q('compareCapturesRun').addEventListener('click',async()=>{
    try{renderCapture(await api('/api/compare/captures',{left:await readJsonFile(q('compareCaptureLeft'),'left capture'),right:await readJsonFile(q('compareCaptureRight'),'right capture')}));}
    catch(error){q('compareCaptureResult').innerHTML='<div class="compare-error">'+esc(error.message)+'</div>';}
  });
  q('compareMapsRun').addEventListener('click',async()=>{
    try{renderMap(await api('/api/compare/register-maps',{left:parseJson(q('compareMapLeft').value,'left map'),right:parseJson(q('compareMapRight').value,'right map')}));}
    catch(error){q('compareMapResult').innerHTML='<div class="compare-error">'+esc(error.message)+'</div>';}
  });
  q('compareRunsRun').addEventListener('click',async()=>{
    try{renderRuns(await api('/api/compare/test-runs',{left:parseJson(q('compareRunLeft').value,'left run'),right:parseJson(q('compareRunRight').value,'right run')}));}
    catch(error){q('compareRunResult').innerHTML='<div class="compare-error">'+esc(error.message)+'</div>';}
  });
})();