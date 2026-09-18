'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { PortManager } = require('./portManager');
const { enrichMappings } = require('./engineering');
const { analyzeDeep } = require('./deepDiagnostics');
const { reportHtml } = require('./reportGenerator');
const { collectExportModel, buildWorkbook, buildPdf, streamProjectZip, safeName } = require('./exportBundle');
const { makeDeviceKey, parseDeviceKey } = require('./transportIdentity');
const { installActiveDiscoveryRoutes } = require('./activeDiscoveryRoutes');
const { installMasterRoutes } = require('./master/masterRoutes');
const { installSlaveRoutes } = require('./slave/slaveRoutes');
const { installDeviceCloneRoutes } = require('./deviceClone/deviceCloneRoutes');
const { installTestSequenceRoutes } = require('./testSequences/testSequenceRoutes');
const { EvidenceHub, mergeEvidence } = require('./evidence/evidenceHub');
const { analyzeProtocolTraffic } = require('./evidence/protocolDiagnostics');
const registerCodec = require('./register/registerCodec');
const { installLoggerTrendRoutes } = require('./loggerTrend/loggerTrendRoutes');
const { installCompareRoutes } = require('./compare/compareRoutes');
const { installTransportLabRoutes } = require('./transportLab/transportLabRoutes');

function csvEscape(v) {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[\t\r\n ]*[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, name, rows, cols) {
  const lines = [cols.map(c => csvEscape(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map(c => csvEscape(c.value(r))).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(lines.join('\r\n'));
}

function validateSerialConfig(body) {
  const port = String(body.port || '').trim();
  const baudRate = Number(body.baudRate), dataBits = Number(body.dataBits), stopBits = Number(body.stopBits);
  const parity = String(body.parity || '').toLowerCase();
  const reconnectMs = Number(body.reconnectMs || 2000), requestTimeoutMs = Number(body.requestTimeoutMs || 1000);
  if (!port) throw new Error('Serial port is required.');
  if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 4000000) throw new Error('Invalid baud rate.');
  if (![5,6,7,8].includes(dataBits)) throw new Error('dataBits must be 5, 6, 7, or 8.');
  if (![1,2].includes(stopBits)) throw new Error('stopBits must be 1 or 2.');
  if (!['none','even','odd','mark','space'].includes(parity)) throw new Error('Invalid parity.');
  if (!Number.isFinite(reconnectMs) || reconnectMs < 250) throw new Error('Reconnect interval must be at least 250 ms.');
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 50 || requestTimeoutMs > 60000) throw new Error('Request timeout must be 50..60000 ms.');
  return { port, baudRate, dataBits, stopBits, parity, reconnectMs, requestTimeoutMs };
}

function isLoopbackHost(host){
  const h=String(host||'').trim().toLowerCase();
  return h==='127.0.0.1'||h==='localhost'||h==='::1'||h==='[::1]';
}

function validateTcp(body) {
  const cfg = {
    listenHost: String(body.listenHost || '127.0.0.1').trim(),
    listenPort: Number(body.listenPort || 1502),
    targetHost: String(body.targetHost || '').trim(),
    targetPort: Number(body.targetPort || 502),
    requestTimeoutMs: Number(body.requestTimeoutMs || 5000),
    maxClientSessions: Number(body.maxClientSessions || 8)
  };
  if (!cfg.listenHost) throw new Error('TCP listen host is required.');
  if (!cfg.targetHost) throw new Error('TCP target host is required.');
  for (const k of ['listenPort','targetPort']) if (!Number.isInteger(cfg[k]) || cfg[k] < 1 || cfg[k] > 65535) throw new Error(`${k} must be 1..65535.`);
  if (cfg.requestTimeoutMs < 50 || cfg.requestTimeoutMs > 60000) throw new Error('TCP request timeout must be 50..60000 ms.');
  if (!Number.isInteger(cfg.maxClientSessions) || cfg.maxClientSessions < 1 || cfg.maxClientSessions > 128) throw new Error('TCP maximum client sessions must be 1..128.');
  if(!isLoopbackHost(cfg.listenHost)&&body.confirmExternalBind!==true){
    const e=new Error(`Binding the Modbus TCP proxy to ${cfg.listenHost} exposes it beyond this computer. Confirm the external bind explicitly before starting.`);
    e.code='EXTERNAL_BIND_CONFIRMATION_REQUIRED';throw e;
  }
  return cfg;
}

function sameOriginRequest(req){
  const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
  if(site&&site!=='same-origin'&&site!=='none')return false;
  const origin=req.headers.origin;
  if(!origin)return true;
  try{return new URL(origin).host===String(req.headers.host||'');}catch{return false;}
}

function mutationBodyLimit(req){
  return ['/api/capture/import','/api/workspace/import'].includes(req.path) ? 25*1024*1024 : 2*1024*1024;
}

async function startPlatformWebServer({ state, options, configureSerial, disconnectSerial, autoDetectSerial, replay, demo = false, workspaces, history, tcpProxy }) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', verifyClient:({origin,req})=>!origin||sameOriginRequest({headers:{...req.headers,origin}}) });
  const publicDir = path.join(__dirname, '..', 'public');
  const baseHtml = fs.readFileSync(path.join(publicDir, 'v4.html'), 'utf8');
  const workbench = baseHtml
    .replace('UI v4.0', 'UI v7.0')
    .replace('</body>', '<link rel="stylesheet" href="/platform-v6.css?v=20260915"><script src="/platform-v6.js?v=20260915-1"></script></body>');
  const mutationMethods=new Set(['POST','PUT','PATCH','DELETE']);
  const rateBuckets=new Map();

  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache, no-store, must-revalidate');
    if(!mutationMethods.has(req.method))return next();
    if(!sameOriginRequest(req))return res.status(403).json({error:'Cross-origin state-changing request blocked.',code:'CROSS_ORIGIN_MUTATION_BLOCKED'});
    const length=Number(req.headers['content-length']||0),limit=mutationBodyLimit(req);
    if(Number.isFinite(length)&&length>limit)return res.status(413).json({error:`Request body exceeds ${Math.round(limit/1024/1024)} MB limit.`,code:'REQUEST_BODY_TOO_LARGE'});
    const ip=req.socket?.remoteAddress||'local',now=Date.now(),bucket=rateBuckets.get(ip)||{start:now,count:0};
    if(now-bucket.start>=60000){bucket.start=now;bucket.count=0;}bucket.count++;rateBuckets.set(ip,bucket);
    if(bucket.count>600)return res.status(429).json({error:'Too many state-changing requests. Retry shortly.',code:'MUTATION_RATE_LIMIT'});
    next();
  });
  app.use(express.json({ limit: '25mb' }));

  const broadcast = (type,payload) => {
    const msg = JSON.stringify({ type, payload });
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };
  const evidence = new EvidenceHub({ maxRows: 20000 });
  let slaveRuntime=null;
  const masterRuntime=installMasterRoutes({
    app,state,demo,disconnectSerial,
    getSlaveStatus:()=>slaveRuntime?.status?.()||null,
    disconnectSlave:async()=>{ if(slaveRuntime) await slaveRuntime.stop(); }
  });
  const activeDiscovery=installActiveDiscoveryRoutes({app,state,demo,broadcast,workspaces,getActiveProjectId:()=>workspaces.getActiveProject()?.id||null,masterRuntime});
  slaveRuntime=installSlaveRoutes({app,state,demo,disconnectSerial,masterRuntime,activeDiscovery,broadcast});
  const deviceClone=installDeviceCloneRoutes({app,state,slaveRuntime,broadcast});
  const testSequences=installTestSequenceRoutes({app,masterRuntime,broadcast});
  const loggerTrend=installLoggerTrendRoutes({app,state,masterRuntime,broadcast});
  installCompareRoutes({app});
  installTransportLabRoutes({app});

  const publishEvidenceRow = row => { if(row){ loggerTrend.ingestEvidence(row); broadcast('transaction',row); } };
  const onMasterEvent = event => publishEvidenceRow(evidence.ingest(event,{sourceType:'Master'}));
  const onSlaveEvent = event => {
    broadcast('slave-event',event);
    publishEvidenceRow(evidence.ingest(event,{sourceType:'Slave'}));
  };
  const onTestSequenceEvent = event => publishEvidenceRow(evidence.ingestAnnotation(event,{sourceType:'Test Sequence',direction:'TEST'}));
  const onDiscoveryEvidence = event => publishEvidenceRow(evidence.ingest(event,{sourceType:'Discovery'}));
  let lastDiscoveryEvidenceKey='';
  const onDiscoveryStatus = status => {
    const progress=status?.progress||null;
    const key=`${status?.jobId||''}:${status?.state||''}:${progress?.current||0}:${progress?.unitId??''}`;
    if(!status?.jobId||key===lastDiscoveryEvidenceKey)return;
    lastDiscoveryEvidenceKey=key;
    const event={
      timestamp:Date.now(),
      type:progress?.unitId!=null?'discovery.unit-result':`discovery.${status.state||'status'}`,
      source:'active-discovery',
      ownerMode:'discovery',
      unitId:progress?.unitId??null,
      functionCode:43,
      details:{
        transport:status.transport||progress?.transport||null,
        jobId:status.jobId,
        state:status.state,
        progress:progress?{...progress}:null,
        summary:status.summary?{...status.summary}:null
      }
    };
    publishEvidenceRow(evidence.ingestAnnotation(event,{sourceType:'Discovery',direction:'DISCOVERY'}));
  };
  masterRuntime.on('event',onMasterEvent);
  slaveRuntime.on('event',onSlaveEvent);
  testSequences.on('event',onTestSequenceEvent);
  activeDiscovery.on('evidence',onDiscoveryEvidence);
  activeDiscovery.on('status',onDiscoveryStatus);
  const unifiedTransactions = (filters={}) => {
    const requestedLimit=Math.max(1,Math.min(20000,Number(filters.limit)||1000));
    const sourceFilter=String(filters.sourceType||'').trim().toLowerCase();
    const passiveAllowed=!sourceFilter||sourceFilter==='sniffer'||sourceFilter==='passive'||sourceFilter==='passive analyzer';
    const activeAllowed=!sourceFilter||!passiveAllowed;
    const passive=passiveAllowed
      ? state.getTransactions({...filters,limit:requestedLimit}).map(row=>({
          ...row,
          sourceType:'Sniffer',
          source:row.source||'passive-analyzer',
          ownerMode:row.ownerMode||'sniffer'
        }))
      : [];
    const activeRows=activeAllowed?evidence.list({...filters,limit:requestedLimit}):[];
    return mergeEvidence(passive,activeRows,{limit:requestedLimit});
  };
  const active = () => workspaces.getActiveProject();
  const apiError = (r,e,defaultStatus=400) => r.status(e?.code==='AMBIGUOUS_DEVICE'?409:defaultStatus).json({error:e.message,code:e.code||null,deviceKeys:e.deviceKeys||undefined});
  const syncRuntimeChannels = () => {
    const p=active(),saved=p.channels||{};
    for(const c of state.getChannels?.()||[]){
      const old=saved[c.channelId];
      if(!old||old.transport!==c.transport||old.mode!==c.mode||old.endpoint!==c.endpoint||old.name!==c.name)workspaces.upsertChannel(p.id,c);
    }
    return active();
  };
  const resolveObserved = (ref,channelId=null) => {
    const parsed=typeof ref==='string'?parseDeviceKey(ref):null;
    if(parsed)return parsed.deviceKey;
    const key=state.resolveDeviceKey(ref,channelId||null);
    if(!key){const e=new Error(`Unit/Slave ${ref} has not been observed on the selected channel.`);e.code='DEVICE_NOT_FOUND';throw e;}
    return key;
  };
  const resolveForWrite = (body={},routeRef=null) => {
    if(body.deviceKey)return body.deviceKey;
    const ref=body.unitId??body.slaveId??routeRef;
    if(body.channelId&&ref!==undefined&&ref!==null)return makeDeviceKey(body.channelId,Number(ref));
    return resolveObserved(ref,null);
  };
  const engineering = () => { syncRuntimeChannels(); return enrichMappings(workspaces.listRegisters(active().id), state.getRegisters({ limit: 20000 })); };
  const exportModel = () => {
    const p = syncRuntimeChannels();
    return collectExportModel({
      project: p,
      state,
      diagnostics: analyzeDeep({ state, config: state.config }),
      mappings: engineering(),
      history: history.query(p.id, { limit: 5000 }),
      workspaceBackup: workspaces.exportAll()
    });
  };

  app.get('/api/status', (_q,r) => r.json(state.getStatus()));
  app.get('/api/analysis', (_q,r) => r.json(state.getAnalysis()));
  app.get('/api/channels', (_q,r) => { syncRuntimeChannels(); r.json(state.getChannels?.()||[]); });
  app.get('/api/transactions', (q,r) => { try{r.json(unifiedTransactions(q.query));}catch(e){apiError(r,e);} });
  app.get('/api/evidence/status', (_q,r) => r.json(evidence.status()));
  app.get('/api/diagnostics/protocol', (q,r) => { try { const rows=unifiedTransactions({limit:Number(q.query.limit||10000)}); r.json(analyzeProtocolTraffic(rows,{serialConfig:state.config||{}})); } catch(e){apiError(r,e);} });
  app.get('/api/registers', (q,r) => { try{r.json(state.getRegisters(q.query));}catch(e){apiError(r,e);} });
  app.get('/api/polls', (q,r) => { try{r.json(state.getPollGroups(q.query));}catch(e){apiError(r,e);} });
  app.get('/api/devices', (q,r) => { try{r.json(state.getDevices(q.query));}catch(e){apiError(r,e);} });
  app.get('/api/devices/:ref', (q,r) => { try{const d=state.getDevice(decodeURIComponent(q.params.ref),{channelId:q.query.channelId||null});if(!d)return r.status(404).json({error:`Device ${q.params.ref} has not been observed.`});r.json(d);}catch(e){apiError(r,e);} });
  app.get('/api/decode', (q,r) => { try { const base=state.getDataTypeAnalysis(q.query); const words=(base.words||[]).map(item=>Number(item.value)); const advanced=registerCodec.interpretationMatrix(words); r.json({...base,advancedInterpretations:advanced}); } catch(e){apiError(r,e);} });
  app.post('/api/register/interpret', (q,r) => { try { const words=Array.isArray(q.body?.words)?q.body.words.map(Number):[]; if(!words.length)return r.status(400).json({error:'words must be a non-empty array'}); const definition=q.body?.definition||{}; r.json({definition:registerCodec.normalizeDefinition(definition),result:registerCodec.decodeDefinition(words,definition),matrix:registerCodec.interpretationMatrix(words)}); } catch(e){apiError(r,e);} });
  app.get('/api/config', (_q,r) => r.json({ ...state.config, demo, version:'7.0.0' }));
  app.get('/api/replay/status', (_q,r) => r.json(replay.status()));
  app.get('/api/diagnostics/deep', (_q,r) => r.json(analyzeDeep({ state, config:state.config })));
  app.get('/api/engineering', (_q,r) => { try{r.json(engineering());}catch(e){apiError(r,e);} });

  app.get('/api/ports', async (_q,r) => { try { r.json(await PortManager.list()); } catch(e) { r.status(500).json({ error:e.message }); } });
  app.post('/api/serial/configure', async (q,r) => { if (demo) return r.status(409).json({ error:'Serial configuration is disabled in demo mode.' }); try { replay.stop(); await configureSerial(validateSerialConfig(q.body || {})); r.json({ ok:true, config:state.config }); } catch(e) { r.status(400).json({ error:e.message }); } });
  app.post('/api/serial/disconnect', async (_q,r) => { if (demo) return r.status(409).json({ error:'No serial port is active in demo mode.' }); try { await disconnectSerial(); r.json({ ok:true }); } catch(e) { r.status(500).json({ error:e.message }); } });
  app.post('/api/serial/autodetect', async (q,r) => { if (demo) return r.status(409).json({ error:'Serial auto-detection is disabled in demo mode.' }); try { r.json(await autoDetectSerial(q.body || {})); } catch(e) { r.status(400).json({ error:e.message }); } });

  app.post('/api/capture/clear', (_q,r) => { replay.stop(); evidence.clear(); state.clearCapture(); r.json({ ok:true }); });
  app.get('/api/capture/export.mbcap', (_q,r) => {
    const capture = state.exportCapture(); capture.project = syncRuntimeChannels(); const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    r.setHeader('Content-Type','application/json; charset=utf-8'); r.setHeader('Content-Disposition',`attachment; filename="modbus-${stamp}.mbcap"`); r.send(JSON.stringify(capture,null,2));
  });
  app.post('/api/capture/import', async (q,r) => { try { if (!demo && state.connection.status === 'open') await disconnectSerial(); evidence.clear(); replay.load(q.body); const status = state.loadCapture(q.body,{emit:false}); syncRuntimeChannels(); state.setConnection('capture',{path:'CAPTURE',message:`${q.body.transactions.length} captured events loaded`}); r.json({ok:true,status,replay:replay.status()}); } catch(e) { r.status(400).json({ error:e.message }); } });
  app.post('/api/replay/start', async (q,r) => { try { if (!demo && state.connection.status === 'open') await disconnectSerial(); r.json({ok:true,replay:replay.start({speed:q.body?.speed})}); } catch(e) { r.status(400).json({ error:e.message }); } });
  app.post('/api/replay/stop', (_q,r) => { replay.stop(); r.json({ok:true,replay:replay.status()}); });

  app.get('/api/workspaces', (_q,r) => { syncRuntimeChannels(); r.json({ activeProjectId:active().id, projects:workspaces.listProjects() }); });
  app.get('/api/project', (_q,r) => r.json(syncRuntimeChannels()));
  app.get('/api/project/legacy-unassigned', (_q,r) => r.json(workspaces.getLegacyUnassigned(active().id)));
  app.post('/api/workspaces', (q,r) => { try { const p=workspaces.createProject(q.body||{}); for(const c of state.getChannels?.()||[])workspaces.upsertChannel(p.id,c); broadcast('workspace',{project:active()}); r.json(active()); } catch(e) { apiError(r,e); } });
  app.patch('/api/workspaces/:id', (q,r) => { try { const p=workspaces.updateProject(q.params.id,q.body||{}); broadcast('workspace',{project:p}); r.json(p); } catch(e) { apiError(r,e); } });
  app.post('/api/workspaces/:id/select', (q,r) => { try { let p=workspaces.selectProject(q.params.id); for(const c of state.getChannels?.()||[])workspaces.upsertChannel(p.id,c); p=active(); broadcast('workspace',{project:p}); r.json(p); } catch(e) { apiError(r,e); } });
  app.delete('/api/workspaces/:id', (q,r) => { try { workspaces.deleteProject(q.params.id); broadcast('workspace',{project:active()}); r.json({ok:true,active:active()}); } catch(e) { apiError(r,e); } });
  app.put('/api/project/devices/:ref', (q,r) => { try { syncRuntimeChannels(); const key=resolveForWrite(q.body||{},decodeURIComponent(q.params.ref)); const d=workspaces.setDevice(active().id,key,q.body||{}); broadcast('workspace',{project:active()}); r.json(d); } catch(e) { apiError(r,e,e?.code==='DEVICE_NOT_FOUND'?404:400); } });
  app.put('/api/project/registers', (q,r) => { try { syncRuntimeChannels(); const key=resolveForWrite(q.body||{}); const m=workspaces.setRegister(active().id,{...q.body,deviceKey:key}); broadcast('workspace',{project:active()}); r.json(m); } catch(e) { apiError(r,e,e?.code==='DEVICE_NOT_FOUND'?404:400); } });
  app.delete('/api/project/registers/:ref/:fc/:address', (q,r) => { try{syncRuntimeChannels();const key=resolveObserved(decodeURIComponent(q.params.ref),q.query.channelId||null);const ok=workspaces.deleteRegister(active().id,key,q.params.fc,q.params.address);broadcast('workspace',{project:active()});r.json({ok});}catch(e){apiError(r,e);} });

  app.get('/api/profiles', (_q,r) => r.json(workspaces.listProfiles()));
  app.get('/api/profiles/:id', (q,r) => { const p=workspaces.getProfile(q.params.id); if(!p) return r.status(404).json({error:'Profile not found.'}); r.json(p); });
  app.post('/api/profiles', (q,r) => { try { r.json(workspaces.saveProfile(q.body||{})); } catch(e) { apiError(r,e); } });
  app.post('/api/profiles/from-device/:ref', (q,r) => { try { syncRuntimeChannels(); const key=resolveObserved(decodeURIComponent(q.params.ref),q.body?.channelId||null); r.json(workspaces.createProfileFromDevice(active().id,key,q.body||{})); } catch(e) { apiError(r,e); } });
  app.post('/api/profiles/:id/apply/:ref', (q,r) => { try { syncRuntimeChannels(); const ref=decodeURIComponent(q.params.ref); let key; if(parseDeviceKey(ref))key=ref; else if(q.body?.channelId)key=makeDeviceKey(q.body.channelId,Number(ref)); else key=resolveObserved(ref); const out=workspaces.applyProfile(active().id,key,q.params.id); broadcast('workspace',{project:active()}); r.json(out); } catch(e) { apiError(r,e); } });
  app.delete('/api/profiles/:id', (q,r) => r.json({ok:workspaces.deleteProfile(q.params.id)}));

  app.get('/api/history', (q,r) => r.json(history.query(active().id,{limit:q.query.limit,since:q.query.since,channelId:q.query.channelId||null,deviceKey:q.query.deviceKey||null})));
  app.delete('/api/history', (_q,r) => r.json({ok:history.clear(active().id)}));
  app.get('/api/workspace/export.json', (_q,r) => { r.setHeader('Content-Disposition','attachment; filename="modbus-workspaces.json"'); r.json(workspaces.exportAll()); });
  app.post('/api/workspace/import', (q,r) => { try { const out=workspaces.importAll(q.body); syncRuntimeChannels(); broadcast('workspace',{project:active()}); r.json(out); } catch(e) { apiError(r,e); } });

  app.get('/api/tcp/status', (_q,r) => r.json(tcpProxy.status()));
  app.post('/api/tcp/start', async (q,r) => { try { const status=await tcpProxy.start(validateTcp(q.body||{})); if(status.channel)workspaces.upsertChannel(active().id,status.channel); r.json(status); } catch(e) { apiError(r,e); } });
  app.post('/api/tcp/stop', async (_q,r) => { try { r.json(await tcpProxy.stop()); } catch(e) { r.status(500).json({error:e.message}); } });

  app.get('/api/report.html', (_q,r) => { const diagnostics=analyzeDeep({state,config:state.config}); r.type('html').send(reportHtml({project:syncRuntimeChannels(),state,diagnostics,mappings:engineering()})); });

  app.get('/api/export/results.xlsx', async (_q,r) => { try { const model=exportModel(); const buf=await buildWorkbook(model); const name=safeName(model.project?.name); r.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); r.setHeader('Content-Disposition',`attachment; filename="${name}-modbus-results.xlsx"`); r.send(buf); } catch(e) { r.status(500).json({error:e.message}); } });
  app.get('/api/export/report.pdf', async (_q,r) => { try { const model=exportModel(); const buf=await buildPdf(model); const name=safeName(model.project?.name); r.setHeader('Content-Type','application/pdf'); r.setHeader('Content-Disposition',`attachment; filename="${name}-modbus-report.pdf"`); r.send(buf); } catch(e) { r.status(500).json({error:e.message}); } });
  app.get('/api/export/project.zip', async (_q,r) => { try { const model=exportModel(); const html=reportHtml({project:model.project,state,diagnostics:model.diagnostics,mappings:model.mappings}); await streamProjectZip(r,model,html); } catch(e) { if(!r.headersSent) r.status(500).json({error:e.message}); else r.destroy(e); } });
  app.get('/api/export/manifest', (_q,r) => r.json({version:'7.0.0',exports:[
    {id:'xlsx',label:'Excel Workbook',href:'/api/export/results.xlsx',extension:'.xlsx'},
    {id:'pdf',label:'Engineering Report',href:'/api/export/report.pdf',extension:'.pdf'},
    {id:'capture',label:'Raw Capture',href:'/api/capture/export.mbcap',extension:'.mbcap'},
    {id:'zip',label:'Complete Project Backup',href:'/api/export/project.zip',extension:'.zip'}
  ]}));

  app.get('/api/export/transactions.csv', (_q,r) => sendCsv(r,'modbus-transactions.csv',unifiedTransactions({limit:20000}),[
    {label:'sourceType',value:x=>x.sourceType||'Sniffer'},{label:'source',value:x=>x.source||''},{label:'ownerMode',value:x=>x.ownerMode||''},{label:'connectionId',value:x=>x.connectionId||''},
    {label:'id',value:x=>x.id},{label:'timestamp',value:x=>new Date(x.timestamp).toISOString()},{label:'transport',value:x=>x.transport||'RTU'},{label:'channelId',value:x=>x.channelId},{label:'deviceKey',value:x=>x.deviceKey},{label:'unitId',value:x=>x.unitId??x.slaveId},{label:'direction',value:x=>x.direction},{label:'function',value:x=>x.functionCode},{label:'functionName',value:x=>x.functionName},{label:'rttMs',value:x=>x.rttMs},{label:'timeoutMs',value:x=>x.timeoutMs},{label:'exception',value:x=>x.exceptionName||''},{label:'rawHex',value:x=>x.rawHex}
  ]));
  app.get('/api/export/registers.csv', (_q,r) => sendCsv(r,'modbus-registers.csv',state.getRegisters({limit:20000}),[
    {label:'transport',value:x=>x.transport},{label:'channelId',value:x=>x.channelId},{label:'deviceKey',value:x=>x.deviceKey},{label:'unitId',value:x=>x.unitId??x.slaveId},{label:'function',value:x=>x.functionCode},{label:'address',value:x=>x.address},{label:'lastValue',value:x=>x.lastValue},{label:'lastHex',value:x=>x.lastHex},{label:'min',value:x=>x.min},{label:'max',value:x=>x.max},{label:'reads',value:x=>x.reads},{label:'writes',value:x=>x.writes},{label:'changes',value:x=>x.changes},{label:'pollIntervalMs',value:x=>x.pollIntervalMs}
  ]));
  app.get('/api/export/polls.csv', (_q,r) => sendCsv(r,'modbus-polling-groups.csv',state.getPollGroups(),[
    {label:'transport',value:x=>x.transport},{label:'channelId',value:x=>x.channelId},{label:'deviceKey',value:x=>x.deviceKey},{label:'unitId',value:x=>x.unitId??x.slaveId},{label:'function',value:x=>x.functionCode},{label:'operation',value:x=>x.operation},{label:'startAddress',value:x=>x.startAddress},{label:'quantity',value:x=>x.quantity},{label:'requests',value:x=>x.requests},{label:'responses',value:x=>x.responses},{label:'timeouts',value:x=>x.timeouts},{label:'medianIntervalMs',value:x=>x.medianIntervalMs},{label:'jitterPct',value:x=>x.jitterPct},{label:'avgRttMs',value:x=>x.avgRttMs}
  ]));
  app.get('/api/export/devices.csv', (_q,r) => sendCsv(r,'modbus-devices.csv',state.getDevices(),[
    {label:'transport',value:x=>x.transport},{label:'channelId',value:x=>x.channelId},{label:'deviceKey',value:x=>x.deviceKey},{label:'unitId',value:x=>x.unitId??x.slaveId},{label:'status',value:x=>x.status},{label:'healthScore',value:x=>x.healthScore},{label:'requests',value:x=>x.requests},{label:'responses',value:x=>x.responses},{label:'timeouts',value:x=>x.timeouts},{label:'registerCount',value:x=>x.registerCount},{label:'pollGroupCount',value:x=>x.pollGroupCount},{label:'avgRttMs',value:x=>x.avgRttMs}
  ]));
  app.get('/api/export/engineering.csv', (_q,r) => sendCsv(r,'modbus-engineering-map.csv',engineering(),[
    {label:'channelId',value:x=>x.channelId},{label:'deviceKey',value:x=>x.deviceKey},{label:'unitId',value:x=>x.unitId??x.slaveId},{label:'function',value:x=>x.functionCode},{label:'address',value:x=>x.address},{label:'name',value:x=>x.name},{label:'type',value:x=>x.type},{label:'byteOrder',value:x=>x.byteOrder},{label:'scale',value:x=>x.scale},{label:'offset',value:x=>x.offset},{label:'unit',value:x=>x.unit},{label:'engineeringValue',value:x=>x.engineeringValue},{label:'available',value:x=>x.available}
  ]));

  app.get('/', (_q,r) => r.type('html').send(workbench));
  app.use(express.static(publicDir));
  app.use((q,r,n) => { if(q.method==='GET' && !q.path.startsWith('/api/')) return r.type('html').send(workbench); n(); });

  const handlers = {
    transaction:p=>broadcast('transaction',p), port:p=>broadcast('port',p), noise:p=>broadcast('noise',p), clear:()=>broadcast('clear',{}), config:p=>broadcast('config',p), timeout:p=>broadcast('timeout',p), 'capture-loaded':p=>broadcast('capture-loaded',p), 'tcp-diagnostic':p=>broadcast('tcp-diagnostic',p)
  };
  for (const [ev,fn] of Object.entries(handlers)) state.on(ev,fn);
  tcpProxy.on('status', p=>broadcast('tcp-status',p));
  wss.on('connection', ws => {
    ws.send(JSON.stringify({type:'hello',payload:{status:state.getStatus(),analysis:state.getAnalysis(),devices:state.getDevices(),replay:replay.status(),project:syncRuntimeChannels(),tcp:tcpProxy.status(),discoveryActive:activeDiscovery.status(),slave:slaveRuntime.status()}}));
    ws.on('error',()=>{});
  });

  await new Promise((resolve,reject)=>{ server.once('error',reject); server.listen(options.webPort,options.webHost,resolve); });
  return {
    url:`http://${options.webHost==='0.0.0.0'?'127.0.0.1':options.webHost}:${options.webPort}`,
    close:async()=>{ loggerTrend.dispose?.(); testSequences.dispose?.(); masterRuntime.off('event',onMasterEvent); slaveRuntime.off('event',onSlaveEvent); testSequences.off('event',onTestSequenceEvent); activeDiscovery.off('evidence',onDiscoveryEvidence); activeDiscovery.off('status',onDiscoveryStatus); await slaveRuntime.shutdown(); await activeDiscovery.close(); for(const[ev,fn]of Object.entries(handlers))state.off(ev,fn); for(const ws of wss.clients)ws.close(); await new Promise(resolve=>server.close(resolve)); }
  };
}

module.exports = { startPlatformWebServer, validateSerialConfig, validateTcp, isLoopbackHost, csvEscape, sameOriginRequest, mutationBodyLimit };