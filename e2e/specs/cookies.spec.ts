import type { BrowserContext, Page, Response, TestInfo } from '@playwright/test';
import { BISQUE_STEP, PASSWORD } from '../support/api';
import { t } from '../support/i18n';
import { photoPng, png } from '../support/images';
import { AuthDialog } from '../support/pages/auth';
import { PasswordDialog } from '../support/pages/password';
import { StudioPage } from '../support/pages/studio';
import { expect, newAccount, test } from '../support/test';
import { standInFiles, VISION_URL } from '../support/vision';

/**
 * The cookie audit (23-72): the service sets only strictly necessary cookies, and the terms of service (`terms.section.cookies`)
 * say which. A cookie outside this list, or an allowed one with other flags, fails the test, so a new cookie needs a decision
 * and a terms change first. The `Secure` flag belongs to `prod` (https) and is asserted in the backend (`CookieFlagsApiTest`).
 */
const LOGIN = 'GLAZELAB_SESSION';
const CSRF = 'XSRF-TOKEN';
const ALLOWED = [LOGIN, CSRF];

/** What the app may keep in the browser besides cookies (the terms' "device storage" sentence). */
const LOCAL_STORAGE_KEYS = [
  /^glazelab:locale$/,
  /^glazelab:install-declined$/,
  /^glazelab:photo-suggestions$/,
  /^glazelab:intro-dismissed:[0-9a-f-]{36}$/,
  /^glazelab:include-buddies:[0-9a-f-]{36}$/,
  /^glazelab:include-clubs:[0-9a-f-]{36}$/,
  /^glazelab:scan-shelf:[0-9a-f-]{36}$/,
  /^glazelab:v1:lastUser$/,
  /^glazelab:v1:pendingLogout$/,
];
const INDEXED_DB_NAMES = ['glazelab-offline', 'glazelab-embeddings', 'workbox-expiration'];
const CACHE_NAMES = [/^glazelab-images-(guest|[0-9a-f-]{36})$/, /^workbox-precache-/, /^label-ocr$/, /^barcode-scanner$/, /^vision-model$/];

const DAY = 24 * 60 * 60;

interface Step {
  step: string;
  /** Names and flags of `context.cookies()` after the step. */
  cookies: { name: string; httpOnly: boolean; sameSite: string; secure: boolean; path: string; lifetimeDays: number | null }[];
  /** Every `Set-Cookie` header the responses carried since the previous step. */
  setCookies: { url: string; header: string }[];
}

/** Records the cookie jar and every `Set-Cookie` response header of a page after each named step. */
class CookieLedger {
  readonly steps: Step[] = [];
  readonly foreignRequests: string[] = [];
  private pending: Promise<void>[] = [];
  private headers: { url: string; header: string }[] = [];

  constructor(
    private readonly page: Page,
    private readonly context: BrowserContext,
    origin: string,
    private readonly testInfo: TestInfo,
  ) {
    page.on('response', (response) => this.pending.push(this.collect(response)));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== origin) this.foreignRequests.push(request.url());
    });
  }

  private async collect(response: Response): Promise<void> {
    try {
      for (const { name, value } of await response.headersArray()) {
        if (name.toLowerCase() === 'set-cookie') this.headers.push({ url: new URL(response.url()).pathname, header: value });
      }
    } catch {
      // A response of a page that navigated away has no headers left to read.
    }
  }

  async record(step: string): Promise<Step> {
    await this.page.waitForLoadState('networkidle');
    await Promise.all(this.pending);
    this.pending = [];
    const now = Date.now() / 1000;
    const cookies = (await this.context.cookies()).map((cookie) => ({
      name: cookie.name,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      path: cookie.path,
      lifetimeDays: cookie.expires > 0 ? Math.round(((cookie.expires - now) / DAY) * 10) / 10 : null,
    }));
    const entry = { step, cookies, setCookies: this.headers };
    this.headers = [];
    this.steps.push(entry);
    // Attached at once, so a failing step still shows what the jar and the headers held.
    await this.testInfo.attach(`${this.steps.length}-${step}.json`, { body: JSON.stringify(entry, null, 2), contentType: 'application/json' });
    for (const cookie of cookies) expect(ALLOWED, `${step}: unexpected cookie ${cookie.name}`).toContain(cookie.name);
    for (const { header } of entry.setCookies) {
      expect(ALLOWED, `${step}: unexpected Set-Cookie ${header}`).toContain(header.split('=')[0]);
    }
    return entry;
  }
}

const names = (step: Step) => step.cookies.map((cookie) => cookie.name).sort();

/**
 * The login cookie: HttpOnly, SameSite=Lax, site-wide, persistent for the absolute lifetime of a sign-in (365 days; the
 * server ends it after 30 idle days). Only a sign-in sets it, so its lifetime never slides in the browser.
 */
function expectLoginFlags(step: Step): void {
  const cookie = step.cookies.find((candidate) => candidate.name === LOGIN);
  expect(cookie, `${step.step}: login cookie`).toBeDefined();
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(cookie?.lifetimeDays ?? 0).toBeGreaterThan(364);
  expect(cookie?.lifetimeDays ?? 0).toBeLessThanOrEqual(365);
}

/** The CSRF cookie: HttpOnly, SameSite=Lax, site-wide, a session cookie (no expiry). */
function expectCsrfFlags(step: Step): void {
  const cookie = step.cookies.find((candidate) => candidate.name === CSRF);
  expect(cookie, `${step.step}: CSRF cookie`).toBeDefined();
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', lifetimeDays: null });
}

const OTHER_ACCOUNT = '00000000-0000-4000-8000-000000000001';

/** Writes the four per-account flags of the signed-in account (and of another account) and answers the signed-in account's keys. */
async function plantAccountFlags(page: Page): Promise<string[]> {
  return page.evaluate(async (other) => {
    const id = ((await (await fetch('/api/auth/me')).json()) as { id: string }).id;
    const mine = [`glazelab:intro-dismissed:${id}`, `glazelab:include-buddies:${id}`, `glazelab:include-clubs:${id}`, `glazelab:scan-shelf:${id}`];
    for (const key of [
      ...mine,
      `glazelab:intro-dismissed:${other}`,
      `glazelab:include-buddies:${other}`,
      `glazelab:include-clubs:${other}`,
      `glazelab:scan-shelf:${other}`,
    ])
      localStorage.setItem(key, '1');
    return mine;
  }, OTHER_ACCOUNT);
}

async function storedOnDevice(page: Page) {
  return page.evaluate(async () => ({
    localStorage: Object.keys(localStorage),
    sessionStorage: Object.keys(sessionStorage),
    indexedDB: (await indexedDB.databases()).map((database) => database.name ?? ''),
    caches: await caches.keys(),
  }));
}

function expectOnlyKnownStorage(stored: Awaited<ReturnType<typeof storedOnDevice>>): void {
  for (const key of stored.localStorage)
    expect(
      LOCAL_STORAGE_KEYS.some((known) => known.test(key)),
      `localStorage key ${key}`,
    ).toBe(true);
  expect(stored.sessionStorage, 'sessionStorage is not used').toEqual([]);
  for (const name of stored.indexedDB) expect(INDEXED_DB_NAMES, `IndexedDB ${name}`).toContain(name);
  for (const name of stored.caches)
    expect(
      CACHE_NAMES.some((known) => known.test(name)),
      `Cache Storage ${name}`,
    ).toBe(true);
}

test('a guest visit sets no cookie, not even when it reads, opens the sign-in and the sign-up form', async ({
  page,
  context,
  shell,
  newApi,
  uid,
  baseURL,
}, testInfo) => {
  // A public combination with a public photo, made by another person in a session of its own.
  const maker = await newApi();
  await maker.signUp(newAccount(uid, 'Maker'));
  const title = `Cookie tile ${uid}`;
  const id = await maker.addCombination({ title, steps: [BISQUE_STEP] });
  await maker.uploadToCombination(id, { file: png('cookie.png') });

  const ledger = new CookieLedger(page, context, new URL(baseURL ?? '').origin, testInfo);
  await shell.open(`#/?q=${uid}`);
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  expect(names(await ledger.record('guest: Explore with a photo'))).toEqual([]);

  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  expect(names(await ledger.record('guest: combination page'))).toEqual([]);

  await shell.open('#/terms');
  await expect(page.getByRole('heading', { name: t('terms.section.cookies.title') })).toBeVisible();
  expect(names(await ledger.record('guest: terms page'))).toEqual([]);

  await shell.open('#/');
  await shell.signInButton().click();
  const auth = new AuthDialog(page);
  await expect(auth.dialog).toBeVisible();
  expect(names(await ledger.record('guest: sign-in dialog'))).toEqual([]);
  await auth.dialog.getByRole('button', { name: t('auth.register.switch') }).click();
  await auth.dialog.getByText(t('auth.terms.read')).click();
  await expect(auth.dialog.getByRole('heading', { name: t('terms.section.cookies.title') })).toBeVisible();
  expect(names(await ledger.record('guest: sign-up form with the terms'))).toEqual([]);

  expectOnlyKnownStorage(await storedOnDevice(page));
  expect(ledger.foreignRequests, 'requests to other origins').toEqual([]);
});

test('a member journey sets only the sign-in and the CSRF cookie, with their flags', async ({
  page,
  context,
  shell,
  newApi,
  uid,
  baseURL,
  encoder,
}, testInfo) => {
  test.setTimeout(60_000);
  // A glaze from another person's session, so this member's cookie jar holds only what the member's own steps set.
  const maker = await newApi();
  await maker.signUp(newAccount(uid, 'Maker'));
  await maker.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: uid }, name: 'Seegrün', code: 'SG-1' });
  const title = `Cookie combination ${uid}`;
  const ledger = new CookieLedger(page, context, new URL(baseURL ?? '').origin, testInfo);
  const me = newAccount(uid, 'Cora');
  const auth = new AuthDialog(page);
  const main = page.getByRole('main');

  await shell.open();
  expect(names(await ledger.record('guest: start'))).toEqual([]);

  // Sign-up (the first write: it asks for the CSRF token, which is stored in a cookie).
  await shell.signInButton().click();
  await auth.register(me);
  await expect(auth.setup).toBeVisible();
  const registered = await ledger.record('sign-up: registered');
  expect(names(registered)).toEqual([CSRF]);
  expectCsrfFlags(registered);
  await auth.choosePassword(PASSWORD);
  await shell.expectSignedIn(me.displayName);
  const activated = await ledger.record('sign-up: password set (signed in)');
  // A sign-in replaces the CSRF token: the old cookie is deleted, and the next write fetches a new one.
  expect(names(activated)).toEqual([LOGIN]);
  expectLoginFlags(activated);

  // A write (a published combination) and a photo upload.
  await shell.open('#/studio');
  const studio = new StudioPage(page);
  await studio.addGlazeStep(`Botz ${uid} SG-1`);
  await studio.title.fill(title);
  await studio.publish();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const written = await ledger.record('write: combination published');
  expect(names(written)).toEqual([CSRF, LOGIN].sort());
  // After the sign-in no ordinary answer sends the login cookie again (23-70b).
  expect(written.setCookies.filter(({ header }) => header.startsWith(LOGIN + '='))).toEqual([]);
  await main
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await upload.getByLabel(t('upload.library')).setInputFiles(photoPng('cookie.png', 800, 600));
  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  const uploaded = await ledger.record('write: photo uploaded');
  expect(names(uploaded)).toEqual([CSRF, LOGIN].sort());
  expect(uploaded.setCookies.filter(({ header }) => header.startsWith(LOGIN + '='))).toEqual([]);
  expectLoginFlags(uploaded);

  // Changing the password keeps this browser signed in with a new session token.
  const password = new PasswordDialog(page);
  await shell.openAccountPage(me.displayName);
  await password.open();
  await password.submit(PASSWORD, 'a fresh coat of celadon');
  await expect(password.dialog).toBeHidden();
  const changed = await ledger.record('password changed');
  expect(names(changed)).toEqual([LOGIN]);
  expectLoginFlags(changed);
  expect(changed.setCookies.some(({ header }) => header.startsWith(LOGIN + '='))).toBe(true);

  // The device holds only what the terms say it holds while signed in.
  expectOnlyKnownStorage(await storedOnDevice(page));

  // The per-account flags are on the device now; sign-out removes this account's three (27-7).
  const flags = await plantAccountFlags(page);
  expectOnlyKnownStorage(await storedOnDevice(page));

  // Sign-out deletes the login cookie. The page signs out at once and the server answers later (LOGOUT-1): wait for the answer. The
  // cache clearing that follows (LOGOUT-2) carries `Clear-Site-Data: "cache"` and sets or deletes no cookie; the sign-out answer has
  // no such header.
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/logout');
  const cleared = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/clear-cache');
  await shell.signOut();
  expect((await (await answered).allHeaders())['clear-site-data']).toBeUndefined();
  const clearing = await (await cleared).allHeaders();
  expect(clearing['clear-site-data']).toBe('"cache"');
  expect(clearing['set-cookie']).toBeUndefined();
  await shell.expectGuest();
  const signedOut = await ledger.record('signed out');
  expect(names(signedOut), 'sign-out leaves no cookie').toEqual([]);
  expect(signedOut.setCookies.some(({ header }) => header.startsWith(LOGIN + '=;') && /Max-Age=0/i.test(header))).toBe(true);
  const left = await storedOnDevice(page);
  expectOnlyKnownStorage(left);
  expect(left.localStorage, 'sign-out forgets the last account').not.toContain('glazelab:v1:lastUser');
  for (const key of flags) expect(left.localStorage, 'sign-out removes the per-account flags').not.toContain(key);
  expect(left.localStorage, "another account's flags stay").toContain(`glazelab:intro-dismissed:${OTHER_ACCOUNT}`);

  expect(ledger.foreignRequests, 'requests to other origins').toEqual([]);
});

test('turning on the photo suggestions stores only the documented preference and cache, and sets no cookie', async ({
  page,
  context,
  shell,
  signedIn,
  baseURL,
}, testInfo) => {
  const files = standInFiles();
  await page.route(VISION_URL, (route) => {
    const model = route.request().url().endsWith('model.onnx');
    return route.fulfill({ status: 200, contentType: model ? 'application/octet-stream' : 'application/json', body: model ? files.model : files.labels });
  });
  const ledger = new CookieLedger(page, context, new URL(baseURL ?? '').origin, testInfo);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByText(t('vision.setting.review'), { exact: true }).click();
  await expect(page.getByRole('button', { name: t('vision.consent.on') })).toBeVisible();
  const before = await ledger.record('account page, suggestions off');
  expect(await storedOnDevice(page)).toMatchObject({ caches: [] });
  await page.getByRole('button', { name: t('vision.consent.on') }).click();
  await expect(page.getByRole('button', { name: t('vision.remove') })).toBeVisible();
  await expect.poll(async () => (await storedOnDevice(page)).caches, { timeout: 30_000 }).toEqual(['vision-model']);
  const after = await ledger.record('photo suggestions on');
  expect(names(after)).toEqual(names(before));
  const device = await storedOnDevice(page);
  expectOnlyKnownStorage(device);
  expect(device.localStorage).toContain('glazelab:photo-suggestions');
  await page.getByRole('button', { name: t('vision.remove') }).click();
  await expect.poll(async () => (await storedOnDevice(page)).caches, { timeout: 30_000 }).toEqual([]);
  expect(ledger.foreignRequests, 'requests to other origins').toEqual([]);
});

test('deleting the account removes its per-account flags from the device', async ({ page, shell, signedIn }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const flags = await plantAccountFlags(page);
  expect(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), flags)).toEqual(['1', '1', '1', '1']);
  const dialog = page.getByRole('dialog', { name: t('account.delete.title') });
  await page
    .getByRole('main')
    .getByRole('button', { name: t('account.delete.title') })
    .click();
  await dialog.getByLabel(t('auth.password')).fill(signedIn.password);
  await dialog.getByLabel(t('account.delete.understand')).check();
  await dialog.getByRole('button', { name: t('account.delete.confirm') }).click();
  await expect(page.getByText(t('notices.accountDeleted'))).toBeVisible();
  await shell.expectGuest();
  const left = await storedOnDevice(page);
  expectOnlyKnownStorage(left);
  for (const key of flags) expect(left.localStorage, 'deletion removes the per-account flags').not.toContain(key);
  expect(left.localStorage).toContain(`glazelab:intro-dismissed:${OTHER_ACCOUNT}`);
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('a guest visit installs the offline app and still sets no cookie', async ({ page, context, shell, baseURL }, testInfo) => {
    const ledger = new CookieLedger(page, context, new URL(baseURL ?? '').origin, testInfo);
    await shell.open();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.reload();
    expect(names(await ledger.record('guest with the service worker'))).toEqual([]);
    expectOnlyKnownStorage(await storedOnDevice(page));
    expect(ledger.foreignRequests, 'requests to other origins').toEqual([]);
  });
});
