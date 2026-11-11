import { closeSync, ftruncateSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import de from '../../src/lib/i18n/de.json' with { type: 'json' };
import { t } from '../support/i18n';
import { paintedPng, pngHeaderOnly, type Colour } from '../support/images';
import { AvatarSection, decoded } from '../support/pages/avatar';
import { FIXTURES } from '../support/paths';
import { expect, test } from '../support/test';

/**
 * The profile picture of the account page (31-2): a square the member positions in a round preview, with the notice about who
 * sees it. Pictures are cut in the browser; the API stores what it receives (it is not mocked, except for the 429 and the
 * unreadable file, which it cannot produce on demand).
 */
const RED: Colour = [220, 40, 40];
const BLUE: Colour = [40, 40, 220];
const GREEN: Colour = [40, 180, 60];

/** Twice as wide as tall: red on the left half, blue on the right, so what a crop kept shows in the colours. */
const twoTone = (name = 'two-tone.png') => paintedPng(name, 400, 200, (x) => (x < 200 ? RED : BLUE));
/** 256 px on the short side: the largest zoom (4) leaves a window of 64 source pixels, the smallest allowed. */
const large = (name = 'large.png') => paintedPng(name, 512, 256, (x) => (x < 256 ? RED : BLUE));
const plain = (colour: Colour, name = 'plain.png') => paintedPng(name, 240, 240, () => colour);

/**
 * A file of that size on disk that holds nothing (sparse). Passed by path, the browser reads it locally; a 40 MB buffer goes through
 * the browser protocol and took over 25 s on a loaded host, past the test's timeout (E2E-flaky-2).
 */
function sparseFile(name: string, size: number): string {
  mkdirSync(FIXTURES, { recursive: true });
  const path = join(FIXTURES, `${process.pid}-${name}`);
  const file = openSync(path, 'w');
  ftruncateSync(file, size);
  closeSync(file);
  return path;
}

const isBlue = ([r, g, b]: number[]) => b > 150 && r < 90;
const isRed = ([r, g, b]: number[]) => r > 150 && b < 90;
const isGreen = ([r, g, b]: number[]) => g > 120 && r < 90 && b < 110;

test('a member positions a picture with the keyboard, saves it and sees it on the page and in the header @smoke', async ({ page, shell, signedIn }) => {
  const avatar = new AvatarSection(page);
  const posts: string[] = [];
  page.on('request', (request) => request.method() === 'POST' && request.url().includes('/api/avatars') && posts.push(request.url()));
  await shell.open();
  await shell.openAccountPage(signedIn.displayName);
  // Before anything is chosen the section already says who sees a picture and what it may show, and offers the chooser.
  await expect(avatar.visible).toBeVisible();
  await expect(avatar.main.getByText(t('account.avatar.rule'), { exact: true })).toBeVisible();
  await expect(avatar.main.getByRole('link', { name: t('account.avatar.terms') })).toHaveAttribute('href', '#/terms');
  await expect(avatar.choose).toBeEnabled();
  await expect(avatar.remove).toHaveCount(0);
  await expect(avatar.shownPicture()).toHaveCount(0);
  await expect(avatar.picture).toContainText('A');

  await avatar.pick(twoTone());
  await expect(avatar.crop).toBeVisible();
  // The notice is in the dialog before the picture can be sent, in the dialog's own words, and the dialog opens at the positioning area.
  await expect(avatar.crop.getByText(t('account.avatar.visible'), { exact: true })).toBeVisible();
  await expect(avatar.crop.getByText(t('account.avatar.rule'), { exact: true })).toBeVisible();
  await expect(avatar.crop.getByRole('link', { name: t('account.avatar.terms') })).toHaveAttribute('href', '#/terms');
  await expect(avatar.stage).toBeFocused();
  await expect(avatar.save).toBeEnabled();
  expect(posts).toEqual([]);

  // Plus zooms in (two steps: 1.5), the left arrow moves the picture left until the window sits at its right edge: only blue is left.
  const zoom = avatar.crop.getByRole('slider', { name: t('crop.zoom') });
  await expect(zoom).toHaveValue('1');
  await avatar.stage.press('+');
  await avatar.stage.press('=');
  await expect(zoom).toHaveValue('1.5');
  for (let step = 0; step < 40; step++) await avatar.stage.press('ArrowLeft');
  const id = await avatar.send();
  await expect(avatar.crop).toBeHidden();
  expect(posts).toHaveLength(1);
  await expect(page.getByText(t('notices.avatarSaved'))).toBeVisible();

  const stored = await decoded(page, id, [
    [0.05, 0.05],
    [0.5, 0.5],
    [0.95, 0.95],
  ]);
  expect(stored.width).toBe(stored.height);
  expect(stored.width).toBeGreaterThan(100);
  expect(stored.width).toBeLessThanOrEqual(256);
  for (const colour of stored.colours) expect(isBlue(colour)).toBe(true);

  // The picture replaces the letter on the page (with its persistent line and a way to change or remove it) and in the account control.
  await expect(avatar.shownPicture()).toBeVisible();
  await expect(avatar.shownPicture()).toHaveAttribute('src', /^blob:/);
  await expect(avatar.visible).toBeVisible();
  await expect(avatar.choose).toHaveAccessibleName(t('account.avatar.change'));
  await expect(avatar.remove).toBeEnabled();
  await expect(avatar.headerPicture(shell)).toBeVisible();
  const me = await page.request.get('/api/auth/me');
  expect(((await me.json()) as { avatarId: string }).avatarId).toBe(id);
  // The next page load shows it again from the account (its ID is in the user view).
  await page.goto('about:blank');
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  await expect(avatar.headerPicture(shell)).toBeVisible();
});

test('dragging moves the picture under the round preview', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(twoTone());
  await expect(avatar.save).toBeEnabled();
  const box = (await avatar.stage.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A drag of more than the stage's width to the left brings the right edge of the picture under it: blue only.
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x - box.width * 1.5, centre.y, { steps: 6 });
  await page.mouse.up();
  const id = await avatar.send();
  const stored = await decoded(page, id, [
    [0.05, 0.5],
    [0.5, 0.5],
    [0.95, 0.5],
  ]);
  for (const colour of stored.colours) expect(isBlue(colour)).toBe(true);
});

test('the slider and the buttons zoom within their limits', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(large());
  const zoom = avatar.crop.getByRole('slider', { name: t('crop.zoom') });
  const more = avatar.crop.getByRole('button', { name: t('crop.zoomIn') });
  const less = avatar.crop.getByRole('button', { name: t('crop.zoomOut') });
  await expect(less).toBeDisabled();
  for (let step = 0; step < 12; step++) if (await more.isEnabled()) await more.click();
  await expect(zoom).toHaveValue('4');
  await expect(more).toBeDisabled();
  await zoom.fill('2');
  await expect(zoom).toHaveValue('2');
  await expect(less).toBeEnabled();
});

test('two fingers zoom the picture (touch)', async ({ page, shell, signedIn: _, isMobile }) => {
  test.skip(!isMobile, 'a touch gesture: the phone project');
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(large());
  await expect(avatar.save).toBeEnabled();
  const box = (await avatar.stage.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  const touch = await page.context().newCDPSession(page);
  const points = (spread: number) => [
    { x: x - spread, y, id: 1 },
    { x: x + spread, y, id: 2 },
  ];
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(20) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(50) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(80) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const zoom = avatar.crop.getByRole('slider', { name: t('crop.zoom') });
  await expect(zoom).toHaveValue('4');
});

test('closing the dialog sends nothing, and the picture stays as it was', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  const posts: string[] = [];
  page.on('request', (request) => request.method() === 'POST' && request.url().includes('/api/avatars') && posts.push(request.url()));
  await shell.open('#/account');
  await avatar.pick(twoTone());
  await expect(avatar.crop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(avatar.crop).toBeHidden();
  await avatar.pick(twoTone());
  await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
  await expect(avatar.crop).toBeHidden();
  expect(posts).toEqual([]);
  await expect(avatar.shownPicture()).toHaveCount(0);
  await expect(avatar.visible).toBeVisible();
});

test('the dialog keeps the focus inside, and Tab reaches the notice link and Save', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(twoTone());
  await expect(avatar.stage).toBeFocused();
  const reached = new Set<string>();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    reached.add(label);
  }
  expect(reached).toContain(t('account.avatar.terms'));
  expect(reached).toContain(t('account.avatar.save'));
});

test('replacing the picture shows the new one, and the old address is gone', async ({ page, shell, api, signedIn }) => {
  const avatar = new AvatarSection(page);
  const first = await api.uploadAvatar(twoTone());
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  await expect(avatar.choose).toHaveAccessibleName(t('account.avatar.change'));
  await avatar.pick(plain(GREEN));
  await expect(avatar.save).toBeEnabled();
  const second = await avatar.send();
  expect(second).not.toBe(first);
  await expect(avatar.crop).toBeHidden();
  expect((await page.request.get(`/api/avatars/${first}`)).status()).toBe(404);
  expect((await page.request.get(`/api/avatars/${second}`)).status()).toBe(200);
  const stored = await decoded(page, second, [[0.5, 0.5]]);
  expect(isGreen(stored.colours[0])).toBe(true);
  // The shown picture is the new one: its object URL is another download.
  await expect(avatar.shownPicture()).toBeVisible();
  const me = (await (await page.request.get('/api/auth/me')).json()) as { avatarId: string };
  expect(me.avatarId).toBe(second);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(avatar.headerPicture(shell)).toBeVisible();
});

test('removing the picture asks first, then shows the letter again', async ({ page, shell, api, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  const id = await api.uploadAvatar(twoTone());
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  await avatar.remove.click();
  await expect(avatar.removal).toBeVisible();
  await expect(avatar.removal.getByText(t('account.avatar.remove.body'))).toBeVisible();
  await avatar.removal.getByRole('button', { name: t('common.cancel') }).click();
  await expect(avatar.removal).toBeHidden();
  await expect(avatar.shownPicture()).toBeVisible();
  expect((await page.request.get(`/api/avatars/${id}`)).status()).toBe(200);

  await avatar.remove.click();
  await avatar.removal.getByRole('button', { name: t('account.avatar.remove.confirm') }).click();
  await expect(avatar.removal).toBeHidden();
  await expect(page.getByText(t('notices.avatarRemoved'))).toBeVisible();
  await expect(avatar.shownPicture()).toHaveCount(0);
  await expect(avatar.picture).toContainText('A');
  await expect(avatar.remove).toHaveCount(0);
  await expect(avatar.choose).toHaveAccessibleName(t('account.avatar.choose'));
  await expect(avatar.choose).toBeFocused();
  await expect(avatar.visible).toBeVisible();
  await expect(avatar.headerPicture(shell)).toHaveCount(0);
  expect((await page.request.get(`/api/avatars/${id}`)).status()).toBe(404);
  expect(((await (await page.request.get('/api/auth/me')).json()) as { avatarId: string | null }).avatarId).toBeNull();
});

test('a picture that a site admin removed meanwhile counts as removed', async ({ page, shell, api, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  const id = await api.uploadAvatar(twoTone());
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  // The API answers 404 for it (gone): the page treats that as done.
  await page.route(`**/api/avatars/${id}`, async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 404, json: { error: 'Profile picture not found' } });
    else await route.fallback();
  });
  await avatar.remove.click();
  await avatar.removal.getByRole('button', { name: t('account.avatar.remove.confirm') }).click();
  await expect(avatar.shownPicture()).toHaveCount(0);
  await expect(avatar.remove).toHaveCount(0);
});

test('a file that is not a picture is refused before any dialog opens', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') });
  await expect(avatar.main.getByRole('alert')).toHaveText(t('account.avatar.problem.notImage'));
  await expect(avatar.crop).toHaveCount(0);
  await avatar.pick({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
  await expect(avatar.main.getByRole('alert')).toHaveText(t('account.avatar.problem.empty'));
  // The size limit is read from the file's size, before any decoding (COMP-7 review: the limit is filled in, focus moves to it).
  await avatar.pick(sparseFile('big.png', 40_000_001));
  await expect(avatar.main.getByRole('alert')).toHaveText(t('account.avatar.problem.tooLarge', { max: 40 }));
  await expect(avatar.main.getByRole('alert')).toBeFocused();
  await expect(avatar.crop).toHaveCount(0);
});

test('a picture the browser cannot decode is reported in the dialog and cannot be sent', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('this is not png data at all') });
  await expect(avatar.crop).toBeVisible();
  await expect(avatar.crop.getByRole('alert')).toHaveText(t('account.avatar.unreadable'));
  await expect(avatar.save).toBeDisabled();
  await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
  await expect(avatar.crop).toBeHidden();
});

test('a refused upload (too many) stays in the dialog with its message, and the notice is still there', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await page.route('**/api/avatars', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 429, json: { error: 'Too many requests.' } });
    else await route.fallback();
  });
  await avatar.pick(twoTone());
  await expect(avatar.save).toBeEnabled();
  await avatar.save.click();
  await expect(avatar.crop.getByRole('alert')).toHaveText(t('errors.tooManyRequests'));
  await expect(avatar.crop.getByText(t('account.avatar.visible'), { exact: true })).toBeVisible();
  await expect(avatar.save).toBeEnabled();
  await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
  // The failure belongs to the dialog: closing it leaves no stale message behind.
  await expect(avatar.main.getByRole('alert')).toHaveCount(0);
});

test('offline the picture stays and changing it is disabled with the note', async ({ page, shell, api, context, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await api.uploadAvatar(twoTone());
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  await expect(avatar.choose).toBeEnabled();
  await context.setOffline(true);
  await expect(shell.header.getByRole('button', { name: t('header.offline') })).toBeVisible();
  await expect(avatar.main.getByText(t('account.avatar.offline'))).toBeVisible();
  await expect(avatar.choose).toBeDisabled();
  await expect(avatar.remove).toBeDisabled();
  await expect(avatar.shownPicture()).toBeVisible();
  await expect(avatar.visible).toBeVisible();
  await expect(avatar.headerPicture(shell)).toBeVisible();
  await context.setOffline(false);
  await expect(avatar.choose).toBeEnabled();
});

test('after a reload the saved copy shows at once, even when the picture address does not answer', async ({ page, shell, api, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await api.uploadAvatar(twoTone());
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  await expect(avatar.headerPicture(shell)).toBeVisible();
  // Both sizes are saved under the account's own cache once downloaded (the page's 256 px and the header's 64 px).
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const name = (await caches.keys()).find((each) => each.startsWith('glazelab-images-'));
        return name ? (await (await caches.open(name)).keys()).length : 0;
      }),
    )
    .toBe(2);
  await page.route('**/api/avatars/**', (route) => route.abort('connectionrefused'));
  await page.goto('about:blank');
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  await expect(avatar.headerPicture(shell)).toBeVisible();
});

test("signing out removes the account's saved pictures from the device", async ({ page, shell, api, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  const owner = (await api.me()).id;
  await api.uploadAvatar(twoTone());
  await shell.open('#/account');
  await expect(avatar.shownPicture()).toBeVisible();
  const saved = () => page.evaluate(async (name) => (await caches.keys()).includes(name), `glazelab-images-${owner}`);
  await expect.poll(saved).toBe(true);
  await shell.signOut();
  await shell.expectGuest();
  await expect.poll(saved).toBe(false);
});

test('the German section and dialog read in German', async ({ page, signedIn: _ }) => {
  await page.addInitScript(() => localStorage.setItem('glazelab:locale', 'de'));
  await page.goto('/#/account');
  const main = page.getByRole('main');
  await expect(main.getByText(de['account.avatar.visible'], { exact: true })).toBeVisible();
  await expect(main.getByText(de['account.avatar.rule'], { exact: true })).toBeVisible();
  await main.getByLabel(de['account.avatar.choose']).setInputFiles(twoTone());
  const dialog = page.getByRole('dialog', { name: de['account.avatar.dialog.title'] });
  await expect(dialog.getByText(de['account.avatar.visible'], { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: de['account.avatar.save'] })).toBeEnabled();
});

/** The notice and the preview stay in the dialog whatever the picture: only Save depends on a usable one. */
async function expectRefused(avatar: AvatarSection, message: string) {
  await expect(avatar.crop).toBeVisible();
  await expect(avatar.crop.getByRole('alert')).toHaveText(message);
  await expect(avatar.save).toBeDisabled();
  await expect(avatar.crop.getByText(t('account.avatar.visible'), { exact: true })).toBeVisible();
}

/** Counts the calls of the browser's decoder, and can stand in for it with a picture of a stated size. */
const watchDecoder = (page: Page) =>
  page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    const state = { calls: 0, fake: null as null | { width: number; height: number } };
    Object.assign(window, { decoder: state });
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      state.calls++;
      return state.fake ? Promise.resolve({ ...state.fake, close() {} }) : original(...args);
    }) as typeof createImageBitmap;
  });
const decoderCalls = (page: Page) => page.evaluate(() => (window as unknown as { decoder: { calls: number } }).decoder.calls);

test('a picture of more than 50 megapixels is refused from its header, without decoding it', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await watchDecoder(page);
  await shell.open('#/account');
  // 100 MP (the header alone: nothing was ever decoded, so nothing needed 400 MB).
  await avatar.pick(pngHeaderOnly('huge.png', 10_000, 10_000));
  await expectRefused(avatar, t('account.avatar.problem.tooManyPixels', { max: 50 }));
  expect(await decoderCalls(page)).toBe(0);
  await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
  await expect(avatar.crop).toBeHidden();
  // Exactly 50 MP is within the limit: the decoder is tried (this header has no picture, so it then reports the file as unreadable).
  await avatar.pick(pngHeaderOnly('limit.png', 5000, 10_000));
  await expectRefused(avatar, t('account.avatar.unreadable'));
  expect(await decoderCalls(page)).toBe(1);
});

test('a format without a readable header is checked after decoding', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await watchDecoder(page);
  await page.addInitScript(() => ((window as unknown as { decoder: { fake: unknown } }).decoder.fake = { width: 9000, height: 9000 }));
  await shell.open('#/account');
  await avatar.pick({ name: 'huge.bmp', mimeType: 'image/bmp', buffer: Buffer.from('BM-not-readable-by-the-header-check') });
  await expectRefused(avatar, t('account.avatar.problem.tooManyPixels', { max: 50 }));
  expect(await decoderCalls(page)).toBe(1);
});

test('a picture smaller than 64 pixels on its short side is refused', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(paintedPng('tiny.png', 40, 30, () => RED));
  await expectRefused(avatar, t('account.avatar.problem.tooSmall', { min: 64 }));
  await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
  await avatar.pick(paintedPng('thin.png', 500, 63, () => RED));
  await expectRefused(avatar, t('account.avatar.problem.tooSmall', { min: 64 }));
  await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
  await avatar.pick(paintedPng('smallest.png', 64, 64, () => RED));
  await expect(avatar.save).toBeEnabled();
  await expect(avatar.crop.getByRole('alert')).toHaveCount(0);
});

test('a small picture cannot be zoomed to a square of a few pixels', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(paintedPng('small.png', 128, 128, () => GREEN));
  const zoom = avatar.crop.getByRole('slider', { name: t('crop.zoom') });
  const more = avatar.crop.getByRole('button', { name: t('crop.zoomIn') });
  // 128 px at most twice enlarged: the window is never below 64 source pixels.
  await expect(zoom).toHaveAttribute('max', '2');
  for (let step = 0; step < 12; step++) if (await more.isEnabled()) await more.click();
  await expect(zoom).toHaveValue('2');
  await expect(more).toBeDisabled();
  await avatar.stage.press('+');
  await expect(zoom).toHaveValue('2');
  const id = await avatar.send();
  const stored = await decoded(page, id, [[0.5, 0.5]]);
  expect(stored.width).toBe(64);
  expect(isGreen(stored.colours[0])).toBe(true);
});

test.describe('the preview is as sharp as the screen', () => {
  for (const scale of [1, 3]) {
    test.describe(`at pixel ratio ${scale}`, () => {
      test.use({ deviceScaleFactor: scale });
      test(`the canvas has ${scale} pixel(s) per CSS pixel`, async ({ page, shell, signedIn: _ }) => {
        const avatar = new AvatarSection(page);
        await shell.open('#/account');
        await avatar.pick(twoTone());
        await expect(avatar.save).toBeEnabled();
        const canvas = avatar.crop.locator('canvas');
        await expect
          .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width === Math.round(element.clientWidth * window.devicePixelRatio)))
          .toBe(true);
        const [pixels, shown, ratio] = await canvas.evaluate((element: HTMLCanvasElement) => [element.width, element.clientWidth, window.devicePixelRatio]);
        expect(ratio).toBe(scale);
        expect(pixels).toBe(Math.round(shown * scale));
        // The sent square does not depend on it: the picture's own pixels (200 here), not the preview's.
        const id = await avatar.send();
        expect((await decoded(page, id, [[0.5, 0.5]])).width).toBe(200);
      });
    });
  }
});

test('two fingers zoom about the point between them, not the window centre (touch)', async ({ page, shell, signedIn: _, isMobile }) => {
  test.skip(!isMobile, 'a touch gesture: the phone project');
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(twoTone());
  await expect(avatar.save).toBeEnabled();
  const box = (await avatar.stage.boundingBox())!;
  const y = box.y + box.height / 2;
  // The fingers' midpoint is a quarter of the stage right of the centre (over the blue half), and does not move.
  const x = box.x + box.width * 0.75;
  const touch = await page.context().newCDPSession(page);
  const points = (spread: number) => [
    { x: x - spread, y, id: 1 },
    { x: x + spread, y, id: 2 },
  ];
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(20) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(30) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(40) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const zoom = avatar.crop.getByRole('slider', { name: t('crop.zoom') });
  await expect(zoom).toHaveValue('2');
  // The picture's red/blue border stays where it was under the midpoint: a quarter of the window from its left edge (the 400 x 200
  // picture, window of 100 px around x = 225). A zoom about the centre would put it in the middle of the square.
  const id = await avatar.send();
  const stored = await decoded(page, id, [
    [0.12, 0.5],
    [0.4, 0.5],
  ]);
  expect(isRed(stored.colours[0])).toBe(true);
  expect(isBlue(stored.colours[1])).toBe(true);
});

test('the keys announce zoom and position in a polite live region, at a throttled pace', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await shell.open('#/account');
  await avatar.pick(twoTone());
  await expect(avatar.save).toBeEnabled();
  const live = avatar.crop.getByRole('status');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toHaveText('');
  await live.evaluate((element) => {
    const seen: string[] = [];
    new MutationObserver(() => seen.push(element.textContent ?? '')).observe(element, { childList: true, characterData: true, subtree: true });
    Object.assign(window, { announced: seen });
  });
  await avatar.stage.press('+');
  await expect(live).toHaveText(t('crop.position', { zoom: 125, x: 50, y: 50 }));
  // Forty quick presses of an arrow bring the window to the right edge; far fewer messages are spoken, and the last one is the final position.
  for (let step = 0; step < 40; step++) await avatar.stage.press('ArrowLeft');
  await expect(live).toHaveText(t('crop.position', { zoom: 125, x: 100, y: 50 }));
  const seen = await page.evaluate(() => (window as unknown as { announced: string[] }).announced);
  expect(seen.length).toBeGreaterThanOrEqual(2);
  expect(seen.length).toBeLessThan(20);
  expect(new Set(seen).size).toBe(seen.length);
  // A drag or the slider says nothing of its own here (the slider has its own value text); the region is only for the keys.
  await avatar.crop.getByRole('slider', { name: t('crop.zoom') }).fill('2');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { announced: string[] }).announced.length)).toBe(seen.length);
});

test('a canvas that cannot encode shows an error, stays open and sends nothing; another try works', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  const posts: string[] = [];
  page.on('request', (request) => request.method() === 'POST' && request.url().includes('/api/avatars') && posts.push(request.url()));
  await shell.open('#/account');
  await avatar.pick(twoTone());
  await expect(avatar.save).toBeEnabled();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    Object.assign(window, { restoreToBlob: () => (HTMLCanvasElement.prototype.toBlob = original) });
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
  });
  await avatar.save.click();
  await expect(avatar.crop.getByRole('alert')).toHaveText(t('account.avatar.processFailed'));
  await expect(avatar.crop).toBeVisible();
  await expect(avatar.save).toBeEnabled();
  expect(posts).toEqual([]);
  await page.evaluate(() => (window as unknown as { restoreToBlob: () => void }).restoreToBlob());
  await avatar.send();
  await expect(avatar.crop).toBeHidden();
  expect(posts).toHaveLength(1);
});

/**
 * HEIC photos (24-17, `lib/images/heic.ts`) go through the same conversion as in the upload dialog before the crop. Headless Chromium
 * cannot decode HEIC (Safari can), so bytes that are no image at all stand in for the file; where the conversion must succeed an init
 * script plays Safari's decoder (`createImageBitmap` of a HEIC file answers a painted bitmap: red left half, blue right half), where it
 * must fail Chromium's own refusal is the real thing. Real decoding is checked by hand on an iPhone.
 */
const NOT_AN_IMAGE = 'this is not an image, only a name and a type that look like HEIC';
const heic = (name: string, mimeType: string) => ({ name, mimeType, buffer: Buffer.from(NOT_AN_IMAGE) });

async function stubHeicDecoder(page: Page, size = { width: 320, height: 240 }) {
  await page.addInitScript((stub) => {
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((source: ImageBitmapSource, ...rest: unknown[]) => {
      if (source instanceof File && /\.hei[cf]$/i.test(source.name)) {
        const canvas = document.createElement('canvas');
        canvas.width = stub.width;
        canvas.height = stub.height;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#dc2828';
        context.fillRect(0, 0, stub.width / 2, stub.height);
        context.fillStyle = '#2828dc';
        context.fillRect(stub.width / 2, 0, stub.width / 2, stub.height);
        return original(canvas);
      }
      return (original as (...args: unknown[]) => Promise<ImageBitmap>)(source, ...rest);
    }) as typeof window.createImageBitmap;
  }, size);
}

for (const [label, mimeType] of [
  ['typed image/heic', 'image/heic'],
  ['without a type (Files app, AirDrop)', ''],
] as const) {
  test(`a HEIC photo ${label} is converted on the device and cropped like any picture`, async ({ page, shell, signedIn: _ }) => {
    const avatar = new AvatarSection(page);
    await stubHeicDecoder(page);
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && request.url().includes('/api/avatars') && posts.push(request.url()));
    await shell.open('#/account');
    await avatar.pick(heic('IMG_0001.HEIC', mimeType));
    await expect(avatar.crop).toBeVisible();
    await expect(avatar.save).toBeEnabled();
    await expect(avatar.crop.getByRole('alert')).toHaveCount(0);
    expect(posts).toEqual([]);
    const id = await avatar.send();
    await expect(avatar.crop).toBeHidden();
    const stored = await decoded(page, id, [
      [0.1, 0.5],
      [0.9, 0.5],
    ]);
    expect(stored.width).toBe(stored.height);
    expect(isRed(stored.colours[0])).toBe(true);
    expect(isBlue(stored.colours[1])).toBe(true);
    await expect(avatar.shownPicture()).toBeVisible();
  });
}

test('a HEIC photo the browser cannot decode is named in the dialog and cannot be sent', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  const posts: string[] = [];
  page.on('request', (request) => request.method() === 'POST' && request.url().includes('/api/avatars') && posts.push(request.url()));
  await shell.open('#/account');
  await avatar.pick(heic('IMG_0002.HEIC', 'image/heic'));
  await expectRefused(avatar, t('upload.reason.heic'));
  await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
  await expect(avatar.crop).toBeHidden();
  // The same for a file without a type, which the chooser would otherwise have taken for no picture at all.
  await avatar.pick(heic('IMG_0003.heif', ''));
  await expectRefused(avatar, t('upload.reason.heic'));
  expect(posts).toEqual([]);
});

test('a HEIC photo that decodes too small is refused like any small picture', async ({ page, shell, signedIn: _ }) => {
  const avatar = new AvatarSection(page);
  await stubHeicDecoder(page, { width: 40, height: 30 });
  await shell.open('#/account');
  await avatar.pick(heic('tiny.HEIC', 'image/heic'));
  await expectRefused(avatar, t('account.avatar.problem.tooSmall', { min: 64 }));
});
