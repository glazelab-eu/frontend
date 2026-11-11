import { t } from '../support/i18n';
import { chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// No capture device at all (never the host's webcams).
test.use({ launchOptions: { executablePath: chromeBinary(), args: ['--use-fake-device-for-media-stream=device-count=0'] }, permissions: ['camera'] });

test('a device without a camera says no camera was found', async ({ page, shell, signedIn }) => {
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('clubs.scan') })
    .click();
  await expect(page.getByRole('dialog', { name: t('clubs.scan') }).getByRole('alert')).toHaveText(t('links.scanner.missing'));
});

test('no camera in the phone account menu says so', async ({ page, shell, signedIn, isMobile }) => {
  test.skip(!isMobile, 'the account menu is a phone control');
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('banner')
    .getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) })
    .click();
  await page
    .getByRole('banner')
    .getByRole('button', { name: t('header.scan') })
    .click();
  await expect(page.getByRole('dialog', { name: t('links.scanner.title') }).getByRole('alert')).toHaveText(t('links.scanner.missing'));
});
