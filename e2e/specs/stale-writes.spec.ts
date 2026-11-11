import type { Page, Route } from '@playwright/test';
import type { Api } from '../support/api';
import { t } from '../support/i18n';
import { StudioPage } from '../support/pages/studio';
import { expect, test } from '../support/test';

// REVIEW-6: a page whose copy is stale (another device or account wrote after it loaded) sends only what the person
// changed, so it never replaces that write: a new shelf entry is an addition (FE-6), a typed amount keeps a jar size
// changed elsewhere (FE-9), a size change keeps an amount a refresh brought in (STOCK-3), and a Studio edit opened at the
// start takes its form from the server's copy and keeps tags others added (FE-5, BE-9).

const JAR = 250;
const BISQUE_STEP = { type: 'CUSTOM' as const, label: 'Bisque', notes: 'Cone 04' };

async function newGlaze(api: Api, uid: string, name: string) {
  const created = await api.addGlaze({ newManufacturer: { name: `Stale ${uid}`, shortId: `${uid}W` }, code: 'SW-1', name });
  return { id: created.id, title: `Stale ${uid} SW-1 ${name}` };
}

const entryOf = async (api: Api, glazeId: string) => (await api.stock()).find((item) => item.glazeId === glazeId && !item.clubId);

/** The page refreshes its listings (back online, or back in the foreground). */
const refresh = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

test('the glaze page add form adds its amount to an entry another device created meanwhile (FE-6)', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Larch');
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t('glaze.shelf.addFor', { glaze: glaze.title }) }).click();
  await expect(main.getByRole('spinbutton', { name: t('stock.form.quantity') })).toHaveValue(String(JAR));
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 8 * JAR, jarSizeG: 1000 });
  await main.getByRole('button', { name: t('stock.target.add'), exact: true }).click();
  await expect.poll(async () => (await entryOf(api, glaze.id))?.quantityG).toBe(9 * JAR);
  expect((await entryOf(api, glaze.id))?.jarSizeG).toBe(1000);
});

test('the stock form adds a new entry to one another device created meanwhile (FE-6)', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
  test.skip(isMobile, 'the phone opens the scan session; the form rules are the same');
  const glaze = await newGlaze(api, uid, 'Rowan');
  await shell.open(`#/stock?glaze=${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main.getByRole('spinbutton', { name: t('stock.form.quantity') }).fill(String(JAR));
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 8 * JAR });
  await main.getByRole('button', { name: t('stock.target.add'), exact: true }).click();
  await expect.poll(async () => (await entryOf(api, glaze.id))?.quantityG).toBe(9 * JAR);
});

test('a typed amount keeps the jar size another device changed (FE-9)', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
  test.skip(isMobile, 'the same form on both layouts');
  const glaze = await newGlaze(api, uid, 'Aspen');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open(`#/stock?glaze=${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('spinbutton', { name: t('stock.form.jarSize') })).toHaveValue(String(JAR));
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addStock({ glazeId: glaze.id, ownerType: 'personal', jarSizeG: 2 * JAR });
  await main.getByRole('spinbutton', { name: t('stock.form.quantity') }).fill('400');
  await main.getByRole('button', { name: t('stock.target.update'), exact: true }).click();
  await expect.poll(async () => (await entryOf(api, glaze.id))?.quantityG).toBe(400);
  expect((await entryOf(api, glaze.id))?.jarSizeG).toBe(2 * JAR);
});

test('set mode changing only the jar size keeps the jar a refresh brought in (STOCK-3)', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
  test.skip(isMobile, 'the same form on both layouts');
  const glaze = await newGlaze(api, uid, 'Elm');
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: JAR, jarSizeG: JAR });
  await shell.open(`#/stock?glaze=${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const phone = await newApi();
  await phone.signIn(signedIn);
  await phone.addToStock({ glazeId: glaze.id, ownerType: 'personal', addG: JAR });
  await refresh(page);
  await expect(main.getByText(t('stock.form.current', { quantity: '500' }))).toBeAttached();
  await main.getByRole('spinbutton', { name: t('stock.form.jarSize') }).fill('1000');
  await main.getByRole('button', { name: t('stock.target.update'), exact: true }).click();
  await expect.poll(async () => (await entryOf(api, glaze.id))?.jarSizeG).toBe(1000);
  expect((await entryOf(api, glaze.id))?.quantityG).toBe(2 * JAR);
});

test("a Studio edit opened at the start waits for the server's copy and keeps tags others added (FE-5, BE-9)", async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const id = await api.addCombination({ title: `Layers ${uid}`, description: 'Yesterday', steps: [BISQUE_STEP], tags: ['satin'] });
  // The device saves its snapshot with yesterday's notes.
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('heading', { level: 1, name: `Layers ${uid}` })).toBeVisible();
  await page.goto('about:blank');
  // Meanwhile the author edits the notes on another device and someone else tags the combination.
  await api.updateCombination(id, { title: `Layers ${uid}`, description: 'Edited on the desktop', steps: [BISQUE_STEP], tags: ['satin'] });
  const ben = await newApi();
  await ben.signUp({ email: `ben-${uid}@example.test`, displayName: `Ben ${uid}`, password: signedIn.password });
  await ben.addTags('combinations', id, ['celadon']);

  // The start refresh answers late: the form must not open from the snapshot meanwhile.
  const held: Route[] = [];
  let holding = true;
  await page.route(
    (url) => url.pathname === '/api/sync',
    async (route) => {
      if (holding) held.push(route);
      else await route.fallback();
    },
  );
  await page.goto(`/#/studio/${id}`);
  await expect.poll(() => held.length).toBeGreaterThan(0);
  const studio = new StudioPage(page);
  await expect(studio.title).toHaveCount(0);
  holding = false;
  for (const route of held.splice(0)) await route.fallback();

  const notes = studio.main.getByRole('textbox', { name: t('common.notes') });
  await expect(notes).toHaveValue('Edited on the desktop');
  // A tag added while the form is open stays too: the save sends only the form's own tag changes.
  await ben.addTags('combinations', id, ['glossy']);
  await studio.title.fill(`Layers fixed ${uid}`);
  await studio.main.getByRole('button', { name: t('studio.edit.submit'), exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Layers fixed ${uid}` })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByText('Edited on the desktop')).toBeVisible();
  await expect(main.getByRole('list', { name: t('tags.label') }).getByRole('listitem')).toHaveText(['celadon', 'glossy', 'satin']);
});
