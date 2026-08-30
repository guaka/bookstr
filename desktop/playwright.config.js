const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results',
  reporter: [['list']],
  use: {
    launchOptions: {
      devtools: false,
    },
  },
});
