'use strict';

const { PlatformRuntimeState } = require('./platformRuntimeState');
const { avg, percentile, median, stddev } = require('./advancedRuntimeState');

function round(value,digits=2){
  if(value==null||!Number.isFinite(Number(value)))return value;
  const m=10**digits;return Math.round(Number(value)*m)/m;
}

function rate(num,den){return den?Number(num||0)/Number(den):0;}

class PlatformRuntimeStateV62 extends PlatformRuntimeState {
  clearCapture(){
    const out=super.clearCapture();
    this.rtuNoiseByChannel=new Map();
    this.tcpDiagnostics=new Map();
    this.captureReferenceTime=null;
    return out;
  }

  recordNoise(count,timestamp=Date.now(),channelId=null){
    super.recordNoise(count,timestamp);
    if(channelId){
      const key=String(channelId);
      this.rtuNoiseByChannel.set(key,(this.rtuNoiseByChannel.get(key)||0)+Number(count||0));
    }
  }

  recordTcpDiagnostic(channelLike,type,details={}){
    const channelId=String(channelLike?.channelId||details.channelId||'tcp:unknown');
    const prev=this.tcpDiagnostics.get(channelId)||{
      channelId,parserErrors:0,protocolIdErrors:0,invalidLengthErrors:0,truncatedAdus:0,oversizedAdus:0,
      disconnects:0,resets:0,reconnects:0,targetConnectFailures:0,transactionIdCollisions:0,
      backpressurePauses:0,rejectedSessions:0,sessionOpens:0,lastEventAt:null,lastEventType:null
    };
    const d={...prev,lastEventAt:Number(details.timestamp)||Date.now(),lastEventType:type};
    if(type==='parser-error'){
      d.parserErrors++;
      if(details.code==='MBAP_PROTOCOL_ID')d.protocolIdErrors++;
      if(details.code==='MBAP_INVALID_LENGTH')d.invalidLengthErrors++;
      if(details.code==='MBAP_TRUNCATED')d.truncatedAdus++;
      if(details.code==='MBAP_OVERSIZED')d.oversizedAdus++;
    }
    if(type==='transaction-id-collision')d.transactionIdCollisions++;
    if(type==='backpressure')d.backpressurePauses++;
    if(type==='session-rejected')d.rejectedSessions++;
    if(type==='session-open'){
      d.sessionOpens++;
      if(details.reconnect)d.reconnects++;
    }
    if(type==='target-connect-failure')d.targetConnectFailures++;
    if(type==='connection-error'&&details.code==='ECONNRESET')d.resets++;
    if(type==='session-close'){
      d.disconnects++;
      if(String(details.reason||'').includes('reset'))d.resets++;
    }
    this.tcpDiagnostics.set(channelId,d);
    this.emit('tcp-diagnostic',{...d,event:{type,...details}});
    return {...d};
  }

  recordTimeout(request,expiredAt=Date.now(),timeoutMs=1000,transport=null){
    const event=super.recordTimeout(request,expiredAt,timeoutMs,transport);
    if(event){
      event.outcome=request?.outcome||'timeout';
      event.connectionClosed=Boolean(request?.connectionClosed);
      if(event.request){event.request.outcome=event.outcome;event.request.connectionClosed=event.connectionClosed;}
      if(event.decoded){event.decoded.outcome=event.outcome;event.decoded.connectionClosed=event.connectionClosed;}
    }
    return event;
  }

  _analysisReferenceTime(){
    if(this.captureSource==='capture'&&Number.isFinite(this.captureReferenceTime))return this.captureReferenceTime;
    if(this.captureSource==='replay'&&this.transactions.length){
      let latest=0;for(const t of this.transactions)latest=Math.max(latest,Number(t.timestamp)||0);return latest||Date.now();
    }
    return Date.now();
  }

  _deviceSummary(device){
    const summary=super._deviceSummary(device);
    if(!['capture','replay'].includes(this.captureSource))return summary;
    const polls=this.getPollGroups({deviceKey:device.deviceKey});
    const intervals=polls.map(p=>p.medianIntervalMs).filter(Number.isFinite),expected=intervals.length?median(intervals):null;
    const reference=this._analysisReferenceTime(),silenceLimit=Math.max(3000,Number(expected||0)*3),age=Math.max(0,reference-Number(device.lastSeen||reference));
    const desired=age<=silenceLimit?'online':age<=silenceLimit*3?'silent':'offline';
    const oldPenalty=summary.status==='offline'?30:summary.status==='silent'?10:0;
    const newPenalty=desired==='offline'?30:desired==='silent'?10:0;
    return {...summary,status:desired,healthScore:Math.max(0,Math.min(100,summary.healthScore+oldPenalty-newPenalty)),statusReference:this.captureSource,referenceTime:reference};
  }

  _channelTransactions(channelId){return this.transactions.filter(t=>t.channelId===channelId);}

  _channelHealth(channel){
    const events=this._channelTransactions(channel.channelId),transport=channel.transport==='TCP'?'TCP':'RTU';
    let frames=0,bytes=0,requests=0,responses=0,timeouts=0,exceptions=0,unmatched=0;
    const rtts=[];
    for(const e of events){
      if(e.direction==='TIMEOUT'){timeouts++;continue;}
      frames++;bytes+=Number(e.byteLength||0);
      if(e.direction==='REQ')requests++;
      if(e.direction==='RSP'){responses++;if(!e.matched)unmatched++;}
      if(e.exception)exceptions++;
      if(Number.isFinite(Number(e.rttMs)))rtts.push(Number(e.rttMs));
    }
    const timeoutRate=rate(timeouts,requests),exceptionRate=rate(exceptions,responses),unmatchedRate=rate(unmatched,responses),p95=percentile(rtts,95),rttAvg=avg(rtts);
    const polls=this.getPollGroups({channelId:channel.channelId}),highJitter=polls.filter(p=>p.jitterPct!=null&&p.jitterPct>30&&p.requests>=5).length;
    let score=100;
    score-=Math.min(30,timeoutRate*180);
    score-=Math.min(25,exceptionRate*150);
    score-=Math.min(15,unmatchedRate*100);
    if(rttAvg!=null&&rttAvg>500)score-=Math.min(10,(rttAvg-500)/100);
    if(highJitter)score-=Math.min(10,highJitter*2);
    const common={frames,bytes,requests,responses,timeouts,exceptions,unmatchedResponses:unmatched,timeoutRate:round(timeoutRate*100,3),exceptionRate:round(exceptionRate*100,3),unmatchedResponseRate:round(unmatchedRate*100,3),avgRttMs:round(rttAvg),p95RttMs:round(p95),highJitterPolls:highJitter};

    if(transport==='RTU'){
      const noiseBytes=Number(this.rtuNoiseByChannel.get(channel.channelId)||0),noiseRatio=(bytes+noiseBytes)?noiseBytes/(bytes+noiseBytes):0;
      score-=Math.min(30,noiseRatio*200);
      const cfg=channel.config||{},baud=Number(cfg.baudRate),bitsPerChar=(Number(cfg.dataBits)||8)+(String(cfg.parity||'none').toLowerCase()==='none'?0:1)+(Number(cfg.stopBits)||1)+1;
      let utilizationPct=null;
      const first=events.length?Math.min(...events.map(e=>Number(e.timestamp)||Infinity)):null,last=events.length?Math.max(...events.map(e=>Number(e.timestamp)||0)):null;
      if(baud>0&&first!=null&&last!=null&&last>first)utilizationPct=round(Math.min(100,(bytes*bitsPerChar/baud)/((last-first)/1000)*100),2);
      return {healthScore:Math.max(0,Math.round(score)),metrics:{...common,noiseBytes,noiseRatio:round(noiseRatio*100,3),wireUtilizationPct:utilizationPct,baudRate:Number.isFinite(baud)?baud:null}};
    }

    const diag=this.tcpDiagnostics.get(channel.channelId)||{};
    const mbapErrors=Number(diag.parserErrors||0),disconnects=Number(diag.disconnects||0),resets=Number(diag.resets||0),collisions=Number(diag.transactionIdCollisions||0),connectFailures=Number(diag.targetConnectFailures||0);
    if(mbapErrors)score-=Math.min(20,mbapErrors*2);
    if(resets)score-=Math.min(15,resets*2);
    if(collisions)score-=Math.min(15,collisions*3);
    if(connectFailures)score-=Math.min(20,connectFailures*4);
    return {healthScore:Math.max(0,Math.round(score)),metrics:{...common,mbapErrors,protocolIdErrors:Number(diag.protocolIdErrors||0),invalidLengthErrors:Number(diag.invalidLengthErrors||0),truncatedAdus:Number(diag.truncatedAdus||0),oversizedAdus:Number(diag.oversizedAdus||0),disconnects,resets,reconnects:Number(diag.reconnects||0),targetConnectFailures:connectFailures,transactionIdCollisions:collisions,backpressurePauses:Number(diag.backpressurePauses||0),rejectedSessions:Number(diag.rejectedSessions||0)}};
  }

  getChannels(){
    return super.getChannels().map(channel=>{
      const h=this._channelHealth(channel);
      return {...channel,healthScore:h.healthScore,health:h.metrics};
    });
  }

  getTransportSummary(){
    const base=super.getTransportSummary(),channels=this.getChannels();
    for(const transport of ['RTU','TCP']){
      const group=channels.filter(c=>c.transport===transport);
      base[transport].healthScore=group.length?Math.min(...group.map(c=>c.healthScore)):null;
      base[transport].channels=group.length;
    }
    return base;
  }

  getAnalysis(){
    const analysis=super.getAnalysis(),channels=this.getChannels();
    if(channels.length)analysis.healthScore=Math.min(...channels.map(c=>c.healthScore));
    analysis.healthAggregation='minimum-channel-score';
    analysis.channels=channels;
    const rtu=channels.filter(c=>c.transport==='RTU');
    const rtuBytes=rtu.reduce((s,c)=>s+Number(c.health?.bytes||0),0),rtuNoise=rtu.reduce((s,c)=>s+Number(c.health?.noiseBytes||0),0);
    analysis.rates.noiseRatio=rtuBytes+rtuNoise?round(rtuNoise/(rtuBytes+rtuNoise)*100,3):0;
    analysis.rates.noiseScope='RTU-only';
    analysis.transportHealth={
      RTU:rtu.map(c=>({channelId:c.channelId,healthScore:c.healthScore,metrics:c.health})),
      TCP:channels.filter(c=>c.transport==='TCP').map(c=>({channelId:c.channelId,healthScore:c.healthScore,metrics:c.health}))
    };
    return analysis;
  }

  exportCapture(){
    const capture=super.exportCapture();
    capture.analyzerVersion='6.2.0';
    capture.captureReferenceTime=this._analysisReferenceTime();
    capture.transactions=capture.transactions.map(t=>({...t,sourceTimestamp:Number(t.sourceTimestamp??t.timestamp)}));
    return capture;
  }

  loadCapture(capture,{emit=false}={}){
    super.loadCapture(capture,{emit});
    let reference=0;
    for(const t of capture.transactions||[])reference=Math.max(reference,Number(t.sourceTimestamp??t.timestamp)||0);
    this.captureReferenceTime=reference||Date.now();
    return this.getStatus();
  }
}

module.exports={PlatformRuntimeStateV62};
