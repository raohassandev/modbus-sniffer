'use strict';

(()=>{
  const page=document.getElementById('page-decoder');
  if(!page||document.getElementById('advancedDataLabPanel'))return;
  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  page.insertAdjacentHTML('beforeend',`
    <article class="panel data-lab-panel" id="advancedDataLabPanel">
      <div class="panel-head">
        <div><h2>Advanced Register/Data Lab</h2><p>Shared codec views for ASCII/UTF-8, BCD, timestamps, enums, bitfields, scaling and limits.</p></div>
        <button class="secondary" id="dataLabRefresh">Refresh from current words</button>
      </div>
      <div class="data-lab-body">
        <div class="data-lab-grid">
          <div class="data-lab-subpanel">
            <div class="data-lab-subhead"><strong>Interpretation Matrix</strong><span id="dataLabCount">0 candidates</span></div>
            <div class="table-wrap data-lab-matrix"><table><thead><tr><th>Type</th><th>Words</th><th>Order</th><th>Value</th></tr></thead><tbody id="dataLabMatrixBody"><tr><td colspan="4" class="muted">Analyze current register values first.</td></tr></tbody></table></div>
          </div>

          <div class="data-lab-subpanel">
            <div class="data-lab-subhead"><strong>Custom Engineering Definition</strong><span>uses same shared codec</span></div>
            <div class="data-lab-form">
              <label>Type<select id="dataLabType">
                <option value="uint16">uint16</option><option value="int16">int16</option>
                <option value="uint32">uint32</option><option value="int32">int32</option><option value="float32">float32</option>
                <option value="uint64">uint64</option><option value="int64">int64</option><option value="float64">float64</option>
                <option value="ascii2">ASCII 2 bytes</option><option value="ascii4">ASCII 4 bytes</option><option value="ascii8">ASCII 8 bytes</option><option value="ascii16">ASCII 16 bytes</option>
                <option value="utf8_2">UTF-8 2 bytes</option><option value="utf8_4">UTF-8 4 bytes</option><option value="utf8_8">UTF-8 8 bytes</option><option value="utf8_16">UTF-8 16 bytes</option>
                <option value="bcd16">BCD 16-bit</option><option value="bcd32">BCD 32-bit</option><option value="bcd64">BCD 64-bit</option>
                <option value="timestamp32s">Unix timestamp 32-bit seconds</option><option value="timestamp64ms">Timestamp 64-bit milliseconds</option>
                <option value="bcdDateTime6">BCD Date/Time YYMMDDhhmmss</option>
              </select></label>
              <label>Byte / Word Order<input id="dataLabOrder" value="ABCD"></label>
              <label>Scale<input id="dataLabScale" type="number" step="any" value="1"></label>
              <label>Offset<input id="dataLabOffset" type="number" step="any" value="0"></label>
              <label>Precision<input id="dataLabPrecision" type="number" min="0" max="12" value="3"></label>
              <label>Unit<input id="dataLabUnit" placeholder="V, A, kW, Hz, %..."></label>
              <label>Minimum<input id="dataLabMin" type="number" step="any" placeholder="optional"></label>
              <label>Maximum<input id="dataLabMax" type="number" step="any" placeholder="optional"></label>
              <label class="data-lab-wide">Enum JSON<textarea id="dataLabEnum" rows="3" placeholder='{"0":"Stopped","1":"Running"}'></textarea></label>
              <label class="data-lab-wide">Bitfield JSON<textarea id="dataLabBits" rows="3" placeholder='{"0":"Ready","1":"Alarm","2":"Remote"}'></textarea></label>
              <button class="primary data-lab-wide" id="dataLabApply">Interpret with Definition</button>
            </div>
            <div class="data-lab-result" id="dataLabResult">Load current words to interpret a custom definition.</div>
          </div>
        </div>
      </div>
    </article>`);

  let lastWords=[];

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
    return body;
  }

  function formatValue(value){
    if(value==null)return '—';
    if(typeof value==='object')return JSON.stringify(value);
    return String(value);
  }

  function renderMatrix(rows){
    const body=q('dataLabMatrixBody');
    q('dataLabCount').textContent=rows.length.toLocaleString()+' candidates';
    body.innerHTML=rows.length?rows.map(row=>
      '<tr><td><strong>'+esc(row.type)+'</strong></td><td>'+esc(row.words)+'</td><td class="mono">'+esc(row.byteOrder||'—')+'</td><td class="data-lab-value">'+esc(formatValue(row.display??row.value))+'</td></tr>'
    ).join(''):'<tr><td colspan="4" class="muted">No valid advanced interpretations for the available words.</td></tr>';
  }

  async function refresh(){
    const slave=q('decoderSlave')?.value,address=q('decoderAddress')?.value;
    if(!slave||address==='')return;
    const p=new URLSearchParams({slave,address,count:'8'});
    if(q('decoderFc')?.value)p.set('fc',q('decoderFc').value);
    try{
      const result=await api('/api/decode?'+p);
      lastWords=(result.words||[]).map(item=>Number(item.value));
      renderMatrix(result.advancedInterpretations||[]);
    }catch(error){
      q('dataLabMatrixBody').innerHTML='<tr><td colspan="4" class="muted">'+esc(error.message)+'</td></tr>';
    }
  }

  function parseObject(text,label){
    const trimmed=String(text||'').trim();
    if(!trimmed)return {};
    let value;
    try{value=JSON.parse(trimmed);}catch(error){throw new Error(label+' must be valid JSON: '+error.message);}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(label+' must be a JSON object.');
    return value;
  }

  async function applyDefinition(){
    if(!lastWords.length)await refresh();
    if(!lastWords.length)return;
    try{
      const definition={
        type:q('dataLabType').value,
        byteOrder:q('dataLabOrder').value.trim(),
        scale:Number(q('dataLabScale').value||1),
        offset:Number(q('dataLabOffset').value||0),
        precision:Number(q('dataLabPrecision').value||3),
        unit:q('dataLabUnit').value.trim(),
        enum:parseObject(q('dataLabEnum').value,'Enum'),
        bitfield:parseObject(q('dataLabBits').value,'Bitfield'),
        limits:{
          min:q('dataLabMin').value===''?null:Number(q('dataLabMin').value),
          max:q('dataLabMax').value===''?null:Number(q('dataLabMax').value),
        },
      };
      const result=await api('/api/register/interpret',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({words:lastWords,definition})});
      const r=result.result||{};
      q('dataLabResult').className='data-lab-result '+(r.available?'good':'error');
      if(!r.available){
        q('dataLabResult').innerHTML='<strong>Unavailable.</strong> '+esc(r.reason||'Unknown codec error');
        return;
      }
      q('dataLabResult').innerHTML=
        '<div><span>Display</span><strong>'+esc(r.display)+'</strong></div>'+
        '<div><span>Raw decoded</span><strong>'+esc(formatValue(r.rawDecoded))+'</strong></div>'+
        '<div><span>Unit</span><strong>'+esc(r.unit||'—')+'</strong></div>'+
        '<div><span>Enum</span><strong>'+esc(r.enumLabel||'—')+'</strong></div>'+
        '<div><span>Active bits</span><strong>'+esc((r.activeBits||[]).join(', ')||'—')+'</strong></div>'+
        '<div><span>Limits</span><strong class="'+(r.outOfLimits?'data-lab-limit':'')+'">'+(r.outOfLimits?'OUT OF LIMIT':'OK')+'</strong></div>';
    }catch(error){
      q('dataLabResult').className='data-lab-result error';
      q('dataLabResult').innerHTML='<strong>Interpretation failed.</strong> '+esc(error.message);
    }
  }

  q('dataLabRefresh').addEventListener('click',refresh);
  q('dataLabApply').addEventListener('click',applyDefinition);
  q('decoderForm')?.addEventListener('submit',()=>setTimeout(refresh,0));
  q('decoderCount')?.addEventListener('change',()=>setTimeout(refresh,0));

  const typeWords={uint16:1,int16:1,uint32:2,int32:2,float32:2,uint64:4,int64:4,float64:4,ascii2:1,ascii4:2,ascii8:4,ascii16:8,utf8_2:1,utf8_4:2,utf8_8:4,utf8_16:8,bcd16:1,bcd32:2,bcd64:4,timestamp32s:2,timestamp64ms:4,bcdDateTime6:3};
  q('dataLabType').addEventListener('change',()=>{
    const words=typeWords[q('dataLabType').value]||1;
    q('dataLabOrder').value=words===1?'AB':words===2?'ABCD':words===4?'ABCDEFGH':words===8?'ABCDEFGHIJKLMNOP':'ABCDEF';
  });
})();