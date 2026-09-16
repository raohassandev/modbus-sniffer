'use strict';

const { test, expect } = require('@playwright/test');

const V8_URL = 'http://127.0.0.1:18778/v8/';

test('v8 preview shell exposes real Connection Center state without write leakage', async ({ page }) => {
  await page.goto(V8_URL);

  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await expect(page.getByText('v8 preview · v7 remains stable')).toBeVisible();
  await expect(page.locator('#writeStateChip')).toContainText('WRITES LOCKED');
  await expect(page.locator('#schemaState')).toContainText('Schema v3');

  await page.getByRole('button', { name: 'New connection' }).click();
  await expect(page.getByRole('heading', { name: 'New connection' })).toBeVisible();
  await page.locator('#profileId').fill('e2e-loop');
  await page.locator('#profileName').fill('E2E Virtual Loop');
  await page.locator('#transportKind').selectOption('virtual-rtu');
  await page.getByRole('button', { name: 'Save profile' }).click();

  const row = page.locator('tr[data-id="e2e-loop"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Virtual RTU');
  await expect(row).toContainText('LOCKED');

  await row.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('#eventState')).toContainText('writes remained locked');

  await page.locator('#ownerModeSelect').selectOption('master');
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('#activeModeChip')).toContainText('MASTER');
  await expect(page.locator('#activeConnectionChip')).toContainText('E2E VIRTUAL LOOP');
  await expect(page.locator('#writeStateChip')).toContainText('WRITES LOCKED');
  await expect(row).toContainText('OPEN');

  await row.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.locator('#inspectorTitle')).toHaveText('E2E Virtual Loop');
  await expect(page.locator('#inspectorContent')).toContainText('LOCKED');
  await expect(page.locator('#inspectorContent')).toContainText('master');

  await row.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#activeModeChip')).toContainText('NO MODE');
  await expect(page.locator('#writeStateChip')).toContainText('WRITES LOCKED');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.locator('#commandDialog')).toBeVisible();
  await expect(page.getByRole('button', { name: /New connection/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('#densitySelect').selectOption('dense');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'dense');
  await page.locator('#themeSelect').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
