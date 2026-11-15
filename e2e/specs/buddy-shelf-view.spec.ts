import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { t, withCount } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';

/**
 * A buddy's shelf on the shelf page: a second chip row under the own shelves, mutually exclusive with them (one `?shelf=`),
 * read only, the glazes only (never amounts), without what the buddy keeps private. Ana is the signed-in account.
 */
const main = (page: Page) => page.getByRole('main');
const ownChips = (page: Page) => main(page).getByRole('group', { name: t('stock.shelves.label') });
const buddyChips = (page: Page) => main(page).getByRole('group', { name: t('stock.shelves.buddies') });

async function seed(api: Api, newApi: () => Promise<Api>, uid: string) {
  const first = await api.addGlaze({ newManufacturer: { name: `Bs ${uid}`, shortId: uid.toUpperCase() }, code: 'M-1', name: 'Mine' });
  const manufacturerId = first.glaze.manufacturer.id;
  const glaze = async (code: string, name: string) => (await api.addGlaze({ manufacturerId, code, name })).id;
  const [shared, secret] = [await glaze('S-1', 'Shared'), await glaze('P-1', 'Secret')];
  // Creating a club answers its ID only: the name is the one asked for.
  const club = { id: (await api.clubWithInvite(`Kiln ${uid}`)).club.id, name: `Kiln ${uid}` };
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: `Ada ${uid}` });
  await api.requestBuddyByLink(await ada.replaceBuddyLink());
  await ada.acceptBuddy((await api.me()).id);
  await api.addStock({ glazeId: first.id, ownerType: 'personal', quantityG: 400 });
  await ada.addStock({ glazeId: shared, ownerType: 'personal', quantityG: 1234 });
  await ada.addStock({ glazeId: secret, ownerType: 'personal', quantityG: 100 });
  await ada.setKeepPrivate((await ada.stock()).find((entry) => entry.glazeId === secret)!.id, true);
  return { ada, adaName: `Ada ${uid}`, club, label: (code: string, name: string) => `Bs ${uid} ${code} ${name}` };
}

test('a buddy chip shows their shelf read only, without amounts or private glazes, and never with an own shelf', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const { ada, adaName, club, label } = await seed(api, newApi, uid);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(buddyChips(page).getByRole('link')).toHaveText([withCount(adaName)]);
  await expect(buddyChips(page).getByRole('link', { name: withCount(adaName) })).toHaveText(/ 1$/);
  await expect(ownChips(page).getByRole('link', { name: withCount(t('stock.shelves.all')) })).toHaveAttribute('aria-current', 'page');

  await buddyChips(page)
    .getByRole('link', { name: withCount(adaName) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${(await ada.me()).id}$`));
  await expect(buddyChips(page).getByRole('link', { name: withCount(adaName) })).toHaveAttribute('aria-current', 'page');
  await expect(ownChips(page).locator('[aria-current]')).toHaveCount(0);
  await expect(main(page).getByRole('heading', { level: 2, name: t('stock.buddy.title', { name: adaName }) })).toBeVisible();
  await expect(main(page).getByRole('link', { name: label('S-1', 'Shared') })).toBeVisible();
  await expect(main(page).getByRole('button', { name: t('buddies.shelf.askFor', { name: adaName, glaze: label('S-1', 'Shared') }) })).toBeVisible();
  await expect(main(page).getByText('Secret')).toHaveCount(0);
  await expect(main(page).getByText('Mine')).toHaveCount(0);
  await expect(main(page).getByText(/1[,.]?234/)).toHaveCount(0);
  // Read only: no form that could look like a write to the buddy's shelf.
  await expect(main(page).getByRole('button', { name: t('stock.target.add') })).toHaveCount(0);
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(1);

  await ownChips(page)
    .getByRole('link', { name: withCount(club.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${club.id}$`));
  await expect(buddyChips(page).locator('[aria-current]')).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: label('S-1', 'Shared') })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: t('stock.target.addClub', { club: club.name }) })).toBeVisible();
});

test('a former buddy’s link shows all own shelves', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { ada } = await seed(api, newApi, uid);
  const adaId = (await ada.me()).id;
  await ada.removeBuddy((await api.me()).id);
  await shell.open(`#/stock?shelf=${adaId}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(ownChips(page).getByRole('link', { name: withCount(t('stock.shelves.all')) })).toHaveAttribute('aria-current', 'page');
  await expect(buddyChips(page)).toHaveCount(0);
  await expect(main(page).getByRole('heading', { level: 3, name: t('stock.group.personal'), exact: true })).toBeVisible();
});
