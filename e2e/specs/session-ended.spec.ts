import { join } from 'node:path';
import { DIALOG, expectAccessible } from '../support/axe';
import { PASSWORD, type Account, type Api } from '../support/api';
import { t } from '../support/i18n';
import { AuthDialog } from '../support/pages/auth';
import { PasswordDialog } from '../support/pages/password';
import { StudioPage } from '../support/pages/studio';
import { expect, newAccount, test } from '../support/test';

const NEW_PASSWORD = 'a fresh coat of celadon';
/** Screenshots for a reviewer, only when asked for. */
const SHOTS = process.env.GLAZELAB_E2E_SHOTS;

/** Ends the page's login session from another device: it signs in and changes the password, which signs every other device out. */
async function endSessionElsewhere(newApi: () => Promise<Api>, account: Account): Promise<void> {
  const other = await newApi();
  await other.signIn(account);
  await other.changePassword(PASSWORD, NEW_PASSWORD);
}

test('a favourite saved after the session ended elsewhere shows the sign-in with a notice instead of an error @smoke', async ({
  page,
  shell,
  api,
  signedIn,
  newApi,
  uid,
}) => {
  const glaze = await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: uid }, name: 'Seegrün', code: 'SG-1' });
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('button', { name: t('favorites.add') })).toBeVisible();

  await endSessionElsewhere(newApi, signedIn);
  // The dead session is logged out too, then the cache clearing goes, whose answer carries Clear-Site-Data "cache" (30-2, LOGOUT-2).
  const loggedOut = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/logout');
  const cleared = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/clear-cache');
  await page.getByRole('button', { name: t('favorites.add') }).click();
  expect((await (await loggedOut).allHeaders())['clear-site-data']).toBeUndefined();
  expect((await (await cleared).allHeaders())['clear-site-data']).toBe('"cache"');

  const auth = new AuthDialog(page);
  await expect(auth.dialog).toBeVisible();
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('auth.sessionEnded'));
  // No raw error, and the page is the guest's now.
  await expect(page.getByText(t('errors.signInRequired'))).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('favorites.signIn') })).toBeVisible();

  await auth.signIn({ ...signedIn, password: NEW_PASSWORD });
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('favorites.add') }).click();
  await expect(page.getByRole('button', { name: t('favorites.remove') })).toBeVisible();
});

test('a Studio form keeps its input when the session ended elsewhere, and saves after signing in again', async ({
  page,
  shell,
  api,
  signedIn,
  newApi,
  uid,
}) => {
  await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: uid }, name: 'Seegrün', code: 'SG-1' });
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.addGlazeStep(`Botz ${uid} SG-1`);
  await studio.title.fill(`Celadon over slip ${uid}`);

  // Input that waits for the same account keeps the session's browser state: no logout request is sent (30-2).
  const logouts: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/logout') logouts.push(request.url());
  });
  await endSessionElsewhere(newApi, signedIn);
  await studio.publish();

  const auth = new AuthDialog(page);
  await expect(auth.dialog).toBeVisible();
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('auth.sessionEndedKept'));
  expect(logouts).toEqual([]);
  await expectAccessible(page, { include: [DIALOG] });
  await expect(page.getByText(t('errors.signInRequired'))).toHaveCount(0);
  // The form behind the dialog is as it was left.
  await expect(studio.title).toHaveValue(`Celadon over slip ${uid}`);

  await auth.signIn({ ...signedIn, password: NEW_PASSWORD });
  await shell.expectSignedIn(signedIn.displayName);
  await expect(studio.title).toHaveValue(`Celadon over slip ${uid}`);
  await studio.publish();
  await expect(page.getByRole('heading', { level: 1, name: `Celadon over slip ${uid}` })).toBeVisible();
  await expect(page).toHaveURL(/#\/combinations\/[0-9a-f-]{36}$/);
});

test('a kept Studio form stays quiet at a background load after the notice, and only a save attempt reopens the sign-in', async ({
  page,
  shell,
  api,
  signedIn,
  newApi,
  uid,
}) => {
  await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: uid }, name: 'Seegrün', code: 'SG-1' });
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.addGlazeStep(`Botz ${uid} SG-1`);
  await studio.title.fill(`Celadon over slip ${uid}`);

  await endSessionElsewhere(newApi, signedIn);
  await studio.publish();
  const auth = new AuthDialog(page);
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('auth.sessionEndedKept'));
  await page.keyboard.press('Escape');
  await expect(auth.dialog).toBeHidden();

  // A return to the app or a reconnect looks at the session again: it is still dead, and nothing happens on the page.
  const me = page.waitForResponse((response) => response.url().endsWith('/api/auth/me') && response.status() === 401);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await me;
  await page.waitForTimeout(500);
  await expect(auth.dialog).toBeHidden();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(studio.title).toHaveValue(`Celadon over slip ${uid}`);

  // A save attempt does ask again, and signing in saves the kept form.
  await studio.publish();
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('auth.sessionEndedKept'));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${test.info().project.name}-kept-reopened.png`) });
  await auth.signIn({ ...signedIn, password: NEW_PASSWORD });
  await expect(studio.title).toHaveValue(`Celadon over slip ${uid}`);
  await studio.publish();
  await expect(page).toHaveURL(/#\/combinations\/[0-9a-f-]{36}$/);
});

test('another account signing in over a kept Studio form sees none of it and cannot save it', async ({ page, shell, api, signedIn, newApi, uid }) => {
  await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: uid }, name: 'Seegrün', code: 'SG-1' });
  const bo = newAccount(`${uid}b`, 'Bo');
  await (await newApi()).register(bo);
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.addGlazeStep(`Botz ${uid} SG-1`);
  await studio.title.fill(`Ana's private notes ${uid}`);

  await endSessionElsewhere(newApi, signedIn);
  await studio.publish();
  const auth = new AuthDialog(page);
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('auth.sessionEndedKept'));

  await auth.signIn(bo);
  await shell.expectSignedIn(bo.displayName);
  // The previous account's input is gone with it: an empty form for Bo, and nothing of Ana's was saved under Bo.
  await expect(studio.title).toHaveValue('');
  await expect(page.getByText(`Ana's private notes ${uid}`)).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${test.info().project.name}-other-account.png`) });
  // Nothing is retried for Bo: Explore lists no combination with Ana's title.
  await shell.open('#/');
  await shell.expectSignedIn(bo.displayName);
  await expect(page.getByText(`Ana's private notes ${uid}`)).toHaveCount(0);
});

test('a password change on the account page after the session ended elsewhere closes the dialog and asks to sign in', async ({
  page,
  shell,
  signedIn,
  newApi,
}) => {
  const password = new PasswordDialog(page);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await password.open();
  await endSessionElsewhere(newApi, signedIn);
  await password.submit(NEW_PASSWORD, 'yet another coat of celadon');

  const auth = new AuthDialog(page);
  await expect(auth.dialog.getByRole('alert')).toHaveText(t('auth.sessionEnded'));
  await expect(password.dialog).toBeHidden();
  await auth.signIn({ ...signedIn, password: NEW_PASSWORD });
  await shell.expectSignedIn(signedIn.displayName);
});
