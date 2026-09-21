'use strict';

const {compareCaptures,compareRegisterMaps,compareTestRuns}=require('./compareService');

function sendError(res,error){res.status(400).json({error:String(error?.message||error),code:error?.code||'COMPARE_ERROR',details:error?.details||undefined});}

function installCompareRoutes({app}={}){
  if(!app)throw new TypeError('app is required');
  app.post('/api/compare/captures',(req,res)=>{try{res.json(compareCaptures(req.body?.left,req.body?.right));}catch(error){sendError(res,error);}});
  app.post('/api/compare/register-maps',(req,res)=>{try{res.json(compareRegisterMaps(req.body?.left||[],req.body?.right||[]));}catch(error){sendError(res,error);}});
  app.post('/api/compare/test-runs',(req,res)=>{try{res.json(compareTestRuns(req.body?.left||{},req.body?.right||{}));}catch(error){sendError(res,error);}});
}

module.exports={installCompareRoutes,sendError};
