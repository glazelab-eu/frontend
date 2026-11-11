import { eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { expect, test } from '../support/test';

test.beforeEach(async ({ shell, signedIn }) => {
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
});

test('a member adds a glaze with a new manufacturer and a barcode @smoke', async ({ page, uid }) => {
  const barcode = eanFor(uid);
  const add = new AddGlazeDialog(page);
  await add.openFromExplore();
  await add.fill({ manufacturer: `Botz ${uid}`, shortId: uid.toUpperCase(), name: 'Seegrün', code: 'sg 1', barcode });
  await add.submit();
  const added = await add.expectAdded();
  await added.getByRole('link', { name: t('addGlaze.open') }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Seegrün');
  await expect(page.getByRole('main')).toContainText(`Botz ${uid} SG-1`);
  await expect(page.getByRole('main')).toContainText(barcode);
});

test('an invalid barcode stops the form at its field', async ({ page, uid }) => {
  const add = new AddGlazeDialog(page);
  await add.openFromExplore();
  await add.fill({ manufacturer: `Botz ${uid}`, shortId: uid.toUpperCase(), name: 'Seegrün', code: 'SG-1', barcode: '4006381333932' });
  await add.submit();
  await expect(add.field('barcodes.field')).toHaveJSProperty('validationMessage', t('barcodes.invalid'));
  await expect(add.field('barcodes.field')).toBeFocused();
  await expect(add.dialog).toBeVisible();
});

test('closing the dialog with input asks first, and Stay keeps the draft', async ({ page, uid }) => {
  const add = new AddGlazeDialog(page);
  await add.openFromExplore();
  await add.field('stock.newGlaze.name').fill(`Draft ${uid}`);
  await add.close();
  await add.discardQuestion.getByRole('button', { name: t('drafts.stay') }).click();
  await expect(add.field('stock.newGlaze.name')).toHaveValue(`Draft ${uid}`);
  await add.close();
  await add.discardQuestion.getByRole('button', { name: t('drafts.discard') }).click();
  await expect(add.dialog).toBeHidden();
});

test('a jar size typed and cleared again does not block adding the glaze to the shelf', async ({ page, uid }) => {
  const add = new AddGlazeDialog(page);
  await add.openFromExplore();
  await add.fill({ manufacturer: `Botz ${uid}`, shortId: uid.toUpperCase(), name: 'Seegrün', code: 'SG-2' });
  await add.dialog.getByRole('checkbox', { name: t('glazeForm.shelf.have') }).check();
  await add.field('glazeForm.shelf.jarSize').fill('500');
  await add.field('glazeForm.shelf.jarSize').fill('');
  await add.submit();
  await add.expectAdded();
});
