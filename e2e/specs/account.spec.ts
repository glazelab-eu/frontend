import { PASSWORD } from '../support/api';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { AuthDialog } from '../support/pages/auth';
import { expect, newAccount, test } from '../support/test';

test('a visitor signs up without mail, chooses a password and is signed in @smoke', async ({ page, shell, uid }) => {
  const account = newAccount(uid, 'Bea');
  const auth = new AuthDialog(page);
  await shell.open();
  await shell.signInButton().click();
  await auth.register(account);
  await expect(auth.setup.getByLabel(t('auth.name'))).toHaveValue(account.displayName);
  await auth.choosePassword(PASSWORD);
  await shell.expectSignedIn(account.displayName);
});

test('the password step refuses more than 72 bytes before sending and names the address for password managers', async ({ page, shell, uid }) => {
  const account = newAccount(uid, 'Bea');
  const auth = new AuthDialog(page);
  await shell.open();
  await shell.signInButton().click();
  await auth.register(account);
  await expect(auth.setup.locator('input[autocomplete="username"]')).toHaveValue(account.email);
  let sent = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/auth/')) sent++;
  });
  const tooLong = 'ü'.repeat(37);
  await auth.setup.getByLabel(t('account.link.newPassword')).fill(tooLong);
  await auth.setup.getByLabel(t('account.link.confirmPassword')).fill(tooLong);
  await auth.setup.getByLabel(t('auth.terms.accept')).check();
  await auth.setup.getByRole('button', { name: t('account.link.activate') }).click();
  await expect(auth.setup.getByRole('alert')).toHaveText(t('errors.passwordTooLong'));
  expect(sent).toBe(0);
  await auth.choosePassword(PASSWORD);
  await shell.expectSignedIn(account.displayName);
});

test('a member signs in and out @smoke', async ({ page, shell, account }) => {
  const auth = new AuthDialog(page);
  await shell.open();
  await shell.signInButton().click();
  await auth.signIn(account);
  await shell.expectSignedIn(account.displayName);
  await shell.signOut();
  await shell.expectGuest();
});

test('a signed-in member stays signed in after a reload', async ({ page, shell, signedIn }) => {
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
});

test('a wrong password keeps the dialog open with an error', async ({ page, shell, account }) => {
  const auth = new AuthDialog(page);
  await shell.open();
  await shell.signInButton().click();
  await auth.dialog.getByLabel(t('common.email')).fill(account.email);
  await auth.dialog.getByLabel(t('auth.password')).fill('not the password');
  await auth.dialog.getByRole('button', { name: t('common.signIn'), exact: true }).click();
  await expect(auth.dialog.getByRole('alert')).toBeVisible();
  await shell.expectGuest();
});

test('after five failed sign-ins the address waits, even with the right password, and says why', async ({ page, shell, account }) => {
  const auth = new AuthDialog(page);
  await shell.open();
  await shell.signInButton().click();
  await auth.dialog.getByLabel(t('common.email')).fill(account.email);
  const password = auth.dialog.getByLabel(t('auth.password'));
  const submit = auth.dialog.getByRole('button', { name: t('common.signIn'), exact: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    await password.fill(`not the password ${attempt}`);
    await submit.click();
    await expect(auth.dialog.getByRole('alert')).toHaveText(t('errors.badCredentials'));
    await expect(submit).toBeEnabled();
  }
  await password.fill(account.password);
  await submit.click();
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('errors.signInDelayed'));
  await shell.expectGuest();
});

test.describe('changed terms', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { user: { ...MOCK_USER, acceptedTermsVersion: '2000-01-01.1' } });
  });

  test('block the account until it accepts them @smoke', async ({ page }) => {
    await page.goto('/#/');
    const terms = page.getByRole('dialog', { name: t('terms.update.title') });
    const accept = terms.getByRole('button', { name: t('terms.update.accept') });
    await expect(accept).toBeDisabled();
    await terms.getByLabel(t('auth.terms.accept')).check();
    await accept.click();
    await expect(terms).toBeHidden();
  });

  test('let the account sign out instead', async ({ page, shell }) => {
    await page.goto('/#/');
    const terms = page.getByRole('dialog', { name: t('terms.update.title') });
    await terms.getByRole('button', { name: t('header.signOut') }).click();
    await expect(terms).toBeHidden();
    await shell.expectGuest();
  });
});
