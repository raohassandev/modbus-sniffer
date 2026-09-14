'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toContainText('Dashboard');
  await expect(page.locator('.theme-control')).toBeVisible();
});

test('UI identifies v6.2 and uses transport-correct RTU labels in demo mode', async ({ page }) => {
  await expect(page.locator('body')).toContainText('UI v6.2');
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

test('Passive Discovery forms RTU topology without exposing a transmit control', async ({ page }) => {
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
  await expect(page.locator('#page-discovery button')).not.toContainText('Active scan');
});
