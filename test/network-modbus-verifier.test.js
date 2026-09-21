'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {verifyOne}=require('../src/networkDiscovery/modbusVerifier');

async function withServer(handler,fn){
  const server=net.createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{return await fn(server.address().port);}
  finally{await new Promise(resolve=>server.close(()=>resolve()));}
}

test('Modbus verifier rejects a TCP service that only echoes the FC03 request',async()=>{
  await withServer(socket=>socket.on('data',data=>socket.write(data)),async port=>{
    const result=await verifyOne({host:'127.0.0.1',port,unitId:1,timeoutMs:140});
    assert.equal(result.connected,true);
    assert.equal(result.verified,false);
    assert.equal(result.code,'MODBUS_VERIFY_TIMEOUT');
  });
});

test('Modbus verifier accepts a semantically valid FC03 exception response',async()=>{
  await withServer(socket=>socket.once('data',request=>{
    const response=Buffer.alloc(9);
    request.copy(response,0,0,4);
    response.writeUInt16BE(4,4);
    response[6]=request[6];
    response[7]=0x83;
    response[8]=2;
    socket.write(response);
  }),async port=>{
    const result=await verifyOne({host:'127.0.0.1',port,unitId:7,timeoutMs:500});
    assert.equal(result.verified,true);
    assert.equal(result.exception,true);
    assert.equal(result.exceptionCode,2);
  });
});

test('Modbus verifier accepts a one-register FC03 data response',async()=>{
  await withServer(socket=>socket.once('data',request=>{
    const response=Buffer.alloc(11);
    request.copy(response,0,0,4);
    response.writeUInt16BE(5,4);
    response[6]=request[6];
    response[7]=3;
    response[8]=2;
    response.writeUInt16BE(0x1234,9);
    socket.write(response);
  }),async port=>{
    const result=await verifyOne({host:'127.0.0.1',port,unitId:1,timeoutMs:500});
    assert.equal(result.verified,true);
    assert.equal(result.exception,false);
    assert.equal(result.functionCode,3);
  });
});
