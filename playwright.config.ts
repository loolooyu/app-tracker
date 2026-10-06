import { defineConfig } from '@playwright/test';

// Uses the locally installed Google Chrome (channel: 'chrome'). Playwright's bundled
// Chromium isn't available for every OS version (for example macOS 12).
// Run `npm run build` first: the tests exercise the production bundles.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { channel: 'chrome', headless: true, trace: 'retain-on-failure' },
});
