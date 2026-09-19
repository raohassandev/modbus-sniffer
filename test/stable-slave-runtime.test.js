'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const { SlaveRuntime }=require('../src/slave/slaveRuntime');
const { protocol }=require('../src/modbusCore');
const { sameSerialPort }=require('../src/slave/slaveRoutes');

function readTcpFrame(socket,timeoutMs=1500){
  return new Promise((resolve,reject)=>{
    let buffer=Buffer.alloc(0),timer=null;
    const cleanup=()=>{socket.off('data',onData);socket.off('error',onError);if(timer)clearTimeout(timer);};
    const onError=error=>{cleanup();reject(error);};
    const onData=chunk=>{
      buffer=Buffer.concat([buffer,Buffer.from(chunk)]);
      if(buffer.length<6)return;
      const length=buffer.readUInt16BE(4);
      const total=6+length;
      if(buffer.length<total)return;
      cleanup();resolve(buffer.subarray(0,total));
    };
    socket.on('data',onData);socket.once('error',onError);
    timer=setTimeout(()=>{cleanup();reject(new Error('TCP response timeout'));},timeoutMs);
  });
}

test('stable Slave runtime serves real Modbus TCP reads/writes and preserves exported memory',async t=>{
  const runtime=new SlaveRuntime();
  t.after(()=>runtime.shutdown());
  const started=await runtime.start({type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
  assert.equal(started.running,true);
  assert.ok(started.listenAddress?.port>0);

  runtime.seedMemory({unitId:1,area:'holdingRegisters',address:0,values:[123,456]});

  const socket=net.createConnection({host:'127.0.0.1',port:started.listenAddress.port});
  t.after(()=>socket.destroy());
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});

  const readPdu=protocol.encodeReadRequest({functionCode:protocol.FC.READ_HOLDING_REGISTERS,address:0,quantity:2});
  socket.write(protocol.encodeTcpAdu({transactionId:7,unitId:1,pdu:readPdu}));
  const readAdu=protocol.decodeTcpAdu(await readTcpFrame(socket));
  assert.equal(readAdu.transactionId,7);
  assert.equal(readAdu.unitId,1);
  assert.deepEqual(protocol.decodeReadRegistersResponse(readAdu.pdu,{expectedQuantity:2}).values,[123,456]);

  const writePdu=protocol.encodeWriteSingleRegisterRequest({address:1,value:789});
  socket.write(protocol.encodeTcpAdu({transactionId:8,unitId:1,pdu:writePdu}));
  const writeAdu=protocol.decodeTcpAdu(await readTcpFrame(socket));
  assert.equal(writeAdu.transactionId,8);
  assert.equal(writeAdu.unitId,1);
  const echoed=protocol.decodeWriteSingleRequest(writeAdu.pdu);
  assert.equal(echoed.address,1);
  assert.equal(echoed.value,789);
  assert.deepEqual(runtime.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:2}).values,[123,789]);

  const status=runtime.status();
  assert.ok(status.server.stats.requests>=2);
  assert.ok(status.server.stats.responses>=2);
  assert.ok(status.clients.length>=1);
  assert.ok(runtime.getEvents({limit:50}).some(event=>event.type==='traffic.rx'));
  assert.ok(runtime.getEvents({limit:50}).some(event=>event.type==='traffic.tx'));

  const exported=runtime.exportConfig();
  await runtime.stop();

  const restored=new SlaveRuntime();
  t.after(()=>restored.shutdown());
  const imported=await restored.importConfig(exported);
  assert.equal(imported.running,false);
  assert.deepEqual(restored.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:2}).values,[123,789]);
});

test('stable Slave serial resource comparison is case-insensitive',()=>{
  assert.equal(sameSerialPort('COM5','com5'),true);
  assert.equal(sameSerialPort('/dev/ttyUSB0','/dev/ttyUSB0'),true);
  assert.equal(sameSerialPort('COM5','COM6'),false);
});

test('stable Slave workspace is loaded and parses as standalone browser extension',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/slave-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/slave-v7.css'),'utf8');
  new vm.Script(ui,{filename:'slave-v7.js'});
  assert.match(loader,/slave-v7\.css/);
  assert.match(loader,/slave\.src='\/slave-v7\.js/);
  assert.match(ui,/Modbus Slave \/ Server/);
  assert.match(ui,/\/api\/slave\/start/);
  assert.match(ui,/Holding Registers \(4xxxx\)/);
  assert.match(ui,/PASSIVE_CAPTURE_ACTIVE/);
  assert.match(ui,/MASTER_ACTIVE/);
  assert.match(css,/\.slave-memory-wrap/);
});
