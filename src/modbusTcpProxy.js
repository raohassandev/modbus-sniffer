'use strict';

const net=require('net');
const {EventEmitter}=require('events');
const {ModbusTcpStreamParser}=require('./modbus/tcpParser');
const {TcpTransactionTracker}=require('./modbus/tcpTransactionTracker');

class ModbusTcpProxy extends EventEmitter{
  constructor({listenHost='127.0.0.1',listenPort=1502,targetHost='127.0.0.1',targetPort=502,requestTimeoutMs=5000,onTransaction=null,onTimeout=null}={}){super();Object.assign(this,{listenHost,listenPort,targetHost,targetPort,requestTimeoutMs,onTransaction,onTimeout});this.server=null;this.connections=new Set();}
  status(){return{running:Boolean(this.server),listenHost:this.listenHost,listenPort:this.listenPort,targetHost:this.targetHost,targetPort:this.targetPort,connections:this.connections.size,mode:'inline-proxy'};}
  async start(config={}){if(this.server)await this.stop();Object.assign(this,config);this.server=net.createServer(client=>this._accept(client));await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.listenPort,this.listenHost,resolve);});this.emit('status',this.status());return this.status();}
  async stop(){if(!this.server)return this.status();for(const c of this.connections){try{c.destroy();}catch{}}const s=this.server;this.server=null;await new Promise(resolve=>s.close(()=>resolve()));this.emit('status',this.status());return this.status();}
  _accept(client){const upstream=net.connect({host:this.targetHost,port:this.targetPort});this.connections.add(client);this.connections.add(upstream);const cp=new ModbusTcpStreamParser(),sp=new ModbusTcpStreamParser();const tracker=new TcpTransactionTracker({requestTimeoutMs:this.requestTimeoutMs,onTimeout:(r,ts,ms)=>this.onTimeout?.(r,ts,ms,'TCP')});
    cp.on('frame',(f,ts)=>{const tx=tracker.request(f,ts);this.onTransaction?.(tx,f.raw,ts);});sp.on('frame',(f,ts)=>{const tx=tracker.response(f,ts);this.onTransaction?.(tx,f.raw,ts);});cp.on('noise',b=>this.emit('noise',{direction:'client',bytes:b.length}));sp.on('noise',b=>this.emit('noise',{direction:'server',bytes:b.length}));
    client.on('data',b=>{cp.push(b,Date.now());if(!upstream.destroyed)upstream.write(b);});upstream.on('data',b=>{sp.push(b,Date.now());if(!client.destroyed)client.write(b);});
    const close=()=>{this.connections.delete(client);this.connections.delete(upstream);try{client.destroy();}catch{}try{upstream.destroy();}catch{}this.emit('status',this.status());};client.on('error',e=>this.emit('connection-error',e));upstream.on('error',e=>this.emit('connection-error',e));client.on('close',close);upstream.on('close',close);this.emit('status',this.status());}
}
module.exports={ModbusTcpProxy};
