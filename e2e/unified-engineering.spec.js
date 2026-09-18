'use strict';

const { test, expect } = require('@playwright/test');

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
