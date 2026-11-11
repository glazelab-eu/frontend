import { t } from '../support/i18n';
import { chromeBinary } from '../support/paths';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { expect, test } from '../support/test';

// A device without WebAssembly (iPhone in Lockdown Mode, hardened browsers) cannot run the ZXing fallback.
test.use({ launchOptions: { executablePath: chromeBinary(), args: ['--use-fake-device-for-media-stream'] } });

test('without WebAssembly the scanner says so, never opens the camera and typing still works', async ({ page, shell, signedIn, isMobile }) => {
  await page.addInitScript(() => {
    delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
    delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    const w = window as unknown as { __cameraAsked: number };
    w.__cameraAsked = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      w.__cameraAsked++;
      return original(constraints);
    };
  });
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('barcodes.scan'), exact: true })
    .click();
  const add = new AddGlazeDialog(page);
  await expect(add.scanner.getByRole('alert')).toHaveText(t('barcodes.scanner.noWasm'));
  expect(await page.evaluate(() => (window as unknown as { __cameraAsked: number }).__cameraAsked)).toBe(0);
  await add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode'), exact: true }).click();
  await expect(add.dialog).toBeVisible();
});
