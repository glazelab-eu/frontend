import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP, type Api } from '../support/api';
import { t } from '../support/i18n';
import { photoPng, png } from '../support/images';
import { ExplorePage } from '../support/pages/explore';
import { expect, test } from '../support/test';

// 24-13: the cover and the thumbnails of a list card (Explore, favourites, the club page, the glaze page's combinations)
// and the thumbnail of a glaze row open the full-screen viewer over all the card's photos.

/** The full-screen viewer (`images/PhotoViewer`) of a card: its dialog and parts. */
function viewerOf(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
  return {
    dialog,
    close: dialog.getByRole('button', { name: t('common.close') }),
    next: dialog.getByRole('button', { name: t('images.viewer.next') }),
    previous: dialog.getByRole('button', { name: t('images.viewer.previous') }),
    count: dialog.getByText(/^\d+ \/ \d+$/),
    open: dialog.getByRole('link', { name: t('images.viewer.openItemFor', { title }) }),
    shown: dialog.locator('.viewer__frame:not(.viewer__frame--hidden) img'),
    /** The caption of the shown photo. */
    caption: dialog.locator('.picture-meta__caption'),
  };
}

/** Five photos with captions c1..c5; in the card's order: three finished pieces by firing date (the first is the cover), then the two tiles. */
async function fivePhotos(api: Api, title: string, size: [number, number] = [64, 48]) {
  const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
  const photos = [];
  const specs: Array<[string, 'TEST_TILE' | 'FINISHED', string]> = [
    ['c5', 'TEST_TILE', '2026-04-15'],
    ['c3', 'FINISHED', '2026-04-01'],
    ['c1', 'FINISHED', '2026-05-03'],
    ['c4', 'TEST_TILE', '2026-05-01'],
    ['c2', 'FINISHED', '2026-05-02'],
  ];
  for (const [caption, kind, firedOn] of specs) {
    const file = size[0] > 100 ? photoPng(`${caption}.png`, size[0], size[1]) : png(`${caption}.png`);
    photos.push(await api.uploadToCombination(id, { file, kind, caption, firedOn }));
  }
  return { id, photos };
}

const cardOf = (page: Page, title: string) => new ExplorePage(page).card(title);
const coverOf = (card: Locator, title: string) => card.getByRole('button', { name: t('images.cover.open', { title }) });
const thumbnailOf = (card: Locator, position: number, total: number, title: string) =>
  card.getByRole('button', { name: t('images.thumbnail.open', { current: position, total, title }) });

/** Filler cards, so the list scrolls on every screen. */
async function fillerCards(api: Api, uid: string, count = 4) {
  for (let index = 0; index < count; index++) await api.addCombination({ title: `Filler ${index} ${uid}`, steps: [BISQUE_STEP], tags: ['cone-6'] });
}

test('a cover opens the viewer over all the card photos, the keys and buttons step and wrap, and Escape returns to the cover on the same scroll position @smoke', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Cover ${uid}`;
  await fivePhotos(api, title);
  await fillerCards(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  const cover = coverOf(card, title);
  const { dialog, close, next, previous, count, shown, caption, open } = viewerOf(page, title);
  await expect(cover).toBeVisible();
  // The card shows the cover and three thumbnails; the viewer has all five.
  await expect(card.getByRole('list', { name: t('images.morePhotos') }).getByRole('listitem')).toHaveCount(3);
  await cover.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 40));
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  await cover.click();
  await expect(dialog).toBeVisible();
  await expect(count).toHaveText('1 / 5');
  await expect(caption).toHaveText('c1');
  await expect(shown).toBeVisible();
  await expect(open).toBeVisible();
  // The viewer covers the whole screen: the sticky header and the phone's bottom navigation are below it.
  const covered = await page.evaluate(() => {
    const under = (x: number, y: number) => !!document.elementFromPoint(x, y)?.closest('.modal--viewer');
    return [under(5, 5), under(window.innerWidth / 2, 20), under(window.innerWidth / 2, window.innerHeight - 5)];
  });
  expect(covered).toEqual([true, true, true]);

  // Next and previous wrap, the keys work wherever the focus is, and a step shows the next photo of the card.
  await next.click();
  await expect(caption).toHaveText('c2');
  await page.keyboard.press('ArrowRight');
  await expect(caption).toHaveText('c3');
  await page.keyboard.press('End');
  await expect(caption).toHaveText('c5');
  await next.click();
  await expect(count).toHaveText('1 / 5');
  await previous.click();
  await expect(count).toHaveText('5 / 5');
  await expect(dialog.locator('[aria-live="polite"]')).toHaveText(t('images.thumbnail', { current: 5, total: 5, kind: t('images.kind.tile') }));

  // Escape: back on the cover that opened it, the list where it was.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(cover).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolled)).toBeLessThanOrEqual(2);
  // Enter opens it again (a real button), and Close returns the same way.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(cover).toBeFocused();
});

test('a thumbnail opens the viewer on its photo and Escape returns to that thumbnail; every control is a real button of at least 44 px', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Thumb ${uid}`;
  await fivePhotos(api, title);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  const { dialog, count, caption } = viewerOf(page, title);
  const second = thumbnailOf(card, 2, 5, title);
  const fourth = thumbnailOf(card, 4, 5, title);
  await expect(second).toBeVisible();
  await expect(card.getByRole('button', { name: /^View photo \d+ of/ })).toHaveCount(3);
  for (const control of [second, fourth, coverOf(card, title)]) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await fourth.click();
  await expect(count).toHaveText('4 / 5');
  await expect(caption).toHaveText('c4');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(fourth).toBeFocused();
  await second.focus();
  await page.keyboard.press(' ');
  await expect(count).toHaveText('2 / 5');
  await expect(caption).toHaveText('c2');
  await page.keyboard.press('Escape');
  await expect(second).toBeFocused();
});

test("a card's photos cost one Tab stop, and the cover's focus ring keeps a light band so it shows on a photo of its own colour", async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Stops ${uid}`;
  await fivePhotos(api, title);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  const cover = coverOf(card, title);
  await expect(cover).toBeVisible();
  // The thumbnails stay buttons (pointer, screen reader) out of the tab order: the cover's viewer reaches every photo.
  const thumbnails = card.getByRole('button', { name: /^View photo \d+ of/ });
  await expect(thumbnails).toHaveCount(3);
  for (const thumbnail of await thumbnails.all()) await expect(thumbnail).toHaveAttribute('tabindex', '-1');
  const stops = await card.evaluate(
    (element) => [...element.querySelectorAll<HTMLElement>('a[href], button')].filter((each) => each.tabIndex >= 0 && !each.matches(':disabled')).length,
  );
  // The cover, the title, the favourite star and '+ Add a photo'.
  expect(stops).toBe(4);
  // From the keyboard the cover shows the ring with its inner band.
  await card.getByRole('link', { name: title, exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(cover).toBeFocused();
  expect(await cover.evaluate((button) => getComputedStyle(button).boxShadow)).toMatch(/inset/);
});

test('photos removed while the viewer is open: it stays on a valid photo, closes with the last one and leaves the focus on the card', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Shrink ${uid}`;
  const { id, photos } = await fivePhotos(api, title);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  const { dialog, count, caption, shown } = viewerOf(page, title);
  await coverOf(card, title).click();
  await page.keyboard.press('End');
  await expect(caption).toHaveText('c5');
  // c5 (the first upload) is deleted on another device: the viewer stays open on the new last photo.
  await api.removeImage(photos[0].id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(count).toHaveText('4 / 4');
  await expect(caption).toHaveText('c4');
  await expect(shown).toBeVisible();
  // All of them: the viewer closes with the cover that opened it, no viewer entry stays, and the focus is on the card.
  for (const photo of photos.slice(1)) await api.removeImage(photo.id);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(dialog).toBeHidden();
  await expect(coverOf(card, title)).toHaveCount(0);
  await expect(card).toBeFocused();
  await expect.poll(() => page.evaluate(() => !!history.state?.glazelabViewer)).toBe(false);
  // A photo added later does not bring the viewer back.
  await api.uploadToCombination(id, { file: png('new.png'), kind: 'TEST_TILE' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(coverOf(card, title)).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('the card keeps one link per title: the cover and thumbnails are buttons outside every link, and nothing is nested', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Markup ${uid}`;
  await fivePhotos(api, title);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  await expect(coverOf(card, title)).toBeVisible();
  await expect(card.getByRole('heading', { name: title }).getByRole('link')).toHaveCount(1);
  await expect(card.getByRole('link', { name: title, exact: true })).toHaveCount(1);
  expect(await card.locator('button').evaluateAll((buttons) => buttons.filter((button) => button.closest('a')).length)).toBe(0);
  expect(await card.locator('a, button').evaluateAll((all) => all.filter((each) => each.querySelector('a, button')).length)).toBe(0);
  // The title still goes to the page.
  await card.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
});

test('only the opened photo and its two neighbours are requested at full size, and not before the click', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Requests ${uid}`;
  const { photos } = await fivePhotos(api, title, [1200, 900]);
  const full = new Set<string>();
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/images\/[^/]+$/.test(path)) full.add(path);
  });
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  await expect(coverOf(card, title)).toBeVisible();
  await expect(page.locator('.image-view__image--decoded').first()).toBeVisible();
  expect([...full]).toEqual([]);
  // The card's order is c1..c5; `photos` is in upload order (c5 c3 c1 c4 c2). Opening on c3 loads c3 and its neighbours c2 and c4.
  const byCaption = (caption: string) => photos[['c5', 'c3', 'c1', 'c4', 'c2'].indexOf(caption)].url;
  await thumbnailOf(card, 3, 5, title).click();
  const { shown, caption } = viewerOf(page, title);
  await expect(caption).toHaveText('c3');
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200);
  await expect.poll(() => [...full].sort()).toEqual([byCaption('c2'), byCaption('c3'), byCaption('c4')].sort());
});

test('Open goes to the combination page, leaves no viewer entry behind, and Back returns to the list', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Open ${uid}`;
  const { id } = await fivePhotos(api, title);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  const { dialog, open } = viewerOf(page, title);
  const length = await page.evaluate(() => history.length);
  await coverOf(card, title).click();
  await expect(dialog).toBeVisible();
  await expect(open).toHaveAttribute('href', `#/combinations/${id}`);
  await open.click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  // The viewer's entry was popped first: the page is one entry after the list, not two.
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  expect(await page.evaluate(() => !!history.state?.glazelabViewer)).toBe(false);
  // One Back lands on the list (not on a dead entry of the viewer), the card is there and no viewer is open.
  await page.goBack();
  await expect(card).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/\?type=combinations/);
});

test('browser Back closes the viewer and leaves the list; focus is back on the cover', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Back ${uid}`;
  await fivePhotos(api, title);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  const { dialog } = viewerOf(page, title);
  await coverOf(card, title).click();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(card).toBeVisible();
  await expect(coverOf(card, title)).toBeFocused();
  expect(new URL(page.url()).hash).toContain('type=combinations');
});

test('a guest sees only the photos the API lists for them, and a card without a photo has no photo button', async ({ page, shell, newApi, uid }) => {
  const author = await newApi();
  await author.signUp({ email: `maker-${uid}@example.test`, displayName: 'Maker', password: 'correct horse battery staple' });
  const title = `Guest ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await author.uploadToCombination(id, { file: png('a.png'), caption: 'public one', kind: 'TEST_TILE' });
  await author.uploadToCombination(id, { file: png('b.png'), caption: 'secret', kind: 'FINISHED', visibility: 'PRIVATE' });
  await author.uploadToCombination(id, { file: png('c.png'), caption: 'public two', kind: 'FINISHED' });
  await author.addCombination({ title: `Bare ${uid}`, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectGuest();
  const card = cardOf(page, title);
  await expect(coverOf(card, title)).toBeVisible();
  // The card lists two photos: one thumbnail.
  await expect(card.getByRole('button', { name: /^View photo \d+ of/ })).toHaveCount(1);
  await expect(cardOf(page, `Bare ${uid}`).getByRole('button', { name: /^View photo/ })).toHaveCount(0);
  await coverOf(card, title).click();
  const { count, caption, dialog } = viewerOf(page, title);
  await expect(count).toHaveText('1 / 2');
  // The finished piece leads, though the test tile was uploaded first.
  await expect(caption).toHaveText('public two');
  await page.keyboard.press('ArrowRight');
  await expect(caption).toHaveText('public one');
  await expect(dialog.getByText('secret')).toHaveCount(0);
});

test('offline the viewer opens from the saved card copy', async ({ page, context, shell, api, signedIn, uid }) => {
  const title = `Offline ${uid}`;
  const { photos } = await fivePhotos(api, title, [1200, 900]);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = cardOf(page, title);
  await expect(page.locator('.image-view__image--decoded').first()).toBeVisible();
  // The card copy of the cover (c1, the third upload) is saved by the app once it is shown.
  const saved = (url: string) =>
    page.evaluate(async (path) => {
      for (const name of await caches.keys()) if (await (await caches.open(name)).match(path)) return true;
      return false;
    }, url);
  await expect.poll(() => saved(photos[2].cardUrl)).toBe(true);
  expect(await saved(photos[2].url)).toBe(false);
  await context.setOffline(true);
  await coverOf(card, title).click();
  const { shown, dialog } = viewerOf(page, title);
  await expect(dialog).toBeVisible();
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  // The full size was never saved, so the picture is the saved card copy (480 px wide at most).
  expect(await shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeLessThanOrEqual(480);
  await page.keyboard.press('Escape');
  await expect(coverOf(card, title)).toBeFocused();
  await context.setOffline(false);
});

test('a glaze row in Explore opens the viewer over its photos, with Open to the glaze page', async ({ page, shell, api, signedIn, uid }) => {
  const created = await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` }, code: 'CE-1', name: 'Celadon' });
  const title = `Botz ${uid} CE-1 Celadon`;
  await api.uploadToGlaze(created.id, { file: png('a.png'), caption: 'tile one', kind: 'TEST_TILE' });
  await api.uploadToGlaze(created.id, { file: png('b.png'), caption: 'pack', kind: 'PACKAGING' });
  await shell.open(`#/?type=glazes&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const row = page
    .getByRole('main')
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: 'Celadon', exact: true }) });
  const button = row.getByRole('button', { name: t('images.cover.open', { title }) });
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await button.click();
  const { count, caption, open, dialog } = viewerOf(page, title);
  await expect(count).toHaveText('1 / 2');
  await expect(caption).toHaveText('tile one');
  await page.keyboard.press('ArrowRight');
  await expect(caption).toHaveText('pack');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  await open.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Celadon' })).toBeVisible();
});

test("the glaze page's combination list opens the viewer too", async ({ page, shell, api, signedIn, uid }) => {
  const created = await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` }, code: 'CE-1', name: 'Celadon' });
  const title = `Listed ${uid}`;
  const id = await api.addCombination({ title, steps: [{ type: 'GLAZE', glazeId: created.id, coats: 2 }, BISQUE_STEP] });
  await api.uploadToCombination(id, { file: png('a.png'), caption: 'one', kind: 'TEST_TILE' });
  await api.uploadToCombination(id, { file: png('b.png'), caption: 'two', kind: 'FINISHED' });
  await shell.open(`#/glazes/${created.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = page
    .getByRole('main')
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title }) });
  await coverOf(card, title).click();
  const { count, dialog } = viewerOf(page, title);
  await expect(count).toHaveText('1 / 2');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(coverOf(card, title)).toBeFocused();
});

test('a viewer opened while another one is still closing has no entry of its own and closes with one Escape, leaving the history alone', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  await fivePhotos(api, `Race A ${uid}`);
  await fivePhotos(api, `Race B ${uid}`);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(new ExplorePage(page).cardTitles).toHaveCount(2);
  // The card later in the page opens second: its dialog is then the topmost, the one Escape closes.
  const [first, second] = await new ExplorePage(page).cardTitles.allTextContents();
  await expect(coverOf(cardOf(page, first), first)).toBeVisible();
  await coverOf(cardOf(page, first), first).click();
  const a = viewerOf(page, first);
  const b = viewerOf(page, second);
  await expect(a.dialog).toBeVisible();
  const before = await page.evaluate(() => history.length);
  // In one task: Escape on A (its pop is asked for, A is still on screen), a click on B's cover (as a script, the dialog would block a real
  // one) and, once B is up, Escape again: A's pop has not answered yet, and B has no entry of its own.
  await page.evaluate(
    async (name) => {
      const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      escape();
      [...document.querySelectorAll<HTMLElement>('button')].find((button) => button.getAttribute('aria-label') === name)?.click();
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      if (document.querySelectorAll('[role="dialog"]').length === 2) escape();
    },
    t('images.cover.open', { title: second }),
  );
  // One Escape closes B at once (a viewer that tried to pop A's entry would wait for it for ever), and no Back is needed or lost.
  await expect(a.dialog).toBeHidden();
  await expect(b.dialog).toBeHidden();
  expect(await page.evaluate(() => history.length)).toBe(before);
  expect(await page.evaluate(() => !!history.state?.glazelabViewer)).toBe(false);
  await expect(page).toHaveURL(/#\/\?type=combinations/);
  // After a settled close, a viewer from the other card has an entry again: Back closes it.
  await coverOf(cardOf(page, second), second).click();
  await expect(b.dialog).toBeVisible();
  expect(await page.evaluate(() => !!history.state?.glazelabViewer)).toBe(true);
  await page.goBack();
  await expect(b.dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/\?type=combinations/);
});

test("a reload with the viewer open comes back to the list's place, and Back after closing keeps it", async ({ page, shell, api, signedIn, uid }) => {
  const title = `Reload ${uid}`;
  await fivePhotos(api, title);
  await fillerCards(api, uid, 16);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const cards = page.getByRole('main').getByRole('article');
  // Two pages of the list are shown; the target card is somewhere in them. The first page holds 12, and the second may follow
  // on its own before the scroll (the list renders the next page two screens ahead), so only the first card is awaited.
  await expect(cards.first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(cards).toHaveCount(17, { timeout: 15_000 });
  const card = cardOf(page, title);
  const cover = coverOf(card, title);
  await cover.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 30));
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(100);
  await cover.click();
  const { dialog, caption } = viewerOf(page, title);
  await expect(dialog).toBeVisible();
  // The viewer's entry carries the list's saved place, so a reload on it finds it.
  expect(await page.evaluate(() => history.state?.glazelabLists?.explore?.limit)).toBeGreaterThanOrEqual(17);
  await page.reload();
  await expect(cards).toHaveCount(17, { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 120);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolled)).toBeLessThanOrEqual(120);
  expect(await page.evaluate(() => !!history.state?.glazelabViewer)).toBe(false);
  // Open again and close with Back: the list is where it was.
  await cover.scrollIntoViewIfNeeded();
  const place = await page.evaluate(() => window.scrollY);
  await cover.click();
  await expect(caption).toHaveText('c1');
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - place)).toBeLessThanOrEqual(2);
  await expect(cards).toHaveCount(17);
});
