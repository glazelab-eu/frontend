import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// STOCK-2 review: a jar size changed in the scan sheet replaces the entry's with the + steps' addition, and a size typed back
// to the one the sheet started with is no change: another device's size stays. A file of its own: one barcode per worker,
// filmed by the fake camera (stale-jar-scan.spec.ts has the untouched sheet).

const JAR = 250;
const barcode = eanFor(`stale-jar-scan-size-${process.pid}-${Date.now()}`);
const video = join(FIXTURES, `stale-jar-scan-size-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(barcode));

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

test("the scan sheet's jar field replaces the size only when it was changed", async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const created = await api.addGlaze({ newManufacturer: { name: `Size ${uid}`, shortId: `${uid}Z` }, code: 'ZJ-1', name: 'Flint', barcode });
  await api.addStock({ glazeId: created.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  const entry = async () => (await api.stock()).find((item) => item.glazeId === created.id && !item.clubId);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(t('stock.form.current', { quantity: '250' }))).toBeVisible();
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: created.id, ownerType: 'personal', quantityG: JAR, jarSizeG: 1000 });
  // Typed away and back: no change the person made, so the phone's 1000 g jar stays.
  const jarField = sheet.getByRole('spinbutton', { name: t('stock.form.jarSize') });
  await jarField.fill('500');
  await jarField.fill(String(JAR));
  await sheet.getByRole('button', { name: t('stock.scan.moreJar') }).click();
  await sheet.getByRole('button', { name: t('stock.scan.saveNext') }).click();
  await expect.poll(async () => (await entry())?.quantityG).toBe(2 * JAR);
  expect((await entry())?.jarSizeG).toBe(1000);

  // A new scan of the jar opens the sheet again (1000 g jar now); a size changed there replaces it.
  await sheet.getByRole('button', { name: t('common.close') }).click();
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  await expect(sheet.getByText(t('stock.form.current', { quantity: '500' }))).toBeVisible();
  await expect(jarField).toHaveValue('1000');
  await jarField.fill('750');
  await sheet.getByRole('button', { name: t('stock.scan.moreJar') }).click();
  await sheet.getByRole('button', { name: t('stock.scan.saveNext') }).click();
  await expect.poll(async () => (await entry())?.jarSizeG).toBe(750);
  expect((await entry())?.quantityG).toBe(2 * JAR + 750);
});
