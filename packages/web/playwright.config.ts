import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'task_home=$(mktemp -d) && cd ../.. && env ANVIL_HOME="$task_home" PORT=3090 CLAUDE_USE_GLOBAL_AUTH=true bun run dev:server',
      url: 'http://127.0.0.1:3090/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'env PORT=3090 WEB_PORT=5173 bun run dev --host 127.0.0.1',
      url: 'http://127.0.0.1:5173/console/projects',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
