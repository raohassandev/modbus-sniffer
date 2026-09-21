'use strict';

const {
  ConnectionBroker,
  MasterEngine,
  TcpClientTransport,
  TlsClientTransport,
  UdpClientTransport,
  TunnelTcpClientTransport,
  listLocalAddresses,
  recommendLocalAddress,
  protocol,
} = require('../modbusCore');

const TRANSPORTS=Object.freeze({
  tcp:Object.freeze({id:'tcp',label:'Modbus TCP',framing:'tcp',standard:true,defaultPort:502}),
  tls:Object.freeze({id:'tls',label:'Modbus TCP Security / TLS',framing:'tcp',standard:true,defaultPort:802,secure:true}),
  udp:Object.freeze({id:'udp',label:'Modbus UDP (MBAP datagram)',framing:'tcp',standard:false,defaultPort:502,datagram:true}),
  'rtu-tcp':Object.freeze({id:'rtu-tcp',label:'RTU over TCP',framing:'rtu',standard:false,defaultPort:502,tunnel:true}),
  'ascii-tcp':Object.freeze({id:'ascii-tcp',label:'ASCII over TCP',framing:'ascii',standard:false,defaultPort:502,tunnel:true}),
  'rtu-udp':Object.freeze({id:'rtu-udp',label:'RTU over UDP',framing:'rtu',standard:false,defaultPort:502,datagram:true,tunnel:true}),
  'ascii-udp':Object.freeze({id:'ascii-udp',label:'ASCII over UDP',framing:'ascii',standard:false,defaultPort:502,datagram:true,tunnel:true}),
});

class TransportLabError extends Error{
  constructor(code,message,details={}){super(message);this.name='TransportLabError';this.code=code;this.details={...details};}
}
function integer(value,fallback,{min=0,max=65535,field='value'}={}){
  const n=Number(value);
  if(!Number.isInteger(n)){
    if(fallback!==undefined)return fallback;
    throw new TransportLabError('INVALID_ARGUMENT',`${field} must be an integer`,{field,value});
  }
  if(n<min||n>max)throw new TransportLabError('INVALID_ARGUMENT',`${field} must be ${min}..${max}`,{field,value:n});
  return n;
}
function finite(value,fallback,{min=0,max=60000,field='value'}={}){
  const n=Number(value);
  if(!Number.isFinite(n)){
    if(fallback!==undefined)return fallback;
    throw new TransportLabError('INVALID_ARGUMENT',`${field} must be finite`,{field,value});
  }
  if(n<min||n>max)throw new TransportLabError('INVALID_ARGUMENT',`${field} must be ${min}..${max}`,{field,value:n});
  return n;
}
function normalizePem(value){const text=String(value||'').trim();return text||null;}
function descriptor(id){
  const item=TRANSPORTS[String(id||'tcp').toLowerCase()];
  if(!item)throw new TransportLabError('INVALID_TRANSPORT','Unsupported Transport Lab transport',{transport:id,supported:Object.keys(TRANSPORTS)});
  return item;
}
function normalizeConfig(input={}){
  const transport=descriptor(input.transport||'tcp');
  const host=String(input.host||'').trim();
  if(!host)throw new TransportLabError('INVALID_ARGUMENT','host is required');
  const port=integer(input.port,transport.defaultPort,{min:1,max:65535,field:'port'});
  const timeoutMs=finite(input.timeoutMs,1000,{min:50,max:60000,field:'timeoutMs'});
  const connectTimeoutMs=finite(input.connectTimeoutMs,3000,{min:100,max:60000,field:'connectTimeoutMs'});
  const localAddress=String(input.localAddress||'').trim()||null;
  const family=integer(input.family,0,{min:0,max:6,field:'family'});
  if(![0,4,6].includes(family))throw new TransportLabError('INVALID_ARGUMENT','family must be 0, 4 or 6');
  return Object.freeze({
    transport:transport.id,
    host,port,timeoutMs,connectTimeoutMs,localAddress,family,
    tls:Object.freeze({
      ca:normalizePem(input.tls?.ca),
      cert:normalizePem(input.tls?.cert),
      key:normalizePem(input.tls?.key),
      servername:String(input.tls?.servername||'').trim()||null,
      rejectUnauthorized:input.tls?.rejectUnauthorized!==false,
      minVersion:String(input.tls?.minVersion||'TLSv1.2'),
    }),
  });
}
function buildPdu(input={}){
  const fc=integer(input.functionCode,3,{min:1,max:255,field:'functionCode'});
  if([1,2,3,4].includes(fc)){
    return protocol.encodeReadRequest({
      functionCode:fc,
      address:integer(input.address,0,{min:0,max:65535,field:'address'}),
      quantity:integer(input.quantity,1,{min:1,max:[1,2].includes(fc)?2000:125,field:'quantity'}),
    });
  }
  if(fc===7)return protocol.encodeReadExceptionStatusRequest();
  if(fc===8){
    const subFunction=integer(input.subFunction,0,{min:0,max:65535,field:'subFunction'});
    const data=integer(input.data,0,{min:0,max:65535,field:'data'});
    if(subFunction!==0&&input.labConfirmed!==true)throw new TransportLabError('LAB_CONFIRMATION_REQUIRED','Non-zero FC08 diagnostic subfunctions require LAB confirmation',{subFunction});
    return protocol.encodeDiagnosticsRequest({subFunction,data});
  }
  if(fc===11)return protocol.encodeCommEventCounterRequest();
  if(fc===12)return protocol.encodeCommEventLogRequest();
  if(fc===17)return protocol.encodeReportServerIdRequest();
  if(fc===20){
    if(!Array.isArray(input.records)||!input.records.length)throw new TransportLabError('INVALID_ARGUMENT','FC20 records must be a non-empty array');
    return protocol.encodeReadFileRecordRequest({records:input.records.map((r,i)=>({
      fileNumber:integer(r.fileNumber,undefined,{min:0,max:65535,field:`records[${i}].fileNumber`}),
      recordNumber:integer(r.recordNumber,undefined,{min:0,max:65535,field:`records[${i}].recordNumber`}),
      recordLength:integer(r.recordLength,undefined,{min:1,max:125,field:`records[${i}].recordLength`}),
    }))});
  }
  if(fc===24)return protocol.encodeReadFifoQueueRequest({address:integer(input.address,0,{min:0,max:65535,field:'address'})});
  if(fc===43)return protocol.encodeDeviceIdRequest({
    readDeviceIdCode:integer(input.readDeviceIdCode,1,{min:1,max:4,field:'readDeviceIdCode'}),
    objectId:integer(input.objectId,0,{min:0,max:255,field:'objectId'}),
  });
  throw new TransportLabError('FUNCTION_NOT_ALLOWED','Transport Lab is read/diagnostic only. Supported FCs: 01,02,03,04,07,08,11,12,17,20,24,43/14',{functionCode:fc});
}
function createTransport(config){
  const common={host:config.host,port:config.port,localAddress:config.localAddress,family:config.family,connectTimeoutMs:config.connectTimeoutMs};
  if(config.transport==='tcp')return new TcpClientTransport(common);
  if(config.transport==='tls')return new TlsClientTransport({...common,ca:config.tls.ca,cert:config.tls.cert,key:config.tls.key,servername:config.tls.servername,rejectUnauthorized:config.tls.rejectUnauthorized,minVersion:config.tls.minVersion});
  if(config.transport==='udp')return new UdpClientTransport({host:config.host,port:config.port,localAddress:config.localAddress,family:config.family||4,receiveTimeoutMs:config.timeoutMs});
  if(config.transport==='rtu-tcp')return new TunnelTcpClientTransport({...common,framing:'rtu'});
  if(config.transport==='ascii-tcp')return new TunnelTcpClientTransport({...common,framing:'ascii'});
  if(config.transport==='rtu-udp'||config.transport==='ascii-udp')return new UdpClientTransport({host:config.host,port:config.port,localAddress:config.localAddress,family:config.family||4,receiveTimeoutMs:config.timeoutMs});
  throw new TransportLabError('INVALID_TRANSPORT','Unsupported transport',{transport:config.transport});
}
function certificateSummary(transport){
  const socket=transport?.socket;
  if(!socket||typeof socket.getPeerCertificate!=='function')return null;
  try{
    const cert=socket.getPeerCertificate(true);
    if(!cert||!Object.keys(cert).length)return null;
    return Object.freeze({
      subject:cert.subject||null,
      issuer:cert.issuer||null,
      validFrom:cert.valid_from||null,
      validTo:cert.valid_to||null,
      fingerprint256:cert.fingerprint256||null,
      serialNumber:cert.serialNumber||null,
      subjectAltName:cert.subjectaltname||null,
    });
  }catch{return null;}
}
function safeResult(value){
  if(Buffer.isBuffer(value))return value.toString('hex').toUpperCase();
  if(Array.isArray(value))return value.map(safeResult);
  if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value))out[k]=safeResult(v);return out;
  }
  if(typeof value==='bigint')return value.toString();
  return value;
}
class TransportLabService{
  interfaces(){return listLocalAddresses();}
  recommend(target){return recommendLocalAddress(String(target||'').trim());}
  transports(){return Object.freeze(Object.values(TRANSPORTS));}

  async test(input={}){
    const config=normalizeConfig(input);
    const transportInfo=descriptor(config.transport);
    const unitId=integer(input.unitId,1,{min:1,max:config.transport.includes('rtu')||config.transport.includes('ascii')?247:255,field:'unitId'});
    const pdu=buildPdu(input);
    const transport=createTransport(config);
    const broker=new ConnectionBroker();
    const connectionId=`transport-lab-${Date.now().toString(36)}`;
    const ownerId='transport-lab';
    const resourceKey=`transport-lab:${config.transport}:${config.host}:${config.port}:${config.localAddress||'*'}`;
    broker.defineConnection({
      connectionId,resourceKey,transportKind:`transport-lab-${config.transport}`,transport,
      metadata:{productMode:'transport-lab',standard:transportInfo.standard},exclusive:false,
    });
    const engine=new MasterEngine({broker,connectionId,ownerId,framing:transportInfo.framing,timeoutMs:config.timeoutMs,maxTcpConcurrency:1});
    let openedStatus=null;
    const started=process.hrtime.bigint();
    try{
      openedStatus=await engine.open();
      const result=await engine.request({unitId,pdu,timeoutMs:config.timeoutMs});
      const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
      const status=transport.status?.()||null;
      return Object.freeze({
        ok:true,
        transport:Object.freeze({...transportInfo}),
        config:Object.freeze({transport:config.transport,host:config.host,port:config.port,localAddress:config.localAddress,family:config.family,timeoutMs:config.timeoutMs}),
        request:Object.freeze({unitId,functionCode:pdu[0],pduHex:pdu.toString('hex').toUpperCase()}),
        requestRawHex:result.requestRaw?Buffer.from(result.requestRaw).toString('hex').toUpperCase():null,
        responseRawHex:result.responseRaw?Buffer.from(result.responseRaw).toString('hex').toUpperCase():null,
        responsePduHex:result.responsePdu?Buffer.from(result.responsePdu).toString('hex').toUpperCase():null,
        decoded:safeResult(result.decoded),
        rttMs:result.rttMs,
        totalElapsedMs:elapsedMs,
        transportStatus:safeResult(status),
        tls:config.transport==='tls'?Object.freeze({status:safeResult(status?.tls||null),peerCertificate:certificateSummary(transport)}):null,
        note:transportInfo.standard?null:'Convenience/non-standard encapsulation: verify support with the target vendor/device.',
      });
    }catch(error){
      const status=transport.status?.()||null;
      const wrapped=new TransportLabError(error?.code||'TRANSPORT_TEST_FAILED',String(error?.message||error),{
        causeCode:error?.code||null,
        transport:config.transport,host:config.host,port:config.port,
        transportStatus:safeResult(status),
        openedState:openedStatus?.state||null,
      });
      throw wrapped;
    }finally{
      try{await engine.close({release:true});}catch{
        try{await transport.close?.();}catch{}
      }
    }
  }
}

module.exports={TRANSPORTS,TransportLabError,TransportLabService,buildPdu,certificateSummary,createTransport,descriptor,normalizeConfig};
