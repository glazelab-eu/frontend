import { glaze } from '../../src/test/fixtures';
import { t } from '../support/i18n';
import { mockApi } from '../support/mock-api';
import { ExplorePage } from '../support/pages/explore';
import { StudioPage } from '../support/pages/studio';
import { expect, test } from '../support/test';

test('a member records and publishes a combination @smoke', async ({ page, shell, api, signedIn, uid }) => {
  await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: uid }, name: 'Seegrün', code: 'SG-1' });
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.addGlazeStep(`Botz ${uid} SG-1`);
  await studio.title.fill(`Celadon over slip ${uid}`);
  await studio.publish();
  await expect(page.getByRole('heading', { level: 1, name: `Celadon over slip ${uid}` })).toBeVisible();
  await expect(page).toHaveURL(/#\/combinations\/[0-9a-f-]{36}$/);
});

test('a saved draft is listed in Mine only', async ({ page, shell, signedIn, uid }) => {
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.title.fill(`Unfinished ${uid}`);
  await studio.saveDraft();
  await expect(page.getByRole('heading', { level: 1, name: `Unfinished ${uid}` })).toBeVisible();
  await expect(page.getByRole('main').getByText(t('combination.draft.badge'), { exact: true })).toBeVisible();
  const explore = new ExplorePage(page);
  await shell.open(`#/?q=${uid}`);
  await expect(explore.cards).toHaveCount(0);
  await explore.chip('discover.quick.mine').click();
  await expect(explore.cardTitles).toHaveText([`Unfinished ${uid}`]);
});

test('a long glaze list renders its first options, the active one always, and more when scrolled', async ({ page, shell, api, signedIn, uid }) => {
  const first = await api.addGlaze({ newManufacturer: { name: `Many ${uid}`, shortId: uid }, code: 'M-00', name: 'Many 00' });
  const manufacturerId = first.glaze.manufacturer.id;
  await Promise.all(
    Array.from({ length: 59 }, (_, index) => {
      const n = String(index + 1).padStart(2, '0');
      return api.addGlaze({ manufacturerId, code: `M-${n}`, name: `Many ${n}` });
    }),
  );
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t('studio.addGlazeStep') }).click();
  const picker = main.getByRole('combobox', { name: t('common.glaze') });
  const list = page.getByRole('listbox', { name: t('common.glaze') });
  const options = list.getByRole('option');
  await picker.fill(uid);
  // The first page (OPTION_PAGE), each option with its place among all 60 matches.
  await expect(options).toHaveCount(50);
  await expect(options.first()).toHaveAttribute('aria-setsize', '60');
  await expect(options.first()).toHaveAttribute('aria-posinset', '1');
  // ArrowUp on the closed list makes the last match active: it is rendered, named by the input and scrolled into view,
  // with one page around it rather than every option before it (PICK-1).
  await picker.press('Escape');
  await picker.press('ArrowUp');
  const last = list.locator('[aria-posinset="60"]');
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(picker).toHaveAttribute('aria-activedescendant', (await last.getAttribute('id'))!);
  await expect(last).toBeInViewport();
  await expect(options).toHaveCount(50);
  await expect(options.first()).toHaveAttribute('aria-posinset', '11');
  // Opened again, the list starts with a page; scrolling to its end adds the rest.
  await picker.press('Escape');
  await picker.press('ArrowDown');
  await expect(options).toHaveCount(50);
  await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(options).toHaveCount(60);
  // Closed and opened again after that scroll: a page again.
  await picker.press('Escape');
  await picker.press('ArrowDown');
  await expect(options).toHaveCount(50);
  await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(options).toHaveCount(60);
  // Other text starts again with a page, here the same 60 matches.
  await picker.fill(`${uid} `);
  await expect(options).toHaveCount(50);
  // The keyboard crosses the end of the page: the next option is rendered, active, named and in view, and the way back works.
  for (let step = 0; step < 50; step++) await picker.press('ArrowDown');
  const next = list.locator('[aria-posinset="51"]');
  await expect(next).toHaveAttribute('aria-selected', 'true');
  await expect(picker).toHaveAttribute('aria-activedescendant', (await next.getAttribute('id'))!);
  await expect(next).toBeInViewport();
  await picker.press('ArrowUp');
  await expect(list.locator('[aria-posinset="50"]')).toHaveAttribute('aria-selected', 'true');
  await picker.press('Enter');
  await expect(picker).toHaveValue(/Many 49/);
});

test('a picker reopened on a glaze far down the list renders a page around it and the options before it when scrolled up', async ({ page, shell, uid }) => {
  // The whole library is the reopened list, so the library is exactly these 160 glazes.
  const glazes = Array.from({ length: 160 }, (_, index) => {
    const n = String(index).padStart(3, '0');
    return glaze({ id: `far-${n}`, code: `F-${n}`, name: `Far ${uid} ${n}` });
  });
  await mockApi(page, { answers: { 'GET /api/glazes': async (route) => route.fulfill({ json: glazes }) } });
  await shell.open('#/studio');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t('studio.addGlazeStep') }).click();
  const picker = main.getByRole('combobox', { name: t('common.glaze') });
  const list = page.getByRole('listbox', { name: t('common.glaze') });
  const options = list.getByRole('option');
  // Choose the 100th glaze of the whole list by the keyboard.
  await picker.click();
  await expect(list.locator('[aria-posinset="1"]')).toHaveAttribute('aria-selected', 'true');
  for (let step = 0; step < 99; step++) await picker.press('ArrowDown');
  await expect(list.locator('[aria-posinset="100"]')).toHaveAttribute('aria-selected', 'true');
  await picker.press('Enter');
  await expect(picker).toHaveValue(new RegExp(`Far ${uid} 099`));
  // Reopened with a click the whole list (empty text) shows with the chosen glaze active: one page around it.
  await picker.click();
  const chosen = list.locator('[aria-posinset="100"]');
  await expect(chosen).toHaveAttribute('aria-selected', 'true');
  await expect(picker).toHaveAttribute('aria-activedescendant', (await chosen.getAttribute('id'))!);
  await expect(chosen).toBeInViewport();
  await expect(options).toHaveCount(50);
  await expect(options.first()).toHaveAttribute('aria-posinset', '75');
  await expect(options.last()).toHaveAttribute('aria-posinset', '124');
  await expect(options.first()).toHaveAttribute('aria-setsize', '160');
  // Scrolled near the top of the rendered options, the page before them is added and the option at the top stays at the top:
  // not at offset 0, where browsers anchor nothing anyway, so this also catches the list moving twice (anchoring plus our own move).
  const topOption = () =>
    list.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      return [...element.querySelectorAll('[role="option"]')].find((option) => option.getBoundingClientRect().bottom > top + 1)?.getAttribute('aria-posinset');
    });
  const atTop = await list.evaluate((element) => {
    element.scrollTop = 30;
    const top = element.getBoundingClientRect().top;
    return [...element.querySelectorAll('[role="option"]')].find((option) => option.getBoundingClientRect().bottom > top + 1)?.getAttribute('aria-posinset');
  });
  await expect(options).toHaveCount(100);
  await expect(options.first()).toHaveAttribute('aria-posinset', '25');
  await expect.poll(topOption).toBe(atTop);
  await expect(list.locator('[aria-posinset="25"]')).not.toBeInViewport();
  // And so on up to the first option.
  await list.evaluate((element) => (element.scrollTop = 0));
  await expect(options.first()).toHaveAttribute('aria-posinset', '1');
  await expect(options).toHaveCount(124);
});

test('matches that shrink under an open list keep the active option among them', async ({ page, shell, uid }) => {
  const all = Array.from({ length: 5 }, (_, index) => glaze({ id: `g${index}`, code: `S-${index}`, name: `Shrink ${uid} ${index}` }));
  let glazes = all;
  await mockApi(page, { answers: { 'GET /api/glazes': async (route) => route.fulfill({ json: glazes }) } });
  await shell.open('#/studio');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t('studio.addGlazeStep') }).click();
  const picker = main.getByRole('combobox', { name: t('common.glaze') });
  const list = page.getByRole('listbox', { name: t('common.glaze') });
  await picker.fill(`Shrink ${uid}`);
  await expect(list.getByRole('option')).toHaveCount(5);
  for (let step = 0; step < 4; step++) await picker.press('ArrowDown');
  await expect(list.locator('[aria-posinset="5"]')).toHaveAttribute('aria-selected', 'true');
  // A refresh (here a network change) brings two of the five back while the list stays open.
  glazes = all.slice(0, 2);
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await expect(list.getByRole('option')).toHaveCount(2);
  const last = list.locator('[aria-posinset="2"]');
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(picker).toHaveAttribute('aria-activedescendant', (await last.getAttribute('id'))!);
  await picker.press('Enter');
  await expect(picker).toHaveValue(new RegExp(`Shrink ${uid} 1`));
});
