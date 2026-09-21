'use strict';

(()=>{
  const meta=['Test Sequences','Repeatable Modbus reads, guarded writes, delays and assertions with protocol evidence.'];
  try{pageMeta.testSequences=meta;}catch{/* stable shell unavailable */}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');
  if(!nav||!main||document.getElementById('page-testSequences'))return;

  const cloneNav=nav.querySelector('[data-page="deviceClone"]');
  const button=document.createElement('button');
  button.className='nav-item';button.dataset.page='testSequences';
  button.innerHTML='<span>✓</span> Test Sequences';
  if(cloneNav?.nextSibling)nav.insertBefore(button,cloneNav.nextSibling);else nav.appendChild(button);

  main.insertAdjacentHTML('beforeend',`
    <section class="page" id="page-testSequences">
      <div class="sequence-workspace">
        <div class="sequence-intro">
          <div><h2>Modbus Test Sequences</h2><p>Run repeatable read/write/assert workflows against the currently connected Master. Writes remain one-shot guarded and auto-relock.</p></div>
          <div class="sequence-chips">
            <span class="sequence-chip" id="sequenceMasterChip"><i></i><span>Master Disconnected</span></span>
            <span class="sequence-chip" id="sequenceRunChip"><i></i><span>Idle</span></span>
          </div>
        </div>

        <div class="sequence-grid">
          <article class="sequence-card">
            <div class="sequence-card-head"><div><h3>1. Sequence Definition</h3><p>Stable sequences allow read, write, delay, set, assert and repeat steps only.</p></div></div>
            <div class="sequence-card-body">
              <div class="sequence-template-row">
                <label>Template<select id="sequenceTemplate"><option value="">Custom sequence…</option></select></label>
                <button class="secondary" id="sequenceLoadTemplate">Load Template</button>
              </div>
              <label class="sequence-editor-label">Recipe JSON
                <textarea id="sequenceEditor" spellcheck="false">{
  "schemaVersion": 1,
  "id": "read-test",
  "name": "Read Test",
  "steps": [
    {
      "type": "read",
      "id": "read",
      "unitId": 1,
      "functionCode": 3,
      "address": 0,
      "quantity": 2,
      "saveAs": "holding"
    },
    {
      "type": "assert",
      "id": "assert",
      "variable": "holding",
      "operator": "exists"
    }
  ]
}</textarea>
              </label>
              <div class="sequence-actions">
                <button class="secondary" id="sequenceValidate">Validate</button>
                <button class="primary" id="sequenceRun" disabled>Run Sequence</button>
                <button class="secondary" id="sequencePause" disabled>Pause</button>
                <button class="secondary" id="sequenceResume" disabled>Resume</button>
                <button class="secondary" id="sequenceStop" disabled>Stop</button>
              </div>
              <div id="sequenceValidation" class="sequence-note">Validate the sequence before running it.</div>
            </div>
          </article>

          <article class="sequence-card">
            <div class="sequence-card-head"><div><h3>2. Runtime & Safety</h3><p>Execution is bounded before I/O begins.</p></div></div>
            <div class="sequence-card-body">
              <div class="sequence-stats">
                <div><span>Expanded Steps</span><strong id="sequenceExpanded">—</strong></div>
                <div><span>Reads</span><strong id="sequenceReads">—</strong></div>
                <div><span>Writes</span><strong id="sequenceWrites">—</strong></div>
                <div><span>Assertions</span><strong id="sequenceAssertions">—</strong></div>
              </div>
              <div class="sequence-safety">
                <strong>Safety contract</strong>
                <ul>
                  <li>Generic connect/disconnect automation is rejected.</li>
                  <li>Raw frame/LAB steps are rejected in this surface.</li>
                  <li>Every write must carry normal explicit confirmation.</li>
                  <li>Bulk/broadcast writes require their stronger confirmations.</li>
                  <li>Each write auto-relocks even if a later step fails.</li>
                  <li>Sequence stop/finalize also forces the write latch locked.</li>
                </ul>
              </div>
            </div>
          </article>

          <article class="sequence-card sequence-wide">
            <div class="sequence-card-head">
              <div><h3>3. Last Run</h3><p>Step evidence is retained in memory for this application session.</p></div>
              <button class="secondary" id="sequenceRefreshHistory">Refresh History</button>
            </div>
            <div class="sequence-card-body">
              <div id="sequenceRunSummary" class="sequence-run-summary"><div class="sequence-empty">No Test Sequence has run in this session.</div></div>
              <div class="sequence-table-wrap"><table class="sequence-table"><thead><tr><th>Step</th><th>Type</th><th>Result</th><th>Elapsed</th><th>Tx</th><th>Rx</th><th>Value / Error</th></tr></thead><tbody id="sequenceEvidenceBody"><tr><td colspan="7" class="muted">No evidence yet.</td></tr></tbody></table></div>
            </div>
          </article>

          <article class="sequence-card sequence-wide">
            <div class="sequence-card-head"><div><h3>4. Run History</h3><p>Most recent bounded sequence runs.</p></div></div>
            <div class="sequence-card-body">
              <div class="sequence-table-wrap"><table class="sequence-table"><thead><tr><th>Time</th><th>Name</th><th>Result</th><th>Elapsed</th><th>Steps</th><th>Failure</th></tr></thead><tbody id="sequenceHistoryBody"><tr><td colspan="6" class="muted">No runs yet.</td></tr></tbody></table></div>
            </div>
          </article>
        </div>
      </div>
    </section>`);

  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let templates=[],validation=null,running=false,paused=false;

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok){
      const error=new Error(body.error||`HTTP ${response.status}`);
      error.code=body.code;error.details=body.details;error.recipeResult=body.recipeResult;
      throw error;
    }
    return body;
  }

  function parseRecipe(){
    let recipe;
    try{recipe=JSON.parse(q('sequenceEditor').value);}catch(error){throw new Error('Recipe JSON is invalid: '+error.message);}
    return recipe;
  }

  function setValidation(value,error=null){
    validation=error?null:value;
    q('sequenceRun').disabled=!validation||running||!q('sequenceMasterChip').classList.contains('connected');
    if(error){
      q('sequenceValidation').className='sequence-note error';
      q('sequenceValidation').innerHTML='<strong>Invalid.</strong> '+esc(error.message);
      for(const id of ['sequenceExpanded','sequenceReads','sequenceWrites','sequenceAssertions'])q(id).textContent='—';
      return;
    }
    q('sequenceValidation').className='sequence-note good';
    q('sequenceValidation').innerHTML=`<strong>Valid.</strong> ${value.expandedSteps} executable step(s), max ${value.maxExpandedSteps}, repeat depth limit ${value.maxRepeatDepth}.`;
    q('sequenceExpanded').textContent=value.expandedSteps;
    q('sequenceReads').textContent=value.reads;
    q('sequenceWrites').textContent=value.writes;
    q('sequenceAssertions').textContent=value.assertions;
  }

  async function validate(){
    try{
      const result=await api('/api/test-sequences/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recipe:parseRecipe()})});
      setValidation(result);
      return result;
    }catch(error){
      setValidation(null,error);
      throw error;
    }
  }

  function renderStatus(status){
    running=Boolean(status.running);paused=Boolean(status.paused);
    const master=q('sequenceMasterChip'),run=q('sequenceRunChip');
    master.classList.toggle('connected',Boolean(status.masterConnected));
    master.querySelector('span').textContent=status.masterConnected?'Master Connected':'Master Disconnected';
    run.classList.toggle('running',running);
    run.classList.toggle('paused',paused);
    run.querySelector('span').textContent=paused?'Paused':running?'Running':'Idle';
    q('sequenceRun').disabled=!validation||running||!status.masterConnected;
    q('sequencePause').disabled=!running||paused;
    q('sequenceResume').disabled=!running||!paused;
    q('sequenceStop').disabled=!running;
  }

  function renderRun(result){
    if(!result)return;
    const passed=result.passed===true;
    q('sequenceRunSummary').innerHTML=`
      <div><span>Run ID</span><strong>${esc(result.runId||'—')}</strong></div>
      <div><span>Recipe</span><strong>${esc(result.recipeName||result.recipeId||'Unnamed')}</strong></div>
      <div><span>Result</span><strong class="${passed?'sequence-pass':'sequence-fail'}">${passed?'PASS':'FAIL'}</strong></div>
      <div><span>Elapsed</span><strong>${result.elapsedMs==null?'—':esc(result.elapsedMs+' ms')}</strong></div>
      <div><span>Write State</span><strong>LOCKED</strong></div>`;
    const evidence=Array.isArray(result.evidence)?result.evidence:[];
    q('sequenceEvidenceBody').innerHTML=evidence.length?evidence.map(row=>{
      const elapsed=row.completedAt&&row.startedAt?row.completedAt-row.startedAt:null;
      const detail=row.error?row.error.message:JSON.stringify(row.value??null);
      return `<tr><td>${esc(row.stepId)}</td><td>${esc(row.type)}</td><td class="${row.result==='passed'?'sequence-pass':'sequence-fail'}">${esc(row.result)}</td><td>${elapsed==null?'—':elapsed+' ms'}</td><td class="mono sequence-hex">${esc(row.requestRawHex||'—')}</td><td class="mono sequence-hex">${esc(row.responseRawHex||'—')}</td><td class="sequence-detail">${esc(detail)}</td></tr>`;
    }).join(''):'<tr><td colspan="7" class="muted">No step evidence.</td></tr>';
  }

  async function runSequence(){
    try{
      if(!validation)await validate();
      running=true;
      renderStatus({running:true,paused:false,masterConnected:true});
      q('sequenceRunSummary').innerHTML='<div class="sequence-running">Sequence running…</div>';
      const response=await api('/api/test-sequences/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recipe:parseRecipe()})});
      renderRun(response.result);
    }catch(error){
      if(error.recipeResult)renderRun(error.recipeResult);
      else q('sequenceRunSummary').innerHTML='<div class="sequence-error"><strong>Run failed.</strong> '+esc(error.message)+'</div>';
    }finally{
      await refreshStatus();
      await refreshHistory();
    }
  }

  async function command(name){
    try{
      const status=await api('/api/test-sequences/'+name,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      renderStatus(status);
    }catch(error){
      q('sequenceValidation').className='sequence-note error';
      q('sequenceValidation').textContent=error.message;
    }
  }

  async function refreshStatus(){
    try{
      const status=await api('/api/test-sequences/status');
      renderStatus(status);
      if(status.lastRun)renderRun(status.lastRun);
    }catch{/* rolling checkout may not have route yet */}
  }

  async function refreshHistory(){
    try{
      const rows=await api('/api/test-sequences/history?limit=20');
      q('sequenceHistoryBody').innerHTML=rows.length?[...rows].reverse().map(row=>`<tr><td>${row.startedAt?new Date(row.startedAt).toLocaleTimeString([],{hour12:false}):'—'}</td><td>${esc(row.recipeName||row.recipeId||'Unnamed')}</td><td class="${row.passed?'sequence-pass':'sequence-fail'}">${row.passed?'PASS':'FAIL'}</td><td>${row.elapsedMs==null?'—':row.elapsedMs+' ms'}</td><td>${Array.isArray(row.evidence)?row.evidence.length:0}</td><td>${esc(row.failure?.message||'—')}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">No runs yet.</td></tr>';
    }catch{/* no-op */}
  }

  async function loadTemplates(){
    try{
      templates=await api('/api/test-sequences/templates');
      q('sequenceTemplate').innerHTML='<option value="">Custom sequence…</option>'+templates.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    }catch{/* no-op */}
  }

  function useTemplate(){
    const template=templates.find(t=>t.id===q('sequenceTemplate').value);
    if(!template)return;
    q('sequenceEditor').value=JSON.stringify(template.recipe,null,2);
    validation=null;
    q('sequenceValidation').className='sequence-note';
    q('sequenceValidation').textContent=template.description||'Template loaded. Validate before running.';
    q('sequenceRun').disabled=true;
  }

  q('sequenceLoadTemplate').addEventListener('click',useTemplate);
  q('sequenceValidate').addEventListener('click',()=>validate().catch(()=>{}));
  q('sequenceRun').addEventListener('click',runSequence);
  q('sequencePause').addEventListener('click',()=>command('pause'));
  q('sequenceResume').addEventListener('click',()=>command('resume'));
  q('sequenceStop').addEventListener('click',()=>command('stop'));
  q('sequenceRefreshHistory').addEventListener('click',refreshHistory);
  q('sequenceEditor').addEventListener('input',()=>{
    validation=null;q('sequenceRun').disabled=true;
    q('sequenceValidation').className='sequence-note';
    q('sequenceValidation').textContent='Recipe changed. Validate again before running.';
  });

  loadTemplates();
  refreshStatus();
  refreshHistory();
  setInterval(()=>{if(document.visibilityState==='visible'&&(running||document.getElementById('page-testSequences')?.classList.contains('active')))refreshStatus();},1000);
})();