import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import de from '../../src/lib/i18n/de.json' with { type: 'json' };
import en from '../../src/lib/i18n/en.json' with { type: 'json' };
import es from '../../src/lib/i18n/es.json' with { type: 'json' };
import it from '../../src/lib/i18n/it.json' with { type: 'json' };
import ptPT from '../../src/lib/i18n/pt-PT.json' with { type: 'json' };
import { BISQUE_STEP, type Api } from '../support/api';
import { t } from '../support/i18n';
import { png } from '../support/images';
import { AppShell } from '../support/pages/app-shell';
import { DIST } from '../support/paths';
import { expect, test } from '../support/test';
import { downloadMegabytes, routeStandIn, STAND_IN_BUILD, STAND_IN_BUILD_REASON, VISION_URL } from '../support/vision';
import { startWebServer, type WebServer } from '../support/web-server';

/**
 * The optional on-device tag suggestions (33-1). The real worker and the real ONNX Runtime WebAssembly build run, with a stand-in
 * model and stand-in labels (`support/vision.ts`: red is a mug, blue a vase, green a bowl); `@vision-real` runs the real model.
 * The model files are requested only as `/assets/vision-<hash>/...`: that is what "nothing before consent" counts.
 */
const KEY = 'glazelab:photo-suggestions';
const RED = png('red.png', [230, 10, 10], 96, 96);
const BLUE = png('blue.png', [10, 20, 230], 96, 96);
const WHITE = png('white.png', [250, 250, 250], 96, 96);

/** What the page asked of the model directory (the files of the model, not the worker script). */
function watchModelRequests(page: Page): string[] {
  const requested: string[] = [];
  page.on('request', (request) => {
    if (/\/assets\/vision-[0-9a-f]{16}\//.test(request.url())) requested.push(new URL(request.url()).pathname.split('/').pop() ?? '');
  });
  return requested;
}

const standIn = routeStandIn;

/** The glaze-free combination page of a signed-in member and its upload dialog for finished pieces. */
async function openFinishedUpload(page: Page, shell: AppShell, api: Api, name: string, title: string) {
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(name);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addFinished') })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await expect(dialog).toBeVisible();
  return { id, dialog };
}

const consent = (page: Page) => page.getByRole('region', { name: t('vision.consent.title') });
const chip = (page: Page, tag: string) => page.getByRole('button', { name: t('vision.suggested.add', { tag }) });
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);
const cacheKeys = (page: Page) =>
  page.evaluate(async () => (await caches.open('vision-model')).keys().then((keys) => keys.map((key) => new URL(key.url).pathname.split('/').pop())));
const hasCache = (page: Page) => page.evaluate(async () => (await caches.keys()).includes('vision-model'));

test('nothing is downloaded before the person says yes, and "Not now" leaves no trace and no suggestion UI @smoke', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  await standIn(page);
  const requested = watchModelRequests(page);
  const { dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, `Ask ${uid}`);

  // Choosing a finished-piece photo asks first, in plain words; nothing has been requested, and nothing stored.
  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await expect(consent(page)).toBeVisible();
  await expect(consent(page).getByText(t('vision.consent.body'))).toBeVisible();
  await expect(consent(page).getByText(t('vision.consent.size', { size: downloadMegabytes() }), { exact: false })).toBeVisible();
  await expect(consent(page).getByText(t('vision.consent.speed'))).toBeVisible();
  await expect(consent(page).getByRole('button', { name: t('vision.consent.on') })).toBeVisible();
  await expect(consent(page).getByRole('button', { name: t('vision.consent.later') })).toBeVisible();
  expect(requested).toEqual([]);
  expect(await stored(page)).toBeNull();
  expect(await hasCache(page)).toBe(false);

  // "Not now": the question and every suggestion UI go; no request, no cache; the photo is still there to upload.
  await consent(page)
    .getByRole('button', { name: t('vision.consent.later') })
    .click();
  await expect(consent(page)).toHaveCount(0);
  await expect(dialog.getByText(t('vision.suggested.title'))).toHaveCount(0);
  await expect(dialog.getByText(t('vision.status.analysing'))).toHaveCount(0);
  await expect(dialog.getByText('red.png')).toBeVisible();
  await dialog.getByLabel(t('upload.library')).setInputFiles(BLUE);
  await expect(dialog.getByText('blue.png')).toBeVisible();
  await expect(consent(page)).toHaveCount(0);
  expect(requested).toEqual([]);
  expect(await hasCache(page)).toBe(false);
  // The only thing remembered is that it was declined, so nothing asks again; after a reload it stays quiet.
  expect(await stored(page)).toBe('off');
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addFinished') })
    .first()
    .click();
  await page.getByRole('dialog').getByLabel(t('upload.library')).setInputFiles(RED);
  await expect(page.getByRole('dialog').getByText('red.png')).toBeVisible();
  await expect(consent(page)).toHaveCount(0);
  expect(requested).toEqual([]);
});

test('turning it on downloads once, suggests a tag for a finished-piece photo and adds it only when tapped', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  encoder,
}) => {
  await standIn(page);
  const requested = watchModelRequests(page);
  const title = `Mugs ${uid}`;
  const { id, dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, title);
  const tags = async () =>
    ((await (await page.request.get('/api/combinations')).json()) as { id: string; tags: string[] }[]).find((item) => item.id === id)?.tags;

  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await consent(page)
    .getByRole('button', { name: t('vision.consent.on') })
    .click();
  // The download, the check and the analysis happen on the device; the suggestion is a chip, never applied by itself.
  await expect(chip(page, 'mug')).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 3, name: t('vision.suggested.title') })).toBeVisible();
  expect(requested.sort()).toEqual(['labels.json', 'model.onnx', 'ort-wasm-simd-threaded.wasm']);
  expect(await stored(page)).toBe('on');
  expect((await cacheKeys(page)).sort()).toEqual(['labels.json', 'model.onnx', 'ort-wasm-simd-threaded.wasm']);
  await expect(chip(page, 'vase')).toHaveCount(0);
  expect(await tags()).toEqual([]);

  // Tapping adds the tag to the item through the tag request; the chip is replaced by the confirmation.
  await chip(page, 'mug').click();
  await expect(dialog.getByRole('status').filter({ hasText: t('vision.suggested.added', { tag: 'mug' }) })).toBeVisible();
  await expect(chip(page, 'mug')).toHaveCount(0);
  expect(await tags()).toEqual(['mug']);

  // A second photo of a blue piece suggests a vase; dismissing hides every suggestion.
  await dialog.getByLabel(t('upload.library')).setInputFiles(BLUE);
  await expect(chip(page, 'vase')).toBeVisible();
  await dialog.getByRole('button', { name: t('vision.suggested.dismiss') }).click();
  await expect(chip(page, 'vase')).toHaveCount(0);
  expect(await tags()).toEqual(['mug']);

  // The photos still upload as usual, and a later dialog finds the model on the device: no new request for it.
  await dialog.getByRole('button', { name: t('upload.submit', { count: 2 }) }).click();
  await expect(dialog).toBeHidden();
  expect(requested).toHaveLength(3);
  await expect(page.getByRole('list', { name: t('tags.label') }).getByText('mug', { exact: true })).toBeVisible();
});

test('the worker stops after a minute without a request and the next photo starts it again from the device (33-5)', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  await standIn(page);
  await page.clock.install();
  const requested = watchModelRequests(page);
  const { dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, `Sleep ${uid}`);
  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await consent(page)
    .getByRole('button', { name: t('vision.consent.on') })
    .click();
  await expect(chip(page, 'mug')).toBeVisible();
  expect(page.workers()).toHaveLength(1);

  // Idle for longer than the delay: the worker is terminated, the model files stay on the device.
  await page.clock.fastForward(75_000);
  await expect.poll(() => page.workers().length).toBe(0);
  expect((await cacheKeys(page)).sort()).toEqual(['labels.json', 'model.onnx', 'ort-wasm-simd-threaded.wasm']);

  // The next photo works: a new worker reads the files from Cache Storage, no new request for them.
  await dialog.getByLabel(t('upload.library')).setInputFiles(BLUE);
  await expect(chip(page, 'vase')).toBeVisible();
  expect(page.workers()).toHaveLength(1);
  expect(requested.sort()).toEqual(['labels.json', 'model.onnx', 'ort-wasm-simd-threaded.wasm']);
});

test('a photo with nothing known in it, and photos of other kinds, get no suggestion', async ({ page, shell, api, signedIn, uid }) => {
  await standIn(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'on'), KEY);
  const { dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, `Kinds ${uid}`);

  // White is closest to a label that is never suggested: analysed, and no chip, no empty box.
  await dialog.getByLabel(t('upload.library')).setInputFiles(WHITE);
  await expect(dialog.getByText(t('vision.status.analysing'))).toHaveCount(0, { timeout: 20_000 });
  await expect(dialog.getByRole('heading', { level: 3, name: t('vision.suggested.title') })).toHaveCount(0);
  await expect(chip(page, 'mug')).toHaveCount(0);

  // A red photo of another kind (a test tile) is never analysed; set back to a finished piece it is.
  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await expect(chip(page, 'mug')).toBeVisible();
  await dialog
    .getByLabel(t('upload.kind'))
    .last()
    .selectOption({ label: t('images.kind.tile') });
  await expect(chip(page, 'mug')).toHaveCount(0);
  await dialog
    .getByLabel(t('upload.kind'))
    .last()
    .selectOption({ label: t('images.kind.finished') });
  await expect(chip(page, 'mug')).toBeVisible();
});

test('the test tile photo of a combination is never analysed or asked about', async ({ page, shell, api, signedIn, uid }) => {
  await standIn(page);
  const requested = watchModelRequests(page);
  const title = `Tile ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await expect(dialog.getByText('red.png')).toBeVisible();
  await expect(consent(page)).toHaveCount(0);
  expect(requested).toEqual([]);
});

test('the account page setting turns it on, shows it and turns it off by removing the model and the stored choice', async ({ page, shell, signedIn }) => {
  await standIn(page);
  const requested = watchModelRequests(page);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = page.getByRole('main').locator('section', { has: page.getByRole('heading', { level: 2, name: t('vision.setting.title'), exact: true }) });
  await expect(section.getByText(t('vision.setting.off'))).toBeVisible();
  await expect(section.getByText(t('vision.consent.speed'))).not.toBeVisible();
  await section.getByText(t('vision.setting.review'), { exact: true }).click();
  await expect(section.getByText(t('vision.consent.speed'))).toBeVisible();
  expect(requested).toEqual([]);
  expect(await stored(page)).toBeNull();

  await section.getByRole('button', { name: t('vision.consent.on') }).click();
  await expect(section.getByText(t('vision.setting.on', { size: downloadMegabytes() }))).toBeVisible();
  await expect(section.getByRole('button', { name: t('vision.remove') })).toBeVisible();
  await expect.poll(async () => (await cacheKeys(page)).length, { timeout: 30_000 }).toBe(3);
  expect(requested.sort()).toEqual(['labels.json', 'model.onnx', 'ort-wasm-simd-threaded.wasm']);
  expect(await stored(page)).toBe('on');

  await section.getByRole('button', { name: t('vision.remove') }).click();
  await expect(section.getByText(t('vision.setting.off'))).toBeVisible();
  await expect.poll(() => hasCache(page), { timeout: 30_000 }).toBe(false);
  // The choice goes back to "off" (nothing asks again by itself), and a reload starts nothing.
  expect(await stored(page)).toBe('off');
  const before = requested.length;
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(section.getByText(t('vision.setting.off'))).toBeVisible();
  expect(requested).toHaveLength(before);
});

test('a download that fails leaves a plain message, nothing broken, and works when tried again', async ({ page, shell, api, signedIn, uid }) => {
  const control: { fail?: 'error' | 'offline' } = { fail: 'error' };
  await standIn(page, control);
  const { dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, `Fail ${uid}`);
  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await consent(page)
    .getByRole('button', { name: t('vision.consent.on') })
    .click();
  await expect(dialog.getByText(t('vision.status.failed'))).toBeVisible();
  expect(await hasCache(page)).toBe(false);
  // The dialog is as usable as before.
  await expect(dialog.getByRole('button', { name: t('upload.submit', { count: 1 }) })).toBeEnabled();
  await expect(chip(page, 'mug')).toHaveCount(0);

  control.fail = 'offline';
  await dialog.getByRole('button', { name: t('common.tryAgain') }).click();
  await expect(dialog.getByText(t('vision.status.offline'))).toBeVisible();

  control.fail = undefined;
  await dialog.getByRole('button', { name: t('common.tryAgain') }).click();
  await expect(chip(page, 'mug')).toBeVisible();
});

test('offline, before the first online use, the question is not shown; it appears when the connection returns', async ({
  page,
  context,
  shell,
  api,
  signedIn,
  uid,
}) => {
  await standIn(page);
  const requested = watchModelRequests(page);
  const { dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, `Offline ${uid}`);
  await context.setOffline(true);
  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await expect(dialog.getByText('red.png')).toBeVisible();
  await expect(consent(page)).toHaveCount(0);
  expect(requested).toEqual([]);
  await context.setOffline(false);
  await expect(consent(page)).toBeVisible();
});

test('on a connection that looks metered the question says so, and a stored yes asks again before downloading', async ({ page, shell, api, signedIn, uid }) => {
  await standIn(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, type: 'cellular' } }));
  const requested = watchModelRequests(page);
  const { dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, `Metered ${uid}`);
  await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
  await expect(consent(page).getByText(t('vision.consent.metered'))).toBeVisible();
  await consent(page)
    .getByRole('button', { name: t('vision.consent.later') })
    .click();

  // A device that agreed earlier but does not have the files (cleared site data) is asked again, with the size.
  await page.evaluate((key) => localStorage.setItem(key, 'on'), KEY);
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addFinished') })
    .first()
    .click();
  const again = page.getByRole('dialog');
  await again.getByLabel(t('upload.library')).setInputFiles(RED);
  await expect(again.getByText(t('vision.confirm.body', { size: downloadMegabytes() }))).toBeVisible();
  expect(requested).toEqual([]);
  await again.getByRole('button', { name: t('vision.confirm.download') }).click();
  await expect(chip(page, 'mug')).toBeVisible();
  expect(requested.sort()).toEqual(['labels.json', 'model.onnx', 'ort-wasm-simd-threaded.wasm']);
});

test('the question and the setting speak German, Portuguese, Italian and Spanish', async ({ page, api, signedIn, uid }) => {
  test.setTimeout(60_000);
  void signedIn;
  await standIn(page);
  for (const [locale, messages] of [
    ['de', de],
    ['pt-PT', ptPT],
    ['it', it],
    ['es', es],
  ] as const) {
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const id = await api.addCombination({ title: `Locale ${locale} ${uid}`, steps: [BISQUE_STEP] });
    await page.goto('about:blank');
    await page.goto(`/#/combinations/${id}`);
    await page.getByRole('main').getByRole('button', { name: messages['images.addFinished'] }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(messages['upload.library']).setInputFiles(RED);
    const question = page.getByRole('region', { name: messages['vision.consent.title'] });
    await expect(question).toBeVisible();
    await expect(question.getByText(messages['vision.consent.body'])).toBeVisible();
    await expect(question.getByText(messages['vision.consent.speed'])).toBeVisible();
    await expect(question.getByRole('button', { name: messages['vision.consent.on'] })).toBeVisible();
    await expect(question.getByRole('button', { name: messages['vision.consent.later'] })).toBeVisible();
    expect(messages['vision.consent.body']).not.toBe(en['vision.consent.body']);
    await page.goto('about:blank');
    await page.goto('/#/account');
    await expect(page.getByRole('heading', { level: 2, name: messages['vision.setting.title'], exact: true })).toBeVisible();
    await expect(page.getByText(messages['vision.setting.off'])).toBeVisible();
    await page.getByText(messages['vision.setting.review'], { exact: true }).click();
    await expect(page.getByRole('button', { name: messages['vision.consent.on'] })).toBeVisible();
  }
});

test('the chip offers the word of the writer\'s language: "jarrón" in Spanish, "vaso" in Italian', async ({ page, api, signedIn, uid }) => {
  void signedIn;
  await standIn(page);
  for (const [locale, messages, tag] of [
    ['es', es, 'jarrón'],
    ['it', it, 'vaso'],
  ] as const) {
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const id = await api.addCombination({ title: `Chip ${locale} ${uid}`, steps: [BISQUE_STEP] });
    await page.goto('about:blank');
    await page.goto(`/#/combinations/${id}`);
    await page.getByRole('main').getByRole('button', { name: messages['images.addFinished'] }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(messages['upload.library']).setInputFiles(BLUE);
    const question = page.getByRole('region', { name: messages['vision.consent.title'] });
    // The first round turns it on; the second finds the stored yes and asks nothing.
    if (locale === 'es') await question.getByRole('button', { name: messages['vision.consent.on'] }).click();
    else await expect(question).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: messages['vision.suggested.add'].replace('{tag}', tag) })).toBeVisible();
  }
});

test('with the real model a photo of a mug suggests "mug" @vision-real', async ({ page, shell, api, signedIn, uid }) => {
  test.skip(STAND_IN_BUILD, STAND_IN_BUILD_REASON);
  test.setTimeout(120_000);
  // A public-domain photo (CC0, Commons "Entenbecher.jpg" by Tetzemann, scaled to 480 px): a blue ceramic mug with a duck.
  const photo = { name: 'mug.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/mug-photo.jpg', import.meta.url)) };
  const { dialog } = await openFinishedUpload(page, shell, api, signedIn.displayName, `Real ${uid}`);
  await dialog.getByLabel(t('upload.library')).setInputFiles(photo);
  await consent(page)
    .getByRole('button', { name: t('vision.consent.on') })
    .click();
  await expect(chip(page, 'mug')).toBeVisible({ timeout: 90_000 });
});

// A server of its own, with the service worker allowed, to look at what the worker precaches and what survives a reload.
const worker = test.extend<{ server: WebServer }>({
  server: async ({}, use) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const server = await startWebServer({ dist: DIST, apiUrl });
    await use(server);
    await server.close();
  },
});
worker.describe('with the service worker', () => {
  worker.use({ serviceWorkers: 'allow' });

  worker(
    'the model is never precached, is kept for offline use and works again after a reload with no connection',
    async ({ page, context, server, isMobile, api, signedIn, uid }) => {
      test.setTimeout(90_000);
      await standIn(context);
      const requested = watchModelRequests(page);
      const shell = new AppShell(page, isMobile);
      const title = `Kept ${uid}`;
      const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
      const open = async () => {
        await page.goto(`${server.url}/#/combinations/${id}`);
        await shell.expectSignedIn(signedIn.displayName);
        await page
          .getByRole('main')
          .getByRole('button', { name: t('images.addFinished') })
          .first()
          .click();
        return page.getByRole('dialog', { name: t('upload.heading', { title }) });
      };

      let dialog = await open();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
      // Nothing of the feature is in the first-install precache.
      const precached = await page.evaluate(async () => {
        const names = (await caches.keys()).filter((name) => name.startsWith('workbox-precache'));
        return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))).flat();
      });
      expect(precached.length).toBeGreaterThan(5);
      expect(precached.filter((url) => /vision|onnx|ort-wasm/.test(url))).toEqual([]);

      await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
      await consent(page)
        .getByRole('button', { name: t('vision.consent.on') })
        .click();
      await expect(chip(page, 'mug')).toBeVisible();
      expect(requested).toHaveLength(3);
      // The worker script is kept beside the model files by the service worker (its route), so a restart works offline.
      await expect.poll(async () => (await cacheKeys(page)).filter((name) => /^vision-worker-/.test(name ?? '')).length, { timeout: 30_000 }).toBe(1);

      // A fresh page with no connection: the app opens from its precache, the dialog opens (it was online when it opened), and the
      // photo is analysed from the device's own copy; adding the tag says it needs a connection.
      await page.reload();
      await shell.expectSignedIn(signedIn.displayName);
      await page
        .getByRole('main')
        .getByRole('button', { name: t('images.addFinished') })
        .first()
        .click();
      dialog = page.getByRole('dialog', { name: t('upload.heading', { title }) });
      await context.setOffline(true);
      await dialog.getByLabel(t('upload.library')).setInputFiles(RED);
      await expect(chip(page, 'mug')).toBeVisible();
      await expect(chip(page, 'mug')).toBeDisabled();
      await expect(dialog.getByText(t('vision.suggested.offline'))).toBeVisible();
      expect(requested).toHaveLength(3);
      await context.setOffline(false);
    },
  );
});
