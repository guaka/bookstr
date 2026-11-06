const { defineConfig } = require('@playwright/test') as typeof import('@playwright/test');

export = defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results',
  reporter: [['list']],
  use: {
    screenshot: 'on',
    launchOptions: {
      devtools: false,
    } as import('@playwright/test').LaunchOptions & { devtools: boolean },
  },
});
