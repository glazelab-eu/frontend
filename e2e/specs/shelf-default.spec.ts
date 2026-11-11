import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { t } from '../support/i18n';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { expect, test } from '../support/test';

// Every form that starts a new shelf entry by typing starts its amount at the default 250 g, on the club shelf too:
// saving at once adds 250 g, the jar size stays empty and optional, and the default alone is nothing to lose.

const main = (page: Page) => page.getByRole('main');
const amount = (page: Page) => main(page).getByRole('spinbutton', { name: t('stock.form.quantity') });
const jarSize = (page: Page) => main(page).getByRole('spinbutton', { name: new RegExp(`^${t('stock.form.jarSize')}`) });
const question = (page: Page) => page.getByRole('dialog', { name: t('drafts.discardShelfScan') });
const leave = (page: Page) =>
  page
    .getByRole('navigation', { name: t('nav.label') })
    .getByRole('link', { name: t('nav.explore') })
    .first()
    .click();

/** Ash on no shelf yet, and a club of the account. */
async function seed(api: Api, uid: string) {
  const ash = await api.addGlaze({ newManufacturer: { name: `Default ${uid}`, shortId: uid.toUpperCase() }, code: 'A-1', name: 'Ash' });
  const name = `Kiln ${uid}`;
  const club = { id: (await api.createClub(name)).id, name };
  return { ash: ash.id, club, title: `Default ${uid} A-1 Ash` };
}

/** The account's entries of a glaze as `<owner> <grams> <jar size>`. */
const entries = async (api: Api, glazeId: string) =>
  (await api.stock()).filter((entry) => entry.glazeId === glazeId).map((entry) => `${entry.clubId ?? 'personal'} ${entry.quantityG} ${entry.jarSizeG ?? '-'}`);

test('the club shelf form starts a new entry at 250 g and saves it untouched', async ({ page, shell, api, signedIn, uid }) => {
  const { ash, club } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}&glaze=${ash}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(amount(page)).toHaveValue('250');
  await expect(jarSize(page)).toHaveValue('');
  await main(page)
    .getByRole('button', { name: t('stock.target.addClub', { club: club.name }), exact: true })
    .click();
  await expect.poll(() => entries(api, ash)).toEqual([`${club.id} 250 -`]);
});

test('a changed amount on the club shelf form is what it saves', async ({ page, shell, api, signedIn, uid }) => {
  const { ash, club } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}&glaze=${ash}`);
  await shell.expectSignedIn(signedIn.displayName);
  await amount(page).fill('400');
  await main(page)
    .getByRole('button', { name: t('stock.target.addClub', { club: club.name }), exact: true })
    .click();
  await expect.poll(() => entries(api, ash)).toEqual([`${club.id} 400 -`]);
});

test('the default amount alone leaves the stock page without asking; a changed one asks', async ({ page, shell, api, signedIn, uid }) => {
  const { ash, club } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}&glaze=${ash}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(amount(page)).toHaveValue('250');
  await leave(page);
  await expect(page).toHaveURL(/#\/$/);
  await expect(question(page)).toHaveCount(0);
  await page.goBack();
  await expect(amount(page)).toHaveValue('250');
  await amount(page).fill('260');
  await leave(page);
  await question(page)
    .getByRole('button', { name: t('drafts.stay') })
    .click();
  await expect(amount(page)).toHaveValue('260');
});

test('the add-glaze dialog of the club shelf starts at 250 g and adds that untouched', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('glazePicker.add') })
    .click();
  const add = new AddGlazeDialog(page);
  await expect(add.dialog).toBeVisible();
  await expect(add.field('glazeForm.shelf.quantity')).toHaveValue('250');
  await expect(add.field('glazeForm.shelf.jarSize')).toHaveValue('');
  // The dialog starts on the club the page shows: nothing to pick by hand.
  await expect(add.dialog.getByRole('combobox', { name: t('stock.form.owner'), exact: true })).toHaveValue(club.id);
  await add.fill({ manufacturer: `New ${uid}`, shortId: `N${uid.toUpperCase()}`.slice(0, 10), name: 'Birch', code: 'B-1' });
  await add.submit();
  await add.expectAdded();
  await expect
    .poll(async () => (await api.stock()).filter((entry) => entry.name === 'Birch' && entry.clubId === club.id).map((entry) => entry.quantityG))
    .toEqual([250]);
});

test('the glaze page add form starts at 250 g for a club and saves that untouched', async ({ page, shell, api, signedIn, uid }) => {
  const { ash, club, title } = await seed(api, uid);
  await shell.open(`#/glazes/${ash}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('glaze.shelf.addFor', { glaze: title }) })
    .click();
  await main(page)
    .getByRole('combobox', { name: t('stock.form.owner'), exact: true })
    .selectOption(club.id);
  await expect(amount(page)).toHaveValue('250');
  await expect(jarSize(page)).toHaveValue('');
  await main(page)
    .getByRole('button', { name: t('stock.target.addClub', { club: club.name }), exact: true })
    .click();
  await expect.poll(() => entries(api, ash)).toEqual([`${club.id} 250 -`]);
});
