import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIALOG, expectAccessible } from '../support/axe';
import { barcodeVideo, eanFor } from '../support/barcodes';
import { t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { ExplorePage } from '../support/pages/explore';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { expect, test } from '../support/test';

// "Add a glaze" opens the barcode scanner first on a phone (27-11). The fake camera films the file written by each test
// just before the scanner opens (parallel tests of a worker share it).
const video = join(FIXTURES, `add-scan-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(null));

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

const film = (barcode: string) => writeFileSync(video, barcodeVideo(barcode));

test.beforeEach(async ({ shell, signedIn }) => {
  // Each worker reuses its camera file: checks without a scan must not decode a previous test's jar.
  writeFileSync(video, barcodeVideo(null));
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
});

const addButton = (page: import('@playwright/test').Page) =>
  page
    .getByRole('main')
    .getByRole('button', { name: t('addGlaze.action') })
    .first();

test('a wide window opens the dialog directly, no scanner', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the scanner comes first on the phone');
  const add = new AddGlazeDialog(page);
  await addButton(page).click();
  await expect(add.dialog).toBeVisible();
  await expect(add.scanner).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, 'a coarse pointer starts with the scanner');
  });

  test('a known barcode keeps the scanner open and its sheet saves to the chosen shelf; the next scan starts on your shelf again', async ({
    page,
    api,
    uid,
  }) => {
    const barcode = eanFor(`add-scan-known-${uid}`);
    const club = `Kiln ${uid}`;
    const kiln = (await api.createClub(club)).id;
    await api.addGlaze({ newManufacturer: { name: `Scan ${uid}`, shortId: uid.toUpperCase() }, code: 'K-1', name: 'Known', barcode });
    await page.reload();
    film(barcode);
    await addButton(page).click();
    const add = new AddGlazeDialog(page);
    await expect(add.scanner).toBeVisible();
    // The Stock page's sheet: still the scanner, no navigation.
    await expect(add.scanner.getByText(t('stock.scan.notOnShelf'))).toBeVisible();
    await expect(page).not.toHaveURL(/#\/glazes?\//);
    await add.scanner.getByRole('combobox', { name: t('stock.form.owner') }).selectOption(kiln);
    await add.scanner.getByLabel(t('stock.scan.grams')).fill('250');
    await add.scanner.getByRole('button', { name: t('stock.scan.saveNextClub', { club }) }).click();
    await expect(add.scanner.getByText(t('stock.scan.saved', { glaze: `Scan ${uid} K-1 Known`, quantity: '250' }))).toBeVisible();
    // A new session, also after a reload, starts on the personal shelf (SHELF-3: a club is never the target by leftover state).
    await page.keyboard.press('Escape');
    await expect(add.scanner).toBeHidden();
    await page.reload();
    film(barcode);
    await addButton(page).click();
    await expect(add.scanner.getByRole('combobox', { name: t('stock.form.owner') })).toHaveValue('personal');
    await expect(add.scanner.getByRole('button', { name: t('glaze.shelf.quickAdd'), exact: true })).toBeVisible();
  });

  test('a club remembered by an older build is ignored: the scan starts on the personal shelf', async ({ page, api, uid }) => {
    const barcode = eanFor(`add-scan-fallback-${uid}`);
    const club = (await api.createClub(`Kept ${uid}`)).id;
    await api.addGlaze({ newManufacturer: { name: `Back ${uid}`, shortId: uid.toUpperCase() }, code: 'B-1', name: 'Back', barcode });
    const me: string = await page.evaluate(async () => ((await (await fetch('/api/auth/me')).json()) as { id: string }).id);
    await page.evaluate((id) => localStorage.setItem(`glazelab:scan-shelf:${id.me}`, id.club), { me, club });
    await page.reload();
    film(barcode);
    await addButton(page).click();
    const add = new AddGlazeDialog(page);
    // The sheet of the known glaze offers the club (so the choice is visible) but starts on the personal shelf, and its
    // one-click add says so.
    await expect(add.scanner.getByRole('combobox', { name: t('stock.form.owner') })).toHaveValue('personal');
    await expect(add.scanner.getByRole('button', { name: t('glaze.shelf.quickAdd'), exact: true })).toBeVisible();
    await expect(add.scanner.getByRole('button', { name: t('stock.scan.quickAddClub', { club: `Kept ${uid}` }) })).toHaveCount(0);
  });

  test('an unknown barcode opens the dialog with it; after the addition the scanner goes on', async ({ page, uid }) => {
    const barcode = eanFor(`add-scan-unknown-${uid}`);
    film(barcode);
    await addButton(page).click();
    const add = new AddGlazeDialog(page);
    const dialog = page.getByRole('dialog', { name: t('addGlaze.titleBarcode', { barcode }) });
    await expect(dialog).toBeVisible();
    await expect(add.field('barcodes.field')).toHaveValue(barcode);
    await add.fill({ manufacturer: `Next ${uid}`, shortId: uid.toUpperCase(), name: 'Seegrün', code: 'N-1' });
    // "I have this glaze" is on for a scan: it needs an amount.
    await dialog.getByLabel(t('glazeForm.shelf.quantity')).fill('300');
    await add.submit();
    const added = await add.expectAdded();
    await expect(added.getByRole('link', { name: t('addGlaze.open') })).toBeVisible();
    // The session takes the next jar by itself: closing the result returns to the scanner.
    await added
      .getByRole('button', { name: t('common.close'), exact: true })
      .last()
      .click();
    await expect(add.scanner).toBeVisible();
    await expect(add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode') })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(add.scanner).toBeHidden();
    await expect(addButton(page)).toBeFocused();
  });

  test('"Add without a barcode" opens the empty dialog', async ({ page }) => {
    const add = new AddGlazeDialog(page);
    await addButton(page).click();
    await add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode') }).click();
    await expect(add.dialog).toBeVisible();
    await expect(add.field('barcodes.field')).toHaveValue('');
    await add.close();
    await expect(addButton(page)).toBeFocused();
  });

  test('the scanner sheet is accessible and traps focus', async ({ page }) => {
    const add = new AddGlazeDialog(page);
    await addButton(page).click();
    await expect(add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await page.keyboard.press('Escape');
    await expect(add.scanner).toBeHidden();
    await expect(addButton(page)).toBeFocused();
  });

  test('a scanned barcode is added to the existing glaze the typed manufacturer and code name', async ({ page, api, uid }) => {
    const barcode = eanFor(`add-scan-take-${uid}`);
    const name = `Take ${uid}`;
    const made = await api.addGlaze({ newManufacturer: { name, shortId: uid.toUpperCase() }, code: 'T-1', name: 'Existing' });
    await page.reload();
    // The shared library may fill the first page with photos; find this test's fixture explicitly.
    await new ExplorePage(page).search.fill(name);
    await expect(page.getByRole('main').getByRole('link', { name: 'Existing', exact: true })).toBeVisible();
    film(barcode);
    await addButton(page).click();
    const add = new AddGlazeDialog(page);
    const dialog = page.getByRole('dialog', { name: t('addGlaze.titleBarcode', { barcode }) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: t('glazeForm.manufacturer') }).fill(name);
    await page
      .getByRole('option', { name: new RegExp(name) })
      .first()
      .click();
    await add.field('stock.newGlaze.code').fill('t-1');
    await expect(dialog.getByRole('link', { name: t('glazeForm.openDuplicate') })).toBeVisible();
    await dialog.getByRole('button', { name: t('glazeForm.takeBarcode', { barcode, glaze: `${name} T-1 Existing` }) }).click();
    await expect(page).toHaveURL(new RegExp(`${made.id}$`));
    await expect(page.getByRole('main')).toContainText(barcode);
    // Scanning it again finds that glaze (its sheet), as for any known code.
    await page.goBack();
    film(barcode);
    await addButton(page).click();
    // Now a known code: the session shows its sheet and the glaze is not opened.
    await expect(add.scanner.getByText(t('stock.scan.notOnShelf'))).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`${made.id}$`));
  });

  test('a barcode that belongs to another glaze meanwhile is refused in the dialog', async ({ page, api, uid }) => {
    const barcode = eanFor(`add-scan-taken-${uid}`);
    const name = `Taken ${uid}`;
    await api.addGlaze({ newManufacturer: { name, shortId: uid.toUpperCase() }, code: 'T-1', name: 'Target' });
    await page.reload();
    // The shared library may fill the first page with photos; find this test's fixture explicitly.
    await new ExplorePage(page).search.fill(name);
    await expect(page.getByRole('main').getByRole('link', { name: 'Target', exact: true })).toBeVisible();
    film(barcode);
    await addButton(page).click();
    const add = new AddGlazeDialog(page);
    const dialog = page.getByRole('dialog', { name: t('addGlaze.titleBarcode', { barcode }) });
    await expect(dialog).toBeVisible();
    // Another glaze takes the code while the dialog is open.
    await api.addGlaze({ newManufacturer: { name: `Other ${uid}`, shortId: `O${uid}`.toUpperCase().slice(0, 6) }, code: 'O-1', name: 'Other', barcode });
    await dialog.getByRole('combobox', { name: t('glazeForm.manufacturer') }).fill(name);
    await page
      .getByRole('option', { name: new RegExp(name) })
      .first()
      .click();
    await add.field('stock.newGlaze.code').fill('T-1');
    await dialog.getByRole('button', { name: t('glazeForm.takeBarcode', { barcode, glaze: `${name} T-1 Target` }) }).click();
    await expect(dialog).toContainText(t('errors.barcodeTaken'));
    await expect(dialog).toBeVisible();
  });
});

test('Scan barcode uses the add-glaze session for a known glaze and returns focus to its own button', async ({ page, api, uid, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  const barcode = eanFor(`toolbar-known-${uid}`);
  const created = await api.addGlaze({ newManufacturer: { name: `Shared ${uid}`, shortId: uid.toUpperCase() }, code: 'S-1', name: 'Shared scan', barcode });
  await page.reload();
  film(barcode);
  const scan = page.getByRole('main').getByRole('button', { name: t('barcodes.scan'), exact: true });
  await scan.click();
  const add = new AddGlazeDialog(page);
  await expect(add.scanner.getByText(t('stock.scan.notOnShelf'))).toBeVisible();
  await expect(page.getByRole('dialog', { name: t('barcodes.scanner.findTitle') })).toHaveCount(0);
  await expectAccessible(page, { include: [DIALOG] });
  await add.scanner.getByRole('button', { name: t('glaze.shelf.quickAdd'), exact: false }).click();
  await expect(add.scanner.getByText(t('stock.scan.saved', { glaze: `Shared ${uid} S-1 Shared scan`, quantity: '250' }))).toBeVisible();
  expect((await api.stock()).filter((entry) => entry.glazeId === created.id)).toHaveLength(1);
  await expect(add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode'), exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(add.scanner).toHaveCount(0);
  await expect(scan).toBeFocused();
});

test('Scan barcode opens the same prefilled add dialog for an unknown code and can switch to manual addition', async ({ page, uid, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  const barcode = eanFor(`toolbar-unknown-${uid}`);
  film(barcode);
  const scan = page.getByRole('main').getByRole('button', { name: t('barcodes.scan'), exact: true });
  await scan.click();
  const add = new AddGlazeDialog(page);
  const unknown = page.getByRole('dialog', { name: t('addGlaze.titleBarcode', { barcode }) });
  await expect(unknown).toBeVisible();
  await expect(add.field('barcodes.field')).toHaveValue(barcode);
  await add.close();
  await expect(add.scanner).toBeVisible();
  await add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode'), exact: true }).click();
  await expect(add.dialog).toBeVisible();
  await expect(add.field('barcodes.field')).toHaveValue('');
  await add.close();
  await expect(scan).toBeFocused();
});
