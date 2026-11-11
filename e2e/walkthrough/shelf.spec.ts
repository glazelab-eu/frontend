import { eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { expect, film, test } from './support';

/** My shelf: groups (personal, used up, club shelves), amounts, +1 jar, keep private, the shelf choice and the phone scan session. */
test('shelf: groups, amounts, +1 jar, keep private, scan session', async ({ page, begin, finish, human, signIn, seed }) => {
  await signIn();
  const main = page.getByRole('main');
  await begin('#/stock', (p) =>
    p
      .getByRole('main')
      .getByRole('button', { name: /change the amount of/ })
      .first()
      .waitFor(),
  );
  await human.browse(2, 520);
  await human.scroll(0);

  await human.tryStep('filter', async () => {
    await human.type(main.getByLabel(t('stock.list.filter')), 'blue');
    await human.pause(1000);
    await main.getByLabel(t('stock.list.filter')).clear();
  });
  await human.tryStep('amount', async () => {
    await human.tap(main.getByRole('button', { name: /change the amount of/ }).first());
    await human.pause(1600);
    await human.tap(main.getByRole('button', { name: t('stock.row.save') }).first());
  });
  await human.tryStep('+1 jar', async () => {
    await human.tap(main.getByRole('button', { name: /^\+1 jar for/ }).first());
    await human.pause(1400);
  });
  await human.tryStep('keep private', async () => {
    await human.tap(
      main
        .getByRole('button', { name: /^Keep private:/ })
        .or(main.getByLabel(/^Keep private/))
        .first(),
    );
    await human.pause(1400);
  });
  await human.tryStep('used up group', async () => {
    await human.browse(3, 560);
  });
  // The shelves: personal, each club's shelf.
  await human.tryStep('shelves', async () => {
    await human.scroll(0);
    const shelves = main.getByRole('group', { name: t('stock.shelves.label') });
    await human.tap(shelves.getByRole('link').nth(1));
    await human.browse(1, 450);
    await human.scroll(0);
    await human.tap(shelves.getByRole('link').nth(2));
    await human.browse(1, 450);
    await human.scroll(0);
  });
  // The phone's scan session: the fake camera films a jar label, the amount is saved, the next scan follows.
  await human.tryStep('scan session', async () => {
    film(seed.freshBarcode.code);
    await human.tap(page.getByRole('button', { name: t('stock.scan.button') }));
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(t('stock.scan.notOnShelf'))).toBeVisible({ timeout: 25_000 });
    await human.pause(1500);
    await human.type(sheet.getByLabel(t('stock.scan.grams')), '500');
    // The shelf chip chosen above may be a club's: the save button names whichever shelf the sheet writes to.
    await human.tap(sheet.locator('.scan-sheet__save:not(.scan-sheet__quick)'));
    await human.pause(2500);
    film(eanFor('another-jar'));
    await page.keyboard.press('Escape');
    await human.pause(1200);
  });
  await finish('shelf');
});
