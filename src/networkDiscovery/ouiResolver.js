'use strict';

const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {normalizeMac}=require('./deviceFingerprint');

function prefix(mac){
  const n=normalizeMac(mac);return n?n.replace(/:/g,'').slice(0,6):null;
}
function parseNmapPrefixes(text){
  const map=new Map();
  for(const line of String(text||'').split(/\r?\n/)){
    const m=/^([0-9A-Fa-f]{6})\s+(.+?)\s*$/.exec(line);if(m)map.set(m[1].toUpperCase(),m[2].trim().slice(0,200));
  }
  return map;
}
function parseIeeeCsv(text){
  const map=new Map(),lines=String(text||'').split(/\r?\n/);if(!lines.length)return map;
  const header=lines[0].split(',').map(x=>x.replace(/^"|"$/g,'').trim().toLowerCase()),assign=header.findIndex(x=>x==='assignment'),org=header.findIndex(x=>x.includes('organization'));
  if(assign<0||org<0)return map;
  for(const line of lines.slice(1)){
    const cols=[];let cur='',quote=false;
    for(let i=0;i<=line.length;i++){const ch=line[i];if(ch==='"'){if(quote&&line[i+1]==='"'){cur+='"';i++;}else quote=!quote;}else if((ch===','||i===line.length)&&!quote){cols.push(cur);cur='';}else if(i<line.length)cur+=ch;}
    const p=String(cols[assign]||'').replace(/[^0-9a-f]/gi,'').slice(0,6).toUpperCase(),name=String(cols[org]||'').trim();if(p.length===6&&name)map.set(p,name.slice(0,200));
  }
  return map;
}
function commonNmapFiles(){
  const home=os.homedir(),platform=os.platform(),list=[
    process.env.NMAP_MAC_PREFIXES,
    '/usr/share/nmap/nmap-mac-prefixes','/usr/local/share/nmap/nmap-mac-prefixes','/opt/homebrew/share/nmap/nmap-mac-prefixes',
    path.join(home,'.nmap','nmap-mac-prefixes')
  ];
  if(platform==='win32'){
    for(const base of [process.env['ProgramFiles'],process.env['ProgramFiles(x86)']])if(base)list.push(path.join(base,'Nmap','nmap-mac-prefixes'));
  }
  return[...new Set(list.filter(Boolean))];
}
class OuiResolver{
  constructor({dataDir=path.join(process.cwd(),'data')}={}){
    this.dataDir=dataDir;this.customFile=path.join(dataDir,'network-oui.csv');this.map=new Map();this.sources=[];this.reload();
  }
  reload(){
    const merged=new Map(),sources=[];
    for(const file of commonNmapFiles()){try{if(!fs.existsSync(file))continue;const m=parseNmapPrefixes(fs.readFileSync(file,'utf8'));for(const[k,v]of m)if(!merged.has(k))merged.set(k,v);sources.push({type:'nmap-mac-prefixes',file,count:m.size});}catch{}}
    try{if(fs.existsSync(this.customFile)){const raw=fs.readFileSync(this.customFile,'utf8'),m=parseIeeeCsv(raw);for(const[k,v]of m)merged.set(k,v);sources.push({type:'ieee-csv',file:this.customFile,count:m.size});}}catch{}
    this.map=merged;this.sources=sources;return this.status();
  }
  lookup(mac){const p=prefix(mac);return p?this.map.get(p)||null:null;}
  status(){return{available:this.map.size>0,count:this.map.size,sources:this.sources.map(x=>({...x}))};}
  importCsv(text){
    const raw=String(text||'');if(Buffer.byteLength(raw)>12*1024*1024){const e=new Error('OUI CSV exceeds 12 MB limit.');e.code='OUI_FILE_TOO_LARGE';throw e;}
    const parsed=parseIeeeCsv(raw);if(!parsed.size){const e=new Error('No IEEE MA-L assignments were found in the supplied CSV.');e.code='OUI_CSV_INVALID';throw e;}
    fs.mkdirSync(this.dataDir,{recursive:true});const tmp=`${this.customFile}.tmp-${process.pid}`;fs.writeFileSync(tmp,raw,{encoding:'utf8',mode:0o600});fs.renameSync(tmp,this.customFile);this.reload();return this.status();
  }
}
module.exports={OuiResolver,parseNmapPrefixes,parseIeeeCsv,prefix,commonNmapFiles};
