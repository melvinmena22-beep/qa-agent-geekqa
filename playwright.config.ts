import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './3-outputs/run',
  testMatch: '**/tests/*.spec.ts',
  respectGitIgnore: false,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 9_000,
  globalTimeout: 105_000,
  expect: { timeout: 2_500 },
  reporter: 'line',
  outputDir: './test-results/generated-playwright',
  use: {
    browserName: 'chromium',
    actionTimeout: 2_500,
    navigationTimeout: 7_000,
    trace: 'off',
    video: 'off'
  }
});
