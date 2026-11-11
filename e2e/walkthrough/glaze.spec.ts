import { t } from '../support/i18n';
import { expect, test } from './support';

/** A glaze page: photos, shelf summary, about (edit, history), tags, barcodes, combinations, one-click shelf add, ask a buddy. */
test('glaze page: gallery, shelf, history, barcodes, tags, add a jar, ask a buddy', async ({ page, begin, finish, human, signIn, seed }) => {
  await signIn();
  const main = page.getByRole('main');
  const celadon = seed.glazes['Botz CE-1'];
  await begin(`#/glazes/${celadon}`, (p) => p.getByRole('heading', { level: 1, name: 'Celadon' }).waitFor());

  // The photo gallery: swipe, then the full-screen viewer.
  await human.tryStep('gallery', async () => {
    const gallery = main.getByRole('region', { name: /^Photos of/ });
    await human.swipe(gallery, -140);
    await human.swipe(gallery, 140);
    await human.tap(main.getByRole('button', { name: t('images.viewer.open') }).first());
    const viewer = page.getByRole('dialog', { name: /^Full-screen photos of/ });
    await expect(viewer).toBeVisible();
    await human.pause(1500);
    await human.tap(viewer.getByRole('button', { name: t('images.viewer.next') }));
    await human.pause(1200);
    await human.tap(viewer.getByRole('button', { name: t('common.close') }));
  });
  await human.browse(1, 480);

  // Shelf summary, then the details: edit dialog and history.
  await human.tryStep('about edit', async () => {
    await human.tap(main.getByRole('button', { name: t('glaze.details.editLabel') }));
    await human.pause(2200);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('common.close'), exact: true })
      .first()
      .click();
    await human.pause(700);
  });
  await human.tryStep('history', async () => {
    await human.tap(main.getByRole('button', { name: t('glaze.details.history') }));
    await human.pause(1500);
    await human.scrollIn(page.getByRole('dialog'), 300);
    await human.pause(1200);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('common.close'), exact: true })
      .first()
      .click();
    await human.pause(700);
  });
  await human.browse(2, 520);

  // A glaze with a barcode and tags: edit barcodes, add a tag.
  await human.tryStep('barcode glaze', async () => {
    await page.evaluate((id) => (location.hash = `#/glazes/${id}`), seed.barcode.glaze);
    await expect(main.getByRole('heading', { level: 1, name: 'Celadon Light' })).toBeVisible();
    await human.pause(1500);
    await human.browse(1, 420);
    await human.tap(main.getByRole('button', { name: t('barcodes.editLabel') }));
    await human.pause(2200);
    await page.keyboard.press('Escape');
    await human.pause(600);
  });
  await human.tryStep('tags', async () => {
    await human.tap(main.getByRole('button', { name: t('tags.edit') }));
    await human.type(
      main
        .getByRole('combobox', { name: t('tags.add') })
        .or(main.getByPlaceholder(t('tags.placeholder')))
        .first(),
      'satin',
    );
    await human.pause(1000);
    await page.keyboard.press('Enter');
    await human.pause(1200);
  });

  // A glaze a buddy has: one click puts a jar on the shelf, and a buddy can be asked for some.
  await human.tryStep('quick add and ask a buddy', async () => {
    await page.evaluate((id) => (location.hash = `#/glazes/${id}`), seed.glazes['Duncan DN-312']);
    await expect(main.getByRole('heading', { level: 1, name: 'Dusty Rose' })).toBeVisible();
    await human.pause(1800);
    await human.tryStep('ask', async () => {
      await human.tap(main.getByRole('button', { name: /^Ask/ }).first());
      await human.pause(2200);
      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible())
        await dialog
          .getByRole('button', { name: t('common.close'), exact: true })
          .first()
          .click();
    });
    await human.tap(main.getByRole('button', { name: /^Add jar to your shelf/ }));
    await expect(page.getByRole('status').filter({ hasText: t('notices.shelfAdded') })).toBeVisible();
    await human.pause(1800);
  });
  await finish('glaze');
});
