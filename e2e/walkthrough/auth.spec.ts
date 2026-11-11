import { PASSWORD } from '../support/api';
import { t } from '../support/i18n';
import { AuthDialog } from '../support/pages/auth';
import { expect, test } from './support';
import { accountOf } from './seed';

/** Sign-in, forgotten password, sign-up with the password step (the mail-free server skips the email), and sign-out. */
test('sign in, sign up and sign out dialogs', async ({ page, begin, finish, human }) => {
  const auth = new AuthDialog(page);
  const header = page.getByRole('banner');
  const me = accountOf('me');
  await begin('#/', (p) =>
    p
      .getByRole('button', { name: t('common.signIn'), exact: true })
      .first()
      .waitFor(),
  );

  await human.tap(header.getByRole('button', { name: t('common.signIn'), exact: true }));
  await expect(auth.dialog).toBeVisible();
  await human.pause(1500);
  await human.type(auth.dialog.getByLabel(t('common.email')), me.email);
  await human.type(auth.dialog.getByLabel(t('auth.password')), me.password);
  await human.tap(auth.dialog.getByRole('button', { name: t('common.signIn'), exact: true }));
  await expect(auth.dialog).toBeHidden();
  await human.pause(2200);

  // Sign out through the phone's account menu.
  await human.tap(header.getByRole('button', { name: /^Account menu/ }));
  await human.tap(header.getByRole('button', { name: t('header.signOut') }));
  await expect(header.getByRole('button', { name: t('common.signIn'), exact: true })).toBeVisible();
  await human.pause(1800);

  // Sign up: name and email, then the password step, which accepts the terms.
  await human.tap(header.getByRole('button', { name: t('common.signIn'), exact: true }));
  await human.tap(auth.dialog.getByRole('button', { name: t('auth.register.switch') }));
  await human.type(auth.dialog.getByLabel(t('auth.name')), 'Noor Haddad');
  await human.type(auth.dialog.getByLabel(t('common.email')), 'noor@example.test');
  await human.tap(auth.dialog.getByRole('button', { name: t('auth.register.submit') }));
  await expect(auth.setup).toBeVisible();
  await human.pause(1500);
  await human.type(auth.setup.getByLabel(t('account.link.newPassword')), PASSWORD);
  await human.type(auth.setup.getByLabel(t('account.link.confirmPassword')), PASSWORD);
  await human.tap(auth.setup.getByLabel(t('auth.terms.accept')));
  await human.tap(auth.setup.getByRole('button', { name: t('account.link.activate') }));
  await expect(auth.setup).toBeHidden();
  await human.pause(2500);
  await finish('sign-in-up');
});

/** The emailed links: the verification link (a working one, from the mail-free sign-up) and the expired login and reset links. */
test('emailed links: verify, expired login and reset', async ({ page, begin, finish, human }) => {
  const auth = new AuthDialog(page);
  const token = await (async () => {
    const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { token: string };
    const registration = await page.request.post('/api/auth/register', {
      headers: { 'X-XSRF-TOKEN': csrf.token },
      data: { email: 'rina@example.test', displayName: 'Rina Costa' },
    });
    return ((await registration.json()) as { setupToken: string }).setupToken;
  })();
  await begin(`#/verify/${token}`, async () => page.getByRole('dialog').waitFor());
  await human.pause(2200);
  await human.tap(page.getByRole('dialog').getByRole('button', { name: t('account.link.verifyTitle') }));
  const activation = page.getByRole('dialog');
  await human.pause(1500);
  await human.type(activation.getByLabel(t('auth.name')), 'Rina Costa');
  await human.type(activation.getByLabel(t('account.link.newPassword')), PASSWORD);
  await human.type(activation.getByLabel(t('account.link.confirmPassword')), PASSWORD);
  await human.tap(activation.getByLabel(t('auth.terms.accept')));
  await human.tap(activation.getByRole('button', { name: t('account.link.activate') }));
  await human.pause(3000);
  for (const route of ['login', 'reset']) {
    await human.tryStep(route, async () => {
      await page.evaluate((hash) => (location.hash = hash), `#/${route}/an-old-link-that-has-expired`);
      await human.pause(1500);
      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible()) {
        await human.pause(2500);
        if (route === 'reset') await human.type(dialog.getByLabel(t('account.link.newPassword')), 'short');
        await human.tap(dialog.getByRole('button').last());
        await human.pause(2500);
      }
    });
  }
  await finish('email-links');
});
