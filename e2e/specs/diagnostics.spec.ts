import type { Page, Request } from '@playwright/test';
import { PASSWORD } from '../support/api';
import { t } from '../support/i18n';
import { AuthDialog } from '../support/pages/auth';
import { AccountPage } from '../support/pages/account';
import { expect, newAccount, test as base } from '../support/test';

/**
 * Error reports (32-2). The suite's API is the real one; what arrives is read from the network (the status the server answered and the
 * body the page sent), because reading the stored reports is the admin page's job (32-3). The reports' deletion on opt-out and the
 * server's own rules are covered by the backend tests.
 */
// This spec raises unhandled rejections on purpose: the suite's fixture that fails a test on page errors is replaced by a quiet one.
const test = base.extend({ pageErrors: [async ({}, use) => use(), { auto: true } as never] });

/** How long to watch for a report that must NOT come: longer than the client's batching delay (5 s). */
const QUIET_MS = 7000;

interface Sent {
  request: Request;
  status: number;
  body: { device: Record<string, unknown>; events: { kind: string; message: string; stack?: string; route?: string; build: string; count?: number }[] };
}

/** Records every report batch the page sends with the status the server answered. */
function watchReports(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/reports') {
      sent.push({ request, status: response.status(), body: request.postDataJSON() });
    }
  });
  return sent;
}

const TOKEN = 'T'.repeat(43);

test('an opted-in account sends its console error and unhandled rejection, scrubbed, with the device facts; turning it off stops it', async ({
  page,
  shell,
  api,
  signedIn,
}) => {
  await api.setDiagnostics(true);
  const sent = watchReports(page);
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await page.evaluate((token) => {
    console.error(`Glaze list broke for ${'someone@example.test'} at https://x.test/?session=abc#/verify/${token}`);
    void Promise.reject(new Error(`Rejected with ${token}`));
  }, TOKEN);
  await expect.poll(() => sent.flatMap((one) => one.body.events).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  expect(sent.map((one) => one.status)).toEqual(sent.map(() => 204));
  const events = sent.flatMap((one) => one.body.events);
  expect(events.map((event) => event.kind).sort()).toEqual(['ERROR', 'UNHANDLED_REJECTION']);
  for (const event of events) expect(event).toMatchObject({ route: 'discover', build: expect.stringMatching(/^\d/) });
  const device = sent[0].body.device;
  expect(device).toMatchObject({
    online: true,
    serviceWorker: expect.stringMatching(/^(UNSUPPORTED|NONE|ACTIVE)$/),
    pointer: expect.stringMatching(/^(COARSE|FINE|NONE)$/),
  });
  expect(device.viewportWidth).toBeGreaterThan(100);
  expect(device.browser).toBe('Chrome');
  // No token, address, query or fragment anywhere in what left the page.
  const wire = JSON.stringify(sent.map((one) => one.body));
  for (const secret of [TOKEN, 'someone@example.test', 'session=abc', '#/verify', '/verify/']) expect(wire).not.toContain(secret);

  // Turn it off on the account page: the switch is on, the answer is a notice that the reports are deleted, and nothing more is sent.
  await shell.openAccountPage(signedIn.displayName);
  const account = new AccountPage(page);
  const toggle = account.main.getByRole('switch', { name: t('account.page.diagnostics.switch') });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByText(t('notices.diagnosticsOff'))).toBeVisible();
  await expect(toggle).not.toBeChecked();
  expect((await api.me()).diagnosticsOptIn).toBe(false);
  const before = sent.length;
  await page.evaluate(() => console.error('after turning it off'));
  await page.waitForTimeout(QUIET_MS);
  expect(sent).toHaveLength(before);
});

test('an account that has not opted in, and a guest, send nothing', async ({ page, shell, signedIn, browser, baseURL }) => {
  const sent = watchReports(page);
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const guest = await browser.newContext({ baseURL });
  try {
    const guestPage = await guest.newPage();
    const guestSent = watchReports(guestPage);
    await guestPage.goto('/#/');
    await expect(guestPage.getByRole('main')).toBeVisible();
    for (const one of [page, guestPage]) await one.evaluate(() => (console.error('not collected'), void Promise.reject(new Error('not collected'))));
    await page.waitForTimeout(QUIET_MS);
    expect(sent).toEqual([]);
    expect(guestSent).toEqual([]);
  } finally {
    await guest.close();
  }
});

test('the activation asks for the error-report choice, unchecked by default, and stores it', async ({ page, shell, newApi, uid }) => {
  const auth = new AuthDialog(page);
  await shell.open();
  await shell.signInButton().click();
  const account = newAccount(uid, 'Bea');
  // The sign-up form itself asks for no consent: whoever types an address may not own the mailbox.
  await auth.dialog.getByRole('button', { name: t('auth.register.switch') }).click();
  await auth.dialog.getByLabel(t('auth.name')).fill(account.displayName);
  await auth.dialog.getByLabel(t('common.email')).fill(account.email);
  await expect(auth.dialog.getByRole('checkbox')).toHaveCount(0);
  await auth.dialog.getByRole('button', { name: t('auth.register.submit') }).click();
  const choice = auth.setup.getByRole('checkbox', { name: t('account.link.diagnostics') });
  await expect(choice).not.toBeChecked();
  // The link shows the terms' error-report section.
  await auth.setup.getByRole('button', { name: t('auth.diagnostics.link') }).click();
  await expect(auth.setup.getByRole('heading', { name: t('terms.section.diagnostics.title') })).toBeInViewport();
  await choice.check();
  await auth.choosePassword(PASSWORD);
  await shell.expectSignedIn(account.displayName);
  await shell.openAccountPage(account.displayName);
  await expect(page.getByRole('main').getByRole('switch', { name: t('account.page.diagnostics.switch') })).toBeChecked();

  // The default activation stays off.
  const other = await newApi();
  await other.signUp(newAccount(uid, 'Cai'));
  expect((await other.me()).diagnosticsOptIn).toBe(false);
});

test('offline, the switch waits for the connection and says so', async ({ page, shell, signedIn, context }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const toggle = page.getByRole('main').getByRole('switch', { name: t('account.page.diagnostics.switch') });
  await expect(toggle).toBeEnabled();
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole('main').getByText(t('account.page.diagnostics.offline'))).toBeVisible();
});
