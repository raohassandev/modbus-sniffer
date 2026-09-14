'use strict';

const net=require('net');
const {SerialPort}=require('serialport');
const {ModbusTcpStreamParser}=require('./modbus/tcpParser');
const {FrameExtractor}=require('./modbus/frameExtractor');
const {decodeFrame}=require('./modbus/decoder');
const {appendCrc}=require('./modbus/crc16');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function abortError(){const e=new Error('Discovery scan cancelled.');e.code='DISCOVERY_CANCELLED';return e;}
function checkAbort(signal){if(signal?.aborted)throw abortError();}
function clampUnit(v,min=1,max=247){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Unit ID must be ${min}..${max}.`);return n;}
function readCode(v=1){const n=Number(v);if(![1,2,3,4].includes(n))throw new Error('Read Device Identification code must be 1..4.');return n;}
function objectMapToIdentity(map){const get=id=>map.get(id)?.value||null;return{vendorName:get(0),productCode:get(1),revision:get(2),vendorUrl:get(3),productName:get(4),modelName:get(5),userApplicationName:get(6)};}
function mergeObjects(map,objects=[]){for(const o of objects){const id=Number(o.objectId);if(!Number.isInteger(id))continue;map.set(id,{objectId:id,name:o.name||`Object${id}`,value:String(o.value??''),rawHex:o.rawHex||null});}}
function discoveryResult(unitId){return{unitId,responded:false,identificationSupported:null,exceptionCode:null,exceptionName:null,segments:[],objects:[],identification:{vendorName:null,productCode:null,revision:null,vendorUrl:null,productName:null,modelName:null,userApplicationName:null},rttMs:[]};}
function finalizeResult(result,map){result.objects=[...map.values()].sort((a,b)=>a.objectId-b.objectId);result.identification=objectMapToIdentity(map);result.avgRttMs=result.rttMs.length?Math.round(result.rttMs.reduce((a,b)=>a+b,0)/result.rttMs.length*100)/100:null;return result;}

function buildTcpDeviceIdRequest(transactionId,unitId,readDeviceIdCode=1,objectId=0){
  const tid=Number(transactionId)&0xFFFF,uid=Number(unitId)&0xFF,code=readCode(readDeviceIdCode),obj=Number(objectId)&0xFF;
  const out=Buffer.alloc(11);out.writeUInt16BE(tid,0);out.writeUInt16BE(0,2);out.writeUInt16BE(5,4);out[6]=uid;out.set([43,14,code,obj],7);return out;
}
function buildRtuDeviceIdRequest(unitId,readDeviceIdCode=1,objectId=0){return appendCrc(Buffer.from([Number(unitId)&0xFF,43,14,readCode(readDeviceIdCode),Number(objectId)&0xFF]));}

class TcpDiscoveryClient{
  constructor({host,port=502,timeoutMs=750,signal=null}={}){this.host=String(host||'').trim();this.port=Number(port);this.timeoutMs=Math.max(100,Math.min(10000,Number(timeoutMs)||750));this.signal=signal;this.socket=null;this.parser=new ModbusTcpStreamParser();this.pending=new Map();this.tid=0;this.closed=false;this.parser.on('frame',(frame,ts)=>this._frame(frame,ts));}
  async connect(){if(!this.host)throw new Error('TCP target host is required.');if(!Number.isInteger(this.port)||this.port<1||this.port>65535)throw new Error('TCP target port must be 1..65535.');checkAbort(this.signal);this.socket=net.connect({host:this.host,port:this.port});this.socket.on('data',b=>this.parser.push(b,Date.now()));this.socket.on('error',e=>this._failAll(e));this.socket.on('close',()=>{if(!this.closed)this._failAll(Object.assign(new Error('TCP discovery connection closed.'),{code:'DISCOVERY_CONNECTION_CLOSED'}));});await new Promise((resolve,reject)=>{const s=this.socket,t=setTimeout(()=>{s.destroy();reject(Object.assign(new Error(`TCP connect timeout after ${this.timeoutMs} ms.`),{code:'DISCOVERY_CONNECT_TIMEOUT'}));},this.timeoutMs);s.once('connect',()=>{clearTimeout(t);resolve();});s.once('error',e=>{clearTimeout(t);reject(e);});});return this;}
  _failAll(err){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(err);}this.pending.clear();}
  _frame(frame,ts){const p=this.pending.get(frame.transactionId);if(!p||Number(frame.unitId)!==p.unitId)return;this.pending.delete(frame.transactionId);clearTimeout(p.timer);p.resolve({frame,rttMs:ts-p.sentAt});}
  query(unitId,code=1,objectId=0){checkAbort(this.signal);const tid=this.tid=this.tid===0xFFFF?1:this.tid+1,request=buildTcpDeviceIdRequest(tid,unitId,code,objectId),sentAt=Date.now();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(tid);reject(Object.assign(new Error(`No response from Unit ${unitId} after ${this.timeoutMs} ms.`),{code:'DISCOVERY_TIMEOUT'}));},this.timeoutMs);this.pending.set(tid,{unitId:Number(unitId),sentAt,timer,resolve,reject});this.socket.write(request,e=>{if(e){clearTimeout(timer);this.pending.delete(tid);reject(e);}});});}
  close(){this.closed=true;this._failAll(abortError());try{this.socket?.destroy();}catch{}this.socket=null;}
}

async function readIdentity(query,unitId,{readDeviceIdCode=1,maxSegments=8,signal=null}={}){
  const result=discoveryResult(unitId),objects=new Map();let objectId=0;
  for(let segment=0;segment<Math.max(1,Math.min(32,Number(maxSegments)||8));segment++){
    checkAbort(signal);let reply;
    try{reply=await query(unitId,readDeviceIdCode,objectId);}catch(e){if(e.code==='DISCOVERY_TIMEOUT'&&segment===0)return finalizeResult(result,objects);throw e;}
    const d=reply.frame?.decoded||reply.decoded||reply;result.responded=true;result.rttMs.push(Number(reply.rttMs||0));
    if(d.exception){result.identificationSupported=false;result.exceptionCode=d.exceptionCode;result.exceptionName=d.exceptionName;return finalizeResult(result,objects);}
    if(Number(d.functionCode)!==43||Number(d.meiType)!==14)continue;
    result.identificationSupported=true;mergeObjects(objects,d.objects);result.segments.push({readDeviceIdCode:d.readDeviceIdCode,conformityLevel:d.conformityLevel,moreFollows:Boolean(d.moreFollows),nextObjectId:d.nextObjectId,objectIds:(d.objects||[]).map(o=>o.objectId)});
    if(!d.moreFollows)return finalizeResult(result,objects);
    const next=Number(d.nextObjectId);if(!Number.isInteger(next)||next===objectId)break;objectId=next;
  }
  result.incomplete=true;return finalizeResult(result,objects);
}

async function scanTcpDeviceIds({host,port=502,unitStart=1,unitEnd=247,timeoutMs=750,interRequestMs=75,readDeviceIdCode=1,maxSegments=8,signal=null,onProgress=null}={}){
  const start=clampUnit(unitStart,0,255),end=clampUnit(unitEnd,0,255);if(end<start)throw new Error('unitEnd must be >= unitStart.');
  const client=await new TcpDiscoveryClient({host,port,timeoutMs,signal}).connect(),results=[];
  try{for(let unitId=start;unitId<=end;unitId++){checkAbort(signal);const result=await readIdentity((u,c,o)=>client.query(u,c,o),unitId,{readDeviceIdCode,maxSegments,signal});results.push(result);onProgress?.({transport:'TCP',unitId,current:unitId-start+1,total:end-start+1,result});if(unitId<end)await sleep(Math.max(20,Number(interRequestMs)||75));}}
  finally{client.close();}
  return{transport:'TCP',mode:'active-identification',transmit:true,readOnly:true,host:String(host),port:Number(port),unitStart:start,unitEnd:end,results,responding:results.filter(r=>r.responded),identified:results.filter(r=>r.identificationSupported&&r.objects.length)};
}

async function scanRtuDeviceIds({port,baudRate=9600,dataBits=8,parity='none',stopBits=1,unitStart=1,unitEnd=247,timeoutMs=500,interRequestMs=100,readDeviceIdCode=1,maxSegments=8,maintenanceConfirmed=false,exclusiveBusConfirmed=false,signal=null,onProgress=null}={}){
  if(maintenanceConfirmed!==true||exclusiveBusConfirmed!==true){const e=new Error('RTU active discovery is blocked until maintenance mode and exclusive-bus control are both explicitly confirmed.');e.code='RTU_DISCOVERY_CONFIRMATION_REQUIRED';throw e;}
  const start=clampUnit(unitStart,1,247),end=clampUnit(unitEnd,1,247);if(end<start)throw new Error('unitEnd must be >= unitStart.');
  const serial=new SerialPort({path:String(port||''),baudRate:Number(baudRate),dataBits:Number(dataBits),parity:String(parity),stopBits:Number(stopBits),autoOpen:false}),extractor=new FrameExtractor({baudRate,dataBits,parity,stopBits});let waiter=null;
  extractor.on('frame',(raw,ts)=>{if(!waiter)return;const d=decodeFrame(raw);if(Number(d.slaveId)!==waiter.unitId||Number(d.functionCode)!==43||d.kind==='request')return;const w=waiter;waiter=null;clearTimeout(w.timer);w.resolve({decoded:d,frame:{decoded:d},raw,rttMs:ts-w.sentAt});});
  serial.on('data',b=>extractor.push(b,Date.now()));
  await new Promise((resolve,reject)=>serial.open(e=>e?reject(e):resolve()));
  const query=(unitId,code,objectId)=>new Promise((resolve,reject)=>{checkAbort(signal);const sentAt=Date.now(),timer=setTimeout(()=>{if(waiter?.unitId===unitId)waiter=null;reject(Object.assign(new Error(`No response from Slave ${unitId} after ${timeoutMs} ms.`),{code:'DISCOVERY_TIMEOUT'}));},Math.max(100,Number(timeoutMs)||500));waiter={unitId:Number(unitId),sentAt,timer,resolve,reject};const req=buildRtuDeviceIdRequest(unitId,code,objectId);serial.write(req,e=>{if(e){clearTimeout(timer);waiter=null;reject(e);return;}serial.drain(()=>{});});});
  const results=[];
  try{for(let unitId=start;unitId<=end;unitId++){checkAbort(signal);const result=await readIdentity(query,unitId,{readDeviceIdCode,maxSegments,signal});results.push(result);onProgress?.({transport:'RTU',unitId,current:unitId-start+1,total:end-start+1,result});if(unitId<end)await sleep(Math.max(50,Number(interRequestMs)||100));}}
  finally{if(waiter){clearTimeout(waiter.timer);waiter.reject(abortError());waiter=null;}extractor.flush();await new Promise(resolve=>serial.close(()=>resolve()));}
  return{transport:'RTU',mode:'active-identification',transmit:true,readOnly:true,port:String(port),serial:{baudRate:Number(baudRate),dataBits:Number(dataBits),parity:String(parity),stopBits:Number(stopBits)},unitStart:start,unitEnd:end,results,responding:results.filter(r=>r.responded),identified:results.filter(r=>r.identificationSupported&&r.objects.length)};
}

module.exports={buildTcpDeviceIdRequest,buildRtuDeviceIdRequest,TcpDiscoveryClient,readIdentity,scanTcpDeviceIds,scanRtuDeviceIds};
