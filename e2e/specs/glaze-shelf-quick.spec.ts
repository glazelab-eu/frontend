import { t } from '../support/i18n';
import { expect, test } from '../support/test';

const JAR = 250;

/** A glaze of its own manufacturer, so a test finds it by its title. */
async function newGlaze(api: import('../support/api').Api, uid: string, name: string) {
  const created = await api.addGlaze({ newManufacturer: { name: `Quick ${uid}`, shortId: `${uid}Q` }, code: 'QK-1', name });
  return { id: created.id, title: `Quick ${uid} QK-1 ${name}` };
}

const quickName = (title: string) => t('glaze.shelf.quickAddFor', { size: JAR, glaze: title });

test('one click puts a 250 g jar on the personal shelf, says so, and keeps focus on Update', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Fern');
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const quick = main.getByRole('button', { name: quickName(glaze.title) });
  await expect(quick).toBeVisible();
  await expect(quick).toHaveText(t('glaze.shelf.quickAdd'));
  await expect(main.getByText(t('glaze.shelf.none'), { exact: true })).toBeVisible();
  await quick.click();
  await expect(page.getByRole('status').filter({ hasText: t('notices.shelfAdded') })).toBeVisible();
  await expect(main.getByText(t('glaze.shelf.on', { parts: '250 g' }), { exact: true })).toBeVisible();
  await expect(quick).toHaveCount(0);
  const update = main.getByRole('button', { name: t('glaze.shelf.updateFor', { glaze: glaze.title }) });
  await expect(update).toBeFocused();
  const entries = (await api.stock()).filter((item) => item.glazeId === glaze.id);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ quantityG: JAR, jarSizeG: JAR, clubId: null });
  await shell.open('#/stock');
  await expect(page.getByRole('main').getByRole('button', { name: t('stock.row.editAmount', { amount: '250 g', glaze: glaze.title }) })).toBeAttached();
});

test('a glaze only on a club shelf still offers the button, next to the add toggle', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Moss');
  const club = await api.createClub(`Kiln ${uid}`);
  await api.addStock({ glazeId: glaze.id, ownerType: 'club', clubId: club.id, quantityG: 900 });
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(
    main
      .getByRole('button', { name: t('glaze.shelf.addFor', { glaze: glaze.title }) })
      .or(main.getByRole('button', { name: t('glaze.shelf.updateFor', { glaze: glaze.title }) })),
  ).toBeVisible();
  await main.getByRole('button', { name: quickName(glaze.title) }).click();
  await expect(main.getByText(t('glaze.shelf.on', { parts: `250 g · Kiln ${uid}: 900 g` }), { exact: true })).toBeVisible();
  const entries = (await api.stock()).filter((item) => item.glazeId === glaze.id);
  expect(entries).toHaveLength(2);
  expect(entries.filter((item) => !item.clubId)).toMatchObject([{ quantityG: JAR, jarSizeG: JAR }]);
});

test('a glaze already on the personal shelf has no quick button', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Ash');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 400 });
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: t('glaze.shelf.updateFor', { glaze: glaze.title }) })).toBeVisible();
  await expect(main.getByRole('button', { name: quickName(glaze.title) })).toHaveCount(0);
});

test('without a connection the quick button goes with the toggle; a guest has no shelf', async ({ page, shell, api, context, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Sand');
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const quick = main.getByRole('button', { name: quickName(glaze.title) });
  await expect(quick).toBeVisible();
  await context.setOffline(true);
  await expect(quick).toHaveCount(0);
  await expect(main.getByText(t('glaze.shelf.offline'))).toBeVisible();
  await context.setOffline(false);
  await expect(quick).toBeVisible();

  // The session ends with its cookies: the glaze is public, the shelf line is not there.
  await context.clearCookies();
  await page.reload();
  await expect(main.getByRole('heading', { level: 1, name: 'Sand' })).toBeVisible();
  await expect(main.getByRole('region', { name: t('glaze.shelf.label') })).toHaveCount(0);
  await expect(main.getByRole('button', { name: quickName(glaze.title) })).toHaveCount(0);
});
