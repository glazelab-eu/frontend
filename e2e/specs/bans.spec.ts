import type { Locator, Page } from '@playwright/test';
import { Api, BISQUE_STEP } from '../support/api';
import { seededPicture } from '../support/images';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/**
 * Banning accounts (34-2, backend "Bans"): a site admin bans from the profile-picture queue, the photo queue and a club's member list
 * through one dialog (a required reason, what happens, Cancel before the destructive button), the person can no longer sign in, and the
 * Bans page lists the entries (date and reason only: never an address or a name, 34-7) and lifts them, after which the address can
 * register again. The API is real; site
 * admins are made with SQL on the suite's database, as the README says; paging needs more than 50 bans and is mocked.
 */
const main = (page: Page) => page.getByRole('main');

/** A person with a name that carries the test's ID (the suite's database, and so the lists, are shared), optionally with a profile picture. */
async function person(newApi: () => Promise<Api>, uid: string, name: string, picture = true) {
  const api = await newApi();
  const account = { ...newAccount(uid, name), displayName: `${name} ${uid}` };
  await api.signUp(account);
  const avatarId = picture ? await api.uploadAvatar(seededPicture(`${uid}-${name}`, `${name}.png`)) : null;
  return { api, account, name: account.displayName, avatarId, id: (await api.me()).id };
}

const banButton = (within: Locator, name: string) => within.getByRole('button', { name: `${t('ban.entry')}: ${name}` });
const queueEntry = (page: Page, name: string) => page.locator('.avatar-reports__entry').filter({ has: page.getByText(name, { exact: true }) });

/** The ban requests the page sends. */
function banRequests(page: Page) {
  const seen: { path: string; body: unknown }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/admin\/users\/[^/]+\/ban$/.test(request.url())) {
      seen.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
    }
  });
  return seen;
}

/** The names of a dialog's buttons, in order (the close button first). */
const buttonNames = (dialog: Locator) => dialog.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim()));

test('a site admin bans the owner of a reported picture: the dialog, the required reason, the picture block, and the person is out @smoke', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  test.setTimeout(120_000);
  const [ben, cleo, fay] = [await person(newApi, uid, 'Ben'), await person(newApi, uid, 'Cleo'), await person(newApi, uid, 'Fay', false)];
  await fay.api.reportAvatar(ben.avatarId!, `Shows a stranger ${uid}`);
  await fay.api.reportAvatar(cleo.avatarId!, `Rude to the ban test ${uid}`);
  await grantSiteAdmin(signedIn.email);
  const sent = banRequests(page);

  await shell.open('#/admin/avatar-reports');
  const entries = page.locator('.avatar-reports__entry').filter({ hasText: uid });
  await expect(entries).toHaveCount(2);
  const opener = banButton(queueEntry(page, ben.name), ben.name);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: t('ban.title', { name: ben.name }) });
  await expect(dialog).toBeVisible();
  // It names the person, says what happens, and starts at the reason.
  await expect(dialog.getByText(t('ban.effect.account'))).toBeVisible();
  await expect(dialog.getByText(t('ban.effect.address'))).toBeVisible();
  await expect(dialog.getByText(t('ban.effect.clubs'))).toBeVisible();
  const reason = dialog.getByRole('textbox', { name: t('ban.reason') });
  await expect(reason).toBeFocused();
  await expect(dialog.getByText(t('ban.count', { count: 0, max: 500 }))).toBeVisible();
  await reason.fill('x'.repeat(520));
  await expect(dialog.getByText(t('ban.count', { count: 500, max: 500 }))).toBeVisible();
  await reason.fill('');
  // Cancel comes before the destructive button, which is last.
  expect((await buttonNames(dialog)).slice(-2)).toEqual([t('common.cancel'), t('ban.submit')]);

  // The reason is required: nothing is sent for an empty or blank one.
  await dialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(reason).toBeFocused();
  expect(sent).toEqual([]);
  await reason.fill('   \n ');
  await dialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(dialog.getByText(t('ban.reasonRequired'))).toBeVisible();
  expect(sent).toEqual([]);
  await reason.fill('Harassed other members');
  await expect(dialog.getByText(t('ban.reasonRequired'))).toBeHidden();
  // The hint asks for a short reason without names or personal details.
  await expect(dialog.getByText(t('ban.reasonHelp'))).toBeVisible();

  // Cancel sends nothing and gives the focus back.
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  expect(sent).toEqual([]);
  expect((await ben.api.me()).id).toBe(ben.id);

  // The ban, with the reported pictures blocked.
  await opener.click();
  await dialog.getByRole('textbox', { name: t('ban.reason') }).fill(`  Harassed other members ${uid}  `);
  await dialog.getByRole('checkbox', { name: t('ban.blockPictures') }).check();
  await dialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('notices.banned', { name: ben.name }))).toBeVisible();
  expect(sent).toEqual([{ path: `/api/admin/users/${ben.id}/ban`, body: { reason: `Harassed other members ${uid}`, blockPictures: true } }]);
  // Blocked and decided: it left the open queue and shows as removed, its owner gone.
  await expect(entries).toHaveCount(1);
  await expect(main(page).locator('.avatar-reports')).toBeFocused();
  await main(page)
    .getByLabel(t('avatars.reports.filter'))
    .selectOption({ label: t('avatars.reports.filter.actioned') });
  const decided = main(page).locator('.avatar-reports__entry').filter({ hasText: fay.name });
  await expect(decided).toContainText(t('avatars.reports.status.actioned'));
  await expect(decided).toContainText(t('account.deleted'));
  // The picture and the reporter's text went with the account (34-7); the fingerprint keeps it blocked.
  await expect(decided).toContainText(t('avatars.reports.deletedWithAccount'));
  await expect(decided).not.toContainText('Shows a stranger');
  await expect(decided.getByRole('img')).toHaveCount(0);
  await expect(fay.api.uploadAvatar(seededPicture(`${uid}-Ben`, 'Ben.png'))).rejects.toThrow(/409/);
  await expect(decided.getByRole('button', { name: new RegExp(`^${t('ban.entry')}`) })).toHaveCount(0);
  // The person can no longer sign in, and the ban is on the list.
  await expect(ben.api.signIn(ben.account)).rejects.toThrow(/401/);
  expect((await api.bans()).entries.filter((entry) => entry.reason === `Harassed other members ${uid}`)).toHaveLength(1);

  // Cleo's ban without the picture choice: her picture goes with the account, so the report is closed without a decision or its text.
  await main(page)
    .getByLabel(t('avatars.reports.filter'))
    .selectOption({ label: t('avatars.reports.filter.open') });
  await banButton(queueEntry(page, cleo.name), cleo.name).click();
  const cleoDialog = page.getByRole('dialog', { name: t('ban.title', { name: cleo.name }) });
  await expect(cleoDialog.getByRole('checkbox', { name: t('ban.blockPictures') })).not.toBeChecked();
  await cleoDialog.getByRole('textbox', { name: t('ban.reason') }).fill('Repeated violations');
  await cleoDialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(cleoDialog).toBeHidden();
  expect(sent[1].body).toEqual({ reason: 'Repeated violations', blockPictures: false });
  expect((await api.avatarReports('OPEN')).entries.some((entry) => entry.avatarId === cleo.avatarId)).toBe(false);
  expect((await api.avatarReports('CLOSED')).entries.find((entry) => entry.avatarId === cleo.avatarId)).toMatchObject({
    status: 'CLOSED',
    picture: 'ACCOUNT_DELETED',
    ownerId: null,
    reason: null,
    hasPicture: false,
  });
  await expect(entries).toHaveCount(0);
  await expect(page.getByText(`Rude to the ban test ${uid}`)).toHaveCount(0);
  await expect(cleo.api.signIn(cleo.account)).rejects.toThrow(/401/);
});

test('a site admin bans the uploader of a reported photo from the photo queue; the public photo stays, with an anonymous uploader', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  test.setTimeout(120_000);
  const ben = await person(newApi, uid, 'Ben', false);
  const fay = await person(newApi, uid, 'Fay', false);
  const title = `Reported ${uid}`;
  const combination = await ben.api.addCombination({ title, steps: [BISQUE_STEP] });
  const photo = await ben.api.uploadToCombination(combination, { file: seededPicture(`${uid}-photo`, 'photo.png'), visibility: 'PUBLIC' });
  await fay.api.reportImage(photo.id, 'Not a glaze test');
  await grantSiteAdmin(signedIn.email);
  const sent = banRequests(page);

  await shell.open('#/admin/image-reports');
  const row = page.locator('.image-reports__entry').filter({ hasText: title });
  await expect(row).toBeVisible();
  // The uploader is named, so the admin knows whom the ban is about.
  await expect(row.getByText(ben.name, { exact: true })).toBeVisible();
  await banButton(row, ben.name).click();
  const dialog = page.getByRole('dialog', { name: t('ban.title', { name: ben.name }) });
  // Profile-picture reports are not what this queue is about: no picture choice here.
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: t('ban.reason') }).fill(`Posts unrelated pictures ${uid}`);
  await dialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('notices.banned', { name: ben.name }))).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual({ reason: `Posts unrelated pictures ${uid}`, blockPictures: false });
  // Shared content stays with anonymous attribution (as after an own deletion): the report is still there to decide, the uploader is gone.
  const after = page.locator('.image-reports__entry').filter({ hasText: title });
  await expect(after).toContainText(t('account.deleted'));
  await expect(after.getByText(ben.name, { exact: true })).toHaveCount(0);
  await expect(banButton(after, ben.name)).toHaveCount(0);
  await expect(after.getByRole('button', { name: new RegExp(`^${t('ban.entry')}`) })).toHaveCount(0);
  await expect(main(page).locator('.image-reports')).toBeFocused();
  expect((await page.request.get(`/api/images/${photo.id}`)).status()).toBe(200);
  await expect(ben.api.signIn(ben.account)).rejects.toThrow(/401/);
  expect((await api.bans()).entries.some((entry) => entry.reason === `Posts unrelated pictures ${uid}`)).toBe(true);
});

test('a site admin bans a member from the club list; a site admin or a vanished account is refused with a message', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  test.setTimeout(120_000);
  const [ben, cleo, dee] = [await person(newApi, uid, 'Ben', false), await person(newApi, uid, 'Cleo', false), await person(newApi, uid, 'Dee', false)];
  const { club, token } = await ben.api.clubWithInvite(`Ban ${uid}`);
  await dee.api.joinClub(token);
  await cleo.api.joinClub(token);
  await api.joinClub(token);
  await grantSiteAdmin(signedIn.email);
  await grantSiteAdmin(dee.account.email);
  const sent = banRequests(page);

  await shell.open(`#/clubs/${club.id}`);
  const row = (name: string) => main(page).getByRole('listitem').filter({ hasText: name });
  await expect(row(ben.name)).toBeVisible();
  // Every other member has the menu; the admin's own row has none.
  await expect(row(t('clubs.page.you')).getByRole('button', { name: /^Options for /i })).toHaveCount(0);
  const menu = (name: string) => row(name).getByRole('button', { name: t('member.menu', { name }) });
  await menu(ben.name).click();
  await expect(page.getByRole('menuitem', { name: t('ban.entry') })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(ben.name)).toBeFocused();

  // A site admin is refused by the API: the dialog stays open with the reason.
  await menu(dee.name).click();
  await page.getByRole('menuitem', { name: t('ban.entry') }).click();
  const deeDialog = page.getByRole('dialog', { name: t('ban.title', { name: dee.name }) });
  await deeDialog.getByRole('textbox', { name: t('ban.reason') }).fill('Trying');
  await deeDialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(deeDialog.getByText(t('errors.banSiteAdmin'))).toBeVisible();
  await expect(row(dee.name)).toBeVisible();
  await deeDialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(menu(dee.name)).toBeFocused();

  // Someone else banned Cleo while the dialog was open: "no longer exists", and her row is gone with the reload.
  await menu(cleo.name).click();
  await page.getByRole('menuitem', { name: t('ban.entry') }).click();
  const cleoDialog = page.getByRole('dialog', { name: t('ban.title', { name: cleo.name }) });
  await cleoDialog.getByRole('textbox', { name: t('ban.reason') }).fill('Spam');
  await api.ban(cleo.id, 'Spam');
  await cleoDialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(cleoDialog.getByText(t('errors.accountNotFound'))).toBeVisible();
  await expect(row(cleo.name)).toHaveCount(0);
  await cleoDialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(cleoDialog).toBeHidden();

  // The ban of Ben: his row leaves and the focus is at the member list's heading.
  await menu(ben.name).click();
  await page.getByRole('menuitem', { name: t('ban.entry') }).click();
  const dialog = page.getByRole('dialog', { name: t('ban.title', { name: ben.name }) });
  // Not a report queue: no picture choice.
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: t('ban.reason') }).fill('Harassment in the club');
  await dialog.getByRole('button', { name: t('ban.submit') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('notices.banned', { name: ben.name }))).toBeVisible();
  await expect(row(ben.name)).toHaveCount(0);
  await expect(main(page).getByRole('heading', { name: /^Members|^Mitglieder|^Membros/ })).toBeFocused();
  expect(sent.map((request) => request.path)).toEqual([`/api/admin/users/${dee.id}/ban`, `/api/admin/users/${cleo.id}/ban`, `/api/admin/users/${ben.id}/ban`]);
  // The club's only admin was banned: its longest-standing member (Dee, who joined before the admin) is admin now.
  expect((await dee.api.clubs()).find((each) => each.id === club.id)?.role).toBe('ADMIN');
  await expect(ben.api.signIn(ben.account)).rejects.toThrow(/401/);
});

test('only site admins get a ban control or the Bans page; a plain account asks the API for nothing of it', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const ben = await person(newApi, uid, 'Ben');
  const { club, token } = await ben.api.clubWithInvite(`Plain ${uid}`);
  await api.joinClub(token);
  const asked: string[] = [];
  page.on('request', (request) => request.url().includes('/api/admin/') && asked.push(request.url()));

  await shell.open(`#/clubs/${club.id}`);
  const row = main(page).getByRole('listitem').filter({ hasText: ben.name });
  await expect(row).toBeVisible();
  // His row has the report menu of a picture and nothing about a ban.
  await expect(row.getByRole('button', { name: t('avatar.report.menu', { name: ben.name }) })).toBeVisible();
  await expect(row.getByRole('button', { name: t('member.menu', { name: ben.name }) })).toHaveCount(0);
  await row.getByRole('button', { name: t('avatar.report.menu', { name: ben.name }) }).click();
  await expect(page.getByRole('menuitem')).toHaveText([t('avatar.report.entry')]);
  await page.keyboard.press('Escape');
  for (const route of ['#/admin/bans', '#/admin/avatar-reports', '#/admin/image-reports']) {
    await shell.open(route);
    await expect(main(page).getByText(/^Only site admins/)).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(t('ban.entry')) })).toHaveCount(0);
  }
  await expect(shell.footer.getByRole('link', { name: t('admin.title') })).toHaveCount(0);
  expect(asked).toEqual([]);
  // The API refuses it too.
  await expect(api.ban(ben.id, 'No right')).rejects.toThrow(/403/);
  await expect(api.bans()).rejects.toThrow(/403/);
  expect((await ben.api.me()).id).toBe(ben.id);
  void signedIn;
});

async function xsrf(page: Page): Promise<string> {
  return ((await (await page.request.get('/api/auth/csrf')).json()) as { token: string }).token;
}

test('the Bans page lists bans by date and reason, without any address or name, and lifts one after a question; the address can register again', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  test.setTimeout(120_000);
  const [ben, cleo] = [await person(newApi, uid, 'Ben', false), await person(newApi, uid, 'Cleo', false)];
  await grantSiteAdmin(signedIn.email);
  const first = `First reason ${uid}`;
  const second = `Second\nreason ${uid}`;
  await api.ban(ben.id, first);
  await api.ban(cleo.id, second);
  // The address stays blocked: a registration looks normal but yields no setup token and no account.
  const stranger = await newApi();
  expect((await stranger.registration(ben.account)).setupToken ?? null).toBeNull();

  await shell.open('#/');
  await shell.footer.getByRole('link', { name: t('admin.title') }).click();
  await main(page)
    .getByRole('link', { name: t('bans.title') })
    .click();
  await expect(main(page).getByRole('heading', { level: 1, name: t('bans.title') })).toBeVisible();
  await expect(main(page).getByText(t('bans.body'))).toBeVisible();
  const entries = main(page).locator('.bans__entry').filter({ hasText: uid });
  await expect(entries).toHaveCount(2);
  // Newest first, each with its date and reason; never a name (neither the banned person's nor the admin's).
  await expect(entries.nth(0)).toContainText('Second');
  await expect(entries.nth(1)).toContainText(first);
  await expect(entries.nth(1).locator('time')).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/);
  for (const name of [ben.name, cleo.name, signedIn.displayName]) {
    await expect(main(page).getByText(name)).toHaveCount(0);
    expect(JSON.stringify(await api.bans())).not.toContain(name);
  }
  // Never an address: not on the page, not in the answer.
  expect(await main(page).innerText()).not.toContain('@');
  expect(JSON.stringify(await api.bans())).not.toContain('@');

  // Cancel keeps the ban; the question says what lifting means.
  const lift = (reason: string) => entries.filter({ hasText: reason }).getByRole('button', { name: new RegExp(`^${t('bans.lift')}: `) });
  await lift(first).click();
  const dialog = page.getByRole('dialog', { name: t('bans.lift.title') });
  await expect(dialog.getByText(t('bans.lift.body'))).toBeVisible();
  // The question names the entry by its date and reason.
  await expect(dialog).toContainText(first);
  expect((await buttonNames(dialog)).slice(-2)).toEqual([t('common.cancel'), t('bans.lift')]);
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  await expect(lift(first)).toBeFocused();
  expect((await api.bans()).entries.some((entry) => entry.reason === first)).toBe(true);

  // Lifting: the entry leaves, and the address registers again as a new account (the old one does not come back).
  await lift(first).click();
  await dialog.getByRole('button', { name: t('bans.lift') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('notices.banLifted'))).toBeVisible();
  await expect(entries).toHaveCount(1);
  await expect(main(page).locator('.bans')).toBeFocused();
  expect((await api.bans()).entries.some((entry) => entry.reason === first)).toBe(false);
  await stranger.signUp({ ...ben.account, displayName: `Ben again ${uid}` });
  expect((await stranger.me()).id).not.toBe(ben.id);

  // Lifting one that was lifted meanwhile: the message, and the list shows what is true.
  await lift('Second').click();
  const cleoDialog = page.getByRole('dialog', { name: t('bans.lift.title') });
  const entry = (await api.bans()).entries.find((each) => each.reason === second)!;
  expect((await page.request.delete(`/api/admin/bans/${entry.id}`, { headers: { 'X-XSRF-TOKEN': await xsrf(page) } })).status()).toBe(204);
  await cleoDialog.getByRole('button', { name: t('bans.lift') }).click();
  await expect(main(page).getByText(t('errors.banNotFound'))).toBeVisible();
  await expect(entries).toHaveCount(0);
});

test('the Bans page pages 50 at a time with Show more, and offers a retry when a page fails', async ({ page }) => {
  const entry = (index: number) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    reason: `Reason ${index}`,
    bannedAt: '2026-10-31T10:00:00Z',
  });
  const pages: number[] = [];
  let failNext = true;
  await mockApi(page, {
    user: { ...MOCK_USER, siteAdmin: true },
    answers: {
      'GET /api/admin/bans': async (route) => {
        const asked = Number(new URL(route.request().url()).searchParams.get('page'));
        pages.push(asked);
        if (asked === 1 && failNext) {
          failNext = false;
          return route.fulfill({ status: 500, json: { error: 'Something went wrong.' } });
        }
        const first = asked * 50;
        const count = asked === 0 ? 50 : 3;
        await route.fulfill({ json: { entries: Array.from({ length: count }, (_, index) => entry(first + index)), hasMore: asked === 0 } });
      },
    },
  });
  await page.goto('/#/admin/bans');
  const rows = main(page).locator('.bans__entry');
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toContainText('Reason 0');
  // A failed page keeps the rows and offers a retry.
  await main(page)
    .getByRole('button', { name: t('bans.more') })
    .click();
  await expect(main(page).getByRole('button', { name: t('bans.retry') })).toBeVisible();
  await expect(rows).toHaveCount(50);
  await main(page)
    .getByRole('button', { name: t('bans.retry') })
    .click();
  await expect(rows).toHaveCount(53);
  await expect(main(page).getByRole('button', { name: t('bans.more') })).toHaveCount(0);
  expect(pages).toEqual([0, 1, 1]);
});
