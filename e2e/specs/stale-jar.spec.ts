import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// STOCK-1: a page whose shelf is stale (another device or club member added a jar after it loaded) adds a jar on top of
// what the server holds, never on top of its own old copy: no jar is lost. STOCK-2: nor does it reset the jar size another
// device stored meanwhile; only a size typed on purpose replaces it.

const JAR = 250;
const barcode = eanFor(`stale-jar-${process.pid}-${Date.now()}`);
const video = join(FIXTURES, `stale-jar-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(barcode));

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

async function newGlaze(api: Api, uid: string, name: string, extra: { barcode?: string } = {}) {
  const created = await api.addGlaze({ newManufacturer: { name: `Stale ${uid}`, shortId: `${uid}S` }, code: 'SJ-1', name, ...extra });
  return { id: created.id, title: `Stale ${uid} SJ-1 ${name}` };
}

const entryOf = async (api: Api, glazeId: string, clubId: string | null = null) =>
  (await api.stock()).find((item) => item.glazeId === glazeId && (item.clubId ?? null) === clubId);

const amountOf = async (api: Api, glazeId: string, clubId: string | null = null) => (await entryOf(api, glazeId, clubId))?.quantityG;

const jarOf = async (api: Api, glazeId: string, clubId: string | null = null) => (await entryOf(api, glazeId, clubId))?.jarSizeG;

const BIG_JAR = 1000;

const row = (page: Page, amount: string, title: string) =>
  page.getByRole('main').getByRole('button', { name: t('stock.row.editAmount', { amount, glaze: title }) });

test('the shelf row: +1 jar adds to what another device stored meanwhile', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Fern');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(row(page, '250 g', glaze.title)).toBeAttached();
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 2 * JAR });
  await page
    .getByRole('main')
    .getByRole('button', { name: t('stock.row.oneJarFor', { glaze: glaze.title }) })
    .click();
  await expect.poll(() => amountOf(api, glaze.id)).toBe(3 * JAR);
  await expect(row(page, '750 g', glaze.title)).toBeAttached();
});

test('the shelf row: +1 jar on a row another device removed recreates it with the size it showed', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Reed');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(row(page, '250 g', glaze.title)).toBeAttached();
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.removeStock((await entryOf(phone, glaze.id))!.id);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('stock.row.oneJarFor', { glaze: glaze.title }) })
    .click();
  await expect.poll(() => amountOf(api, glaze.id)).toBe(JAR);
  expect(await jarOf(api, glaze.id)).toBe(JAR);
  await expect(row(page, '250 g', glaze.title)).toBeAttached();
});

test('the club shelf: two members adding a jar from the same read both count', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Moss');
  const { club, token } = await api.clubWithInvite(`Kiln ${uid}`);
  await api.addStock({ glazeId: glaze.id, ownerType: 'club', clubId: club.id, quantityG: JAR, jarSizeG: JAR });
  const bea = await newApi();
  await bea.signUp({ email: `bea-${uid}@example.test`, displayName: 'Bea', password: signedIn.password });
  await bea.joinClub(token);
  await shell.open(`#/stock?shelf=${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(row(page, '250 g', glaze.title)).toBeAttached();
  // Bea read 250 g too and added her jar first.
  expect((await bea.addToStock({ glazeId: glaze.id, ownerType: 'club', clubId: club.id, addG: JAR })).quantityG).toBe(2 * JAR);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('stock.row.oneJarFor', { glaze: glaze.title }) })
    .click();
  await expect.poll(() => amountOf(api, glaze.id, club.id)).toBe(3 * JAR);
  await expect(row(page, '750 g', glaze.title)).toBeAttached();
});

test('the stock form in jar mode adds to what another device stored meanwhile', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
  test.skip(isMobile, 'the same form on both layouts; the phone runs the scan session below');
  const glaze = await newGlaze(api, uid, 'Ash');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open(`#/stock?glaze=${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main.getByRole('radio', { name: t('stock.form.modeJar') }).check();
  await expect(main.getByRole('spinbutton', { name: t('stock.form.jarAdd') })).toHaveValue(String(JAR));
  const phone = await newApi();
  await phone.signIn(signedIn);
  // The phone also stored a bigger jar: the untouched field adds the 250 g this page shows and keeps that size.
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 2 * JAR, jarSizeG: BIG_JAR });
  await main.getByRole('button', { name: t('stock.target.update'), exact: true }).click();
  await expect.poll(() => amountOf(api, glaze.id)).toBe(3 * JAR);
  expect(await jarOf(api, glaze.id)).toBe(BIG_JAR);
  await expect(row(page, '750 g', glaze.title)).toBeAttached();
});

test('the stock form in jar mode keeps a jar size a refresh brought in while the field stayed untouched', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
  isMobile,
}) => {
  test.skip(isMobile, 'the same form on both layouts');
  const glaze = await newGlaze(api, uid, 'Alder');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open(`#/stock?glaze=${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main.getByRole('radio', { name: t('stock.form.modeJar') }).check();
  await expect(main.getByRole('spinbutton', { name: t('stock.form.jarAdd') })).toHaveValue(String(JAR));
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 2 * JAR, jarSizeG: BIG_JAR });
  // The page refreshes its shelf (back online, or back in the foreground) before the person saves the untouched form.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(row(page, '500 g', glaze.title)).toBeAttached();
  await expect(main.getByRole('spinbutton', { name: t('stock.form.jarAdd') })).toHaveValue(String(JAR));
  await main.getByRole('button', { name: t('stock.target.update'), exact: true }).click();
  await expect.poll(() => amountOf(api, glaze.id)).toBe(3 * JAR);
  expect(await jarOf(api, glaze.id)).toBe(BIG_JAR);
});

test('the stock form in jar mode still changes the jar size when another size is typed', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(isMobile, 'the same form on both layouts');
  const glaze = await newGlaze(api, uid, 'Birch');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open(`#/stock?glaze=${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main.getByRole('radio', { name: t('stock.form.modeJar') }).check();
  await main.getByRole('spinbutton', { name: t('stock.form.jarAdd') }).fill(String(BIG_JAR));
  await main.getByRole('button', { name: t('stock.target.update'), exact: true }).click();
  await expect.poll(() => amountOf(api, glaze.id)).toBe(JAR + BIG_JAR);
  expect(await jarOf(api, glaze.id)).toBe(BIG_JAR);
  await expect(row(page, '1,250 g', glaze.title)).toBeAttached();
});

test("a stored jar size changes through the form's set mode; the row's +1 jar never asks for one", async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(isMobile, 'the same form on both layouts');
  const glaze = await newGlaze(api, uid, 'Hazel');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open(`#/stock?glaze=${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  // Set mode (the default) with another jar size saves it, the amount as shown.
  await main.getByRole('spinbutton', { name: t('stock.form.jarSize') }).fill(String(BIG_JAR));
  await main.getByRole('button', { name: t('stock.target.update'), exact: true }).click();
  await expect.poll(() => jarOf(api, glaze.id)).toBe(BIG_JAR);
  expect(await amountOf(api, glaze.id)).toBe(JAR);
  // A row with a size adds its jar at once: the jar size editor is only for entries without one.
  await main.getByRole('button', { name: t('stock.row.oneJarFor', { glaze: glaze.title }) }).click();
  await expect(row(page, '1,250 g', glaze.title)).toBeAttached();
  await expect(main.getByRole('spinbutton', { name: t('stock.row.jarLabel', { glaze: glaze.title }) })).toHaveCount(0);
  expect(await jarOf(api, glaze.id)).toBe(BIG_JAR);
});

test('the glaze page: the one-click add adds to an entry another device created meanwhile', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Sand');
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const quick = main.getByRole('button', { name: t('glaze.shelf.quickAddFor', { size: JAR, glaze: glaze.title }) });
  await expect(quick).toBeVisible();
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: BIG_JAR });
  await quick.click();
  await expect.poll(() => amountOf(api, glaze.id)).toBe(2 * JAR);
  // STOCK-2: the one-click add's 250 g jar never replaces the 1000 g jar the phone stored.
  expect(await jarOf(api, glaze.id)).toBe(BIG_JAR);
  await expect(main.getByText(t('glaze.shelf.on', { parts: '500 g' }), { exact: true })).toBeVisible();
});

test('Explore: the one-click add adds to an entry another device created meanwhile', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, `Clay ${uid}`);
  await shell.open(`#/?q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const quick = page.getByRole('main').getByRole('button', { name: t('glaze.shelf.quickAddFor', { size: JAR, glaze: glaze.title }) });
  await expect(quick).toBeVisible();
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: BIG_JAR });
  await quick.click();
  await expect(quick).toHaveCount(0);
  await expect.poll(() => amountOf(api, glaze.id)).toBe(2 * JAR);
  expect(await jarOf(api, glaze.id)).toBe(BIG_JAR);
});

test.describe('the scan session', () => {
  test('the one-click add adds to an entry another device created meanwhile', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
    test.skip(!isMobile, 'the scan session is the phone layout');
    const glaze = await newGlaze(api, uid, 'Fern', { barcode });
    await shell.open('#/stock');
    await shell.expectSignedIn(signedIn.displayName);
    await page.getByRole('button', { name: t('stock.scan.button') }).click();
    const sheet = page.getByRole('dialog');
    const quick = sheet.getByRole('button', { name: t('glaze.shelf.quickAdd'), exact: true });
    await expect(quick).toBeVisible();
    const phone = await newApi();
    await phone.signIn(signedIn);
    await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: BIG_JAR });
    await quick.click();
    await expect.poll(() => amountOf(api, glaze.id)).toBe(2 * JAR);
    expect(await jarOf(api, glaze.id)).toBe(BIG_JAR);
    await expect(page.getByText(t('stock.scan.saved', { glaze: glaze.title, quantity: 2 * JAR }))).toBeVisible();
  });
});
