import type { Route } from '@playwright/test';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { AuthDialog } from '../support/pages/auth';
import { expect, test } from '../support/test';

/**
 * The mocked session: `/me` names the account until a logout answer arrives. `answer` decides that answer (after `delayMs`); the
 * cache clearing that follows it (`Clear-Site-Data: "cache"`, which the browser may hold for seconds, LOGOUT-2) answers after
 * `clearDelayMs`. A sign-in names the account again.
 */
async function session(page: Parameters<typeof mockApi>[0], answer: { delayMs: number; status: number; clearDelayMs?: number }) {
  const state = { signedIn: true, logouts: 0, clears: 0, order: [] as string[] };
  await mockApi(page, {
    answers: {
      'GET /api/auth/me': (route: Route) =>
        state.signedIn ? route.fulfill({ json: MOCK_USER }) : route.fulfill({ status: 401, json: { error: 'Please sign in.' } }),
      'POST /api/auth/logout': async (route: Route) => {
        state.logouts++;
        await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
        if (answer.status < 300) state.signedIn = false;
        state.order.push('logout');
        await route.fulfill(answer.status < 300 ? { status: 200 } : { status: answer.status, json: { error: 'Boom' } }).catch(() => undefined);
      },
      'GET /api/auth/clear-cache': async (route: Route) => {
        state.clears++;
        state.order.push('clear');
        await new Promise((resolve) => setTimeout(resolve, answer.clearDelayMs ?? 0));
        await route.fulfill({ status: 204 }).catch(() => undefined);
      },
      'POST /api/auth/login': async (route: Route) => {
        state.signedIn = true;
        state.order.push('login');
        await route.fulfill({ json: { ok: true } });
      },
    },
  });
  return state;
}

test('signing out shows the signed-out page at once while the server answer is slow', async ({ page, shell }) => {
  const state = await session(page, { delayMs: 8_000, status: 200 });
  await shell.open();
  await shell.expectSignedIn(MOCK_USER.displayName);
  await shell.signOut();
  // Within about a second, long before the answer: the account is gone from the page and a short status says what still runs.
  await expect(shell.signInButton()).toBeVisible({ timeout: 1_000 });
  await expect(page.getByText(MOCK_USER.displayName, { exact: true }).filter({ visible: true })).toHaveCount(0);
  const status = page.getByRole('status').getByText(t('notices.signingOut'));
  await expect(status).toBeVisible();
  expect(state.logouts).toBe(1);
  // Once the server confirmed, the status goes and the sign-out is announced.
  await expect(page.getByRole('status').getByText(t('notices.signedOut'))).toBeVisible({ timeout: 12_000 });
  await expect(status).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('glazelab:v1:pendingLogout'))).toBeNull();
  await shell.expectGuest();
});

test('a failed sign-out request keeps the device signed out and is sent again at the next start', async ({ page, shell }) => {
  const state = await session(page, { delayMs: 0, status: 500 });
  await shell.open();
  await shell.expectSignedIn(MOCK_USER.displayName);
  await shell.signOut();
  await expect(page.getByRole('status').getByText(t('notices.signedOutPending'))).toBeVisible();
  await shell.expectGuest();
  expect(await page.evaluate(() => localStorage.getItem('glazelab:v1:pendingLogout'))).toBe('1');
  const before = state.logouts;
  await page.reload();
  await shell.expectGuest();
  await expect.poll(() => state.logouts).toBe(before + 1);
});

test('a sign-in right after signing out waits only for the sign-out answer, not for the slow cache clearing', async ({ page, shell }) => {
  const state = await session(page, { delayMs: 0, status: 200, clearDelayMs: 8_000 });
  await shell.open();
  await shell.expectSignedIn(MOCK_USER.displayName);
  const pressed = Date.now();
  await shell.signOut();
  await expect(page.getByRole('status').getByText(t('notices.signedOut'))).toBeVisible({ timeout: 2_000 });
  await shell.signInButton().click();
  await new AuthDialog(page).signIn({ email: MOCK_USER.email, password: 'secret-password', displayName: MOCK_USER.displayName });
  await shell.expectSignedIn(MOCK_USER.displayName);
  // Well before the clearing answers (8 s): nothing waited for it.
  expect(Date.now() - pressed).toBeLessThan(3_000);
  expect(state.clears).toBe(1);
  expect(state.order).toEqual(['logout', 'clear', 'login']);
});
