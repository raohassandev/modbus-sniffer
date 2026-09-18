'use strict';

const {StableRawLabService,normalizeConfig}=require('./rawLabService');

function sendError(res,error){
  const conflicts=new Set(['PASSIVE_CAPTURE_ACTIVE','MASTER_ACTIVE','SLAVE_ACTIVE','DISCOVERY_ACTIVE','SESSION_NOT_OPEN','OWNER_MISMATCH','RESOURCE_BUSY']);
  res.status(conflicts.has(error?.code)?409:400).json({error:String(error?.message||error),code:error?.code||'RAW_LAB_ERROR',details:error?.details||undefined});
}
function samePort(a,b){return String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();}

function installRawLabRoutes({
  app,state,demo=false,disconnectSerial=null,masterRuntime=null,slaveRuntime=null,activeDiscovery=null,
  broadcast=()=>{},service=new StableRawLabService()
}={}){
  if(!app)throw new TypeError('app is required');

  async function ensureOwnership(config,body={}){
    if(config.type==='tcp')return;
    if(demo){const e=new Error('Serial Raw Lab is disabled in demo mode.');e.code='DEMO_SERIAL_DISABLED';throw e;}

    let passive={};
    try{passive=state?.getStatus?.()||{};}catch{}
    const conn=passive.connection||{},cfg=passive.config||state?.config||{};
    const passiveOpen=['open','connecting','reconnecting','detecting'].includes(String(conn.status||'').toLowerCase());
    if(passiveOpen&&samePort(cfg.port,config.path)){
      if(body.confirmPassiveDisconnect!==true){const e=new Error(`Passive Sniffer owns ${config.path}. Confirm disconnecting it before Raw Lab.`);e.code='PASSIVE_CAPTURE_ACTIVE';e.details={port:config.path,requiresConfirmation:true};throw e;}
      if(typeof disconnectSerial==='function')await disconnectSerial();
    }

    const master=masterRuntime?.status?.()||{};
    if(master.connected&&['rtu','ascii'].includes(String(master.config?.type||'').toLowerCase())&&samePort(master.config?.path,config.path)){
      if(body.confirmMasterDisconnect!==true){const e=new Error(`Master owns ${config.path}. Confirm disconnecting Master before Raw Lab.`);e.code='MASTER_ACTIVE';e.details={port:config.path,requiresConfirmation:true};throw e;}
      await masterRuntime.disconnect();
    }

    const slave=slaveRuntime?.status?.()||{};
    if(slave.running&&['rtu','ascii'].includes(String(slave.config?.type||'').toLowerCase())&&samePort(slave.config?.path,config.path)){
      if(body.confirmSlaveStop!==true){const e=new Error(`Slave owns ${config.path}. Confirm stopping Slave before Raw Lab.`);e.code='SLAVE_ACTIVE';e.details={port:config.path,requiresConfirmation:true};throw e;}
      await slaveRuntime.stop();
    }

    const discovery=activeDiscovery?.status?.()||{};
    const discoveryActive=['running','starting','cancelling'].includes(String(discovery.state||'').toLowerCase());
    const discoveryTransport=String(discovery.transport||discovery.config?.transport||'').toUpperCase();
    if(discoveryActive&&discoveryTransport==='RTU'){
      throw Object.assign(new Error('Stop active RTU Discovery before opening serial Raw Lab.'),{code:'DISCOVERY_ACTIVE',details:{jobId:discovery.jobId||null}});
    }
  }

  app.get('/api/raw-lab/status',(_req,res)=>{try{res.json(service.status());}catch(error){sendError(res,error);}});
  app.post('/api/raw-lab/open',async(req,res)=>{
    try{const config=normalizeConfig(req.body||{});await ensureOwnership(config,req.body||{});const status=await service.open(config);broadcast('raw-lab-status',status);res.json(status);}catch(error){sendError(res,error);}
  });
  app.post('/api/raw-lab/close',async(_req,res)=>{try{const status=await service.close();broadcast('raw-lab-status',status);res.json(status);}catch(error){sendError(res,error);}});
  app.post('/api/raw-lab/preview',(req,res)=>{try{res.json(service.preview(req.body||{}));}catch(error){sendError(res,error);}});
  app.post('/api/raw-lab/arm',(req,res)=>{try{const status=service.armLab(req.body||{});broadcast('raw-lab-status',service.status());res.json(status);}catch(error){sendError(res,error);}});
  app.post('/api/raw-lab/disarm',(req,res)=>{try{const status=service.disarmLab(req.body?.reason||'manual');broadcast('raw-lab-status',service.status());res.json(status);}catch(error){sendError(res,error);}});
  app.post('/api/raw-lab/send',async(req,res)=>{try{res.json(await service.send(req.body||{}));}catch(error){sendError(res,error);}});
  app.post('/api/raw-lab/repeat',async(req,res)=>{try{res.json(await service.repeat(req.body||{}));}catch(error){sendError(res,error);}});
  app.get('/api/raw-lab/audit',(req,res)=>{try{res.json(service.audit(Number(req.query.limit||200)));}catch(error){sendError(res,error);}});
  app.get('/api/raw-lab/cases',(_req,res)=>{try{res.json(service.listCases());}catch(error){sendError(res,error);}});
  app.post('/api/raw-lab/cases',(req,res)=>{try{res.json(service.saveCase(req.body||{}));}catch(error){sendError(res,error);}});
  app.delete('/api/raw-lab/cases/:id',(req,res)=>{try{res.json({ok:service.removeCase(req.params.id)});}catch(error){sendError(res,error);}});

  service.dispose=async()=>{await service.close();};
  return service;
}
module.exports={installRawLabRoutes,samePort,sendError};
