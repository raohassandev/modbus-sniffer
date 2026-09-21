'use strict';

const { defineConfig, devices } = require('@playwright/test');

const configuredPort=Number(process.env.MODBUS_E2E_PORT);
const e2ePort=Number.isInteger(configuredPort)&&configuredPort>=1024&&configuredPort<=65535
  ? configuredPort
  : 20000 + (process.pid % 20000);
const baseURL=`http://127.0.0.1:${e2ePort}`;

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: ['unified-engineering.spec.js','v62-gate-a.spec.js'],
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport:{width:1280,height:800}, deviceScaleFactor:2 } }
  ],
  webServer: {
    command: `node src/index-v7.js --demo --quiet --web-port ${e2ePort} --web-host 127.0.0.1 --data-dir .tmp/e2e-unified-${process.pid}`,
    url: `${baseURL}/api/status`,
    timeout: 60000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
