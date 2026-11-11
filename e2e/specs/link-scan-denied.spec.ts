import { t } from '../support/i18n';
import { chromeBinary } from '../support/paths';
import { expect, test } from '../support/test';

// The permission is not granted and the browser denies the prompt (a fake device exists, so only the permission is missing).
test.use({ launchOptions: { executablePath: chromeBinary(), args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] }, permissions: [] });

test('a denied camera says so, offers the link instead and opens nothing', async ({ page, shell, signedIn }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('buddies.scan') })
    .click();
  const sheet = page.getByRole('dialog', { name: t('buddies.scan') });
  await expect(sheet.getByRole('alert')).toHaveText(t('links.scanner.denied'));
  // A barcode field makes no sense for a link: there is none.
  await expect(sheet.getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('a denied camera in the phone account menu says so and opens nothing', async ({ page, shell, signedIn, isMobile }) => {
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
  const sheet = page.getByRole('dialog', { name: t('links.scanner.title') });
  await expect(sheet.getByRole('alert')).toHaveText(t('links.scanner.denied'));
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
