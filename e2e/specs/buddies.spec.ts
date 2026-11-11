import type { Locator, Page } from '@playwright/test';
import type { Api } from '../support/api';
import type { AppShell } from '../support/pages/app-shell';
import { t } from '../support/i18n';
import { readFile } from 'node:fs/promises';
import { decodePng } from '../support/qr-image';
import { expect, newAccount, test } from '../support/test';

/** Glaze buddies: the Buddies section of the account page, the buddy link and its code, the request page and a club member's row. */
const main = (page: Page) => page.getByRole('main');
const buddiesSection = (page: Page) =>
  main(page)
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: t('buddies.title'), exact: true }) });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const tokenOf = (link: string) => link.slice(link.lastIndexOf('/') + 1);

/** Opens a route in a fresh load of the app (a same-hash goto would not reload, and the lists are read on load). */
async function reload(page: Page, shell: AppShell, hash: string) {
  await page.goto('about:blank');
  await shell.open(hash);
}

/** Another person, signed up in a session of their own. */
async function person(newApi: () => Promise<Api>, uid: string, name: string) {
  const api = await newApi();
  // The address keeps to letters and digits, whatever the display name.
  await api.signUp({ ...newAccount(uid, name.replace(/[^a-z0-9]/gi, '').slice(0, 20)), displayName: name });
  return { api, id: (await api.me()).id };
}

/** The buddy link a person created, as the token the API answered. */
async function linkOf(api: Api) {
  const token = await api.replaceBuddyLink();
  return { token, href: `#/buddy/${token}` };
}

/**
 * Where waiting requests show in the header: the quiet line of the account menu (phone), the activity bell's count (wide; FEED-1:
 * each request is a new activity entry, so the bell names it as new).
 */
async function requestLine(page: Page, name: string, phone: boolean, count: number): Promise<Locator> {
  const header = page.getByRole('banner');
  if (!phone) return header.getByRole('link', { name: t('feed.openUnread', { count }), exact: true });
  const menu = header.getByRole('button', { name: t('header.accountMenu', { name }) });
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  return header.getByRole('link', { name: t('buddies.requestCount', { count }), exact: true });
}

test('a member without buddies makes a link with its code, and accepts the first request @smoke', async ({ page, shell, newApi, signedIn, uid }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = buddiesSection(page);
  await expect(section).toBeVisible();
  await expect(section.getByText(t('buddies.list.empty'))).toBeVisible();
  // Nothing about requests yet: no heading, no line in the header or the menu.
  await expect(section.getByRole('heading', { level: 3 })).toHaveText([t('buddies.list.title'), t('buddies.link.title')]);
  await expect(page.getByRole('banner').getByText(/buddy request/)).toHaveCount(0);
  await expect(section.getByText(t('buddies.link.body'), { exact: true })).toBeVisible();

  await section.getByRole('button', { name: t('buddies.link.create') }).click();
  const field = section.getByRole('textbox', { name: t('buddies.link.field') });
  await expect(field).toHaveValue(/#\/buddy\/[\w-]+$/);
  await expect(field).toBeFocused();
  const link = await field.inputValue();

  // The code is there without a click, the text link stays beside it, and the phone's camera reads the same link from it.
  const code = section.getByRole('img', { name: t('qr.label') });
  await expect(code).toBeVisible();
  await expect(field).toBeVisible();
  expect(await decodePng(page, await code.screenshot()), 'ZXing reads the code as the buddy link').toEqual([link]);
  // Save downloads a PNG whose pixels ZXing reads back as the exact link; the name carries no token.
  await expect(section.getByText(t('qr.saveHint'))).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: t('qr.save') }).click()]);
  expect(download.suggestedFilename()).toBe('glazelab-buddy-link.png');
  expect(await decodePng(page, await readFile((await download.path())!)), 'ZXing reads the saved file as the buddy link').toEqual([link]);
  await expect(section.getByText(t('qr.saved'))).toBeVisible();

  // Copy puts the link on the clipboard; this desktop browser has no share sheet.
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'])
    .catch(() => undefined);
  if (!shell.phone) {
    await section.getByRole('button', { name: t('buddies.link.copy') }).click();
    await expect(page.getByText(t('notices.linkCopied'))).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await expect(section.getByRole('button', { name: t('buddies.link.share') })).toHaveCount(0);
  }

  // Bo opens the link and asks; the request shows after the next load, as one quiet line and in the section.
  const bo = await person(newApi, uid, 'Bo');
  expect(await bo.api.previewBuddyLink(tokenOf(link))).toEqual({ displayName: signedIn.displayName, relation: 'NONE', avatarId: null });
  expect(await bo.api.requestBuddyByLink(tokenOf(link))).toEqual({ relation: 'OUTGOING' });
  await reload(page, shell, '#/account');
  const line = await requestLine(page, signedIn.displayName, shell.phone, 1);
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('href', shell.phone ? '#/account' : '#/activity');
  // Text only: no dot or badge on the menu button, whose name stays the same.
  if (shell.phone)
    await expect(page.getByRole('banner').getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) })).toHaveText(/^\s*A\s*$/);
  // The link cannot be shown again after a reload, and says so.
  await expect(section.getByText(t('buddies.link.hidden'))).toBeVisible();
  await expect(section.getByRole('heading', { level: 3, name: t('buddies.incoming.title') })).toBeVisible();
  const row = section.getByRole('listitem').filter({ hasText: 'Bo' });
  await row.getByRole('button', { name: t('buddies.accept.label', { name: 'Bo' }) }).click();
  await expect(page.getByText(t('notices.buddiesNow', { name: 'Bo' }))).toBeVisible();
  await expect(section.getByRole('heading', { level: 3, name: t('buddies.incoming.title') })).toHaveCount(0);
  await expect(section.getByRole('listitem').filter({ hasText: 'Bo' })).toHaveCount(1);
  await expect(section.getByRole('button', { name: t('buddies.remove.label', { name: 'Bo' }) })).toBeVisible();
  // The row and its button are gone: the focus stays in the section, at its list.
  await expect(section.getByRole('heading', { level: 3, name: t('buddies.list.title') })).toBeFocused();
  expect((await bo.api.buddies()).buddies.map((buddy) => buddy.displayName)).toEqual([signedIn.displayName]);
  // The line is gone with the request.
  await expect(page.getByRole('banner').getByText(/buddy request/)).toHaveCount(0);
});

test('the request line counts requests in plural and never sits on the menu button', async ({ page, shell, newApi, api, signedIn, uid }) => {
  const mine = await linkOf(api);
  for (const name of ['Bo', 'Cy']) {
    const other = await person(newApi, uid, name);
    await other.api.requestBuddyByLink(tokenOf(mine.token));
  }
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const line = await requestLine(page, signedIn.displayName, shell.phone, 2);
  await expect(line).toBeVisible();
  await line.click();
  // Wide: the bell opens the activity, whose request entries lead to the account page.
  if (!shell.phone)
    await page
      .getByRole('main')
      .getByRole('link', { name: new RegExp(t('feed.entry.buddyRequest', { name: '' }).trim()) })
      .first()
      .click();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(buddiesSection(page).getByRole('listitem')).toHaveCount(2);
});

test('declining and cancelling a request end it without a word to the other person', async ({ page, shell, newApi, api, signedIn, uid }) => {
  const mine = await linkOf(api);
  const cy = await person(newApi, uid, 'Cy');
  await cy.api.requestBuddyByLink(tokenOf(mine.token));
  const dee = await person(newApi, uid, 'Dee');
  const deesLink = await linkOf(dee.api);
  await api.requestBuddyByLink(deesLink.token);

  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = buddiesSection(page);
  const incoming = section.getByRole('listitem').filter({ hasText: 'Cy' });
  await incoming.getByRole('button', { name: t('buddies.decline.label', { name: 'Cy' }) }).click();
  await expect(page.getByText(t('notices.buddyDeclined', { name: 'Cy' }))).toBeVisible();
  await expect(section.getByRole('listitem').filter({ hasText: 'Cy' })).toHaveCount(0);
  expect((await cy.api.buddies()).outgoing).toEqual([]);

  await expect(section.getByRole('heading', { level: 3, name: t('buddies.outgoing.title') })).toBeVisible();
  const outgoing = section.getByRole('listitem').filter({ hasText: 'Dee' });
  await expect(outgoing).toContainText(t('buddies.outgoing.waiting'));
  await outgoing.getByRole('button', { name: t('buddies.cancel.label', { name: 'Dee' }) }).click();
  await expect(page.getByText(t('notices.buddyCancelled', { name: 'Dee' }))).toBeVisible();
  await expect(section.getByRole('heading', { level: 3, name: t('buddies.outgoing.title') })).toHaveCount(0);
  expect((await dee.api.buddies()).incoming).toEqual([]);
});

test('removing a buddy asks first and says what ends; the other person is not told', async ({ page, shell, newApi, api, signedIn, uid }) => {
  const mine = await linkOf(api);
  const bo = await person(newApi, uid, 'Bo');
  await bo.api.requestBuddyByLink(tokenOf(mine.token));
  await api.acceptBuddy(bo.id);

  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = buddiesSection(page);
  const remove = section.getByRole('button', { name: t('buddies.remove.label', { name: 'Bo' }) });
  await remove.click();
  const question = dialog(page, t('buddies.remove.title', { name: 'Bo' }));
  await expect(question.getByText(t('buddies.remove.body', { name: 'Bo' }))).toBeVisible();
  // Cancel keeps the buddy and returns focus to the button that asked.
  await question.getByRole('button', { name: t('common.cancel') }).click();
  await expect(question).toBeHidden();
  await expect(remove).toBeFocused();
  expect((await bo.api.buddies()).buddies).toHaveLength(1);

  await remove.click();
  await question.getByRole('button', { name: t('buddies.remove.confirm') }).click();
  await expect(page.getByText(t('notices.buddyRemoved', { name: 'Bo' }))).toBeVisible();
  await expect(section.getByText(t('buddies.list.empty'))).toBeVisible();
  expect((await bo.api.buddies()).buddies).toEqual([]);
  // Either may ask again.
  await bo.api.requestBuddyByLink(tokenOf(mine.token));
  expect((await api.buddies()).incoming.map((buddy) => buddy.displayName)).toEqual(['Bo']);
});

test('replacing the buddy link asks first, and the old link then says it is invalid or replaced', async ({ page, shell, newApi, signedIn, uid }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = buddiesSection(page);
  await section.getByRole('button', { name: t('buddies.link.create') }).click();
  const field = section.getByRole('textbox', { name: t('buddies.link.field') });
  const old = await field.inputValue();

  await section.getByRole('button', { name: t('buddies.link.replace') }).click();
  const question = dialog(page, t('buddies.link.confirmTitle'));
  await expect(question.getByText(t('buddies.link.confirmBody'))).toBeVisible();
  await question.getByRole('button', { name: t('common.cancel') }).click();
  await expect(field).toHaveValue(old);

  await section.getByRole('button', { name: t('buddies.link.replace') }).click();
  await question.getByRole('button', { name: t('buddies.link.confirm') }).click();
  await expect(field).not.toHaveValue(old);
  await expect(field).toBeFocused();
  const fresh = await field.inputValue();

  // The old link: the preview and the request refuse alike, without saying more.
  const bo = await person(newApi, uid, 'Bo');
  await expect(bo.api.previewBuddyLink(tokenOf(old))).rejects.toThrow(/404/);
  await expect(bo.api.requestBuddyByLink(tokenOf(old))).rejects.toThrow(/404/);
  expect(await bo.api.previewBuddyLink(tokenOf(fresh))).toMatchObject({ relation: 'NONE' });

  // Opened in the app, the old link says so and offers nothing but Close.
  await shell.open(new URL(old).hash);
  const request = dialog(page, t('buddies.request.title'));
  await expect(request.getByRole('alert')).toHaveText(t('errors.buddyLinkInvalid'));
  await expect(request.getByRole('button', { name: t('buddies.request.send') })).toHaveCount(0);
  await request
    .getByRole('button', { name: t('common.close') })
    .first()
    .click();
  await expect(request).toBeHidden();
  await expect(page).toHaveURL(/#\/$/);

  // A link pasted with the full stop of its sentence, or cut short, is invalid too: never the API's form-field message.
  for (const broken of [`${new URL(fresh).hash}.`, new URL(fresh).hash.slice(0, -5)]) {
    await page.evaluate((hash) => (location.hash = hash), broken);
    await expect(request.getByRole('alert')).toHaveText(t('errors.buddyLinkInvalid'));
    await page.keyboard.press('Escape');
    await expect(request).toBeHidden();
    await expect(page).toHaveURL(/#\/$/);
  }
});

test('Create never replaces a link made meanwhile in another tab: the page says so and offers Replace', async ({ page, shell, newApi, api, signedIn, uid }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = buddiesSection(page);
  const create = section.getByRole('button', { name: t('buddies.link.create') });
  await expect(create).toBeVisible();
  // Another tab of the same account makes a link and shares it.
  const shared = await linkOf(api);
  await create.click();
  await expect(section.getByRole('alert')).toHaveText(t('errors.buddyLinkExists'));
  await expect(section.getByText(t('buddies.link.hidden'))).toBeVisible();
  await expect(section.getByRole('button', { name: t('buddies.link.replace') })).toBeVisible();
  await expect(section.getByRole('textbox', { name: t('buddies.link.field') })).toHaveCount(0);
  // The shared link still works.
  const bo = await person(newApi, uid, 'Bo');
  expect(await bo.api.previewBuddyLink(shared.token)).toMatchObject({ displayName: signedIn.displayName, relation: 'NONE' });
});

test('the request page asks before it sends, then leaves the token out of history @smoke', async ({ page, shell, newApi, signedIn, uid }) => {
  const ada = await person(newApi, uid, 'Ada');
  const link = await linkOf(ada.api);
  await shell.open(link.href);
  await shell.expectSignedIn(signedIn.displayName);
  const ask = dialog(page, t('buddies.request.ask', { name: 'Ada' }));
  await expect(ask.getByRole('heading', { level: 2, name: t('buddies.request.ask', { name: 'Ada' }) })).toBeVisible();
  await expect(ask.getByText(t('buddies.request.askBody', { name: 'Ada' }))).toBeVisible();
  // Opening the link asked nothing.
  expect((await ada.api.buddies()).incoming).toEqual([]);

  // Cancel leaves without asking, and the token leaves the history.
  await ask.getByRole('button', { name: t('common.cancel') }).click();
  await expect(ask).toBeHidden();
  await expect(page).toHaveURL(/#\/$/);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(link.token);
  expect((await ada.api.buddies()).incoming).toEqual([]);

  await shell.open(link.href);
  await ask.getByRole('button', { name: t('buddies.request.send') }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(page.getByText(t('notices.buddyRequested', { name: 'Ada' }))).toBeVisible();
  const outgoing = buddiesSection(page).getByRole('listitem').filter({ hasText: 'Ada' });
  await expect(outgoing).toContainText(t('buddies.outgoing.waiting'));
  expect((await ada.api.buddies()).incoming.map((buddy) => buddy.displayName)).toEqual([signedIn.displayName]);
  // Back does not return to the link: the entry was replaced.
  await page.goBack();
  expect(page.url()).not.toContain(link.token);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(link.token);
});

test('the request page for each relation: pending, buddies, a request to this account (asking back accepts) and the own link', async ({
  page,
  shell,
  newApi,
  api,
  signedIn,
  uid,
}) => {
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const open = async (hash: string, title = t('buddies.request.title')) => {
    await page.evaluate((value) => (location.hash = value), hash);
    return dialog(page, title);
  };

  // Pending: Ana asked Ada, who has not answered.
  const ada = await person(newApi, uid, 'Ada');
  const adas = await linkOf(ada.api);
  await api.requestBuddyByLink(adas.token);
  const pending = await open(adas.href);
  await expect(pending.getByText(t('buddies.request.pending', { name: 'Ada' }))).toBeVisible();
  await expect(pending.getByRole('button', { name: t('buddies.request.send') })).toHaveCount(0);
  await pending.getByRole('button', { name: t('buddies.request.open') }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(buddiesSection(page).getByRole('listitem').filter({ hasText: 'Ada' })).toBeVisible();

  // Buddies: Ada accepts.
  await ada.api.acceptBuddy((await api.me()).id);
  const already = await open(adas.href);
  await expect(already.getByText(t('buddies.request.buddies', { name: 'Ada' }))).toBeVisible();
  await already
    .getByRole('button', { name: t('common.close') })
    .last()
    .click();
  await expect(already).toBeHidden();

  // A request to this account: Cy asked Ana's link; Cy's own link accepts it (crossed requests become buddies).
  const mine = await linkOf(api);
  const cy = await person(newApi, uid, 'Cy');
  await cy.api.requestBuddyByLink(mine.token);
  const cys = await linkOf(cy.api);
  const incoming = await open(cys.href);
  await expect(incoming.getByText(t('buddies.request.incoming', { name: 'Cy' }))).toBeVisible();
  await incoming.getByRole('button', { name: t('buddies.request.accept') }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(page.getByText(t('notices.buddiesNow', { name: 'Cy' }))).toBeVisible();
  await expect(buddiesSection(page).getByRole('button', { name: t('buddies.remove.label', { name: 'Cy' }) })).toBeVisible();

  // The account's own link.
  const own = await open(`#/buddy/${tokenOf(mine.token)}`);
  await expect(own.getByText(t('buddies.request.own'))).toBeVisible();
  await expect(own.getByRole('button', { name: t('buddies.request.send') })).toHaveCount(0);
});

test('a guest who opens a buddy link signs in and returns to the same request', async ({ page, shell, newApi, account, uid }) => {
  const ada = await person(newApi, uid, 'Ada');
  const link = await linkOf(ada.api);
  await shell.open(link.href);
  await shell.expectGuest();
  const guest = dialog(page, t('buddies.request.title'));
  await expect(guest.getByText(t('buddies.request.signIn'))).toBeVisible();
  // Nothing of the owner is shown before signing in.
  await expect(guest.getByText('Ada')).toHaveCount(0);
  await guest.getByRole('button', { name: t('common.signInOrJoin') }).click();
  const auth = page.getByRole('dialog', { name: t('auth.dialogLabel') });
  await auth.getByLabel(t('common.email')).fill(account.email);
  await auth.getByLabel(t('auth.password')).fill(account.password);
  await auth.getByRole('button', { name: t('common.signIn'), exact: true }).click();
  await expect(auth).toBeHidden();
  await expect(dialog(page, t('buddies.request.ask', { name: 'Ada' }))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/buddy/${link.token}$`));
});

test('a club member asks another to be buddies from the member list, and the list follows the answer', async ({ page, shell, newApi, api, signedIn, uid }) => {
  const cleo = await person(newApi, uid, 'Cleo');
  const { club, token } = await cleo.api.clubWithInvite(`Kiln ${uid}`);
  await api.joinClub(token);
  const dee = await person(newApi, uid, 'Dee');
  await dee.api.joinClub(token);
  const ben = await person(newApi, uid, 'Ben');
  await ben.api.joinClub(token);

  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const row = (name: string) => main(page).getByRole('listitem').filter({ hasText: name });
  // The account's own row has no control; the others offer one.
  await expect(row(signedIn.displayName)).toHaveCount(1);
  await expect(row(signedIn.displayName).getByRole('button')).toHaveCount(0);
  const ask = row('Cleo').getByRole('button', { name: t('clubs.page.buddy.askLabel', { name: 'Cleo' }) });
  await expect(ask).toHaveText(t('clubs.page.buddy.ask'));
  await ask.click();
  await expect(row('Cleo').getByText(t('clubs.page.buddy.sent'))).toBeVisible();
  await expect(row('Cleo').getByText(t('clubs.page.buddy.sent'))).toBeFocused();
  await expect(row('Cleo').getByRole('button')).toHaveCount(0);
  expect((await cleo.api.buddies()).incoming.map((buddy) => buddy.displayName)).toEqual([signedIn.displayName]);

  // Cleo accepts elsewhere; the next load shows Buddies.
  await cleo.api.acceptBuddy((await api.me()).id);
  await reload(page, shell, `#/clubs/${club.id}`);
  await expect(row('Cleo').getByText(t('clubs.page.buddy.buddies'), { exact: true })).toBeVisible();

  // Dee asked this account first: the row says so and accepts.
  await dee.api.requestBuddyInClub(club.id, (await api.me()).id);
  await reload(page, shell, `#/clubs/${club.id}`);
  await expect(row('Dee').getByText(t('clubs.page.buddy.asked'))).toBeVisible();
  await row('Dee')
    .getByRole('button', { name: t('buddies.accept.label', { name: 'Dee' }) })
    .click();
  await expect(row('Dee').getByText(t('clubs.page.buddy.buddies'), { exact: true })).toBeVisible();

  // Crossed requests: Ben asks while this page still offers Ask; the server accepts, and the row turns to Buddies.
  await expect(row('Ben').getByRole('button', { name: t('clubs.page.buddy.askLabel', { name: 'Ben' }) })).toBeVisible();
  await ben.api.requestBuddyInClub(club.id, (await api.me()).id);
  await row('Ben')
    .getByRole('button', { name: t('clubs.page.buddy.askLabel', { name: 'Ben' }) })
    .click();
  await expect(row('Ben').getByText(t('clubs.page.buddy.buddies'), { exact: true })).toBeVisible();
  expect((await api.buddies()).buddies.map((buddy) => buddy.displayName).sort()).toEqual(['Ben', 'Cleo', 'Dee']);

  // An accept that comes too late (Eva withdrew meanwhile) says so at Eva's row, not only in the account page's section.
  const me = (await api.me()).id;
  const eva = await person(newApi, uid, 'Eva');
  await eva.api.joinClub(token);
  await eva.api.requestBuddyInClub(club.id, me);
  await reload(page, shell, `#/clubs/${club.id}`);
  const late = row('Eva').getByRole('button', { name: t('buddies.accept.label', { name: 'Eva' }) });
  await expect(late).toBeVisible();
  await eva.api.cancelBuddyRequest(me);
  await late.click();
  await expect(row('Eva').getByRole('alert')).toHaveText(t('errors.buddyRequestNotFound'));
  await expect(row('Eva').getByRole('button', { name: t('clubs.page.buddy.askLabel', { name: 'Eva' }) })).toBeVisible();
});

test('many buddies and requests list by name, and a long name wraps', async ({ page, shell, newApi, api, signedIn, uid }) => {
  const mine = await linkOf(api);
  const names = ['Zoe', 'Åsa', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'];
  const longName = `Maximiliana ${'Wolkenschmiedinger'.repeat(2)}`;
  for (const name of names) {
    const other = await person(newApi, uid, name);
    await other.api.requestBuddyByLink(tokenOf(mine.token));
    if (!['Gus', 'Fay'].includes(name)) await api.acceptBuddy(other.id);
  }
  const longOne = await person(newApi, uid, longName);
  await longOne.api.requestBuddyByLink(tokenOf(mine.token));
  await api.acceptBuddy(longOne.id);

  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = buddiesSection(page);
  await expect(section.getByRole('heading', { level: 3, name: t('buddies.incoming.title') })).toBeVisible();
  const lists = section.getByRole('list');
  // The names, not the rows: a row starts with the round picture's initial letter.
  await expect(lists.nth(0).locator('.buddies__name')).toHaveText([/^Fay/, /^Gus/]);
  const mineList = lists.nth(1).getByRole('listitem');
  await expect(mineList).toHaveCount(7);
  await expect(mineList.first()).toContainText('Åsa');
  // No horizontal scroll, however long the name.
  await expect(section.getByText(longName)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a 100-character name without spaces wraps in the request page, the remove question and the notice', async ({ page, shell, newApi, signedIn, uid }) => {
  // The longest display name the API takes, in one word: clipped text (overflow hidden) would hide who is asked.
  const name = 'Wolkenschmiedinger'.repeat(6).slice(0, 100);
  const long = await person(newApi, uid, name);
  const link = await linkOf(long.api);
  /** Every element of the box whose content is wider than the element itself, or that reaches past either side of the viewport. */
  const clipped = (selector: string) =>
    page.evaluate(
      (css) =>
        Array.from(document.querySelectorAll(css))
          .flatMap((box) => [box, ...Array.from(box.querySelectorAll('*'))])
          .filter(
            (element) =>
              element.scrollWidth > element.clientWidth + 1 ||
              element.getBoundingClientRect().left < 0 ||
              element.getBoundingClientRect().right > window.innerWidth,
          )
          .map((element) => element.tagName + '.' + element.className),
      selector,
    );
  await shell.open(link.href);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(dialog(page, t('buddies.request.ask', { name }))).toBeVisible();
  expect(await clipped('[role=dialog]')).toEqual([]);
  await page.getByRole('button', { name: t('buddies.request.send') }).click();
  await expect(page.getByRole('status').filter({ hasText: t('notices.buddyRequested', { name }) })).toBeVisible();
  expect(await clipped('[role=status]')).toEqual([]);

  // The remove question, once the request is accepted.
  await long.api.acceptBuddy((await long.api.buddies()).incoming[0].id);
  await reload(page, shell, '#/account');
  await buddiesSection(page)
    .getByRole('button', { name: t('buddies.remove.label', { name }) })
    .click();
  await expect(dialog(page, t('buddies.remove.title', { name }))).toBeVisible();
  expect(await clipped('[role=dialog]')).toEqual([]);
});

test('offline the section shows the saved buddies and every action waits for the connection', async ({ page, shell, newApi, api, signedIn, uid, context }) => {
  const mine = await linkOf(api);
  const bo = await person(newApi, uid, 'Bo');
  await bo.api.requestBuddyByLink(tokenOf(mine.token));
  await api.acceptBuddy(bo.id);
  const cy = await person(newApi, uid, 'Cy');
  await cy.api.requestBuddyByLink(tokenOf(mine.token));

  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const section = buddiesSection(page);
  await expect(section.getByRole('listitem').filter({ hasText: 'Bo' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  const note = section.getByText(t('buddies.offline'));
  await expect(note).toBeVisible({ timeout: 2000 });
  for (const name of [
    t('buddies.accept.label', { name: 'Cy' }),
    t('buddies.decline.label', { name: 'Cy' }),
    t('buddies.remove.label', { name: 'Bo' }),
    t('buddies.link.replace'),
  ]) {
    await expect(section.getByRole('button', { name })).toBeDisabled();
  }
  await expect(section.getByRole('listitem').filter({ hasText: 'Bo' })).toBeVisible();
  // The request line stays what the last connection saw, and the offline pill rules are the same as before.
  await context.setOffline(false);
  await expect(note).toBeHidden();
  await expect(section.getByRole('button', { name: t('buddies.accept.label', { name: 'Cy' }) })).toBeEnabled();
});
