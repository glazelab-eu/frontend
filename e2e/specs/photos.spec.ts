import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP, PASSWORD, type Api } from '../support/api';
import { t } from '../support/i18n';
import { photoPng, png } from '../support/images';
import { AppShell } from '../support/pages/app-shell';
import { AuthDialog } from '../support/pages/auth';
import { ExplorePage } from '../support/pages/explore';
import { DIST } from '../support/paths';
import { expect, newAccount, test } from '../support/test';
import { startWebServer, type WebServer } from '../support/web-server';

test('a member uploads a finished-piece photo with a caption @smoke', async ({ page, shell, api, signedIn, uid, encoder }) => {
  const title = `Shino ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await upload.getByLabel(t('upload.library')).setInputFiles(png('bowl.png'));
  await upload.getByLabel(t('upload.kind')).selectOption({ label: t('images.kind.finished') });
  await upload.getByLabel(t('images.details.caption')).fill('Bowl, inside');
  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: t('notices.photosAdded', { count: 1 }) })).toBeVisible();
  await expect(page.getByRole('img', { name: t('images.alt.finished', { title }) })).toBeVisible();
  await expect(page.getByRole('main').getByText('Bowl, inside')).toBeVisible();
});

test('the uploader deletes a photo for everyone', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Shino ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await api.uploadToCombination(id, { file: png('tile.png') });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  await page.getByRole('button', { name: t('images.menu.label') }).click();
  await page.getByRole('menuitem', { name: t('images.menu.delete') }).click();
  // The deletion is held: while it runs, Escape and Cancel leave the dialog as it is.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/images/**', async (route) => {
    if (route.request().method() === 'DELETE') await held;
    await route.fallback();
  });
  const dialog = page.getByRole('dialog', { name: t('images.remove.action') });
  await dialog.getByRole('button', { name: t('images.remove.confirm') }).click();
  await expect(dialog.getByRole('button', { name: t('common.cancel') })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(page.getByRole('status').filter({ hasText: t('notices.photoDeleted') })).toBeVisible();
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toHaveCount(0);
  // The menu that opened the dialog went with the photo: the focus lands on the card, never on the page itself.
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true);
});

test('cards load the small card copy and the gallery the full size', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Celadon ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const photo = await api.uploadToCombination(id, { file: photoPng('celadon.png') });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  const bytes = (path: string) =>
    page.waitForResponse((response) => new URL(response.url()).pathname === path).then(async (response) => (await response.body()).length);
  const card = bytes(photo.cardUrl);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const explore = new ExplorePage(page);
  await expect(explore.cardTitles).toHaveText([title]);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  const cardBytes = await card;
  expect(cardBytes).toBeLessThan(80_000);
  expect(requested).not.toContain(photo.url);

  const full = bytes(photo.url);
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  expect(await full).toBeGreaterThan(cardBytes * 4);
});

test('photo additions share the recipe action group and are green only while there is no photo', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Buttons ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const tile = main.getByRole('button', { name: t('images.addTestTile') });
  const finished = main.getByRole('button', { name: t('images.addFinishedFor', { title }) });
  const heading = main.getByRole('heading', { level: 1, name: title });
  const fill = (button: Locator) => button.evaluate((element) => getComputedStyle(element).backgroundColor);
  const grouped = async (button: Locator) => {
    const group = main.getByRole('group', { name: t('combination.actions') });
    await expect(
      group.getByRole('button', { name: (await button.getAttribute('aria-label')) || (await button.innerText()).trim(), exact: true }),
    ).toBeVisible();
    expect((await button.boundingBox())!.y).toBeGreaterThan((await heading.boundingBox())!.y);
  };
  // No photo yet: the test tile button is the page's one primary button, and both stand next to the placeholder, away from the recipe.
  await expect(main.getByText(t('images.noPhoto'))).toBeVisible();
  await expect(tile).toBeVisible();
  await expect(finished).toBeVisible();
  expect(await fill(tile)).not.toBe(await fill(finished));
  await grouped(tile);
  await grouped(finished);
  // Adjacent (23-31): one row, or the second directly under the first where the width does not fit both.
  const [first, second] = [(await tile.boundingBox())!, (await finished.boundingBox())!];
  expect(Math.abs(first.y - second.y) < 2 || (second.y > first.y && second.y - (first.y + first.height) <= 16)).toBe(true);

  // With a photo both are outlined secondary buttons under the gallery, still above the recipe.
  await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360) });
  await page.reload();
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  await expect(tile).toBeVisible();
  expect(await fill(tile)).toBe(await fill(finished));
  await grouped(tile);
  await grouped(finished);
  expect((await tile.boundingBox())!.y).toBeGreaterThan((await page.getByRole('img', { name: t('images.alt.tile', { title }) }).boundingBox())!.y);
  await expect(main.getByRole('button', { name: t('images.addTestTile') })).toHaveCount(1);
});

test('another member gets the same outlined photo buttons and a guest none', async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const title = `Shared ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP] });
  await author.uploadToCombination(id, { file: photoPng('shared.png', 480, 360) });
  const main = page.getByRole('main');
  const tile = main.getByRole('button', { name: t('images.addTestTile') });
  const finished = main.getByRole('button', { name: t('images.addFinishedFor', { title }) });

  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  await expect(tile).toBeVisible();
  await expect(finished).toBeVisible();
  expect(await tile.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    await finished.evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  // The author's Edit is the author's.
  await expect(main.getByRole('link', { name: t('combination.edit'), exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: t('combination.delete.confirm') })).toHaveCount(0);

  await shell.signOut();
  await shell.expectGuest();
  await shell.open(`#/combinations/${id}`);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  await expect(tile).toHaveCount(0);
  await expect(finished).toHaveCount(0);
  await expect(main.getByRole('button', { name: t('share.action') })).toBeVisible();
  await expect(main.getByRole('link', { name: t('combination.recordVariation') })).toHaveCount(0);
});

test('the detail gallery shows the whole photo on a stage shaped like the tallest photo', async ({ page, shell, api, signedIn, uid }) => {
  const wide = await api.addCombination({ title: `Wide ${uid}`, steps: [BISQUE_STEP] });
  await api.uploadToCombination(wide, { file: photoPng('wide.png', 800, 600) });
  const tall = await api.addCombination({ title: `Tall ${uid}`, steps: [BISQUE_STEP] });
  await api.uploadToCombination(tall, { file: photoPng('tall.png', 600, 800) });
  const stage = async (id: string, title: string) => {
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const image = page.getByRole('img', { name: t('images.alt.tile', { title }) });
    await expect(image).toBeVisible();
    await expect(image).toHaveCSS('object-fit', 'contain');
    return (await image.boundingBox())!;
  };
  const wideBox = await stage(wide, `Wide ${uid}`);
  const tallBox = await stage(tall, `Tall ${uid}`);
  // Same width; the portrait stage is at least as tall as the landscape one and both stay within the stage's height cap
  // (`.picture-cover--stage`: min(30svh, 16rem) since the mobile refinements, 2026-11-03; on a phone both reach the cap, so the
  // portrait stage is no longer taller by a margin), and neither photo is cropped (`object-fit: contain` above).
  expect(Math.abs(wideBox.width - tallBox.width)).toBeLessThan(2);
  expect(tallBox.height).toBeGreaterThanOrEqual(wideBox.height - 1);
  expect(wideBox.width / wideBox.height).toBeGreaterThan(1.2);
  const viewport = page.viewportSize()!;
  const cap = Math.min(viewport.height * 0.3, 16 * 16);
  expect(tallBox.height).toBeLessThanOrEqual(Math.max(cap, viewport.height * 0.72) + 1);
  expect(wideBox.height).toBeLessThanOrEqual(Math.max(cap, viewport.height * 0.72) + 1);
});

test('the first photo keeps the focus on its photo button, which moved under the gallery', async ({ page, shell, api, signedIn, uid, encoder }) => {
  const title = `Focus ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const finished = main.getByRole('button', { name: t('images.addFinishedFor', { title }) });
  await finished.click();
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await upload.getByLabel(t('upload.library')).setInputFiles(png('bowl.png'));
  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  await expect(page.getByRole('img', { name: t('images.alt.finished', { title }) })).toBeVisible();
  // The placeholder's buttons left with it; the same button under the gallery takes the focus, not the page.
  await expect(finished).toBeFocused();
});

/** The gallery of a combination page: its thumbnail buttons by position and kind, the stage's key group, the menu and the live region. */
function galleryOf(page: Page, title: string) {
  const gallery = page.getByRole('main').getByRole('region', { name: t('images.gallery', { title }) });
  return {
    gallery,
    thumb: (current: number, total: number, kind: 'tile' | 'finished' | 'packaging' = 'tile') =>
      gallery.getByRole('button', { name: t('images.thumbnail', { current, total, kind: t(`images.kind.${kind}`) }) }),
    stage: gallery.getByRole('group', { name: t('images.galleryNavigation') }),
    line: gallery.locator('.picture-meta__line'),
    live: gallery.locator('[aria-live="polite"]'),
    strip: gallery.locator('.picture-strip__list'),
  };
}

test('thumbnails mark the shown photo, the keys and clicks move it, and one meta line names kind, uploader and firing', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Thumbs ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const file = (name: string) => photoPng(name, 480, 360);
  await api.uploadToCombination(id, { file: file('a.png'), kind: 'FINISHED', caption: 'Two coats', firedOn: '2026-10-18' });
  await api.uploadToCombination(id, { file: file('b.png'), kind: 'TEST_TILE' });
  await api.uploadToCombination(id, { file: file('c.png'), kind: 'TEST_TILE' });
  await api.uploadToCombination(id, { file: file('d.png'), kind: 'TEST_TILE' });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery, thumb, stage, line, live, strip } = galleryOf(page, title);
  await expect(page.getByRole('img', { name: t('images.alt.finished', { title }) }).first()).toBeVisible();

  // The dated finished piece, then the tiles newest first; the shown one is marked, the count sits at the right, the stage carries no badge.
  const kinds = ['finished', 'tile', 'tile', 'tile'] as const;
  for (const [index, kind] of kinds.entries()) await expect(thumb(index + 1, 4, kind)).toBeVisible();
  await expect(strip.getByRole('button')).toHaveCount(4);
  await expect(thumb(1, 4, 'finished')).toHaveAttribute('aria-current', 'true');
  await expect(gallery.locator('[aria-current]')).toHaveCount(1);
  await expect(gallery.getByText('1 / 4', { exact: true })).toBeVisible();
  await expect(page.locator('.picture-cover__badge')).toHaveCount(0);
  // No previous/next arrow buttons: the gallery's buttons are the thumbnails, the menu and the photo buttons.
  await expect(gallery.getByRole('button', { name: /previous|next/i })).toHaveCount(0);

  // The caption, then one line built from the kind, the uploader and the firing date, beside the menu.
  await expect(gallery.getByText('Two coats')).toBeVisible();
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')} · ${t('images.firedOn', { date: '18 Oct 2026' })}`);
  await expect(line).toHaveCount(1);
  const [stageBox, menuBox] = [(await stage.boundingBox())!, (await gallery.getByRole('button', { name: t('images.menu.label') }).boundingBox())!];
  expect(menuBox.x).toBeLessThan(stageBox.x + stageBox.width / 2);
  expect(menuBox.y).toBeLessThan(stageBox.y + stageBox.height / 2);
  if (page.viewportSize()!.width >= 720) expect((await line.boundingBox())!.height).toBeLessThan(24);
  // The line is a pill inside the stage's bottom-left corner, one line, and the caption stays whole under the stage.
  const lineBox = (await line.boundingBox())!;
  expect(lineBox.x).toBeGreaterThanOrEqual(stageBox.x);
  expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
  expect(lineBox.y).toBeGreaterThan(stageBox.y + stageBox.height / 2);
  expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height);
  await expect(line).toHaveAttribute('title', /.+/);
  const captionBox = (await gallery.getByText('Two coats').boundingBox())!;
  expect(captionBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 1);

  // 53 px squares (44 px touch targets met), one tab stop.
  const box = (await thumb(1, 4, 'finished').boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([53, 53]);
  await expect(thumb(2, 4)).toHaveAttribute('tabindex', '-1');
  await expect(thumb(1, 4, 'finished')).toHaveAttribute('tabindex', '0');

  // A click shows that photo: the marker, the count, the live region and the line follow, the stage scrolls to it.
  await thumb(3, 4).click();
  await expect(thumb(3, 4)).toHaveAttribute('aria-current', 'true');
  await expect(thumb(1, 4, 'finished')).not.toHaveAttribute('aria-current', 'true');
  await expect(gallery.getByText('3 / 4', { exact: true })).toBeVisible();
  await expect(live).toHaveText(t('images.position', { current: 3, total: 4 }));
  await expect(line).toHaveText(`${t('images.kind.tile')} · ${t('images.uploader.own')}`);
  await expect(gallery.getByText('Two coats')).toHaveCount(0);
  const viewport = stage;
  expect(await viewport.evaluate((element) => Math.round(element.scrollLeft / element.clientWidth))).toBe(2);

  // The stage's arrow keys still browse, Home and End too; the thumbnails follow.
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(thumb(4, 4)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Home');
  await expect(thumb(1, 4, 'finished')).toHaveAttribute('aria-current', 'true');
  // On a thumbnail the arrows move focus and the photo together, without a tab stop per photo.
  await thumb(1, 4, 'finished').focus();
  await page.keyboard.press('ArrowRight');
  await expect(thumb(2, 4)).toBeFocused();
  await expect(thumb(2, 4)).toHaveAttribute('aria-current', 'true');
  await expect(thumb(2, 4)).toHaveAttribute('tabindex', '0');
  const scrolled = await page.evaluate(() => scrollY);
  await page.keyboard.press('End');
  await expect(thumb(4, 4)).toBeFocused();
  await expect(line).toHaveText(`${t('images.kind.tile')} · ${t('images.uploader.own')}`);
  // Past either end the focus stays on the row, and Home/End never scroll the page.
  await page.keyboard.press('ArrowRight');
  await expect(thumb(4, 4)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(thumb(1, 4, 'finished')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(thumb(1, 4, 'finished')).toBeFocused();
  await expect(thumb(1, 4, 'finished')).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
});

test('when the photo of the focused thumbnail goes away elsewhere, the focus moves to the shown thumbnail, not the page', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Gone ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) ids.push((await api.uploadToCombination(id, { file: photoPng(`p${index}.png`, 240, 180) })).id);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { thumb } = galleryOf(page, title);
  await thumb(1, 3).focus();
  await page.keyboard.press('ArrowRight');
  await expect(thumb(2, 3)).toBeFocused();
  // Another device deletes the shown photo (the middle one: newest first); the next refresh drops it.
  await api.removeImage(ids[1]);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(thumb(2, 2)).toHaveAttribute('aria-current', 'true');
  await expect(thumb(2, 2)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(thumb(1, 2)).toBeFocused();
});

test('another member reports a photo from a button inside the picture, upper left, and the meta row has no menu', async ({
  page,
  shell,
  newApi,
  signedIn,
  uid,
}) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const title = `Report ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP] });
  await author.uploadToCombination(id, { file: photoPng('shared.png', 480, 360) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery } = galleryOf(page, title);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  const report = gallery.getByRole('button', { name: t('images.menu.report') });
  await expect(report).toBeVisible();
  await expect(gallery.getByRole('button', { name: t('images.menu.label') })).toHaveCount(0);

  // Inside the stage, in its upper-left corner, level with the expand hint, clear of it and of the badge, and big enough to touch.
  const stage = (await page.locator('.picture-carousel__stage').boundingBox())!;
  const box = (await report.boundingBox())!;
  const expand = (await page.locator('.picture-carousel__expand').boundingBox())!;
  // A decoration, no touch target: small on every pointer.
  expect(expand.width).toBeCloseTo(32, 0);
  expect(box.x).toBeGreaterThanOrEqual(stage.x);
  expect(box.y).toBeGreaterThanOrEqual(stage.y);
  expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width / 2);
  expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height / 2);
  expect(box.x + box.width).toBeLessThan(expand.x);
  expect(Math.abs(box.y - expand.y)).toBeLessThan(1);
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(touch ? 44 : 32);

  await report.click();
  const dialog = page.getByRole('dialog', { name: t('images.report.title') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: t('images.report.submit') }).click();
  await expect(dialog).toBeHidden();
});

/** The photo menu is a button in the stage's upper-left corner and its opened list lies wholly inside the window, clear of the expand hint. */
async function expectCornerMenu(page: Page, title: string, items: string[]) {
  const { gallery } = galleryOf(page, title);
  const button = gallery.getByRole('button', { name: t('images.menu.label') });
  await expect(button).toBeVisible();
  const stage = (await page.locator('.picture-carousel__stage').boundingBox())!;
  const box = (await button.boundingBox())!;
  const expand = (await page.locator('.picture-carousel__expand').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(stage.x);
  expect(box.y).toBeGreaterThanOrEqual(stage.y);
  expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width / 2);
  expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height / 2);
  expect(box.x + box.width).toBeLessThan(expand.x);
  expect(Math.abs(box.y - expand.y)).toBeLessThan(1);
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(touch ? 44 : 32);
  await button.click();
  const menu = page.getByRole('menu', { name: t('images.menu.label') });
  await expect(menu).toBeVisible();
  for (const item of items) await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
  const list = (await menu.boundingBox())!;
  const view = page.viewportSize()!;
  expect(list.x).toBeGreaterThanOrEqual(0);
  expect(list.y).toBeGreaterThanOrEqual(0);
  expect(list.x + list.width).toBeLessThanOrEqual(view.width);
  expect(list.y + list.height).toBeLessThanOrEqual(view.height);
  // Every entry is the top element at its own centre: nothing clips or covers the popup.
  for (const entry of await menu.getByRole('menuitem').all()) {
    const hit = await entry.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    });
    expect(hit).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
}

test("the uploader's photo menu is a button in the picture, upper left, and opens fully visible", async ({ page, shell, api, signedIn, uid }) => {
  const title = `Menu ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await api.uploadToCombination(id, { file: photoPng('own.png', 480, 360) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  await expectCornerMenu(page, title, [t('images.menu.details'), t('images.menu.kind'), t('images.menu.visibility'), t('images.menu.delete')]);
});

test("a club admin gets the menu with Delete and Report in the picture of a member's photo", async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { club, token } = await api.clubWithInvite(`Kiln ${uid}`);
  const cleo = await newApi();
  await cleo.signUp(newAccount(uid, 'Cleo'));
  await cleo.joinClub(token);
  const title = `Admin ${uid}`;
  const id = await cleo.addCombination({ title, steps: [BISQUE_STEP] });
  await cleo.uploadToCombination(id, { file: photoPng('club.png', 480, 360), visibility: 'CLUB', clubId: club.id });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  await expectCornerMenu(page, title, [t('images.menu.kind'), t('images.menu.delete'), t('images.menu.report')]);
});

test('another member sees who took the photo in the same line; one photo has no thumbnail row', async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const title = `Single ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP] });
  await author.uploadToCombination(id, { file: photoPng('shared.png', 480, 360), kind: 'FINISHED' });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery, line, live } = galleryOf(page, title);
  await expect(page.getByRole('img', { name: t('images.alt.finished', { title }) })).toBeVisible();
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader', { name: 'Cleo' })}`);
  await expect(gallery.getByRole('button', { name: /^Photo \d+ of \d+/ })).toHaveCount(0);
  await expect(gallery.getByText(/^\d+ \/ \d+$/)).toHaveCount(0);
  await expect(live).toHaveCount(0);
  await expect(page.locator('.picture-cover__badge')).toHaveCount(0);
  // No caption: the line is over the photo and no row is left under the stage.
  const stageBox = (await page.locator('.picture-carousel__stage').boundingBox())!;
  const lineBox = (await line.boundingBox())!;
  expect(lineBox.y).toBeGreaterThan(stageBox.y + stageBox.height / 2);
  expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height);
  await expect(page.locator('.picture-carousel__meta')).toHaveCount(0);
});

test('ten photos scroll sideways inside the thumbnail row without moving the page, and the shown thumbnail stays in view', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Many ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  for (let index = 0; index < 10; index++) await api.uploadToCombination(id, { file: photoPng(`p${index}.png`, 240, 180) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery, thumb, stage, strip } = galleryOf(page, title);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) }).first()).toBeVisible();
  await expect(strip.getByRole('button')).toHaveCount(10);
  expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await sideways()).toBe(true);
  // The row has a fixed height whatever loads: 53 px squares plus the focus ring's padding.
  expect(Math.round((await strip.boundingBox())!.height)).toBeLessThan(70);

  await stage.focus();
  const scrolled = await page.evaluate(() => scrollY);
  await page.keyboard.press('End');
  await expect(thumb(10, 10)).toHaveAttribute('aria-current', 'true');
  await expect(gallery.getByText('10 / 10', { exact: true })).toBeVisible();
  const [row, last] = [(await strip.boundingBox())!, (await thumb(10, 10).boundingBox())!];
  expect(last.x).toBeGreaterThanOrEqual(row.x - 1);
  expect(last.x + last.width).toBeLessThanOrEqual(row.x + row.width + 1);
  expect(await strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await sideways()).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
  await page.keyboard.press('Home');
  await expect(thumb(1, 10)).toHaveAttribute('aria-current', 'true');
  expect(await strip.evaluate((element) => element.scrollLeft)).toBe(0);
});

test('the photo pointer of an admin link selects its thumbnail', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Pointer ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const first = await api.uploadToCombination(id, { file: photoPng('a.png', 240, 180) });
  await api.uploadToCombination(id, { file: photoPng('b.png', 240, 180) });
  await api.uploadToCombination(id, { file: photoPng('c.png', 240, 180) });
  await shell.open(`#/combinations/${id}?photo=${first.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { thumb } = galleryOf(page, title);
  // The oldest upload sorts last (newest first without firing dates).
  await expect(thumb(3, 3)).toHaveAttribute('aria-current', 'true');
  await expect(thumb(1, 3)).not.toHaveAttribute('aria-current', 'true');
});

test('a photo that leaves PUBLIC gets a new ID and the gallery stays on its position, the focus on the menu button', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Hidden ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await api.uploadToCombination(id, { file: photoPng('a.png', 240, 180) });
  await api.uploadToCombination(id, { file: photoPng('b.png', 240, 180) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery, thumb } = galleryOf(page, title);
  await thumb(2, 2).click();
  await expect(thumb(2, 2)).toHaveAttribute('aria-current', 'true');
  const menu = gallery.getByRole('button', { name: t('images.menu.label') });
  await menu.click();
  await page.getByRole('menuitem', { name: t('images.menu.visibility') }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(t('images.visibility.label')).selectOption('PRIVATE');
  await dialog.getByRole('button', { name: t('images.visibility.save') }).click();
  await expect(dialog).toBeHidden();
  await expect(thumb(2, 2)).toHaveAttribute('aria-current', 'true');
  await expect(gallery.getByText('2 / 2', { exact: true })).toBeVisible();
  await expect(menu).toBeFocused();
});

/** The full-screen viewer of a gallery (`images/PhotoViewer`): its dialog, the shown photo's `<img>` and its parts. */
function viewerOf(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
  return {
    dialog,
    close: dialog.getByRole('button', { name: t('common.close') }),
    previous: dialog.getByRole('button', { name: t('images.viewer.previous') }),
    next: dialog.getByRole('button', { name: t('images.viewer.next') }),
    count: dialog.getByText(/^\d+ \/ \d+$/),
    live: dialog.locator('[aria-live="polite"]'),
    line: dialog.locator('.picture-meta__line'),
    /** The shown photo: the visible frame's image (the neighbours wait hidden). */
    shown: dialog.locator('.viewer__frame:not(.viewer__frame--hidden) img'),
  };
}

/** Three full-size (1200 x 900) photos on a combination, in upload order: a dated Finished piece (shown first), then two Test tiles. */
async function threePhotos(api: Api, title: string) {
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const first = await api.uploadToCombination(id, { file: photoPng('a.png', 1200, 900), kind: 'FINISHED', caption: 'Two coats', firedOn: '2026-10-18' });
  const second = await api.uploadToCombination(id, { file: photoPng('b.png', 1200, 900), kind: 'TEST_TILE' });
  const third = await api.uploadToCombination(id, { file: photoPng('c.png', 1200, 900), kind: 'TEST_TILE' });
  return { id, photos: [first, second, third] };
}

test('the stage opens the viewer with the full-size photo, by click and by key, and every way of closing returns the focus to the stage @smoke', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Viewer ${uid}`;
  const { id } = await threePhotos(api, title);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { stage } = galleryOf(page, title);
  const { dialog, close, shown, line } = viewerOf(page, title);
  await expect(stage).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // A click opens it on the shown photo, at its full size (the stage and the viewer load the 1200 px file, the card copy has 480).
  await stage.click();
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200);
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')} · ${t('images.firedOn', { date: '18 Oct 2026' })}`);
  await expect(dialog.getByText('Two coats')).toBeVisible();

  // Escape, the Close button and a click on the dark ground around the photo close it; the focus is back on the stage each time.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(stage).toBeFocused();
  await stage.press('Enter');
  await expect(dialog).toBeVisible();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(stage).toBeFocused();
  await stage.press(' ');
  await expect(dialog).toBeVisible();
  const box = (await shown.boundingBox())!;
  const drawn = await shown.evaluate((image: HTMLImageElement) => image.naturalWidth / image.naturalHeight);
  expect(box.width / box.height).not.toBeCloseTo(drawn, 1); // the photo is letterboxed, so the box has a corner of bare ground
  await page.mouse.click(box.x + 3, box.y + 3);
  await expect(dialog).toBeHidden();
  await expect(stage).toBeFocused();
  // A click on the photo itself keeps it open.
  await stage.click();
  const middle = (await shown.boundingBox())!;
  await page.mouse.click(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await expect(dialog).toBeVisible();
});

test('the viewer steps through the photos by button, key and wrap-around, keeps the stage, the thumbnails and the hash in step, and announces each photo', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Steps ${uid}`;
  const { id, photos } = await threePhotos(api, title);
  // The dated finished piece comes first, then the newer test tile, then the older one: the pointer selects the third photo.
  await shell.open(`#/combinations/${id}?photo=${photos[1].id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { stage, thumb, live: galleryLive } = galleryOf(page, title);
  await expect(thumb(3, 3)).toHaveAttribute('aria-current', 'true');
  const hash = new URL(page.url()).hash;
  const { dialog, previous, next, count, live, line, shown } = viewerOf(page, title);
  await stage.focus();
  await page.keyboard.press('Enter');
  await expect(count).toHaveText('3 / 3');
  await expect(line).toHaveText(`${t('images.kind.tile')} · ${t('images.uploader.own')}`);
  const srcOfShown = () => shown.evaluate((image: HTMLImageElement) => image.src);
  const third = await srcOfShown();

  // Next wraps to the first photo; previous wraps back. The live region names position and kind.
  await next.click();
  await expect(count).toHaveText('1 / 3');
  await expect(live).toHaveText(t('images.thumbnail', { current: 1, total: 3, kind: t('images.kind.finished') }));
  // The gallery's own live region behind the dialog (first in the gallery, the viewer's comes after it) stays silent: a step is announced once.
  await expect(galleryLive.first()).toHaveText('');
  expect(await srcOfShown()).not.toBe(third);
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')} · ${t('images.firedOn', { date: '18 Oct 2026' })}`);
  await expect(dialog.getByText('Two coats')).toBeVisible();
  await previous.click();
  await expect(count).toHaveText('3 / 3');
  expect(await srcOfShown()).toBe(third);
  await expect(dialog.getByText('Two coats')).toHaveCount(0);

  // The keys: arrows (wrapping), Home and End, from anywhere in the dialog.
  await page.keyboard.press('ArrowRight');
  await expect(count).toHaveText('1 / 3');
  await page.keyboard.press('ArrowLeft');
  await expect(count).toHaveText('3 / 3');
  await page.keyboard.press('Home');
  await expect(count).toHaveText('1 / 3');
  await page.keyboard.press('End');
  await expect(count).toHaveText('3 / 3');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(count).toHaveText('2 / 3');
  expect(new URL(page.url()).hash).toBe(hash);

  // Closing leaves the stage on the photo the viewer showed (not pulled back to the pointer's), the page where it was.
  const scrolled = await page.evaluate(() => scrollY);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(stage).toBeFocused();
  await expect(thumb(2, 3)).toHaveAttribute('aria-current', 'true');
  await expect(galleryLive).toHaveText(t('images.position', { current: 2, total: 3 }));
  expect(await stage.evaluate((element) => Math.round(element.scrollLeft / element.clientWidth))).toBe(1);
  expect(new URL(page.url()).hash).toBe(hash);
  expect(await page.evaluate(() => scrollY)).toBe(scrolled);

  // Opened again it shows the thumbnail's choice.
  await thumb(1, 3, 'finished').click();
  await stage.press('Enter');
  await expect(count).toHaveText('1 / 3');
});

test('a finished piece uploaded after a test tile leads the Explore card, the gallery, its thumbnails and the viewer; tiles alone keep their order', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Order ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360), kind: 'TEST_TILE', caption: 'Tile first' });
  await api.uploadToCombination(id, { file: photoPng('piece.png', 480, 360), kind: 'FINISHED', caption: 'Piece later' });
  const tiles = `Tiles ${uid}`;
  const tilesId = await api.addCombination({ title: tiles, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await api.uploadToCombination(tilesId, { file: photoPng('t1.png', 480, 360), kind: 'TEST_TILE', caption: 'Older tile' });
  await api.uploadToCombination(tilesId, { file: photoPng('t2.png', 480, 360), kind: 'TEST_TILE', caption: 'Newer tile' });
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);

  // Explore: the cover is the finished piece, the one thumbnail the tile; the card viewer starts on the piece.
  const explore = new ExplorePage(page);
  const card = explore.card(title);
  const viewer = viewerOf(page, title);
  await expect(card.getByRole('button', { name: t('images.thumbnail.open', { current: 2, total: 2, title }) })).toBeVisible();
  await card.getByRole('button', { name: t('images.cover.open', { title }) }).click();
  await expect(viewer.count).toHaveText('1 / 2');
  await expect(viewer.dialog.getByText('Piece later')).toBeVisible();
  await expect(viewer.line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')}`);
  await page.keyboard.press('ArrowRight');
  await expect(viewer.dialog.getByText('Tile first')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer.dialog).toBeHidden();
  // Only test tiles: newest upload first, as before.
  await explore
    .card(tiles)
    .getByRole('button', { name: t('images.cover.open', { title: tiles }) })
    .click();
  await expect(viewerOf(page, tiles).dialog.getByText('Newer tile')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewerOf(page, tiles).dialog).toBeHidden();

  // The combination page: the stage, the thumbnail row and the viewer agree.
  await shell.open(`#/combinations/${id}`);
  const { gallery, thumb, stage, line } = galleryOf(page, title);
  await expect(thumb(1, 2, 'finished')).toHaveAttribute('aria-current', 'true');
  await expect(thumb(2, 2, 'tile')).toBeVisible();
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')}`);
  await expect(gallery.getByText('Piece later')).toBeVisible();
  await stage.press('Enter');
  await expect(viewer.count).toHaveText('1 / 2');
  await expect(viewer.dialog.getByText('Piece later')).toBeVisible();
  await page.keyboard.press('End');
  await expect(viewer.count).toHaveText('2 / 2');
  await expect(viewer.dialog.getByText('Tile first')).toBeVisible();
});

test('a photo list that changes while the viewer is open keeps it on a valid photo and closes it when no photo is left', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Shrinks ${uid}`;
  const { id, photos } = await threePhotos(api, title);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { stage, thumb } = galleryOf(page, title);
  const { dialog, count, live, shown } = viewerOf(page, title);
  await stage.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await expect(count).toHaveText('3 / 3');

  // The shown (last) photo is deleted on another device: the viewer stays open on a neighbour and the count follows.
  await api.removeImage(photos[0].id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(count).toHaveText('2 / 2');
  await expect(live).toHaveText(t('images.thumbnail', { current: 2, total: 2, kind: t('images.kind.tile') }));
  await expect(shown).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(count).toHaveText('1 / 2');

  // Down to one photo the buttons and the count go; the viewer shows that photo.
  await api.removeImage(photos[1].id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(count).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: t('images.viewer.next') })).toHaveCount(0);
  await expect(shown).toBeVisible();

  // The last one: the viewer closes by itself.
  await api.removeImage(photos[2].id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(dialog).toBeHidden();
  await expect(thumb(1, 1)).toHaveCount(0);
  // A photo added later does not bring it back.
  await api.uploadToCombination(id, { file: photoPng('new.png', 600, 450) });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('one photo opens in the viewer without previous, next or count', async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const title = `Alone ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP] });
  await author.uploadToCombination(id, { file: photoPng('shared.png', 1200, 900), kind: 'FINISHED' });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery } = galleryOf(page, title);
  const stage = gallery.getByRole('group', { name: t('images.viewer.open') });
  await expect(stage).toHaveAttribute('tabindex', '0');
  await stage.focus();
  await page.keyboard.press('Enter');
  const { dialog, previous, next, count, live, line, shown, close } = viewerOf(page, title);
  await expect(shown).toBeVisible();
  await expect(previous).toHaveCount(0);
  await expect(next).toHaveCount(0);
  await expect(count).toHaveCount(0);
  await expect(live).toHaveCount(0);
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader', { name: 'Cleo' })}`);
  // The arrow keys do nothing; Tab stays on Close.
  await page.keyboard.press('ArrowRight');
  await expect(shown).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(stage).toBeFocused();
});

/** Whether the current history entry is a viewer entry, and how many entries the tab has. */
const historyOf = (page: Page) => page.evaluate(() => ({ viewer: !!history.state?.glazelabViewer, length: history.length }));

test('browser Back closes the viewer and stays on the page, and Escape, Close and the ground leave no extra entry behind', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Entries ${uid}`;
  const { id } = await threePhotos(api, title);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const hash = `#/combinations/${id}`;
  await page.evaluate((next) => (location.hash = next), hash);
  const { stage } = galleryOf(page, title);
  const { dialog, close, shown } = viewerOf(page, title);
  await expect(stage).toBeVisible();
  const before = await historyOf(page);
  expect(before.viewer).toBe(false);

  // The viewer is one entry with the page's own URL.
  await stage.click();
  await expect(shown).toBeVisible();
  await expect.poll(() => historyOf(page)).toEqual({ viewer: true, length: before.length + 1 });
  expect(new URL(page.url()).hash).toBe(hash);

  // Browser Back closes it and the page stays (the Android Back button's way too).
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(new URL(page.url()).hash).toBe(hash);
  await expect(stage).toBeFocused();
  expect((await historyOf(page)).viewer).toBe(false);
  // Forward reaches the closed entry, which is stepped over: nothing opens and the page does not change.
  await page.goForward();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await historyOf(page)).viewer).toBe(false);
  expect(new URL(page.url()).hash).toBe(hash);

  // Escape, Close and a click on the ground pop the entry again: one Back then leaves the page, no entry of the viewer is in the way.
  for (const way of ['escape', 'close', 'ground'] as const) {
    await stage.press('Enter');
    await expect(shown).toBeVisible();
    await expect.poll(async () => (await historyOf(page)).viewer).toBe(true);
    if (way === 'escape') await page.keyboard.press('Escape');
    else if (way === 'close') await close.click();
    else {
      const box = (await shown.boundingBox())!;
      await page.mouse.click(box.x + 3, box.y + 3);
    }
    await expect(dialog).toBeHidden();
    await expect(stage).toBeFocused();
    await expect.poll(async () => (await historyOf(page)).viewer).toBe(false);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/stock');
    await expect(stage).toHaveCount(0);
    await page.goForward();
    await expect(stage).toBeVisible();
    expect(new URL(page.url()).hash).toBe(hash);
  }

  // Stepping through the photos pushes nothing.
  await stage.press('Enter');
  await expect(shown).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await expect.poll(() => historyOf(page)).toEqual({ viewer: true, length: before.length + 1 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A reload with the viewer open comes back to the page itself: its entry is stepped over, so Back still leaves the page.
  await stage.press('Enter');
  await expect(shown).toBeVisible();
  await expect.poll(async () => (await historyOf(page)).viewer).toBe(true);
  await page.reload();
  await expect(stage).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await historyOf(page)).viewer).toBe(false);
  expect(new URL(page.url()).hash).toBe(hash);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/stock');
});

test("the app's Back link, a route change, an emptied list and a session end leave no viewer entry to land on", async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  // About 20 s alone, a long walk of the viewer's history: twice that leaves room for a loaded host (E2E-similar-2).
  test.setTimeout(60_000);
  const title = `Leaves ${uid}`;
  const { id, photos } = await threePhotos(api, title);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const hash = `#/combinations/${id}`;
  await page.evaluate((next) => (location.hash = next), hash);
  const { stage } = galleryOf(page, title);
  const { dialog, shown } = viewerOf(page, title);
  const open = async () => {
    await stage.press('Enter');
    await expect(shown).toBeVisible();
    await expect.poll(async () => (await historyOf(page)).viewer).toBe(true);
  };

  // The app's Back link after a viewer visit goes to the page before, not to a viewer entry.
  await open();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.locator('.back-link').click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/stock');
  await page.goForward();
  await expect(stage).toBeVisible();

  // An address-bar change while the viewer is open closes it; the way back steps over its entry to the page.
  await open();
  await page.evaluate(() => (location.hash = '#/clubs'));
  await expect(dialog).toBeHidden();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/clubs');
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe(hash);
  await expect(stage).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await historyOf(page)).viewer).toBe(false);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/stock');
  await page.goForward();
  await expect(stage).toBeVisible();

  // The list shrinking to nothing closes the viewer with the whole gallery: no entry stays.
  await open();
  for (const photo of photos) await api.removeImage(photo.id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(dialog).toBeHidden();
  await expect(stage).toHaveCount(0);
  await expect.poll(async () => (await historyOf(page)).viewer).toBe(false);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/stock');

  // The session ended elsewhere while the viewer was open: the account change closes it and pops its entry.
  const second = `Session ${uid}`;
  const next = await threePhotos(api, second);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate((to) => (location.hash = to), `#/combinations/${next.id}`);
  const secondGallery = galleryOf(page, second);
  await secondGallery.stage.press('Enter');
  const secondViewer = viewerOf(page, second);
  await expect(secondViewer.shown).toBeVisible();
  await expect.poll(async () => (await historyOf(page)).viewer).toBe(true);
  const other = await newApi();
  await other.signIn(signedIn);
  await other.changePassword(PASSWORD, 'a fresh coat of celadon');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(secondViewer.dialog).toBeHidden();
  await expect.poll(async () => (await historyOf(page)).viewer).toBe(false);
  await expect(new AuthDialog(page).dialog).toBeVisible();
});

test('the stage has a button for assistive technology, outside the tab order', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Button ${uid}`;
  const { id } = await threePhotos(api, title);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery, stage } = galleryOf(page, title);
  const button = gallery.getByRole('button', { name: t('images.viewer.open') });
  await expect(button).toHaveAttribute('tabindex', '-1');
  // Tab leaves the stage for the thumbnails without stopping on the button.
  await stage.focus();
  await page.keyboard.press('Tab');
  await expect(button).not.toBeFocused();
  // A click on it (a screen reader's activation) opens the viewer, and closing returns to the stage.
  await button.dispatchEvent('click');
  const { dialog } = viewerOf(page, title);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(stage).toBeFocused();
});

test('a photo that is gone says it is unavailable, not unavailable offline, in the stage and in the viewer', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Gone ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const photo = await api.uploadToCombination(id, { file: photoPng('gone.png', 1200, 900), kind: 'FINISHED' });
  await page.route(`**${photo.url}`, (route) => route.fulfill({ status: 404, body: '{"error":"Not found"}', contentType: 'application/json' }));
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery } = galleryOf(page, title);
  const stage = gallery.getByRole('group', { name: t('images.viewer.open') });
  await expect(gallery.getByText(t('images.unavailable'))).toBeVisible();
  await stage.focus();
  await page.keyboard.press('Enter');
  const { dialog } = viewerOf(page, title);
  await expect(dialog.getByText(t('images.unavailable'))).toBeVisible();
  await expect(page.getByText(t('images.unavailableOffline'))).toHaveCount(0);
});

test('on a phone on its side the photo gets the height of the screen and the text moves beside it', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Landscape ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  for (const kind of ['TEST_TILE', 'FINISHED'] as const) {
    await api.uploadToCombination(id, {
      file: photoPng('side.png', 1200, 900),
      kind,
      caption: 'Two coats of celadon, fired slowly to cone 6.',
      firedOn: '2026-10-18',
    });
  }
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page.setViewportSize({ width: 844, height: 390 });
  const { stage } = galleryOf(page, title);
  await stage.scrollIntoViewIfNeeded();
  await stage.focus();
  await page.keyboard.press('Enter');
  const { dialog, shown, close, line, next } = viewerOf(page, title);
  await expect(shown).toBeVisible();
  await expect(line).toBeVisible();
  await expect(dialog.getByText('Two coats of celadon, fired slowly to cone 6.')).toBeVisible();
  await expect.poll(async () => (await shown.boundingBox())!.height).toBeGreaterThanOrEqual(380);
  const photo = (await shown.boundingBox())!;
  const text = (await line.boundingBox())!;
  const closeBox = (await close.boundingBox())!;
  // The text sits beside the photo, inside the screen, and Close does not lie over the photo or the text.
  expect(text.x).toBeGreaterThanOrEqual(photo.x + photo.width - 1);
  expect(text.x + text.width).toBeLessThanOrEqual(844);
  expect(closeBox.x).toBeGreaterThanOrEqual(photo.x + photo.width - 1);
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(text.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(next).toBeVisible();
  // In portrait the text is below the photo again.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const [lineBox, photoBox] = [await line.boundingBox(), await shown.boundingBox()];
      return lineBox!.y >= photoBox!.y + photoBox!.height - 1;
    })
    .toBe(true);
});

test('the viewer meets the touch size, shifts nothing, blocks no browser zoom and has no motion with reduced motion', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const title = `Sizes ${uid}`;
  const { id } = await threePhotos(api, title);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { stage } = galleryOf(page, title);
  const { dialog, close, previous, next, shown } = viewerOf(page, title);
  await expect(page.getByRole('img', { name: t('images.alt.finished', { title }) }).first()).toBeVisible();
  const before = { stage: await stage.boundingBox(), scroll: await page.evaluate(() => [scrollX, scrollY, document.documentElement.scrollHeight]) };
  await stage.click();
  await expect(shown).toBeVisible();

  // 44 px (the viewer's controls are 44 and 48 px for every pointer) and they lie inside the screen.
  const viewport = page.viewportSize()!;
  for (const control of [close, previous, next]) {
    const box = (await control.boundingBox())!;
    expect(box.width, (await control.getAttribute('aria-label')) ?? '').toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
  // The dialog fills the screen and the photo is large: at least half the screen's shorter side.
  const dialogBox = (await dialog.boundingBox())!;
  expect([dialogBox.width, dialogBox.height]).toEqual([viewport.width, viewport.height]);
  const photoBox = (await shown.boundingBox())!;
  expect(Math.max(photoBox.width, photoBox.height)).toBeGreaterThan(Math.min(viewport.width, viewport.height) * 0.5);
  // The page behind is not moved by opening, and nothing between the photo and the document turns off the browser's pinch zoom.
  expect(await page.evaluate(() => [scrollX, scrollY, document.documentElement.scrollHeight])).toEqual(before.scroll);
  const touchActions = await shown.evaluate((image) => {
    const actions: string[] = [];
    for (let element: Element | null = image; element; element = element.parentElement) actions.push(getComputedStyle(element).touchAction);
    return actions;
  });
  expect(touchActions.filter((action) => action !== 'auto')).toEqual([]);
  // Reduced motion: nothing in the dialog animates or transitions.
  expect(await dialog.evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0);
  expect(
    await dialog.evaluate((element) =>
      [element, ...element.querySelectorAll('*')].every((each) => parseFloat(getComputedStyle(each).transitionDuration) <= 0.001),
    ),
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const after = await stage.boundingBox();
  expect(after).toEqual(before.stage);
  expect(await page.evaluate(() => [scrollX, scrollY, document.documentElement.scrollHeight])).toEqual(before.scroll);
});

test('a swipe on the photo steps through the viewer, a vertical drag or a pinch does not', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'a swipe needs a touch screen');
  const title = `Swipe ${uid}`;
  const { id } = await threePhotos(api, title);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { stage } = galleryOf(page, title);
  const { count, shown } = viewerOf(page, title);
  await stage.focus();
  await page.keyboard.press('Enter');
  await expect(count).toHaveText('1 / 3');
  const box = (await shown.boundingBox())!;
  // Above the middle, clear of the round buttons at the sides.
  const [y, left, right] = [box.y + box.height * 0.25, box.x + 20, box.x + box.width - 20];
  const client = await page.context().newCDPSession(page);
  const touch = async (points: { x: number; y: number }[][]) => {
    // Each entry is the finger positions at one moment; the first starts the gesture, the last lifts all fingers.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points[0] });
    for (const moved of points.slice(1)) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: moved });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await touch([[{ x: right, y }], [{ x: (left + right) / 2, y }], [{ x: left, y: y + 4 }]]);
  await expect(count).toHaveText('2 / 3');
  await touch([[{ x: left, y }], [{ x: (left + right) / 2, y }], [{ x: right, y }]]);
  await expect(count).toHaveText('1 / 3');
  // Mostly vertical, too short and two fingers: no step.
  await touch([[{ x: right, y: y - 100 }], [{ x: right - 30, y: y }], [{ x: right - 70, y: y + 100 }]]);
  await touch([[{ x: right, y }], [{ x: right - 20, y }]]);
  // A pinch: the second finger lands (a touch start of its own), both move far sideways, both lift.
  const [one, two] = [
    { x: right, y },
    { x: left, y },
  ];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one, two] });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: right - 150, y },
      { x: left + 150, y },
    ],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // A page the browser has zoomed in pans with a swipe: no step either.
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(2);
  await touch([[{ x: right, y }], [{ x: (left + right) / 2, y }], [{ x: left, y }]]);
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.waitForTimeout(300);
  await expect(count).toHaveText('1 / 3');
  // Back at the normal scale a swipe steps again.
  await touch([[{ x: right, y }], [{ x: (left + right) / 2, y }], [{ x: left, y }]]);
  await expect(count).toHaveText('2 / 3');
});

// A server of its own that counts the API requests reaching it, and the service worker allowed, so its precache is in play.
const cached = test.extend<{ server: WebServer & { hits: (path: string) => number } }>({
  server: async ({}, use) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const paths: string[] = [];
    const server = await startWebServer({ dist: DIST, apiUrl, onApiRequest: (path) => paths.push(path) });
    await use({ ...server, hits: (path) => paths.filter((each) => each === path).length });
    await server.close();
  },
});
cached.use({ serviceWorkers: 'allow' });

cached(
  'the browser keeps a club photo for later views and drops it at sign-out, keeping the app storage',
  async ({ page, context, server, isMobile, newApi, api, signedIn, uid }) => {
    const cleo = await newApi();
    await cleo.signUp(newAccount(uid, 'Cleo'));
    const { club, token } = await cleo.clubWithInvite(`Kiln ${uid}`);
    await api.joinClub(token);
    const title = `Club tile ${uid}`;
    const id = await cleo.addCombination({ title, steps: [BISQUE_STEP] });
    const photo = await cleo.uploadToCombination(id, { file: photoPng('club.png'), visibility: 'CLUB', clubId: club.id });
    const tile = (on: Page) => on.getByRole('img', { name: t('images.alt.tile', { title }) }).first();
    const open = async (on: Page, hash: string) => {
      await on.goto(`${server.url}/${hash}`);
      await expect(tile(on)).toBeVisible();
    };
    const explore = `#/?type=combinations&q=${uid}`;
    const detail = `#/combinations/${id}`;

    // First views: Explore loads the card size, the combination page the full size.
    await open(page, explore);
    await new AppShell(page, isMobile).expectSignedIn(signedIn.displayName);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await open(page, detail);
    const card = server.hits(photo.cardUrl);
    const full = server.hits(photo.url);
    expect(card).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0);

    // Later views in the same browser (a reload, another tab) come from its HTTP cache: no request reaches the API.
    await page.reload();
    await expect(tile(page)).toBeVisible();
    await open(page, explore);
    const other = await context.newPage();
    await open(other, detail);
    await open(other, explore);
    await other.close();
    expect([server.hits(photo.cardUrl), server.hits(photo.url)]).toEqual([card, full]);

    // Sign-out clears the HTTP cache ("cache" only): the app's storage, the service worker and its precache stay.
    const storage = () =>
      page.evaluate(async () => ({
        precache: (await caches.keys()).filter((name) => name.startsWith('workbox-precache')),
        databases: (await indexedDB.databases()).map((database) => database.name).filter((name) => name === 'glazelab-offline'),
        probe: localStorage.getItem('e2e-30-1-probe'),
        worker: !!navigator.serviceWorker.controller,
      }));
    await page.evaluate(() => localStorage.setItem('e2e-30-1-probe', 'kept'));
    const before = await storage();
    expect(before.precache).toHaveLength(1);
    expect(before).toMatchObject({ databases: ['glazelab-offline'], probe: 'kept', worker: true });
    await open(page, detail);
    const shell = new AppShell(page, isMobile);
    // The sign-out answer carries no header; the cache clearing the app sends after it does (LOGOUT-2). Awaited here so the fresh tab
    // below is deterministic; the app itself never waits for it.
    const signedOut = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/logout');
    const cleared = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/clear-cache');
    await shell.signOut();
    expect((await (await signedOut).allHeaders())['clear-site-data']).toBeUndefined();
    expect((await (await cleared).allHeaders())['clear-site-data']).toBe('"cache"');
    await shell.expectGuest();
    expect(await storage()).toEqual(before);
    await page.evaluate(() => localStorage.removeItem('e2e-30-1-probe'));

    // Signed in again as the same account, the photo is downloaded afresh in a new tab: the HTTP cache lost it. (Chromium
    // lets the tab that signed out keep using its in-memory copies until it closes, even across a reload: not asserted.)
    await shell.signInButton().click();
    await new AuthDialog(page).signIn(signedIn);
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('button', { name: t('images.cover.open', { title }) })
      .first()
      .scrollIntoViewIfNeeded();
    await expect(tile(page)).toBeVisible();
    const fresh = await context.newPage();
    await open(fresh, detail);
    await open(fresh, explore);
    await expect.poll(() => [server.hits(photo.cardUrl), server.hits(photo.url)]).toEqual([card + 1, full + 1]);
  },
);

cached(
  'a session that the server ended clears the browser photo cache too: a new tab requests the club photo again after signing in',
  async ({ page, context, server, isMobile, newApi, api, signedIn, uid }) => {
    const cleo = await newApi();
    await cleo.signUp(newAccount(uid, 'Cleo'));
    const { club, token } = await cleo.clubWithInvite(`Kiln ${uid}`);
    await api.joinClub(token);
    const title = `Ended tile ${uid}`;
    const id = await cleo.addCombination({ title, steps: [BISQUE_STEP] });
    const photo = await cleo.uploadToCombination(id, { file: photoPng('club.png'), visibility: 'CLUB', clubId: club.id });
    const tile = (on: Page) => on.getByRole('img', { name: t('images.alt.tile', { title }) }).first();
    const open = async (on: Page, hash: string) => {
      await on.goto(`${server.url}/${hash}`);
      await expect(tile(on)).toBeVisible();
    };
    const explore = `#/?type=combinations&q=${uid}`;
    const detail = `#/combinations/${id}`;
    await open(page, explore);
    const shell = new AppShell(page, isMobile);
    await shell.expectSignedIn(signedIn.displayName);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await open(page, detail);
    const card = server.hits(photo.cardUrl);
    const full = server.hits(photo.url);
    const other = await context.newPage();
    await open(other, detail);
    await open(other, explore);
    await other.close();
    expect([server.hits(photo.cardUrl), server.hits(photo.url)]).toEqual([card, full]);

    // The password changes on another device: the app finds its session dead, still logs it out and then asks for the cache clearing.
    const elsewhere = await newApi();
    await elsewhere.signIn(signedIn);
    await elsewhere.changePassword(PASSWORD, 'a fresh coat of celadon');
    const cleared = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/clear-cache');
    await page.reload();
    expect((await (await cleared).allHeaders())['clear-site-data']).toBe('"cache"');
    const auth = new AuthDialog(page);
    // A remembered session the server never confirmed in this run ends silently, as a guest.
    await shell.expectGuest();
    await shell.signInButton().click();
    await auth.signIn({ ...signedIn, password: 'a fresh coat of celadon' });
    await shell.expectSignedIn(signedIn.displayName);

    const fresh = await context.newPage();
    await open(fresh, detail);
    await open(fresh, explore);
    await expect.poll(() => [server.hits(photo.cardUrl), server.hits(photo.url)]).toEqual([card + 1, full + 1]);
  },
);

cached('the viewer opens and steps while offline from the saved photos', async ({ page, context, server, isMobile, api, signedIn, uid }) => {
  const title = `Offline viewer ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const photos = [
    await api.uploadToCombination(id, { file: photoPng('a.png', 1200, 900), kind: 'TEST_TILE' }),
    await api.uploadToCombination(id, { file: photoPng('b.png', 1200, 900), kind: 'FINISHED' }),
  ];
  await page.goto(`${server.url}/#/combinations/${id}`);
  await new AppShell(page, isMobile).expectSignedIn(signedIn.displayName);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // Both full sizes are in the app's image cache once the viewer has shown them (the neighbour is loaded ahead).
  const { stage } = galleryOf(page, title);
  await stage.press('Enter');
  const { dialog, count, shown, next } = viewerOf(page, title);
  await expect(shown).toBeVisible();
  await next.click();
  await expect(shown).toBeVisible();
  await page.keyboard.press('Escape');
  const saved = (url: string) =>
    page.evaluate(async (path) => {
      for (const name of await caches.keys()) if (await (await caches.open(name)).match(path)) return true;
      return false;
    }, url);
  await expect.poll(async () => [await saved(photos[0].url), await saved(photos[1].url)]).toEqual([true, true]);

  // Offline and reloaded: nothing reaches the server, yet the viewer shows the saved full-size photos.
  await context.setOffline(true);
  await page.reload();
  await expect(
    page
      .getByRole('img', { name: t('images.alt.finished', { title }) })
      .or(page.getByRole('img', { name: t('images.alt.tile', { title }) }))
      .first(),
  ).toBeVisible();
  await stage.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200);
  await next.click();
  await expect(count).toHaveText(/^\d \/ 2$/);
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200);
  await page.keyboard.press('Escape');
  await expect(stage).toBeFocused();
  await context.setOffline(false);
});
