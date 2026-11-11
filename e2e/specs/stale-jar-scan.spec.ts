import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Api } from '../support/api';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// STOCK-1: a page whose shelf is stale (another device or club member added a jar after it loaded) adds a jar on top of
// what the server holds, never on top of its own old copy: no jar is lost. The scan sheet's + steps, in a file of its own: one
// barcode per worker, filmed by the fake camera, and barcodes are unique in the library.

const JAR = 250;
const barcode = eanFor(`stale-jar-scan-${process.pid}-${Date.now()}`);
const video = join(FIXTURES, `stale-jar-scan-${process.pid}.y4m`);
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

const entryOf = async (api: Api, glazeId: string) => (await api.stock()).find((item) => item.glazeId === glazeId && !item.clubId);

const amountOf = async (api: Api, glazeId: string) => (await entryOf(api, glazeId))?.quantityG;

test('"Save and scan next" after + adds the jar to what another device stored meanwhile', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const glaze = await newGlaze(api, uid, 'Moss', { barcode });
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(t('stock.form.current', { quantity: '250' }))).toBeVisible();
  const phone = await newApi();
  await phone.signIn(signedIn);
  // STOCK-2: the phone also stored a 1000 g jar; the sheet's untouched 250 g jar adds 250 g and keeps that size.
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 2 * JAR, jarSizeG: 1000 });
  await sheet.getByRole('button', { name: t('stock.scan.moreJar') }).click();
  await expect(sheet.getByLabel(t('stock.scan.grams'))).toHaveValue(String(2 * JAR));
  await sheet.getByRole('button', { name: t('stock.scan.saveNext') }).click();
  await expect.poll(() => amountOf(api, glaze.id)).toBe(3 * JAR);
  expect((await entryOf(api, glaze.id))?.jarSizeG).toBe(1000);
  await expect(page.getByText(t('stock.scan.saved', { glaze: glaze.title, quantity: 3 * JAR }))).toBeVisible();
});
