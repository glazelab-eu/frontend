import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { chromeBinary, FIXTURES, OUTPUT } from '../support/paths';
import { CAMERA_FILE } from './support';

// The shared pacing helpers act at a human pace only in a recording.
process.env.E2E_VIDEO = '1';

mkdirSync(FIXTURES, { recursive: true });
writeFileSync(CAMERA_FILE, barcodeVideo(eanFor('videos-start')));

/**
 * The page videos (`npm run e2e:videos`): one spec per page of the app, recorded on an emulated iPhone X (375x812 at 3x, touch)
 * in Chromium, from a seeded library (`walkthrough/seed.ts`), one browser at a time.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(OUTPUT, 'results'),
  globalSetup: './global-setup.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 3_000_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    ...devices['iPhone X'],
    // Chromium's own mobile browser, not Safari: the iPhone UA string would show the iOS "Install" banner in every take.
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
    browserName: 'chromium',
    defaultBrowserType: 'chromium',
    launchOptions: { executablePath: chromeBinary(), args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${CAMERA_FILE}`] },
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
    permissions: ['camera'],
    video: 'off',
    actionTimeout: Number(process.env.GLAZELAB_VIDEOS_ACTION_TIMEOUT ?? 15_000),
    navigationTimeout: 30_000,
  },
});
