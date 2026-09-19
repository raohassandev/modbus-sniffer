'use strict';

(()=>{
  const q=id=>document.getElementById(id);
  const root=q('page-master');
  const format=q('masterFormat');
  const body=q('masterDataBody');
  if(!root||!format||!body||q('masterPrecision'))return;

  const formats=[
    ['uint16','uint16'],['int16','int16'],['uint32','uint32 (2 regs)'],['int32','int32 (2 regs)'],
    ['float32','float32 (2 regs)'],['uint64','uint64 (4 regs)'],['int64','int64 (4 regs)'],['float64','float64 (4 regs)'],
    ['hex','HEX'],['binary','Binary'],['ascii','ASCII']
  ];
  const selected=format.value||'uint16';
  format.innerHTML=formats.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
  format.value=formats.some(([value])=>value===selected)?selected:'uint16';

  const formatGrid=root.querySelector('.master-format-grid');
  if(formatGrid){
    formatGrid.insertAdjacentHTML('beforeend','<label>Precision<input id="masterPrecision" type="number" min="0" max="12" step="1" value="3"></label>');
  }

  const orderWrap=root.querySelector('.master-byte-order');
  const orderButtons=orderWrap?[...orderWrap.querySelectorAll('button')]:[];
  const orders=['ABCD','BADC','CDAB','DCBA'];
  orderButtons.forEach((button,index)=>{
    const order=orders[index]||'ABCD';button.disabled=false;button.dataset.masterOrder=order;button.textContent=order;
    button.title=order==='ABCD'?'Normal byte and word order':order==='BADC'?'Swap bytes within each 16-bit register':order==='CDAB'?'Reverse 16-bit register order':'Reverse all bytes';
  });

  const state={order:'ABCD',rendering:false};
  const wordCount=type=>['uint32','int32','float32'].includes(type)?2:['uint64','int64','float64'].includes(type)?4:1;
  const precision=()=>Math.max(0,Math.min(12,Number(q('masterPrecision')?.value??3)));
  const scale=()=>Number(q('masterScale')?.value??1);
  const offset=()=>Number(q('masterOffset')?.value??0);
  const setHtml=(node,html)=>{if(node&&node.innerHTML!==html)node.innerHTML=html;};
  const setText=(node,text)=>{const next=String(text);if(node&&node.textContent!==next)node.textContent=next;};

  function rawWord(row){
    const cell=row.cells?.[3];if(!cell)return null;
    const match=String(cell.textContent||'').trim().match(/0x([0-9a-f]+)/i);if(!match)return null;
    const value=parseInt(match[1],16);return Number.isInteger(value)&&value>=0&&value<=0xffff?value:null;
  }

  function reorderedBytes(words,order){
    let bytes=[];
    for(const word of words)bytes.push((word>>8)&0xff,word&0xff);
    if(order==='BADC'){
      const out=[];for(let i=0;i<bytes.length;i+=2)out.push(bytes[i+1],bytes[i]);bytes=out;
    }else if(order==='CDAB'){
      const out=[];for(let i=bytes.length-2;i>=0;i-=2)out.push(bytes[i],bytes[i+1]);bytes=out;
    }else if(order==='DCBA')bytes=bytes.reverse();
    return Uint8Array.from(bytes);
  }

  function numericValue(type,words){
    if(type==='uint16')return words[0];
    if(type==='int16')return words[0]&0x8000?words[0]-0x10000:words[0];
    const bytes=reorderedBytes(words,state.order),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(type==='uint32')return view.getUint32(0,false);
    if(type==='int32')return view.getInt32(0,false);
    if(type==='float32')return view.getFloat32(0,false);
    if(type==='float64')return view.getFloat64(0,false);
    if(type==='uint64'&&typeof view.getBigUint64==='function')return view.getBigUint64(0,false);
    if(type==='int64'&&typeof view.getBigInt64==='function')return view.getBigInt64(0,false);
    return null;
  }

  function applyEngineering(value){
    const s=scale(),o=offset(),p=precision();
    if(typeof value==='bigint'){
      const max=BigInt(Number.MAX_SAFE_INTEGER),min=BigInt(Number.MIN_SAFE_INTEGER);
      if(value<=max&&value>=min){const n=Number(value)*s+o;return Number.isFinite(n)?n.toFixed(p):String(n);}
      if(s===1&&o===0)return value.toString();
      const n=Number(value)*s+o;return `~${Number.isFinite(n)?n.toPrecision(Math.max(1,Math.min(12,p||6))):String(n)}`;
    }
    const n=Number(value)*s+o;
    if(!Number.isFinite(n))return String(n);
    return n.toFixed(p);
  }

  function asciiValue(word){
    const hi=(word>>8)&0xff,lo=word&0xff;
    const char=b=>b>=32&&b<=126?String.fromCharCode(b):'·';
    return `${char(hi)}${char(lo)}`;
  }

  function binaryValue(word){return `0b${Number(word).toString(2).padStart(16,'0')}`;}
  function hexValue(word){return `0x${Number(word).toString(16).toUpperCase().padStart(4,'0')}`;}

  function render(){
    if(state.rendering)return;state.rendering=true;
    try{
      const rows=[...body.querySelectorAll('tr')].filter(row=>row.cells?.length>=8);
      if(!rows.length)return;
      const type=format.value||'uint16',needed=wordCount(type);
      const bitMode=Number(q('masterFunction')?.value||3)<=2;
      for(let i=0;i<rows.length;i++){
        const row=rows[i],formatted=row.cells[4],typeCell=row.cells[5];
        if(!formatted||!typeCell)continue;
        if(bitMode){
          const word=rawWord(row);setHtml(formatted,`<strong>${word?'ON / 1':'OFF / 0'}</strong>`);setText(typeCell,'bool');continue;
        }
        const word=rawWord(row);if(word==null)continue;
        if(type==='hex'){setHtml(formatted,`<strong>${hexValue(word)}</strong>`);setText(typeCell,'hex');continue;}
        if(type==='binary'){setHtml(formatted,`<strong>${binaryValue(word)}</strong>`);setText(typeCell,'binary');continue;}
        if(type==='ascii'){setHtml(formatted,`<strong>${asciiValue(word)}</strong>`);setText(typeCell,'ASCII');continue;}
        if(needed===1){const value=numericValue(type,[word]);setHtml(formatted,`<strong>${applyEngineering(value)}</strong>`);setText(typeCell,type);continue;}
        if(i%needed!==0){setHtml(formatted,'<span class="muted">↳ grouped above</span>');setText(typeCell,'continuation');continue;}
        const words=rows.slice(i,i+needed).map(rawWord);
        if(words.length<needed||words.some(value=>value==null)){
          setHtml(formatted,`<span class="muted">Need ${needed} registers</span>`);setText(typeCell,type);continue;
        }
        const value=numericValue(type,words);
        setHtml(formatted,value==null?'<span class="muted">Unsupported</span>':`<strong>${applyEngineering(value)}</strong>`);
        setText(typeCell,`${type} · ${state.order}`);
      }
    }finally{state.rendering=false;}
  }

  orderWrap?.addEventListener('click',event=>{
    const button=event.target.closest('[data-master-order]');if(!button)return;
    state.order=button.dataset.masterOrder||'ABCD';
    orderButtons.forEach(node=>node.classList.toggle('active',node===button));
    render();
    root.dispatchEvent(new CustomEvent('master-format-change',{bubbles:true,detail:{byteOrder:state.order}}));
  });

  for(const id of ['masterFormat','masterScale','masterOffset','masterPrecision']){
    q(id)?.addEventListener(id==='masterFormat'?'change':'input',render);
    q(id)?.addEventListener('change',render);
  }
  q('masterFunction')?.addEventListener('change',render);

  const observer=new MutationObserver(()=>render());
  observer.observe(body,{childList:true,subtree:true,characterData:true});

  window.ModbusMasterFormat=Object.freeze({
    getByteOrder:()=>state.order,
    setByteOrder:order=>{
      const normalized=orders.includes(order)?order:'ABCD';state.order=normalized;
      orderButtons.forEach(button=>button.classList.toggle('active',button.dataset.masterOrder===normalized));render();
    },
    render,
    wordCount,
  });
  render();
})();