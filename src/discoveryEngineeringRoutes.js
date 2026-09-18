'use strict';
const {DiscoveryEngineeringService}=require('./discoveryEngineering');
function send(res,e){res.status(e?.code==='MASTER_NOT_CONNECTED'?409:e?.code==='DISCOVERY_RUN_NOT_FOUND'?404:400).json({error:String(e?.message||e),code:e?.code||'DISCOVERY_ENGINEERING_ERROR',details:e?.details||undefined});}
function installDiscoveryEngineeringRoutes({app,masterRuntime,slaveRuntime,broadcast=()=>{},service=new DiscoveryEngineeringService({masterRuntime})}={}){
 if(!app||!masterRuntime)throw new TypeError('app and masterRuntime are required');
 const onProgress=p=>broadcast('discovery-engineering-progress',p),onResult=r=>broadcast('discovery-engineering-result',r);service.on('progress',onProgress);service.on('result',onResult);
 app.get('/api/discovery/engineering/runs',(_q,r)=>{try{r.json(service.listRuns());}catch(e){send(r,e);}});
 app.post('/api/discovery/engineering/unit-scan',async(q,r)=>{try{r.json(await service.scanUnits(q.body||{}));}catch(e){send(r,e);}});
 app.post('/api/discovery/engineering/range-scan',async(q,r)=>{try{r.json(await service.scanRange(q.body||{}));}catch(e){send(r,e);}});
 app.post('/api/discovery/engineering/function-probe',async(q,r)=>{try{r.json(await service.probeFunctions(q.body||{}));}catch(e){send(r,e);}});
 app.post('/api/discovery/engineering/quantity-probe',async(q,r)=>{try{r.json(await service.probeQuantities(q.body||{}));}catch(e){send(r,e);}});
 app.get('/api/discovery/engineering/:id/monitor',(q,r)=>{try{r.json(service.monitorDefinition(q.params.id));}catch(e){send(r,e);}});
 app.get('/api/discovery/engineering/:id/simulator',(q,r)=>{try{r.json(service.simulatorDefinition(q.params.id));}catch(e){send(r,e);}});
 app.post('/api/discovery/engineering/:id/adopt-simulator',async(q,r)=>{try{
   if(q.body?.confirmed!==true)return r.status(400).json({error:'Simulator adoption requires explicit confirmation.',code:'CONFIRMATION_REQUIRED'});
   const def=service.simulatorDefinition(q.params.id),status=slaveRuntime?.status?.()||{};
   if(status.running)return r.status(409).json({error:'Stop Slave server before adopting discovery data.',code:'SLAVE_RUNNING'});
   if(!status.configured)await slaveRuntime.configure({type:'tcp',host:'127.0.0.1',port:502});
   if(!slaveRuntime.listDevices().some(d=>d.unitId===def.unitId))slaveRuntime.addDevice({unitId:def.unitId,name:`Discovery Unit ${def.unitId}`});
   const memory=slaveRuntime.seedMemory({unitId:def.unitId,area:def.area,address:def.address,values:def.values});
   r.json({ok:true,definition:def,memory});
 }catch(e){send(r,e);}});
 service.dispose=()=>{service.off('progress',onProgress);service.off('result',onResult);};return service;
}
module.exports={installDiscoveryEngineeringRoutes};