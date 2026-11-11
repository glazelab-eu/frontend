import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// STOCK-1 review: a typed amount in the scan sheet sets the amount (last write wins), even after the + steps moved it, so the
// jars the person counted are what the shelf holds, never that count added on top of what another device stored. A file of its
// own: one barcode per worker, filmed by the fake camera (stale-jar-scan.spec.ts has the + steps' addition).

const JAR = 250;
const barcode = eanFor(`stale-jar-scan-typed-${process.pid}-${Date.now()}`);
const video = join(FIXTURES, `stale-jar-scan-typed-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(barcode));

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

test('a typed amount after + sets what the shelf holds, whatever another device stored meanwhile', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
  isMobile,
}) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const created = await api.addGlaze({ newManufacturer: { name: `Typed ${uid}`, shortId: `${uid}T` }, code: 'TJ-1', name: 'Slate', barcode });
  await api.addStock({ glazeId: created.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText(t('stock.form.current', { quantity: '250' }))).toBeVisible();
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: created.id, ownerType: 'personal', quantityG: 2 * JAR });
  await sheet.getByRole('button', { name: t('stock.scan.moreJar') }).click();
  await sheet.getByLabel(t('stock.scan.grams')).fill(String(3 * JAR));
  await sheet.getByRole('button', { name: t('stock.scan.saveNext') }).click();
  await expect.poll(async () => (await api.stock()).find((item) => item.glazeId === created.id && !item.clubId)?.quantityG).toBe(3 * JAR);
});
