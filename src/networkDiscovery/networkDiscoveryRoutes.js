'use strict';

const {listNetworkInterfaces}=require('./networkInterfaces');
const {previewTargets}=require('./targetParser');
const {NetworkStore}=require('./networkStore');
const {NetworkScanManager}=require('./scanManager');
const {scanTcpDeviceIds}=require('../activeDiscovery');
const {addressUtilization}=require('./topology');

function bodyBool(v){return v===true;}
function activeProjectId(workspaces,getActiveProjectId){return typeof getActiveProjectId==='function'?(getActiveProjectId()||'default'):(workspaces?.getActiveProject?.()?.id||'default');}
function statusCode(error){
  if(['NETWORK_SCAN_BUSY'].includes(error?.code))return 409;
  if(['NETWORK_SCAN_NOT_FOUND','NETWORK_HOST_NOT_FOUND','NETWORK_COMPARE_SOURCE_NOT_FOUND'].includes(error?.code))return 404;
  return 400;
}
function installNetworkDiscoveryRoutes({app,options={},workspaces=null,getActiveProjectId=null,broadcast=()=>{},store:providedStore=null,manager:providedManager=null,demo=false}={}){
  if(!app)throw new Error('Express app is required for network discovery routes.');
  const store=providedStore||new NetworkStore({dataDir:options.dataDir});
  const project=()=>activeProjectId(workspaces,getActiveProjectId);
  const manager=providedManager||new NetworkScanManager({store,getProjectId:project});
  manager.on('status',s=>broadcast('network-scan',s));
  manager.on('host',x=>broadcast('network-host',x));
  manager.on('complete',s=>broadcast('network-scan-complete',s));
  manager.on('scan-error',x=>broadcast('network-scan-error',{jobId:x.jobId,ip:x.ip,error:x.error?.message||String(x.error||'error')}));

  app.get('/api/network/interfaces',(_q,r)=>r.json({interfaces:listNetworkInterfaces()}));
  app.post('/api/network/targets/preview',(q,r)=>{
    try{r.json(previewTargets({targets:q.body?.targets??q.body?.target,exclude:q.body?.exclude,maxTargets:q.body?.maxTargets??262144}));}
    catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null,theoretical:e.theoretical,publicCount:e.publicCount});}
  });
  app.get('/api/network/scan/status',(_q,r)=>r.json(manager.status()));
  app.post('/api/network/scan/start',(q,r)=>{
    if(demo&&q.body?.allowDemoNetworkScan!==true)return r.status(409).json({error:'Network scanning is disabled in demo mode unless explicitly enabled.',code:'NETWORK_SCAN_DEMO_DISABLED'});
    try{r.status(202).json(manager.start(q.body||{}));}catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null,publicCount:e.publicCount||null});}
  });
  app.post('/api/network/scan/pause',(_q,r)=>r.json(manager.pause()));
  app.post('/api/network/scan/resume',(_q,r)=>r.json(manager.resume()));
  app.post('/api/network/scan/cancel',(_q,r)=>r.json(manager.cancel()));

  app.get('/api/network/hosts',(q,r)=>{
    try{r.json(store.listHosts(project(),{state:q.query.state||null,search:q.query.search||null,modbus:q.query.modbus==null?null:String(q.query.modbus)==='true',classification:q.query.classification||null,limit:q.query.limit}));}
    catch(e){r.status(400).json({error:e.message,code:e.code||null});}
  });
  app.get('/api/network/hosts/:id',(q,r)=>{const host=store.getHost(project(),q.params.id);if(!host)return r.status(404).json({error:'Network host not found.',code:'NETWORK_HOST_NOT_FOUND'});r.json(host);});
  app.patch('/api/network/hosts/:id',(q,r)=>{
    try{const host=store.updateHost(project(),q.params.id,{classification:q.body?.classification,notes:q.body?.notes,tags:q.body?.tags});if(!host)return r.status(404).json({error:'Network host not found.',code:'NETWORK_HOST_NOT_FOUND'});broadcast('network-host-updated',{host});r.json(host);}
    catch(e){r.status(400).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/network/hosts/:id/modbus',async(q,r)=>{
    try{
      const host=store.getHost(project(),q.params.id);if(!host){const e=new Error('Network host not found.');e.code='NETWORK_HOST_NOT_FOUND';throw e;}
      const port=Number(q.body?.port||host.modbus?.port||host.services?.find(x=>x.port===502)?.port||502),unitStart=Number(q.body?.unitStart??1),unitEnd=Number(q.body?.unitEnd??247);
      const result=await scanTcpDeviceIds({host:host.ip,port,unitStart,unitEnd,timeoutMs:Number(q.body?.timeoutMs||650),interRequestMs:Number(q.body?.interRequestMs||50),readDeviceIdCode:Number(q.body?.readDeviceIdCode||1),maxSegments:Number(q.body?.maxSegments||8)});
      const units=result.results.filter(x=>x.responded).map(x=>({unitId:x.unitId,identificationSupported:x.identificationSupported,identification:x.identification,objects:x.objects,avgRttMs:x.avgRttMs}));
      const updated=store.mergeHost(project(),{...host,modbus:{verified:true,host:host.ip,port,unitId:units[0]?.unitId??host.modbus?.unitId??null},modbusUnits:units,lastSeen:new Date().toISOString()},'modbus-unit-scan');
      broadcast('network-host-updated',{host:updated});r.json({host:updated,result});
    }catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/network/hosts/:id/open-master',(q,r)=>{
    const host=store.getHost(project(),q.params.id);if(!host)return r.status(404).json({error:'Network host not found.',code:'NETWORK_HOST_NOT_FOUND'});
    const unitId=Number(q.body?.unitId??host.modbus?.unitId??host.modbusUnits?.find(x=>x.responded)?.unitId??1),port=Number(q.body?.port||host.modbus?.port||502);
    const prepared={type:'tcp',host:host.ip,port,unitId:Number.isInteger(unitId)&&unitId>=0&&unitId<=255?unitId:1,connect:false,transmit:false,source:'network-discovery'};
    broadcast('network-master-handoff',{hostId:host.id,prepared});r.json({prepared,message:'Master connection prepared only; no network request has been transmitted.'});
  });

  app.get('/api/network/scans',(_q,r)=>r.json(store.listScans(project())));
  app.get('/api/network/scans/:id',(q,r)=>{const x=store.getScan(project(),q.params.id);if(!x)return r.status(404).json({error:'Network scan not found.',code:'NETWORK_SCAN_NOT_FOUND'});r.json(x);});
  app.get('/api/network/scans/:id/export.json',(q,r)=>{const x=store.getScan(project(),q.params.id);if(!x)return r.status(404).json({error:'Network scan not found.',code:'NETWORK_SCAN_NOT_FOUND'});r.setHeader('Content-Disposition',`attachment; filename="network-scan-${String(x.id).replace(/[^a-z0-9._-]/gi,'_')}.json"`);r.json(x);});
  app.get('/api/network/hosts.csv',(_q,r)=>{
    const rows=store.listHosts(project(),{limit:4096}),esc=v=>{const s=String(v??'');return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
    const lines=['state,ip,mac,hostname,type,classification,services,modbus,avgRttMs,lastSeen'];
    for(const h of rows)lines.push([h.state,h.ip,h.mac,h.hostname,h.type,h.classification,(h.services||[]).map(s=>`${s.port}/${s.protocol||'tcp'} ${s.name}`).join('; '),h.modbus?.verified?'yes':'no',h.avgRttMs,h.lastSeen].map(esc).join(','));
    r.setHeader('Content-Type','text/csv; charset=utf-8');r.setHeader('Content-Disposition','attachment; filename="network-hosts.csv"');r.send(lines.join('\r\n'));
  });
  app.post('/api/network/scans/:id/baseline',(q,r)=>{try{r.status(201).json(store.saveBaseline(project(),q.params.id,q.body?.name));}catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}});
  app.get('/api/network/baselines',(_q,r)=>r.json(store.listBaselines(project())));
  app.get('/api/network/compare',(q,r)=>{try{r.json(store.compare(project(),{leftScanId:q.query.left||null,rightScanId:q.query.right||null,baselineId:q.query.baseline||null}));}catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}});
  app.get('/api/network/events',(q,r)=>r.json(store.listEvents(project(),{limit:q.query.limit})));
  app.get('/api/network/topology',(_q,r)=>r.json(store.getTopology(project())));
  app.get('/api/network/utilization',(_q,r)=>r.json({subnets:addressUtilization(store.listHosts(project(),{limit:4096}))}));
  app.put('/api/network/topology',(q,r)=>{try{r.json(store.setTopology(project(),q.body||{}));}catch(e){r.status(400).json({error:e.message,code:e.code||null});}});

  return{manager,store,close:()=>manager.close()};
}
module.exports={installNetworkDiscoveryRoutes};
