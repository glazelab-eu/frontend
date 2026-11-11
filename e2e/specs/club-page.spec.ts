import type { Locator, Page } from '@playwright/test';
import { t } from '../support/i18n';
import { readFile } from 'node:fs/promises';
import { decodePng } from '../support/qr-image';
import { BISQUE_STEP } from '../support/api';
import { expect, newAccount, test } from '../support/test';

/** The club page as the club's home: header, actions, invite panel, house rules, members and settings, for an admin and a plain member. */
const main = (page: Page) => page.getByRole('main');
const heading = (page: Page, name: string) => main(page).getByRole('heading', { level: 2, name, exact: true });

const RULES = Array.from({ length: 9 }, (_, index) => `Rule ${index + 1}: wipe the glaze off the foot.`).join('\n');

test('a plain member sees the club, the admins to ask for an invite link, folded rules and the member list with the marker @smoke', async ({
  page,
  shell,
  newApi,
  signedIn,
  uid,
}) => {
  const cleo = await newApi();
  await cleo.signUp(newAccount(uid, 'Cleo'));
  const name = `Kiln ${uid}`;
  const { club, token } = await cleo.clubWithInvite(name);
  await cleo.updateClub(club.id, { name, houseRules: RULES, invitesEnabled: true });
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await page.evaluate((link) => (location.hash = link), `#/invite/${token}`);
  await page.getByRole('button', { name: t('clubs.invite.join') }).click();
  await expect(page).toHaveURL(new RegExp(`#/clubs/${club.id}$`));

  await expect(main(page).getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(main(page).getByText(`${t('clubs.role.member')} · ${t('clubs.page.members', { count: 2 })}`)).toBeVisible();
  // A member sees the shelf link only, and is told whom to ask.
  await expect(main(page).getByRole('link', { name: t('clubs.page.shelfLink', { count: 0 }) })).toHaveAttribute('href', `#/stock?shelf=${club.id}`);
  await expect(main(page).getByRole('button', { name: t('clubs.page.invite') })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: t('clubs.settings.title') })).toHaveCount(0);
  await expect(main(page).getByText(t('clubs.page.inviteAsk', { admins: 'Cleo' }))).toBeVisible();

  // Rules: the start only, then everything.
  await expect(heading(page, t('clubs.houseRules'))).toBeVisible();
  await expect(main(page).getByText('Rule 9:')).toHaveCount(0);
  const showAll = main(page).getByRole('button', { name: t('clubs.page.rulesShowAll') });
  await expect(showAll).toHaveAttribute('aria-expanded', 'false');
  await showAll.click();
  await expect(main(page).getByText('Rule 9:', { exact: false })).toBeVisible();
  await expect(main(page).getByRole('button', { name: t('clubs.page.rulesShowLess') })).toHaveAttribute('aria-expanded', 'true');

  // Members: admins first, the account itself marked.
  await expect(heading(page, t('clubs.page.membersTitle', { count: 2 }))).toBeVisible();
  const members = main(page)
    .getByRole('listitem')
    .filter({ hasText: t('clubs.role.member') });
  await expect(members).toHaveCount(1);
  await expect(members).toContainText(`${signedIn.displayName} ${t('clubs.page.you')}`);
  const adminRow = main(page)
    .getByRole('listitem')
    .filter({ hasText: t('clubs.role.admin') });
  await expect(adminRow).toContainText('Cleo');
  // The marker belongs to the viewer's own row only.
  await expect(adminRow).not.toContainText(t('clubs.page.you'));
  await expect(main(page).getByText(t('clubs.page.you'), { exact: true })).toHaveCount(1);
  await expect(main(page).getByText(t('clubs.page.onlyYou'))).toHaveCount(0);
  // A plain member never holds the invite link: not in the page, not in the address.
  expect(await page.content()).not.toContain(token);
  expect(page.url()).not.toContain(token);
  await expect(main(page).getByRole('heading', { level: 2, name: t('clubs.page.combinations') })).toBeVisible();
  // Leaving stays on the Clubs list.
  await expect(main(page).getByRole('button', { name: t('clubs.leave.open') })).toHaveCount(0);
});

test('an only-member admin sees the invite panel, copies the link and reads the QR code', async ({ page, shell, api, signedIn, uid, context }) => {
  // Decoding the code with ZXing on the phone project takes about 25 s on a loaded host (qr-code.spec allows 60 s too).
  test.setTimeout(60_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { id } = await api.createClub(`Only me ${uid}`);
  await shell.open(`#/clubs/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(`${t('clubs.role.admin')} · ${t('clubs.page.members', { count: 1 })}`)).toBeVisible();
  await expect(main(page).getByText(t('clubs.page.onlyYou'))).toBeVisible();
  await expect(main(page).getByText(t('clubs.page.inviteAsk', { admins: signedIn.displayName }))).toHaveCount(0);

  const open = main(page).getByRole('button', { name: t('clubs.page.invite') });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  // The opened panel takes the focus at its heading.
  await expect(heading(page, t('clubs.page.invite'))).toBeFocused();
  await main(page)
    .getByRole('button', { name: t('clubs.settings.invites.generate') })
    .click();
  const link = main(page).getByRole('textbox', { name: t('clubs.settings.invites.link') });
  await expect(link).toHaveValue(/#\/invite\/[\w-]+$/);
  const url = await link.inputValue();

  await main(page)
    .getByRole('button', { name: t('clubs.settings.invites.copy') })
    .click();
  await expect(page.getByText(t('notices.linkCopied'))).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  // This desktop browser has no share sheet.
  await expect(main(page).getByRole('button', { name: t('clubs.settings.invites.share') })).toHaveCount(0);

  // The code is there without a click, and the text link stays beside it.
  const code = main(page).getByRole('img', { name: t('qr.label') });
  await expect(code).toBeVisible();
  await expect(link).toBeVisible();
  const png = await code.screenshot();
  expect(await decodePng(page, png), 'ZXing reads the code as the invite link').toEqual([url]);
  // Save downloads a PNG that decodes to the exact link; the name holds the club's slug, never the token.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    main(page)
      .getByRole('button', { name: t('qr.save') })
      .click(),
  ]);
  expect(download.suggestedFilename()).toBe(`glazelab-club-invite-only-me-${uid.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
  expect(download.suggestedFilename()).not.toContain(url.split('/').pop()!);
  expect(await decodePng(page, await readFile((await download.path())!)), 'ZXing reads the saved file as the invite link').toEqual([url]);

  // Closing returns focus to the button even where a click does not focus it (Safari): a scripted click focuses nothing.
  await heading(page, t('clubs.page.invite')).focus();
  await open.evaluate((button: HTMLButtonElement) => button.click());
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(open).toBeFocused();
});

test('Share link appears where the device can share, and shares the invite link with a title', async ({ page, shell, api, signedIn, uid }) => {
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: unknown) => {
        (window as unknown as { shared: unknown[] }).shared.push(data);
      },
    });
  });
  const name = `Shared ${uid}`;
  const { club } = await api.clubWithInvite(name);
  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('clubs.page.invite') })
    .click();
  // The link of an earlier session cannot be shown: replace it first.
  await main(page)
    .getByRole('button', { name: t('clubs.settings.invites.replace') })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('clubs.settings.invites.confirm') })
    .click();
  const url = await main(page)
    .getByRole('textbox', { name: t('clubs.settings.invites.link') })
    .inputValue();
  await main(page)
    .getByRole('button', { name: t('clubs.settings.invites.share') })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared))
    .toEqual([{ title: t('clubs.settings.invites.shareTitle', { club: name }), url }]);
});

test('settings sit on the club page: one member list at a time, role changes and removal with the focus rules @smoke', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const { club, token } = await api.clubWithInvite(`Settings ${uid}`);
  const bo = await newApi();
  await bo.signUp(newAccount(uid, 'Bo'));
  await bo.joinClub(token);
  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);

  const open = main(page).getByRole('button', { name: t('clubs.settings.title'), exact: true });
  await expect(heading(page, t('clubs.page.membersTitle', { count: 2 }))).toBeVisible();
  // Bo has joined: the admin is no longer the only member.
  await expect(main(page).getByText(t('clubs.page.onlyYou'))).toHaveCount(0);
  await open.click();
  // The read-only list gives way to the settings' own.
  await expect(heading(page, t('clubs.settings.title'))).toBeFocused();
  await expect(heading(page, t('clubs.page.membersTitle', { count: 2 }))).toHaveCount(0);
  await expect(main(page).getByRole('heading', { level: 3, name: t('clubs.settings.members'), exact: true })).toBeVisible();

  await main(page)
    .getByRole('button', { name: t('clubs.settings.makeAdmin') })
    .click();
  await expect(main(page).getByRole('button', { name: t('clubs.settings.makeMember') })).toHaveCount(2);

  // Removing asks first; Escape returns to the button, confirming moves focus to the list heading.
  const remove = main(page).getByRole('button', { name: t('clubs.settings.removeFor', { name: 'Bo' }) });
  await remove.click();
  await page.keyboard.press('Escape');
  await expect(remove).toBeFocused();
  await remove.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('clubs.settings.removeConfirm') })
    .click();
  await expect(main(page).getByRole('heading', { level: 3, name: t('clubs.settings.members'), exact: true })).toBeFocused();
  await expect(remove).toHaveCount(0);

  await open.click();
  await expect(open).toBeFocused();
  await expect(heading(page, t('clubs.page.membersTitle', { count: 1 }))).toBeVisible();
});

test('long lists and names: twelve members, then all; a club of long rules and names stays inside the page', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  test.setTimeout(120_000);
  const longName = `Extraordinarily-long-club-name-without-any-break-${uid}-${'x'.repeat(60)}`;
  const { club, token } = await api.clubWithInvite(longName);
  await api.updateClub(club.id, { name: longName, houseRules: `${'Long rule without a break '.repeat(380)}`, invitesEnabled: true });
  const joined = ['Longnamewithoutanyspaces'.repeat(2), ...Array.from({ length: 12 }, (_, index) => `Member${String(index).padStart(2, '0')}`)];
  for (const name of joined) {
    const other = await newApi();
    await other.signUp(newAccount(uid, name));
    await other.joinClub(token);
  }
  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const total = joined.length + 1;
  await expect(heading(page, t('clubs.page.membersTitle', { count: total }))).toBeVisible();
  const items = (): Locator => main(page).getByRole('listitem');
  await expect(items()).toHaveCount(12);
  await main(page)
    .getByRole('button', { name: t('clubs.page.membersShowAll', { count: total }) })
    .click();
  await expect(items()).toHaveCount(total);
  await main(page)
    .getByRole('button', { name: t('clubs.page.membersShowLess') })
    .click();
  await expect(items()).toHaveCount(12);

  // The 10,000-character rules are folded, and nothing makes the page scroll sideways.
  await expect(main(page).getByRole('button', { name: t('clubs.page.rulesShowAll') })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('without a loaded member list the page still renders, with the way to invite and the settings', async ({ page, shell, api, signedIn, uid }) => {
  const { id } = await api.createClub(`Unavailable ${uid}`);
  await page.route(`**/api/clubs/${id}/members`, (route) =>
    route.fulfill({ status: 403, json: { error: 'Club membership required', code: 'CLUB_MEMBERSHIP_REQUIRED' } }),
  );
  await shell.open(`#/clubs/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('heading', { level: 1, name: `Unavailable ${uid}` })).toBeVisible();
  await expect(main(page).getByText(t('clubs.page.membersUnavailable'))).toBeVisible();
  await expect(main(page).getByText(t('clubs.role.admin'), { exact: true })).toBeVisible();
  await main(page)
    .getByRole('button', { name: t('clubs.settings.title') })
    .click();
  await expect(main(page).getByText(t('clubs.page.membersUnavailable'))).toBeVisible();
  await main(page)
    .getByRole('button', { name: t('clubs.page.invite') })
    .click();
  await expect(main(page).getByRole('button', { name: t('clubs.settings.invites.generate') })).toBeVisible();
});

test('offline the page reads from the saved data and its write buttons are disabled', async ({ page, shell, api, signedIn, uid, context }) => {
  const { club } = await api.clubWithInvite(`Offline ${uid}`);
  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('clubs.page.invite') })
    .click();
  await context.setOffline(true);
  await expect(main(page).getByRole('button', { name: t('clubs.settings.invites.replace') })).toBeDisabled();
  await main(page)
    .getByRole('button', { name: t('clubs.settings.title') })
    .click();
  await expect(main(page).getByRole('button', { name: t('clubs.settings.save') })).toBeDisabled();
  await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
});

test('a club the account is not a member of is not found and shows nothing of it', async ({ page, shell, newApi, signedIn, uid }) => {
  const cleo = await newApi();
  await cleo.signUp(newAccount(uid, 'Cleo'));
  const name = `Private kiln ${uid}`;
  const { club } = await cleo.clubWithInvite(name);
  await cleo.updateClub(club.id, { name, houseRules: `Secret rule ${uid}`, invitesEnabled: true });
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(club.id)) asked.push(request.url());
  });
  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('heading', { level: 1, name: t('route.notFound.title') })).toBeVisible();
  const text = await main(page).innerText();
  for (const leak of [name, `Secret rule ${uid}`, 'Cleo']) expect(text).not.toContain(leak);
  // The page never asks the API about a club outside the account's list.
  expect(asked).toEqual([]);
});

test('Back from a member combination returns to it after the rules were opened; the shelf link counts only glazes in stock', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  test.setTimeout(60_000);
  const name = `Restore ${uid}`;
  const { id } = await api.createClub(name);
  await api.updateClub(id, { name, houseRules: RULES, invitesEnabled: false });
  for (let index = 1; index <= 13; index++) await api.addCombination({ title: `Tile ${String(index).padStart(2, '0')} ${uid}`, steps: [BISQUE_STEP] });
  const ash = await api.addGlaze({ newManufacturer: { name: `Club shelf ${uid}`, shortId: uid.toUpperCase() }, code: 'A-1', name: 'Ash' });
  const birch = await api.addGlaze({ manufacturerId: ash.glaze.manufacturer.id, code: 'B-1', name: 'Birch' });
  await api.addStock({ glazeId: ash.id, ownerType: 'club', clubId: id, quantityG: 300 });
  await api.addStock({ glazeId: birch.id, ownerType: 'club', clubId: id, quantityG: 0 });
  await shell.open(`#/clubs/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('link', { name: t('clubs.page.shelfLink', { count: 1 }) })).toBeVisible();

  await main(page)
    .getByRole('button', { name: t('clubs.page.rulesShowAll') })
    .click();
  const cards = main(page).getByRole('link', { name: new RegExp(`^Tile \\d\\d ${uid}$`) });
  await cards.nth(11).scrollIntoViewIfNeeded();
  const oldest = main(page).getByRole('link', { name: `Tile 01 ${uid}`, exact: true });
  await oldest.scrollIntoViewIfNeeded();
  await oldest.click();
  await expect(page.getByRole('heading', { level: 1, name: `Tile 01 ${uid}` })).toBeVisible();
  await page.goBack();
  await expect(main(page).getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(oldest).toBeInViewport();
});

test('Share link: a closed share sheet does nothing, a failing one copies the link instead', async ({ page, shell, api, signedIn, uid, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    const failures = ['AbortError', 'NotAllowedError'];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('share failed', failures.shift() ?? 'AbortError');
      },
    });
  });
  const { id } = await api.createClub(`Share fails ${uid}`);
  await shell.open(`#/clubs/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('clubs.page.invite') })
    .click();
  await main(page)
    .getByRole('button', { name: t('clubs.settings.invites.generate') })
    .click();
  const url = await main(page)
    .getByRole('textbox', { name: t('clubs.settings.invites.link') })
    .inputValue();
  await page.evaluate(() => navigator.clipboard.writeText('before'));
  const share = main(page).getByRole('button', { name: t('clubs.settings.invites.share') });
  await share.click();
  // Closed by the user: silent, nothing copied.
  await page.waitForTimeout(300);
  await expect(page.getByText(t('notices.linkCopied'))).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('before');
  await share.click();
  await expect(page.getByText(t('notices.linkCopied'))).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});

test('an admin who demotes themselves loses the panels and lands on the member list', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { club, token } = await api.clubWithInvite(`Demote ${uid}`);
  const bo = await newApi();
  await bo.signUp(newAccount(uid, 'Bo'));
  await bo.joinClub(token);
  const boId = (await bo.me()).id;
  await api.setClubRole(club.id, boId, 'ADMIN');
  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('clubs.page.invite') })
    .click();
  await main(page)
    .getByRole('button', { name: t('clubs.settings.title'), exact: true })
    .click();
  const own = main(page).locator('.club-settings__member').filter({ hasText: signedIn.displayName });
  await own.getByRole('button', { name: t('clubs.settings.makeMember') }).click();
  await expect(heading(page, t('clubs.page.membersTitle', { count: 2 }))).toBeFocused();
  for (const name of [t('clubs.page.invite'), t('clubs.settings.title')]) await expect(main(page).getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(main(page).getByText(`${t('clubs.role.member')} · ${t('clubs.page.members', { count: 2 })}`)).toBeVisible();
  await expect(main(page).getByText(t('clubs.page.inviteAsk', { admins: 'Bo' }))).toBeVisible();
});
