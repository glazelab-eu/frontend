import type { Page } from '@playwright/test';
import { t } from '../support/i18n';
import { expect, test } from '../support/test';

// A shelf row's buttons say they are busy while a write runs: a second tap is refused visibly, never dropped without a sign.

const row = (page: Page, amount: string, title: string) =>
  page.getByRole('main').getByRole('button', { name: t('stock.row.editAmount', { amount, glaze: title }) });

test('the shelf row: its buttons are marked unavailable while +1 jar is saved, and a second tap sends nothing', async ({ page, shell, api, signedIn, uid }) => {
  const created = await api.addGlaze({ newManufacturer: { name: `Row ${uid}`, shortId: `${uid}R` }, code: 'RW-1', name: 'Fern' });
  const title = `Row ${uid} RW-1 Fern`;
  await api.addStock({ glazeId: created.id, ownerType: 'personal', quantityG: 250, jarSizeG: 250 });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(row(page, '250 g', title)).toBeAttached();
  let additions = 0;
  let release = () => {};
  await page.route('**/api/stock/add', async (route) => {
    additions++;
    await new Promise<void>((resolve) => (release = resolve));
    await route.continue();
  });
  const oneJar = page.getByRole('main').getByRole('button', { name: t('stock.row.oneJarFor', { glaze: title }) });
  const usedUp = page.getByRole('main').getByRole('button', { name: t('stock.row.usedUpFor', { glaze: title }) });
  await oneJar.click();
  await expect.poll(() => additions).toBe(1);
  await expect(oneJar).toHaveAttribute('aria-disabled', 'true');
  await expect(usedUp).toHaveAttribute('aria-disabled', 'true');
  await expect(oneJar).toBeFocused();
  // Playwright waits for an aria-disabled button to become enabled; a person taps it anyway.
  await oneJar.click({ force: true });
  release();
  await expect(row(page, '500 g', title)).toBeAttached();
  await expect(oneJar).not.toHaveAttribute('aria-disabled', 'true');
  expect(additions).toBe(1);
  expect((await api.stock()).find((item) => item.glazeId === created.id)?.quantityG).toBe(500);
});
