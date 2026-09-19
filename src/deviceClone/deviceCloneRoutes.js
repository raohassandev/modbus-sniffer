'use strict';

const { DeviceCloneService } = require('./deviceCloneService');

function sendError(res,error){
  const status=['SOURCE_NOT_FOUND'].includes(error?.code)?404:['SLAVE_RUNNING'].includes(error?.code)?409:400;
  res.status(status).json({error:String(error?.message||error),code:error?.code||'DEVICE_CLONE_ERROR',details:error?.details||undefined});
}

function installDeviceCloneRoutes({app,state,slaveRuntime,broadcast=()=>{},service=new DeviceCloneService({state,slaveRuntime})}={}){
  if(!app)throw new TypeError('app is required');

  app.get('/api/device-clone/sources',(_req,res)=>{
    try{res.json(service.sources());}catch(error){sendError(res,error);}
  });

  app.post('/api/device-clone/preview',(req,res)=>{
    try{res.json(service.preview(req.body||{}));}catch(error){sendError(res,error);}
  });

  app.post('/api/device-clone/apply',async(req,res)=>{
    try{
      const result=await service.apply(req.body||{});
      broadcast('device-clone',{action:'applied',source:result.preview.source,policy:result.preview.policy});
      res.json(result);
    }catch(error){sendError(res,error);}
  });

  return service;
}

module.exports={installDeviceCloneRoutes,sendError};
