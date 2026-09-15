'use strict';

const {ActiveDiscoveryManager}=require('./activeDiscoveryManager');

const LIVE_SERIAL_STATES=new Set(['open','connecting','detecting','reconnecting']);
function httpStatus(error){return ['DISCOVERY_BUSY','RTU_DISCOVERY_PASSIVE_CAPTURE_ACTIVE'].includes(error?.code)?409:400;}
function bool(v){return v===true;}
function n(v,d){const x=Number(v);return Number.isFinite(x)?x:d;}

function installActiveDiscoveryRoutes({app,state,demo=false,broadcast=()=>{}}={}){
  if(!app)throw new Error('Express app is required for active discovery routes.');
  const manager=new ActiveDiscoveryManager();
  const publish=s=>broadcast('discovery-active',s);
  manager.on('status',publish);

  app.get('/api/discovery/active/status',(_q,r)=>r.json(manager.status()));
  app.post('/api/discovery/active/start',(q,r)=>{
    if(demo)return r.status(409).json({error:'Active discovery is disabled in demo mode because it transmits real Modbus FC43 requests.',code:'DISCOVERY_DEMO_DISABLED'});
    try{
      const body=q.body||{},transport=String(body.transport||'').trim().toUpperCase();
      let config;
      if(transport==='RTU'){
        const connection=String(state?.connection?.status||'').toLowerCase();
        if(LIVE_SERIAL_STATES.has(connection)){
          const e=new Error('Disconnect passive RTU capture before starting active RTU discovery. The scanner requires exclusive access to the serial adapter and bus.');e.code='RTU_DISCOVERY_PASSIVE_CAPTURE_ACTIVE';throw e;
        }
        const current=state?.config||{},port=String(body.port||current.port||'').trim();
        if(!port)throw new Error('Select an RTU serial port for active discovery.');
        config={transport:'RTU',port,baudRate:n(body.baudRate,n(current.baudRate,9600)),dataBits:n(body.dataBits,n(current.dataBits,8)),parity:String(body.parity||current.parity||'none').toLowerCase(),stopBits:n(body.stopBits,n(current.stopBits,1)),unitStart:n(body.unitStart,1),unitEnd:n(body.unitEnd,247),timeoutMs:n(body.timeoutMs,500),interRequestMs:n(body.interRequestMs,100),readDeviceIdCode:n(body.readDeviceIdCode,1),maxSegments:n(body.maxSegments,8),maintenanceConfirmed:bool(body.maintenanceConfirmed),exclusiveBusConfirmed:bool(body.exclusiveBusConfirmed)};
      }else if(transport==='TCP'){
        const host=String(body.host||'').trim();if(!host)throw new Error('TCP target host is required for active discovery.');
        config={transport:'TCP',host,port:n(body.port,502),unitStart:n(body.unitStart,1),unitEnd:n(body.unitEnd,247),timeoutMs:n(body.timeoutMs,750),interRequestMs:n(body.interRequestMs,75),readDeviceIdCode:n(body.readDeviceIdCode,1),maxSegments:n(body.maxSegments,8)};
      }else{
        const e=new Error('Discovery transport must be TCP or RTU.');e.code='DISCOVERY_TRANSPORT_REQUIRED';throw e;
      }
      r.status(202).json(manager.start(config));
    }catch(e){r.status(httpStatus(e)).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/discovery/active/cancel',(_q,r)=>r.json(manager.cancel()));

  return manager;
}

module.exports={installActiveDiscoveryRoutes,LIVE_SERIAL_STATES,httpStatus};
