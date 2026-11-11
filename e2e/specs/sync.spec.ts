import type { Page, Route } from '@playwright/test';
import type { SyncView } from '../../src/lib/generated/types.gen';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { png } from '../support/images';
import { ExplorePage } from '../support/pages/explore';
import { expect, newAccount, test } from '../support/test';

/** The API requests of the page from now on, photos left out. */
function apiRequests(page: Page): URL[] {
  const seen: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/images/')) seen.push(url);
  });
  return seen;
}

/** The sync point the app saved beside its snapshot for the account the device last saw (or the guest), or null. */
function savedPoint(page: Page): Promise<{ cursor: string; epoch: string } | null> {
  return page.evaluate(
    () =>
      new Promise<{ cursor: string; epoch: string } | null>((resolve) => {
        const user = JSON.parse(localStorage.getItem('glazelab:v1:lastUser') ?? 'null') as { id: string } | null;
        const open = indexedDB.open('glazelab-offline', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const read = open.result
            .transaction('snapshots')
            .objectStore('snapshots')
            .get(`${user?.id ?? 'guest'}/sync`);
          read.onsuccess = () => {
            open.result.close();
            resolve((read.result as { cursor: string; epoch: string } | undefined) ?? null);
          };
          read.onerror = () => resolve(null);
        };
      }),
  );
}

/** Waits until the app saved a sync point other than `before`, and answers it. */
async function nextPoint(page: Page, before: { cursor: string } | null = null) {
  await expect.poll(async () => (await savedPoint(page))?.cursor ?? null).not.toBe(before?.cursor ?? null);
  return (await savedPoint(page))!;
}

/** A network change: the `online` event refreshes the listings. */
async function reconnect(page: Page) {
  await page.context().setOffline(true);
  await page.context().setOffline(false);
}

const paths = (requests: URL[]) => requests.map((url) => url.pathname);

test('another account’s new, edited, deleted and re-shared combinations arrive by delta, without the listings', async ({
  page,
  shell,
  newApi,
  signedIn,
  uid,
}) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const kept = await author.addCombination({ title: `Kept ${uid}`, steps: [BISQUE_STEP] });
  const doomed = await author.addCombination({ title: `Doomed ${uid}`, steps: [BISQUE_STEP] });
  const shared = await author.addCombination({ title: `Shared ${uid}`, steps: [BISQUE_STEP] });
  const photo = await author.uploadToCombination(shared, { file: png('tile.png') });
  const explore = new ExplorePage(page);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(explore.cardTitles).toHaveText([`Shared ${uid}`, `Doomed ${uid}`, `Kept ${uid}`]);
  await expect(explore.card(`Shared ${uid}`).getByText(t('images.noPhoto'))).toHaveCount(0);
  const before = await nextPoint(page);

  const requests = apiRequests(page);
  await author.addCombination({ title: `Added ${uid}`, steps: [BISQUE_STEP] });
  await author.updateCombination(kept, { title: `Edited ${uid}`, steps: [BISQUE_STEP] });
  await author.removeCombination(doomed);
  await author.changeVisibility(photo.id, 'PRIVATE');
  await reconnect(page);

  await expect(explore.cardTitles).toHaveText([`Added ${uid}`, `Shared ${uid}`, `Edited ${uid}`]);
  await expect(explore.card(`Shared ${uid}`).getByText(t('images.noPhoto'))).toBeVisible();
  await nextPoint(page, before);
  const syncs = requests.filter((url) => url.pathname === '/api/sync');
  expect(syncs.map((url) => url.searchParams.get('since'))).toEqual([before.cursor]);
  expect(paths(requests)).not.toContain('/api/combinations');
  expect(paths(requests)).not.toContain('/api/sync/combinations');
  expect(paths(requests)).not.toContain('/api/glazes');
});

test('a second open shows the saved library before the network answers @smoke', async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  await author.addCombination({ title: `Saved ${uid}`, steps: [BISQUE_STEP] });
  const explore = new ExplorePage(page);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(explore.cardTitles).toHaveText([`Saved ${uid}`]);
  await nextPoint(page);

  // From now on every API request waits until the test lets it through.
  const waiting: Route[] = [];
  let holding = true;
  await page.route('**/api/**', async (route) => {
    if (holding) waiting.push(route);
    else await route.fallback();
  });
  await page.reload();
  await expect(explore.cardTitles).toHaveText([`Saved ${uid}`]);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByText(t('discover.loading'))).toHaveCount(0);
  expect(waiting.map((route) => new URL(route.request().url()).pathname)).toContain('/api/auth/me');

  holding = false;
  for (const route of waiting.splice(0)) await route.fallback();
  await expect(explore.cardTitles).toHaveText([`Saved ${uid}`]);
});

test('a first sync larger than one page shows its progress and continues after a dropped page', async ({ page, shell, api, signedIn, uid }) => {
  // Two drafts and one published combination: the published one is this spec's own Explore card.
  for (const title of ['One', 'Two']) await api.addCombination({ title: `${title} ${uid}`, steps: [BISQUE_STEP], draft: true });
  await api.addCombination({ title: `Three ${uid}`, steps: [BISQUE_STEP] });
  // Pages of a third of the library this account's first sync sees (the app asks for the API's maximum page size).
  let total = 0;
  let limit = 1;
  await page.route(
    (url) => url.pathname === '/api/sync',
    async (route) => {
      const response = await route.fetch();
      const answer = (await response.json()) as SyncView;
      total = answer.visibleCombinations;
      limit = Math.ceil(total / 3);
      await route.fulfill({ response, json: answer });
    },
  );
  const afters: (string | null)[] = [];
  let releaseFirst = () => {};
  const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
  await page.route(
    (url) => url.pathname === '/api/sync/combinations',
    async (route) => {
      const url = new URL(route.request().url());
      const after = url.searchParams.get('after');
      afters.push(after);
      url.searchParams.set('limit', String(limit));
      // The first page waits until the test read the progress; the second one drops once.
      if (!after) await firstHeld;
      else if (afters.filter((entry) => entry !== null).length === 1) return route.abort('connectionrefused');
      await route.continue({ url: url.toString() });
    },
  );

  await page.goto(`/#/?type=combinations&q=${uid}`);
  await expect.poll(() => afters.length).toBe(1);
  const progress = (done: number) => page.getByRole('status').filter({ hasText: t('route.loadingProgress', { done, total }) });
  await expect(progress(0)).toBeVisible();
  releaseFirst();
  // After the drop the saved first page still counts, and the silent retry continues after it instead of starting again.
  await expect(progress(limit)).toBeVisible();
  await expect(new ExplorePage(page).card(`Three ${uid}`)).toBeVisible();
  await shell.expectSignedIn(signedIn.displayName);
  expect(afters.filter((after) => after === null)).toHaveLength(1);
  expect(afters[1]).not.toBeNull();
  expect(afters[2]).toBe(afters[1]);
  await nextPoint(page);
});

test('joining a club loads the library in full again', async ({ page, shell, newApi, signedIn, uid }) => {
  const admin = await newApi();
  await admin.signUp(newAccount(uid, 'Cleo'));
  const { club, token } = await admin.clubWithInvite(`Kiln ${uid}`);
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const before = await nextPoint(page);

  const requests = apiRequests(page);
  await page.evaluate((link) => (location.hash = link), `#/invite/${token}`);
  await page.getByRole('button', { name: t('clubs.invite.join') }).click();
  // The invite route is replaced by the joined club's page.
  await expect(page).toHaveURL(new RegExp(`#/clubs/${club.id}$`));
  const after = await nextPoint(page, before);
  expect(after.epoch).not.toBe(before.epoch);
  const syncs = requests.filter((url) => url.pathname === '/api/sync');
  expect(syncs[0].searchParams.get('epoch')).toBe(before.epoch);
  expect(paths(requests)).toContain('/api/sync/combinations');
});
