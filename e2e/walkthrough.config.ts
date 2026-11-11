import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { chromeBinary, OUTPUT } from './support/paths';
import { systemFfmpegAsPlaywrightFfmpeg } from './support/video';

systemFfmpegAsPlaywrightFfmpeg();

/**
 * The screen recording (`npm run e2e:walkthrough`): the core-features test on a phone, paced for a viewer (`E2E_VIDEO=1`), with
 * video on; the default suite runs the same test fast and without video.
 */
process.env.E2E_VIDEO = '1';

export default defineConfig({
  testDir: 'specs',
  testMatch: 'core-features.spec.ts',
  outputDir: join(OUTPUT, 'results'),
  globalSetup: './global-setup.ts',
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    launchOptions: { executablePath: chromeBinary(), args: ['--use-fake-device-for-media-stream'] },
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    video: { mode: 'on', size: { width: 390, height: 844 } },
  },
});
