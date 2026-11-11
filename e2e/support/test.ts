import { createHash } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { Api, PASSWORD, type Account } from './api';
import { withEncoder } from './encoder-lock';
import { AppShell } from './pages/app-shell';

export { expect };

interface Fixtures {
  /** A short token unique to this test and project (letters and digits, starting with a letter), for names, codes and addresses. */
  uid: string;
  /** The API with the page's cookies. */
  api: Api;
  /** The API in a separate session of its own (another person), disposed after the test. */
  newApi: () => Promise<Api>;
  /** A new account with a password, not signed in. */
  account: Account;
  /** A new account, signed in through the API before the test opens a page. */
  signedIn: Account;
  shell: AppShell;
  /** Holds the API's image encoder for the whole test, for tests that upload through the page. */
  encoder: void;
  /** Fails the test on an uncaught page error or a Content-Security-Policy violation. */
  pageErrors: void;
}

export function newAccount(uid: string, name: string): Account {
  return { email: `${name.toLowerCase()}-${uid}@example.test`, displayName: name, password: PASSWORD };
}

export const test = base.extend<Fixtures>({
  baseURL: async ({}, use) => {
    const url = process.env.GLAZELAB_E2E_BASE_URL;
    if (!url) throw new Error('GLAZELAB_E2E_BASE_URL is unset: run the suite through its config (npm run e2e)');
    await use(url);
  },
  uid: async ({}, use, testInfo) => {
    // Nine characters: a manufacturer's short ID takes at most ten.
    await use('t' + createHash('sha256').update(`${testInfo.testId}:${testInfo.repeatEachIndex}`).digest('hex').slice(0, 8));
  },
  api: async ({ page }, use) => {
    await use(new Api(page.request));
  },
  newApi: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async () => {
      const context = await playwright.request.newContext({ baseURL });
      contexts.push(context);
      return new Api(context);
    });
    await Promise.all(contexts.map((context) => context.dispose()));
  },
  account: async ({ api, uid }, use) => {
    const account = newAccount(uid, 'Ana');
    await api.register(account);
    await use(account);
  },
  signedIn: async ({ api, account }, use) => {
    await api.signIn(account);
    await use(account);
  },
  shell: async ({ page, isMobile }, use) => {
    await use(new AppShell(page, isMobile));
  },
  encoder: async ({}, use) => {
    await withEncoder(() => use());
  },
  pageErrors: [
    async ({ page }, use) => {
      const errors = watchErrors(page);
      await use();
      expect(errors, 'uncaught page errors and CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy')) errors.push(message.text());
  });
  return errors;
}
