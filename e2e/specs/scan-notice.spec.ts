import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { AuthDialog } from '../support/pages/auth';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, newAccount, test } from '../support/test';

// Explore's scan notice names what was scanned before: an account change (signing in, signing out) clears it.
const video = join(FIXTURES, `scan-notice-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(null));

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

test("a guest's scan notice is gone once someone signs in", async ({ page, shell, newApi, uid }) => {
  const account = newAccount(uid, 'Ana');
  await (await newApi()).register(account);
  const barcode = eanFor(`scan-notice-${uid}`);
  writeFileSync(video, barcodeVideo(barcode));
  await shell.open();
  await page
    .getByRole('main')
    .getByRole('button', { name: t('barcodes.scan'), exact: true })
    .click();
  const notice = page.getByText(t('barcodes.discover.unknown', { barcode }));
  await expect(notice).toBeVisible({ timeout: 20_000 });
  writeFileSync(video, barcodeVideo(null));
  await shell.signInButton().click();
  await new AuthDialog(page).signIn(account);
  await shell.expectSignedIn(account.displayName);
  await expect(notice).toHaveCount(0);
});
