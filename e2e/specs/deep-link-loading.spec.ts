import type { Page, Route } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { StudioPage } from '../support/pages/studio';
import { expect, newAccount, test } from '../support/test';

/**
 * A deep link to an item the saved library lacks (STATE-1b): the page answers "loading" while the snapshot is shown and the refresh
 * runs, and "not found" only after a load ended without it. A MutationObserver records every route status (by its title), guest
 * welcome (`welcome`) and intro card (`intro`) the page ever inserts, so a flash of one between two updates is caught even if it is
 * gone again before an assertion could see it.
 */
async function recordRouteStatuses(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { routeStatuses: string[] }).routeStatuses = seen;
    const label = (element: Element) =>
      element.matches('.explore-welcome')
        ? 'welcome'
        : element.matches('.intro-card')
          ? 'intro'
          : (element.querySelector('.empty-state__title')?.textContent?.trim() ?? '?');
    const watched = '.route-status, .explore-welcome, .intro-card';
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          for (const element of node.matches(watched) ? [node] : [...node.querySelectorAll(watched)]) seen.push(label(element));
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const routeStatuses = (page: Page) => page.evaluate(() => (window as unknown as { routeStatuses: string[] }).routeStatuses);

/**
 * Holds every listing request (everything under `/api/` but the session and photos, and with `session` the `/api/auth/me` too) until
 * `release`; `fail` answers them 500.
 */
async function holdListings(page: Page, { session = false } = {}) {
  const waiting: Route[] = [];
  let holding = true;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (
      !holding ||
      (path.startsWith('/api/auth/') && !(session && path === '/api/auth/me')) ||
      path.startsWith('/api/images/') ||
      path.startsWith('/api/avatars/')
    )
      await route.fallback();
    else waiting.push(route);
  });
  const held = () => waiting.map((route) => new URL(route.request().url()).pathname);
  return {
    held,
    async release(fail = false) {
      holding = false;
      for (const route of waiting.splice(0)) await (fail ? route.fulfill({ status: 500, json: { error: 'Internal error' } }) : route.fallback());
    },
  };
}

/** The saved library of the page's account (or the guest): Explore was open and its snapshot is on the device. */
async function saveLibrary(page: Page, open: (hash: string) => Promise<void>) {
  await open('#/');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const open = indexedDB.open('glazelab-offline', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
            open.onerror = () => resolve(false);
            open.onsuccess = () => {
              const user = JSON.parse(localStorage.getItem('glazelab:v1:lastUser') ?? 'null') as { id: string } | null;
              const read = open.result
                .transaction('snapshots')
                .objectStore('snapshots')
                .get(`${user?.id ?? 'guest'}/sync`);
              read.onsuccess = () => {
                open.result.close();
                resolve(!!read.result);
              };
              read.onerror = () => resolve(false);
            };
          }),
      ),
    )
    .toBe(true);
}

const loadingText = (page: Page) =>
  page
    .getByRole('main')
    .getByRole('status')
    .filter({ hasText: t('route.loading') });

test('a deep link to items the saved library lacks waits for the refresh instead of showing not found', async ({ page, shell, api, newApi, signedIn, uid }) => {
  await recordRouteStatuses(page);
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  await saveLibrary(page, (hash) => shell.open(hash));
  // Each is added after the snapshot was saved (the previous case's load saved the ones before): only the refresh brings it.
  const newGlaze = async (name: string) => (await author.addGlaze({ newManufacturer: { name: `Botz ${name}`, shortId: `${uid}1` }, code: 'CE-1', name })).id;
  const newCombination = (title: string) => author.addCombination({ title, steps: [BISQUE_STEP] });
  const cases: [() => Promise<string>, () => Promise<void>][] = [
    [
      async () => `#/combinations/${await newCombination(`Arrived ${uid}`)}`,
      () => expect(page.getByRole('heading', { level: 1, name: `Arrived ${uid}` })).toBeVisible(),
    ],
    [async () => `#/glazes/${await newGlaze(`Celadon ${uid}`)}`, () => expect(page.getByRole('heading', { level: 1, name: `Celadon ${uid}` })).toBeVisible()],
    [
      async () => {
        const { club, token } = await author.clubWithInvite(`Club ${uid}`);
        await api.joinClub(token);
        return `#/clubs/${club.id}`;
      },
      () => expect(page.getByRole('heading', { level: 1, name: `Club ${uid}` })).toBeVisible(),
    ],
    [
      async () => `#/studio?from=${await newCombination(`Source ${uid}`)}`,
      () => expect(new StudioPage(page).title).toHaveValue(`Source ${uid}${t('studio.variationSuffix')}`),
    ],
  ];
  for (const [link, shown] of cases) {
    const hash = await link();
    await test.step(hash, async () => {
      const hold = await holdListings(page);
      // A fresh document: a hash change in the open one would show the shown (settled) listings' answer at once.
      await page.goto('about:blank');
      await page.goto('/' + hash);
      await shell.expectSignedIn(signedIn.displayName);
      await expect.poll(hold.held).toContain('/api/sync');
      await expect(loadingText(page)).toBeVisible();
      // Long enough for any later update of the instant start to paint.
      await page.waitForTimeout(300);
      await expect(loadingText(page)).toBeVisible();
      await hold.release();
      await shown();
      expect(await routeStatuses(page)).toEqual([]);
      await page.unrouteAll();
    });
  }
});

test('a deep link the saved library lacks shows unavailable with the server’s reason, never not found, when the refresh fails', async ({
  page,
  shell,
  newApi,
  signedIn,
  uid,
}) => {
  await recordRouteStatuses(page);
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  await saveLibrary(page, (hash) => shell.open(hash));
  const combination = await author.addCombination({ title: `Arrived ${uid}`, steps: [BISQUE_STEP] });
  const glaze = await author.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` }, code: 'CE-1', name: `Celadon ${uid}` });
  for (const hash of [`#/combinations/${combination}`, `#/glazes/${glaze.id}`]) {
    await test.step(hash, async () => {
      const hold = await holdListings(page);
      await page.goto('about:blank');
      await page.goto('/' + hash);
      await shell.expectSignedIn(signedIn.displayName);
      await expect.poll(hold.held).toContain('/api/sync');
      await expect(loadingText(page)).toBeVisible();
      await hold.release(true);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1, name: t('route.unavailable.title') })).toBeVisible();
      await expect(main.getByText(t('route.unavailable.server'))).toBeVisible();
      expect(await routeStatuses(page)).toEqual([t('route.unavailable.title')]);
      await page.unrouteAll();
    });
  }
});

test('a first load on a new device shows loading on Explore, Clubs and the shelf, and neither the guest welcome nor the intro card before it ended', async ({
  page,
  shell,
  signedIn,
}) => {
  await recordRouteStatuses(page);
  const hold = await holdListings(page, { session: true });
  await page.goto('/#/');
  const main = page.getByRole('main');
  const loading = main.getByRole('status').filter({ hasText: t('discover.loading') });
  await expect.poll(hold.held).toContain('/api/auth/me');
  // Nobody known yet: the visitor may be signed in, so no guest welcome.
  await expect(loading).toBeVisible();
  await page.unrouteAll();
  const listings = await holdListings(page);
  await hold.release();
  await shell.expectSignedIn(signedIn.displayName);
  await expect.poll(listings.held).toContain('/api/sync');
  // The account is known, its library is not: no intro card, and the account pages wait too.
  await expect(loading).toBeVisible();
  await page.evaluate(() => (location.hash = '#/clubs'));
  await expect(loadingText(page)).toBeVisible();
  await expect(main.getByText(t('clubs.joinHint'))).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#/stock'));
  await expect(loadingText(page)).toBeVisible();
  await page.evaluate(() => (location.hash = '#/'));
  await expect(loading).toBeVisible();
  expect(await routeStatuses(page)).toEqual([]);
  await listings.release();
  await expect(main.getByRole('complementary', { name: t('discover.onboarding.title') })).toBeVisible();
  expect(await routeStatuses(page)).toEqual(['intro']);
});

test('a second open shows the intro card with the saved library while the refresh runs, in the list’s own render', async ({ page, shell, signedIn }) => {
  await recordRouteStatuses(page);
  await saveLibrary(page, (hash) => shell.open(hash));
  const hold = await holdListings(page);
  await page.goto('about:blank');
  await page.goto('/#/');
  await shell.expectSignedIn(signedIn.displayName);
  await expect.poll(hold.held).toContain('/api/sync');
  await expect(page.getByRole('main').getByRole('complementary', { name: t('discover.onboarding.title') })).toBeVisible();
  expect(await routeStatuses(page)).toEqual(['intro']);
  await hold.release();
});

test('a first load that fails on a new device shows Explore unavailable with the server’s reason and no intro card', async ({ page, shell, signedIn }) => {
  await recordRouteStatuses(page);
  const hold = await holdListings(page);
  await page.goto('/#/');
  await shell.expectSignedIn(signedIn.displayName);
  await expect.poll(hold.held).toContain('/api/sync');
  await hold.release(true);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: t('route.unavailable.title') })).toBeVisible();
  await expect(main.getByText(t('route.unavailable.server'))).toBeVisible();
  expect(await routeStatuses(page)).toEqual([t('route.unavailable.title')]);
});

test('a guest’s deep link the saved guest library lacks waits for the refresh, and an unknown one is not found after it', async ({
  page,
  shell,
  newApi,
  uid,
}) => {
  await recordRouteStatuses(page);
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  await saveLibrary(page, (hash) => shell.open(hash));
  const combination = await author.addCombination({ title: `Arrived ${uid}`, steps: [BISQUE_STEP] });

  let hold = await holdListings(page);
  await page.goto('about:blank');
  await page.goto(`/#/combinations/${combination}`);
  await shell.expectGuest();
  await expect.poll(hold.held).toContain('/api/sync');
  await expect(loadingText(page)).toBeVisible();
  await hold.release();
  await expect(page.getByRole('heading', { level: 1, name: `Arrived ${uid}` })).toBeVisible();
  expect(await routeStatuses(page)).toEqual([]);
  await page.unrouteAll();

  // The control: an item that does not exist is "not found" once the refresh ended (the recorder sees it), and only then.
  hold = await holdListings(page);
  await page.goto('about:blank');
  await page.goto('/#/combinations/0b6f7a52-7d61-4f4a-9a43-7f0e0d2a1c11');
  await expect.poll(hold.held).toContain('/api/sync');
  await expect(loadingText(page)).toBeVisible();
  expect(await routeStatuses(page)).toEqual([]);
  await hold.release();
  await expect(page.getByRole('heading', { level: 1, name: t('route.notFound.title') })).toBeVisible();
  expect(await routeStatuses(page)).toEqual([t('route.notFound.title')]);
});
