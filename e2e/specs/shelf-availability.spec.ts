import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { expectAccessible } from '../support/axe';
import { settled } from '../support/header';
import { t } from '../support/i18n';
import { ExplorePage } from '../support/pages/explore';
import { expect, newAccount, test } from '../support/test';

/**
 * The shelf marks say where a glaze is: "On your shelf" for personal stock (also when a club has it too), "Available in <club>"
 * for a glaze only club shelves hold, while the club is the account's and the view counts club stock.
 */

const main = (page: Page) => page.getByRole('main');

/** Three glazes: one in a club only, one personal only, one on both shelves; a combination applying all three; a club the account joined. */
async function seed(api: Api, newApi: () => Promise<Api>, uid: string) {
  const ada = await newApi();
  await ada.signUp(newAccount(uid, 'Ada'));
  const clubName = `Kiln ${uid}`;
  const { club, token } = await ada.clubWithInvite(clubName);
  await api.joinClub(token);
  const first = await api.addGlaze({ newManufacturer: { name: `Mk ${uid}`, shortId: uid.toUpperCase() }, code: 'A-1', name: `Clubonly ${uid}` });
  const manufacturerId = first.glaze.manufacturer.id;
  const personal = await api.addGlaze({ manufacturerId, code: 'A-2', name: `Personal ${uid}` });
  const both = await api.addGlaze({ manufacturerId, code: 'A-3', name: `Both ${uid}` });
  await ada.addStock({ glazeId: first.id, ownerType: 'club', clubId: club.id, quantityG: 500 });
  await ada.addStock({ glazeId: both.id, ownerType: 'club', clubId: club.id, quantityG: 300 });
  await api.addStock({ glazeId: personal.id, ownerType: 'personal', quantityG: 250 });
  await api.addStock({ glazeId: both.id, ownerType: 'personal', quantityG: 250 });
  const combination = await api.addCombination({
    title: `Trio ${uid}`,
    steps: [first.id, personal.id, both.id].map((glazeId) => ({ type: 'GLAZE' as const, glazeId, coats: 1 })),
  });
  return { ada, club, clubName, clubOnly: first.id, combination };
}

test('a glaze only a club shelf holds says where it is available, until the account leaves the club', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}, info) => {
  const { club, clubName, clubOnly, combination } = await seed(api, newApi, uid);
  await shell.open(`#/combinations/${combination}`);
  await shell.expectSignedIn(signedIn.displayName);
  const available = t('combination.shelf.inClubs', { clubs: clubName, count: 1 });
  const step = (name: string) =>
    main(page)
      .getByRole('link', { name: new RegExp(name) })
      .locator('xpath=..');
  await expect(step(`Clubonly ${uid}`).getByText(available, { exact: true })).toBeVisible();
  await expect(step(`Clubonly ${uid}`).getByText(t('combination.shelf.on'), { exact: true })).toHaveCount(0);
  await expect(step(`Personal ${uid}`).getByText(t('combination.shelf.on'), { exact: true })).toBeVisible();
  // Personal and club stock: "On your shelf" only, the club is not mentioned.
  await expect(step(`Both ${uid}`).getByText(t('combination.shelf.on'), { exact: true })).toBeVisible();
  await expect(main(page).getByText(available, { exact: true })).toHaveCount(1);
  await expect(main(page).getByText(t('combination.shelf.all', { total: 3 }), { exact: true })).toBeVisible();
  await settled(page);
  await expectAccessible(page);
  await page.screenshot({ path: info.outputPath('combination-club-only.png'), fullPage: true });

  // The glaze page says the same, with the club's amount the member already sees on the shelf page.
  await shell.open(`#/glazes/${clubOnly}`);
  await expect(main(page).getByText(t('glaze.shelf.inClubs', { parts: `${clubName}: 500 g`, count: 1 }), { exact: true })).toBeVisible();
  await expect(main(page).getByText(t('glaze.shelf.on', { parts: `${clubName}: 500 g` }), { exact: true })).toHaveCount(0);

  await api.removeMember(club.id, (await api.me()).id);
  await page.goto('about:blank');
  await shell.open(`#/combinations/${combination}`);
  await expect(step(`Clubonly ${uid}`).getByText(t('combination.shelf.off'), { exact: true })).toBeVisible();
  await expect(main(page).getByText(available, { exact: true })).toHaveCount(0);
  await expect(main(page).getByText(t('combination.shelf.on'), { exact: true })).toHaveCount(2);
});

test('Explore names the club of a club-only glaze only while Available to me counts club stock', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { clubName } = await seed(api, newApi, uid);
  const explore = new ExplorePage(page);
  const available = t('combination.shelf.inClubs', { clubs: clubName, count: 1 });
  const row = (name: string) => explore.cards.filter({ has: page.getByRole('link', { name, exact: true }) });
  await shell.open(`#/?type=glazes&q=${uid}&quick=available&clubs=1`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(explore.cards).toHaveCount(3);
  await expect(row(`Clubonly ${uid}`).getByText(available, { exact: true })).toBeVisible();
  await expect(row(`Both ${uid}`).getByText(t('explore.glazeRow.onShelf'), { exact: true })).toBeVisible();
  await expect(main(page).getByText(available, { exact: true })).toHaveCount(1);
  await expectAccessible(page);
  // Personal only: the club-only glaze is not available and its club is never named.
  await shell.open(`#/?type=glazes&q=${uid}&quick=available&clubs=0`);
  await expect(explore.cards).toHaveCount(2);
  await expect(main(page).getByText(available, { exact: true })).toHaveCount(0);
  // Outside the availability views the rows mark the personal shelf alone.
  await shell.open(`#/?type=glazes&q=${uid}`);
  await expect(explore.cards).toHaveCount(3);
  await expect(main(page).getByText(t('explore.glazeRow.onShelf'), { exact: true })).toHaveCount(2);
  await expect(main(page).getByText(available, { exact: true })).toHaveCount(0);
  // I can make now without club stock: the combination needs the club's glaze.
  await shell.open(`#/?type=combinations&q=${uid}&quick=canMake&clubs=0`);
  await expect(main(page).getByRole('heading', { name: `Trio ${uid}`, exact: true })).toHaveCount(0);
  await shell.open(`#/?type=combinations&q=${uid}&quick=canMake&clubs=1`);
  await expect(main(page).getByRole('heading', { name: `Trio ${uid}`, exact: true })).toBeVisible();
});
