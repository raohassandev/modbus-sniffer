'use strict';

const { test, expect } = require('@playwright/test');

const V8 = 'http://127.0.0.1:18778';

async function json(response) {
  const payload = await response.json();
  if (!response.ok() || payload?.ok === false) throw new Error(payload?.error?.message || `HTTP ${response.status()}`);
  return payload;
}

async function cleanup(request) {
  const traffic = await request.delete(`${V8}/api/v8/traffic`);
  if (!traffic.ok() && traffic.status() !== 403) await json(traffic);

  const connectionsBefore = await request.get(`${V8}/api/v8/connections`);
  if (connectionsBefore.ok()) {
    const payload = await connectionsBefore.json();
    for (const item of payload.connections || []) {
      if (item.runtime?.owner?.ownerMode !== 'master') continue;
      await request.post(`${V8}/api/v8/master/runtime/${encodeURIComponent(item.profile.connectionId)}/disconnect`, { data: {} });
    }
  }

  const serversResponse = await request.get(`${V8}/api/v8/simulator/servers`);
  if (serversResponse.ok()) {
    const payload = await serversResponse.json();
    for (const server of payload.servers || []) {
      if (server.runtime?.running) await request.post(`${V8}/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}/stop`);
      await request.delete(`${V8}/api/v8/simulator/servers/${encodeURIComponent(server.serverId)}`);
    }
  }

  const connectionsResponse = await request.get(`${V8}/api/v8/connections`);
  if (!connectionsResponse.ok()) return;
  const payload = await connectionsResponse.json();
  for (const item of payload.connections || []) {
    const id = encodeURIComponent(item.profile.connectionId);
    if (item.runtime?.owner) await request.post(`${V8}/api/v8/connections/${id}/close`, { data: {} });
    await request.delete(`${V8}/api/v8/connections/${id}`);
  }
}

async function createTcpSimulatorAndRead(request) {
  await json(await request.post(`${V8}/api/v8/connections`, {
    data: {
      connectionId: 'gate5-server',
      name: 'Gate 5 Server',
      transportKind: 'tcp-server',
      tcp: { host: '127.0.0.1', port: 0 },
    },
  }));
  await json(await request.post(`${V8}/api/v8/simulator/servers`, {
    data: { serverId: 'gate5-sim', name: 'Gate 5 Simulator', connectionId: 'gate5-server', framing: 'tcp', receivePollMs: 5 },
  }));
  await json(await request.post(`${V8}/api/v8/simulator/devices`, {
    data: {
      deviceId: 'gate5-device',
      serverId: 'gate5-sim',
      unitId: 4,
      name: 'Gate 5 Unit',
      sizes: { coils: 32, discreteInputs: 32, holdingRegisters: 64, inputRegisters: 32 },
    },
  }));
  await json(await request.post(`${V8}/api/v8/simulator/devices/gate5-device/memory`, {
    data: { area: 'holdingRegisters', address: 10, values: [16256, 0, 4660, 22136] },
  }));
  await json(await request.post(`${V8}/api/v8/simulator/servers/gate5-sim/start`, { data: {} }));

  const connections = await json(await request.get(`${V8}/api/v8/connections`));
  const server = connections.connections.find((item) => item.profile.connectionId === 'gate5-server');
  const port = server?.diagnostics?.listenAddress?.port;
  expect(port).toBeGreaterThan(0);

  await json(await request.post(`${V8}/api/v8/connections`, {
    data: {
      connectionId: 'gate5-client',
      name: 'Gate 5 Client',
      transportKind: 'tcp-client',
      tcp: { host: '127.0.0.1', port },
    },
  }));

  const read = await json(await request.post(`${V8}/api/v8/master/read`, {
    data: { connectionId: 'gate5-client', unitId: 4, functionCode: 3, address: 10, quantity: 4, timeoutMs: 1000 },
  }));
  expect(read.result.decoded.values).toEqual([16256, 0, 4660, 22136]);
}

test.describe('v8 Unified Traffic and Register Lab', () => {
  test.beforeEach(async ({ request }) => cleanup(request));
  test.afterEach(async ({ request }) => cleanup(request));

  test('Gate 5 follows a Master/Simulator exchange into raw Traffic and engineering interpretation', async ({ page, request }) => {
    await createTcpSimulatorAndRead(request);
    await page.goto(`${V8}/v8/`);

    await page.getByRole('button', { name: 'Traffic' }).click();
    const traffic = page.locator('#workspace-traffic');
    await expect(traffic).toHaveClass(/active/);
    await expect(traffic.getByRole('heading', { name: 'Unified Traffic' })).toBeVisible();
    await traffic.locator('#trafficConnection').fill('gate5-client');
    await traffic.locator('#trafficText').fill('traffic.');
    const filteredRows = traffic.locator('#trafficWindow .traffic-row');
    await expect.poll(async () => filteredRows.count()).toBeGreaterThanOrEqual(2);
    await expect(filteredRows.first()).toContainText('gate5-client');
    await expect(filteredRows.first()).toContainText('traffic.');
    await filteredRows.first().click();
    await expect(traffic.locator('#trafficSelectedLabel')).toContainText('traffic.');
    await expect(traffic.locator('#trafficInspectorBody')).toContainText('gate5-client');
    await traffic.locator('#trafficWindow .bookmark-button').first().click();
    await expect(traffic.locator('#trafficWindow .bookmark-button.active')).toHaveCount(1);
    await traffic.locator('#trafficFreeze').click();
    await expect(traffic.locator('#trafficFreeze')).toContainText('Resume');
    await traffic.locator('#trafficFreeze').click();

    await page.getByRole('button', { name: 'Register Lab' }).click();
    const lab = page.locator('#workspace-registerLab');
    await expect(lab).toHaveClass(/active/);
    await lab.locator('#registerConnection').fill('gate5-client');
    await expect.poll(async () => Number(await lab.locator('#registerMetricPoints').textContent())).toBe(4);
    await expect(lab.locator('#registerBody .register-row')).toHaveCount(4);
    await lab.locator('#registerBody .register-row').first().click();
    await expect(lab.locator('#interpretationGrid')).toContainText('float32');
    await expect(lab.locator('#interpretationGrid')).toContainText('1');

    await lab.locator('#regDefName').fill('DC Voltage');
    await lab.locator('#regDefType').selectOption('float32');
    await lab.locator('#regDefOrder').fill('ABCD');
    await lab.locator('#regDefUnit').fill('V');
    await lab.locator('#regDefPrecision').fill('2');
    await lab.locator('#regDefNotes').fill('Gate 5 verified');
    await lab.locator('#regDefSave').click();
    await expect(page.locator('#toastHost')).toContainText('Register definition saved');
    await expect(lab.locator('#registerBody')).toContainText('DC Voltage');
    await expect(lab.locator('#registerBody')).toContainText('1.00 V');
  });

  test('Traffic filters and bounded freeze controls stay operational with runtime evidence', async ({ page, request }) => {
    await json(await request.post(`${V8}/api/v8/connections`, {
      data: { connectionId: 'traffic-e2e', name: 'Traffic E2E', transportKind: 'virtual', endpoint: 'loopback' },
    }));
    await page.goto(`${V8}/v8/`);
    await page.getByRole('button', { name: 'Traffic' }).click();
    const traffic = page.locator('#workspace-traffic');
    await traffic.locator('#trafficConnection').fill('traffic-e2e');
    await expect.poll(async () => traffic.locator('#trafficWindow .traffic-row').count()).toBeGreaterThan(0);
    await expect(traffic.locator('#trafficWindow .traffic-row').first()).toContainText('traffic-e2e');
    await traffic.locator('#trafficText').fill('connection');
    await expect.poll(async () => traffic.locator('#trafficWindow .traffic-row').count()).toBeGreaterThan(0);
    await traffic.locator('#trafficBookmarksOnly').check();
    await expect(traffic.locator('#trafficWindow .traffic-row')).toHaveCount(0);
    await traffic.locator('#trafficBookmarksOnly').uncheck();
    await traffic.locator('#trafficFreezeOnError').check();
    await expect(traffic.locator('#trafficFreeze')).toContainText('Freeze view');
  });
});
