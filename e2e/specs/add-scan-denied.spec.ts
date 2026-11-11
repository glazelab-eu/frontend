import { t } from '../support/i18n';
import { chromeBinary } from '../support/paths';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { expect, test } from '../support/test';

// A fake device exists but the permission is denied.
test.use({ launchOptions: { executablePath: chromeBinary(), args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] }, permissions: [] });

test('a denied camera explains itself and "Add without a barcode" still works', async ({ page, shell, signedIn, isMobile }) => {
  test.skip(!isMobile, 'the scanner comes first on the phone');
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  const add = new AddGlazeDialog(page);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('addGlaze.action') })
    .first()
    .click();
  await expect(add.scanner.getByRole('alert')).toHaveText(t('barcodes.scanner.denied'));
  await add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode') }).click();
  await expect(add.dialog).toBeVisible();
});

test('Scan barcode retains the common manual fallback after a camera denial at every width', async ({ page, shell, signedIn, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  const scan = page.getByRole('main').getByRole('button', { name: t('barcodes.scan'), exact: true });
  await scan.click();
  const add = new AddGlazeDialog(page);
  await expect(add.scanner.getByRole('alert')).toHaveText(t('barcodes.scanner.denied'));
  await add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode'), exact: true }).click();
  await expect(add.dialog).toBeVisible();
  await add.close();
  await expect(scan).toBeFocused();
});
