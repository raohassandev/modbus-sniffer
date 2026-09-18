'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  // Browser integration suites mutate the unified runtime plus the internal compatibility
  // service used to regression-test shared v8 primitives. The compatibility server is not
  // a user-facing launch path. Keep one worker so runtime state cannot race across files.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:18777',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport:{width:1280,height:800}, deviceScaleFactor:2 } }
  ],
  webServer: [
    {
      command: 'node src/index-v7.js --demo --quiet --web-port 18777 --web-host 127.0.0.1 --data-dir .tmp/e2e',
      url: 'http://127.0.0.1:18777/api/status',
      timeout: 20000,
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'node src/index-v8.js --port 18778 --host 127.0.0.1 --data-dir .tmp/e2e-v8',
      url: 'http://127.0.0.1:18778/api/v8/status',
      timeout: 20000,
      reuseExistingServer: !process.env.CI
    }
  ]
});
