import type { Locator, Page } from '@playwright/test';
import type { Api } from '../support/api';
import { BISQUE_STEP } from '../support/api';
import { eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';
import { locales } from '../support/locales';

/** The Clubs list (`#/clubs`): compact cards that open the club page, with the way to start a club. */
const main = (page: Page) => page.getByRole('main');
const cards = (page: Page) => main(page).getByRole('article');
const card = (page: Page, name: string) => cards(page).filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) });

test('without a club the page says how to join first and has the start form open @smoke', async ({ page, shell, signedIn }) => {
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('heading', { level: 1, name: t('clubs.title') })).toBeVisible();
  await expect(main(page).getByText(t('clubs.intro'))).toBeVisible();
  // Joining comes first and is explained; the form below it is not folded away.
  const join = main(page).getByText(t('clubs.joinHint'));
  const heading = main(page).getByRole('heading', { level: 2, name: t('clubs.create.title') });
  await expect(join).toBeVisible();
  await expect(heading).toBeVisible();
  expect((await join.boundingBox())!.y).toBeLessThan((await heading.boundingBox())!.y);
  await expect(main(page).getByRole('textbox', { name: t('clubs.name') })).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(main(page).locator('details')).toHaveCount(0);
});

test('creating a club opens its page, and Back returns to the list with its card @smoke', async ({ page, shell, signedIn, uid }) => {
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  const name = `Sunday Clay ${uid}`;
  await main(page)
    .getByRole('textbox', { name: t('clubs.name') })
    .fill(name);
  await main(page)
    .getByRole('button', { name: t('clubs.create.submit') })
    .click();
  await expect(main(page).getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/clubs\/[0-9a-f-]{36}$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/clubs$/);
  // With a club the start form is folded into a disclosure of its own.
  await expect(card(page, name)).toBeVisible();
  const disclosure = main(page).locator('details');
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).not.toHaveJSProperty('open', true);
  await expect(main(page).getByRole('textbox', { name: t('clubs.name') })).toBeHidden();
  await disclosure.getByText(t('clubs.create.title'), { exact: true }).click();
  await expect(main(page).getByRole('textbox', { name: t('clubs.name') })).toBeFocused();
  const second = `Second ${uid}`;
  await main(page)
    .getByRole('textbox', { name: t('clubs.name') })
    .fill(second);
  await main(page)
    .getByRole('button', { name: t('clubs.create.submit') })
    .click();
  await expect(main(page).getByRole('heading', { level: 1, name: second, exact: true })).toBeVisible();
});

/** Ana plus a second account in three clubs: Ana is admin of two (one with a shelf and combinations) and a plain member of the third. */
async function seed(api: Api, newApi: () => Promise<Api>, uid: string) {
  const cleo = await newApi();
  await cleo.signUp(newAccount(uid, 'Cleo'));
  const fern = await api.addGlaze({ newManufacturer: { name: `List ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Fern', barcode: eanFor(uid) });
  const manufacturerId = fern.glaze.manufacturer.id;
  const glaze = async (code: string) => (await api.addGlaze({ manufacturerId, code, name: code })).id;
  const names = { zeta: `Zeta ${uid}`, alpha: `alpha ${uid}`, mid: `Mid ${uid}` };
  const zeta = await api.clubWithInvite(names.zeta);
  const alpha = await api.clubWithInvite(names.alpha);
  const mid = await cleo.clubWithInvite(names.mid);
  await api.joinClub(mid.token);
  await cleo.joinClub(zeta.token);
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: zeta.club.id, quantityG: 300 });
  await api.addStock({ glazeId: await glaze('B-1'), ownerType: 'club', clubId: zeta.club.id, quantityG: 200 });
  await api.addStock({ glazeId: await glaze('C-1'), ownerType: 'club', clubId: zeta.club.id, quantityG: 0 });
  await api.addCombination({ title: `Mine ${uid}`, steps: [BISQUE_STEP] });
  await cleo.addCombination({ title: `Cleo's ${uid}`, steps: [BISQUE_STEP] });
  return { names, zeta: zeta.club.id, alpha: alpha.club.id, mid: mid.club.id };
}

test('cards are sorted by name in the app language, count what the page holds and mark admins only', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const seeded = await seed(api, newApi, uid);
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  const headings = main(page).getByRole('heading', { level: 2 });
  // The API sorts "Zeta, Mid, alpha" by code point; people expect "alpha, Mid, Zeta".
  await expect(headings).toHaveText([seeded.names.alpha, seeded.names.mid, seeded.names.zeta]);
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(1);

  // Two members, two glazes in stock (the used up one does not count), and the combinations of both members.
  await expect(card(page, seeded.names.zeta)).toContainText(
    `${t('clubs.page.members', { count: 2 })} · ${t('clubs.card.glazes', { count: 2 })} · ${t('clubs.card.combinations', { count: 2 })}`,
  );
  await expect(card(page, seeded.names.alpha)).toContainText(
    `${t('clubs.page.members', { count: 1 })} · ${t('clubs.card.glazes', { count: 0 })} · ${t('clubs.card.combinations', { count: 1 })}`,
  );
  // Ana is a plain member of "Mid", whose admin is Cleo.
  await expect(card(page, seeded.names.mid)).toContainText(t('clubs.page.members', { count: 2 }));
  const badge = (name: string) => card(page, name).getByText(t('clubs.role.admin'), { exact: true });
  await expect(badge(seeded.names.zeta)).toBeVisible();
  await expect(badge(seeded.names.alpha)).toBeVisible();
  await expect(badge(seeded.names.mid)).toHaveCount(0);

  // No "Club combinations" button any more: the name is the one link to the page.
  await expect(main(page).getByRole('link', { name: 'Club combinations' })).toHaveCount(0);
  await expect(card(page, seeded.names.zeta).getByRole('link')).toHaveCount(1);
  await expect(card(page, seeded.names.zeta).getByRole('link', { name: seeded.names.zeta, exact: true })).toHaveAttribute('href', `#/clubs/${seeded.zeta}`);
  // No suffix, shared glaze list or settings on the card.
  await expect(main(page).getByText(t('clubs.houseRules'), { exact: true })).toHaveCount(0);
  await expect(main(page).locator('details summary', { hasText: t('clubs.create.title') })).toHaveCount(1);
  await expect(main(page).locator('details')).toHaveCount(1);
});

test('a press anywhere on a card opens the club page, but "Leave club" does not', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const seeded = await seed(api, newApi, uid);
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  const target = card(page, seeded.names.mid);
  // The empty right-hand part of the card, below the title row: the link is stretched over the card.
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await expect(page).toHaveURL(new RegExp(`#/clubs/${seeded.mid}$`));
  await page.goBack();
  await card(page, seeded.names.mid)
    .getByRole('button', { name: t('clubs.leave.open') })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/#\/clubs$/);
  await page.keyboard.press('Escape');
  await expect(card(page, seeded.names.mid).getByRole('button', { name: t('clubs.leave.open') })).toBeFocused();
});

test('keyboard users tab to the name and then to "Leave club" of each card', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
  test.skip(isMobile, 'a keyboard walk is a desktop check');
  const seeded = await seed(api, newApi, uid);
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  const link = card(page, seeded.names.alpha).getByRole('link');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Tab');
  // alpha: Ana is its only member and admin: Leave is offered but refuses and says why.
  const leave = card(page, seeded.names.alpha).getByRole('button', { name: t('clubs.leave.open') });
  await expect(leave).toBeFocused();
  await expect(leave).toHaveAttribute('aria-disabled', 'true');
  await expect(leave).toHaveAccessibleDescription(t('clubs.leave.onlyMember'));
  await expect(card(page, seeded.names.alpha).getByText(t('clubs.leave.onlyMember'))).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(card(page, seeded.names.mid).getByRole('link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/clubs/${seeded.mid}$`));
});

test('the only admin is told why they cannot leave; a plain member leaves and focus lands on the list', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const seeded = await seed(api, newApi, uid);
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  // Zeta: Ana is admin and Cleo a plain member.
  const zeta = card(page, seeded.names.zeta);
  await expect(zeta.getByText(t('clubs.leave.lastAdmin'))).toBeVisible();
  await expect(zeta.getByRole('button', { name: t('clubs.leave.open') })).toHaveAccessibleDescription(t('clubs.leave.lastAdmin'));
  // The reason is one short line, not a paragraph: the card stays compact.
  expect((await zeta.getByText(t('clubs.leave.lastAdmin')).boundingBox())!.height).toBeLessThan(60);
  // Mid: a plain member may leave.
  const mid = card(page, seeded.names.mid);
  await expect(mid.getByText(t('clubs.leave.lastAdmin'))).toHaveCount(0);
  await mid.getByRole('button', { name: t('clubs.leave.open') }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('clubs.leave.confirm') })
    .click();
  await expect(cards(page)).toHaveCount(2);
  await expect(main(page).getByRole('list', { name: t('clubs.title') })).toBeFocused();
});

test('leaving the last club shows the start panel and focuses its heading', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const cleo = await newApi();
  await cleo.signUp(newAccount(uid, 'Cleo'));
  const name = `Only ${uid}`;
  await api.joinClub((await cleo.clubWithInvite(name)).token);
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await card(page, name)
    .getByRole('button', { name: t('clubs.leave.open') })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('clubs.leave.confirm') })
    .click();
  await expect(cards(page)).toHaveCount(0);
  await expect(main(page).getByText(t('clubs.joinHint'))).toBeVisible();
  await expect(main(page).getByRole('heading', { level: 2, name: t('clubs.create.title') })).toBeFocused();
});

test('every card is at least one touch target tall and nothing makes the page scroll sideways', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
  isMobile,
}) => {
  const seeded = await seed(api, newApi, uid);
  await api.updateClub(seeded.zeta, { name: seeded.names.zeta, houseRules: 'x'.repeat(10_000), invitesEnabled: true });
  await api.clubWithInvite(`A very long club name that wraps on a phone ${'Thursday '.repeat(4)}${uid}`);
  // One word of 100 characters (German compounds) must break inside the card too.
  await api.clubWithInvite(`${'Glasurwerkstatt'.repeat(7)}${uid}`.slice(0, 100));
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(cards(page)).toHaveCount(5);
  expect(
    await cards(page).evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth).length),
    'no card content overflows its card',
  ).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const small = async (locator: Locator) =>
    (await locator.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))).filter((height) => height < 44);
  if (isMobile) {
    expect(await small(cards(page))).toEqual([]);
    expect(await small(main(page).getByRole('button'))).toEqual([]);
    // The cards stack in one column on a phone.
    const lefts = await cards(page).evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
  }
  // Rules are not on the card (they live on the club page).
  await expect(main(page).getByText('xxxxxxxxxx')).toHaveCount(0);
});

for (const locale of locales) {
  test(`at 390 px the count items stay whole and the Admin badge fits its card (${locale})`, async ({ page, api, newApi, signedIn, uid }) => {
    await page.addInitScript((value) => localStorage.setItem('glazelab:locale', value), locale);
    await page.setViewportSize({ width: 390, height: 800 });
    await seed(api, newApi, uid);
    // The shell helpers look for English texts: wait for the cards instead.
    await page.goto('/#/clubs');
    await expect(cards(page)).toHaveCount(3);
    const measured = await cards(page).evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const items = [...node.querySelectorAll('.club-card__count')].map((item) => item.getClientRects().length);
        const badge = node.querySelector('.club-card__badge');
        const badgeBox = badge?.getBoundingClientRect();
        const lineHeight = badge ? parseFloat(getComputedStyle(badge).lineHeight) || 0 : 0;
        return {
          items,
          badgeInside: badgeBox ? badgeBox.left >= box.left && badgeBox.right <= box.right : true,
          badgeOneLine: badgeBox && lineHeight ? badgeBox.height < lineHeight * 1.9 : true,
        };
      }),
    );
    for (const card of measured) {
      expect(card.items.length).toBeGreaterThanOrEqual(2);
      // A nowrap item is one line box; an item broken across lines would have several.
      expect(card.items.every((rects) => rects === 1)).toBe(true);
      expect(card.badgeInside).toBe(true);
      expect(card.badgeOneLine).toBe(true);
    }
    if (process.env.GL_SHOTS) await page.screenshot({ path: `${process.env.GL_SHOTS}/clubs-390-${locale}.png`, fullPage: true });
    if (process.env.GL_SHOTS) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `${process.env.GL_SHOTS}/clubs-1280-${locale}.png`, fullPage: true });
    }
  });
}
