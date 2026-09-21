'use strict';

const { TestSequenceService } = require('./testSequenceService');

function statusFor(error){
  if(['MASTER_NOT_CONNECTED','RECIPE_BUSY'].includes(error?.code))return 409;
  if(['STEP_NOT_ALLOWED','CONNECTION_NOT_ALLOWED','READ_FUNCTION_NOT_ALLOWED','DELAY_OUT_OF_RANGE','INVALID_RECIPE','INVALID_STEP','INVALID_STEP_TYPE','DUPLICATE_STEP_ID','INVALID_REPEAT','CONFIRMATION_REQUIRED','BULK_CONFIRMATION_REQUIRED','BROADCAST_CONFIRMATION_REQUIRED','RECIPE_EXECUTION_LIMIT','RECIPE_NESTING_LIMIT'].includes(error?.code))return 400;
  if(error?.code==='ABORTED')return 409;
  return 400;
}

function sendError(res,error){
  res.status(statusFor(error)).json({
    error:String(error?.message||error),
    code:error?.code||'TEST_SEQUENCE_ERROR',
    details:error?.details||undefined,
    recipeResult:error?.recipeResult||undefined,
  });
}

function installTestSequenceRoutes({
  app,
  masterRuntime,
  broadcast=()=>{},
  service=new TestSequenceService({masterRuntime}),
}={}){
  if(!app)throw new TypeError('app is required');

  const relay=event=>broadcast('test-sequence-event',event);
  const runRelay=run=>broadcast('test-sequence-run',run);
  service.on('event',relay);
  service.on('run',runRelay);

  app.get('/api/test-sequences/status',(_req,res)=>{
    try{res.json(service.status());}catch(error){sendError(res,error);}
  });

  app.get('/api/test-sequences/templates',(_req,res)=>{
    try{res.json(service.templates());}catch(error){sendError(res,error);}
  });

  app.get('/api/test-sequences/history',(req,res)=>{
    try{res.json(service.history({limit:Number(req.query.limit||20)}));}catch(error){sendError(res,error);}
  });

  app.post('/api/test-sequences/validate',(req,res)=>{
    try{res.json(service.validate(req.body?.recipe||req.body||{}));}catch(error){sendError(res,error);}
  });

  app.post('/api/test-sequences/run',async(req,res)=>{
    try{
      const body=req.body||{};
      res.json(await service.run(body.recipe||body,{variables:body.variables||{}}));
    }catch(error){sendError(res,error);}
  });

  app.post('/api/test-sequences/pause',(_req,res)=>{
    try{res.json(service.pause());}catch(error){sendError(res,error);}
  });

  app.post('/api/test-sequences/resume',(_req,res)=>{
    try{res.json(service.resume());}catch(error){sendError(res,error);}
  });

  app.post('/api/test-sequences/stop',(_req,res)=>{
    try{res.json(service.stop());}catch(error){sendError(res,error);}
  });

  service.dispose=()=>{
    try{service.stop();}catch{/* best effort */}
    service.off('event',relay);
    service.off('run',runRelay);
  };

  return service;
}

module.exports={installTestSequenceRoutes,sendError,statusFor};
