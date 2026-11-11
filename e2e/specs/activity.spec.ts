import type { Page } from '@playwright/test';
import { Api } from '../support/api';
import { expectAccessible } from '../support/axe';
import { runPolls, runPollsUntil } from '../support/feed-poll';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { expect, newAccount, test } from '../support/test';
import type { FeedEntryView, FeedPageView } from '../../src/lib/generated/types.gen';

/**
 * The activity feed (FEED-1): what a buddy and a club's members add shows on `#/activity` behind the header bell and its badge;
 * the badge goes once the page was seen (on every device, the position is the server's); the Account page's switches choose the
 * sources; a glaze kept private leaves the feed; offline the page says it needs a connection. Ana is the signed-in account, Ada her
 * buddy and Ben a member of Ana's club, each in a session of their own.
 */
const main = (page: Page) => page.getByRole('main');
const bell = (page: Page) => page.getByRole('banner').getByRole('link', { name: new RegExp('^' + t('feed.open')) });

interface Person {
  api: Api;
  id: string;
  name: string;
}

async function person(newApi: () => Promise<Api>, uid: string, name: string): Promise<Person> {
  const api = await newApi();
  await api.signUp(newAccount(uid, name));
  const me = await api.me();
  return { api, id: me.id, name: me.displayName };
}

/** Ada buddies with Ana (Ana asked, Ada accepted), publishes a combination and puts a glaze on her shelf; Ben joins Ana's club and adds a glaze to its shelf. */
async function activity(api: Api, newApi: () => Promise<Api>, uid: string) {
  const ada = await person(newApi, uid, 'Ada');
  const ben = await person(newApi, uid, 'Ben');
  await api.requestBuddyByLink(await ada.api.replaceBuddyLink());
  await ada.api.acceptBuddy((await api.me()).id);
  const first = await api.addGlaze({ newManufacturer: { name: `Feed ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Celadon' });
  const second = await api.addGlaze({ manufacturerId: first.glaze.manufacturer.id, code: 'F-2', name: 'Shino' });
  const title = `Feed combination ${uid}`;
  const combination = await ada.api.addCombination({ title, steps: [{ glazeId: first.id, coats: 2 }] });
  await ada.api.addStock({ glazeId: first.id, ownerType: 'personal', quantityG: 300 });
  const clubName = `Feed club ${uid}`;
  const { club, token } = await api.clubWithInvite(clubName);
  await ben.api.joinClub(token);
  await ben.api.addStock({ glazeId: second.id, ownerType: 'club', clubId: club.id, quantityG: 500 });
  const stock = (await ada.api.stock()).find((entry) => entry.glazeId === first.id)!;
  return {
    ada,
    ben,
    combination,
    stockId: stock.id,
    texts: {
      combination: t('feed.entry.buddyCombination', { name: ada.name, title }),
      buddyGlaze: t('feed.entry.buddyGlaze', { name: ada.name, glaze: `Feed ${uid} F-1 Celadon` }),
      newBuddy: t('feed.entry.newBuddy', { name: ada.name }),
      member: t('feed.entry.clubMember', { name: ben.name, club: clubName }),
      clubGlaze: t('feed.entry.clubGlaze', { name: ben.name, glaze: `Feed ${uid} F-2 Shino`, club: clubName }),
    },
  };
}

test('the bell counts what buddies and the club added, the page lists it as new and the badge goes @smoke', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const { texts, combination } = await activity(api, newApi, uid);
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(bell(page)).toHaveAccessibleName(t('feed.openUnread', { count: 5 }));
  await bell(page).click();
  await expect(main(page).getByRole('heading', { level: 1, name: t('feed.title') })).toBeVisible();
  const fresh = main(page).getByRole('region', { name: t('feed.new') });
  for (const text of Object.values(texts)) await expect(fresh.getByRole('link', { name: new RegExp(escape(text)) })).toBeVisible();
  // Seen: the badge goes here and stays gone after a reload, where the entries are earlier ones.
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
  await page.reload();
  await expect(
    main(page)
      .getByRole('region', { name: t('feed.earlier') })
      .getByRole('link', { name: new RegExp(escape(texts.combination)) }),
  ).toBeVisible();
  await expect(main(page).getByRole('region', { name: t('feed.new') })).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
  await expectAccessible(page);
  // An entry opens its item.
  await main(page)
    .getByRole('link', { name: new RegExp(escape(texts.combination)) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/combinations/${combination}$`));
});

test('the seen position follows the account to another device, and something new is counted again', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
  browser,
  baseURL,
}) => {
  const { ada } = await activity(api, newApi, uid);
  // Another device of Ana's looks first (a browser context of its own, signed in through its own requests).
  const other = await browser.newContext({ baseURL });
  await new Api(other.request).signIn(signedIn);
  const otherPage = await other.newPage();
  await otherPage.goto('/#/activity');
  await expect(otherPage.getByRole('main').getByRole('region', { name: t('feed.new') })).toBeVisible();
  await expect(otherPage.getByRole('banner').getByRole('link', { name: t('feed.open'), exact: true })).toBeVisible();
  await other.close();
  // This device sees no badge: the other one has seen everything.
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
  await ada.api.addCombination({ title: `Later ${uid}`, steps: [{ type: 'CUSTOM', label: 'Bisque firing' }] });
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName(t('feed.openUnread', { count: 1 }));
});

test('a glaze the buddy keeps private leaves the feed', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { ada, stockId, texts } = await activity(api, newApi, uid);
  await shell.open('#/activity');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('link', { name: new RegExp(escape(texts.buddyGlaze)) })).toBeVisible();
  await ada.api.setKeepPrivate(stockId, true);
  await page.reload();
  await expect(main(page).getByRole('link', { name: new RegExp(escape(texts.combination)) })).toBeVisible();
  await expect(main(page).getByRole('link', { name: new RegExp(escape(texts.buddyGlaze)) })).toHaveCount(0);
});

test('the account page chooses the sources, and with both off the page says so', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { texts } = await activity(api, newApi, uid);
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const buddies = main(page).getByRole('switch', { name: t('account.feed.buddies') });
  const clubs = main(page).getByRole('switch', { name: t('account.feed.clubs') });
  await expect(buddies).toBeChecked();
  await buddies.click();
  await expect(page.getByText(t('notices.feedSaved'))).toBeVisible();
  await expect(buddies).not.toBeChecked();
  await expect(bell(page)).toHaveAccessibleName(t('feed.openUnread', { count: 2 }));
  await main(page)
    .getByRole('link', { name: t('account.feed.open') })
    .click();
  await expect(main(page).getByRole('link', { name: new RegExp(escape(texts.member)) })).toBeVisible();
  await expect(main(page).getByRole('link', { name: new RegExp(escape(texts.combination)) })).toHaveCount(0);
  await shell.open('#/account');
  await clubs.click();
  await expect(clubs).not.toBeChecked();
  await shell.open('#/activity');
  await expect(main(page).getByText(t('feed.empty.allOff'))).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
});

test('without buddies or clubs the page says how to get some, and offline it needs a connection', async ({ page, shell, signedIn, context }) => {
  await shell.open('#/activity');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('feed.empty.noSources'))).toBeVisible();
  await expect(main(page).getByRole('link', { name: t('feed.empty.openClubs') })).toBeVisible();
  await expectAccessible(page);
  await context.setOffline(true);
  await expect(main(page).getByText(t('feed.offline'))).toBeVisible();
});

test('a buddy request to the account shows until it is answered, also with both sources off', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const ada = await person(newApi, uid, 'Ada');
  await api.chooseFeed(false, false);
  await ada.api.requestBuddyByLink(await api.replaceBuddyLink());
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(bell(page)).toHaveAccessibleName(t('feed.openUnread', { count: 1 }));
  await bell(page).click();
  const request = main(page).getByRole('link', { name: new RegExp(escape(t('feed.entry.buddyRequest', { name: ada.name }))) });
  await expect(request).toBeVisible();
  await expect(main(page).getByText(t('feed.sourcesOff'))).toBeVisible();
  // The entry opens the Buddies section, where the request is answered; answered, it leaves the feed.
  await request.click();
  await expect(main(page).getByRole('heading', { level: 1, name: t('account.page.title'), exact: true })).toBeVisible();
  await api.acceptBuddy(ada.id);
  await shell.open('#/activity');
  await expect(main(page).getByText(t('feed.empty.allOff'))).toBeVisible();
});

test('while the app is open the bell and the page learn of something new by themselves', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const ada = await person(newApi, uid, 'Ada');
  await api.requestBuddyByLink(await ada.api.replaceBuddyLink());
  await ada.api.acceptBuddy((await api.me()).id);
  await page.clock.install();
  const seen = page.waitForResponse('**/api/feed/seen');
  await shell.open('#/activity');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('link', { name: new RegExp(escape(t('feed.entry.newBuddy', { name: ada.name }))) })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
  await seen;
  const title = `Live ${uid}`;
  await ada.api.addCombination({ title, steps: [{ type: 'CUSTOM', label: 'Bisque firing' }] });
  // The next poll (every 30 s while visible) brings the badge; the open page offers the news instead of moving the list.
  await runPollsUntil(page, async () => (await bell(page).getAttribute('aria-label')) === t('feed.openUnread', { count: 1 }));
  await expect(bell(page)).toHaveAccessibleName(t('feed.openUnread', { count: 1 }));
  const arrived = main(page).getByRole('button', { name: t('feed.showNew', { count: 1 }) });
  await expect(arrived).toBeVisible();
  await expect(main(page).getByRole('link', { name: new RegExp(escape(t('feed.entry.buddyCombination', { name: ada.name, title }))) })).toHaveCount(0);
  await arrived.click();
  await expect(main(page).getByRole('link', { name: new RegExp(escape(t('feed.entry.buddyCombination', { name: ada.name, title }))) })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
  await expect(arrived).toHaveCount(0);
});

test('a "seen" that could not be saved offers nothing as news on the open page', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { texts } = await activity(api, newApi, uid);
  await page.route('**/api/feed/seen', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Request failed."}' }));
  const seen = page.waitForResponse('**/api/feed/seen');
  await shell.open('#/activity');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('link', { name: new RegExp(escape(texts.combination)) })).toBeVisible();
  await seen;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // The five entries shown are the ones the badge still counts: nothing arrived, so there is no "5 new" button.
  await expect(main(page).getByRole('button', { name: t('feed.showNew', { count: 5 }) })).toHaveCount(0);
});

test('the news button hands the focus to the new entries it showed', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const ada = await person(newApi, uid, 'Ada');
  await api.requestBuddyByLink(await ada.api.replaceBuddyLink());
  await ada.api.acceptBuddy((await api.me()).id);
  await page.clock.install();
  const seen = page.waitForResponse('**/api/feed/seen');
  await shell.open('#/activity');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('link', { name: new RegExp(escape(t('feed.entry.newBuddy', { name: ada.name }))) })).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
  // The poll waits for the seen answer; the fake clock fires its timer once, so it must not run before it.
  await seen;
  await ada.api.addCombination({ title: `Focus ${uid}`, steps: [{ type: 'CUSTOM', label: 'Bisque firing' }] });
  const arrived = main(page).getByRole('button', { name: t('feed.showNew', { count: 1 }) });
  await runPollsUntil(page, async () => (await arrived.count()) > 0);
  await arrived.click();
  await expect(main(page).getByRole('heading', { level: 2, name: t('feed.new') })).toBeFocused();
});

test('"N new" pressed while "Show more" reads drops the older page, so no entry is skipped', async ({ page }) => {
  const entry = (name: string, minute: number): FeedEntryView => ({
    id: `entry-${name}`,
    type: 'NEW_BUDDY',
    actorId: `actor-${name}`,
    actorName: name,
    itemId: `actor-${name}`,
    at: `2026-11-10T10:${String(minute).padStart(2, '0')}:00Z`,
    clubId: null,
    clubName: null,
    glazeCode: null,
    glazeName: null,
    manufacturer: null,
    title: null,
  });
  const older = ['Eda', 'Eli', 'Emma'].map((name, index) => entry(name, 30 - index));
  const later = ['Fay', 'Finn', 'Flo'].map((name, index) => entry(name, 20 - index));
  const news = ['Nia', 'Noah', 'Nora'].map((name, index) => entry(name, 50 - index));
  const seenAt = '2026-11-10T11:00:00Z';
  let arrived = false;
  let releaseMore = () => {};
  const asked: string[] = [];
  await mockApi(page, {
    user: { ...MOCK_USER, feedUnread: 3 },
    answers: {
      'GET /api/feed': async (route) => {
        const before = new URL(route.request().url()).searchParams.get('before');
        asked.push(before ?? 'first');
        if (!before) {
          const body: FeedPageView = arrived ? { entries: news, next: news[2].id, seenAt } : { entries: older, next: older[2].id, seenAt };
          return route.fulfill({ json: body });
        }
        if (before === older[2].id) {
          // The page after the first one shown, answered only after the news were read.
          await new Promise<void>((resolve) => (releaseMore = resolve));
          return route.fulfill({ json: { entries: later, next: later[2].id, seenAt } satisfies FeedPageView });
        }
        return route.fulfill({ json: { entries: older, next: null, seenAt } satisfies FeedPageView });
      },
    },
  });
  await page.goto('/#/activity');
  const name = (person: string) => main(page).getByText(t('feed.entry.newBuddy', { name: person }));
  await expect(name('Emma')).toBeVisible();
  const more = page.waitForRequest((request) => request.url().includes(`before=${older[2].id}`));
  await main(page)
    .getByRole('button', { name: t('feed.showMore') })
    .click();
  await more;
  arrived = true;
  await main(page)
    .getByRole('button', { name: t('feed.showNew', { count: 3 }) })
    .click();
  await expect(name('Nora')).toBeVisible();
  const late = page.waitForResponse((response) => response.url().includes(`before=${older[2].id}`));
  releaseMore();
  await late;
  // The older page belonged to the list before the news: it is not appended, and "Show more" goes on after the news.
  const next = page.waitForRequest((request) => request.url().includes(`before=${news[2].id}`));
  await main(page)
    .getByRole('button', { name: t('feed.showMore') })
    .click();
  await next;
  await expect(name('Emma')).toBeVisible();
  await expect(name('Fay')).toHaveCount(0);
});

test('an item opened from the feed links back to the feed', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const ada = await person(newApi, uid, 'Ada');
  await api.requestBuddyByLink(await ada.api.replaceBuddyLink());
  await ada.api.acceptBuddy((await api.me()).id);
  const title = `Back ${uid}`;
  await ada.api.addCombination({ title, steps: [{ type: 'CUSTOM', label: 'Bisque firing' }] });
  await shell.open('#/activity');
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('link', { name: new RegExp(escape(t('feed.entry.buddyCombination', { name: ada.name, title }))) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await main(page)
    .getByRole('link', { name: t('feed.title'), exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: t('feed.title') })).toBeVisible();
});

/** The new-request toast (FEED-2): inside the toasts' polite status region. */
const requestToast = (page: Page) => page.getByRole('status').locator('.app-shell__toast--request');

test('a buddy request that arrives while the app is open shows one quiet toast, and Answer opens the Buddies section', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}, info) => {
  const ada = await person(newApi, uid, 'Ada');
  const ben = await person(newApi, uid, 'Ben');
  await page.clock.install();
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(bell(page)).toHaveAccessibleName(t('feed.open'));
  // Ada asks while Ana sits on Explore: the next poll brings the toast with her name, and the focus stays where it was.
  await ada.api.requestBuddyByLink(await api.replaceBuddyLink());
  const toast = requestToast(page);
  await runPollsUntil(page, async () => (await toast.count()) > 0);
  await expect(toast).toContainText(t('feed.requestToast', { name: ada.name, others: 0 }));
  expect(await page.evaluate(() => !!document.activeElement?.closest('.app-shell__toasts'))).toBe(false);
  await page.screenshot({ path: info.outputPath('request-toast.png'), animations: 'disabled' });
  await expectAccessible(page);
  // Escape inside it closes it like Dismiss and hands the focus to the page (FEED-2 review); it does not come back for the same request.
  await toast.getByRole('button', { name: t('feed.requestToastAnswer') }).focus();
  await page.keyboard.press('Escape');
  await expect(toast).toHaveCount(0);
  await expect(page.locator('main')).toBeFocused();
  await runPolls(page, 2);
  await expect(toast).toHaveCount(0);
  // A second request: one toast naming the newest and counting the other.
  await ben.api.requestBuddyByLink(await api.replaceBuddyLink());
  await runPollsUntil(page, async () => (await toast.count()) > 0);
  await expect(toast).toContainText(t('feed.requestToast', { name: ben.name, others: 1 }));
  // Answer opens the Buddies section with both requests and gives its heading the focus.
  await toast.getByRole('button', { name: t('feed.requestToastAnswer') }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(main(page).getByRole('heading', { level: 2, name: t('buddies.title'), exact: true })).toBeFocused();
  await expect(main(page).getByText(ben.name, { exact: true }).first()).toBeVisible();
  await expect(main(page).getByText(ada.name, { exact: true }).first()).toBeVisible();
  await expect(toast).toHaveCount(0);
});

test('no toast for a request the app already listed when it started, nor on the activity page that shows it', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const ada = await person(newApi, uid, 'Ada');
  const ben = await person(newApi, uid, 'Ben');
  await ada.api.requestBuddyByLink(await api.replaceBuddyLink());
  await page.clock.install();
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(bell(page)).toHaveAccessibleName(t('feed.openUnread', { count: 1 }));
  await runPolls(page, 2);
  await expect(requestToast(page)).toHaveCount(0);
  // On the activity page a new request is its news, not a toast.
  const seen = page.waitForResponse('**/api/feed/seen');
  await bell(page).click();
  await expect(main(page).getByRole('heading', { level: 1, name: t('feed.title') })).toBeVisible();
  await seen;
  await ben.api.requestBuddyByLink(await api.replaceBuddyLink());
  const arrived = main(page).getByRole('button', { name: t('feed.showNew', { count: 1 }) });
  await runPollsUntil(page, async () => (await arrived.count()) > 0);
  await expect(arrived).toBeVisible();
  await expect(requestToast(page)).toHaveCount(0);
  // Leaving the page does not bring it back as a toast.
  await page
    .getByRole('link', { name: t('nav.explore') })
    .first()
    .click();
  await runPolls(page, 2);
  await expect(requestToast(page)).toHaveCount(0);
});

test('a guest is asked to sign in and sees no bell', async ({ page, shell }) => {
  await shell.open('#/activity');
  await expect(main(page).getByRole('heading', { name: t('feed.signIn') })).toBeVisible();
  await expect(bell(page)).toHaveCount(0);
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
