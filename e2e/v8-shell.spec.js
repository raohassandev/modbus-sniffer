'use strict';

const { test, expect } = require('@playwright/test');

const V8 = 'http://127.0.0.1:18778';

test.describe('v8 application shell', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${V8}/v8/`);
    await expect(page.getByRole('heading', { name: 'Connection Center' })).toBeVisible();
    const connections = await request.get(`${V8}/api/v8/connections`);
    const payload = await connections.json();
    for (const item of payload.connections || []) {
      const id = encodeURIComponent(item.profile.connectionId);
      if (item.runtime?.owner) await request.post(`${V8}/api/v8/connections/${id}/close`, { data: {} });
      await request.delete(`${V8}/api/v8/connections/${id}`);
    }
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connection Center' })).toBeVisible();
  });

  test('creates, opens and closes a safe virtual connection profile', async ({ page }) => {
    await page.getByRole('button', { name: 'New Connection' }).click();
    await page.locator('#connectionId').fill('e2e-virtual');
    await page.locator('#connectionName').fill('E2E Virtual');
    await page.locator('#connectionTransport').selectOption('virtual');
    await page.getByRole('button', { name: 'Save profile' }).click();

    const row = page.locator('tr[data-connection-id="e2e-virtual"]');
    await expect(row).toBeVisible();
    await expect(row.getByText('E2E Virtual')).toBeVisible();
    await expect(row.getByText('LOCKED')).toBeVisible();

    await row.getByRole('button', { name: 'Open' }).click();
    await expect(row.getByText('OPEN')).toBeVisible();
    await expect(page.locator('#writeStateChip')).toHaveText('WRITES LOCKED');

    await row.getByRole('button', { name: 'Close' }).click();
    await expect(row.getByText('CLOSED')).toBeVisible();
  });

  test('command palette and document tabs provide quick workspace navigation', async ({ page }) => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = page.locator('.command-palette');
    await expect(palette).toBeVisible();
    await palette.locator('#paletteSearch').fill('settings');
    await palette.getByRole('button', { name: 'Open Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Workspace Settings' })).toBeVisible();
    await expect(page.locator('.document-tab', { hasText: 'Settings' })).toBeVisible();
    await page.locator('.document-tab', { hasText: 'Connections' }).click();
    await expect(page.getByRole('heading', { name: 'Connection Center' })).toBeVisible();
  });

  test('theme and density preferences persist through reload', async ({ page }) => {
    await page.getByRole('button', { name: /Theme:/ }).click();
    await page.getByRole('button', { name: /Density:/ }).click();
    const theme = await page.locator('html').getAttribute('data-theme');
    const density = await page.locator('html').getAttribute('data-density');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('html')).toHaveAttribute('data-density', density);
  });
});
