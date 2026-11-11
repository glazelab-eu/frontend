import { t } from '../support/i18n';
import { ExplorePage } from '../support/pages/explore';
import { expect, test } from './support';

test('explore: search, types, sort, filters sheet and favourites', async ({ page, begin, finish, human, signIn }) => {
  await signIn();
  const explore = new ExplorePage(page);
  await begin('#/', (p) => p.getByRole('article').first().waitFor());
  await human.browse(2, 560);
  await human.scroll(0);

  // Search by typing.
  await human.type(explore.search, 'celadon');
  await expect(explore.cards.first()).toBeVisible();
  await human.pause(1400);
  await human.browse(1, 500);
  await human.scroll(0);
  await explore.search.clear();
  await human.pause(800);

  // The type tabs.
  await human.tap(explore.chip('discover.type.combinations'));
  await human.pause(900);
  await human.tap(explore.chip('discover.type.glazes'));
  await human.pause(900);
  await human.point(explore.sort);
  await explore.sort.selectOption({ index: 2 });
  await human.pause(1200);
  await human.tap(explore.chip('discover.type.combinations'));

  // Sort.
  await explore.sort.selectOption({ label: t('discover.sort.newest') });
  await human.pause(1400);
  await explore.sort.selectOption({ label: t('discover.sort.favourites') });
  await human.pause(1000);

  // The filters sheet: a tag, a glaze, the firing.
  await human.tap(page.getByRole('button', { name: /^Filters/ }));
  const sheet = page.getByRole('dialog', { name: t('discover.filters.title') });
  await expect(sheet).toBeVisible();
  await human.pause(900);
  await human.tryStep('tag filter', async () => {
    await human.type(sheet.getByRole('combobox', { name: t('discover.filter.tags') }), 'cone');
    await human.tap(page.getByRole('option').first());
  });
  await human.tryStep('cone filter', async () => {
    await human.scrollIn(sheet, 300);
    await sheet.getByRole('combobox', { name: t('discover.filter.cone') }).selectOption({ value: '6' });
    await human.pause(1000);
  });
  await human.tryStep('atmosphere filter', async () => {
    await sheet.getByRole('combobox', { name: t('discover.filter.atmosphere') }).selectOption({ index: 1 });
    await human.pause(1000);
  });
  await human.tap(sheet.getByRole('button', { name: /^Show \d+ result/ }));
  await human.browse(1, 500);
  await human.scroll(0);

  // Favourites: star a card, then see the view.
  await human.tap(page.getByRole('button', { name: t('favorites.add') }).first());
  await human.pause(900);
  await page.goto('/#/');
  await human.tap(explore.chip('discover.quick.favourites'));
  await human.browse(1, 500);
  await human.scroll(0);
  await human.tap(explore.chip('discover.quick.all'));
  await finish('explore-browse');
});
