import type { Page } from '@playwright/test';
import { Api } from '../support/api';
import { t } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';

/** The club wishlist on the club page: members add catalogue glazes and items with a link; the adder or an admin marks or removes them. */
const main = (page: Page) => page.getByRole('main');
const wishlist = (page: Page) => main(page).locator('#club-wishlist');
const entry = (page: Page, text: string) => wishlist(page).getByRole('listitem').filter({ hasText: text });

test('members share a club wishlist of glazes and items, the admin marks one acquired and the adder removes theirs @smoke', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
  browser,
  baseURL,
}) => {
  const cleo = newAccount(uid, 'Cleo');
  const cleoApi = await newApi();
  await cleoApi.signUp(cleo);
  const { club, token } = await cleoApi.clubWithInvite(`Wish kiln ${uid}`);
  await api.joinClub(token);
  const glaze = await cleoApi.addGlaze({ newManufacturer: { name: `Wish ${uid}`, shortId: uid.toUpperCase() }, code: 'WL-1', name: 'Celadon' });
  const glazeTitle = `Wish ${uid} WL-1 Celadon`;
  await cleoApi.addWishlistEntry(club.id, { type: 'ITEM', name: `Banding wheel ${uid}`, link: 'https://tools.example.test/wheel' });

  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('heading', { level: 2, name: t('clubs.wishlist.title') })).toBeVisible();
  await expect(wishlist(page).getByText(t('clubs.wishlist.count', { count: 1, max: 100 }))).toBeVisible();
  // Another member's entry: shown with its adder, without the buttons only its adder and the admins have.
  const wheel = entry(page, `Banding wheel ${uid}`);
  await expect(wheel).toContainText('Added by Cleo');
  await expect(wheel.getByRole('button')).toHaveCount(0);

  // A glaze, picked by its code.
  await wishlist(page)
    .getByRole('button', { name: t('clubs.wishlist.addGlaze') })
    .click();
  const glazeDialog = page.getByRole('dialog', { name: t('clubs.wishlist.glazeTitle') });
  await glazeDialog.getByRole('combobox', { name: t('clubs.wishlist.glaze') }).fill('WL-1');
  // Other tests' glazes share the code: the option is this test's manufacturer's.
  await page.getByRole('option', { name: new RegExp(uid) }).click();
  await glazeDialog.getByRole('textbox', { name: t('clubs.wishlist.note') }).fill('For the beginners');
  await glazeDialog.getByRole('button', { name: t('clubs.wishlist.submit') }).click();
  await expect(glazeDialog).toHaveCount(0);
  await expect(page.getByText(t('notices.wishlistAdded'))).toBeVisible();
  const celadon = entry(page, glazeTitle);
  await expect(celadon.getByRole('link', { name: glazeTitle })).toHaveAttribute('href', `#/glazes/${glaze.id}`);
  await expect(celadon).toContainText('For the beginners');

  // An item: an unsafe link is refused at the form with the plain message, and nothing is sent.
  await wishlist(page)
    .getByRole('button', { name: t('clubs.wishlist.addItem') })
    .click();
  const itemDialog = page.getByRole('dialog', { name: t('clubs.wishlist.itemTitle') });
  await itemDialog.getByRole('textbox', { name: t('clubs.wishlist.itemName') }).fill(`Kiln shelf ${uid}`);
  const link = itemDialog.getByRole('textbox', { name: t('clubs.wishlist.link') });
  await link.fill('javascript:alert(1)');
  await itemDialog.getByRole('button', { name: t('clubs.wishlist.submit') }).click();
  await expect(itemDialog.getByText(t('errors.wishlistLinkInvalid'))).toBeVisible();
  await expect(link).toHaveAttribute('aria-invalid', 'true');
  await expect(link).toBeFocused();
  await link.fill('https://shop.example.test/kiln/shelf-40?size=40#specs');
  await itemDialog.getByRole('button', { name: t('clubs.wishlist.submit') }).click();
  await expect(itemDialog).toHaveCount(0);
  const shelf = entry(page, `Kiln shelf ${uid}`);
  const outbound = shelf.getByRole('link', { name: `shop.example.test ${t('clubs.wishlist.newTab')}` });
  await expect(outbound).toHaveAttribute('href', 'https://shop.example.test/kiln/shelf-40?size=40#specs');
  await expect(outbound).toHaveAttribute('target', '_blank');
  await expect(outbound).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(wishlist(page).getByText(t('clubs.wishlist.count', { count: 3, max: 100 }))).toBeVisible();

  // The admin, on a device of their own, sees both and marks the glaze acquired.
  const other = await browser.newContext({ baseURL });
  try {
    await new Api(other.request).signIn(cleo);
    const cleoPage = await other.newPage();
    await cleoPage.goto(`/#/clubs/${club.id}`);
    const cleoCeladon = entry(cleoPage, glazeTitle);
    await expect(cleoCeladon).toContainText(`Added by ${signedIn.displayName}`);
    await expect(entry(cleoPage, `Kiln shelf ${uid}`)).toBeVisible();
    await cleoCeladon.getByRole('button', { name: t('clubs.wishlist.markAcquiredFor', { name: glazeTitle }) }).click();
    await expect(cleoCeladon.getByText(/^Acquired on /)).toBeVisible();
    await expect(cleoCeladon.getByRole('button', { name: t('clubs.wishlist.markWantedFor', { name: glazeTitle }) })).toBeFocused();
  } finally {
    await other.close();
  }

  // Back on the member's page: the acquired glaze comes last; the member removes their own item after the question.
  await page.goto('about:blank');
  await shell.open(`#/clubs/${club.id}`);
  await expect(wishlist(page).getByText(t('clubs.wishlist.count', { count: 2, max: 100 }))).toBeVisible();
  await expect(wishlist(page).getByRole('listitem').last()).toContainText(glazeTitle);
  await entry(page, `Kiln shelf ${uid}`)
    .getByRole('button', { name: t('clubs.wishlist.removeFor', { name: `Kiln shelf ${uid}` }) })
    .click();
  const question = page.getByRole('dialog', { name: t('clubs.wishlist.removeTitle', { name: `Kiln shelf ${uid}` }) });
  await question.getByRole('button', { name: t('clubs.wishlist.removeConfirm') }).click();
  await expect(page.getByText(t('notices.wishlistRemoved'))).toBeVisible();
  await expect(entry(page, `Kiln shelf ${uid}`)).toHaveCount(0);
  await expect(main(page).getByRole('heading', { level: 2, name: t('clubs.wishlist.title') })).toBeFocused();

  // Someone outside the club gets the member list's answer.
  const outsider = await newApi();
  await outsider.signUp(newAccount(uid, 'Otto'));
  expect(await outsider.status(`/api/clubs/${club.id}/wishlist`)).toBe(403);
});

test('a wishlist dialog with typed input asks before the page is left, and the empty wishlist says what it is for', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const { id } = await api.createClub(`Empty wish ${uid}`);
  await shell.open(`#/clubs/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(wishlist(page).getByText(t('clubs.wishlist.empty'))).toBeVisible();
  await wishlist(page)
    .getByRole('button', { name: t('clubs.wishlist.addItem') })
    .click();
  const dialog = page.getByRole('dialog', { name: t('clubs.wishlist.itemTitle') });
  await expect(dialog.getByRole('textbox', { name: t('clubs.wishlist.itemName') })).toBeFocused();
  await dialog.getByRole('textbox', { name: t('clubs.wishlist.itemName') }).fill('Sponges');
  await page.evaluate(() => (location.hash = '#/clubs'));
  await expect(page.getByRole('dialog', { name: t('drafts.discardWishlist') })).toBeVisible();
});
