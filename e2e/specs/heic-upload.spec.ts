import type { Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { png } from '../support/images';
import { expect, test } from '../support/test';

/**
 * Headless Chromium cannot decode HEIC (Safari can), so the photos here are fake: bytes that are no image at all.
 * Where a conversion must succeed, an init script stands in for Safari's decoder (`createImageBitmap` of a HEIC file
 * answers a painted bitmap); where it must fail, Chromium's own refusal is the real thing. Real decoding is checked
 * by hand on an iPhone.
 */
const NOT_AN_IMAGE = 'this is not an image, only a name and a type that look like HEIC';
const heic = (name = 'IMG_0001.HEIC', mimeType = 'image/heic') => ({ name, mimeType, buffer: Buffer.from(NOT_AN_IMAGE) });

async function stubHeicDecoder(page: Page) {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((source: ImageBitmapSource, ...rest: unknown[]) => {
      if (source instanceof File && /\.hei[cf]$/i.test(source.name)) {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#6a9e8a';
        context.fillRect(0, 0, 320, 240);
        return original(canvas);
      }
      return (original as (...args: unknown[]) => Promise<ImageBitmap>)(source, ...rest);
    }) as typeof window.createImageBitmap;
  });
}

interface SentFile {
  url: string;
  name: string;
  type: string;
  size: number;
  /** The first bytes as hex: a JPEG starts with ffd8ff. */
  head: string;
  text: string;
}

/** Chromium does not expose a multipart body with files to Playwright, so the page's own `fetch` reports the files it sends. */
async function recordUploads(page: Page) {
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    (window as unknown as { __sent: unknown[] }).__sent = sent;
    const original = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const isPost = (input instanceof Request ? input.method : (init?.method ?? 'GET')) === 'POST';
      const form = !isPost
        ? undefined
        : input instanceof Request
          ? await input
              .clone()
              .formData()
              .catch(() => undefined)
          : init?.body;
      if (form instanceof FormData) {
        for (const [, value] of form.entries()) {
          if (!(value instanceof File)) continue;
          const bytes = new Uint8Array(await value.arrayBuffer());
          sent.push({
            url,
            name: value.name,
            type: value.type,
            size: value.size,
            head: [...bytes.slice(0, 3)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
            text: new TextDecoder('latin1').decode(bytes.slice(0, 80)),
          });
        }
      }
      return original(input, init);
    }) as typeof window.fetch;
  });
  return () => page.evaluate(() => (window as unknown as { __sent: SentFile[] }).__sent);
}

async function openUpload(
  page: Page,
  shell: { open: (hash: string) => Promise<void>; expectSignedIn: (name: string) => Promise<void> },
  id: string,
  title: string,
  name: string,
) {
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(name);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  return page.getByRole('dialog', { name: t('upload.heading', { title }) });
}

for (const [label, mimeType] of [
  ['typed image/heic', 'image/heic'],
  ['without a type (Files app, AirDrop)', ''],
] as const) {
  test(`a HEIC photo ${label} is converted on the device and the JPEG is uploaded @smoke`, async ({ page, shell, api, signedIn, uid, encoder }) => {
    await stubHeicDecoder(page);
    const sent = await recordUploads(page);
    const title = `Heic ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    const upload = await openUpload(page, shell, id, title, signedIn.displayName);
    await upload.getByLabel(t('upload.library')).setInputFiles(heic('IMG_0001.HEIC', mimeType));
    await expect(upload.getByRole('alert')).toHaveCount(0);
    // The row shows the JPEG's name once the conversion is done.
    await expect(upload.getByText('IMG_0001.jpg')).toBeVisible();
    await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
    await expect(upload).toBeHidden();
    const files = await sent();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg', head: 'ffd8ff' });
    expect(files[0].text).not.toContain(NOT_AN_IMAGE);
    await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  });
}

test('a HEIC photo the browser cannot decode is named, never sent, and the other photos still go', async ({ page, shell, api, signedIn, uid, encoder }) => {
  const sent = await recordUploads(page);
  const title = `Heic refused ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const upload = await openUpload(page, shell, id, title, signedIn.displayName);
  await upload.getByLabel(t('upload.library')).setInputFiles([heic('IMG_0002.HEIC'), png('bowl.png')]);
  const refusal = upload.getByRole('alert').filter({ hasText: 'IMG_0002.HEIC' });
  await expect(refusal).toHaveText(t('upload.skipped', { name: 'IMG_0002.HEIC', reason: t('upload.reason.heic') }));
  // Only the PNG is in the list; the HEIC has no row, so there is nothing to retry or send.
  await expect(upload.getByRole('list', { name: t('upload.list') }).getByRole('listitem')).toHaveCount(1);
  await expect(upload.getByRole('button', { name: t('upload.submit', { count: 1 }) })).toBeEnabled();
  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  // A photo that is no HEIC goes out as it is (the server resizes it), under its own name; the HEIC never goes out.
  const files = await sent();
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ name: 'bowl.png', type: 'image/png' });
});

test('a HEIC photo alone leaves nothing to send', async ({ page, shell, api, signedIn, uid }) => {
  const sent = await recordUploads(page);
  const title = `Heic alone ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const upload = await openUpload(page, shell, id, title, signedIn.displayName);
  await upload.getByLabel(t('upload.library')).setInputFiles(heic('IMG_0003.heif', ''));
  await expect(upload.getByRole('alert')).toContainText(t('upload.reason.heic'));
  await expect(upload.getByRole('button', { name: t('upload.submit', { count: 0 }) })).toBeDisabled();
  expect(await sent()).toEqual([]);
});
