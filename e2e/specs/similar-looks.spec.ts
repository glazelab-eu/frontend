import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { ORANGE, seedSimilar, tile } from '../support/similar';
import { t } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';
import { MOCK_USER, mockApi, type MockAnswer } from '../support/mock-api';
import { routeStandIn, STAND_IN_BUILD, STAND_IN_BUILD_REASON } from '../support/vision';
import { combination, imageInfo } from '../../src/test/fixtures';
import de from '../../src/lib/i18n/de.json' with { type: 'json' };

/**
 * The similar looks (33-2): the second consent, indexing the account's photos on the device with the 33-1 model, and the searches.
 * The real worker and ONNX Runtime run with the stand-in model (`support/vision.ts`: a photo becomes its mean colour, so red photos
 * look alike and blue ones differ); `@vision-real` runs the real model on three public-domain photos.
 */
const MODEL = 'glazelab:photo-suggestions';
const DB = 'glazelab-embeddings';
/** The model is on for this device (as after a "Turn on" in the upload dialog) and the stand-in answers its files. */
async function withModel(page: Page) {
  await routeStandIn(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'on'), MODEL);
}

/** The card copies the page asked for: what indexing downloads (a gallery shows full sizes). */
function watchCards(page: Page): string[] {
  const cards: string[] = [];
  page.on('request', (request) => {
    const match = /\/api\/images\/([0-9a-f-]+)\/card$/.exec(new URL(request.url()).pathname);
    if (match) cards.push(match[1]);
  });
  return cards;
}

/** The keys of the embedding store, or null while the database does not exist. */
const keys = (page: Page) =>
  page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((database) => database.name === name)) return null;
    return new Promise<string[]>((resolve, reject) => {
      const opening = indexedDB.open(name);
      // Never create it: the database not existing is an answer too.
      opening.onupgradeneeded = () => opening.transaction?.abort();
      opening.onerror = () => (opening.error?.name === 'AbortError' ? resolve(null as never) : reject(opening.error));
      opening.onsuccess = () => {
        const db = opening.result;
        const request = db.transaction('embeddings').objectStore('embeddings').getAllKeys();
        request.onsuccess = () => {
          db.close();
          resolve(request.result.map(String));
        };
      };
    });
  }, DB);
const vectors = async (page: Page) => ((await keys(page)) ?? []).filter((key) => key.includes('/p/'));

/** A message of the page as a pattern, its numbers as `(\d+)` (the shared library's size is not this test's to know). */
function pattern(key: Parameters<typeof t>[0], names: string[]) {
  // Sentinel numbers without a thousands separator, replaced by `(\d+)` once the message is built (a plural needs a number).
  const sentinel = (position: number) => (position + 1) * 111;
  const text = t(key, Object.fromEntries(names.map((name, position) => [name, sentinel(position)])) as never);
  const source = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(names.reduce((result, _name, position) => result.replace(String(sentinel(position)), '(\\d+)'), source));
}
const stateText = pattern('similar.setting.state', ['done', 'total']);
const progressText = pattern('similar.progress', ['done', 'total']);
/** The indexed and total counts of the account page's state line, or null while it shows something else. */
async function counts(account: Locator) {
  const match = stateText.exec(await account.innerText());
  return match ? { done: Number(match[1]), total: Number(match[2]) } : null;
}
/** How long a whole indexing run (and the model start before it) may take on a loaded host. */
const INDEXING_MS = 120_000;
const everythingIndexed = (account: Locator) =>
  expect
    .poll(
      async () => {
        const found = await counts(account);
        return !!found && found.done === found.total;
      },
      { timeout: INDEXING_MS },
    )
    .toBe(true);

const section = (page: Page) => page.getByRole('main').getByRole('region', { name: t('similar.title'), exact: true });
const accountSection = (page: Page) =>
  page.getByRole('main').locator('section', { has: page.getByRole('heading', { level: 2, name: t('similar.setting.title'), exact: true }) });
const indexNow = (scope: ReturnType<Page['locator']>) => scope.getByRole('button', { name: t('similar.consent.index') });
const group = (page: Page, kind: 'finished' | 'tile') => section(page).getByRole('heading', { level: 3, name: t(`similar.group.${kind}`) });
/** The titles of a group's results in order (each link's text starts with the title). */
const titles = (page: Page, kind: 'finished' | 'tile') =>
  group(page, kind)
    .locator('xpath=following-sibling::ul[1]')
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.querySelector('.similar-card__title')?.textContent ?? ''));

async function indexEverything(page: Page, shell: { open: (hash: string) => Promise<void> }) {
  await shell.open('#/account');
  const account = accountSection(page);
  await indexNow(account).click();
  await everythingIndexed(account);
  return account;
}

/**
 * Waits for the first stored vector. The model starts in the worker first (ONNX Runtime, the stand-in's padded files), which on a
 * loaded host takes far longer than the default poll (E2E-similar-2): the same bound as a whole run.
 */
const firstVector = (page: Page) => expect.poll(async () => (await vectors(page)).length, { timeout: INDEXING_MS }).toBeGreaterThanOrEqual(1);

/** Waits until a vector is stored for each of these photos. */
const stored = (page: Page, ids: string[]) =>
  expect
    .poll(async () => {
      const found = await vectors(page);
      return ids.every((id) => found.some((key) => key.endsWith(`/${id}`)));
    })
    .toBe(true);

/** Delays the small copy of the given photos, so a slow connection leaves time to press Stop or to reload. */
const slowCards = (page: Page, ids: string[], ms = 600) =>
  page.route('**/api/images/*/card', async (route) => {
    if (ids.some((id) => route.request().url().includes(id))) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  });

test('nothing is indexed, requested or stored before "Index now"; "Later" leaves only the choice and never nags @smoke', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const library = await seedSimilar(api, uid);
  await withModel(page);
  const cards = watchCards(page);
  await shell.open(`#/glazes/${library.glaze.red}`);
  await shell.expectSignedIn(signedIn.displayName);

  // The glaze has a test tile, so the page asks, in plain words; nothing has been read, requested or stored.
  await expect(section(page)).toBeVisible();
  await expect(section(page).getByRole('heading', { level: 3, name: t('similar.consent.title') })).toBeVisible();
  await expect(section(page).getByText(pattern('similar.consent.body', ['count']))).toBeVisible();
  await expect(section(page).getByText(t('similar.consent.battery'))).toBeVisible();
  await expect(indexNow(section(page))).toBeVisible();
  await expect(section(page).getByRole('button', { name: t('similar.consent.later') })).toBeVisible();
  await page.waitForTimeout(800);
  expect(cards).toEqual([]);
  expect(await keys(page)).toBeNull();

  // "Later": said once, only the choice is stored, nothing is downloaded or indexed.
  await section(page)
    .getByRole('button', { name: t('similar.consent.later') })
    .click();
  await expect(section(page).getByText(t('similar.stopped'))).toBeVisible();
  await expect(section(page)).toBeFocused();
  await page.waitForTimeout(500);
  expect(cards).toEqual([]);
  expect(await keys(page)).toEqual([expect.stringMatching(/\/meta$/)]);

  // It does not come back by itself, neither after a reload nor on the other pages; the account page still offers it.
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  await shell.open(`#/combinations/${library.combination.x}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: library.title.x })).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  // Only the combination's own two photos (its strip) were loaded, nothing of the library.
  expect(cards.filter((id) => !library.photos.slice(3, 5).includes(id))).toEqual([]);
  await shell.open('#/account');
  await expect(indexNow(accountSection(page))).toBeVisible();
});

test('without the photo model nothing about the similar looks is offered, and the setting says what it needs', async ({ page, shell, api, signedIn, uid }) => {
  const library = await seedSimilar(api, uid);
  await routeStandIn(page);
  const cards = watchCards(page);
  await shell.open(`#/glazes/${library.glaze.red}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(section(page)).toHaveCount(0);
  await shell.open('#/account');
  await expect(accountSection(page).getByText(t('similar.setting.needsModel'))).toBeVisible();
  await expect(indexNow(accountSection(page))).toHaveCount(0);
  expect(cards).toEqual([]);
  expect(await keys(page)).toBeNull();
});

test('after "Index now" the glaze and combination pages show similar looks, test tiles with test tiles and finished pieces with finished pieces', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  test.setTimeout(180_000);
  const library = await seedSimilar(api, uid);
  await withModel(page);
  const cards = watchCards(page);
  await shell.open(`#/glazes/${library.glaze.red}`);
  await shell.expectSignedIn(signedIn.displayName);
  await indexNow(section(page)).click();
  await expect(group(page, 'tile')).toBeVisible({ timeout: 120_000 });
  // Every photo of the library was loaded once in its small size, and a vector stored for each.
  await stored(page, library.photos);
  for (const id of library.photos) expect(cards).toContain(id);
  // The orange glaze's tile looks most like the other orange one. The orange finished pieces are another kind and never answer it
  // (they would come first if the kinds were mixed), and the glaze itself never answers.
  await expect.poll(async () => (await titles(page, 'tile'))[0]).toBe(library.glazeTitle.crimson);
  const tiles = await titles(page, 'tile');
  expect(tiles).not.toContain(library.glazeTitle.red);
  expect(tiles).not.toContain(library.title.y);
  expect(tiles).not.toContain(library.title.z);
  await expect(group(page, 'finished')).toHaveCount(0);
  await expect(section(page).getByText(t('similar.hint'))).toBeVisible();
  // A result is a link to the item.
  await section(page)
    .getByRole('link', { name: new RegExp(library.glazeTitle.crimson) })
    .click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: `Crimson ${uid}` })).toBeVisible();

  // The combination with both kinds: its orange finished piece with finished pieces (the other orange one first), its teal test tile
  // with test tiles (the teal glaze first, before the teal finished piece Z that would otherwise tie).
  await shell.open(`#/combinations/${library.combination.x}`);
  await expect(group(page, 'finished')).toBeVisible();
  expect((await titles(page, 'finished'))[0]).toBe(library.title.y);
  expect((await titles(page, 'tile'))[0]).toBe(library.glazeTitle.blue);
  for (const kind of ['finished', 'tile'] as const) expect(await titles(page, kind)).not.toContain(library.title.x);
  expect(await titles(page, 'tile')).not.toContain(library.title.z);
});

test('the photo viewer finds similar photos for the photo shown, and a result opens its page', async ({ page, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  const library = await seedSimilar(api, uid);
  await withModel(page);
  await shell.open(`#/glazes/${library.glaze.red}`);
  await shell.expectSignedIn(signedIn.displayName);
  await indexNow(section(page)).click();
  await expect(group(page, 'tile')).toBeVisible({ timeout: 120_000 });

  await page
    .getByRole('main')
    .getByRole('group', { name: t('images.viewer.open') })
    .click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: t('similar.find') }).click();
  const links = viewer.getByRole('link');
  await expect(links.first()).toContainText(library.glazeTitle.crimson);
  await expect(viewer.getByText(t('similar.hint'))).toBeVisible();
  // The panel is a disclosure on the button that opened it.
  await expect(viewer.getByRole('button', { name: t('similar.hide') })).toHaveAttribute('aria-expanded', 'true');
  await links.first().click();
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: `Crimson ${uid}` })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a fresh photo can be compared with the library before it is saved, and nothing is uploaded for it', async ({ page, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  void signedIn;
  const library = await seedSimilar(api, uid);
  await withModel(page);
  await indexEverything(page, shell);
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/images/.test(request.url())) uploads.push(request.url());
  });
  await shell.open(`#/combinations/${library.combination.z}`);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(t('upload.library')).setInputFiles(tile('new-orange.png', [198, 118, 33]));
  await dialog.getByRole('button', { name: t('similar.upload.find', { name: 'new-orange.png' }) }).click();
  // An orange test tile: the two orange glazes' tiles come first, the orange finished pieces never.
  const links = dialog.getByRole('link');
  await expect(links.first()).toBeVisible();
  const names = await links.evaluateAll((items) => items.map((item) => item.querySelector('.similar-card__title')?.textContent ?? ''));
  expect(names.slice(0, 2).sort()).toEqual([library.glazeTitle.crimson, library.glazeTitle.red].sort());
  expect(names).not.toContain(library.title.y);
  // The results open in a new tab, so the unsaved photo stays.
  await expect(links.first()).toHaveAttribute('target', '_blank');
  expect(uploads).toEqual([]);
  await expect(dialog.getByText('new-orange.png').first()).toBeVisible();
});

test('"Find similar" before the indexing asks about it first, and "Later" there closes the panel', async ({ page, shell, api, signedIn, uid }) => {
  const library = await seedSimilar(api, uid);
  await withModel(page);
  const cards = watchCards(page);
  await shell.open(`#/combinations/${library.combination.z}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: library.title.z })).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(t('upload.library')).setInputFiles(tile('new-teal.png', [28, 118, 202]));
  const find = dialog.getByRole('button', { name: t('similar.upload.find', { name: 'new-teal.png' }) });
  await expect(find).toBeVisible();
  const own = cards.length;
  // The button is there, the question is not until it is pressed, and nothing of the library has been fetched.
  await expect(dialog.getByRole('heading', { name: t('similar.consent.title') })).toHaveCount(0);
  await find.click();
  await expect(dialog.getByRole('heading', { name: t('similar.consent.title') })).toBeVisible();
  expect(cards).toHaveLength(own);
  expect(await keys(page)).toBeNull();
  await dialog.getByRole('button', { name: t('similar.consent.later') }).click();
  await expect(dialog.getByRole('heading', { name: t('similar.consent.title') })).toHaveCount(0);
  await expect(find).toBeFocused();
  expect(cards).toHaveLength(own);
});

test('Stop halts the indexing and keeps what is done; Index now goes on with the rest, also after a reload', async ({ page, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  const library = await seedSimilar(api, uid);
  await withModel(page);
  await slowCards(page, library.photos);
  const cards = watchCards(page);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const account = accountSection(page);
  await indexNow(account).click();
  await expect(account.getByText(progressText)).toBeVisible();
  await firstVector(page);
  await account.getByRole('button', { name: t('similar.stop') }).click();
  await expect(indexNow(account)).toBeVisible();
  const kept = (await vectors(page)).length;
  const first = (await counts(account))!;
  expect(first.done).toBeLessThan(first.total);
  const asked = cards.length;
  await page.waitForTimeout(1500);
  expect(cards.length).toBeLessThanOrEqual(asked + 1);
  expect((await vectors(page)).length).toBeLessThanOrEqual(kept + 1);

  // After a reload it does not start by itself (the choice is "off"); Index now continues with what is missing.
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await page.waitForTimeout(800);
  const before = cards.length;
  await expect(indexNow(account)).toBeVisible();
  expect(cards.length).toBe(before);
  const stopped = (await counts(account))!;
  await indexNow(account).click();
  await everythingIndexed(account);
  // Only what was missing was loaded again (the vectors kept are not: at most the photo in flight at Stop).
  const total = (await counts(account))!.total;
  expect(cards.length - before).toBeLessThanOrEqual(total - stopped.done + 2);
  await stored(page, library.photos);
});

test('photos met without a connection the page was not told of are tried again, never given up (E2E-similar-1)', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  test.setTimeout(180_000);
  const library = await seedSimilar(api, uid);
  await withModel(page);
  // The browser's online flag, switched without an event: as when the host's network drops while the API on loopback still
  // answers, so the app's own checks keep it online.
  await page.addInitScript(() => {
    const network = { online: true };
    Reflect.set(window, '__network', network);
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => network.online, configurable: true });
  });
  await slowCards(page, library.photos, 300);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const account = accountSection(page);
  await indexNow(account).click();
  await firstVector(page);
  await page.evaluate(() => ((Reflect.get(window, '__network') as { online: boolean }).online = false));
  // Before, every photo left was given up at once and the indexing said it was done.
  await expect(account.getByText(t('similar.paused.offline'))).toBeVisible();
  await page.evaluate(() => ((Reflect.get(window, '__network') as { online: boolean }).online = true));
  await everythingIndexed(account);
  await stored(page, library.photos);
});

test('a started indexing goes on by itself after a reload, and a finished one asks for nothing', async ({ page, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  const library = await seedSimilar(api, uid);
  await withModel(page);
  await slowCards(page, library.photos, 400);
  const cards = watchCards(page);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await indexNow(accountSection(page)).click();
  await firstVector(page);
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await everythingIndexed(accountSection(page));
  await stored(page, library.photos);
  const loaded = cards.length;
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await everythingIndexed(accountSection(page));
  await page.waitForTimeout(800);
  expect(cards.length).toBe(loaded);
});

test('indexing waits while the tab is hidden and while the battery is low, and says why', async ({ page, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  await seedSimilar(api, uid);
  await withModel(page);
  await page.addInitScript(() => {
    const state = { hidden: true, charging: false, level: 0.1 };
    (window as unknown as { __env: typeof state }).__env = state;
    Object.defineProperty(document, 'visibilityState', { get: () => (state.hidden ? 'hidden' : 'visible') });
    const battery = new EventTarget();
    Object.defineProperties(battery, { charging: { get: () => state.charging }, level: { get: () => state.level } });
    Object.defineProperty(navigator, 'getBattery', { value: async () => battery });
    (window as unknown as { __battery: EventTarget }).__battery = battery;
  });
  const cards = watchCards(page);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const account = accountSection(page);
  await indexNow(account).click();
  await expect(account.getByText(t('similar.paused.hidden'))).toBeVisible();
  await page.waitForTimeout(600);
  expect(cards).toEqual([]);

  // Visible again, but the battery is low and not charging.
  await page.evaluate(() => {
    (window as unknown as { __env: { hidden: boolean } }).__env.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(account.getByText(t('similar.paused.battery'))).toBeVisible();
  await page.waitForTimeout(600);
  expect(cards).toEqual([]);

  // Plugged in: it goes on to the end.
  await page.evaluate(() => {
    const scope = window as unknown as { __env: { charging: boolean }; __battery: EventTarget };
    scope.__env.charging = true;
    scope.__battery.dispatchEvent(new Event('chargingchange'));
  });
  await everythingIndexed(account);
});

test('a metered connection waits for the person, who can continue anyway', async ({ page, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  const library = await seedSimilar(api, uid);
  await withModel(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, type: 'cellular', addEventListener() {} } }));
  await slowCards(page, library.photos, 500);
  const cards = watchCards(page);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const account = accountSection(page);
  await expect(account.getByText(t('similar.consent.metered'))).toBeVisible();
  // "Index now" on a metered connection is the agreement to use it, for this session.
  await indexNow(account).click();
  // The model itself asks again before downloading on a metered connection (33-1); the indexing waits for it.
  await expect(account.getByText(t('similar.paused.model'))).toBeVisible();
  await page
    .getByRole('main')
    .getByRole('button', { name: t('vision.confirm.download') })
    .click();
  await firstVector(page);
  // A new session asks again: it waits, loads nothing, and goes on only when told.
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(account.getByText(t('similar.paused.metered'))).toBeVisible();
  const before = cards.length;
  await page.waitForTimeout(800);
  expect(cards.length).toBe(before);
  await account.getByRole('button', { name: t('similar.allowMetered') }).click();
  await everythingIndexed(account);
});

test('the vectors are only of photos the person can see, and sign-out removes them and the choice with them', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  test.setTimeout(180_000);
  const library = await seedSimilar(api, uid);
  // Another potter's private test tile on the same public glaze: not in this person's listings, so never fetched or embedded.
  const other = await newApi();
  await other.signUp(newAccount(uid, 'Bo'));
  const hidden = await other.uploadToGlaze(library.glaze.red, { file: tile('hidden.png', ORANGE), kind: 'TEST_TILE', visibility: 'PRIVATE' });
  await withModel(page);
  const cards = watchCards(page);
  await indexEverything(page, shell);
  expect(cards).not.toContain(hidden.id);
  await stored(page, library.photos);
  expect((await vectors(page)).some((key) => key.endsWith(hidden.id))).toBe(false);

  await shell.signOut();
  await shell.expectGuest();
  await expect.poll(async () => (await keys(page)) ?? []).toEqual([]);
  // The model stays: it is the device's choice, not the account's.
  expect(await page.evaluate((key) => localStorage.getItem(key), MODEL)).toBe('on');
  // Signing in again starts with no choice and no vector: it asks again.
  await api.signIn(signedIn);
  await page.reload();
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(indexNow(accountSection(page))).toBeVisible();
  expect(await vectors(page)).toEqual([]);
});

test('the account page can remove the indexed data, and turning the photo model off removes the database', async ({ page, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  void signedIn;
  const library = await seedSimilar(api, uid);
  await withModel(page);
  const account = await indexEverything(page, shell);
  await account.getByRole('button', { name: t('similar.setting.remove') }).click();
  await expect(indexNow(account)).toBeVisible();
  expect(await vectors(page)).toEqual([]);
  expect(await keys(page)).toEqual([expect.stringMatching(/\/meta$/)]);

  await indexNow(account).click();
  await everythingIndexed(account);
  await stored(page, library.photos);
  // Turning the model off (its own section) deletes the model, the label data and every embedding: the whole database.
  await page
    .getByRole('main')
    .getByRole('button', { name: t('vision.remove') })
    .click();
  await expect.poll(() => keys(page)).toBeNull();
  await expect(account.getByText(t('similar.setting.needsModel'))).toBeVisible();
});

test('offline the results are still there, computed on the device', async ({ page, context, shell, api, signedIn, uid }) => {
  test.setTimeout(180_000);
  void signedIn;
  const library = await seedSimilar(api, uid);
  await withModel(page);
  await indexEverything(page, shell);
  await shell.open(`#/glazes/${library.glaze.red}`);
  await expect(group(page, 'tile')).toBeVisible();
  await expect.poll(async () => (await titles(page, 'tile'))[0]).toBe(library.glazeTitle.crimson);
  await context.setOffline(true);
  await page.evaluate((hash) => (location.hash = hash), `#/glazes/${library.glaze.crimson}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: `Crimson ${uid}` })).toBeVisible();
  await expect(group(page, 'tile')).toBeVisible();
  expect((await titles(page, 'tile'))[0]).toBe(library.glazeTitle.red);
  await context.setOffline(false);
});

test('the question speaks German', async ({ page, api, signedIn, uid }) => {
  void signedIn;
  const library = await seedSimilar(api, uid);
  await withModel(page);
  await page.addInitScript(() => localStorage.setItem('glazelab:locale', 'de'));
  await page.goto(`/#/glazes/${library.glaze.red}`);
  const region = page.getByRole('main').getByRole('region', { name: de['similar.title'], exact: true });
  await expect(region.getByRole('heading', { level: 3, name: de['similar.consent.title'] })).toBeVisible();
  await expect(region.getByRole('button', { name: de['similar.consent.index'] })).toBeVisible();
  await expect(region.getByRole('button', { name: de['similar.consent.later'] })).toBeVisible();
});

test('with the real model, a mug photo finds the other mug before the jug @vision-real', async ({ page }) => {
  test.skip(STAND_IN_BUILD, STAND_IN_BUILD_REASON);
  test.setTimeout(180_000);
  // Three public-domain (CC0) photos, 480 px, in a mocked library (so its size is known): a blue duck mug (Commons "Entenbecher.jpg"),
  // a Droste mug ("Droste beker foto7.JPG") and a pitcher ("Cincinnati Pottery Club Incised Pitcher MET DP216218.jpg").
  const files = { duck: 'mug-photo.jpg', droste: 'mug-photo-2.jpg', jug: 'jug-photo.jpg' } as const;
  const ids = { duck: '00000000-0000-4000-8000-0000000000a1', droste: '00000000-0000-4000-8000-0000000000a2', jug: '00000000-0000-4000-8000-0000000000a3' };
  const combinations = (Object.keys(files) as (keyof typeof files)[]).map((name, position) =>
    combination({
      id: `00000000-0000-4000-8000-0000000000b${position + 1}`,
      title: `${name} piece`,
      authorId: MOCK_USER.id,
      own: true,
      images: [imageInfo({ id: ids[name], kind: 'FINISHED', url: `/api/images/${ids[name]}`, cardUrl: `/api/images/${ids[name]}/card` })],
    }),
  );
  const answers: Record<string, MockAnswer> = {
    'GET /api/sync': {
      json: {
        format: 1,
        cursor: '1.0',
        epoch: 'mock',
        resync: 'CURSOR',
        glazes: [],
        combinations: [],
        removedGlazeIds: [],
        removedCombinationIds: [],
        visibleGlazes: 0,
        visibleCombinations: combinations.length,
      },
    },
    'GET /api/sync/combinations': { json: { combinations, next: null } },
  };
  for (const name of Object.keys(files) as (keyof typeof files)[]) {
    const buffer = readFileSync(new URL(`../fixtures/${files[name]}`, import.meta.url));
    for (const path of [`/api/images/${ids[name]}`, `/api/images/${ids[name]}/card`])
      answers[`GET ${path}`] = (route) => route.fulfill({ body: buffer, contentType: 'image/jpeg' });
  }
  await mockApi(page, { answers });
  await page.addInitScript((key) => localStorage.setItem(key, 'on'), MODEL);
  await page.goto(`/#/combinations/${combinations[0].id}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'duck piece' })).toBeVisible();
  await indexNow(section(page)).click();
  await expect(group(page, 'finished')).toBeVisible({ timeout: 150_000 });
  // The list grows while the library is indexed: wait for the end.
  await expect.poll(() => titles(page, 'finished'), { timeout: 150_000 }).toEqual(['droste piece', 'jug piece']);
});
