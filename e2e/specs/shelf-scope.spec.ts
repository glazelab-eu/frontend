import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { startsWith, t } from '../support/i18n';
import { ExplorePage } from '../support/pages/explore';
import { DIALOG, expectAccessible } from '../support/axe';
import { expect, newAccount, test } from '../support/test';

const main = (page: Page) => page.getByRole('main');
const clubsBox = (page: Page) => main(page).getByRole('checkbox', { name: startsWith(t('discover.shelf.clubs.include')) });
const buddiesBox = (page: Page) => main(page).getByRole('checkbox', { name: startsWith(t('discover.buddies.include')) });

async function glazes(api: Api, uid: string, names: string[]) {
  const first = await api.addGlaze({ newManufacturer: { name: `Mk ${uid}`, shortId: uid.toUpperCase() }, code: 'G-0', name: `${names[0]} ${uid}` });
  const manufacturerId = first.glaze.manufacturer.id;
  const ids = [first.id];
  for (const [index, name] of names.slice(1).entries()) ids.push((await api.addGlaze({ manufacturerId, code: `G-${index + 1}`, name: `${name} ${uid}` })).id);
  return { ids, name: (index: number) => `${names[index]} ${uid}` };
}
const shown = async (explore: ExplorePage, ...names: string[]) => {
  await expect(explore.cards).toHaveCount(names.length);
  for (const name of names) await expect(explore.cards.getByRole('link', { name, exact: true })).toBeVisible();
};

test('personal shelf counts stay stable while club availability survives links, Back and reload', async ({ page, shell, api, signedIn, uid }, testInfo) => {
  const g = await glazes(api, uid, ['Personal', 'Club', 'Spent', 'Unowned']);
  const club = await api.createClub(`Club ${uid}`);
  await api.addStock({ glazeId: g.ids[0], ownerType: 'personal', quantityG: 300 });
  await api.addStock({ glazeId: g.ids[1], ownerType: 'club', clubId: club.id, quantityG: 200 });
  await api.addStock({ glazeId: g.ids[2], ownerType: 'personal', quantityG: 0 });
  await api.addCombination({ title: `Pair ${uid}`, steps: [g.ids[0], g.ids[1]].map((glazeId) => ({ type: 'GLAZE' as const, glazeId, coats: 2 })) });
  const explore = new ExplorePage(page);
  await shell.open(`#/?q=${uid}&quick=shelf`);
  await shell.expectSignedIn(signedIn.displayName);
  await shown(explore, g.name(0));
  await expect(clubsBox(page)).toHaveCount(0);
  await expect(explore.shelfChoice('discover.shelfStock.used')).toHaveText(/\b1$/);
  await explore.chip('discover.quick.available').click();
  await expect(clubsBox(page)).not.toBeChecked();
  await clubsBox(page).check();
  await expect(page).toHaveURL(/quick=available&clubs=1/);
  await shown(explore, g.name(0), g.name(1));
  await expect(explore.chip('discover.quick.shelf')).toHaveText(/\b1$/);
  await expect(main(page).getByText(new RegExp(`Shelves counted:.*Club ${uid}`))).toBeVisible();
  await page.reload();
  await expect(clubsBox(page)).toBeChecked();
  await clubsBox(page).uncheck();
  await shown(explore, g.name(0));
  await page.goBack();
  await expect(clubsBox(page)).toBeChecked();
  await shown(explore, g.name(0), g.name(1));
  await explore.chip('discover.quick.canMake').click();
  await expect(page).toHaveURL(/quick=canMake&clubs=1/);
  await expect(main(page).getByRole('heading', { name: `Pair ${uid}`, exact: true })).toBeVisible();
  await expect(clubsBox(page)).toBeChecked();
  await explore.chip('discover.quick.shelf').click();
  await shown(explore, g.name(0));
  await expect(clubsBox(page)).toHaveCount(0);
  await explore.shelfChoice('discover.shelfStock.used').click();
  await shown(explore, g.name(2));
  await expect(explore.shelfChoice('discover.shelfStock.all')).toHaveText(/\b2$/);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('personal-used-up.png'), fullPage: true });
  // An explicit source override wins over memory, and leaving availability never broadens the personal shelf.
  await shell.open(`#/?q=${uid}&quick=available&clubs=0`);
  await expect(clubsBox(page)).not.toBeChecked();
  await shown(explore, g.name(0));
  await shell.open(`#/?q=${uid}&quick=available`);
  await expect(clubsBox(page)).not.toBeChecked();
  await shown(explore, g.name(0));
});

test('an empty personal shelf links to separate club availability', async ({ page, shell, api, signedIn, uid }) => {
  const g = await glazes(api, uid, ['Club']);
  const club = await api.createClub(`Club ${uid}`);
  await api.addStock({ glazeId: g.ids[0], ownerType: 'club', clubId: club.id, quantityG: 100 });
  const explore = new ExplorePage(page);
  await shell.open(`#/?type=glazes&q=${uid}&quick=shelf&clubs=1`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('discover.shelf.personalEmpty'), { exact: true })).toBeVisible();
  await expect(explore.chip('discover.quick.shelf')).toHaveText(/\b0$/);
  await expect(clubsBox(page)).toHaveCount(0);
  await expect(explore.cards).toHaveCount(0);
  await main(page)
    .getByRole('link', { name: t('discover.quick.available'), exact: true })
    .click();
  await clubsBox(page).check();
  await shown(explore, g.name(0));
  await expect(explore.chip('discover.quick.shelf')).toHaveText(/\b0$/);
});

test('buddy access is separate from personal Used up, with privacy and pending requests respected', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const g = await glazes(api, uid, ['Mine', 'Spent', 'Ada has', 'Secret', 'Pending']);
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
  const pat = await newApi();
  await pat.signUp({ ...newAccount(uid, 'Pat'), displayName: 'Pat' });
  await api.requestBuddyByLink(await ada.replaceBuddyLink());
  await ada.acceptBuddy((await api.me()).id);
  await api.requestBuddyByLink(await pat.replaceBuddyLink());
  await api.addStock({ glazeId: g.ids[0], ownerType: 'personal', quantityG: 100 });
  await api.addStock({ glazeId: g.ids[1], ownerType: 'personal', quantityG: 0 });
  for (const glazeId of [g.ids[1], g.ids[2], g.ids[3]]) await ada.addStock({ glazeId, ownerType: 'personal', quantityG: 100 });
  await ada.setKeepPrivate((await ada.stock()).find((entry) => entry.glazeId === g.ids[3])!.id, true);
  await pat.addStock({ glazeId: g.ids[4], ownerType: 'personal', quantityG: 100 });
  const explore = new ExplorePage(page);
  await shell.open(`#/?q=${uid}&quick=available`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(buddiesBox(page)).not.toBeChecked();
  await buddiesBox(page).check();
  await expect(page).toHaveURL(/quick=available.*buddies=1/);
  await shown(explore, g.name(0), g.name(1), g.name(2));
  await expect(main(page).getByText(g.name(3))).toHaveCount(0);
  await expect(main(page).getByText(g.name(4))).toHaveCount(0);
  await expect(main(page).getByText('Pat', { exact: true })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: startsWith(t('buddies.shelf.askFor', { name: 'Ada', glaze: '' })) })).toHaveCount(2);
  await explore.chip('discover.quick.shelf').click();
  await shown(explore, g.name(0));
  await explore.shelfChoice('discover.shelfStock.used').click();
  await shown(explore, g.name(1));
  await expect(explore.shelfChoice('discover.shelfStock.used')).toHaveText(/\b1$/);
  await expect(explore.shelfChoice('discover.shelfStock.stock')).toHaveText(/\b1$/);
  await expect(main(page).getByText(t('buddies.shelf.atNames', { names: t('buddies.shelf.atName', { name: 'Ada' }) }), { exact: true })).toBeVisible();
  await page.reload();
  await shown(explore, g.name(1));
  await explore.chip('discover.quick.available').click();
  await expect(buddiesBox(page)).toBeChecked();
  await shown(explore, g.name(0), g.name(1), g.name(2));
  await ada.removeBuddy((await api.me()).id);
  await page.reload();
  await shown(explore, g.name(0));
  await expect(buddiesBox(page)).toHaveCount(0);
});

test('buddy-only access enables I can make now and keeps scope and offline dates visible', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
  context,
  isMobile,
}, testInfo) => {
  const g = await glazes(api, uid, ['Borrow']);
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
  await api.requestBuddyByLink(await ada.replaceBuddyLink());
  await ada.acceptBuddy((await api.me()).id);
  await ada.addStock({ glazeId: g.ids[0], ownerType: 'personal', quantityG: 100 });
  await api.addCombination({ title: `Borrowed ${uid}`, steps: [{ type: 'GLAZE', glazeId: g.ids[0], coats: 2 }] });
  const explore = new ExplorePage(page);
  await shell.open(`#/?q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  await explore.chip('discover.quick.canMake').click();
  await expect(main(page).getByText(t('discover.available.empty'), { exact: true })).toBeVisible();
  await buddiesBox(page).check();
  await expect(main(page).getByRole('heading', { name: `Borrowed ${uid}`, exact: true })).toBeVisible();
  await expect(main(page).getByText(t('discover.buddies.counted', { names: 'Ada' }), { exact: false })).toBeVisible();
  await expect(main(page).getByText(t('discover.quick.needShelf'), { exact: true })).toHaveCount(0);
  await context.setOffline(true);
  const saved = main(page).getByText(new RegExp(t('buddies.shelf.asOf', { date: '' })));
  await expect(saved.first()).toBeVisible();
  if (isMobile) {
    await page.getByRole('button', { name: t('discover.filters.open', { count: 3 }), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(t('discover.buddies.counted', { names: 'Ada' }), { exact: false })).toBeVisible();
    await expect(dialog.getByText(new RegExp(t('buddies.shelf.asOf', { date: '' })))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await page.screenshot({ path: testInfo.outputPath('availability-filter-sheet.png'), fullPage: true });
    await dialog.getByRole('button', { name: t('discover.filters.results', { count: 1 }), exact: true }).click();
  }
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('buddy-only-offline.png'), fullPage: true });
  await explore.chip('discover.quick.available').click();
  await shown(explore, g.name(0));
  await expect(saved.first()).toBeVisible();
  await explore.chip('discover.quick.shelf').click();
  await expect(explore.cards).toHaveCount(0);
  await expect(main(page).getByText(startsWith(t('discover.shelf.scope.personal')))).toBeVisible();
  await context.setOffline(false);
});

test('a guest has no personal or availability controls, even from a link', async ({ page, shell }) => {
  await shell.open('#/?type=glazes&quick=available&clubs=1&buddies=1');
  await shell.expectGuest();
  await expect(clubsBox(page)).toHaveCount(0);
  await expect(buddiesBox(page)).toHaveCount(0);
});
