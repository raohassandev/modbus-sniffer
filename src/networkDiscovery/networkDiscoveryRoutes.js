'use strict';

const {listNetworkInterfaces}=require('./networkInterfaces');
const {previewTargets}=require('./targetParser');
const {NetworkStore}=require('./networkStore');
const {NetworkScanManager}=require('./scanManager');
const {scanTcpDeviceIds}=require('../activeDiscovery');
const {addressUtilization}=require('./topology');
const {detectNmap,fingerprintWithNmap}=require('./nmapAdapter');
const {SERVICE_CATALOG}=require('./serviceScanner');
const {readSnmpSystem,readLldpNeighbors}=require('./snmpClient');
const {auxiliaryDiscovery}=require('./multicastDiscovery');
const {NetworkMonitorManager}=require('./monitorManager');
const {OuiResolver}=require('./ouiResolver');
const {normalizeHost}=require('../transportIdentity');
const {pingDiagnostic,tracerouteHost}=require('./diagnostics');

function bodyBool(v){return v===true;}
function activeProjectId(workspaces,getActiveProjectId){return typeof getActiveProjectId==='function'?(getActiveProjectId()||'default'):(workspaces?.getActiveProject?.()?.id||'default');}
function statusCode(error){
  if(['NETWORK_SCAN_BUSY'].includes(error?.code))return 409;
  if(['NETWORK_SCAN_NOT_FOUND','NETWORK_HOST_NOT_FOUND','NETWORK_COMPARE_SOURCE_NOT_FOUND'].includes(error?.code))return 404;
  return 400;
}
function installNetworkDiscoveryRoutes({app,options={},workspaces=null,getActiveProjectId=null,broadcast=()=>{},store:providedStore=null,manager:providedManager=null,demo=false}={}){
  if(!app)throw new Error('Express app is required for network discovery routes.');
  const store=providedStore||new NetworkStore({dataDir:options.dataDir});
  const oui=new OuiResolver({dataDir:options.dataDir});
  const project=()=>activeProjectId(workspaces,getActiveProjectId);
  const manager=providedManager||new NetworkScanManager({store,getProjectId:project,lookupVendor:mac=>oui.lookup(mac)});
  const monitor=new NetworkMonitorManager({store,getProjectId:project});
  manager.on('status',s=>broadcast('network-scan',s));
  manager.on('host',x=>broadcast('network-host',x));
  manager.on('complete',s=>broadcast('network-scan-complete',s));
  manager.on('scan-error',x=>broadcast('network-scan-error',{jobId:x.jobId,ip:x.ip,error:x.error?.message||String(x.error||'error')}));
  monitor.on('result',x=>broadcast('network-monitor-result',x));
  monitor.on('status',x=>broadcast('network-monitor-status',x));

  const liveHost=id=>manager.status().hosts.find(h=>String(h.id)===String(id))||null;
  const findHost=id=>store.getHost(project(),id)||liveHost(id);
  const persistedHost=id=>{
    const current=store.getHost(project(),id);if(current)return current;
    const live=liveHost(id);return live?store.mergeHost(project(),live,'live-network-scan'):null;
  };

  const correlationsFor=host=>{
    if(!host||!workspaces?.getProject)return{channels:[],devices:[],discoveryRuns:[]};
    const p=workspaces.getProject(project());if(!p)return{channels:[],devices:[],discoveryRuns:[]};
    const target=normalizeHost(host.ip||host.hostname),channels=Object.values(p.channels||{}).filter(ch=>{
      if(String(ch.transport||'').toUpperCase()!=='TCP')return false;
      const candidate=normalizeHost(ch.tcp?.host||String(ch.endpoint||'').replace(/^\[([^\]]+)\](?::\d+)?$/,'$1').replace(/:\d+$/,''));
      return candidate&&candidate===target;
    }).map(ch=>({channelId:ch.channelId,name:ch.name||ch.channelId,endpoint:ch.endpoint||null,mode:ch.mode||null}));
    const ids=new Set(channels.map(x=>x.channelId)),devices=Object.values(p.devices||{}).filter(d=>ids.has(d.channelId||String(d.deviceKey||'').split('|')[0])).map(d=>({deviceKey:d.deviceKey,channelId:d.channelId||String(d.deviceKey||'').split('|')[0],unitId:d.unitId??Number(String(d.deviceKey||'').split('|').at(-1)),manufacturer:d.manufacturer||null,model:d.model||null}));
    const discoveryRuns=(p.discoveryRuns||[]).filter(run=>String(run.transport||'').toUpperCase()==='TCP'&&normalizeHost(run.target?.host)===target).map(run=>({id:run.id,completedAt:run.completedAt||null,summary:run.summary||{},target:run.target||null}));
    return{channels,devices,discoveryRuns};
  };

  app.get('/api/network/interfaces',(_q,r)=>r.json({interfaces:listNetworkInterfaces()}));
  app.get('/api/network/capabilities',async(_q,r)=>{
    const nmap=await detectNmap().catch(()=>({available:false,command:null,version:null}));
    r.json({scannerId:'local',nmap,oui:oui.status(),ipv4:true,ipv6:true,ipv6Model:'bounded-cidr',icmp:true,tcpConnect:true,neighborTable:true,reverseDns:true,httpMetadata:true,tlsMetadata:true,modbusVerification:true,snmp:true,lldp:true,multicastDiscovery:true,ssdp:true,mdns:true,wsd:true,dhcpContext:true,monitoring:true});
  });
  app.get('/api/network/oui/status',(_q,r)=>r.json(oui.status()));
  app.post('/api/network/aux-discovery',async(q,r)=>{
    try{
      const out=await auxiliaryDiscovery({ssdp:q.body?.ssdp!==false,mdns:q.body?.mdns!==false,wsd:q.body?.wsd!==false,dhcp:q.body?.dhcp!==false,timeoutMs:Number(q.body?.timeoutMs||1200)});
      const expectedDhcp=new Set((Array.isArray(q.body?.expectedDhcpServers)?q.body.expectedDhcpServers:String(q.body?.expectedDhcpServers||'').split(/[\s,;]+/)).map(String).map(x=>x.trim()).filter(Boolean));
      const dhcpServers=[...new Set(out.results.filter(x=>x.method==='dhcp-os'&&x.ip).map(x=>x.ip))];
      const findings=[];
      if(dhcpServers.length>1)findings.push({type:'multiple-dhcp-servers',severity:'warning',servers:dhcpServers,message:`${dhcpServers.length} DHCP servers were observed in the local OS network context.`});
      if(expectedDhcp.size)for(const ip of dhcpServers)if(!expectedDhcp.has(ip))findings.push({type:'unexpected-dhcp-server',severity:'critical',ip,servers:dhcpServers,message:`DHCP server ${ip} is not in the expected-server list.`});
      for(const finding of findings)store.addEvent(project(),{type:finding.type,source:'dhcp-context',severity:finding.severity,ip:finding.ip||null,details:finding});
      const merged=[];
      for(const row of out.results){
        if(!row.ip)continue;
        const existing=store.listHosts(project(),{search:row.ip,limit:64}).find(h=>h.ip===row.ip)||{};
        const hostname=row.names?.[0]||existing.hostname||null;
        const host=store.mergeHost(project(),{...existing,ip:row.ip,hostname,auxDiscovery:[...(existing.auxDiscovery||[]),row].slice(-64),alive:true,state:'online',lastSeen:new Date().toISOString()},row.source||row.method||'aux-discovery');
        merged.push(host);
      }
      broadcast('network-aux-discovery',{summary:out.summary,hosts:merged,findings});r.json({...out,hosts:merged,findings});
    }catch(e){r.status(400).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/network/targets/preview',(q,r)=>{
    try{r.json(previewTargets({targets:q.body?.targets??q.body?.target,exclude:q.body?.exclude,maxTargets:q.body?.maxTargets??262144}));}
    catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null,theoretical:e.theoretical,publicCount:e.publicCount});}
  });
  app.get('/api/network/scan/status',(_q,r)=>r.json(manager.status()));
  app.post('/api/network/scan/start',(q,r)=>{
    if(demo&&q.body?.allowDemoNetworkScan!==true)return r.status(409).json({error:'Network scanning is disabled in demo mode unless explicitly enabled.',code:'NETWORK_SCAN_DEMO_DISABLED'});
    try{r.status(202).json(manager.start(q.body||{}));}catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null,publicCount:e.publicCount||null});}
  });
  app.post('/api/network/scan/pause',(_q,r)=>r.json(manager.pause()));
  app.post('/api/network/scan/resume',(_q,r)=>r.json(manager.resume()));
  app.post('/api/network/scan/cancel',(_q,r)=>r.json(manager.cancel()));

  app.get('/api/network/hosts',(q,r)=>{
    try{r.json(store.listHosts(project(),{state:q.query.state||null,search:q.query.search||null,modbus:q.query.modbus==null?null:String(q.query.modbus)==='true',classification:q.query.classification||null,limit:q.query.limit}));}
    catch(e){r.status(400).json({error:e.message,code:e.code||null});}
  });
  app.get('/api/network/hosts/:id',(q,r)=>{const host=findHost(q.params.id);if(!host)return r.status(404).json({error:'Network host not found.',code:'NETWORK_HOST_NOT_FOUND'});r.json({...host,correlations:correlationsFor(host)});});
  app.patch('/api/network/hosts/:id',(q,r)=>{
    try{const host=store.updateHost(project(),q.params.id,{classification:q.body?.classification,notes:q.body?.notes,tags:q.body?.tags});if(!host)return r.status(404).json({error:'Network host not found.',code:'NETWORK_HOST_NOT_FOUND'});broadcast('network-host-updated',{host});r.json(host);}
    catch(e){r.status(400).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/network/hosts/:id/modbus',async(q,r)=>{
    try{
      const host=persistedHost(q.params.id);if(!host){const e=new Error('Network host not found.');e.code='NETWORK_HOST_NOT_FOUND';throw e;}
      const port=Number(q.body?.port||host.modbus?.port||host.services?.find(x=>x.port===502)?.port||502),unitStart=Number(q.body?.unitStart??1),unitEnd=Number(q.body?.unitEnd??247);
      const result=await scanTcpDeviceIds({host:host.ip,port,unitStart,unitEnd,timeoutMs:Number(q.body?.timeoutMs||650),interRequestMs:Number(q.body?.interRequestMs||50),readDeviceIdCode:Number(q.body?.readDeviceIdCode||1),maxSegments:Number(q.body?.maxSegments||8)});
      const units=result.results.filter(x=>x.responded).map(x=>({unitId:x.unitId,identificationSupported:x.identificationSupported,identification:x.identification,objects:x.objects,avgRttMs:x.avgRttMs}));
      const updated=store.mergeHost(project(),{...host,modbus:{verified:true,host:host.ip,port,unitId:units[0]?.unitId??host.modbus?.unitId??null},modbusUnits:units,lastSeen:new Date().toISOString()},'modbus-unit-scan');
      broadcast('network-host-updated',{host:updated});r.json({host:updated,result});
    }catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/network/hosts/:id/open-master',(q,r)=>{
    const host=persistedHost(q.params.id);if(!host)return r.status(404).json({error:'Network host not found.',code:'NETWORK_HOST_NOT_FOUND'});
    const unitId=Number(q.body?.unitId??host.modbus?.unitId??host.modbusUnits?.find(x=>x.responded)?.unitId??1),port=Number(q.body?.port||host.modbus?.port||502);
    const prepared={type:'tcp',host:host.ip,port,unitId:Number.isInteger(unitId)&&unitId>=0&&unitId<=255?unitId:1,connect:false,transmit:false,source:'network-discovery'};
    broadcast('network-master-handoff',{hostId:host.id,prepared});r.json({prepared,correlations:correlationsFor(host),message:'Master connection prepared only; no network request has been transmitted.'});
  });
  app.post('/api/network/hosts/:id/ping',async(q,r)=>{
    try{
      const host=persistedHost(q.params.id);if(!host){const e=new Error('Network host not found.');e.code='NETWORK_HOST_NOT_FOUND';throw e;}
      const result=await pingDiagnostic(host.ip,{timeoutMs:Number(q.body?.timeoutMs||1000)});
      if(result.responded)store.mergeHost(project(),{...host,state:'online',alive:true,lastSeen:result.checkedAt,diagnostics:{...(host.diagnostics||{}),ping:result}},'ping-diagnostic');
      store.addEvent(project(),{type:'ping-diagnostic',hostId:host.id,ip:host.ip,source:'network-diagnostics',details:result});
      r.json(result);
    }catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/network/hosts/:id/traceroute',async(q,r)=>{
    try{
      const host=persistedHost(q.params.id);if(!host){const e=new Error('Network host not found.');e.code='NETWORK_HOST_NOT_FOUND';throw e;}
      const result=await tracerouteHost(host.ip,{maxHops:Number(q.body?.maxHops||24),perHopTimeoutMs:Number(q.body?.perHopTimeoutMs||1000),timeoutMs:Number(q.body?.timeoutMs||30000)});
      store.addEvent(project(),{type:'traceroute-diagnostic',hostId:host.id,ip:host.ip,source:'network-diagnostics',details:{ok:result.ok,hops:result.hops,error:result.error||null}});
      r.json(result);
    }catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}
  });

  app.post('/api/network/hosts/:id/nmap',async(q,r)=>{
    try{
      const host=persistedHost(q.params.id);if(!host){const e=new Error('Network host not found.');e.code='NETWORK_HOST_NOT_FOUND';throw e;}
      const result=await fingerprintWithNmap({host:host.ip,ports:q.body?.ports||[],allowOsDetect:bodyBool(q.body?.allowOsDetect),timeoutMs:Number(q.body?.timeoutMs||60000)});
      const n=result.host||{},services=(n.ports||[]).filter(x=>x.state==='open').map(x=>({port:x.port,protocol:x.protocol||'tcp',open:true,name:x.product?[`${x.name||''}`,x.product,x.version].filter(Boolean).join(' '):(x.name||SERVICE_CATALOG[x.port]?.name||'Unknown TCP'),category:SERVICE_CATALOG[x.port]?.category||'unknown',source:'external:nmap',confidence:Math.max(60,Math.min(100,Number(x.confidence)||80)),status:'verified',nmap:x}));
      const updated=store.mergeHost(project(),{...host,mac:n.mac||host.mac,macVendor:n.macVendor||host.macVendor||null,hostname:n.hostnames?.[0]||host.hostname,hostnames:[...new Set([...(host.hostnames||[]),...(n.hostnames||[])])],services:services.length?services:host.services,nmap:{version:result.nmap?.version||null,os:n.os||null,osMatches:n.osMatches||[],scannedAt:new Date().toISOString()},lastSeen:new Date().toISOString()},'external:nmap');
      broadcast('network-host-updated',{host:updated});r.json({host:updated,nmap:result.nmap,os:n.os||null,ports:n.ports||[]});
    }catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}
  });

  app.post('/api/network/hosts/:id/snmp',async(q,r)=>{
    try{
      const host=persistedHost(q.params.id);if(!host){const e=new Error('Network host not found.');e.code='NETWORK_HOST_NOT_FOUND';throw e;}
      const community=String(q.body?.community||'').trim();if(!community){const e=new Error('Enter the SNMP community explicitly for this read-only query.');e.code='SNMP_COMMUNITY_REQUIRED';throw e;}
      const port=Number(q.body?.port||161),timeoutMs=Number(q.body?.timeoutMs||900);
      const [systemResult,neighbors]=await Promise.all([
        readSnmpSystem({host:host.ip,port,community,timeoutMs}),
        bodyBool(q.body?.readLldp)?readLldpNeighbors({host:host.ip,port,community,timeoutMs,maxRows:Number(q.body?.maxNeighbors||64)}):Promise.resolve([])
      ]);
      const sys=systemResult.system||{},updated=store.mergeHost(project(),{...host,hostname:host.hostname||sys.sysName||null,snmp:{system:sys,queriedAt:new Date().toISOString(),port},topologyNeighbors:neighbors,lastSeen:new Date().toISOString()},'snmp-read');
      if(neighbors.length){
        const topology=store.getTopology(project()),existing=topology.edges||[],extra=neighbors.map((n,i)=>({id:`edge:snmp:${updated.id}:${n.index||i}`,from:updated.id,to:String(n.name||n.chassisId||`lldp:${n.index||i}`),kind:'neighbor',source:'LLDP/SNMP',confidence:Number(n.confidence||95),physical:true,localPort:n.localPort||null,remotePort:n.remotePort||null,remoteName:n.name||null,chassisId:n.chassisId||null}));
        store.setTopology(project(),{nodes:topology.nodes||[],edges:[...existing,...extra]});
      }
      broadcast('network-host-updated',{host:updated});r.json({host:updated,system:sys,neighbors});
    }catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}
  });

  app.get('/api/network/monitor',(_q,r)=>r.json(monitor.list()));
  app.post('/api/network/hosts/:id/monitor',(q,r)=>{
    try{
      const host=persistedHost(q.params.id);if(!host)return r.status(404).json({error:'Network host not found.',code:'NETWORK_HOST_NOT_FOUND'});
      const ports=Array.isArray(q.body?.ports)?q.body.ports:(host.services||[]).slice(0,8).map(s=>s.port);
      const modbusPort=Number(q.body?.modbusPort||host.modbus?.port||0)||null;
      r.status(201).json(monitor.start({hostId:host.id,ip:host.ip,ports,modbusPort,intervalMs:Number(q.body?.intervalMs||30000)}));
    }catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}
  });
  app.post('/api/network/hosts/:id/monitor/check',async(q,r)=>{try{r.json(await monitor.checkNow(q.params.id));}catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}});
  app.delete('/api/network/hosts/:id/monitor',(q,r)=>r.json({ok:monitor.stop(q.params.id)}));

  app.get('/api/network/scans',(_q,r)=>r.json(store.listScans(project())));
  app.get('/api/network/scans/:id',(q,r)=>{const x=store.getScan(project(),q.params.id);if(!x)return r.status(404).json({error:'Network scan not found.',code:'NETWORK_SCAN_NOT_FOUND'});r.json(x);});
  app.get('/api/network/scans/:id/export.json',(q,r)=>{const x=store.getScan(project(),q.params.id);if(!x)return r.status(404).json({error:'Network scan not found.',code:'NETWORK_SCAN_NOT_FOUND'});r.setHeader('Content-Disposition',`attachment; filename="network-scan-${String(x.id).replace(/[^a-z0-9._-]/gi,'_')}.json"`);r.json(x);});
  app.get('/api/network/hosts.csv',(_q,r)=>{
    const rows=store.listHosts(project(),{limit:4096}),esc=v=>{let s=String(v??'');if(/^[\t\r\n ]*[=+\-@]/.test(s))s=`'${s}`;return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
    const lines=['state,ip,mac,hostname,type,classification,services,modbus,avgRttMs,lastSeen'];
    for(const h of rows)lines.push([h.state,h.ip,h.mac,h.hostname,h.type,h.classification,(h.services||[]).map(s=>`${s.port}/${s.protocol||'tcp'} ${s.name}`).join('; '),h.modbus?.verified?'yes':'no',h.avgRttMs,h.lastSeen].map(esc).join(','));
    r.setHeader('Content-Type','text/csv; charset=utf-8');r.setHeader('Content-Disposition','attachment; filename="network-hosts.csv"');r.send(lines.join('\r\n'));
  });
  app.post('/api/network/scans/:id/baseline',(q,r)=>{try{r.status(201).json(store.saveBaseline(project(),q.params.id,q.body?.name));}catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}});
  app.get('/api/network/baselines',(_q,r)=>r.json(store.listBaselines(project())));
  app.get('/api/network/compare',(q,r)=>{try{r.json(store.compare(project(),{leftScanId:q.query.left||null,rightScanId:q.query.right||null,baselineId:q.query.baseline||null}));}catch(e){r.status(statusCode(e)).json({error:e.message,code:e.code||null});}});
  app.get('/api/network/events',(q,r)=>r.json(store.listEvents(project(),{limit:q.query.limit,hostId:q.query.hostId||null,ip:q.query.ip||null,type:q.query.type||null})));
  app.get('/api/network/topology',(_q,r)=>r.json(store.getTopology(project())));
  app.get('/api/network/utilization',(_q,r)=>r.json({subnets:addressUtilization(store.listHosts(project(),{limit:4096}))}));
  app.put('/api/network/topology',(q,r)=>{try{r.json(store.setTopology(project(),q.body||{}));}catch(e){r.status(400).json({error:e.message,code:e.code||null});}});

  return{manager,store,monitor,oui,close:async()=>{await Promise.allSettled([manager.close(),monitor.close()]);}};
}
module.exports={installNetworkDiscoveryRoutes};
