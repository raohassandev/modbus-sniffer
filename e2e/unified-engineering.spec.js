'use strict';

const { test, expect } = require('@playwright/test');
const { version: PRODUCT_VERSION } = require('../package.json');

async function safePost(request,url,data={}){
  const response=await request.post(url,{data});
  return response;
}

test.describe('unified Modbus engineering product',()=>{
  test.beforeEach(async({request})=>{
    await safePost(request,'/api/master/disconnect').catch(()=>undefined);
    await safePost(request,'/api/slave/stop').catch(()=>undefined);
  });

  test.afterEach(async({request})=>{
    await safePost(request,'/api/master/disconnect').catch(()=>undefined);
    await safePost(request,'/api/slave/stop').catch(()=>undefined);
  });

  test('unified health/UI identity matches the release product',async({page,request})=>{
    const statusResponse=await request.get('/api/status');
    expect(statusResponse.ok()).toBeTruthy();
    const status=await statusResponse.json();
    expect(status.productName).toBe('Modbus Engineering Tool');
    expect(status.productVersion).toBe(PRODUCT_VERSION);
    await page.goto('/');
    await expect(page.locator('body')).toContainText('Modbus Engineering Tool');
    await expect(page.locator('.version-badge')).toContainText(`UI v${PRODUCT_VERSION}`);
  });

  test('unified server does not expose the internal compatibility shell',async({request})=>{
    const response=await request.get('/v8/');
    expect(response.status()).toBe(404);
  });

  test('primary Modbus workspaces are available from one stable shell',async({page})=>{
    await page.goto('/');
    await expect(page.locator('[data-page="master"]')).toBeVisible();
    await expect(page.locator('[data-page="slave"]')).toBeVisible();
    await expect(page.locator('[data-page="traffic"]')).toBeVisible();
    await expect(page.locator('[data-page="discovery"]')).toBeVisible();
    await expect(page.locator('[data-page="rawLab"]')).toBeVisible();
    await expect(page.locator('[data-page="testSequences"]')).toBeVisible();
    await expect(page.locator('[data-page="loggerTrend"]')).toBeVisible();
    await expect(page.locator('[data-page="compare"]')).toBeVisible();
    await expect(page.locator('[data-page="transportLab"]')).toBeVisible();
    await expect(page.locator('[data-page="help"]')).toBeVisible();

    for(const pageName of ['master','slave','rawLab','loggerTrend','compare','help']){
      await page.locator(`[data-page="${pageName}"]`).click();
      await expect(page.locator(`#page-${pageName}`)).toBeVisible();
    }

    await expect(page.locator('#page-help')).toContainText('Sniffer / Analyzer');
    await expect(page.locator('#page-help')).toContainText('Master');
    await expect(page.locator('#page-help')).toContainText('Slave');
    await expect(page.locator('#page-help')).toContainText('WRITES LOCKED BY DEFAULT');
  });

  test('dashboard makes RTU versus inline TCP capture source explicit',async({page,request})=>{
    await page.goto('/');
    await expect(page.locator('#sourceBanner')).toBeVisible();
    await expect(page.locator('#sourceBannerBody')).toContainText(/RTU|TCP|source/i);

    const tcpStatus=await request.get('/api/tcp/status');
    expect(tcpStatus.ok()).toBeTruthy();

    await page.locator('[data-page="tcp"]').click();
    await expect(page.locator('#page-tcp')).toBeVisible();
    await expect(page.locator('#page-tcp')).toContainText('direct PLC traffic sent straight to the target device bypasses this application');
    await expect(page.locator('#tcpFixed502')).toBeVisible();
  });

  test('industrial network discovery previews large ranges and exposes the integrated workflow without transmitting',async({page,request})=>{
    const capabilitiesResponse=await request.get('/api/network/capabilities');
    expect(capabilitiesResponse.ok()).toBeTruthy();
    const capabilities=await capabilitiesResponse.json();
    expect(capabilities.ipv4).toBe(true);
    expect(capabilities.modbusVerification).toBe(true);

    const previewResponse=await request.post('/api/network/targets/preview',{data:{targets:'192.168.1-2.1-3'}});
    expect(previewResponse.ok()).toBeTruthy();
    const preview=await previewResponse.json();
    expect(preview.count).toBe(6);
    expect(preview.hasPublicTargets).toBe(false);

    await page.goto('/');
    await page.locator('[data-page="discovery"]').click();
    await expect(page.locator('#networkDiscoveryRoot')).toBeVisible();
    await expect(page.locator('.nd-tabs')).toContainText('Network Scan');
    await expect(page.locator('.nd-tabs')).toContainText('Devices');
    await expect(page.locator('.nd-tabs')).toContainText('Topology');
    await expect(page.locator('.nd-tabs')).toContainText('Modbus Discovery');
    await expect(page.locator('.nd-tabs')).toContainText('History');
    await page.locator('#ndTarget').fill('192.168.1-2.1-3');
    await page.locator('#ndPreview').click();
    await expect(page.locator('#ndPreviewBox')).toContainText('6 unique target(s)');
    const status=await request.get('/api/network/scan/status');
    expect(status.ok()).toBeTruthy();
    expect((await status.json()).running).toBe(false);
  });

  test('network discovery UI covers scan controls, safe rendering, device drawer, topology and baseline compare',async({page})=>{
    const host={
      id:'mac:00:11:22:33:44:55',scannerId:'local',state:'online',alive:true,ip:'192.168.10.25',
      mac:'00:11:22:33:44:55',macVendor:'Example Controls',hostname:'<img src=x onerror=alert(1)>',
      type:'Modbus Device',typeConfidence:95,confidence:98,industrial:true,
      services:[{port:80,protocol:'tcp',name:'HTTP',category:'web'},{port:502,protocol:'tcp',name:'Modbus TCP',category:'modbus-candidate'}],
      modbus:{verified:true,port:502,unitId:1},avgRttMs:3.2,classification:'trusted',
      firstSeen:'2026-09-21T00:00:00.000Z',lastSeen:'2026-09-21T00:01:00.000Z',lastChanged:'2026-09-21T00:01:00.000Z',
      evidence:[{field:'modbus',value:'192.168.10.25:502',source:'modbus-protocol-verification',confidence:100,status:'verified'}],
      correlations:{channels:[{channelId:'tcp:existing',name:'Existing TCP',endpoint:'192.168.10.25:502'}],devices:[{deviceKey:'tcp:existing|1',unitId:1,manufacturer:'Example',model:'PLC'}]}
    };
    let status={state:'idle',running:false,paused:false,jobId:null,profile:null,target:null,progress:{total:0,scanned:0,stage:null},summary:{targets:0,scanned:0,online:0,industrial:0,modbus:0,unknown:0,warnings:0},hosts:[],findings:[]};
    const json=(route,body,statusCode=200)=>route.fulfill({status:statusCode,contentType:'application/json',body:JSON.stringify(body)});
    await page.route('**/api/network/**',async route=>{
      const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method();
      if(p==='/api/network/capabilities')return json(route,{scannerId:'local',ipv4:true,ipv6:true,ipv6Model:'bounded-cidr',snmp:true,lldp:true,multicastDiscovery:true,modbusVerification:true,nmap:{available:false},oui:{available:true,count:123}});
      if(p==='/api/network/interfaces')return json(route,{interfaces:[{id:'eth|192.168.10.5',name:'Ethernet',family:'IPv4',address:'192.168.10.5',cidr:'192.168.10.5/24',suggestedTarget:'192.168.10.0/24'}]});
      if(p==='/api/network/targets/preview')return json(route,{version:2,count:6,theoreticalCount:6,privateCount:6,publicCount:0,hasPublicTargets:false,samples:['192.168.10.1','192.168.10.2']});
      if(p==='/api/network/scan/status')return json(route,status);
      if(p==='/api/network/scan/start'){
        status={state:'running',running:true,paused:false,jobId:'scan-ui',profile:'standard',target:'192.168.10.1-192.168.10.6',progress:{total:6,scanned:2,stage:'host-discovery'},summary:{targets:6,scanned:2,online:1,industrial:1,modbus:1,unknown:0,warnings:1},hosts:[host],findings:[{type:'duplicate-ip',severity:'critical',message:'Duplicate IP detected'}]};
        return json(route,status,202);
      }
      if(p==='/api/network/scan/pause'){status={...status,state:'paused',paused:true};return json(route,status);}
      if(p==='/api/network/scan/resume'){status={...status,state:'running',paused:false};return json(route,status);}
      if(p==='/api/network/scan/cancel'){status={...status,state:'cancelled',running:false,paused:false,progress:{...status.progress,stage:'cancelled'}};return json(route,status);}
      if(p==='/api/network/hosts.csv')return route.fulfill({status:200,contentType:'text/csv',body:'ip\\r\\n192.168.10.25'});
      if(p==='/api/network/hosts'&&method==='GET')return json(route,[host]);
      if(p==='/api/network/monitor')return json(route,[]);
      if(p==='/api/network/hosts/'+encodeURIComponent(host.id)&&method==='GET')return json(route,host);
      if(p==='/api/network/hosts/'+encodeURIComponent(host.id)+'/open-master'&&method==='POST')return json(route,{prepared:{type:'tcp',host:host.ip,port:502,unitId:1,connect:false,transmit:false,source:'network-discovery'},correlations:host.correlations});
      if(p==='/api/network/topology')return json(route,{nodes:[{id:'subnet:192.168.10.0/24',kind:'subnet',label:'192.168.10.0/24'},{id:host.id,kind:'host',label:'PLC-25',ip:host.ip,state:'online',industrial:true,modbus:true}],edges:[{id:'e1',from:'subnet:192.168.10.0/24',to:host.id,kind:'logical-membership',source:'address-membership',confidence:100,physical:false}]});
      if(p==='/api/network/utilization')return json(route,{subnets:[{subnet:'192.168.10.0/24',used:1,free:253,online:1,modbus:1,industrial:1,conflicts:0,usedHosts:[25]}]});
      if(p==='/api/network/scans')return json(route,[{id:'s2',profile:'standard',target:'192.168.10.0/24',completedAt:'2026-09-21T00:02:00.000Z',hostCount:1,findingsCount:0}]);
      if(p==='/api/network/baselines')return json(route,[{id:'b1',scanId:'s1',name:'Commissioning',createdAt:'2026-09-20T00:00:00.000Z',hostCount:1}]);
      if(p==='/api/network/events')return json(route,[{id:'ev1',at:'2026-09-21T00:01:00.000Z',type:'host-discovered',ip:host.ip,source:'network-scan'}]);
      if(p==='/api/network/compare')return json(route,{summary:{added:0,removed:0,changed:1,unchanged:0},added:[],removed:[],unchanged:[],changed:[{before:{...host,hostname:'PLC-OLD'},after:host,changes:[{field:'hostname',before:'PLC-OLD',after:host.hostname}]}]});
      return json(route,{});
    });

    await page.goto('/');
    await page.locator('[data-page="discovery"]').click();
    await expect(page.locator('#networkDiscoveryRoot')).toBeVisible();
    await page.locator('#ndTarget').fill('192.168.10.1-192.168.10.6');
    await page.locator('#ndPreview').click();
    await expect(page.locator('#ndPreviewBox')).toContainText('6 unique target(s)');
    await page.locator('#ndStart').click();
    await expect(page.locator('#ndProgressTitle')).toHaveText('Scanning');
    await expect(page.locator('#ndKpiModbus')).toHaveText('1');
    await expect(page.locator('#ndFindings')).toContainText('Duplicate IP detected');
    await expect(page.locator('#ndScanRows')).toContainText('192.168.10.25');
    expect(await page.locator('#ndScanRows img').count()).toBe(0);

    await page.locator('#ndPause').click();await expect(page.locator('#ndProgressTitle')).toHaveText('Paused');
    await page.locator('#ndResume').click();await expect(page.locator('#ndProgressTitle')).toHaveText('Scanning');

    await page.locator('#ndScanRows tr[data-nd-host]').click();
    await expect(page.locator('#ndDrawer')).toHaveClass(/open/);
    expect(await page.locator('#ndDrawer img').count()).toBe(0);
    await page.locator('[data-drawer-tab="evidence"]').click();
    await expect(page.locator('[data-drawer-panel="evidence"]')).toContainText('modbus-protocol-verification');
    await page.locator('#ndDrawerClose').click();

    await page.locator('[data-nd-tab="topology"]').click();
    await expect(page.locator('#ndTopologyViewport')).toContainText('PLC-25');
    await expect(page.locator('#ndTopologyEdges')).toContainText('address-membership');

    await page.locator('[data-nd-tab="history"]').click();
    await page.locator('#ndBaseline').selectOption('b1');
    await page.locator('#ndCompareScan').selectOption('s2');
    await page.locator('#ndCompare').click();
    await expect(page.locator('#ndCompareResult')).toContainText('Changed');

    await page.locator('[data-nd-tab="scan"]').click();
    await page.locator('#ndCancel').click();
    await expect(page.locator('#ndProgressTitle')).toHaveText('Cancelled');
  });

  test('Master Monitor Sessions merge local fallback and durable workstation state across browser reloads',async({page,request})=>{
    const remotePayload={
      version:1,
      activeId:'remote-monitor',
      sessions:[{
        id:'remote-monitor',
        name:'Remote Durable Monitor',
        createdAt:1000,updatedAt:1000,
        connection:{type:'tcp',host:'127.0.0.1',port:502,timeoutMs:1000},
        definition:{unitId:1,functionCode:3,address:42,quantity:2,pollIntervalMs:1000,timeoutMs:1000},
        format:{type:'uint16',scale:1,offset:0,precision:0,byteOrder:'ABCD'},
        snapshot:{rowsHtml:'<img src=x onerror=alert(1)>'}
      }]
    };
    const localPayload={
      version:1,
      activeId:'local-monitor',
      sessions:[{
        id:'local-monitor',
        name:'Local Fallback Monitor',
        createdAt:2000,updatedAt:2000,
        connection:{type:'tcp',host:'127.0.0.1',port:502,timeoutMs:1000},
        definition:{unitId:1,functionCode:4,address:84,quantity:1,pollIntervalMs:1500,timeoutMs:1000},
        format:{type:'uint16',scale:1,offset:0,precision:0,byteOrder:'ABCD'},
        snapshot:{rowsHtml:'<script>window.__bad=1</script>'}
      }]
    };
    const saved=await request.put('/api/master/monitor-sessions',{data:remotePayload});
    expect(saved.ok()).toBeTruthy();
    const savedBody=await saved.json();
    expect(savedBody.sessions[0].snapshot.rowsHtml).toBe('');

    await page.addInitScript(payload=>{
      localStorage.setItem('modbus.master.monitor-sessions.v1',JSON.stringify(payload));
    },localPayload);
    await page.goto('/');
    await expect(page.locator('#masterSessionActiveName')).toHaveText('Local Fallback Monitor');
    await expect(page.locator('#masterSessionTabs')).toContainText('Remote Durable Monitor');
    await expect(page.locator('#masterSessionTabs')).toContainText('Local Fallback Monitor');
    expect(await page.locator('#masterDataBody img, #masterDataBody script').count()).toBe(0);
    await expect.poll(async()=>{
      const response=await request.get('/api/master/monitor-sessions');
      const body=await response.json();
      return body.sessions?.length||0;
    }).toBe(2);

    await page.reload();
    await expect(page.locator('#masterSessionTabs')).toContainText('Remote Durable Monitor');
    await expect(page.locator('#masterSessionTabs')).toContainText('Local Fallback Monitor');

    await page.close({runBeforeUnload:false});
    const cleared=await request.put('/api/master/monitor-sessions',{data:{version:1,activeId:null,sessions:[]}});
    expect(cleared.ok()).toBeTruthy();
  });

  test('all navigation workspaces stay usable without shell overflow at supported desktop viewports',async({page})=>{
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error?.message||error)));
    for(const viewport of [{width:1100,height:700},{width:1280,height:720},{width:1920,height:1080}]){
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('[data-page="help"]')).toBeVisible();
      await expect(page.locator('#platformAssetFailure')).toHaveCount(0);

      const pageNames=await page.locator('.nav-item[data-page]').evaluateAll(nodes=>[
        ...new Set(nodes.map(node=>node.dataset.page).filter(Boolean))
      ]);
      for(const required of ['dashboard','master','slave','traffic','discovery','rawLab','testSequences','loggerTrend','compare','transportLab','settings','help']){
        expect(pageNames).toContain(required);
      }

      for(const pageName of pageNames){
        const button=page.locator(`.nav-item[data-page="${pageName}"]`).first();
        await button.click();
        await expect(page.locator(`#page-${pageName}`)).toBeVisible();
        const integrity=await page.evaluate(()=>{
          const counts=new Map();
          for(const node of document.querySelectorAll('[id]'))counts.set(node.id,(counts.get(node.id)||0)+1);
          return{
            duplicateIds:[...counts.entries()].filter(([,count])=>count>1),
            scrollWidth:document.documentElement.scrollWidth,
            clientWidth:document.documentElement.clientWidth,
          };
        });
        expect(integrity.duplicateIds).toEqual([]);
        expect(integrity.scrollWidth).toBeLessThanOrEqual(integrity.clientWidth);
      }
    }
    expect(pageErrors).toEqual([]);
  });

  test('built-in TCP Slave and stable Master complete a loopback read with writes still locked',async({request})=>{
    const started=await safePost(request,'/api/slave/start',{
      type:'tcp',host:'127.0.0.1',port:0,maxClients:4
    });
    expect(started.ok()).toBeTruthy();
    const slaveStatus=await started.json();
    expect(slaveStatus.running).toBeTruthy();
    expect(slaveStatus.listenAddress?.port).toBeGreaterThan(0);

    const seeded=await safePost(request,'/api/slave/memory',{
      unitId:1,area:'holdingRegisters',address:10,values:[1234,5678]
    });
    expect(seeded.ok()).toBeTruthy();

    const connected=await safePost(request,'/api/master/connect',{
      type:'tcp',host:'127.0.0.1',port:slaveStatus.listenAddress.port,timeoutMs:1000
    });
    expect(connected.ok()).toBeTruthy();
    const connectBody=await connected.json();
    expect(connectBody.connected).toBeTruthy();
    expect(connectBody.writeState).toBe('LOCKED');

    const read=await safePost(request,'/api/master/read',{
      unitId:1,functionCode:3,address:10,quantity:2
    });
    expect(read.ok()).toBeTruthy();
    const readBody=await read.json();
    expect(readBody.rows.map(row=>row.value)).toEqual([1234,5678]);

    const masterStatus=await (await request.get('/api/master/status')).json();
    expect(masterStatus.writeState).toBe('LOCKED');

    const slaveMemory=await (await request.get('/api/slave/memory?unitId=1&area=holdingRegisters&address=10&quantity=2')).json();
    expect(slaveMemory.values).toEqual([1234,5678]);
  });

  test('unsafe bulk write is rejected before transmission and produces audit evidence',async({request})=>{
    const started=await safePost(request,'/api/slave/start',{type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
    const slaveStatus=await started.json();
    await safePost(request,'/api/master/connect',{type:'tcp',host:'127.0.0.1',port:slaveStatus.listenAddress.port,timeoutMs:1000});

    const rejected=await safePost(request,'/api/master/write',{
      unitId:1,functionCode:16,address:0,values:[11,22],
      confirmation:{confirmed:true},
      readBack:true
    });
    expect(rejected.status()).toBe(400);
    const body=await rejected.json();
    expect(body.code).toBe('BULK_CONFIRMATION_REQUIRED');

    const auditResponse=await request.get('/api/master/write-audit?limit=20');
    expect(auditResponse.ok()).toBeTruthy();
    const audit=await auditResponse.json();
    expect(audit.some(row=>row.functionCode===16&&row.result==='failed'&&row.preflightRejected===true&&row.transmitted===false)).toBeTruthy();

    const masterStatus=await (await request.get('/api/master/status')).json();
    expect(masterStatus.writeState).toBe('LOCKED');
  });
});
