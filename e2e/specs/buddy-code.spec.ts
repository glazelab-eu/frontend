import { t } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';

/** "Show my buddy code" in the phone account menu: a working buddy link and its QR code, made on the first open and shown again from memory. */
test('the phone account menu shows a working buddy code, once made and again without a new link', async ({ page, shell, signedIn, newApi, uid, isMobile }) => {
  test.skip(!isMobile, 'the account menu is a phone control');
  const creations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/buddies/link') creations.push(request.url());
  });
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const header = page.getByRole('banner');
  const openCode = async () => {
    await header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }).click();
    await header.getByRole('button', { name: t('header.buddyCode') }).click();
    return page.getByRole('dialog', { name: t('buddies.code.title') });
  };

  const dialog = await openCode();
  const field = dialog.getByRole('textbox', { name: t('buddies.link.field') });
  await expect(field).toHaveValue(/#\/buddy\/[\w-]+$/);
  await expect(dialog.getByRole('img', { name: /QR/i }).first()).toBeVisible();
  // No warning about an earlier link: this entry just shows a working code.
  await expect(dialog).not.toContainText(t('buddies.link.hint'));
  const link = await field.inputValue();

  // The link is a real buddy link: another account sees whose it is.
  const other = await newApi();
  await other.signUp({ ...newAccount(uid, 'Other'), displayName: 'Other' });
  const preview = await other.previewBuddyLink(link.split('#/buddy/')[1]);
  expect(preview.displayName).toBe(signedIn.displayName);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The second open shows the same link from memory; nothing is created again.
  const again = await openCode();
  await expect(again.getByRole('textbox', { name: t('buddies.link.field') })).toHaveValue(link);
  expect(creations).toHaveLength(1);
});
