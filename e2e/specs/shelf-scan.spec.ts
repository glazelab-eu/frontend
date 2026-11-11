import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// The fake camera films this file; the browser of this file starts with it (a worker of its own).
const video = join(FIXTURES, `shelf-scan-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(null));

/** A barcode of this test's own (a barcode belongs to one glaze of the shared library), filmed from now on. */
function film(uid: string): string {
  const barcode = eanFor(`shelf-scan-${uid}`);
  writeFileSync(video, barcodeVideo(barcode));
  return barcode;
}

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

test('the scan session starts on the club shelf the page shows and saves there', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const barcode = film(uid);
  const fern = await api.addGlaze({ newManufacturer: { name: `Shelf ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Fern', barcode });
  const name = `Kiln ${uid}`;
  const kiln = (await api.createClub(name)).id;
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 400 });
  await shell.open(`#/stock?shelf=${kiln}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('main').getByText(t('stock.shelves.emptyClub', { club: name }))).toBeVisible();
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('combobox', { name: t('stock.form.owner') })).toHaveValue(kiln);
  await expect(sheet.getByText(t('stock.scan.notOnShelf'))).toBeVisible();
  await sheet.getByLabel(t('stock.scan.grams')).fill('250');
  await sheet.getByRole('button', { name: t('stock.scan.saveNextClub', { club: name }) }).click();
  // The shown (club) part of the shelf lists the new entry; the personal one keeps its 400 g out of view.
  const row = (amount: string) => page.getByRole('main').getByRole('button', { name: t('stock.row.editAmount', { amount, glaze: `Shelf ${uid} F-1 Fern` }) });
  await expect(row('250 g')).toBeAttached();
  await expect(row('400 g')).toHaveCount(0);
});

test('an unknown code in the club scan session opens the add-glaze dialog on that club', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  film(uid);
  const name = `Kiln ${uid}`;
  const kiln = (await api.createClub(name)).id;
  await shell.open(`#/stock?shelf=${kiln}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('main').getByText(t('stock.shelves.emptyClub', { club: name }))).toBeVisible();
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  const add = new AddGlazeDialog(page);
  await expect(add.dialog).toBeVisible();
  await expect(add.dialog.getByRole('combobox', { name: t('stock.form.owner'), exact: true })).toHaveValue(kiln);
  await expect(add.field('glazeForm.shelf.quantity')).toHaveValue('250');
});

test('a jar new to the club shelf starts at 250 g: closing asks nothing, Save adds it untouched', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const barcode = film(uid);
  const fern = await api.addGlaze({ newManufacturer: { name: `Prefill ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Fern', barcode });
  const name = `Kiln ${uid}`;
  const kiln = (await api.createClub(name)).id;
  await shell.open(`#/stock?shelf=${kiln}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('main').getByText(t('stock.shelves.emptyClub', { club: name }))).toBeVisible();
  const sheet = page.getByRole('dialog', { name: t('stock.scan.titleClub', { club: name }) });
  const scan = async () => {
    await page.getByRole('button', { name: t('stock.scan.button') }).click();
    await expect(sheet.getByText(t('stock.scan.notOnShelf'))).toBeVisible();
  };
  await scan();
  await expect(sheet.getByLabel(t('stock.scan.grams'))).toHaveValue('250');
  // The prefilled amount alone is nothing to lose.
  await sheet.getByRole('button', { name: t('common.close'), exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('dialog', { name: t('drafts.discardShelfScan') })).toHaveCount(0);
  await scan();
  await sheet.getByRole('button', { name: t('stock.scan.saveNextClub', { club: name }) }).click();
  await expect
    .poll(async () => (await api.stock()).filter((entry) => entry.glazeId === fern.id).map((entry) => `${entry.clubId} ${entry.quantityG}`))
    .toEqual([`${kiln} 250`]);
});

test('a held code keeps the camera on however long the typing takes; the idle limit starts on release', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  isMobile,
}) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const barcode = film(uid);
  await api.addGlaze({ newManufacturer: { name: `Held ${uid}`, shortId: uid.toUpperCase() }, code: 'H-1', name: 'Held', barcode });
  await page.clock.install();
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  const sheet = page.getByRole('dialog');
  const grams = sheet.getByLabel(t('stock.scan.grams'));
  await expect(grams).toBeVisible();
  // One jump each, so the scan loop's timers do not all run on the way.
  await page.clock.fastForward(5 * 60_000);
  await expect(sheet.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
  await expect(sheet.getByText(t('barcodes.scanner.pausedIdle'))).toHaveCount(0);
  await grams.fill('250');
  await sheet.getByRole('button', { name: t('stock.scan.saveNext') }).click();
  await expect(grams).toBeHidden();
  await page.clock.fastForward(2 * 60_000);
  await expect(sheet.getByText(t('barcodes.scanner.pausedIdle'))).toBeVisible();
});
