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

  test('Master Monitor Sessions load from durable workstation storage across browser reloads',async({page,request})=>{
    const payload={
      version:1,
      activeId:'e2e-monitor',
      sessions:[{
        id:'e2e-monitor',
        name:'E2E Durable Monitor',
        connection:{type:'tcp',host:'127.0.0.1',port:502,timeoutMs:1000},
        definition:{unitId:1,functionCode:3,address:42,quantity:2,pollIntervalMs:1000,timeoutMs:1000},
        format:{type:'uint16',scale:1,offset:0,precision:0,byteOrder:'ABCD'},
        snapshot:{rowsHtml:'<img src=x onerror=alert(1)>'}
      }]
    };
    const saved=await request.put('/api/master/monitor-sessions',{data:payload});
    expect(saved.ok()).toBeTruthy();
    const savedBody=await saved.json();
    expect(savedBody.sessions[0].snapshot.rowsHtml).toBe('');

    await page.goto('/');
    await expect(page.locator('#masterSessionActiveName')).toHaveText('E2E Durable Monitor');
    expect(await page.locator('#masterDataBody img').count()).toBe(0);

    await page.reload();
    await expect(page.locator('#masterSessionActiveName')).toHaveText('E2E Durable Monitor');

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
