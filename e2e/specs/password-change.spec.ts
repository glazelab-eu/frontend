import { Api, PASSWORD } from '../support/api';
import { t } from '../support/i18n';
import { AuthDialog } from '../support/pages/auth';
import { AppShell } from '../support/pages/app-shell';
import { PasswordDialog } from '../support/pages/password';
import { expect, test } from '../support/test';

const NEW_PASSWORD = 'a fresh coat of celadon';

test('a member changes the password, signs out and signs in with the new one @smoke', async ({ page, shell, signedIn }) => {
  const password = new PasswordDialog(page);
  await shell.open();
  await shell.openAccountPage(signedIn.displayName);
  await password.open();
  await expect(password.current()).toBeFocused();
  await password.submit(PASSWORD, NEW_PASSWORD);
  await expect(password.dialog).toBeHidden();
  await expect(page.getByText(t('notices.passwordChangedHere'))).toBeVisible();
  await expect(password.opener).toBeFocused();
  await shell.expectSignedIn(signedIn.displayName);

  await shell.signOut();
  await shell.expectGuest();
  await shell.signInButton().click();
  await new AuthDialog(page).signIn({ ...signedIn, password: NEW_PASSWORD });
  await shell.expectSignedIn(signedIn.displayName);
});

test('the old password no longer signs in after a change', async ({ page, shell, signedIn }) => {
  const password = new PasswordDialog(page);
  await shell.open('#/account');
  await password.open();
  await password.submit(PASSWORD, NEW_PASSWORD);
  await expect(password.dialog).toBeHidden();
  await shell.signOut();
  const auth = new AuthDialog(page);
  await shell.signInButton().click();
  await auth.dialog.getByLabel(t('common.email')).fill(signedIn.email);
  await auth.dialog.getByLabel(t('auth.password')).fill(PASSWORD);
  await auth.dialog.getByRole('button', { name: t('common.signIn'), exact: true }).click();
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('errors.badCredentials'));
  await shell.expectGuest();
});

test('a change signs out the other devices and keeps this one signed in', async ({ page, shell, signedIn, browser, baseURL, isMobile }) => {
  // Playwright gives a context made in a test the project's options, so the other device has this one's layout.
  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await new Api(otherPage.request).signIn(signedIn);
    const otherShell = new AppShell(otherPage, isMobile);
    await otherShell.open();
    await otherShell.expectSignedIn(signedIn.displayName);

    const password = new PasswordDialog(page);
    await shell.open('#/account');
    await password.open();
    await password.submit(PASSWORD, NEW_PASSWORD);
    await expect(password.dialog).toBeHidden();

    await otherPage.reload();
    await otherShell.expectGuest();
    await page.reload();
    await shell.expectSignedIn(signedIn.displayName);
  } finally {
    await other.close();
  }
});

test('a wrong current password keeps the dialog open with the error', async ({ page, shell, signedIn }) => {
  const password = new PasswordDialog(page);
  await shell.open('#/account');
  await password.open();
  await password.submit('not the password', NEW_PASSWORD);
  await expect(password.dialog.getByRole('alert')).toHaveText(t('errors.passwordWrong'));
  await expect(password.dialog.getByRole('alert')).toBeFocused();
  await expect(password.dialog).toBeVisible();
  await shell.expectSignedIn(signedIn.displayName);
});

test('a confirmation that differs is refused before anything is sent', async ({ page, shell, signedIn }) => {
  const password = new PasswordDialog(page);
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/password/change')) sent.push(request.url());
  });
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await password.open();
  await password.submit(PASSWORD, NEW_PASSWORD, `${NEW_PASSWORD}!`);
  await expect(password.dialog.getByRole('alert')).toHaveText(t('errors.passwordsMismatch'));
  expect(sent).toEqual([]);
});

test('Escape closes the dialog and returns focus to its button', async ({ page, shell, signedIn }) => {
  const password = new PasswordDialog(page);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await password.open();
  await password.current().fill('typed but not sent');
  await page.keyboard.press('Escape');
  await expect(password.dialog).toBeHidden();
  await expect(password.opener).toBeFocused();
  // A new dialog starts empty.
  await password.open();
  await expect(password.current()).toHaveValue('');
});
