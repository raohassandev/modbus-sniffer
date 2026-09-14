'use strict';

(()=>{
  const $=id=>document.getElementById(id);
  let interfaces=[],userSelected=false,refreshTimer=null;

  const ipInt=ip=>{
    const p=String(ip||'').trim().split('.');
    if(p.length!==4||p.some(x=>!/^\d+$/.test(x)||Number(x)<0||Number(x)>255))return null;
    return p.reduce((n,x)=>((n<<8)|Number(x))>>>0,0)>>>0;
  };
  const prefix=mask=>{let n=ipInt(mask);if(n==null)return 0;let c=0;while(n){c+=n&1;n>>>=1;}return c;};
  const recommendation=target=>{
    const t=ipInt(target);if(t==null)return null;
    const matches=interfaces.filter(x=>{
      const a=ipInt(x.address),m=ipInt(x.netmask);return a!=null&&m!=null&&(((a&m)>>>0)===((t&m)>>>0));
    });
    matches.sort((a,b)=>Number(a.internal)-Number(b.internal)||Number(a.linkLocal)-Number(b.linkLocal)||prefix(b.netmask)-prefix(a.netmask)||String(a.name).localeCompare(String(b.name)));
    return matches[0]?.address||null;
  };
  const isLoopback=h=>['127.0.0.1','localhost','::1','[::1]'].includes(String(h||'').trim().toLowerCase());

  function ensureControls(){
    const old=$('tcpListenHost');if(!old)return null;
    let select=old;
    if(old.tagName!=='SELECT'){
      select=document.createElement('select');
      select.id='tcpListenHost';
      select.setAttribute('aria-label','TCP listen interface');
      old.replaceWith(select);
    }
    if(!$('tcpRefreshInterfaces')){
      const btn=document.createElement('button');btn.type='button';btn.id='tcpRefreshInterfaces';btn.className='secondary';btn.textContent='Refresh adapters';
      select.parentElement?.appendChild(btn);
      btn.addEventListener('click',()=>refresh(true));
    }
    if(!$('tcpInterfaceHint')){
      const hint=document.createElement('small');hint.id='tcpInterfaceHint';hint.className='form-note';
      select.parentElement?.appendChild(hint);
    }
    select.addEventListener('change',()=>{userSelected=true;updateWarning();updateHint();},{once:false});
    return select;
  }

  function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o;}

  function populate(status={}){
    const select=ensureControls();if(!select)return;
    interfaces=Array.isArray(status.localInterfaces)?status.localInterfaces:[];
    const current=select.value||status.listenHost||'127.0.0.1';
    const seen=new Set();select.innerHTML='';

    const add=(value,text)=>{if(seen.has(value))return;seen.add(value);select.appendChild(option(value,text));};
    add('127.0.0.1','Loopback — 127.0.0.1 (this PC only)');
    for(const x of interfaces.filter(x=>!x.internal)){
      const suffix=x.linkLocal?' · link-local':'';
      add(x.address,`${x.kind||'Network'} — ${x.name} — ${x.address}${suffix}`);
    }
    add('0.0.0.0','All interfaces — 0.0.0.0');
    if(current&&!seen.has(current))add(current,`Current / unavailable — ${current}`);
    select.value=seen.has(current)?current:'127.0.0.1';
    select.disabled=Boolean(status.running);
    const refreshBtn=$('tcpRefreshInterfaces');if(refreshBtn)refreshBtn.disabled=Boolean(status.running);
    updateWarning();updateHint(status);
  }

  function updateWarning(){
    const select=$('tcpListenHost'),warning=$('tcpBindWarning'),confirm=$('tcpConfirmExternal');if(!select||!warning)return;
    const external=!isLoopback(select.value);warning.hidden=!external;if(!external&&confirm)confirm.checked=false;
  }

  function updateHint(status={}){
    const hint=$('tcpInterfaceHint'),select=$('tcpListenHost'),target=$('tcpTargetHost');if(!hint||!select)return;
    const rec=recommendation(target?.value);
    const selected=interfaces.find(x=>x.address===select.value);
    if(status.running){hint.textContent=`Proxy is bound to ${status.listenHost}. Stop it before changing the listen interface.`;return;}
    if(rec&&select.value!==rec)hint.textContent=`Recommended for target ${target.value}: ${rec}. Choose the adapter on the same subnet.`;
    else if(rec)hint.textContent=`Same-subnet adapter selected: ${rec}.`;
    else if(selected)hint.textContent=`Selected PC adapter: ${selected.kind||'Network'} · ${selected.name} · ${selected.address}.`;
    else if(select.value==='0.0.0.0')hint.textContent='All interfaces accepts connections on every IPv4 adapter and requires explicit confirmation.';
    else hint.textContent='Loopback accepts Modbus TCP clients only from this PC.';
  }

  function autoPrefer(){
    const select=$('tcpListenHost'),target=$('tcpTargetHost');if(!select||select.disabled||userSelected)return;
    const rec=recommendation(target?.value);if(rec&&[...select.options].some(o=>o.value===rec)){select.value=rec;updateWarning();updateHint();}
  }

  async function refresh(manual=false){
    clearTimeout(refreshTimer);
    try{
      const r=await fetch('/api/tcp/status',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const status=await r.json();populate(status);if(!status.running)autoPrefer();
      if(manual&&window.toast)window.toast('Network adapters refreshed');
    }catch(e){const h=$('tcpInterfaceHint');if(h)h.textContent=`Unable to enumerate PC adapters: ${e.message}`;}
  }

  function bindTarget(){
    const target=$('tcpTargetHost');if(!target||target.dataset.interfaceBound)return;
    target.dataset.interfaceBound='1';
    target.addEventListener('input',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{autoPrefer();updateHint();},250);});
    target.addEventListener('change',()=>{autoPrefer();updateHint();});
  }

  function init(){if(!ensureControls())return false;bindTarget();refresh(false);return true;}
  if(!init()){
    const mo=new MutationObserver(()=>{if(init())mo.disconnect();});mo.observe(document.documentElement,{childList:true,subtree:true});
  }
  window.addEventListener('hashchange',()=>{if(location.hash==='#tcp')refresh(false);});
})();
