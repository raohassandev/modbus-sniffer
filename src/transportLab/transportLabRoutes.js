'use strict';

const {TransportLabService}=require('./transportLabService');

function sendError(res,error){
  res.status(400).json({error:String(error?.message||error),code:error?.code||'TRANSPORT_LAB_ERROR',details:error?.details||undefined});
}
function installTransportLabRoutes({app,service=new TransportLabService()}={}){
  if(!app)throw new TypeError('app is required');
  app.get('/api/transport-lab/transports',(_req,res)=>{try{res.json(service.transports());}catch(error){sendError(res,error);}});
  app.get('/api/transport-lab/interfaces',(_req,res)=>{try{res.json(service.interfaces());}catch(error){sendError(res,error);}});
  app.get('/api/transport-lab/recommend',(req,res)=>{try{res.json(service.recommend(req.query.target)||null);}catch(error){sendError(res,error);}});
  app.post('/api/transport-lab/test',async(req,res)=>{try{res.json(await service.test(req.body||{}));}catch(error){sendError(res,error);}});
  return service;
}
module.exports={installTransportLabRoutes,sendError};
