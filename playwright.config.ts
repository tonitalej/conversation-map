import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Prefer an installed Microsoft Edge or Chrome so no browser download is required.
const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].some((p) => existsSync(p));
const channel = process.env['PW_CHANNEL'] ?? (edge ? 'msedge' : 'chrome');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
});
