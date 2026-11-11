import type { Locator, Page } from '@playwright/test';
import type { Api } from '../support/api';
import { BISQUE_STEP } from '../support/api';
import { seededPicture } from '../support/images';
import { t } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';

/**
 * Profile pictures of other people (31-3): shown to signed-in accounts in the club member list, the Buddies section, the buddy request
 * page and on the author line of combinations; never to guests. The API is real; pictures are seeded with distinct images.
 */
const main = (page: Page) => page.getByRole('main');
/** The loaded pictures inside a part of the page (object URLs: the frame's initial letter stays under them). */
const pictures = (within: Locator) => within.locator('img[src^="blob:"]');
/** A picture is fetched only once its frame comes near the view, so a row below the fold is scrolled to first. */
async function showsPicture(row: Locator, count = 1) {
  await row.scrollIntoViewIfNeeded();
  await expect(pictures(row)).toHaveCount(count);
}

async function person(newApi: () => Promise<Api>, uid: string, name: string, picture = true) {
  const api = await newApi();
  await api.signUp({ ...newAccount(uid, name), displayName: name });
  const avatarId = picture ? await api.uploadAvatar(seededPicture(`${uid}-${name}`)) : null;
  return { api, name, avatarId, id: (await api.me()).id };
}

/** The requests for pictures of people (the API's `/api/avatars/…` paths) a page makes. */
function watchAvatars(page: Page) {
  const seen: { path: string; status: number }[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/avatars/')) seen.push({ path, status: response.status() });
  });
  return seen;
}

test('a member sees other members’ pictures in the club list, the Buddies section, the request page and on authors @smoke', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const ben = await person(newApi, uid, 'Ben');
  const cleo = await person(newApi, uid, 'Cleo');
  const dee = await person(newApi, uid, 'Dee');
  const { club, token } = await ben.api.clubWithInvite(`Kiln ${uid}`);
  await api.joinClub(token);
  await cleo.api.joinClub(token);
  const title = `Bowl by Ben ${uid}`;
  const combination = await ben.api.addCombination({ title, steps: [BISQUE_STEP] });
  const me = (await api.me()).id;
  // Cleo asks Ana (a request to answer); Ben and Ana are buddies; Dee has a link.
  await cleo.api.requestBuddyInClub(club.id, me);
  await api.requestBuddyInClub(club.id, ben.id);
  await ben.api.acceptBuddy(me);
  const link = await dee.api.replaceBuddyLink();
  const seen = watchAvatars(page);

  // The club's member list: a picture for each member who has one, the initial for the others (Ana has none).
  await shell.open(`#/clubs/${club.id}`);
  const rows = main(page)
    .getByRole('listitem')
    .filter({ hasText: t('clubs.page.you') });
  await expect(rows).toHaveCount(1);
  await expect(pictures(rows)).toHaveCount(0);
  await expect(rows).toContainText('A');
  for (const member of [ben, cleo]) {
    const row = main(page).getByRole('listitem').filter({ hasText: member.name });
    await showsPicture(row);
    await expect(pictures(row)).toBeVisible();
    // The name stands beside it, so the picture says nothing of its own (no doubled name for a screen reader).
    await expect(row.getByRole('img')).toHaveCount(0);
  }

  // The Buddies section: the request to answer and the accepted buddy.
  await shell.open('#/account');
  const section = main(page)
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: t('buddies.title'), exact: true }) });
  await showsPicture(section.getByRole('listitem').filter({ hasText: 'Cleo' }));
  await showsPicture(section.getByRole('listitem').filter({ hasText: 'Ben' }));

  // The request page of a buddy link shows its owner's picture.
  await page.evaluate((hash) => (location.hash = hash), `#/buddy/${link}`);
  const request = page.getByRole('dialog');
  await expect(request.getByText('Dee', { exact: true })).toBeVisible();
  await expect(pictures(request)).toHaveCount(1);
  await request.getByRole('button', { name: t('common.cancel') }).click();

  // The author line of a card and of the combination page.
  await shell.open(`#/?type=combinations&q=${encodeURIComponent(title)}`);
  const card = main(page)
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title }) });
  await expect(card.getByText('Ben', { exact: true })).toBeVisible();
  await expect(pictures(card)).toHaveCount(1);
  await shell.open(`#/combinations/${combination}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(pictures(main(page).locator('.combination-card__meta'))).toHaveCount(1);

  // Every picture was a small copy of a picture ID of someone else, asked for once.
  expect(seen.filter(({ status }) => status !== 200)).toEqual([]);
  const paths = seen.map(({ path }) => path);
  expect(paths.length).toBe(new Set(paths).size);
  expect(paths.every((path) => path.endsWith('/small'))).toBe(true);
});

test('a guest sees the author names and no pictures, and asks for none', async ({ page, shell, browser, baseURL, newApi, uid }) => {
  const ben = await person(newApi, uid, 'Ben');
  const title = `Guest view ${uid}`;
  const combination = await ben.api.addCombination({ title, steps: [BISQUE_STEP] });
  const guest = await browser.newContext({ baseURL });
  try {
    const visitor = await guest.newPage();
    const requests: string[] = [];
    visitor.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/avatars/') || pathname === '/api/combinations/author-avatars') requests.push(pathname);
    });
    await visitor.goto(`/#/combinations/${combination}`);
    await expect(visitor.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Ben', exact: true })).toBeVisible();
    await visitor.goto('about:blank');
    await visitor.goto(`/#/?type=combinations&q=${encodeURIComponent(title)}`);
    const card = visitor
      .getByRole('main')
      .getByRole('article')
      .filter({ has: visitor.getByRole('heading', { name: title }) });
    await expect(card.getByText('Ben', { exact: true })).toBeVisible();
    // No picture, no initial circle, no report control: the line is the name as it always was.
    await expect(card.locator('.avatar')).toHaveCount(0);
    await expect(visitor.locator('img[src^="blob:"]')).toHaveCount(0);
    expect(requests).toEqual([]);
    // The API itself refuses a guest the picture and the list.
    expect((await guest.request.get(`/api/avatars/${ben.avatarId}/small`)).status()).toBe(401);
    expect((await guest.request.get('/api/combinations/author-avatars')).status()).toBe(401);
  } finally {
    await guest.close();
  }
  void page;
  void shell;
});

test('a removed picture gives the initial back, and an old ID that answered 404 is asked for once while the lists are read again', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const ben = await person(newApi, uid, 'Ben');
  const { club, token } = await ben.api.clubWithInvite(`Stale ${uid}`);
  await api.joinClub(token);
  const seen = watchAvatars(page);
  // The session starts on the Clubs list (its card counts the members, so the member list is read), and the pictures are asked for later.
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('clubs.page.members', { count: 2 }))).toBeVisible();
  const oldPicture = ben.avatarId!;
  const replacement = await ben.api.uploadAvatar(seededPicture(`${uid}-Ben-new`));
  await page.evaluate((hash) => (location.hash = hash), `#/clubs/${club.id}`);
  const row = main(page).getByRole('listitem').filter({ hasText: 'Ben' });
  // The old ID is stale: one 404, then the member list is read again and the new picture shows.
  await expect(pictures(row)).toHaveCount(1);
  await expect.poll(() => seen.filter(({ path }) => path.includes(replacement)).length).toBe(1);
  expect(seen.filter(({ path }) => path.includes(oldPicture))).toEqual([expect.objectContaining({ status: 404 })]);
  // Going away and back asks for neither again.
  await page.evaluate(() => (location.hash = '#/clubs'));
  await page.evaluate((hash) => (location.hash = hash), `#/clubs/${club.id}`);
  await expect(pictures(main(page).getByRole('listitem').filter({ hasText: 'Ben' }))).toHaveCount(1);
  expect(seen.filter(({ status }) => status === 404)).toHaveLength(1);
  expect(seen).toHaveLength(2);

  // Ben removes his picture: after a reload the list has no ID and the initial shows, with no request for a picture.
  await ben.api.removeAvatar(replacement);
  seen.length = 0;
  await page.goto('about:blank');
  await shell.open(`#/clubs/${club.id}`);
  const again = main(page).getByRole('listitem').filter({ hasText: 'Ben' });
  await expect(again).toBeVisible();
  await expect(again).toContainText('B');
  await expect(pictures(again)).toHaveCount(0);
  expect(seen).toEqual([]);
});

test('a picture ID that answered 404 is never asked for again, even when the lists cannot be read again', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const ben = await person(newApi, uid, 'Ben');
  const { club, token } = await ben.api.clubWithInvite(`Never ${uid}`);
  await api.joinClub(token);
  const seen = watchAvatars(page);
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('clubs.page.members', { count: 2 }))).toBeVisible();
  // Ben changes his picture; the lists cannot be read again (the server fails), so the stale ID stays in the page.
  await ben.api.uploadAvatar(seededPicture(`${uid}-Ben-new`));
  await page.route('**/api/clubs/*/members', (route) => route.fulfill({ status: 503, json: { error: 'down' } }));
  await page.route('**/api/combinations/author-avatars', (route) => route.fulfill({ status: 503, json: { error: 'down' } }));
  await page.evaluate((hash) => (location.hash = hash), `#/clubs/${club.id}`);
  const row = main(page).getByRole('listitem').filter({ hasText: 'Ben' });
  await expect(row).toContainText('B');
  await expect.poll(() => seen.filter(({ status }) => status === 404).length).toBe(1);
  // Back and forth between pages that show the picture: the old ID is not asked for again, the initial stays.
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => (location.hash = '#/clubs'));
    await page.evaluate((hash) => (location.hash = hash), `#/clubs/${club.id}`);
    await expect(row).toBeVisible();
  }
  await page.waitForTimeout(500);
  expect(seen).toHaveLength(1);
  await expect(row.locator('img[src^="blob:"]')).toHaveCount(0);
});

test('signing out removes the saved pictures of other people from the device', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const ben = await person(newApi, uid, 'Ben');
  const { club, token } = await ben.api.clubWithInvite(`Cache ${uid}`);
  await api.joinClub(token);
  const accountId = (await api.me()).id;
  await shell.open(`#/clubs/${club.id}`);
  await expect(pictures(main(page).getByRole('listitem').filter({ hasText: 'Ben' }))).toHaveCount(1);
  const saved = () =>
    page.evaluate(async (name) => {
      if (!(await caches.keys()).includes(name)) return [];
      return (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname);
    }, `glazelab-images-${accountId}`);
  await expect.poll(saved).toEqual([`/api/avatars/${ben.avatarId}/small`]);
  await shell.signOut();
  await shell.expectGuest();
  await expect.poll(saved).toEqual([]);
  expect(await page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith('glazelab-images-')))).toEqual([]);
});

test('a page with sixty cards asks once for each author’s picture, and only as it comes near the view', async ({ page, shell, newApi, signedIn, uid }) => {
  test.setTimeout(120_000);
  // The oldest combinations are Cleo's, so they are the last cards of the list.
  const [cleo, ben, ada] = [await person(newApi, uid, 'Cleo'), await person(newApi, uid, 'Ben'), await person(newApi, uid, 'Ada')];
  const tag = `bulk-${uid.toLowerCase()}`;
  for (const [author, count] of [
    [cleo, 20],
    [ben, 20],
    [ada, 20],
  ] as const) {
    for (let index = 0; index < count; index++) await author.api.addCombination({ title: `${author.name} ${index} ${uid}`, steps: [BISQUE_STEP], tags: [tag] });
  }
  const seen = watchAvatars(page);
  await shell.open(`#/?type=combinations&q=${encodeURIComponent(uid)}`);
  const cards = main(page).getByRole('article');
  // The first page is twelve cards; the next renders at once where its end is within two screens (desktop: twelve cards fill four rows
  // of three, so 24 show at once, and 12 was only a passing state; E2E-avatars-1). Never all sixty before the end is reached.
  await expect(cards.nth(11)).toBeVisible();
  expect(await cards.count()).toBeLessThan(60);
  // The newest cards are Ada's: their pictures load as they come near the view, and only Ada's picture is asked for, once.
  await expect(pictures(cards).first()).toBeVisible();
  await expect.poll(() => seen.map(({ path }) => path)).toEqual([`/api/avatars/${ada.avatarId}/small`]);
  // Everything: sixty cards (the list grows as its end is reached), three authors, three requests in all.
  await expect(async () => {
    await cards.last().scrollIntoViewIfNeeded();
    expect(await cards.count()).toBe(60);
  }).toPass();
  await expect(cards).toHaveCount(60);
  for (const index of [0, 25, 59]) await cards.nth(index).scrollIntoViewIfNeeded();
  await expect.poll(() => seen.length).toBe(3);
  const paths = seen.map(({ path }) => path).sort();
  expect(paths).toEqual([ada, ben, cleo].map(({ avatarId }) => `/api/avatars/${avatarId}/small`).sort());
});

test('the own picture in the header stays on the screen while the page changes', async ({ page, shell, api, signedIn, uid }) => {
  await api.uploadAvatar(seededPicture(`own-${uid}`));
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const shown = page.locator('header .avatar__image--ready');
  await expect(shown.first()).toBeVisible();
  // Every frame after the picture was first shown: a header avatar without its picture would be the flicker.
  await page.evaluate(() => {
    const frames = { total: 0, bare: 0 };
    (window as unknown as { __avatarFrames: typeof frames }).__avatarFrames = frames;
    const sample = () => {
      const avatars = document.querySelectorAll('header .avatar');
      if (avatars.length) {
        frames.total++;
        if ([...avatars].some((avatar) => !avatar.querySelector('.avatar__image--ready'))) frames.bare++;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const hash of ['#/stock', '#/clubs', '#/studio', '#/account', '#/']) {
    await page.evaluate((target) => (location.hash = target), hash);
    await expect(page).toHaveURL(new RegExp(`${hash.replace('/', '\\/')}$`));
    await page.waitForTimeout(150);
  }
  const frames = await page.evaluate(() => (window as unknown as { __avatarFrames: { total: number; bare: number } }).__avatarFrames);
  expect(frames.total).toBeGreaterThan(10);
  expect(frames.bare).toBe(0);
});
