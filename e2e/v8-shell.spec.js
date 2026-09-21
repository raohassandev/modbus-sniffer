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
    await expect(row).toHaveAttribute('tabindex', '0');
    await expect(row.getByText('E2E Virtual')).toBeVisible();
    await expect(row.getByText('LOCKED')).toBeVisible();

    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('tr[data-connection-id="e2e-virtual"]')).toHaveAttribute('aria-selected', 'true');

    await row.getByRole('button', { name: 'Open' }).click();
    await expect(row.getByText('OPEN')).toBeVisible();
    await expect(page.locator('#writeStateChip')).toHaveText('WRITES LOCKED');

    await row.getByRole('button', { name: 'Close' }).click();
    await expect(row.getByText('CLOSED')).toBeVisible();
  });

  test('command palette and document tabs provide keyboard quick navigation', async ({ page }) => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = page.locator('.command-palette');
    await expect(palette).toBeVisible();
    await palette.locator('#paletteSearch').fill('settings');
    await palette.getByRole('button', { name: 'Open Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Workspace Settings' })).toBeVisible();
    const settingsTab = page.getByRole('tab', { name: /Settings/ });
    const connectionsTab = page.getByRole('tab', { name: /Connections/ });
    await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
    await settingsTab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(connectionsTab).toHaveAttribute('aria-selected', 'true');
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

  for (const viewport of [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '1920x1080', width: 1920, height: 1080 },
  ]) {
    test(`primary shell fits ${viewport.name} without document-level horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Connection Center' })).toBeVisible();
      await expect(page.locator('.app-bar')).toBeVisible();
      await expect(page.locator('.primary-nav')).toBeVisible();
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        devicePixelRatio: window.devicePixelRatio,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      expect(metrics.devicePixelRatio).toBeGreaterThanOrEqual(1);
    });
  }
});
