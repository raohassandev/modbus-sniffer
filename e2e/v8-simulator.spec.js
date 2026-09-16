'use strict';

const { test, expect } = require('@playwright/test');

const V8 = 'http://127.0.0.1:18778';

async function resetSimulator(request) {
  const serversResponse = await request.get(`${V8}/api/v8/simulator/servers`);
  if (serversResponse.ok()) {
    const payload = await serversResponse.json();
    for (const server of payload.servers || []) {
      if (server.runtime?.running) await request.post(`${V8}/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/stop`);
      await request.delete(`${V8}/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}`);
    }
  }
  const connections = await request.get(`${V8}/api/v8/connections`);
  const payload = await connections.json();
  for (const item of payload.connections || []) {
    const id = encodeURIComponent(item.profile.connectionId);
    if (item.runtime?.owner) await request.post(`${V8}/api/v8/connections/${id}/close`, { data: {} });
    await request.delete(`${V8}/api/v8/connections/${id}`);
  }
}

test.describe('v8 Simulator workspace', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetSimulator(request);
    await request.post(`${V8}/api/v8/connections`, {
      data: { connectionId: 'sim-e2e', name: 'Simulator E2E', transportKind: 'virtual', endpoint: 'loopback' },
    });
    await page.goto(`${V8}/v8/`);
  });

  test('creates persistent server/device configuration and opens a functional memory editor', async ({ page }) => {
    await page.getByRole('button', { name: 'Simulator' }).click();
    const workspace = page.locator('#workspace-simulator');
    await expect(workspace).toHaveClass(/active/);
    await expect(workspace.getByRole('heading', { name: 'Slave / Server Simulator' })).toBeVisible();
    await expect(workspace.locator('#simServerConnection')).toContainText('Simulator E2E');

    await workspace.locator('#simServerId').fill('browser-srv');
    await workspace.locator('#simServerName').fill('Browser Simulator');
    await workspace.locator('#simSaveServer').click();
    await expect(workspace.locator('#simServerList')).toContainText('Browser Simulator');

    await workspace.locator('#simDeviceUnit').fill('7');
    await workspace.locator('#simDeviceName').fill('Unit Seven');
    await workspace.locator('#simSaveDevice').click();
    await expect(workspace.locator('#simDeviceList')).toContainText('Unit Seven');

    await workspace.locator('#simMemorySeed').fill('11,22,33');
    await workspace.locator('#simSeedMemory').click();
    await expect(workspace.locator('#simMemoryValues')).toContainText('11');
    await expect(workspace.locator('#simMemoryValues')).toContainText('33');
  });

  test('fault injection remains LAB-only, explicitly confirmed and disabled by default', async ({ page, request }) => {
    await request.post(`${V8}/api/v8/simulator/servers`, { data: { serverId: 'lab-srv', name: 'Lab Server', connectionId: 'sim-e2e', framing: 'rtu', receivePollMs: 5 } });
    await request.post(`${V8}/api/v8/simulator/devices`, { data: { deviceId: 'lab-device', serverId: 'lab-srv', unitId: 1, sizes: { coils: 32, discreteInputs: 32, holdingRegisters: 32, inputRegisters: 32 } } });
    await request.post(`${V8}/api/v8/simulator/servers/lab-srv/start`);

    await page.getByRole('button', { name: 'Simulator' }).click();
    const workspace = page.locator('#workspace-simulator');
    await expect(workspace).toHaveClass(/active/);
    await workspace.locator('#simServerList').getByText('Lab Server').click();
    await expect(workspace.locator('#simFaultState')).toHaveText('LAB OFF');
    await expect(workspace.locator('#simArmFault')).toBeEnabled();

    await workspace.locator('#simFaultDrop').fill('1');
    await workspace.locator('#simArmFault').click();
    await expect(page.locator('#toastHost')).toContainText('Confirm LAB-only fault injection first');
    await expect(workspace.locator('#simFaultState')).toHaveText('LAB OFF');

    await workspace.locator('#simFaultConfirm').check();
    await workspace.locator('#simArmFault').click();
    await expect(workspace.locator('#simFaultState')).toHaveText('LAB ARMED');
    await workspace.locator('#simDisarmFault').click();
    await expect(workspace.locator('#simFaultState')).toHaveText('LAB OFF');
  });
});
