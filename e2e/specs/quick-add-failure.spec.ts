import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { DIALOG, expectAccessible } from '../support/axe';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { startsWith, t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// The one-click "Add a 250 g jar" (glaze page, Explore row, scan sheet) when the save fails: what the person sees, that
// nothing counts as added, that the button works again and that a retry adds exactly one entry.

const JAR = 250;
const barcode = eanFor(`quick-fail-${process.pid}-${Date.now()}`);
const video = join(FIXTURES, `quick-fail-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(barcode));

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

/** The answers a stock write fails with: the API's own error bodies (400 for a glaze removed meanwhile, 429 for the limit), a 500 with a body, a dropped connection. */
const failures = {
  server: { status: 500, error: 'Internal server error', text: () => t('errors.requestFailed') },
  unknownGlaze: { status: 400, error: 'Unknown glaze', text: () => t('errors.unknownGlaze') },
  limit: { status: 429, error: 'Too many requests. Please wait a moment and try again.', text: () => t('errors.tooManyRequests') },
  dropped: { status: 0, error: '', text: () => t('errors.unreachable') },
} as const;
type Failure = keyof typeof failures;

/** Makes the stock writes (POST, a save or an addition) fail until `release()`; counts them. Reads pass. */
async function failStockWrites(page: Page, failure: Failure) {
  const state = { failing: true, writes: 0, failure };
  await page.route(/\/api\/stock(\/add)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    state.writes++;
    if (!state.failing) return route.fallback();
    const answer = failures[state.failure];
    if (answer.status === 0) return route.abort('failed');
    return route.fulfill({ status: answer.status, json: { error: answer.error } });
  });
  return { state, release: () => (state.failing = false), failure: (next: Failure) => (state.failure = next) };
}

const made = new Map<string, number>();
async function newGlaze(api: Api, uid: string, name: string, extra: { barcode?: string } = {}) {
  // A manufacturer of its own per glaze (a short ID takes at most ten characters).
  const n = (made.get(uid) ?? 0) + 1;
  made.set(uid, n);
  const created = await api.addGlaze({ newManufacturer: { name: `Quick ${uid}${n}`, shortId: `${uid}${n}` }, code: 'QK-1', name, ...extra });
  return { id: created.id, title: `Quick ${uid}${n} QK-1 ${name}` };
}
const quickName = (title: string) => t('glaze.shelf.quickAddFor', { size: JAR, glaze: title });
const entriesOf = async (api: Api, glazeId: string) => (await api.stock()).filter((item) => item.glazeId === glazeId);

test.describe('glaze page', () => {
  for (const failure of ['server', 'unknownGlaze', 'limit'] as const) {
    test(`a failed add (${failure}) shows the error, re-enables the button and a retry adds one jar`, async ({ page, shell, api, signedIn, uid }) => {
      const glaze = await newGlaze(api, uid, 'Fern');
      const stock = await failStockWrites(page, failure);
      await shell.open(`#/glazes/${glaze.id}`);
      await shell.expectSignedIn(signedIn.displayName);
      const main = page.getByRole('main');
      const quick = main.getByRole('button', { name: quickName(glaze.title) });
      await quick.click();
      await expect(main.getByText(failures[failure].text(), { exact: true })).toBeVisible();
      await expect(quick).toBeEnabled();
      await expect(quick).toBeFocused();
      await expect(main.getByText(t('glaze.shelf.none'), { exact: true })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: t('notices.shelfAdded') })).toHaveCount(0);
      expect(await entriesOf(api, glaze.id)).toHaveLength(0);
      stock.release();
      await quick.click();
      await expect(main.getByText(t('glaze.shelf.on', { parts: '250 g' }), { exact: true })).toBeVisible();
      await expect(main.getByText(failures[failure].text(), { exact: true })).toHaveCount(0);
      await expect(main.getByRole('button', { name: t('glaze.shelf.updateFor', { glaze: glaze.title }) })).toBeFocused();
      expect(await entriesOf(api, glaze.id)).toHaveLength(1);
      expect(stock.state.writes).toBe(2);
    });
  }

  test('a dropped connection shows the error, nothing is added, and the button is back with the connection', async ({ page, shell, api, signedIn, uid }) => {
    const glaze = await newGlaze(api, uid, 'Moss');
    const stock = await failStockWrites(page, 'dropped');
    await shell.open(`#/glazes/${glaze.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    const quick = main.getByRole('button', { name: quickName(glaze.title) });
    await quick.click();
    await expect(main.getByText(failures.dropped.text(), { exact: true }).first()).toBeVisible();
    await expect(main.getByText(t('glaze.shelf.none'), { exact: true })).toBeVisible();
    expect(await entriesOf(api, glaze.id)).toHaveLength(0);
    stock.release();
    await expect(quick).toBeVisible({ timeout: 30_000 });
    await expect(quick).toBeEnabled();
    await quick.click();
    await expect(main.getByText(t('glaze.shelf.on', { parts: '250 g' }), { exact: true })).toBeVisible();
    expect(await entriesOf(api, glaze.id)).toHaveLength(1);
  });

  test('a failure in German names the problem in German', async ({ page, shell, api, signedIn, uid }) => {
    await page.addInitScript(() => localStorage.setItem('glazelab:locale', 'de'));
    const glaze = await newGlaze(api, uid, 'Ash');
    await failStockWrites(page, 'unknownGlaze');
    await page.goto(`/#/glazes/${glaze.id}`);
    const main = page.getByRole('main');
    await main
      .getByRole('button', { name: /Gebinde zu deinem Regal hinzufügen/ })
      .first()
      .click();
    await expect(main.getByRole('alert').filter({ hasText: /Glasur/ })).toBeVisible();
  });
});

test.describe('Explore row', () => {
  const rowOf = (page: Page, name: string) =>
    page
      .getByRole('main')
      .getByRole('article')
      .filter({ has: page.getByRole('link', { name, exact: true }) });

  for (const failure of ['server', 'unknownGlaze', 'limit'] as const) {
    test(`a failed add (${failure}) shows the error in the row, keeps the button and a retry adds one jar`, async ({ page, shell, api, signedIn, uid }) => {
      const glaze = await newGlaze(api, uid, `Fern ${uid}`);
      const other = await newGlaze(api, uid, `Moss ${uid}`);
      const stock = await failStockWrites(page, failure);
      await shell.open(`#/?q=${uid}`);
      await shell.expectSignedIn(signedIn.displayName);
      const row = rowOf(page, `Fern ${uid}`);
      const quick = row.getByRole('button', { name: quickName(glaze.title) });
      await quick.click();
      await expect(row.getByText(failures[failure].text(), { exact: true })).toBeVisible();
      // Only the failed row says so.
      await expect(rowOf(page, `Moss ${uid}`).getByText(failures[failure].text(), { exact: true })).toHaveCount(0);
      await expect(quick).toBeEnabled();
      await expect(quick).toBeFocused();
      await expect(row.getByText(t('explore.glazeRow.onShelf'), { exact: true })).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: t('notices.shelfAdded') })).toHaveCount(0);
      expect(await entriesOf(api, glaze.id)).toHaveLength(0);
      stock.release();
      await quick.click();
      await expect(row.getByText(t('explore.glazeRow.onShelf'), { exact: true })).toBeVisible();
      await expect(quick).toHaveCount(0);
      await expect(row.getByText(failures[failure].text(), { exact: true })).toHaveCount(0);
      await expect(row.getByRole('link', { name: `Fern ${uid}`, exact: true })).toBeFocused();
      expect(await entriesOf(api, glaze.id)).toHaveLength(1);
      expect(await entriesOf(api, other.id)).toHaveLength(0);
      expect(stock.state.writes).toBe(2);
    });
  }

  test('a dropped connection shows the error, nothing is added, and the button is back with the connection', async ({ page, shell, api, signedIn, uid }) => {
    const glaze = await newGlaze(api, uid, `Fern ${uid}`);
    const stock = await failStockWrites(page, 'dropped');
    await shell.open(`#/?q=${uid}`);
    await shell.expectSignedIn(signedIn.displayName);
    const row = rowOf(page, `Fern ${uid}`);
    const quick = row.getByRole('button', { name: quickName(glaze.title) });
    await quick.click();
    await expect(row.getByText(failures.dropped.text(), { exact: true })).toBeVisible();
    await expect(row.getByText(t('explore.glazeRow.onShelf'), { exact: true })).toHaveCount(0);
    expect(await entriesOf(api, glaze.id)).toHaveLength(0);
    stock.release();
    await expect(quick).toBeVisible({ timeout: 30_000 });
    await expect(quick).toBeEnabled();
    await quick.click();
    await expect(row.getByText(t('explore.glazeRow.onShelf'), { exact: true })).toBeVisible();
    expect(await entriesOf(api, glaze.id)).toHaveLength(1);
  });

  test('offline there is no button; a glaze on the personal shelf or a guest has none; a club-only glaze has one', async ({
    page,
    shell,
    api,
    context,
    signedIn,
    uid,
  }) => {
    const fresh = await newGlaze(api, uid, `Fern ${uid}`);
    const owned = await newGlaze(api, uid, `Moss ${uid}`);
    const clubOnly = await newGlaze(api, uid, `Ash ${uid}`);
    await api.addStock({ glazeId: owned.id, ownerType: 'personal', quantityG: 0 });
    const club = await api.createClub(`Kiln ${uid}`);
    await api.addStock({ glazeId: clubOnly.id, ownerType: 'club', clubId: club.id, quantityG: 900 });
    await shell.open(`#/?q=${uid}`);
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: quickName(fresh.title) })).toBeVisible();
    await expect(main.getByRole('button', { name: quickName(clubOnly.title) })).toBeVisible();
    await expect(main.getByRole('button', { name: quickName(owned.title) })).toHaveCount(0);
    await context.setOffline(true);
    await expect(main.getByRole('button', { name: startsWith(t('glaze.shelf.quickAdd')) })).toHaveCount(0);
    await context.setOffline(false);
    await expect(main.getByRole('button', { name: quickName(fresh.title) })).toBeVisible();
    await context.clearCookies();
    await page.reload();
    await expect(main.getByRole('article').first()).toBeVisible();
    await expect(main.getByRole('button', { name: startsWith(t('glaze.shelf.quickAdd')) })).toHaveCount(0);
  });

  test('a German label names the glaze and the size, the tooltip the action', async ({ page, shell, api, signedIn, uid }) => {
    await page.addInitScript(() => localStorage.setItem('glazelab:locale', 'de'));
    const glaze = await newGlaze(api, uid, `Fern ${uid}`);
    await page.goto(`/#/?q=${uid}`);
    const quick = rowOf(page, `Fern ${uid}`).getByRole('button', { name: `Gebinde zu deinem Regal hinzufügen: 250 g von ${glaze.title}` });
    await expect(quick).toHaveAttribute('title', 'Gebinde zu deinem Regal hinzufügen');
    await quick.click();
    await expect(page.getByRole('status').filter({ hasText: 'Zu deinem Regal hinzugefügt.' })).toBeVisible();
  });
});

test('the scan sheet: a failed one-click add keeps the sheet, shows the error and a retry saves one jar and scans on', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  isMobile,
}) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const glaze = await newGlaze(api, uid, 'Fern', { barcode });
  const club = await api.createClub(`Kiln ${uid}`);
  const stock = await failStockWrites(page, 'server');
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  const sheet = page.getByRole('dialog');
  const quick = sheet.getByRole('button', { name: t('glaze.shelf.quickAdd'), exact: true });
  await expect(quick).toBeVisible();
  // On the club shelf too: the button follows the shelf choice, names the club, and the sheet's own save stays.
  await sheet.getByRole('combobox', { name: t('stock.form.owner') }).selectOption(club.id);
  await expect(sheet.getByRole('button', { name: t('stock.scan.quickAddClub', { club: `Kiln ${uid}` }), exact: true })).toBeVisible();
  await expect(quick).toHaveCount(0);
  await sheet.getByRole('combobox', { name: t('stock.form.owner') }).selectOption('personal');

  await quick.click();
  await expect(sheet.getByText(failures.server.text(), { exact: true })).toBeVisible();
  await expect(quick).toBeEnabled();
  await expect(quick).toBeFocused();
  await expect(sheet.getByText(t('stock.scan.notOnShelf'))).toBeVisible();
  await expectAccessible(page, { include: [DIALOG] });
  expect(await entriesOf(api, glaze.id)).toHaveLength(0);

  stock.failure('limit');
  await quick.click();
  await expect(sheet.getByText(failures.limit.text(), { exact: true })).toBeVisible();
  await expect(quick).toBeEnabled();

  stock.failure('dropped');
  await quick.click();
  await expect(sheet.getByText(failures.dropped.text(), { exact: true }).first()).toBeVisible();
  expect(await entriesOf(api, glaze.id)).toHaveLength(0);

  stock.release();
  await expect(quick).toBeEnabled({ timeout: 30_000 });
  await quick.click();
  await expect(page.getByText(t('stock.scan.saved', { glaze: glaze.title, quantity: JAR }))).toBeVisible();
  const saved = await entriesOf(api, glaze.id);
  expect(saved).toMatchObject([{ quantityG: JAR, jarSizeG: JAR, clubId: null }]);
  expect(stock.state.writes).toBe(4);
});
