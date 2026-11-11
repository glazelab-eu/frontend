import { BISQUE_STEP, type Api } from '../support/api';
import { t } from '../support/i18n';
import { ExplorePage } from '../support/pages/explore';
import { expect, newAccount, test } from '../support/test';

test('search narrows the list to the matching combinations @smoke', async ({ page, shell, newApi, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  for (const title of [`Celadon ${uid}`, `Tenmoku ${uid}`]) await author.addCombination({ title, steps: [BISQUE_STEP] });
  const explore = new ExplorePage(page);
  await shell.open();
  await explore.search.fill(uid);
  await expect(explore.cardTitles).toHaveText([`Tenmoku ${uid}`, `Celadon ${uid}`]);
  await explore.search.fill(`celadon ${uid}`);
  await expect(explore.cardTitles).toHaveText([`Celadon ${uid}`]);
  await expect(page).toHaveURL(/q=celadon/);
});

test('sort orders the list alphabetically', async ({ page, shell, newApi, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  for (const title of ['Birch', 'Ash', 'Cedar']) await author.addCombination({ title: `${title} ${uid}`, steps: [BISQUE_STEP] });
  const explore = new ExplorePage(page);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(explore.cardTitles).toHaveText([`Cedar ${uid}`, `Ash ${uid}`, `Birch ${uid}`]);
  await explore.sort.selectOption({ label: t('discover.sort.az') });
  await expect(explore.cardTitles).toHaveText([`Ash ${uid}`, `Birch ${uid}`, `Cedar ${uid}`]);
});

async function thirteenCombinations(newApi: () => Promise<Api>, uid: string): Promise<void> {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  for (let index = 1; index <= 13; index++) await author.addCombination({ title: `Tile ${String(index).padStart(2, '0')} ${uid}`, steps: [BISQUE_STEP] });
}

test('the list shows twelve cards and the next page when scrolled to its end', async ({ page, shell, newApi, uid, isMobile }) => {
  test.skip(!isMobile, 'a wide window shows the end of the first page at once and loads the next');
  await thirteenCombinations(newApi, uid);
  const explore = new ExplorePage(page);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(explore.cards).toHaveCount(12);
  await explore.cards.last().scrollIntoViewIfNeeded();
  await expect(explore.cards).toHaveCount(13);
});

test('Back from a card of the second page returns to it', async ({ page, shell, newApi, uid }) => {
  await thirteenCombinations(newApi, uid);
  const explore = new ExplorePage(page);
  await shell.open(`#/?type=combinations&q=${uid}`);
  const oldest = page.getByRole('link', { name: `Tile 01 ${uid}`, exact: true });
  await explore.cards.nth(11).scrollIntoViewIfNeeded();
  await oldest.scrollIntoViewIfNeeded();
  await oldest.click();
  await expect(page.getByRole('heading', { level: 1, name: `Tile 01 ${uid}` })).toBeVisible();
  await page.goBack();
  await expect(explore.cards).toHaveCount(13);
  await expect(oldest).toBeInViewport();
});

test('the Mine view shows only the account’s own combinations', async ({ page, shell, newApi, api, signedIn, uid }) => {
  const other = await newApi();
  await other.signUp(newAccount(uid, 'Cleo'));
  await other.addCombination({ title: `Theirs ${uid}`, steps: [BISQUE_STEP] });
  await api.addCombination({ title: `Own ${uid}`, steps: [BISQUE_STEP] });
  const explore = new ExplorePage(page);
  await shell.open(`#/?q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(explore.cardTitles).toHaveText([`Own ${uid}`, `Theirs ${uid}`]);
  await explore.chip('discover.quick.mine').click();
  await expect(explore.cardTitles).toHaveText([`Own ${uid}`]);
});

test('On my shelf: in stock, used up or all, with counts, in the link and after a reload', async ({ page, shell, api, signedIn, uid }) => {
  const first = await api.addGlaze({ newManufacturer: { name: `Own ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: `Full ${uid}` });
  const manufacturerId = first.glaze.manufacturer.id;
  const used = await api.addGlaze({ manufacturerId, code: 'U-1', name: `Used ${uid}` });
  await api.addGlaze({ manufacturerId, code: 'N-1', name: `None ${uid}` });
  await api.addStock({ glazeId: first.id, ownerType: 'personal', quantityG: 300 });
  await api.addStock({ glazeId: used.id, ownerType: 'personal', quantityG: 0 });
  const explore = new ExplorePage(page);
  const shown = async (...names: string[]) => {
    await expect(explore.cards).toHaveCount(names.length);
    for (const name of names) await expect(explore.cards.getByRole('link', { name, exact: true })).toBeVisible();
  };
  await shell.open(`#/?type=glazes&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(explore.shelfChoice('discover.shelfStock.stock')).toHaveCount(0);
  await explore.chip('discover.quick.shelf').click();
  await expect(page).toHaveURL(/quick=shelf/);
  await expect(page).not.toHaveURL(/stock=/);
  await expect(explore.shelfChoice('discover.shelfStock.stock')).toHaveText(/\b1$/);
  await expect(explore.shelfChoice('discover.shelfStock.used')).toHaveText(/\b1$/);
  await expect(explore.shelfChoice('discover.shelfStock.all')).toHaveText(/\b2$/);
  await shown(`Full ${uid}`);
  await explore.shelfChoice('discover.shelfStock.used').click();
  await expect(page).toHaveURL(/quick=shelf&stock=used/);
  await shown(`Used ${uid}`);
  await page.reload();
  await shown(`Used ${uid}`);
  await expect(explore.shelfChoice('discover.shelfStock.used')).toHaveAttribute('aria-current', 'true');
  await explore.shelfChoice('discover.shelfStock.all').click();
  await expect(page).toHaveURL(/stock=all/);
  await shown(`Full ${uid}`, `Used ${uid}`);
  await page.goBack();
  await shown(`Used ${uid}`);
  await explore.shelfChoice('discover.shelfStock.stock').click();
  await expect(page).not.toHaveURL(/stock=/);
  await shown(`Full ${uid}`);
  // Another view or the unowned glaze: the choice is gone, and a guest's link ignores it.
  await explore.chip('discover.quick.all').click();
  await expect(explore.shelfChoice('discover.shelfStock.stock')).toHaveCount(0);
  await shell.open(`#/?type=glazes&q=${uid}&quick=shelf&stock=used`);
  await shown(`Used ${uid}`);
});

test('a guest has no shelf view and no stock choice, even from a link', async ({ page, shell }) => {
  const explore = new ExplorePage(page);
  await shell.open('#/?type=glazes&quick=shelf&stock=used');
  await shell.expectGuest();
  await expect(explore.chip('discover.type.glazes')).toBeVisible();
  await expect(explore.chip('discover.quick.shelf')).toHaveCount(0);
  await expect(explore.shelfChoice('discover.shelfStock.stock')).toHaveCount(0);
});
