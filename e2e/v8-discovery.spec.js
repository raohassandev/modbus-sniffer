'use strict';

const { test, expect } = require('@playwright/test');

const V8 = 'http://127.0.0.1:18778';

test.describe('v8 Discovery workspace', () => {
  test.beforeEach(async ({ page, request }) => {
    const connections = await request.get(`${V8}/api/v8/connections`);
    const payload = await connections.json();
    for (const item of payload.connections || []) {
      const id = encodeURIComponent(item.profile.connectionId);
      if (item.runtime?.owner) await request.post(`${V8}/api/v8/connections/${id}/close`, { data: {} });
      await request.delete(`${V8}/api/v8/connections/${id}`);
    }
    await request.post(`${V8}/api/v8/connections`, {
      data: { connectionId: 'discovery-e2e', name: 'Discovery E2E', transportKind: 'virtual', endpoint: 'loopback' },
    });
    await page.goto(`${V8}/v8/`);
  });

  test('renders a read-only Discovery workspace and enforces the serial safety interlock', async ({ page, request }) => {
    await page.getByRole('button', { name: 'Discovery' }).click();
    await expect(page.getByRole('heading', { name: 'Discovery' })).toBeVisible();
    await expect(page.getByText('READ ONLY', { exact: true }).first()).toBeVisible();
    await expect(page.locator('#discoveryUnitConnection')).toContainText('Discovery E2E');
    await expect(page.locator('#discoveryUnitMaintenance')).toBeEnabled();
    await expect(page.locator('#discoveryUnitExclusive')).toBeEnabled();

    const response = await request.post(`${V8}/api/v8/discovery/unit-scan`, {
      data: { connectionId: 'discovery-e2e', startUnit: 1, endUnit: 1, timeoutMs: 25 },
    });
    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe('RTU_DISCOVERY_CONFIRMATION_REQUIRED');
  });

  test('Discovery is available from command palette and opens its own document tab', async ({ page }) => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = page.locator('.command-palette');
    await palette.locator('#paletteSearch').fill('discovery');
    await palette.getByRole('button', { name: 'Open Discovery' }).click();
    await expect(page.getByRole('heading', { name: 'Discovery' })).toBeVisible();
    await expect(page.locator('.document-tab', { hasText: 'Discovery' })).toBeVisible();
  });
});
