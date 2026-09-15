'use strict';

const { makeDeviceKey } = require('./transportIdentity');

const IDENTITY_FIELDS = [
  ['manufacturer','Vendor name'],
  ['productCode','Product code'],
  ['productName','Product name'],
  ['model','Model'],
  ['revision','Revision'],
  ['vendorUrl','Vendor URL'],
  ['userApplicationName','User application name']
];

function text(v,max=512){return String(v??'').trim().slice(0,max);}
function same(a,b){return text(a)===text(b);}
function error(code,message,extra={}){const e=new Error(message);e.code=code;Object.assign(e,extra);return e;}
function identityFromResult(result={}){
  const i=result.identification&&typeof result.identification==='object'?result.identification:{};
  const manufacturer=text(i.vendorName,120),productCode=text(i.productCode,120),productName=text(i.productName,160),modelName=text(i.modelName,160),revision=text(i.revision,120),vendorUrl=text(i.vendorUrl,300),userApplicationName=text(i.userApplicationName,160);
  return {
    manufacturer,
    productCode,
    productName,
    model:text(modelName||productName||productCode,160),
    modelName,
    revision,
    vendorUrl,
    userApplicationName
  };
}
function identifiedResult(result={}){
  const identity=identityFromResult(result),hasNamed=Object.values(identity).some(Boolean),hasObjects=Array.isArray(result.objects)&&result.objects.length>0;
  return Boolean(result.responded)&&result.identificationSupported===true&&(hasNamed||hasObjects);
}
function publicDevice(device){return device?JSON.parse(JSON.stringify(device)):null;}

function previewDiscoveryAdoption({workspaces,projectId,runId,unitId,channelId}={}){
  if(!workspaces)throw error('DISCOVERY_WORKSPACE_UNAVAILABLE','Project workspace is unavailable.');
  const project=workspaces.getProject(projectId);
  if(!project)throw error('DISCOVERY_PROJECT_NOT_FOUND','Project not found.');
  const run=workspaces.getDiscoveryRun(projectId,String(runId||''));
  if(!run)throw error('DISCOVERY_RUN_NOT_FOUND','Discovery run not found.');
  const uid=Number(unitId);
  if(!Number.isInteger(uid)||uid<0||uid>255)throw error('DISCOVERY_RESULT_NOT_FOUND','Choose a valid discovered Unit/Slave ID.');
  const result=(run.results||[]).find(x=>Number(x.unitId)===uid);
  if(!result)throw error('DISCOVERY_RESULT_NOT_FOUND',`Unit/Slave ${uid} is not present in this discovery run.`);
  if(!identifiedResult(result))throw error('DISCOVERY_IDENTIFICATION_UNAVAILABLE',`Unit/Slave ${uid} does not contain usable FC43 identification data.`);
  const cid=text(channelId,500);
  if(!cid)throw error('DISCOVERY_CHANNEL_REQUIRED','Choose the exact project channel before adopting identification.');
  const channel=project.channels?.[cid];
  if(!channel)throw error('DISCOVERY_CHANNEL_NOT_FOUND',`Project channel ${cid} was not found.`);
  const channelTransport=String(channel.transport||'').toUpperCase(),runTransport=String(run.transport||'').toUpperCase();
  if(channelTransport!==runTransport)throw error('DISCOVERY_TRANSPORT_MISMATCH',`This ${runTransport} discovery result cannot be adopted into a ${channelTransport||'different'} channel.`);

  const deviceKey=makeDeviceKey(cid,uid),existing=project.devices?.[deviceKey]||null,proposed=identityFromResult(result),fields=[],conflicts=[];
  for(const [key,label] of IDENTITY_FIELDS){
    const discovered=text(proposed[key]),current=text(existing?.[key]);
    if(!discovered)continue;
    const conflict=Boolean(current&&!same(current,discovered));
    const change=!current||!same(current,discovered);
    const row={key,label,current:current||null,discovered,conflict,change};fields.push(row);if(conflict)conflicts.push(row);
  }
  return {
    preview:true,projectId,runId:run.id,jobId:run.jobId||null,transport:runTransport,unitId:uid,channel:{channelId:cid,name:channel.name||cid,transport:channelTransport,endpoint:channel.endpoint||null,mode:channel.mode||null},
    deviceKey,existingDevice:publicDevice(existing),newDevice:!existing,identity:proposed,fields,conflicts,requiresOverwrite:conflicts.length>0,
    source:{target:run.target||null,startedAt:run.startedAt??null,completedAt:run.completedAt??null,savedAt:run.savedAt||null}
  };
}

function adoptionSnapshot(preview,result,overwriteExisting){
  const objects=(Array.isArray(result.objects)?result.objects:[]).slice(0,64).map(o=>({objectId:Number(o.objectId),name:text(o.name,120),value:text(o.value,512)}));
  return {
    source:'Modbus FC43 / MEI 0x0E',sourceRunId:preview.runId,sourceJobId:preview.jobId,adoptedAt:new Date().toISOString(),transport:preview.transport,channelId:preview.channel.channelId,unitId:preview.unitId,target:preview.source.target,
    overwriteExisting:Boolean(overwriteExisting),vendorName:preview.identity.manufacturer||null,productCode:preview.identity.productCode||null,productName:preview.identity.productName||null,modelName:preview.identity.modelName||null,revision:preview.identity.revision||null,vendorUrl:preview.identity.vendorUrl||null,userApplicationName:preview.identity.userApplicationName||null,objects
  };
}

function adoptDiscoveryIdentification({workspaces,projectId,runId,unitId,channelId,overwriteExisting=false}={}){
  const preview=previewDiscoveryAdoption({workspaces,projectId,runId,unitId,channelId});
  if(preview.conflicts.length&&!overwriteExisting)throw error('DISCOVERY_ADOPTION_CONFLICT','Existing device identification differs from the discovery result. Preview the conflicts and explicitly approve overwrite before adopting.',{conflicts:preview.conflicts,preview});
  if(typeof workspaces._project!=='function'||typeof workspaces._save!=='function')throw error('DISCOVERY_WORKSPACE_UNAVAILABLE','Workspace implementation does not support identification metadata persistence.');
  const run=workspaces.getDiscoveryRun(projectId,preview.runId),result=(run.results||[]).find(x=>Number(x.unitId)===preview.unitId),existing=preview.existingDevice||{};
  const pick=key=>{
    const discovered=text(preview.identity[key]);if(!discovered)return existing[key];
    const current=text(existing[key]);return overwriteExisting||!current||same(current,discovered)?discovered:existing[key];
  };

  workspaces.setDevice(projectId,preview.deviceKey,{manufacturer:pick('manufacturer'),model:pick('model')});
  const liveProject=workspaces._project(projectId),device=liveProject.devices[preview.deviceKey];
  for(const key of ['productCode','productName','revision','vendorUrl','userApplicationName']){
    const value=pick(key);if(value!==undefined)device[key]=text(value,key==='vendorUrl'?300:160);
  }
  device.identification=adoptionSnapshot(preview,result,overwriteExisting);
  device.updatedAt=new Date().toISOString();
  const liveRun=(liveProject.discoveryRuns||[]).find(x=>x.id===preview.runId);
  if(liveRun){
    const entry={deviceKey:preview.deviceKey,channelId:preview.channel.channelId,unitId:preview.unitId,adoptedAt:device.identification.adoptedAt,overwriteExisting:Boolean(overwriteExisting),overwrittenFields:overwriteExisting?preview.conflicts.map(x=>x.key):[]};
    liveRun.adoptions=[...(liveRun.adoptions||[]).filter(x=>x.deviceKey!==entry.deviceKey),entry].slice(-256);
  }
  liveProject.updatedAt=new Date().toISOString();workspaces._save();
  return {ok:true,device:publicDevice(device),adoption:device.identification,overwrittenFields:overwriteExisting?preview.conflicts.map(x=>x.key):[],sourceRunId:preview.runId};
}

module.exports={IDENTITY_FIELDS,identityFromResult,identifiedResult,previewDiscoveryAdoption,adoptDiscoveryIdentification};
