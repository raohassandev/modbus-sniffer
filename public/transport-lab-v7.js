'use strict';

(()=>{
  const meta=['Transport Lab','Test Modbus TCP, TLS/Security, UDP and RTU/ASCII network encapsulations with exact wire evidence.'];
  try{pageMeta.transportLab=meta;}catch{}
  const nav=document.querySelector('.nav'),main=document.querySelector('main');
  if(!nav||!main||document.getElementById('page-transportLab'))return;

  const compareNav=nav.querySelector('[data-page="compare"]');
  const button=document.createElement('button');
  button.className='nav-item';button.dataset.page='transportLab';
  button.innerHTML='<span>⇆</span> Transport Lab';
  if(compareNav?.nextSibling)nav.insertBefore(button,compareNav.nextSibling);else nav.appendChild(button);

  main.insertAdjacentHTML('beforeend',`
    <section class="page" id="page-transportLab">
      <div class="tl-workspace">
        <div class="tl-intro">
          <div><h2>Modbus Transport Lab</h2><p>One-shot read/diagnostic tests across native Modbus TCP, Modbus TCP Security/TLS and common vendor encapsulations.</p></div>
          <span class="tl-chip">READ / DIAGNOSTIC ONLY</span>
        </div>

        <div class="tl-grid">
          <article class="tl-card">
            <div class="tl-card-head"><div><h3>1. Transport</h3><p>Choose the wire framing and endpoint.</p></div></div>
            <div class="tl-card-body tl-form">
              <label>Transport<select id="tlTransport">
                <option value="tcp">Modbus TCP — standard</option>
                <option value="tls">Modbus TCP Security / TLS — standard · port 802</option>
                <option value="udp">Modbus UDP / MBAP datagram — convenience</option>
                <option value="rtu-tcp">RTU over TCP — non-standard tunnel</option>
                <option value="ascii-tcp">ASCII over TCP — non-standard tunnel</option>
                <option value="rtu-udp">RTU over UDP — non-standard tunnel</option>
                <option value="ascii-udp">ASCII over UDP — non-standard tunnel</option>
              </select></label>
              <label>Host / IP<input id="tlHost" value="127.0.0.1"></label>
              <label>Port<input id="tlPort" type="number" min="1" max="65535" value="502"></label>
              <label>Timeout (ms)<input id="tlTimeout" type="number" min="50" max="60000" value="1000"></label>
              <label>Connect timeout (ms)<input id="tlConnectTimeout" type="number" min="100" max="60000" value="3000"></label>
              <label>IP Family<select id="tlFamily"><option value="0">Auto</option><option value="4">IPv4</option><option value="6">IPv6</option></select></label>
              <label class="tl-wide">Local Interface<select id="tlLocal"><option value="">OS default route</option></select></label>
              <div class="tl-wide tl-standard-note" id="tlStandardNote"><strong>Standard:</strong> Native Modbus TCP with MBAP framing.</div>
            </div>
          </article>

          <article class="tl-card">
            <div class="tl-card-head"><div><h3>2. Request</h3><p>Validated read/diagnostic function only; writes stay in Guarded Master.</p></div></div>
            <div class="tl-card-body tl-form">
              <label>Unit ID<input id="tlUnit" type="number" min="1" max="255" value="1"></label>
              <label>Function<select id="tlFc">
                <option value="3" selected>FC03 Read Holding Registers</option>
                <option value="1">FC01 Read Coils</option><option value="2">FC02 Read Discrete Inputs</option><option value="4">FC04 Read Input Registers</option>
                <option value="7">FC07 Read Exception Status</option><option value="8">FC08 Diagnostics</option>
                <option value="11">FC11 Comm Event Counter</option><option value="12">FC12 Comm Event Log</option>
                <option value="17">FC17 Report Server ID</option><option value="20">FC20 Read File Record</option>
                <option value="24">FC24 Read FIFO Queue</option><option value="43">FC43/14 Read Device Identification</option>
              </select></label>
              <label class="tl-address">Address<input id="tlAddress" type="number" min="0" max="65535" value="0"></label>
              <label class="tl-quantity">Quantity<input id="tlQuantity" type="number" min="1" max="2000" value="1"></label>

              <label class="tl-fc08" hidden>Diagnostic Subfunction<input id="tlSubFunction" type="number" min="0" max="65535" value="0"></label>
              <label class="tl-fc08" hidden>Diagnostic Data<input id="tlData" type="number" min="0" max="65535" value="0"></label>
              <label class="tl-fc08 tl-wide tl-check" hidden><input id="tlLabConfirm" type="checkbox"> LAB confirm non-zero FC08 diagnostic subfunction</label>

              <label class="tl-fc20 tl-wide" hidden>FC20 records JSON<textarea id="tlRecords" rows="4">[
  {"fileNumber":0,"recordNumber":0,"recordLength":2}
]</textarea></label>

              <label class="tl-fc43" hidden>Device ID level<select id="tlDeviceCode"><option value="1">Basic</option><option value="2">Regular</option><option value="3">Extended</option><option value="4">Specific</option></select></label>
              <label class="tl-fc43" hidden>Object ID<input id="tlObjectId" type="number" min="0" max="255" value="0"></label>

              <button class="primary tl-wide" id="tlRun">Run One-Shot Test</button>
            </div>
          </article>

          <article class="tl-card tl-wide" id="tlTlsCard" hidden>
            <div class="tl-card-head"><div><h3>3. Modbus TCP Security / TLS</h3><p>Certificate authentication diagnostics for native MBAP over TLS. Default port 802.</p></div></div>
            <div class="tl-card-body tl-form">
              <label>Server Name / SNI<input id="tlServername" placeholder="device.example.com"></label>
              <label>TLS minimum<select id="tlMinVersion"><option value="TLSv1.2" selected>TLS 1.2+</option><option value="TLSv1.3">TLS 1.3</option></select></label>
              <label class="tl-check"><input id="tlRejectUnauthorized" type="checkbox" checked> Verify server certificate</label>
              <label class="tl-wide">CA certificate PEM<textarea id="tlCa" rows="5" placeholder="Optional trusted CA PEM"></textarea></label>
              <label class="tl-wide">Client certificate PEM<textarea id="tlCert" rows="5" placeholder="Optional mTLS client certificate"></textarea></label>
              <label class="tl-wide">Client private key PEM<textarea id="tlKey" rows="5" placeholder="Required with client certificate"></textarea></label>
            </div>
          </article>

          <article class="tl-card tl-wide">
            <div class="tl-card-head"><div><h3>4. Wire Evidence</h3><p>Connection diagnostics, exact request/response bytes and decoded Modbus response.</p></div><button class="secondary" id="tlRecommend">Recommend Local Interface</button></div>
            <div class="tl-card-body">
              <div id="tlResult" class="tl-result"><div class="tl-empty">Run a test to inspect transport and protocol evidence.</div></div>
            </div>
          </article>
        </div>
      </div>
    </section>`);

  const q=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const descriptors={
    tcp:{port:502,standard:true,note:'Native Modbus TCP using MBAP framing.'},
    tls:{port:802,standard:true,note:'Modbus TCP Security / TLS using native MBAP framing.'},
    udp:{port:502,standard:false,note:'MBAP in UDP datagrams is a convenience/vendor extension; verify target support.'},
    'rtu-tcp':{port:502,standard:false,note:'RTU ADUs tunneled through TCP; this is not native Modbus TCP.'},
    'ascii-tcp':{port:502,standard:false,note:'ASCII ADUs tunneled through TCP; verify vendor support.'},
    'rtu-udp':{port:502,standard:false,note:'RTU ADUs in UDP datagrams; vendor/convenience encapsulation.'},
    'ascii-udp':{port:502,standard:false,note:'ASCII ADUs in UDP datagrams; vendor/convenience encapsulation.'},
  };

  async function api(url,options={}){
    const response=await fetch(url,options);
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(body.error||`HTTP ${response.status}`);e.code=body.code;e.details=body.details;throw e;}
    return body;
  }

  async function loadInterfaces(){
    try{
      const rows=await api('/api/transport-lab/interfaces'),current=q('tlLocal').value;
      q('tlLocal').innerHTML='<option value="">OS default route</option>'+rows.map(row=>'<option value="'+esc(row.address)+'">'+esc(row.interfaceName)+' · '+esc(row.address)+' · '+esc(row.family)+(row.internal?' · internal':'')+'</option>').join('');
      if(rows.some(row=>row.address===current))q('tlLocal').value=current;
    }catch{}
  }

  function syncTransport(){
    const id=q('tlTransport').value,d=descriptors[id];
    q('tlPort').value=d.port;
    q('tlTlsCard').hidden=id!=='tls';
    const note=q('tlStandardNote');
    note.className='tl-wide tl-standard-note '+(d.standard?'standard':'nonstandard');
    note.innerHTML='<strong>'+(d.standard?'Standard Modbus transport:':'Convenience / non-standard encapsulation:')+'</strong> '+esc(d.note);
  }

  function syncFunction(){
    const fc=Number(q('tlFc').value);
    document.querySelectorAll('.tl-fc08').forEach(el=>el.hidden=fc!==8);
    document.querySelectorAll('.tl-fc20').forEach(el=>el.hidden=fc!==20);
    document.querySelectorAll('.tl-fc43').forEach(el=>el.hidden=fc!==43);
    document.querySelectorAll('.tl-address').forEach(el=>el.hidden=![1,2,3,4,24].includes(fc));
    document.querySelectorAll('.tl-quantity').forEach(el=>el.hidden=![1,2,3,4].includes(fc));
  }

  function payload(){
    const fc=Number(q('tlFc').value);
    const out={
      transport:q('tlTransport').value,host:q('tlHost').value.trim(),port:Number(q('tlPort').value),
      timeoutMs:Number(q('tlTimeout').value),connectTimeoutMs:Number(q('tlConnectTimeout').value),
      localAddress:q('tlLocal').value||null,family:Number(q('tlFamily').value),
      unitId:Number(q('tlUnit').value),functionCode:fc,address:Number(q('tlAddress').value||0),quantity:Number(q('tlQuantity').value||1),
    };
    if(fc===8){out.subFunction=Number(q('tlSubFunction').value||0);out.data=Number(q('tlData').value||0);out.labConfirmed=q('tlLabConfirm').checked;}
    if(fc===20){
      try{out.records=JSON.parse(q('tlRecords').value);}catch(error){throw new Error('FC20 records JSON is invalid: '+error.message);}
    }
    if(fc===43){out.readDeviceIdCode=Number(q('tlDeviceCode').value);out.objectId=Number(q('tlObjectId').value);}
    if(out.transport==='tls')out.tls={servername:q('tlServername').value.trim()||null,minVersion:q('tlMinVersion').value,rejectUnauthorized:q('tlRejectUnauthorized').checked,ca:q('tlCa').value.trim()||null,cert:q('tlCert').value.trim()||null,key:q('tlKey').value.trim()||null};
    return out;
  }

  function pretty(value){return JSON.stringify(value,null,2);}
  function render(result){
    const tls=result.tls||null;
    q('tlResult').className='tl-result success';
    q('tlResult').innerHTML=
      '<div class="tl-metrics">'+
        '<div><span>Transport</span><strong>'+esc(result.transport?.label||result.config?.transport)+'</strong></div>'+
        '<div><span>RTT</span><strong>'+(result.rttMs==null?'—':Number(result.rttMs).toFixed(2)+' ms')+'</strong></div>'+
        '<div><span>Total</span><strong>'+Number(result.totalElapsedMs||0).toFixed(2)+' ms</strong></div>'+
        '<div><span>Local</span><strong>'+esc(result.transportStatus?.localSocketAddress||result.transportStatus?.localAddress||result.config?.localAddress||'OS default')+'</strong></div>'+
      '</div>'+
      (result.note?'<div class="tl-warning">'+esc(result.note)+'</div>':'')+
      '<div class="tl-evidence-grid"><div><span>Request ADU</span><code>'+esc(result.requestRawHex||'—')+'</code></div><div><span>Response ADU</span><code>'+esc(result.responseRawHex||'—')+'</code></div><div><span>Response PDU</span><code>'+esc(result.responsePduHex||'—')+'</code></div></div>'+
      (tls?'<div class="tl-tls-summary"><strong>TLS</strong><pre>'+esc(pretty(tls))+'</pre></div>':'')+
      '<details open><summary>Decoded response</summary><pre>'+esc(pretty(result.decoded))+'</pre></details>'+
      '<details><summary>Transport status</summary><pre>'+esc(pretty(result.transportStatus))+'</pre></details>';
  }

  async function run(){
    q('tlRun').disabled=true;q('tlResult').className='tl-result';q('tlResult').innerHTML='<div class="tl-running">Opening transport and sending one Modbus request…</div>';
    try{render(await api('/api/transport-lab/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())}));}
    catch(error){
      q('tlResult').className='tl-result error';
      q('tlResult').innerHTML='<div><strong>Transport test failed.</strong> '+esc(error.message)+'</div>'+(error.details?'<pre>'+esc(pretty(error.details))+'</pre>':'');
    }finally{q('tlRun').disabled=false;}
  }

  async function recommend(){
    const host=q('tlHost').value.trim();if(!host)return;
    try{
      const result=await api('/api/transport-lab/recommend?target='+encodeURIComponent(host));
      if(result?.address){q('tlLocal').value=result.address;q('tlStandardNote').insertAdjacentHTML('beforeend','<br><span>Recommended local interface: '+esc(result.address)+' ('+esc(result.reason)+')</span>');}
    }catch{}
  }

  q('tlTransport').addEventListener('change',syncTransport);
  q('tlFc').addEventListener('change',syncFunction);
  q('tlRun').addEventListener('click',run);
  q('tlRecommend').addEventListener('click',recommend);
  loadInterfaces();syncTransport();syncFunction();
})();