import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { chromeBinary, OUTPUT } from './support/paths';

/** `3` is a count, `25%` a share of the CPUs (Playwright wants the count as a number); unset means 4. */
function workers(value: string | undefined): number | string {
  if (!value) return 4;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export default defineConfig({
  testDir: 'specs',
  outputDir: join(OUTPUT, 'results'),
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: true,
  // A flaky test is fixed, never retried.
  retries: 0,
  // Four workers at most by default: all cores at once overloads the host (the API, the web server and Chromium per worker). `GLAZELAB_E2E_WORKERS` is a number or a percentage.
  workers: workers(process.env.GLAZELAB_E2E_WORKERS),
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: [['list'], ['html', { outputFolder: join(OUTPUT, 'report'), open: 'never' }]],
  use: {
    browserName: 'chromium',
    // A fake capture device always: the suite never reaches a real camera, even where a test grants the permission.
    launchOptions: { executablePath: chromeBinary(), args: ['--use-fake-device-for-media-stream'] },
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
    // Tests that need the service worker (updates, offline) allow it themselves; blocked, it cannot hide requests from `page.route`.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    // The system Firefox over WebDriver BiDi (`moz-firefox`), only on request (`GLAZELAB_E2E_FIREFOX=1 … --project=firefox <spec>`):
    // Playwright's own Firefox is not installed, and BiDi lacks parts of the suite (camera flags, touch emulation). Desktop width, fine pointer.
    ...(process.env.GLAZELAB_E2E_FIREFOX
      ? [
          {
            name: 'firefox',
            use: {
              browserName: 'firefox' as const,
              channel: 'moz-firefox',
              launchOptions: {
                executablePath: process.env.FIREFOX ?? '/usr/bin/firefox',
                // Headless Firefox reports `pointer: none`; 6 is a fine pointer with hover, as on a desktop.
                firefoxUserPrefs: { 'ui.primaryPointerCapabilities': 6, 'ui.allPointerCapabilities': 6 },
              },
              viewport: { width: 1280, height: 800 },
            },
          },
        ]
      : []),
  ],
});
