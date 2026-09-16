'use strict';

const { test, expect } = require('@playwright/test');

const V8 = 'http://127.0.0.1:18778';

async function resetConnections(request) {
  const response = await request.get(`${V8}/api/v8/connections`);
  if (!response.ok()) return;
  const payload = await response.json();
  for (const item of payload.connections || []) {
    const id = encodeURIComponent(item.profile.connectionId);
    if (item.runtime?.owner) {
      await request.post(`${V8}/api/v8/test-center/session/${id}/disconnect`, { data: {} }).catch(() => undefined);
      await request.post(`${V8}/api/v8/connections/${id}/close`, { data: {} }).catch(() => undefined);
    }
    await request.delete(`${V8}/api/v8/connections/${id}`).catch(() => undefined);
  }
}

test.describe('v8 Test Center workspace', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetConnections(request);
    await request.post(`${V8}/api/v8/connections`, {
      data: { connectionId: 'test-e2e', name: 'Test Center E2E', transportKind: 'virtual', endpoint: 'loopback' },
    });
    await page.goto(`${V8}/v8/`);
    await expect(page.locator('#workspace-testCenter')).toBeAttached();
  });

  test('opens with LAB and writes locked, then requires explicit confirmations to arm them', async ({ page }) => {
    await page.getByRole('button', { name: 'Test Center' }).click();
    const workspace = page.locator('#workspace-testCenter');
    await expect(workspace).toHaveClass(/active/);
    await expect(workspace.locator('#tcConnection')).toContainText('Test Center E2E');
    await expect(workspace.locator('#tcLabChip')).toHaveText('LAB OFF');
    await expect(workspace.locator('#tcWriteChip')).toHaveText('LOCKED');

    await workspace.locator('#tcOpen').click();
    await expect(workspace.locator('#tcSessionChip')).toHaveText('TEST OPEN');
    await expect(workspace.locator('#tcLabChip')).toHaveText('LAB OFF');
    await expect(workspace.locator('#tcWriteChip')).toHaveText('LOCKED');

    await workspace.locator('#tcArmLab').click();
    await expect(page.locator('#toastHost')).toContainText('Confirm LAB/raw transmission first');
    await expect(workspace.locator('#tcLabChip')).toHaveText('LAB OFF');
    await workspace.locator('#tcLabConfirm').check();
    await workspace.locator('#tcArmLab').click();
    await expect(workspace.locator('#tcLabChip')).toHaveText('LAB ARMED');

    await workspace.locator('#tcArmWrites').click();
    await expect(page.locator('#toastHost')).toContainText('Confirm write enable first');
    await expect(workspace.locator('#tcWriteChip')).toHaveText('LOCKED');
    await workspace.locator('#tcWriteConfirm').check();
    await workspace.locator('#tcArmWrites').click();
    await expect(workspace.locator('#tcWriteChip')).toHaveText('WRITES ENABLED');
    await workspace.locator('#tcLockWrites').click();
    await expect(workspace.locator('#tcWriteChip')).toHaveText('LOCKED');
  });

  test('runs a deterministic read-only recipe and renders evidence without enabling writes', async ({ page }) => {
    await page.getByRole('button', { name: 'Test Center' }).click();
    const workspace = page.locator('#workspace-testCenter');
    await workspace.locator('#tcRecipe').fill(JSON.stringify({
      schemaVersion: 1,
      id: 'browser-delay-smoke',
      name: 'Browser delay smoke',
      steps: [{ id: 'wait', type: 'delay', ms: 1 }],
    }, null, 2));
    await workspace.locator('#tcRunRecipe').click();
    await expect(workspace.locator('#tcRecipeResult')).toContainText('"passed": true');
    await expect(workspace.locator('#tcWriteChip')).toHaveText('LOCKED');
  });
});
