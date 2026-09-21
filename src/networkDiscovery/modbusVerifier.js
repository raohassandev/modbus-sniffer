'use strict';

const net=require('node:net');
const {ModbusTcpStreamParser}=require('../modbus/tcpParser');

function buildReadHoldingRequest(transactionId,unitId=1,address=0,quantity=1){
  const tid=Number(transactionId)&0xFFFF,uid=Number(unitId)&0xFF,addr=Number(address)&0xFFFF,qty=Number(quantity)&0xFFFF;
  const out=Buffer.alloc(12);
  out.writeUInt16BE(tid,0);out.writeUInt16BE(0,2);out.writeUInt16BE(6,4);out[6]=uid;out[7]=3;out.writeUInt16BE(addr,8);out.writeUInt16BE(qty,10);
  return out;
}
function verifyOne({host,port=502,unitId=1,timeoutMs=650,transactionId=0x4D45,signal=null}={}){
  return new Promise(resolve=>{
    const started=Date.now(),parser=new ModbusTcpStreamParser(),socket=new net.Socket(),request=buildReadHoldingRequest(transactionId,unitId,0,1);let settled=false,connected=false;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);try{socket.destroy();}catch{}resolve({host:String(host),port:Number(port),unitId:Number(unitId),requestHex:request.toString('hex').toUpperCase(),rttMs:result.verified?Date.now()-started:null,...result});};
    const onAbort=()=>finish({verified:false,connected,error:'cancelled',code:'NETWORK_SCAN_CANCELLED'});
    const timer=setTimeout(()=>finish({verified:false,connected,error:'timeout',code:'MODBUS_VERIFY_TIMEOUT'}),Math.max(100,Math.min(5000,Number(timeoutMs)||650)));
    signal?.addEventListener?.('abort',onAbort,{once:true});
    parser.on('frame',(frame)=>{
      if(frame.transactionId!==(Number(transactionId)&0xFFFF)||Number(frame.unitId)!==Number(unitId))return;
      const pdu=frame.pdu||frame.raw?.subarray?.(7),fc=pdu?.[0];
      if(fc===3){
        const byteCount=pdu?.[1];
        if(byteCount!==2||pdu.length!==4)return;
        finish({verified:true,connected:true,responseHex:frame.raw.toString('hex').toUpperCase(),functionCode:3,exception:false,exceptionCode:null,protocol:'Modbus TCP'});
        return;
      }
      if(fc===0x83){
        const exceptionCode=pdu?.[1];
        if(pdu.length!==2||!Number.isInteger(exceptionCode)||exceptionCode<1||exceptionCode>11)return;
        finish({verified:true,connected:true,responseHex:frame.raw.toString('hex').toUpperCase(),functionCode:3,exception:true,exceptionCode,protocol:'Modbus TCP'});
      }
    });
    parser.on('error-frame',()=>{});
    socket.on('data',chunk=>parser.push(chunk,Date.now()));
    socket.once('connect',()=>{connected=true;socket.write(request,e=>{if(e)finish({verified:false,connected:true,error:String(e.code||e.message),code:'MODBUS_VERIFY_WRITE_FAILED'});});});
    socket.once('error',e=>finish({verified:false,connected,error:String(e.code||e.message),code:'MODBUS_VERIFY_CONNECT_FAILED'}));
    socket.connect({host:String(host),port:Number(port)});
  });
}
async function verifyModbusEndpoint({host,port=502,unitIds=[1,255],timeoutMs=650,signal=null}={}){
  const units=[...new Set((unitIds||[]).map(Number).filter(x=>Number.isInteger(x)&&x>=0&&x<=255))].slice(0,16);
  const attempts=[];
  for(const unitId of units.length?units:[1]){
    if(signal?.aborted){const e=new Error('Network scan cancelled.');e.code='NETWORK_SCAN_CANCELLED';throw e;}
    const result=await verifyOne({host,port,unitId,timeoutMs,transactionId:(0x4D00+unitId)&0xFFFF,signal});attempts.push(result);
    if(result.verified)return{verified:true,host:String(host),port:Number(port),unitId,result,attempts};
    if(!result.connected&&result.code==='MODBUS_VERIFY_CONNECT_FAILED')break;
  }
  return{verified:false,host:String(host),port:Number(port),unitId:null,result:null,attempts};
}

module.exports={buildReadHoldingRequest,verifyOne,verifyModbusEndpoint};
