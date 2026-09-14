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

  // Demo traffic redraws every second. Wait through several live updates and verify
  // that neither the canvas nor its containing panel can ratchet taller over time.
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
  await expect(page.locator('#trafficChannel option')).toHaveCount(2); // All + demo RTU channel

  await page.locator('[data-page="engineering"]').click();
  await expect(page.locator('#mapDevice')).toBeVisible();
  const firstOption=page.locator('#mapDevice option').nth(1);
  await expect(firstOption).toContainText('RTU');
  await expect(firstOption).toContainText('Slave');
});
