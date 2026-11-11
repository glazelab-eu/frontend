import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { Api, BISQUE_STEP, PASSWORD } from '../support/api';
import { seededPicture } from '../support/images';
import { t } from '../support/i18n';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/**
 * Reporting a profile picture (31-3) and the site admins' queue of reports: the reason dialog, once per reporter, never for one's own
 * picture; the queue shows each reported picture as it was reported (also after a replacement; the owner's account deletion deletes the
 * picture and closes its reports, 34-7), dismisses or removes it (a removed picture is blocked), and never keeps the evidence in the browser. The API is real; site admins are made
 * with SQL on the suite's database, as the README says.
 */
const main = (page: Page) => page.getByRole('main');

async function person(newApi: () => Promise<Api>, uid: string, name: string, picture = true, displayName = name) {
  const api = await newApi();
  await api.signUp({ ...newAccount(uid, name), displayName });
  const file = picture ? seededPicture(`${uid}-${name}`, `${name}.png`) : null;
  const avatarId = file ? await api.uploadAvatar(file) : null;
  return { api, name: displayName, file, avatarId, id: (await api.me()).id, email: newAccount(uid, name).email };
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Opens a member's "⋯" menu, picks Report and sends the dialog's reason. */
async function report(page: Page, name: string, reason: string) {
  await page.getByRole('button', { name: t('avatar.report.menu', { name }) }).click();
  await page.getByRole('menuitem', { name: t('avatar.report.entry') }).click();
  const dialog = page.getByRole('dialog', { name: t('avatar.report.title') });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(t('avatar.report.body', { name }))).toBeVisible();
  await dialog.getByRole('textbox', { name: t('images.report.reason') }).fill(reason);
  await dialog.getByRole('button', { name: t('images.report.submit') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('notices.avatarReported'))).toBeVisible();
}

test('a member reports someone else’s picture from the club list with a reason, once, and never their own @smoke', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const ben = await person(newApi, uid, 'Ben');
  const { club, token } = await ben.api.clubWithInvite(`Report ${uid}`);
  await api.joinClub(token);
  const own = await api.uploadAvatar(seededPicture(`${uid}-Ana`));
  await shell.open(`#/clubs/${club.id}`);
  const requests: string[] = [];
  page.on('request', (request) => request.method() === 'POST' && request.url().includes('/reports') && requests.push(new URL(request.url()).pathname));

  // Ben's row has the menu, Ana's own row has none.
  const benRow = main(page).getByRole('listitem').filter({ hasText: 'Ben' });
  await expect(benRow.getByRole('button', { name: t('avatar.report.menu', { name: 'Ben' }) })).toBeVisible();
  const ownRow = main(page)
    .getByRole('listitem')
    .filter({ hasText: t('clubs.page.you') });
  await expect(ownRow.getByRole('button', { name: /profile picture/ })).toHaveCount(0);
  await expect(ownRow.locator('img[src^="blob:"]')).toHaveCount(1);

  // The menu: Escape closes it and the focus returns to its button; the dialog starts at the reason and Cancel sends nothing.
  const menu = benRow.getByRole('button', { name: t('avatar.report.menu', { name: 'Ben' }) });
  await menu.click();
  await expect(page.getByRole('menuitem', { name: t('avatar.report.entry') })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole('menuitem', { name: t('avatar.report.entry') }).click();
  const dialog = page.getByRole('dialog', { name: t('avatar.report.title') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();
  expect(requests).toEqual([]);

  await report(page, 'Ben', 'Shows a stranger’s face');
  expect(requests).toEqual([`/api/avatars/${ben.avatarId}/reports`]);
  await expect(menu).toBeFocused();
  // A second report from the same account is a success too (the server keeps the first).
  await report(page, 'Ben', 'Again');
  expect(requests).toHaveLength(2);

  // The API refuses a report of one's own picture; the page never offers it.
  await expect(api.reportAvatar(own)).rejects.toThrow(/400/);
});

test('the author line of a combination page offers the report, the Buddies section and the request page too', async ({
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
  const title = `Report page ${uid}`;
  const combination = await ben.api.addCombination({ title, steps: [BISQUE_STEP] });
  const me = (await api.me()).id;
  // Cleo is Ana's buddy, so her row is in the Buddies section.
  await cleo.api.requestBuddyByLink(await api.replaceBuddyLink());
  await api.acceptBuddy(cleo.id);
  const link = await dee.api.replaceBuddyLink();
  const posted: string[] = [];
  page.on('request', (request) => request.method() === 'POST' && request.url().includes('/reports') && posted.push(new URL(request.url()).pathname));

  await shell.open(`#/combinations/${combination}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await report(page, 'Ben', 'On the combination page');

  await shell.open('#/account');
  await expect(main(page).getByRole('listitem').filter({ hasText: 'Cleo' })).toBeVisible();
  await report(page, 'Cleo', 'In the buddies list');

  await page.evaluate((hash) => (location.hash = hash), `#/buddy/${link}`);
  const request = page.getByRole('dialog', { name: t('buddies.request.ask', { name: 'Dee' }) });
  await expect(request.getByText('Dee', { exact: true })).toBeVisible();
  await report(page, 'Dee', 'On the request page');
  // The request page is still open under it, with focus back on the menu.
  await expect(request).toBeVisible();
  expect(posted).toEqual([ben.avatarId, cleo.avatarId, dee.avatarId].map((id) => `/api/avatars/${id}/reports`));
  void me;
});

/** The queue's entry of a person (their name is its heading line). */
const entry = (page: Page, name: string) => page.locator('.avatar-reports__entry').filter({ has: page.getByText(name, { exact: true }) });
const decide = (within: Locator, label: Parameters<typeof t>[0]) => within.getByRole('button', { name: new RegExp(`^${t(label)}`) });
async function filterBy(page: Page, label: Parameters<typeof t>[0]) {
  await main(page)
    .getByLabel(t('avatars.reports.filter'))
    .selectOption({ label: t(label) });
}
/** Whether the picture of an entry is loaded (and how big). */
async function evidenceWidth(within: Locator): Promise<number> {
  const image = within.getByRole('img');
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  // The picture is loaded lazily, as it comes near the view.
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  return image.evaluate((element: HTMLImageElement) => element.naturalWidth);
}

test('a site admin works through the queue: evidence after a replacement, an account deletion closing its reports, dismissal, removal and the block', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
  context,
}) => {
  test.setTimeout(120_000);
  // The suite's database is shared by every test, so the names carry this test's ID and the queue is read through it.
  const named = (name: string, picture = true) => person(newApi, uid, name, picture, `${name} ${uid}`);
  const [ben, cleo, dee, eve] = [await named('Ben'), await named('Cleo'), await named('Dee'), await named('Eve')];
  const [fay, gus] = [await named('Fay', false), await named('Gus', false)];
  const { club, token } = await ben.api.clubWithInvite(`Queue ${uid}`);
  await api.joinClub(token);
  await grantSiteAdmin(signedIn.email);

  await fay.api.reportAvatar(ben.avatarId!, 'Looks like a stranger');
  await gus.api.reportAvatar(ben.avatarId!);
  await fay.api.reportAvatar(cleo.avatarId!, 'Not a pot');
  await fay.api.reportAvatar(dee.avatarId!, 'Shows my neighbour');
  await fay.api.reportAvatar(eve.avatarId!, 'Rude');
  // What the reported pictures look like as the API serves them now.
  const before = sha(await (await page.request.get(`/api/avatars/${dee.avatarId}`)).body());
  // Dee replaces hers (the report and the evidence stay), Eve deletes her account (her picture goes, the report is closed without its text).
  const replacement = await dee.api.uploadAvatar(seededPicture(`${uid}-Dee-new`));
  await eve.api.deleteAccount(PASSWORD);

  await shell.open('#/');
  await shell.footer.getByRole('link', { name: t('admin.title') }).click();
  await main(page)
    .getByRole('link', { name: t('avatars.reports.title') })
    .click();
  await expect(main(page).getByRole('heading', { level: 1, name: t('avatars.reports.title') })).toBeVisible();
  const entries = page.locator('.avatar-reports__entry').filter({ hasText: uid });
  await expect(entries).toHaveCount(3);
  // Newest report first: Dee, Cleo, Ben (Ben's two reports are one entry); Eve's is no longer open.
  await expect(entries.nth(2)).toContainText(t('avatars.reports.count', { count: 2 }));

  const benEntry = entry(page, ben.name);
  await expect(benEntry).toContainText('Looks like a stranger');
  await expect(benEntry).toContainText(t('avatars.reports.noReason'));
  await expect(benEntry).toContainText(fay.name);
  await expect(benEntry).toContainText(gus.name);
  await expect(benEntry).toContainText(t('avatars.reports.state.current'));
  await expect(benEntry).toContainText(ben.id);
  expect(await evidenceWidth(benEntry)).toBeGreaterThan(100);

  // The evidence of a replaced picture is the picture as it was reported, not the new one.
  const deeEntry = entry(page, dee.name);
  await expect(deeEntry).toContainText(t('avatars.reports.state.replaced'));
  expect(await evidenceWidth(deeEntry)).toBeGreaterThan(100);
  const queue = await api.avatarReports('OPEN');
  const deeReport = queue.entries.find((each) => each.avatarId === dee.avatarId)!;
  const evidence = await page.request.get(`/api/admin/avatar-reports/${deeReport.id}/picture`);
  expect(evidence.headers()['cache-control']).toContain('no-store');
  expect(sha(await evidence.body())).toBe(before);
  expect(sha(await (await page.request.get(`/api/avatars/${replacement}`)).body())).not.toBe(before);

  // An account that was deleted is "Deleted account": its picture went with it, so its report is closed, keeps no text and cannot be decided.
  await filterBy(page, 'avatars.reports.filter.closed');
  await expect(entries).toHaveCount(1);
  const eveEntry = entries.nth(0);
  await expect(eveEntry).toContainText(t('account.deleted'));
  await expect(eveEntry).toContainText(t('avatars.reports.state.accountDeleted'));
  await expect(eveEntry).toContainText(t('avatars.reports.status.closed'));
  await expect(eveEntry).toContainText(t('avatars.reports.deletedWithAccount'));
  await expect(eveEntry).toContainText(t('avatars.reports.noReason'));
  await expect(eveEntry).not.toContainText('Rude');
  await expect(eveEntry.getByRole('img')).toHaveCount(0);
  await expect(eveEntry.getByRole('button')).toHaveCount(0);
  const eveReport = (await api.avatarReports('CLOSED')).entries.find((each) => each.avatarId === eve.avatarId);
  expect(eveReport).toMatchObject({ status: 'CLOSED', picture: 'ACCOUNT_DELETED', ownerId: null, reason: null, hasPicture: false, closedBy: null });
  expect((await page.request.get(`/api/admin/avatar-reports/${eveReport!.id}/picture`)).status()).toBe(404);
  await filterBy(page, 'avatars.reports.filter.open');
  await expect(entries).toHaveCount(3);

  // The browser keeps no copy of any of it.
  expect(
    await page.evaluate(async () => {
      const found: string[] = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) found.push(new URL(request.url).pathname);
      return found.filter((path) => path.includes('/admin/'));
    }),
  ).toEqual([]);

  // Dismiss Cleo's: it leaves the open queue, her picture stays, and Dismissed lists it with who decided.
  await decide(entry(page, cleo.name), 'avatars.reports.dismiss').click();
  await expect(page.getByText(t('notices.avatarReportDismissed'))).toBeVisible();
  await expect(entries).toHaveCount(2);
  expect((await context.request.get(`/api/avatars/${cleo.avatarId}/small`)).status()).toBe(200);
  await filterBy(page, 'avatars.reports.filter.dismissed');
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText(t('avatars.reports.status.dismissed'));
  await expect(entries.first()).toContainText(signedIn.displayName);
  await expect(decide(entries.first(), 'avatars.reports.dismiss')).toHaveCount(0);

  // A dismissed picture that is still shown can be removed from here too.
  await decide(entries.first(), 'avatars.reports.remove').click();
  const dialog = page.getByRole('dialog', { name: t('avatars.reports.confirm.remove') });
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  expect((await context.request.get(`/api/avatars/${cleo.avatarId}/small`)).status()).toBe(200);
  await decide(entries.first(), 'avatars.reports.remove').click();
  await dialog.getByRole('button', { name: t('avatars.reports.remove') }).click();
  await expect(page.getByText(t('notices.avatarReportRemoved'))).toBeVisible();
  expect((await context.request.get(`/api/avatars/${cleo.avatarId}/small`)).status()).toBe(404);

  // Remove Ben's from the open queue: gone for everyone, blocked for every account, the entry stays under Removed with its picture.
  await filterBy(page, 'avatars.reports.filter.open');
  await expect(entries).toHaveCount(2);
  await decide(entry(page, ben.name), 'avatars.reports.remove').click();
  await dialog.getByRole('button', { name: t('avatars.reports.remove') }).click();
  await expect(page.getByText(t('notices.avatarReportRemoved'))).toBeVisible();
  await expect(entries).toHaveCount(1);
  expect((await context.request.get(`/api/avatars/${ben.avatarId}/small`)).status()).toBe(404);
  await expect(ben.api.uploadAvatar(ben.file!)).rejects.toThrow(/409/);
  await expect(cleo.api.uploadAvatar(ben.file!)).rejects.toThrow(/409/);
  await filterBy(page, 'avatars.reports.filter.actioned');
  const removedBen = entry(page, ben.name);
  await expect(removedBen).toContainText(t('avatars.reports.state.adminRemoved'));
  await expect(removedBen).toContainText(t('avatars.reports.status.actioned'));
  expect(await evidenceWidth(removedBen)).toBeGreaterThan(100);

  // A report of a picture that is gone (Dee replaced hers) is blocked rather than removed.
  await filterBy(page, 'avatars.reports.filter.open');
  await decide(entry(page, dee.name), 'avatars.reports.block').click();
  await page
    .getByRole('dialog', { name: t('avatars.reports.confirm.block') })
    .getByRole('button', { name: t('avatars.reports.block') })
    .click();
  await expect(entries).toHaveCount(0);
  await expect(dee.api.uploadAvatar(seededPicture(`${uid}-Dee`, 'Dee.png'))).rejects.toThrow(/409/);

  // Back in the club list, Ben shows the initial again.
  await shell.open(`#/clubs/${club.id}`);
  const row = main(page).getByRole('listitem').filter({ hasText: ben.name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('B');
  await expect(row.locator('img[src^="blob:"]')).toHaveCount(0);
  void gus;
});

test('the queue is for site admins only, and a plain member asks for nothing of it', async ({ page, shell, signedIn }) => {
  const asked: string[] = [];
  page.on('request', (request) => request.url().includes('/api/admin/') && asked.push(request.url()));
  await shell.open('#/admin/avatar-reports');
  await expect(main(page).getByText(t('avatars.reports.adminOnly'))).toBeVisible();
  await expect(shell.footer.getByRole('link', { name: t('admin.title') })).toHaveCount(0);
  expect(asked).toEqual([]);
});
