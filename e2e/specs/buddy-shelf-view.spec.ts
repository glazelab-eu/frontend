import type { Locator, Page } from '@playwright/test';
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
/** No chip of the row is current. */
async function noneCurrent(row: Locator) {
  for (const chip of await row.getByRole('link').all()) await expect(chip).not.toHaveAttribute('aria-current');
}
const visibleText = (page: Page, text: string) => main(page).getByText(text).filter({ visible: true });
const quantity = (page: Page) => main(page).getByRole('spinbutton', { name: t('stock.form.quantity') });

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
  return { ada, adaName: `Ada ${uid}`, mine: first.id, club, label: (code: string, name: string) => `Bs ${uid} ${code} ${name}` };
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
  await noneCurrent(ownChips(page));
  await expect(main(page).getByRole('heading', { level: 2, name: t('stock.buddy.title', { name: adaName }) })).toBeVisible();
  await expect(main(page).getByRole('link', { name: label('S-1', 'Shared') })).toBeVisible();
  await expect(main(page).getByRole('button', { name: t('buddies.shelf.askFor', { name: adaName, glaze: label('S-1', 'Shared') }) })).toBeVisible();
  // The own shelf stays mounted but hidden: only what is visible counts.
  await expect(visibleText(page, 'Secret')).toHaveCount(0);
  await expect(visibleText(page, 'Mine')).toHaveCount(0);
  // The amount as the app writes it (en), never the bare digits, which the test's uid may hold.
  await expect(visibleText(page, '1,234')).toHaveCount(0);
  // Read only: no form that could look like a write to the buddy's shelf.
  await expect(main(page).getByRole('button', { name: t('stock.target.add') })).toHaveCount(0);
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(1);

  await ownChips(page)
    .getByRole('link', { name: withCount(club.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${club.id}$`));
  await noneCurrent(buddyChips(page));
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

test('a draft of the own form waits behind a buddy chip, named there with a way back', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { ada, adaName, mine, label } = await seed(api, newApi, uid);
  await shell.open(`#/stock?glaze=${mine}`);
  await shell.expectSignedIn(signedIn.displayName);
  await quantity(page).fill('555');
  await buddyChips(page)
    .getByRole('link', { name: withCount(adaName) })
    .click();
  await expect(page).toHaveURL(new RegExp(`shelf=${(await ada.me()).id}`));
  await expect(main(page).getByText(t('stock.buddy.draft', { glaze: label('M-1', 'Mine') }))).toBeVisible();
  await main(page)
    .getByRole('link', { name: t('stock.buddy.draftBack') })
    .click();
  await expect(page).toHaveURL(/shelf=personal/);
  await expect(quantity(page)).toHaveValue('555');
});

test("a link's glaze waits for the own shelf instead of filling the form behind a buddy's", async ({ page, shell, api, newApi, signedIn, uid }) => {
  const { ada, adaName, mine } = await seed(api, newApi, uid);
  await shell.open(`#/stock?glaze=${mine}&shelf=${(await ada.me()).id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('heading', { level: 2, name: t('stock.buddy.title', { name: adaName }) })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await ownChips(page)
    .getByRole('link', { name: withCount(t('stock.shelves.all')) })
    .click();
  await expect(main(page).getByRole('button', { name: t('stock.target.update') })).toBeVisible();
  await expect(quantity(page)).toHaveValue('400');
});

test('without a club, the Personal chip alone leads back from a buddy and is current on its own link', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: `Ada ${uid}` });
  await api.requestBuddyByLink(await ada.replaceBuddyLink());
  await ada.acceptBuddy((await api.me()).id);
  await shell.open(`#/stock?shelf=${(await ada.me()).id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('stock.buddy.empty', { name: `Ada ${uid}` }))).toBeVisible();
  await expect(ownChips(page).getByRole('link')).toHaveText([withCount(t('stock.owner.me'))]);
  await ownChips(page)
    .getByRole('link', { name: withCount(t('stock.owner.me')) })
    .click();
  await expect(page).toHaveURL(/#\/stock\?shelf=personal$/);
  await expect(ownChips(page).getByRole('link', { name: withCount(t('stock.owner.me')) })).toHaveAttribute('aria-current', 'page');
  await noneCurrent(buddyChips(page));
});
