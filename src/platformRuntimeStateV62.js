'use strict';

const { PlatformRuntimeState } = require('./platformRuntimeState');
const { avg, percentile, median } = require('./advancedRuntimeState');

function round(value,digits=2){if(value==null||!Number.isFinite(Number(value)))return value;const m=10**digits;return Math.round(Number(value)*m)/m;}
function rate(num,den){return den?Number(num||0)/Number(den):0;}

class PlatformRuntimeStateV62 extends PlatformRuntimeState {
  clearCapture(){const out=super.clearCapture();this.rtuNoiseByChannel=new Map();this.tcpDiagnostics=new Map();this.captureReferenceTime=null;return out;}

  _isRtuBroadcast(value={}){
    const d=value.decoded||value;
    const transport=String(value.transport||d.transport||'RTU').toUpperCase();
    const unit=Number(value.unitId??value.slaveId??d.unitId??d.slaveId);
    return transport==='RTU'&&unit===0;
  }

  _recordSlave(event){if(this._isRtuBroadcast(event))return;return super._recordSlave(event);}
  _recordPollRequest(event){if(this._isRtuBroadcast(event))return;return super._recordPollRequest(event);}
  _recordRegisters(tx,timestamp){if(this._isRtuBroadcast(tx))return;return super._recordRegisters(tx,timestamp);}

  recordNoise(count,timestamp=Date.now(),channelId=null){super.recordNoise(count,timestamp);if(channelId){const key=String(channelId);this.rtuNoiseByChannel.set(key,(this.rtuNoiseByChannel.get(key)||0)+Number(count||0));}}

  _tcpDiag(channelId){
    const key=String(channelId||'tcp:unknown');
    return this.tcpDiagnostics.get(key)||{channelId:key,parserErrors:0,protocolIdErrors:0,invalidLengthErrors:0,truncatedAdus:0,oversizedAdus:0,disconnects:0,resets:0,reconnects:0,targetConnectFailures:0,transactionIdCollisions:0,backpressurePauses:0,rejectedSessions:0,sessionOpens:0,lastEventAt:null,lastEventType:null};
  }

  recordTcpDiagnostic(channelLike,type,details={}){
    const channelId=String(channelLike?.channelId||details.channelId||'tcp:unknown'),d={...this._tcpDiag(channelId),lastEventAt:Number(details.timestamp)||Date.now(),lastEventType:type};
    if(type==='parser-error'){d.parserErrors++;if(details.code==='MBAP_PROTOCOL_ID')d.protocolIdErrors++;if(details.code==='MBAP_INVALID_LENGTH')d.invalidLengthErrors++;if(details.code==='MBAP_TRUNCATED')d.truncatedAdus++;if(details.code==='MBAP_OVERSIZED')d.oversizedAdus++;}
    if(type==='transaction-id-collision')d.transactionIdCollisions++;
    if(type==='backpressure')d.backpressurePauses++;
    if(type==='session-rejected')d.rejectedSessions++;
    if(type==='session-open'){d.sessionOpens++;if(details.reconnect)d.reconnects++;}
    if(type==='target-connect-failure')d.targetConnectFailures++;
    if(type==='connection-error'&&details.code==='ECONNRESET')d.resets++;
    if(type==='session-close'){d.disconnects++;if(String(details.reason||'').includes('reset'))d.resets++;}
    this.tcpDiagnostics.set(channelId,d);this.emit('tcp-diagnostic',{...d,event:{type,...details}});return{...d};
  }

  recordTcpProxyStatus(status={}){
    const channelId=status.channel?.channelId;if(!channelId)return null;
    const prev=this._tcpDiag(channelId),stats=status.stats||{};
    const d={...prev,reconnects:Math.max(prev.reconnects,Number(stats.reconnects||0)),targetConnectFailures:Math.max(prev.targetConnectFailures,Number(stats.targetConnectFailures||0)),transactionIdCollisions:Math.max(prev.transactionIdCollisions,Number(status.transactionIdCollisions??stats.transactionIdCollisions??0)),backpressurePauses:Math.max(prev.backpressurePauses,Number(stats.backpressurePauses||0)),rejectedSessions:Math.max(prev.rejectedSessions,Number(stats.rejectedSessions||0)),sessionOpens:Math.max(prev.sessionOpens,Number(stats.sessionOpens||0)),resets:Math.max(prev.resets,Number(stats.resets||0)),lastEventAt:Date.now(),lastEventType:'proxy-status'};
    this.tcpDiagnostics.set(channelId,d);return{...d};
  }

  recordTimeout(request,expiredAt=Date.now(),timeoutMs=1000,transport=null){
    if(this._isRtuBroadcast({...request,transport:transport||request?.transport||'RTU'}))return null;
    const event=super.recordTimeout(request,expiredAt,timeoutMs,transport);
    if(event){event.outcome=request?.outcome||'timeout';event.connectionClosed=Boolean(request?.connectionClosed);if(event.request){event.request.outcome=event.outcome;event.request.connectionClosed=event.connectionClosed;}if(event.decoded){event.decoded.outcome=event.outcome;event.decoded.connectionClosed=event.connectionClosed;}}
    return event;
  }

  _analysisReferenceTime(){if(this.captureSource==='capture'&&Number.isFinite(this.captureReferenceTime))return this.captureReferenceTime;if(this.captureSource==='replay'&&this.transactions.length){let latest=0;for(const t of this.transactions)latest=Math.max(latest,Number(t.timestamp)||0);return latest||Date.now();}return Date.now();}

  _deviceSummary(device){
    const summary=super._deviceSummary(device),broadcast=this._isRtuBroadcast(summary);
    const matchedResponses=Math.max(0,Number(summary.responses||0)-Number(summary.unmatchedResponses||0));
    const confirmed=!broadcast&&matchedResponses>0&&Number.isFinite(Number(summary.lastResponseAt));
    const reference=this._analysisReferenceTime();
    if(!confirmed){
      return {...summary,matchedResponses,confirmed:false,status:broadcast?'broadcast':'unconfirmed',healthScore:null,statusReference:this.captureSource,referenceTime:reference,lastConfirmedAt:null};
    }
    const polls=this.getPollGroups({deviceKey:device.deviceKey}),intervals=polls.map(p=>p.medianIntervalMs).filter(Number.isFinite),expected=intervals.length?median(intervals):null;
    const silenceLimit=Math.max(3000,Number(expected||0)*3),age=Math.max(0,reference-Number(summary.lastResponseAt||reference)),desired=age<=silenceLimit?'online':age<=silenceLimit*3?'silent':'offline';
    const oldPenalty=summary.status==='offline'?30:summary.status==='silent'?10:0,newPenalty=desired==='offline'?30:desired==='silent'?10:0;
    return {...summary,matchedResponses,confirmed:true,status:desired,healthScore:Math.max(0,Math.min(100,Number(summary.healthScore||0)+oldPenalty-newPenalty)),statusReference:this.captureSource,referenceTime:reference,lastConfirmedAt:summary.lastResponseAt};
  }

  getDevices(filters={}){
    return super.getDevices(filters).filter(d=>!this._isRtuBroadcast(d));
  }

  _inventoryCounts(devices=this.getDevices()){
    const confirmed=devices.filter(d=>d.confirmed),unconfirmed=devices.filter(d=>!d.confirmed);
    return {
      observedUnitIds:devices.length,
      devices:confirmed.length,
      confirmedDevices:confirmed.length,
      unconfirmedDevices:unconfirmed.length,
      onlineDevices:confirmed.filter(d=>d.status==='online').length,
      silentDevices:confirmed.filter(d=>d.status==='silent').length,
      offlineDevices:confirmed.filter(d=>d.status==='offline').length
    };
  }

  getChannels(){
    const base=super.getChannels(),devices=this.getDevices();
    return base.map(channel=>{
      const list=devices.filter(d=>d.channelId===channel.channelId),counts=this._inventoryCounts(list),h=this._channelHealth(channel);
      return {...channel,deviceCount:counts.devices,confirmedDeviceCount:counts.confirmedDevices,observedUnitCount:counts.observedUnitIds,unconfirmedDeviceCount:counts.unconfirmedDevices,onlineDeviceCount:counts.onlineDevices,silentDeviceCount:counts.silentDevices,offlineDeviceCount:counts.offlineDevices,healthScore:h.healthScore,health:h.metrics};
    });
  }

  getTransportSummary(){
    const base=super.getTransportSummary(),devices=this.getDevices(),channels=this.getChannels();
    for(const transport of ['RTU','TCP']){
      const counts=this._inventoryCounts(devices.filter(d=>d.transport===transport)),group=channels.filter(c=>c.transport===transport);
      base[transport].devices=counts.devices;
      base[transport].confirmedDevices=counts.confirmedDevices;
      base[transport].observedUnitIds=counts.observedUnitIds;
      base[transport].unconfirmedDevices=counts.unconfirmedDevices;
      base[transport].onlineDevices=counts.onlineDevices;
      base[transport].silentDevices=counts.silentDevices;
      base[transport].offlineDevices=counts.offlineDevices;
      base[transport].healthScore=group.length?Math.min(...group.map(c=>c.healthScore)):null;
      base[transport].channels=group.length;
    }
    return base;
  }

  getStatus(){
    const status=super.getStatus(),counts=this._inventoryCounts();
    Object.assign(status.totals,counts,{slaves:counts.devices});
    return status;
  }

  _channelTransactions(channelId){return this.transactions.filter(t=>t.channelId===channelId);}

  _channelHealth(channel){
    const events=this._channelTransactions(channel.channelId),transport=channel.transport==='TCP'?'TCP':'RTU';
    let frames=0,bytes=0,requests=0,responses=0,timeouts=0,connectionClosedRequests=0,exceptions=0,unmatched=0;const rtts=[],functions=new Set();
    for(const e of events){
      if(e.direction==='TIMEOUT'){if(e.outcome&&e.outcome!=='timeout')connectionClosedRequests++;else timeouts++;continue;}
      frames++;bytes+=Number(e.byteLength||0);if(e.direction==='REQ')requests++;if(e.direction==='RSP'){responses++;if(!e.matched)unmatched++;}if(e.exception)exceptions++;if(Number.isFinite(Number(e.rttMs)))rtts.push(Number(e.rttMs));if(e.functionCode!=null)functions.add(Number(e.functionCode));
    }
    const timeoutRate=rate(timeouts,requests),exceptionRate=rate(exceptions,responses),unmatchedRate=rate(unmatched,responses),p95=percentile(rtts,95),rttAvg=avg(rtts),polls=this.getPollGroups({channelId:channel.channelId}),highJitter=polls.filter(p=>p.jitterPct!=null&&p.jitterPct>30&&p.requests>=5).length;
    let score=100;score-=Math.min(30,timeoutRate*180);score-=Math.min(25,exceptionRate*150);score-=Math.min(15,unmatchedRate*100);if(rttAvg!=null&&rttAvg>500)score-=Math.min(10,(rttAvg-500)/100);if(highJitter)score-=Math.min(10,highJitter*2);
    const common={frames,bytes,requests,responses,timeouts,connectionClosedRequests,exceptions,unmatchedResponses:unmatched,functionCodes:[...functions].sort((a,b)=>a-b),timeoutRate:round(timeoutRate*100,3),exceptionRate:round(exceptionRate*100,3),unmatchedResponseRate:round(unmatchedRate*100,3),avgRttMs:round(rttAvg),p95RttMs:round(p95),highJitterPolls:highJitter};
    if(transport==='RTU'){
      const noiseBytes=Number(this.rtuNoiseByChannel.get(channel.channelId)||0),noiseRatio=(bytes+noiseBytes)?noiseBytes/(bytes+noiseBytes):0;score-=Math.min(30,noiseRatio*200);
      const cfg=channel.config||{},baud=Number(cfg.baudRate),bitsPerChar=(Number(cfg.dataBits)||8)+(String(cfg.parity||'none').toLowerCase()==='none'?0:1)+(Number(cfg.stopBits)||1)+1;let utilizationPct=null;
      const first=events.length?Math.min(...events.map(e=>Number(e.timestamp)||Infinity)):null,last=events.length?Math.max(...events.map(e=>Number(e.timestamp)||0)):null;if(baud>0&&first!=null&&last!=null&&last>first)utilizationPct=round(Math.min(100,(bytes*bitsPerChar/baud)/((last-first)/1000)*100),2);
      return{healthScore:Math.max(0,Math.round(score)),metrics:{...common,noiseBytes,noiseRatio:round(noiseRatio*100,3),wireUtilizationPct:utilizationPct,baudRate:Number.isFinite(baud)?baud:null}};
    }
    const diag=this._tcpDiag(channel.channelId),mbapErrors=Number(diag.parserErrors||0),disconnects=Number(diag.disconnects||0),resets=Number(diag.resets||0),collisions=Number(diag.transactionIdCollisions||0),connectFailures=Number(diag.targetConnectFailures||0);
    if(mbapErrors)score-=Math.min(20,mbapErrors*2);if(resets)score-=Math.min(15,resets*2);if(collisions)score-=Math.min(15,collisions*3);if(connectFailures)score-=Math.min(20,connectFailures*4);if(connectionClosedRequests)score-=Math.min(10,connectionClosedRequests);
    return{healthScore:Math.max(0,Math.round(score)),metrics:{...common,mbapErrors,protocolIdErrors:Number(diag.protocolIdErrors||0),invalidLengthErrors:Number(diag.invalidLengthErrors||0),truncatedAdus:Number(diag.truncatedAdus||0),oversizedAdus:Number(diag.oversizedAdus||0),disconnects,resets,reconnects:Number(diag.reconnects||0),targetConnectFailures:connectFailures,transactionIdCollisions:collisions,backpressurePauses:Number(diag.backpressurePauses||0),rejectedSessions:Number(diag.rejectedSessions||0)}};
  }

  getAnalysis(){
    const analysis=super.getAnalysis(),channels=this.getChannels();if(channels.length)analysis.healthScore=Math.min(...channels.map(c=>c.healthScore));analysis.healthAggregation='minimum-channel-score';analysis.channels=channels;
    const rtu=channels.filter(c=>c.transport==='RTU'),rtuBytes=rtu.reduce((s,c)=>s+Number(c.health?.bytes||0),0),rtuNoise=rtu.reduce((s,c)=>s+Number(c.health?.noiseBytes||0),0);analysis.rates.noiseRatio=rtuBytes+rtuNoise?round(rtuNoise/(rtuBytes+rtuNoise)*100,3):0;analysis.rates.noiseScope='RTU-only';analysis.transportHealth={RTU:rtu.map(c=>({channelId:c.channelId,healthScore:c.healthScore,metrics:c.health})),TCP:channels.filter(c=>c.transport==='TCP').map(c=>({channelId:c.channelId,healthScore:c.healthScore,metrics:c.health}))};analysis.deviceInventory=this._inventoryCounts();return analysis;
  }

  exportCapture(){const capture=super.exportCapture();capture.analyzerVersion='6.2.0';capture.captureReferenceTime=this._analysisReferenceTime();capture.transactions=capture.transactions.map(t=>({...t,sourceTimestamp:Number(t.sourceTimestamp??t.timestamp)}));return capture;}
  loadCapture(capture,{emit=false}={}){super.loadCapture(capture,{emit});let reference=0;for(const t of capture.transactions||[])reference=Math.max(reference,Number(t.sourceTimestamp??t.timestamp)||0);this.captureReferenceTime=reference||Date.now();return this.getStatus();}
}

module.exports={PlatformRuntimeStateV62};
