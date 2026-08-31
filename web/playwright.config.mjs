import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.e2e\.mjs/,
  outputDir: 'test-results',
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:11111',
    viewport: { width: 1280, height: 720 },
    screenshot: 'on',
  },
  webServer: {
    command: './webdev.sh',
    cwd: '..',
    url: 'http://localhost:11111/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
