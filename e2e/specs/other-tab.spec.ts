import type { Page } from '@playwright/test';
import { t } from '../support/i18n';
import { AppShell } from '../support/pages/app-shell';
import { AuthDialog } from '../support/pages/auth';
import { expect, test } from '../support/test';
import type { Account } from '../support/api';

/**
 * FE-4: another tab of the same browser signs out and in again, which replaces the CSRF cookie this tab's cached token matched.
 * The first write here is refused once (403) and repeated with a fresh token; nothing shows.
 */
async function signOutAndInElsewhere(page: Page, isMobile: boolean, account: Account): Promise<void> {
  const other = await page.context().newPage();
  const shell = new AppShell(other, isMobile);
  await shell.open('#/');
  await shell.expectSignedIn(account.displayName);
  await shell.signOut();
  await expect(other.getByRole('status').getByText(t('notices.signedOut'))).toBeVisible({ timeout: 15_000 });
  await shell.signInButton().click();
  await new AuthDialog(other).signIn(account);
  await shell.expectSignedIn(account.displayName);
  await other.close();
}

/** The status of every answer to a request of this tab whose path matches. */
function answers(page: Page, path: RegExp): number[] {
  const statuses: number[] = [];
  page.on('response', (response) => {
    if (path.test(new URL(response.url()).pathname)) statuses.push(response.status());
  });
  return statuses;
}

test('a write after another tab signed out and in again goes through with a fresh token', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  const glaze = await api.addGlaze({ newManufacturer: { name: `Tabb ${uid}`, shortId: uid }, name: 'Zweitblau', code: 'ZB-1' });
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  // The first write caches this tab's token.
  await main
    .getByRole('button', { name: t('favorites.add'), exact: true })
    .first()
    .click();
  await expect(main.getByRole('button', { name: t('favorites.remove'), exact: true }).first()).toBeVisible();

  await signOutAndInElsewhere(page, isMobile, signedIn);
  const favourites = answers(page, /^\/api\/favorites\/glazes\//);
  await main
    .getByRole('button', { name: t('favorites.remove'), exact: true })
    .first()
    .click();
  await expect(main.getByRole('button', { name: t('favorites.add'), exact: true }).first()).toBeVisible();
  // Refused once for the stale token, then accepted; the page shows no error.
  await expect.poll(() => favourites).toEqual([403, 200]);
  await expect(page.getByText(t('errors.accessDenied'))).toHaveCount(0);
  await shell.expectSignedIn(signedIn.displayName);
});

test('a sign-out after another tab signed out and in again completes', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  const glaze = await api.addGlaze({ newManufacturer: { name: `Tabc ${uid}`, shortId: uid }, name: 'Drittblau', code: 'DB-1' });
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main
    .getByRole('button', { name: t('favorites.add'), exact: true })
    .first()
    .click();
  await expect(main.getByRole('button', { name: t('favorites.remove'), exact: true }).first()).toBeVisible();

  await signOutAndInElsewhere(page, isMobile, signedIn);
  const logouts = answers(page, /^\/api\/auth\/logout$/);
  await shell.signOut();
  // Before, the logout kept the stale token: refused on every load, the page showed itself offline until a reload.
  await expect(page.getByRole('status').getByText(t('notices.signedOut'))).toBeVisible({ timeout: 15_000 });
  await shell.expectGuest();
  expect(logouts).toEqual([403, 200]);
  expect(await page.evaluate(() => localStorage.getItem('glazelab:v1:pendingLogout'))).toBeNull();
});
