'use strict';

const { test, expect } = require('@playwright/test');
const { version: PRODUCT_VERSION } = require('../package.json');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toContainText('Dashboard');
  await expect(page.locator('.theme-control')).toBeVisible();
});

test('UI identifies the current product version and uses transport-correct RTU labels in demo mode', async ({ page }) => {
  await expect(page.locator('body')).toContainText(`UI v${PRODUCT_VERSION}`);
  await expect(page.locator('.transport-badge')).toContainText('RTU');
  await page.locator('[data-page="devices"]').click();
  const first=page.locator('#deviceList .device-list-item').first();
  await expect(first).toBeVisible();
  await expect(first.locator('strong')).toContainText('Slave ');
  await expect(first).toContainText('RTU');
});

test('Light Dark and System appearance modes apply semantic theme state', async ({ page }) => {
  await page.locator('[data-theme-mode="light"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode','light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const lightBg=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);

  await page.locator('[data-theme-mode="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode','dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const darkBg=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(darkBg).not.toBe(lightBg);

  await page.emulateMedia({colorScheme:'light'});
  await page.locator('[data-theme-mode="system"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode','system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});

test('traffic chart has a hard stable layout height across live redraw cycles', async ({ page }) => {
  const chart=page.locator('#trafficChart');
  const frame=page.locator('.traffic-chart-frame');
  await expect(chart).toBeVisible();
  await expect(frame).toBeVisible();

  const measure=()=>chart.evaluate(c=>({
    chartH:c.getBoundingClientRect().height,
    chartW:c.getBoundingClientRect().width,
    frameH:c.closest('.traffic-chart-frame').getBoundingClientRect().height,
    pixelW:c.width,
    pixelH:c.height,
    dpr:devicePixelRatio
  }));

  const before=await measure();
  expect(before.frameH).toBeGreaterThanOrEqual(200);
  expect(before.frameH).toBeLessThanOrEqual(260);
  expect(Math.abs(before.chartH-before.frameH)).toBeLessThanOrEqual(1);
  expect(before.pixelH).toBeLessThanOrEqual(Math.ceil(before.frameH*2)+2);
  expect(before.pixelW).toBeLessThanOrEqual(Math.ceil(before.chartW*2)+2);
  expect(before.dpr).toBeGreaterThanOrEqual(2);

  await page.waitForTimeout(4200);
  const afterLive=await measure();
  expect(Math.abs(afterLive.frameH-before.frameH)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterLive.chartH-before.chartH)).toBeLessThanOrEqual(1);

  await page.setViewportSize({width:1700,height:900});
  await page.waitForTimeout(500);
  const afterResize=await measure();
  expect(afterResize.chartW).toBeGreaterThan(before.chartW);
  expect(afterResize.frameH).toBeLessThanOrEqual(260);
  expect(Math.abs(afterResize.chartH-afterResize.frameH)).toBeLessThanOrEqual(1);
  expect(afterResize.pixelH).toBeLessThanOrEqual(Math.ceil(afterResize.frameH*2)+2);
  expect(afterResize.pixelW).toBeLessThanOrEqual(Math.ceil(afterResize.chartW*2)+2);
});

test('channel filters and engineering workspace preserve explicit channel identity', async ({ page }) => {
  await page.locator('[data-page="traffic"]').click();
  await expect(page.locator('#trafficChannel')).toBeVisible();
  await expect(page.locator('#trafficChannel option')).toHaveCount(2);

  await page.locator('[data-page="engineering"]').click();
  await expect(page.locator('#mapDevice')).toBeVisible();
  const firstOption=page.locator('#mapDevice option').nth(1);
  await expect(firstOption).toContainText('RTU');
  await expect(firstOption).toContainText('Slave');
});

test('Modbus TCP listen host is a PC adapter selector, not a free-text device IP field', async ({ page }) => {
  await page.locator('[data-page="tcp"]').click();
  const listen=page.locator('#tcpListenHost');
  await expect(listen).toBeVisible();
  expect(await listen.evaluate(el=>el.tagName)).toBe('SELECT');
  await expect(listen.locator('option[value="127.0.0.1"]')).toHaveCount(1);
  await expect(listen.locator('option[value="0.0.0.0"]')).toHaveCount(1);
  await expect(page.locator('#tcpRefreshInterfaces')).toBeVisible();
  await expect(page.locator('#tcpInterfaceHint')).toBeVisible();

  const status=await page.request.get('/api/tcp/status');
  expect(status.ok()).toBeTruthy();
  const json=await status.json();
  expect(Array.isArray(json.localInterfaces)).toBeTruthy();
  expect(json.localInterfaces.some(x=>x.address==='127.0.0.1')).toBeTruthy();
});

test('Discovery keeps passive RX-only topology separate from guarded active FC43 scanning', async ({ page }) => {
  await expect(page.locator('[data-page="discovery"]')).toBeVisible();
  await page.locator('[data-page="discovery"]').click();
  await expect(page.locator('#page-discovery')).toBeVisible();
  await expect(page.locator('#page-discovery')).toContainText('Passive Discovery');
  await expect(page.locator('#page-discovery')).toContainText('RX ONLY');
  await expect(page.locator('#discoveryChannels .discovery-channel').first()).toBeVisible();
  await expect(page.locator('#discoveryChannels')).toContainText('RTU');
  await expect(page.locator('#discoveryChannels .discovery-device').first()).toContainText('Slave');
  await expect(page.locator('#discoveryRefresh')).toBeVisible();
  await expect(page.locator('#discoveryExport')).toBeVisible();

  const active=page.locator('#activeDiscoveryPanel');
  await expect(active).toBeVisible();
  await expect(active).toContainText('Active Device ID Scan');
  await expect(active).toContainText('READ-ONLY TX');
  await expect(page.locator('#activeDiscoveryStart')).toBeVisible();
  await expect(page.locator('#activeDiscoveryCancel')).toBeDisabled();
  await expect(page.locator('#activeDiscoveryEvidence')).toBeVisible();
  await expect(page.locator('#activeDiscoveryEvidence')).toContainText('No saved discovery evidence');
  await expect(page.locator('#activeDiscoveryRefreshEvidence')).toBeVisible();

  const evidence=await page.request.get('/api/discovery/runs');
  expect(evidence.ok()).toBeTruthy();
  expect(Array.isArray(await evidence.json())).toBeTruthy();

  await page.locator('#activeDiscoveryTransport').selectOption('RTU');
  await expect(page.locator('#activeRtuSafety')).toBeVisible();
  await expect(page.locator('#activeDiscoveryMaintenance')).not.toBeChecked();
  await expect(page.locator('#activeDiscoveryExclusive')).not.toBeChecked();
});

test('active discovery API is idle by default and cannot transmit from demo mode', async ({ page }) => {
  const status=await page.request.get('/api/discovery/active/status');
  expect(status.ok()).toBeTruthy();
  const idle=await status.json();
  expect(idle.state).toBe('idle');
  expect(idle.running).toBeFalsy();

  const attempt=await page.request.post('/api/discovery/active/start',{data:{transport:'TCP',host:'127.0.0.1',port:502,unitStart:1,unitEnd:1}});
  expect(attempt.status()).toBe(409);
  const body=await attempt.json();
  expect(body.code).toBe('DISCOVERY_DEMO_DISABLED');
});

test('Adopt Identification requires explicit saved identity and exact channel selection before project mutation', async ({ page }) => {
  const exported=await page.request.get('/api/workspace/export.json');
  expect(exported.ok()).toBeTruthy();
  const original=await exported.json();
  const fixture=JSON.parse(JSON.stringify(original)),project=fixture.projects.find(p=>p.id===fixture.activeProjectId);
  const channelId='tcp:proxy:e2e-adoption',runId='discovery-e2e-adoption',deviceKey=`${channelId}|9`;
  project.channels[channelId]={channelId,transport:'TCP',mode:'offline',name:'E2E TCP Target',endpoint:'10.10.10.50:502',tcp:{host:'10.10.10.50',port:502},active:false};
  project.discoveryRuns=[...(project.discoveryRuns||[]),{id:runId,jobId:'e2e-adoption-job',transport:'TCP',mode:'active-identification',readOnly:true,transmit:true,startedAt:100,completedAt:200,savedAt:new Date().toISOString(),target:{host:'10.10.10.50',port:502},unitStart:9,unitEnd:9,summary:{checked:1,responding:1,identified:1,unsupported:0,silent:0},results:[{unitId:9,responded:true,identificationSupported:true,objects:[{objectId:0,name:'VendorName',value:'E2E Vendor'},{objectId:1,name:'ProductCode',value:'E2E-P9'},{objectId:2,name:'MajorMinorRevision',value:'R9'}],identification:{vendorName:'E2E Vendor',productCode:'E2E-P9',productName:'E2E Product',modelName:'E2E Model',revision:'R9'}}]}];

  try{
    const imported=await page.request.post('/api/workspace/import',{data:fixture});expect(imported.ok()).toBeTruthy();
    await page.reload();await page.locator('[data-page="discovery"]').click();await page.locator('#activeDiscoveryRefreshEvidence').click();
    const adopt=page.locator(`[data-adopt-discovery="${runId}"]`);await expect(adopt).toBeVisible();await adopt.click();
    await expect(page.locator('#activeDiscoveryAdoption')).toBeVisible();await expect(page.locator('#activeAdoptionApply')).toBeDisabled();
    await expect(page.locator('#activeAdoptionUnit')).toHaveValue('');await expect(page.locator('#activeAdoptionChannel')).toHaveValue('');
    await page.locator('#activeAdoptionUnit').selectOption('9');await page.locator('#activeAdoptionChannel').selectOption(channelId);
    await expect(page.locator('#activeAdoptionTarget')).toContainText(deviceKey);await expect(page.locator('#activeAdoptionComparison')).toContainText('E2E Vendor');await expect(page.locator('#activeAdoptionComparison')).toContainText('R9');await expect(page.locator('#activeAdoptionApply')).toBeEnabled();
    await page.locator('#activeAdoptionApply').click();await expect(page.locator('#activeAdoptionComparison')).toContainText('Identification adopted');
    const current=await (await page.request.get('/api/project')).json(),device=current.devices[deviceKey];expect(device).toBeTruthy();expect(device.manufacturer).toBe('E2E Vendor');expect(device.productCode).toBe('E2E-P9');expect(device.model).toBe('E2E Model');expect(device.revision).toBe('R9');expect(device.identification.sourceRunId).toBe(runId);
  }finally{
    await page.request.post('/api/workspace/import',{data:original});
  }
});

test('Intelligence workspace renders v7 reverse-engineering results', async ({ page }) => {
  await expect(page.locator('[data-page="intelligence"]')).toBeVisible();
  await page.locator('[data-page="intelligence"]').click();
  await expect(page.locator('#page-intelligence')).toBeVisible();
  await expect(page.locator('#page-intelligence')).toContainText('Intelligent Modbus Reverse Engineering');
  await expect(page.locator('#v7Kpis .v7-kpi')).toHaveCount(5);
  await expect(page.locator('#v7RegisterBody tr').first()).toBeVisible();
  await expect(page.locator('#v7Cycles')).not.toBeEmpty();
  await expect(page.locator('#v7Anomalies')).not.toBeEmpty();
  const analysis=await page.request.get('/api/analysis');
  expect(analysis.ok()).toBeTruthy();
  const json=await analysis.json();
  expect(json.intelligence?.version).toBe('7.0.0');
  expect(json.intelligence?.registerIntelligence).toBeTruthy();
  expect(json.intelligence?.pollingCycles).toBeTruthy();
});
