'use strict';

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { ModbusTcpStreamParser } = require('./modbus/tcpParser');
const { TcpTransactionTracker } = require('./modbus/tcpTransactionTracker');
const { buildTcpChannel } = require('./transportIdentity');

class ModbusTcpProxy extends EventEmitter {
  constructor({
    listenHost='127.0.0.1', listenPort=1502, targetHost='127.0.0.1', targetPort=502,
    requestTimeoutMs=5000, maxClientSessions=8, onTransaction=null, onTimeout=null
  }={}) {
    super();
    Object.assign(this,{listenHost,listenPort,targetHost,targetPort,requestTimeoutMs,onTransaction,onTimeout});
    this.maxClientSessions=Math.max(1,Math.min(128,Number(maxClientSessions)||8));
    this.server=null;
    this.sessions=new Map();
    this.channel=buildTcpChannel({targetHost,targetPort,mode:'proxy'});
    this.seenClients=new Set();
    this.stats=this._newStats();
  }

  _newStats(){return{
    sessionOpens:0,cleanCloses:0,resets:0,targetConnectFailures:0,reconnects:0,rejectedSessions:0,
    parserErrors:0,protocolIdErrors:0,invalidLengthErrors:0,truncatedAdus:0,oversizedAdus:0,
    backpressurePauses:0,transactionIdCollisions:0,maxOutstanding:0
  };}

  _diag(type,details={}){
    const payload={type,timestamp:Date.now(),channel:this.channel,...details};
    this.emit('diagnostic',payload);
    return payload;
  }

  status() {
    let pendingRequests=0,transactionIdCollisions=0,maxOutstanding=0;
    for(const s of this.sessions.values()){
      const m=s.tracker.metrics();
      pendingRequests+=m.pendingRequests;
      transactionIdCollisions+=m.transactionIdCollisions;
      maxOutstanding=Math.max(maxOutstanding,m.maxOutstanding);
    }
    this.stats.transactionIdCollisions=Math.max(this.stats.transactionIdCollisions,transactionIdCollisions);
    this.stats.maxOutstanding=Math.max(this.stats.maxOutstanding,maxOutstanding);
    return {
      running:Boolean(this.server),listenHost:this.listenHost,listenPort:this.listenPort,
      targetHost:this.targetHost,targetPort:this.targetPort,connections:this.sessions.size,
      pendingRequests,transactionIdCollisions,maxOutstanding,
      maxClientSessions:this.maxClientSessions,stats:{...this.stats},
      mode:'inline-proxy',channel:this.channel
    };
  }

  async start(config={}) {
    if(this.server)await this.stop();
    Object.assign(this,config);
    this.maxClientSessions=Math.max(1,Math.min(128,Number(config.maxClientSessions??this.maxClientSessions)||8));
    this.channel=buildTcpChannel({targetHost:this.targetHost,targetPort:this.targetPort,mode:'proxy'});
    this.stats=this._newStats();
    this.seenClients.clear();
    this.server=net.createServer(client=>this._accept(client));
    await new Promise((resolve,reject)=>{
      const server=this.server;
      const fail=err=>{server.off('listening',ok);this.server=null;reject(err);};
      const ok=()=>{server.off('error',fail);resolve();};
      server.once('error',fail);server.once('listening',ok);server.listen(this.listenPort,this.listenHost);
    });
    this.emit('status',this.status());
    return this.status();
  }

  async stop() {
    const server=this.server;
    this.server=null;
    for(const session of [...this.sessions.values()])this._closeSession(session,'proxy-stop');
    if(server)await new Promise(resolve=>{try{server.close(()=>resolve());}catch{resolve();}});
    this.emit('status',this.status());
    return this.status();
  }

  _decorateTx(tx,session) {
    const unitId=tx?.decoded?.unitId??tx?.decoded?.slaveId??tx?.request?.unitId??tx?.request?.slaveId;
    const common={transport:'TCP',channelId:this.channel.channelId,channel:this.channel,sessionId:session.id,endpoint:this.channel.endpoint,unitId,slaveId:unitId};
    Object.assign(tx,common);
    if(tx.decoded)Object.assign(tx.decoded,common);
    if(tx.request)Object.assign(tx.request,common);
    return tx;
  }

  _accept(client) {
    if(this.sessions.size>=this.maxClientSessions){
      this.stats.rejectedSessions++;
      this._diag('session-rejected',{reason:'max-client-sessions',remoteAddress:client.remoteAddress||null});
      client.destroy();
      this.emit('status',this.status());
      return;
    }

    const id=crypto.randomUUID(),remoteAddress=client.remoteAddress||'unknown';
    const upstream=net.connect({host:this.targetHost,port:this.targetPort});
    const cp=new ModbusTcpStreamParser(),sp=new ModbusTcpStreamParser();
    const session={id,client,upstream,clientParser:cp,serverParser:sp,tracker:null,timer:null,closed:false,connected:false,connectedAt:Date.now(),remoteAddress};
    const tracker=new TcpTransactionTracker({
      requestTimeoutMs:this.requestTimeoutMs,
      onTimeout:(request,ts,ms)=>{
        Object.assign(request,{transport:'TCP',channelId:this.channel.channelId,channel:this.channel,sessionId:id,endpoint:this.channel.endpoint,unitId:request.unitId??request.slaveId,slaveId:request.unitId??request.slaveId});
        this.onTimeout?.(request,ts,ms,'TCP');
      },
      onCollision:detail=>{
        this.stats.transactionIdCollisions++;
        this._diag('transaction-id-collision',{sessionId:id,transactionId:detail.transactionId,unitId:detail.unitId,existing:detail.existing});
      }
    });
    session.tracker=tracker;
    this.sessions.set(id,session);
    this.stats.sessionOpens++;
    if(this.seenClients.has(remoteAddress))this.stats.reconnects++;
    this.seenClients.add(remoteAddress);

    const tick=Math.max(50,Math.min(250,Math.floor(this.requestTimeoutMs/4)));
    session.timer=setInterval(()=>tracker.expire(Date.now()),tick);session.timer.unref?.();

    const parserError=(side,error,raw)=>{
      this.stats.parserErrors++;
      if(error?.code==='MBAP_PROTOCOL_ID')this.stats.protocolIdErrors++;
      if(error?.code==='MBAP_INVALID_LENGTH')this.stats.invalidLengthErrors++;
      if(error?.code==='MBAP_TRUNCATED')this.stats.truncatedAdus++;
      if(error?.code==='MBAP_OVERSIZED')this.stats.oversizedAdus++;
      this._diag('parser-error',{sessionId:id,side,code:error?.code||'MBAP_ERROR',message:error?.message||String(error),rawHex:raw?Buffer.from(raw).toString('hex').toUpperCase():''});
      this.emit('frame-error',{sessionId:id,direction:side,error,raw});
    };

    cp.on('frame',(frame,ts)=>{const tx=this._decorateTx(tracker.request(frame,ts),session);this.onTransaction?.(tx,frame.raw,ts);this.stats.maxOutstanding=Math.max(this.stats.maxOutstanding,tracker.maxOutstanding);});
    sp.on('frame',(frame,ts)=>{const tx=this._decorateTx(tracker.response(frame,ts),session);this.onTransaction?.(tx,frame.raw,ts);});
    cp.on('noise',b=>this.emit('noise',{sessionId:id,direction:'client',bytes:b.length}));
    sp.on('noise',b=>this.emit('noise',{sessionId:id,direction:'server',bytes:b.length}));
    cp.on('error-frame',(error,raw)=>parserError('client',error,raw));
    sp.on('error-frame',(error,raw)=>parserError('server',error,raw));

    client.on('data',b=>{
      cp.push(b,Date.now());
      if(!upstream.destroyed&&!upstream.write(b)){
        this.stats.backpressurePauses++;client.pause();
        this._diag('backpressure',{sessionId:id,side:'client-to-target'});
      }
    });
    upstream.on('drain',()=>{if(!client.destroyed)client.resume();});
    upstream.on('data',b=>{
      sp.push(b,Date.now());
      if(!client.destroyed&&!client.write(b)){
        this.stats.backpressurePauses++;upstream.pause();
        this._diag('backpressure',{sessionId:id,side:'target-to-client'});
      }
    });
    client.on('drain',()=>{if(!upstream.destroyed)upstream.resume();});

    client.on('error',error=>{
      if(error?.code==='ECONNRESET')this.stats.resets++;
      this.emit('connection-error',{sessionId:id,side:'client',error});
      this._diag('connection-error',{sessionId:id,side:'client',code:error?.code||null,message:error?.message||String(error)});
    });
    upstream.on('error',error=>{
      if(!session.connected)this.stats.targetConnectFailures++;
      if(error?.code==='ECONNRESET')this.stats.resets++;
      this.emit('connection-error',{sessionId:id,side:'target',error});
      this._diag(session.connected?'connection-error':'target-connect-failure',{sessionId:id,side:'target',code:error?.code||null,message:error?.message||String(error)});
    });
    client.on('close',hadError=>this._closeSession(session,hadError?'client-reset':'client-close'));
    upstream.on('close',hadError=>this._closeSession(session,hadError?'target-reset':'target-close'));
    upstream.on('connect',()=>{
      session.connected=true;
      this.emit('session-open',{sessionId:id,channel:this.channel,remoteAddress});
      this._diag('session-open',{sessionId:id,remoteAddress});
    });
    this.emit('status',this.status());
  }

  _closeSession(session,reason) {
    if(!session||session.closed)return;
    session.closed=true;
    clearInterval(session.timer);
    session.clientParser.finish?.();
    session.serverParser.finish?.();
    const unresolved=session.tracker.drain(reason,Date.now());
    this.sessions.delete(session.id);
    if(reason.includes('reset'))this.stats.resets++;
    else if(['client-close','target-close','proxy-stop'].includes(reason))this.stats.cleanCloses++;
    try{session.client.destroy();}catch{}
    try{session.upstream.destroy();}catch{}
    this.emit('session-close',{sessionId:session.id,reason,channel:this.channel,unresolved:unresolved.length});
    this._diag('session-close',{sessionId:session.id,reason,unresolved:unresolved.length});
    this.emit('status',this.status());
  }
}

module.exports={ModbusTcpProxy};
