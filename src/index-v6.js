'use strict';

const readline = require('readline/promises');
const process = require('process');
const path = require('path');
const { stdin:input, stdout:output } = process;
const { parseArgs, helpText } = require('./cli');
const { PortManager } = require('./portManager');
const { FrameExtractor } = require('./modbus/frameExtractor');
const { decodeFrame } = require('./modbus/decoder');
const { AdvancedTransactionTracker } = require('./modbus/advancedTransactionTracker');
const { MeterMap } = require('./meterMap');
const { CsvLogger } = require('./csvLogger');
const { renderTransaction, renderMeters, renderPorts } = require('./consoleRenderer');
const { PlatformRuntimeState } = require('./platformRuntimeState');
const { startPlatformWebServer } = require('./platformWebServerV61');
const { ReplayController } = require('./replayController');
const { startDemo } = require('./demoGenerator');
const { WorkspaceStore } = require('./workspaceStore');
const { HistoryStore, HistoryRecorder } = require('./historyStore');
const { ModbusTcpProxy } = require('./modbusTcpProxy');
const { buildRtuChannel } = require('./transportIdentity');

const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function choosePort(ports){
  if(!ports.length)throw new Error('No serial ports found. Plug in the USB-RS485 adapter and retry.');
  if(ports.length===1){renderPorts(ports);return ports[0].path;}
  renderPorts(ports);
  const rl=readline.createInterface({input,output});
  try{const n=Number(await rl.question('Select port number: '));if(!Number.isInteger(n)||n<1||n>ports.length)throw new Error('Invalid port selection.');return ports[n-1].path;}
  finally{rl.close();}
}

function publicConfig(o,adapterIdentity=null,rtuChannel=null){
  return {
    port:o.port,baudRate:o.baudRate,parity:o.parity,dataBits:o.dataBits,stopBits:o.stopBits,reconnectMs:o.reconnectMs,
    requestTimeoutMs:o.requestTimeoutMs,autoRebind:o.autoRebind,mapFile:o.mapFile,csvFile:o.csvFile,historyLimit:o.historyLimit,
    webHost:o.webHost,webPort:o.webPort,dataDir:o.dataDir,
    adapterIdentity:adapterIdentity||null,rtuChannelId:rtuChannel?.channelId||null
  };
}

async function main(){
  let options;
  try{options=parseArgs(process.argv.slice(2));}catch(e){console.error(e.message);console.log(helpText());process.exitCode=2;return;}
  if(options.help){console.log(helpText());return;}
  const ports=options.demo?[]:await PortManager.list();
  if(options.listPorts){renderPorts(ports);return;}
  if(!options.demo&&!options.port&&!options.tcpProxy){if(!options.webEnabled)options.port=await choosePort(ports);else if(ports.length===1)options.port=ports[0].path;}

  console.log('\n=== Modbus Engineering Analyzer v6.1 ===');
  console.log(`RTU       : ${options.demo?'DEMO':options.port||'not connected'}`);
  console.log(`Web       : ${options.webEnabled?`${options.webHost}:${options.webPort}`:'disabled'}`);
  console.log(`Projects  : ${path.resolve(options.dataDir)}`);
  console.log('RTU TX    : disabled by design');
  console.log('TCP mode  : optional inline forwarding proxy; never fabricates Modbus requests\n');

  const state=new PlatformRuntimeState({historyLimit:options.historyLimit});
  const replay=new ReplayController(state);
  const meterMap=MeterMap.fromFile(options.mapFile);
  const csv=new CsvLogger(options.csvFile);
  const workspaces=new WorkspaceStore({dataDir:options.dataDir});
  const history=new HistoryStore({dataDir:path.join(options.dataDir,'history')});
  const recorder=new HistoryRecorder({state,workspaces,history,intervalMs:10000});

  let rtuIdentity=null;
  let rtuChannel=buildRtuChannel({port:options.demo?'SIMULATOR':options.port||'UNASSIGNED',identity:options.demo?{serialNumber:'DEMO'}:null,config:options,mode:options.demo?'offline':'passive'});
  const syncChannelToProject=channel=>{try{state.registerChannel(channel);workspaces.upsertChannel(workspaces.getActiveProject().id,channel);}catch(e){if(!options.quiet)console.warn(`[CHANNEL] ${e.message}`);}};
  const rebuildRtuChannel=(port=options.port)=>{rtuChannel=buildRtuChannel({port:port||'UNASSIGNED',identity:rtuIdentity,config:options,mode:options.demo?'offline':'passive'});syncChannelToProject(rtuChannel);state.setConfig(publicConfig(options,rtuIdentity,rtuChannel));return rtuChannel;};
  rebuildRtuChannel(options.demo?'SIMULATOR':options.port);

  let tracker,extractor=null,probeExtractor=null;
  const makeTracker=()=>{tracker=new AdvancedTransactionTracker({requestTimeoutMs:options.requestTimeoutMs,onTimeout:(req,ts,ms)=>state.recordTimeout(req,ts,ms,'RTU')});};
  makeTracker();

  const processTx=(tx,raw,ts=Date.now())=>{
    renderTransaction(tx,ts,raw,{raw:options.raw});
    const meters=meterMap.resolve(tx);if(meters.length)renderMeters(meters);
    csv.write(tx,ts,raw);state.recordFrame(tx,ts,raw,meters);
  };
  const processFrame=(raw,ts=Date.now())=>{
    const decoded={...decodeFrame(raw),transport:'RTU',channelId:rtuChannel.channelId,channel:rtuChannel,unitId:raw[0],slaveId:raw[0]};
    processTx(tracker.process(decoded,ts),raw,ts);
  };
  const bindExtractor=()=>{const x=new FrameExtractor(options);x.on('frame',(r,t)=>processFrame(r,t));x.on('noise',b=>state.recordNoise(b.length));extractor=x;};
  bindExtractor();

  const pm=new PortManager(options);
  pm.on('identity',identity=>{
    rtuIdentity=identity;rebuildRtuChannel(identity.path||options.port);
    if(!options.quiet)console.log(`[PORT] Adapter: ${[identity.manufacturer,identity.vendorId&&`VID=${identity.vendorId}`,identity.productId&&`PID=${identity.productId}`,identity.serialNumber&&`SN=${identity.serialNumber}`].filter(Boolean).join(' ')}`);
  });
  pm.on('open',(_p,p)=>{options.port=p;rebuildRtuChannel(p);state.setConnection(probeExtractor?'detecting':'open',{path:p,message:probeExtractor?'Testing serial format':null,channelId:rtuChannel.channelId});});
  pm.on('rebound',(from,to)=>{options.port=to;rebuildRtuChannel(to);state.setConnection('reconnecting',{path:to,message:`Rebound from ${from}`,channelId:rtuChannel.channelId});});
  pm.on('scan-error',e=>state.setConnection('error',{message:e.message}));
  pm.on('open-error',(e,p)=>state.setConnection('error',{path:p,message:e.message}));
  pm.on('port-error',e=>state.setConnection('error',{message:e.message}));
  pm.on('close',(_e,p)=>{if(!pm.stopping)state.setConnection('closed',{path:p,message:'Port closed/disconnected',channelId:rtuChannel.channelId});});
  pm.on('retry',(_r,ms)=>state.setConnection('reconnecting',{message:`Retrying in ${ms} ms`,channelId:rtuChannel.channelId}));
  pm.on('data',chunk=>(probeExtractor||extractor)?.push(chunk,Date.now()));

  const disconnectSerial=async()=>{probeExtractor=null;await pm.stop();tracker.clear();state.setConnection('idle',{path:options.port||null,message:'Serial capture disconnected',channelId:rtuChannel.channelId});};
  const configureSerial=async next=>{
    replay.stop();probeExtractor=null;extractor?.flush();Object.assign(options,next);rtuIdentity=null;rebuildRtuChannel(options.port);makeTracker();bindExtractor();state.setCaptureSource('live');state.setConfig(publicConfig(options,rtuIdentity,rtuChannel));state.setConnection('connecting',{path:options.port,message:'Applying serial configuration',channelId:rtuChannel.channelId});await pm.reconfigure(next);
  };

  const autoDetectSerial=async req=>{
    const port=String(req.port||options.port||'').trim();if(!port)throw new Error('Select a COM port before auto-detection.');
    const full=Boolean(req.full),sampleMs=Math.max(300,Math.min(3000,Number(req.sampleMs)||(full?850:700))),bauds=Array.isArray(req.baudRates)&&req.baudRates.length?req.baudRates.map(Number):(full?[2400,4800,9600,19200,38400,57600,115200]:[9600,19200,38400,115200]),parities=Array.isArray(req.parities)&&req.parities.length?req.parities.map(String):(full?['none','even','odd']:['none','even']),original={port:options.port,baudRate:options.baudRate,parity:options.parity,dataBits:options.dataBits,stopBits:options.stopBits,reconnectMs:options.reconnectMs,requestTimeoutMs:options.requestTimeoutMs},results=[];
    replay.stop();tracker.clear();
    try{
      for(const baudRate of bauds)for(const parity of parities){
        let frames=0,noiseBytes=0,bytes=0;const candidate={port,baudRate,parity,dataBits:8,stopBits:1,reconnectMs:options.reconnectMs},probe=new FrameExtractor(candidate);
        probe.on('frame',raw=>{frames++;bytes+=raw.length;});probe.on('noise',b=>{noiseBytes+=b.length;bytes+=b.length;});probeExtractor=probe;Object.assign(options,candidate);state.setConnection('detecting',{path:port,message:`Testing ${baudRate} 8${parity[0].toUpperCase()}1`,channelId:rtuChannel.channelId});let error=null;
        try{await pm.reconfigure(candidate);await sleep(sampleMs);probe.flush();}catch(e){error=e.message;}
        const cleanRatio=bytes?Math.max(0,1-noiseBytes/bytes):0,score=frames?Math.round(frames*10000+cleanRatio*1000-noiseBytes):-noiseBytes;results.push({baudRate,parity,dataBits:8,stopBits:1,frames,noiseBytes,bytes,cleanRatio:Math.round(cleanRatio*10000)/100,score,error});
      }
    }finally{probeExtractor=null;}
    results.sort((a,b)=>b.score-a.score||b.frames-a.frames||a.noiseBytes-b.noiseBytes);const best=results.find(x=>x.frames>0)||null,finalCfg=best?{port,baudRate:best.baudRate,parity:best.parity,dataBits:8,stopBits:1,reconnectMs:original.reconnectMs,requestTimeoutMs:original.requestTimeoutMs}:{...original,port:original.port||port};
    Object.assign(options,finalCfg);makeTracker();bindExtractor();state.clearCapture();state.setCaptureSource('live');state.setConfig(publicConfig(options,rtuIdentity,rtuChannel));await pm.reconfigure(finalCfg);rebuildRtuChannel(options.port);return{detected:Boolean(best),best,sampleMs,tested:results.length,candidates:results,config:publicConfig(options,rtuIdentity,rtuChannel)};
  };

  const tcpProxy=new ModbusTcpProxy({listenHost:options.tcpListenHost,listenPort:options.tcpListenPort,targetHost:options.tcpTargetHost,targetPort:options.tcpTargetPort,requestTimeoutMs:5000,onTransaction:(tx,raw,ts)=>processTx(tx,raw,ts),onTimeout:(req,ts,ms)=>state.recordTimeout(req,ts,ms,'TCP')});
  tcpProxy.on('status',status=>{if(status.channel)syncChannelToProject(status.channel);});
  tcpProxy.on('connection-error',x=>{if(!options.quiet)console.warn(`[TCP] ${x.side||'connection'}: ${x.error?.message||x.message||x}`);});
  tcpProxy.on('noise',x=>{if(!options.quiet)console.warn(`[TCP] undecodable bytes: ${x.bytes}`);});

  let web=null;
  if(options.webEnabled){web=await startPlatformWebServer({state,options,configureSerial,disconnectSerial,autoDetectSerial,replay,demo:options.demo,workspaces,history,tcpProxy});console.log(`[WEB] ${web.url}`);}
  let stopDemo=null;
  if(options.demo){state.setConnection('demo',{path:'SIMULATOR',message:'Synthetic Modbus RTU traffic',channelId:rtuChannel.channelId});stopDemo=startDemo({onFrame:processFrame,onNoise:n=>state.recordNoise(n)});}
  else if(options.port){state.setConnection('connecting',{path:options.port,message:'Opening serial port',channelId:rtuChannel.channelId});await pm.start();}
  else state.setConnection('idle',{path:null,message:options.tcpProxy?'TCP proxy mode':'Select a serial port in Settings'});
  if(options.tcpProxy){await tcpProxy.start({listenHost:options.tcpListenHost,listenPort:options.tcpListenPort,targetHost:options.tcpTargetHost,targetPort:options.tcpTargetPort});console.log(`[TCP] proxy ${options.tcpListenHost}:${options.tcpListenPort} -> ${options.tcpTargetHost}:${options.tcpTargetPort}`);}
  recorder.start();

  const timeoutTimer=setInterval(()=>tracker.expire(Date.now()),50);timeoutTimer.unref?.();
  const statsTimer=setInterval(()=>{if(options.quiet)return;const s=state.getStatus();console.log(`[STATS] frames=${s.totals.frames} devices=${s.totals.devices} regs=${s.totals.registers} timeouts=${s.totals.timeouts} avgRTT=${s.totals.avgRttMs??'-'}ms`);},10000);statsTimer.unref?.();
  let ending=false;
  const shutdown=async()=>{if(ending)return;ending=true;clearInterval(timeoutTimer);clearInterval(statsTimer);recorder.stop();replay.stop();stopDemo?.();extractor?.flush();await tcpProxy.stop();if(!options.demo)await pm.stop();if(web)await web.close();process.exit(0);};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}

main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
