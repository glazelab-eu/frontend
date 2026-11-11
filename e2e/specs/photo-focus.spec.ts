import type { Locator, Page } from '@playwright/test';
import type { ImageView } from '../../src/lib/generated/types.gen';
import { Api, BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { paintedPng, photoPng } from '../support/images';
import { ExplorePage } from '../support/pages/explore';
import { StudioPage } from '../support/pages/studio';
import { expect, newAccount, test } from '../support/test';

/**
 * A landscape photo (2:1) of a dark piece near its right edge on a light shelf: the focus moves the covers onto it. Smooth
 * colours keep the PNG small enough to hand over as a buffer.
 */
const PIECE = { x: 1600, y: 450, radius: 180 };
const shelfPhoto = (name: string) =>
  paintedPng(name, 1800, 900, (x, y) => (Math.hypot(x - PIECE.x, y - PIECE.y) < PIECE.radius ? [70, 45, 30] : [214, 220, 200]));

/** Opens the focus dialog with `open`, then moves the frame with the keyboard: ten steps right reach the right edge. */
async function focusRight(page: Page, open: Locator, name: string) {
  await open.click();
  const dialog = page.getByRole('dialog', { name: t('upload.focus.title') });
  const stage = dialog.getByRole('button', { name: t('upload.focus.stage', { name }) });
  await expect(stage).toBeFocused();
  await expect(stage).not.toHaveAttribute('aria-busy', 'true');
  // No zoom: the frame keeps its size.
  await expect(dialog.getByRole('slider')).toHaveCount(0);
  for (let step = 0; step < 10; step++) await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('status')).toHaveText(t('upload.focus.position', { x: 100, y: 50 }));
  return dialog;
}

/** The photos of a combination as the API answers them. */
async function photosOf(api: Api, id: string): Promise<ImageView[]> {
  return (await api.combinations()).find((candidate) => candidate.id === id)?.images ?? [];
}

const objectPosition = (image: Locator) => image.evaluate((element) => getComputedStyle(element).objectPosition);

test('a photo uploaded with a focus keeps its whole size, and the card cover centres on the focus', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  encoder,
}, info) => {
  void encoder;
  const title = `Focused ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await upload.getByLabel(t('upload.library')).setInputFiles(shelfPhoto('shelf.png'));
  const list = upload.getByRole('list', { name: t('upload.list') });
  // No focus by default: nothing to reset, and the preview shows the middle.
  await expect(list.getByRole('button', { name: t('upload.focus.resetNamed', { name: 'shelf.png' }) })).toHaveCount(0);
  await expect(list.getByText(t('upload.focus.set'), { exact: false })).toHaveCount(0);
  const open = list.getByRole('button', { name: t('upload.focus.openNamed', { name: 'shelf.png' }), exact: true });
  const dialog = await focusRight(page, open, 'shelf.png');
  await page.screenshot({ path: info.outputPath('focus-dialog.png') });
  await dialog.getByRole('button', { name: t('upload.focus.save') }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(list.getByText(t('upload.focus.set'), { exact: false })).toBeVisible();
  await expect(list.getByRole('button', { name: t('upload.focus.resetNamed', { name: 'shelf.png' }) })).toBeVisible();
  // The row's preview is decorative (empty alt, no role): the one picture in the list.
  await expect.poll(() => objectPosition(list.locator('img'))).toBe('100% 50%');

  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  // The whole 2:1 photo, scaled by the server to its 1600 px, with the focus beside it.
  await expect
    .poll(async () => (await photosOf(api, id)).map(({ width, height, focusX, focusY }) => ({ width, height, focusX, focusY })))
    .toEqual([{ width: 1600, height: 800, focusX: 100, focusY: 50 }]);

  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cardTitles).toHaveText([title]);
  const cover = page.getByRole('img', { name: t('images.alt.tile', { title }) });
  await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(480);
  expect(await objectPosition(cover)).toBe('100% 50%');
  await cover.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('focused-card.png') });
});

test('a photo without a focus stays centred, and a reset focus is sent as none', async ({ page, shell, api, signedIn, uid, encoder }) => {
  void encoder;
  const title = `Centred ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await upload.getByLabel(t('upload.library')).setInputFiles(shelfPhoto('whole.png'));
  const list = upload.getByRole('list', { name: t('upload.list') });
  const open = list.getByRole('button', { name: t('upload.focus.openNamed', { name: 'whole.png' }), exact: true });
  const dialog = await focusRight(page, open, 'whole.png');
  await dialog.getByRole('button', { name: t('upload.focus.save') }).click();
  const reset = list.getByRole('button', { name: t('upload.focus.resetNamed', { name: 'whole.png' }) });
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(list.getByText(t('upload.focus.set'), { exact: false })).toHaveCount(0);
  // Escape closes only the focus dialog and keeps what was set.
  await open.click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: t('upload.focus.title') })).toBeHidden();
  await expect(upload).toBeVisible();
  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  await expect
    .poll(async () => (await photosOf(api, id)).map(({ width, height, focusX, focusY }) => ({ width, height, focusX, focusY })))
    .toEqual([{ width: 1600, height: 800, focusX: null, focusY: null }]);
  await shell.open(`#/?type=combinations&q=${uid}`);
  const cover = page.getByRole('img', { name: t('images.alt.tile', { title }) });
  await expect(cover).toBeVisible();
  expect(await objectPosition(cover)).toBe('50% 50%');
});

test('the uploader sets the focus from the photo menu; the cover moves and another device gets it after a refresh', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  browser,
  baseURL,
}, info) => {
  const title = `Refocus ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await api.uploadToCombination(id, { file: shelfPhoto('stored.png') });
  // Another device of the same account has the listing already.
  const other = await browser.newContext({ baseURL });
  await new Api(other.request).signIn(signedIn);
  const otherPage = await other.newPage();
  await otherPage.goto(`/#/?type=combinations&q=${uid}`);
  const otherCover = otherPage.getByRole('img', { name: t('images.alt.tile', { title }) });
  await expect(otherCover).toBeVisible();
  expect(await objectPosition(otherCover)).toBe('50% 50%');

  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const gallery = page.getByRole('main').getByRole('region', { name: t('images.gallery', { title }) });
  const menu = gallery.getByRole('button', { name: t('images.menu.label') });
  await menu.click();
  const dialog = await focusRight(page, page.getByRole('menuitem', { name: t('images.menu.focus') }), title);
  await page.screenshot({ path: info.outputPath('menu-focus-dialog.png') });
  await dialog.getByRole('button', { name: t('upload.focus.save') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: t('notices.photoFocusChanged') })).toBeVisible();
  await expect(menu).toBeFocused();
  await expect.poll(async () => (await photosOf(api, id)).map(({ focusX, focusY }) => [focusX, focusY])).toEqual([[100, 50]]);

  await shell.open(`#/?type=combinations&q=${uid}`);
  const cover = page.getByRole('img', { name: t('images.alt.tile', { title }) });
  await expect(cover).toBeVisible();
  expect(await objectPosition(cover)).toBe('100% 50%');

  await otherPage.reload();
  await expect.poll(() => objectPosition(otherCover)).toBe('100% 50%');
  await other.close();
});

test('another member has no Set focus, and sees the uploader’s focus after the next refresh', async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const title = `Watch focus ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP] });
  const photo = await author.uploadToCombination(id, { file: photoPng('shared.png', 480, 360) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const gallery = page.getByRole('main').getByRole('region', { name: t('images.gallery', { title }) });
  // Only Report: the one icon button, no menu and no focus.
  await expect(gallery.getByRole('button', { name: t('images.menu.report') })).toBeVisible();
  await expect(gallery.getByRole('button', { name: t('images.menu.label') })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: t('images.menu.focus') })).toHaveCount(0);
  await author.changeImageFocus(photo.id, 10, 90);
  await shell.open(`#/?type=combinations&q=${uid}`);
  const cover = page.getByRole('img', { name: t('images.alt.tile', { title }) });
  await expect(cover).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => objectPosition(cover)).toBe('10% 90%');
});

test('Studio sets the focus of its photos the same way before saving', async ({ page, shell, api, signedIn, uid, encoder }) => {
  void encoder;
  const title = `Studio focus ${uid}`;
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.title.fill(title);
  await studio.main
    .getByRole('button', { name: t('studio.addCustomStep') })
    .first()
    .click();
  await studio.main.getByLabel(t('studio.step.label')).fill('Bisque firing');
  await studio.main.getByLabel(t('upload.library')).setInputFiles(shelfPhoto('studio-shelf.png'));
  const list = studio.main.getByRole('list', { name: t('upload.list') });
  const open = list.getByRole('button', { name: t('upload.focus.openNamed', { name: 'studio-shelf.png' }), exact: true });
  const dialog = await focusRight(page, open, 'studio-shelf.png');
  await dialog.getByRole('button', { name: t('upload.focus.save') }).click();
  await expect(list.getByText(t('upload.focus.set'), { exact: false })).toBeVisible();
  await studio.publish();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const id = new URL(page.url()).hash.split('/')[2];
  await expect.poll(async () => (await photosOf(api, id)).map(({ focusX, focusY }) => [focusX, focusY])).toEqual([[100, 50]]);
});
