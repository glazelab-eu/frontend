import { eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { ExplorePage } from '../support/pages/explore';
import { expect, film, filmBlank, test } from './support';

/** The Glazes list: the icon-only "+" on a glaze row, favourites, the barcode scan icon (a fake camera films a barcode) and "Add a glaze". */
test('explore glazes: add button on a row, barcode scan, add a glaze', async ({ page, begin, finish, human, signIn, seed }) => {
  await signIn();
  const explore = new ExplorePage(page);
  const main = page.getByRole('main');
  await begin('#/?type=glazes&sort=az', (p) => p.getByRole('article').first().waitFor());
  await human.browse(2, 520);

  // The "+" on a row of a glaze that is not on the shelf puts one jar there.
  await human.tryStep('plus button', async () => {
    const plus = main.getByRole('button', { name: /^Add jar to your shelf/ }).first();
    await human.tap(plus);
    await expect(page.getByRole('status').filter({ hasText: t('notices.shelfAdded') })).toBeVisible();
    await human.pause(1600);
  });
  await human.tryStep('star on a row', async () => {
    await human.tap(main.getByRole('button', { name: t('favorites.add') }).first());
  });
  await human.scroll(0);

  // "Add a glaze": the scanner comes first on a phone, then the form by hand.
  await human.tryStep('add a glaze', async () => {
    const add = new AddGlazeDialog(page);
    filmBlank();
    await human.scroll(0);
    await human.tap(main.getByRole('button', { name: t('addGlaze.action') }).first());
    await expect(add.scanner).toBeVisible();
    await human.pause(2500);
    await human.tap(add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode') }));
    await expect(add.dialog).toBeVisible();
    await human.pause(800);
    await human.type(add.dialog.getByRole('combobox', { name: t('glazeForm.manufacturer') }), 'Amaco');
    await human.tap(page.getByRole('option', { name: /Amaco/ }).first());
    await human.type(add.field('stock.newGlaze.name'), 'Winter Blue');
    await human.type(add.field('stock.newGlaze.code'), 'PC-88');
    await human.tap(add.dialog.getByLabel(t('glazeForm.shelf.have')));
    await human.type(add.dialog.getByLabel(t('glazeForm.shelf.quantity')), '500');
    await human.tap(add.dialog.getByRole('button', { name: t('stock.newGlaze.submit'), exact: true }));
    await add.expectAdded();
    await human.pause(2200);
    await page.keyboard.press('Escape');
    await human.pause(600);
  });
  // The scan icon: the fake camera films a barcode of a glaze in the library.
  await human.tryStep('scan known barcode', async () => {
    film(seed.barcode.code);
    await human.tap(main.getByRole('button', { name: t('barcodes.scan') }));
    await human.pause(3500);
    await expect(main.getByText(/Found/)).toBeVisible({ timeout: 20_000 });
    await human.pause(1500);
    await human.tap(main.getByRole('button', { name: t('app.dismissNotice') }));
  });
  // A barcode nobody has: the app offers to add it as a new glaze.
  await human.tryStep('scan unknown barcode', async () => {
    film(eanFor('a-new-jar-label'));
    await human.tap(main.getByRole('button', { name: t('barcodes.scan') }));
    await expect(main.getByText(/No glaze in the library has the barcode/)).toBeVisible({ timeout: 25_000 });
    await human.pause(1500);
    await human.tap(main.getByRole('button', { name: t('barcodes.discover.add') }));
    await human.pause(2200);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('common.close'), exact: true })
      .first()
      .click();
    await human.pause(800);
  });
  await finish('explore-glazes-scan');
});
