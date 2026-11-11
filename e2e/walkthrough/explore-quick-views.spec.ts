import { t } from '../support/i18n';
import { ExplorePage } from '../support/pages/explore';
import { expect, test } from './support';

/** Explore's quick views: favourites, mine, waiting, new, "I can make now" and "On my shelf" with its choices. */
test('explore quick views: I can make now, On my shelf with its options', async ({ page, begin, finish, human, signIn }) => {
  await signIn();
  const explore = new ExplorePage(page);
  await begin('#/', (p) => p.getByRole('article').first().waitFor());

  for (const view of ['discover.quick.favourites', 'discover.quick.mine', 'discover.quick.waiting', 'discover.quick.new'] as const) {
    await human.tryStep(view, async () => {
      await human.tap(explore.chip(view));
      await human.browse(1, 420);
      await human.scroll(0);
    });
  }

  // "I can make now": combinations whose glazes are on the shelf, then those missing one glaze.
  await human.tryStep('can make', async () => {
    await human.tap(explore.chip('discover.quick.canMake'));
    await human.browse(1, 500);
    await human.scroll(0);
    await human.tap(page.getByRole('main').getByRole('link', { name: new RegExp(t('discover.quick.almost')) }));
    await human.browse(1, 500);
    await human.scroll(0);
  });

  // "Include buddies" counts the glazes of the buddies as available.
  await human.tryStep('include buddies in can make', async () => {
    await human.tap(page.getByRole('main').getByLabel(t('discover.buddies.include')));
    await human.pause(1000);
    await human.browse(1, 500);
    await human.scroll(0);
  });

  // "On my shelf" in the Glazes list, with the Stock choice and both inclusions.
  await human.tryStep('glazes type', async () => {
    await human.tap(explore.chip('discover.type.glazes'));
  });
  await human.tryStep('on my shelf', async () => {
    await human.tap(explore.chip('discover.quick.shelf'));
    await human.pause(1000);
    await human.tap(explore.shelfChoice('discover.shelfStock.used'));
    await human.browse(1, 420);
    await human.scroll(0);
    await human.tap(explore.shelfChoice('discover.shelfStock.all'));
    await human.tap(explore.shelfChoice('discover.shelfStock.stock'));
  });
  await human.tryStep('include club glazes', async () => {
    await human.tap(page.getByRole('main').getByLabel(t('discover.shelf.clubs.include')));
    await human.pause(1000);
  });
  await human.tryStep('include buddies on shelf', async () => {
    const buddies = page.getByRole('main').getByLabel(new RegExp(t('discover.buddies.include')));
    if (!(await buddies.isChecked())) await human.tap(buddies);
    await human.pause(1000);
    await human.browse(2, 520);
    await human.scroll(0);
  });
  await finish('explore-quick-views');
});
