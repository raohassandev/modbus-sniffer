'use strict';

const { appendCrc } = require('../src/modbus/crc16');
const { decodeFrame } = require('../src/modbus/decoder');
const { AdvancedTransactionTracker } = require('../src/modbus/advancedTransactionTracker');
const { PlatformRuntimeStateV7 } = require('../src/platformRuntimeStateV7');

function arg(name,fallback){const i=process.argv.indexOf(name);return i>=0&&i+1<process.argv.length?Number(process.argv[i+1]):fallback;}
function request(slave,address,qty){return appendCrc(Buffer.from([slave,3,address>>8,address&255,qty>>8,qty&255]));}
function response(slave,words){const data=[];for(const w of words)data.push(w>>8,w&255);return appendCrc(Buffer.from([slave,3,data.length,...data]));}

const cycles=Math.max(1000,Math.min(250000,arg('--cycles',25000)));
const deviceCount=Math.max(1,Math.min(100,arg('--devices',20)));
const minFps=Math.max(100,arg('--min-fps',500));
const maxHeapMb=Math.max(64,arg('--max-heap-mb',384));
const state=new PlatformRuntimeStateV7({historyLimit:10000});
const channel={channelId:'rtu:benchmark',transport:'RTU',mode:'passive',name:'Benchmark RTU',endpoint:'BENCH',active:true,serial:{port:'BENCH',baudRate:115200,parity:'none',dataBits:8,stopBits:1}};
state.registerChannel(channel);
const tracker=new AdvancedTransactionTracker({requestTimeoutMs:1000,onTimeout:(req,ts,ms)=>state.recordTimeout(req,ts,ms,'RTU')});
const enrich=(raw)=>({...decodeFrame(raw),transport:'RTU',channelId:channel.channelId,channel,unitId:raw[0],slaveId:raw[0]});

const started=process.hrtime.bigint();
for(let i=0;i<cycles;i++){
  const slave=1+(i%deviceCount),address=100+(i%8)*8,t=1_000_000+i*20;
  const req=request(slave,address,4),reqTx=tracker.process(enrich(req),t);state.recordFrame(reqTx,t,req,[]);
  const base=(slave*1000+i)&0xffff,rsp=response(slave,[base,(base+1)&0xffff,(base+2)&0xffff,(base+3)&0xffff]);
  const rspTx=tracker.process(enrich(rsp),t+8);state.recordFrame(rspTx,t+8,rsp,[]);
}
const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
const status=state.getStatus();
const fps=status.totals.frames/(elapsedMs/1000);
const heapMb=process.memoryUsage().heapUsed/1024/1024;
const intelligenceStarted=process.hrtime.bigint();
const intelligence=state.getIntelligenceSummary();
const intelligenceMs=Number(process.hrtime.bigint()-intelligenceStarted)/1e6;

if(status.totals.frames!==cycles*2)throw new Error(`Frame count mismatch ${status.totals.frames}/${cycles*2}.`);
if(status.totals.devices!==deviceCount)throw new Error(`Device count mismatch ${status.totals.devices}/${deviceCount}.`);
if(fps<minFps)throw new Error(`Processing throughput ${fps.toFixed(0)} frames/s is below ${minFps}.`);
if(heapMb>maxHeapMb)throw new Error(`Heap ${heapMb.toFixed(1)} MB exceeds ${maxHeapMb} MB.`);
if(!intelligence||typeof intelligence!=='object')throw new Error('V7 intelligence summary was not produced.');

console.log('=== V7 PERFORMANCE BUDGET ===');
console.log(`PASS frames              ${status.totals.frames.toLocaleString()}`);
console.log(`PASS devices             ${status.totals.devices}`);
console.log(`PASS throughput          ${fps.toFixed(0)} frames/s >= ${minFps}`);
console.log(`PASS heap                ${heapMb.toFixed(1)} MB <= ${maxHeapMb}`);
console.log(`PASS intelligence build  ${intelligenceMs.toFixed(1)} ms`);
console.log(`INFO capture processing  ${elapsedMs.toFixed(1)} ms`);
