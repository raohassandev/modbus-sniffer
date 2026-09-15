'use strict';

const {ActiveDiscoveryManager}=require('./activeDiscoveryManager');

const SAFE_RTU_DISCOVERY_STATES=new Set(['idle','closed','capture']);
function httpStatus(error){return ['DISCOVERY_BUSY','RTU_DISCOVERY_PASSIVE_CAPTURE_ACTIVE'].includes(error?.code)?409:400;}
function bool(v){return v===true;}
function n(v,d){const x=Number(v);return Number.isFinite(x)?x:d;}

function installActiveDiscoveryRoutes({app,state,demo=false,broadcast=()=>{},workspaces=null,getActiveProjectId=null,manager:providedManager=null}={}){
  if(!app)throw new Error('Express app is required for active discovery routes.');
  const manager=providedManager||new ActiveDiscoveryManager(),jobProjects=new Map(),savedJobs=new Map();
  const activeProjectId=()=>typeof getActiveProjectId==='function'?getActiveProjectId():workspaces?.getActiveProject?.()?.id||null;
  const persist=s=>{
    if(!workspaces||s?.state!=='completed'||!s?.jobId||!s?.result||savedJobs.has(s.jobId))return null;
    const projectId=jobProjects.get(s.jobId);if(!projectId)return null;
    const saved=workspaces.saveDiscoveryRun(projectId,{jobId:s.jobId,transport:s.transport,startedAt:s.startedAt,completedAt:s.completedAt,summary:s.summary,result:s.result});
    savedJobs.set(s.jobId,saved.id);broadcast('discovery-evidence',{projectId,runId:saved.id,jobId:s.jobId,summary:saved.summary});return saved;
  };
  const publish=s=>{let saved=null;try{saved=persist(s);}catch(error){broadcast('discovery-evidence-error',{jobId:s?.jobId||null,error:error.message,code:error.code||null});}broadcast('discovery-active',{...s,savedEvidenceId:saved?.id||savedJobs.get(s?.jobId)||null});};
  manager.on('status',publish);

  app.get('/api/discovery/active/status',(_q,r)=>{const status=manager.status();r.json({...status,savedEvidenceId:savedJobs.get(status.jobId)||null});});
  app.post('/api/discovery/active/start',(q,r)=>{
    if(demo)return r.status(409).json({error:'Active discovery is disabled in demo mode because it transmits real Modbus FC43 requests.',code:'DISCOVERY_DEMO_DISABLED'});
    try{
      const body=q.body||{},transport=String(body.transport||'').trim().toUpperCase();
      let config;
      if(transport==='RTU'){
        const connection=String(state?.connection?.status||'').toLowerCase();
        if(!SAFE_RTU_DISCOVERY_STATES.has(connection)){
          const e=new Error('Disconnect passive RTU capture before starting active RTU discovery. The scanner requires exclusive access to the serial adapter and bus.');e.code='RTU_DISCOVERY_PASSIVE_CAPTURE_ACTIVE';throw e;
        }
        if(!bool(body.maintenanceConfirmed)||!bool(body.exclusiveBusConfirmed)){
          const e=new Error('RTU active discovery is blocked until maintenance mode and exclusive-bus control are both explicitly confirmed.');e.code='RTU_DISCOVERY_CONFIRMATION_REQUIRED';throw e;
        }
        const current=state?.config||{},port=String(body.port||current.port||'').trim();
        if(!port)throw new Error('Select an RTU serial port for active discovery.');
        config={transport:'RTU',port,baudRate:n(body.baudRate,n(current.baudRate,9600)),dataBits:n(body.dataBits,n(current.dataBits,8)),parity:String(body.parity||current.parity||'none').toLowerCase(),stopBits:n(body.stopBits,n(current.stopBits,1)),unitStart:n(body.unitStart,1),unitEnd:n(body.unitEnd,247),timeoutMs:n(body.timeoutMs,500),interRequestMs:n(body.interRequestMs,100),readDeviceIdCode:n(body.readDeviceIdCode,1),maxSegments:n(body.maxSegments,8),maintenanceConfirmed:true,exclusiveBusConfirmed:true};
      }else if(transport==='TCP'){
        const host=String(body.host||'').trim();if(!host)throw new Error('TCP target host is required for active discovery.');
        config={transport:'TCP',host,port:n(body.port,502),unitStart:n(body.unitStart,1),unitEnd:n(body.unitEnd,247),timeoutMs:n(body.timeoutMs,750),interRequestMs:n(body.interRequestMs,75),readDeviceIdCode:n(body.readDeviceIdCode,1),maxSegments:n(body.maxSegments,8)};
      }else{
        const e=new Error('Discovery transport must be TCP or RTU.');e.code='DISCOVERY_TRANSPORT_REQUIRED';throw e;
      }
      const projectId=activeProjectId();if(workspaces&&!projectId)throw new Error('Select an active project before starting discovery.');
      const status=manager.start(config);if(projectId)jobProjects.set(status.jobId,projectId);r.status(202).json(status);
    }catch(e){r.status(httpStatus(e)).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/discovery/active/cancel',(_q,r)=>r.json(manager.cancel()));

  app.get('/api/discovery/runs',(_q,r)=>{try{if(!workspaces)return r.json([]);const projectId=activeProjectId();r.json(projectId?workspaces.listDiscoveryRuns(projectId):[]);}catch(e){r.status(400).json({error:e.message,code:e.code||null});}});
  app.get('/api/discovery/runs/:id',(q,r)=>{try{if(!workspaces)return r.status(404).json({error:'Discovery evidence storage is unavailable.'});const projectId=activeProjectId(),run=projectId?workspaces.getDiscoveryRun(projectId,q.params.id):null;if(!run)return r.status(404).json({error:'Discovery run not found.'});r.json(run);}catch(e){r.status(400).json({error:e.message,code:e.code||null});}});
  app.get('/api/discovery/runs/:id/export.json',(q,r)=>{try{if(!workspaces)return r.status(404).json({error:'Discovery evidence storage is unavailable.'});const projectId=activeProjectId(),run=projectId?workspaces.getDiscoveryRun(projectId,q.params.id):null;if(!run)return r.status(404).json({error:'Discovery run not found.'});r.setHeader('Content-Disposition',`attachment; filename="modbus-discovery-${String(run.id).replace(/[^a-z0-9._-]/gi,'_')}.json"`);r.json(run);}catch(e){r.status(400).json({error:e.message,code:e.code||null});}});
  app.delete('/api/discovery/runs/:id',(q,r)=>{try{if(!workspaces)return r.status(404).json({error:'Discovery evidence storage is unavailable.'});const projectId=activeProjectId(),ok=projectId?workspaces.deleteDiscoveryRun(projectId,q.params.id):false;r.json({ok});}catch(e){r.status(400).json({error:e.message,code:e.code||null});}});

  return manager;
}

module.exports={installActiveDiscoveryRoutes,SAFE_RTU_DISCOVERY_STATES,httpStatus};
