import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expectAccessible } from '../support/axe';
import { t } from '../support/i18n';
import { OUTPUT } from '../support/paths';
import { buildQrHarness } from '../support/qr-harness/build';
import { decodePng, pngLook } from '../support/qr-image';
import { expect, test } from '../support/test';
import { startWebServer, type WebServer } from '../support/web-server';

/**
 * The QR code component on its own harness page (`support/qr-harness`), built like the app and served with the production CSP: the
 * code shown at once, the Save button, the size on a phone, axe, the picture a camera sees (decoded again with ZXing) and that nothing leaves the page.
 */
const SHOTS = process.env.GLAZELAB_E2E_SHOTS ?? join(OUTPUT, 'shots');
const TOKEN = 'Zk3-_Q0aB9xT7mWvY1rLcE5uHnJdPoS2gIiKfA6hMqU';
const LINK = `https://glazelab.eu/#/buddy/${TOKEN}`;

const harness = test.extend<{ server: WebServer }>({
  server: async ({}, use, testInfo) => {
    // One build per worker and project; the page needs no API.
    const dist = join(OUTPUT, 'qr-harness', `${testInfo.workerIndex}`);
    await buildQrHarness(dist);
    const server = await startWebServer({ dist, apiUrl: 'http://127.0.0.1:9' });
    await use(server);
    await server.close();
  },
});

harness('shows the code at once, large enough to scan and readable by a camera', async ({ page, server }, testInfo) => {
  harness.setTimeout(60_000); // the first ZXing decode compiles its wasm
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(`${server.url}/#link=${encodeURIComponent(LINK)}`);
  const code = page.getByRole('img', { name: 'QR code for this link' });
  await expect(code).toBeVisible();

  const box = (await code.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(240);
  expect(box.height).toBeCloseTo(box.width, 0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  // Dark modules in the ink colour on the paper surface, whatever the colour scheme asks.
  await page.emulateMedia({ colorScheme: 'dark' });
  const colours = await code.evaluate((svg) => ({
    modules: getComputedStyle(svg.querySelector('.qr-code__modules')!).fill,
    surface: getComputedStyle(svg.querySelector('.qr-code__surface')!).fill,
  }));
  expect(colours).toEqual({ modules: 'rgb(48, 70, 62)', surface: 'rgb(255, 255, 255)' });
  await expectAccessible(page);

  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${testInfo.project.name}-page.png`) });
  const png = await code.screenshot({ path: join(SHOTS, `${testInfo.project.name}-code.png`) });
  expect(await decodePng(page, png), 'ZXing reads the screenshot of the code').toEqual([LINK]);

  // Nothing but the harness's own files was requested, and the link went nowhere.
  const origin = new URL(server.url).origin;
  expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
  expect(requests.filter((url) => decodeURIComponent(url).includes(TOKEN))).toEqual([]);
});

harness(
  'saves a 1024 px PNG under the production CSP that ZXing reads back as the exact link, without a request or the token in the name',
  async ({ page, server }, testInfo) => {
    harness.setTimeout(60_000);
    const consoleErrors: string[] = [];
    page.on(
      'console',
      (message) =>
        message.type() === 'error' && !message.location().url.endsWith('/favicon.ico') && consoleErrors.push(`${message.text()} ${message.location().url}`),
    );
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.goto(`${server.url}/#link=${encodeURIComponent(LINK)}`);
    await expect(page.getByRole('img', { name: 'QR code for this link' })).toBeVisible();
    await expect(page.getByText('Anyone who has this picture can use the link; replacing the link ends it.')).toBeVisible();
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save QR code' }).click()]);
    expect(download.suggestedFilename()).toBe('glazelab-buddy-link.png');
    expect(download.suggestedFilename()).not.toContain(TOKEN);
    const path = join(OUTPUT, 'qr-harness', `saved-${testInfo.project.name}-${testInfo.workerIndex}.png`);
    await download.saveAs(path);
    const png = await readFile(path);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const side = png.readUInt32BE(16);
    expect(png.readUInt32BE(20)).toBe(side);
    expect(Math.abs(side - 1024)).toBeLessThan(40);
    await expect(page.getByRole('status').filter({ hasText: 'QR code saved as a picture.' })).toBeVisible();
    expect(await decodePng(page, png), 'ZXing reads the saved file').toEqual([LINK]);
    // Black modules on white and a quiet zone of at least 4 modules on every side, whatever the theme of the page.
    const look = await pngLook(page, png);
    expect(look.darkest).toBe(0);
    expect(look.margin).toBeGreaterThanOrEqual(Math.floor((side / 65) * 4));
    // The picture came from the page itself: only blob: URLs, no request to anywhere, no CSP violation in the console.
    expect(requests.filter((url) => !url.startsWith('blob:') && !url.startsWith(new URL(server.url).origin))).toEqual([]);
    expect(requests.filter((url) => decodeURIComponent(url).includes(TOKEN))).toEqual([]);
    expect(consoleErrors).toEqual([]);
  },
);

harness('shares the file through the share sheet on a touch device that can share files', async ({ page, server }, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: async (data: { files: File[] }) => {
        (window as unknown as { shared: unknown[] }).shared.push({ name: data.files[0].name, type: data.files[0].type, size: data.files[0].size });
      },
      configurable: true,
    });
  });
  await page.goto(`${server.url}/#link=${encodeURIComponent(LINK)}`);
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(coarse).toBe(testInfo.project.name === 'phone');
  await page.getByRole('button', { name: 'Save QR code' }).click();
  if (coarse) {
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared.length)).toBe(1);
    const [file] = await page.evaluate(() => (window as unknown as { shared: Array<{ name: string; type: string; size: number }> }).shared);
    expect(file).toMatchObject({ name: 'glazelab-buddy-link.png', type: 'image/png' });
  } else {
    // A mouse and keyboard device downloads even when it could share.
    await expect(page.getByText('QR code saved as a picture.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared.length)).toBe(0);
  }
});

harness('names the code in German and Portuguese', async ({ page, server }) => {
  await page.goto(`${server.url}/#lang=de&link=${encodeURIComponent(LINK)}`);
  await expect(page.getByRole('img', { name: 'QR-Code für diesen Link' })).toBeVisible();
  await expectAccessible(page);
  await page.goto(`${server.url}/#lang=pt-PT&link=${encodeURIComponent(LINK)}`);
  await page.reload(); // only the hash changed: the harness reads it at start
  await expect(page.getByRole('img', { name: 'Código QR para esta ligação' })).toBeVisible();
  await expectAccessible(page);
});

harness('says so instead of drawing a code for a link that is too long', async ({ page, server }) => {
  await page.goto(`${server.url}/#link=${encodeURIComponent(`https://glazelab.eu/#/${'x'.repeat(300)}`)}`);
  await expect(page.getByText('too long for a QR code')).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
});

// The code's chunk is precached, but a page of an older build may still ask for a file the server no longer has (an update).
const CODE_CHUNK = /\/assets\/QrCode-[\w-]+\.js$/;

harness('says so and offers a reload when the code cannot be loaded, and draws it after the reload', async ({ page, server }, testInfo) => {
  await page.route(CODE_CHUNK, (route) => route.abort());
  await page.goto(`${server.url}/#link=${encodeURIComponent(LINK)}`);
  const problem = page.getByRole('alert').filter({ hasText: t('qr.loadFailed') });
  await expect(problem).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('qr.save') })).toHaveCount(0);
  // The link stays beside it as text, so the person can still pass it on.
  await expect(page.getByTestId('link')).toHaveText(LINK);
  await expectAccessible(page);
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${testInfo.project.name}-load-failed.png`) });

  await page.unroute(CODE_CHUNK);
  await page.getByRole('button', { name: t('route.reload') }).click();
  await expect(page.getByRole('img', { name: t('qr.label') })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
