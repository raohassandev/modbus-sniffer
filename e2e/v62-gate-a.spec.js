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

test('traffic chart is bounded responsive and DPI-capped', async ({ page }) => {
  const chart=page.locator('#trafficChart');
  await expect(chart).toBeVisible();
  const before=await chart.evaluate(c=>({cssW:c.getBoundingClientRect().width,cssH:c.getBoundingClientRect().height,pixelW:c.width,pixelH:c.height,dpr:devicePixelRatio}));
  expect(before.cssH).toBeGreaterThanOrEqual(180);
  expect(before.cssH).toBeLessThanOrEqual(300);
  expect(before.pixelH).toBeLessThanOrEqual(600);
  expect(before.pixelW).toBeLessThanOrEqual(Math.ceil(before.cssW*2)+2);
  expect(before.dpr).toBeGreaterThanOrEqual(2);

  await page.setViewportSize({width:1700,height:900});
  await page.waitForTimeout(250);
  const after=await chart.evaluate(c=>({cssW:c.getBoundingClientRect().width,cssH:c.getBoundingClientRect().height,pixelW:c.width,pixelH:c.height}));
  expect(after.cssW).toBeGreaterThan(before.cssW);
  expect(after.cssH).toBeLessThanOrEqual(300);
  expect(after.pixelH).toBeLessThanOrEqual(600);
  expect(after.pixelW).toBeLessThanOrEqual(Math.ceil(after.cssW*2)+2);
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
