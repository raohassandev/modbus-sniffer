'use strict';

const net=require('node:net');
const dns=require('node:dns').promises;
const http=require('node:http');
const https=require('node:https');
const tls=require('node:tls');

const SERVICE_CATALOG=Object.freeze({
  22:{name:'SSH',category:'network'},23:{name:'Telnet',category:'network'},53:{name:'DNS',category:'network'},
  80:{name:'HTTP',category:'web'},102:{name:'Siemens S7',category:'industrial-candidate'},123:{name:'NTP',category:'network'},
  161:{name:'SNMP',category:'network-candidate'},443:{name:'HTTPS',category:'web'},502:{name:'Modbus TCP',category:'modbus-candidate'},
  802:{name:'Modbus TCP Security',category:'modbus-candidate'},1883:{name:'MQTT',category:'industrial-candidate'},
  4840:{name:'OPC UA',category:'industrial-candidate'},8883:{name:'MQTT TLS',category:'industrial-candidate'},
  44818:{name:'EtherNet/IP',category:'industrial-candidate'},
});
const PROFILE_PORTS=Object.freeze({
  quick:[80,443,502,22],
  standard:[22,23,80,102,443,502,802,1883,4840,8883,44818],
  modbus:[502,802],
  deep:[21,22,23,25,53,80,102,110,123,135,139,161,389,443,445,502,587,802,1433,1883,3306,3389,4840,5432,8080,8443,8883,44818],
});
function abortError(){const e=new Error('Network scan cancelled.');e.code='NETWORK_SCAN_CANCELLED';return e;}
function ensureNotAborted(signal){if(signal?.aborted)throw abortError();}
function normalizePorts(ports){
  const out=[];for(const value of ports||[]){const p=Number(value);if(Number.isInteger(p)&&p>=1&&p<=65535&&!out.includes(p))out.push(p);}
  return out.slice(0,512);
}
function profilePorts(profile='standard',customPorts=[]){
  const key=String(profile||'standard').toLowerCase();
  const base=PROFILE_PORTS[key]||PROFILE_PORTS.standard;
  return normalizePorts([...base,...customPorts]);
}
function connectProbe(host,port,{timeoutMs=350,signal=null}={}){
  ensureNotAborted(signal);
  return new Promise(resolve=>{
    const started=Date.now(),socket=new net.Socket();let settled=false;
    const finish=(open,error=null)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);socket.removeAllListeners();try{socket.destroy();}catch{}resolve({port:Number(port),open:Boolean(open),rttMs:open?Date.now()-started:null,error:error?String(error.code||error.message||error):null});};
    const onAbort=()=>finish(false,'cancelled');
    const timer=setTimeout(()=>finish(false,'timeout'),Math.max(50,Math.min(5000,Number(timeoutMs)||350)));
    signal?.addEventListener?.('abort',onAbort,{once:true});
    socket.once('connect',()=>finish(true));
    socket.once('error',e=>finish(false,e));
    socket.connect({host,port:Number(port)});
  });
}
async function scanTcpServices(host,{ports=PROFILE_PORTS.standard,timeoutMs=350,concurrency=8,signal=null,onResult=null}={}){
  const list=normalizePorts(ports),limit=Math.max(1,Math.min(64,Number(concurrency)||8)),results=new Array(list.length);let cursor=0;
  async function worker(){
    while(true){
      ensureNotAborted(signal);const i=cursor++;if(i>=list.length)return;
      const probe=await connectProbe(host,list[i],{timeoutMs,signal});results[i]=probe;onResult?.(probe);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,list.length||1)},worker));
  return results.filter(Boolean).map(row=>({...row,...(SERVICE_CATALOG[row.port]||{name:'Unknown TCP',category:'unknown'})}));
}
async function reverseDns(host,{timeoutMs=700}={}){
  let timer;try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('DNS timeout'),{code:'DNS_TIMEOUT'})),Math.max(50,Math.min(5000,Number(timeoutMs)||700)));});
    const names=await Promise.race([dns.reverse(host),timeout]);return Array.isArray(names)?names.slice(0,8):[];
  }catch{return[];}finally{clearTimeout(timer);}
}
function sanitizeText(v,max=300){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function fetchHttpMetadata(host,port,{httpsMode=false,timeoutMs=900,signal=null}={}){
  ensureNotAborted(signal);
  return new Promise(resolve=>{
    const mod=httpsMode?https:http;let req;const finish=value=>{signal?.removeEventListener?.('abort',onAbort);try{req?.destroy();}catch{}resolve(value);};
    const onAbort=()=>finish({ok:false,error:'cancelled'});signal?.addEventListener?.('abort',onAbort,{once:true});
    req=mod.request({host,port:Number(port),method:'GET',path:'/',timeout:Math.max(100,Math.min(5000,Number(timeoutMs)||900)),rejectUnauthorized:false,headers:{'User-Agent':'Modbus-Engineering-Tool/Network-Discovery','Connection':'close'}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>{if(body.length<65536)body+=chunk.slice(0,65536-body.length);});
      res.on('end',()=>{
        const title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]||'';
        finish({ok:true,statusCode:res.statusCode||null,title:sanitizeText(title,200),server:sanitizeText(res.headers.server||'',200),location:sanitizeText(res.headers.location||'',300),contentType:sanitizeText(res.headers['content-type']||'',120)});
      });
    });
    req.once('timeout',()=>finish({ok:false,error:'timeout'}));req.once('error',e=>finish({ok:false,error:String(e.code||e.message)}));req.end();
  });
}
function fetchTlsCertificate(host,port=443,{timeoutMs=1000,signal=null}={}){
  ensureNotAborted(signal);
  return new Promise(resolve=>{
    let settled=false;const socket=tls.connect({host,port:Number(port),servername:net.isIP(host)?undefined:host,rejectUnauthorized:false});
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);try{socket.destroy();}catch{}resolve(value);};
    const onAbort=()=>finish({ok:false,error:'cancelled'});signal?.addEventListener?.('abort',onAbort,{once:true});
    const timer=setTimeout(()=>finish({ok:false,error:'timeout'}),Math.max(100,Math.min(5000,Number(timeoutMs)||1000)));
    socket.once('secureConnect',()=>{
      const cert=socket.getPeerCertificate(true)||{};
      finish({ok:true,authorized:Boolean(socket.authorized),authorizationError:socket.authorizationError||null,subject:cert.subject||null,issuer:cert.issuer||null,subjectaltname:sanitizeText(cert.subjectaltname||'',500),validFrom:cert.valid_from||null,validTo:cert.valid_to||null,fingerprint256:cert.fingerprint256||null,serialNumber:cert.serialNumber||null});
    });
    socket.once('error',e=>finish({ok:false,error:String(e.code||e.message)}));
  });
}
function classifyServices(rows=[]){
  const open=rows.filter(x=>x.open);return{
    open,
    industrial:open.filter(x=>x.category==='industrial-candidate'||x.category==='modbus-candidate'),
    modbusCandidates:open.filter(x=>x.category==='modbus-candidate'),
    web:open.filter(x=>x.category==='web'),
  };
}

module.exports={SERVICE_CATALOG,PROFILE_PORTS,profilePorts,normalizePorts,connectProbe,scanTcpServices,reverseDns,fetchHttpMetadata,fetchTlsCertificate,classifyServices,abortError,ensureNotAborted};
