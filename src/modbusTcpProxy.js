'use strict';

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { ModbusTcpStreamParser } = require('./modbus/tcpParser');
const { TcpTransactionTracker } = require('./modbus/tcpTransactionTracker');
const { buildTcpChannel } = require('./transportIdentity');

class ModbusTcpProxy extends EventEmitter {
  constructor({listenHost='127.0.0.1',listenPort=1502,targetHost='127.0.0.1',targetPort=502,requestTimeoutMs=5000,onTransaction=null,onTimeout=null}={}) {
    super();
    Object.assign(this,{listenHost,listenPort,targetHost,targetPort,requestTimeoutMs,onTransaction,onTimeout});
    this.server=null;
    this.sessions=new Map();
    this.channel=buildTcpChannel({targetHost,targetPort,mode:'proxy'});
  }

  status() {
    return {
      running:Boolean(this.server),listenHost:this.listenHost,listenPort:this.listenPort,
      targetHost:this.targetHost,targetPort:this.targetPort,connections:this.sessions.size,
      pendingRequests:[...this.sessions.values()].reduce((n,s)=>n+s.tracker.pending.size,0),
      mode:'inline-proxy',channel:this.channel
    };
  }

  async start(config={}) {
    if(this.server)await this.stop();
    Object.assign(this,config);
    this.channel=buildTcpChannel({targetHost:this.targetHost,targetPort:this.targetPort,mode:'proxy'});
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
    const id=crypto.randomUUID();
    const upstream=net.connect({host:this.targetHost,port:this.targetPort});
    const cp=new ModbusTcpStreamParser(),sp=new ModbusTcpStreamParser();
    const session={id,client,upstream,clientParser:cp,serverParser:sp,tracker:null,timer:null,closed:false,connectedAt:Date.now()};
    const tracker=new TcpTransactionTracker({
      requestTimeoutMs:this.requestTimeoutMs,
      onTimeout:(request,ts,ms)=>{
        Object.assign(request,{transport:'TCP',channelId:this.channel.channelId,channel:this.channel,sessionId:id,endpoint:this.channel.endpoint,unitId:request.unitId??request.slaveId,slaveId:request.unitId??request.slaveId});
        this.onTimeout?.(request,ts,ms,'TCP');
      }
    });
    session.tracker=tracker;
    this.sessions.set(id,session);
    const tick=Math.max(50,Math.min(250,Math.floor(this.requestTimeoutMs/4)));
    session.timer=setInterval(()=>tracker.expire(Date.now()),tick);session.timer.unref?.();

    cp.on('frame',(frame,ts)=>{const tx=this._decorateTx(tracker.request(frame,ts),session);this.onTransaction?.(tx,frame.raw,ts);});
    sp.on('frame',(frame,ts)=>{const tx=this._decorateTx(tracker.response(frame,ts),session);this.onTransaction?.(tx,frame.raw,ts);});
    cp.on('noise',b=>this.emit('noise',{sessionId:id,direction:'client',bytes:b.length}));
    sp.on('noise',b=>this.emit('noise',{sessionId:id,direction:'server',bytes:b.length}));
    cp.on('error-frame',(error,raw)=>this.emit('frame-error',{sessionId:id,direction:'client',error,raw}));
    sp.on('error-frame',(error,raw)=>this.emit('frame-error',{sessionId:id,direction:'server',error,raw}));

    client.on('data',b=>{cp.push(b,Date.now());if(!upstream.destroyed)upstream.write(b);});
    upstream.on('data',b=>{sp.push(b,Date.now());if(!client.destroyed)client.write(b);});
    client.on('error',error=>this.emit('connection-error',{sessionId:id,side:'client',error}));
    upstream.on('error',error=>this.emit('connection-error',{sessionId:id,side:'target',error}));
    client.on('close',()=>this._closeSession(session,'client-close'));
    upstream.on('close',()=>this._closeSession(session,'target-close'));
    upstream.on('connect',()=>this.emit('session-open',{sessionId:id,channel:this.channel,remoteAddress:client.remoteAddress||null}));
    this.emit('status',this.status());
  }

  _closeSession(session,reason) {
    if(!session||session.closed)return;
    session.closed=true;
    clearInterval(session.timer);
    // Expire pending requests immediately only if their normal timeout has elapsed;
    // otherwise closing a TCP socket is represented as a disconnect, not fabricated RTT.
    session.tracker.expire(Date.now());
    this.sessions.delete(session.id);
    try{session.client.destroy();}catch{}
    try{session.upstream.destroy();}catch{}
    this.emit('session-close',{sessionId:session.id,reason,channel:this.channel});
    this.emit('status',this.status());
  }
}

module.exports={ModbusTcpProxy};
