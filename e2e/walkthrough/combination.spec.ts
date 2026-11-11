import { t } from '../support/i18n';
import { expect, test } from './support';

/** A combination page: steps, photos, lineage, buddy marks, favourite, share. */
test('combination page: photos, steps, lineage, buddy marks, favourite, share', async ({ page, begin, finish, human, signIn, seed }) => {
  const api = await signIn();
  const main = page.getByRole('main');
  // A combination of glazes buddies have: Mara has Dusty Rose, Tomás has Chun Blue, the main account has Ash Grey.
  const glaze = (key: string) => seed.glazes[key];
  const buddyId = await api.addCombination({
    title: 'Dusty Rose over Chun Blue',
    description: 'A soft pink over milky blue. Pools purple in the carved lines.',
    cone: '6',
    atmosphere: 'OXIDATION',
    tags: ['cone-6', 'layering'],
    steps: [
      { type: 'GLAZE', glazeId: glaze('Coyote CY-07'), coats: 2, method: 'Dip' },
      { type: 'GLAZE', glazeId: glaze('Laguna LG-14'), coats: 2, method: 'Brush' },
      { type: 'GLAZE', glazeId: glaze('Duncan DN-312'), coats: 1, method: 'Spray' },
    ],
  });
  void buddyId;

  await begin(`#/combinations/${seed.hero.combination}`, (p) => p.getByRole('heading', { level: 1, name: 'Celadon over Shino White' }).waitFor());
  await human.tryStep('gallery', async () => {
    const gallery = main.getByRole('region', { name: /^Photos of/ });
    await human.swipe(gallery, -140);
    await human.swipe(gallery, -140);
    await human.tap(main.getByRole('button', { name: t('images.viewer.open') }).first());
    const viewer = page.getByRole('dialog', { name: /^Full-screen photos of/ });
    await expect(viewer).toBeVisible();
    await human.pause(1500);
    await human.tap(viewer.getByRole('button', { name: t('images.viewer.next') }));
    await human.pause(1200);
    await human.tap(viewer.getByRole('button', { name: t('common.close') }));
  });
  await human.browse(1, 500);
  await human.tryStep('favourite', async () => {
    await human.tap(main.getByRole('button', { name: /favourites/ }).first());
  });
  await human.tryStep('share', async () => {
    await human.tap(main.getByRole('button', { name: t('share.action') }));
    await human.pause(1800);
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible())
      await dialog
        .getByRole('button', { name: t('common.close'), exact: true })
        .first()
        .click();
  });
  await human.browse(2, 520);

  // The lineage: a variation shows what it is based on.
  await human.tryStep('variation', async () => {
    await human.tap(main.getByRole('link', { name: 'Celadon over Shino White, extra coat' }).first());
    await expect(main.getByRole('heading', { level: 1, name: 'Celadon over Shino White, extra coat' })).toBeVisible();
    await human.pause(1500);
    await human.browse(1, 500);
  });

  // Buddy marks: which buddy has the glazes the account lacks, and a way to ask.
  await human.tryStep('buddy marks', async () => {
    await page.evaluate((id) => (location.hash = `#/combinations/${id}`), buddyId);
    await expect(main.getByRole('heading', { level: 1, name: 'Dusty Rose over Chun Blue' })).toBeVisible();
    await human.pause(1800);
    await human.browse(2, 480);
    await human.tap(main.getByRole('button', { name: /^Ask/ }).first());
    await human.pause(2200);
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible())
      await dialog
        .getByRole('button', { name: t('common.close'), exact: true })
        .first()
        .click();
    await human.pause(800);
  });
  await finish('combination');
});
