'use strict';

class TcpTransactionTracker{
  constructor({requestTimeoutMs=5000,onTimeout=null}={}){this.requestTimeoutMs=Math.max(50,Number(requestTimeoutMs)||5000);this.onTimeout=typeof onTimeout==='function'?onTimeout:null;this.pending=new Map();}
  _key(frame){return`${frame.transactionId}:${frame.unitId}`;}
  request(frame,timestamp=Date.now()){this.expire(timestamp);const d={...frame.decoded,kind:'request',timestamp,transactionId:frame.transactionId};this.pending.set(this._key(frame),d);return{direction:'REQ',decoded:d,request:d,rttMs:null,transport:'TCP'};}
  response(frame,timestamp=Date.now()){this.expire(timestamp);const key=this._key(frame),req=this.pending.get(key)||null;if(req)this.pending.delete(key);const d={...frame.decoded,kind:'response',transactionId:frame.transactionId};const tx={direction:'RSP',decoded:d,request:req,rttMs:req?timestamp-req.timestamp:null,transport:'TCP'};this._decorate(tx);return tx;}
  expire(now=Date.now()){const expired=[];for(const [key,r] of this.pending){if(now-r.timestamp>this.requestTimeoutMs){this.pending.delete(key);expired.push(r);this.onTimeout?.(r,now,this.requestTimeoutMs,'TCP');}}return expired;}
  clear(){this.pending.clear();}
  _decorate(tx){const d=tx.decoded,r=tx.request;if(!r)return;let start;if([3,4].includes(d.functionCode))start=r.startAddress;if(d.functionCode===23)start=r.readStartAddress;if(start!==undefined&&Array.isArray(d.words))d.registers=d.words.map((value,i)=>({address:start+i,value,hex:`0x${Number(value).toString(16).toUpperCase().padStart(4,'0')}`}));if([1,2].includes(d.functionCode)&&Array.isArray(d.bits))d.points=d.bits.slice(0,r.quantity).map((value,i)=>({address:r.startAddress+i,value}));}
}
module.exports={TcpTransactionTracker};
