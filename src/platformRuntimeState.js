'use strict';

const {AdvancedRuntimeState}=require('./advancedRuntimeState');

class PlatformRuntimeState extends AdvancedRuntimeState{
  _buildTransaction(tx,timestamp,raw,meters){const e=super._buildTransaction(tx,timestamp,raw,meters);e.transport=tx.transport||tx.decoded?.transport||'RTU';return e;}
  recordTimeout(request,expiredAt=Date.now(),timeoutMs=1000,transport='RTU'){const e=super.recordTimeout(request,expiredAt,timeoutMs);if(e)e.transport=transport||request?.transport||'RTU';return e;}
  getTransportSummary(){const out={RTU:{frames:0,requests:0,responses:0,timeouts:0,bytes:0},TCP:{frames:0,requests:0,responses:0,timeouts:0,bytes:0}};for(const t of this.transactions){const k=t.transport==='TCP'?'TCP':'RTU',x=out[k];if(t.direction==='TIMEOUT'){x.timeouts++;continue;}x.frames++;x.bytes+=Number(t.byteLength||0);if(t.direction==='REQ')x.requests++;if(t.direction==='RSP')x.responses++;}return out;}
  getStatus(){const s=super.getStatus();s.transports=this.getTransportSummary();return s;}
}
module.exports={PlatformRuntimeState};
