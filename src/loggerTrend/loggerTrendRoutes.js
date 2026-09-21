'use strict';

const {StableLoggerTrendService}=require('./loggerTrendService');

function sendError(res,error){
  const status=error?.code==='PROFILE_NOT_FOUND'?404:400;
  res.status(status).json({error:String(error?.message||error),code:error?.code||'LOGGER_TREND_ERROR',details:error?.details||undefined});
}

function installLoggerTrendRoutes({app,state,masterRuntime,broadcast=()=>{},dataDir=null,service=null}={}){
  if(!app)throw new TypeError('app is required');
  service=service||new StableLoggerTrendService({state,masterRuntime,...(dataDir?{dataDir}:{})});

  const onSample=sample=>broadcast('logger-sample',sample);
  service.on('sample',onSample);

  app.get('/api/logger-trend/status',(_req,res)=>{
    try{res.json(service.status());}catch(error){sendError(res,error);}
  });
  app.get('/api/logger-trend/profiles',(_req,res)=>{
    try{res.json(service.listProfiles());}catch(error){sendError(res,error);}
  });
  app.post('/api/logger-trend/profiles',(req,res)=>{
    try{res.json(service.saveProfile(req.body||{}));}catch(error){sendError(res,error);}
  });
  app.delete('/api/logger-trend/profiles/:streamId',(req,res)=>{
    try{service.removeProfile(req.params.streamId);res.json({ok:true});}catch(error){sendError(res,error);}
  });
  app.get('/api/logger-trend/series/:streamId',(req,res)=>{
    try{res.json(service.querySeries(req.params.streamId,{from:req.query.from,to:req.query.to,maxPoints:req.query.maxPoints}));}catch(error){sendError(res,error);}
  });
  app.get('/api/logger-trend/events',(req,res)=>{
    try{res.json(service.recentEvents({limit:req.query.limit,sourceType:req.query.sourceType||null}));}catch(error){sendError(res,error);}
  });
  app.get('/api/logger-trend/export/:streamId.csv',(req,res)=>{
    try{
      res.type('text/csv');
      res.setHeader('Content-Disposition',`attachment; filename="${String(req.params.streamId).replace(/[^A-Za-z0-9._-]+/g,'_')}.csv"`);
      res.send(service.exportCsv(req.params.streamId));
    }catch(error){sendError(res,error);}
  });

  service.dispose=()=>{
    service.off('sample',onSample);
    service.shutdown();
  };
  return service;
}

module.exports={installLoggerTrendRoutes,sendError};
