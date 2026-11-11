import type { Page } from '@playwright/test';
import { t } from '../support/i18n';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/**
 * Reading the error reports (32-3, backend "Error reports"): an opted-in account sends reports, a site admin reads them grouped by
 * message with the stack and the device facts, filters, and deletes one report and a whole message; nobody else can read them and the
 * page never shows who sent a report. The API is real; site admins are made with SQL on the suite's database. The database is shared by
 * the whole run, so every message carries the test's ID and the page is searched for it.
 */
const main = (page: Page) => page.getByRole('main');

test('a site admin reads, filters and deletes error reports, and sees nobody’s name @smoke', async ({ page, shell, newApi, signedIn, uid }) => {
  test.setTimeout(120_000);
  const sender = await newApi();
  const account = { ...newAccount(uid, 'Sender'), displayName: `Reporter ${uid}` };
  await sender.signUp(account);
  await sender.chooseDiagnostics(true);
  const message = (n: number) => `Cannot read glaze ${uid} row ${n}`;
  await sender.sendReports([
    { message: message(1), stack: `TypeError: Cannot read glaze\n    at render (https://glazelab.eu/assets/index-A1b2.js:${uid.length}:2)`, count: 3 },
    { message: message(42), count: 1 },
    { kind: 'WARNING', message: `Slow photo ${uid} 7` },
  ]);
  await grantSiteAdmin(signedIn.email);

  await shell.open('#/admin/error-reports');
  await expect(main(page).getByRole('heading', { level: 1, name: t('errorReports.title') })).toBeVisible();
  // The retention is on the page.
  await expect(main(page).getByText(t('errorReports.body', { days: 30 }))).toBeVisible();
  const search = main(page).getByRole('searchbox', { name: t('errorReports.filter.search') });
  await search.fill(uid);
  await main(page)
    .getByRole('button', { name: t('errorReports.filter.apply') })
    .click();
  const entries = main(page).locator('.error-reports__entry');
  await expect(entries).toHaveCount(2);

  // One row per message: the two errors differ in digits only, so they are one message with two reports and four sightings.
  const errors = entries.filter({ hasText: 'Cannot read glaze' });
  await expect(errors.getByRole('heading', { level: 2 })).toContainText(`Cannot read glaze ${uid} row`);
  await expect(errors.locator('dd').nth(0)).toHaveText('2');
  await expect(errors.locator('dd').nth(1)).toHaveText('4');
  await expect(errors).toContainText(t('errorReports.kind.error'));
  await expect(errors).toContainText('0.1.0 (e2e)');
  await expect(errors).toContainText('Chrome');
  await expect(errors).toContainText('412 px');

  // Filters: the kind and a text that matches nothing.
  await main(page)
    .getByRole('combobox', { name: t('errorReports.filter.kind') })
    .selectOption('WARNING');
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText(`Slow photo ${uid}`);
  await main(page)
    .getByRole('button', { name: t('errorReports.filter.clear') })
    .click();
  await search.fill(uid);
  await main(page)
    .getByRole('button', { name: t('errorReports.filter.apply') })
    .click();
  await expect(entries).toHaveCount(2);
  await search.fill(`${uid} no such text`);
  await main(page)
    .getByRole('button', { name: t('errorReports.filter.apply') })
    .click();
  await expect(main(page).getByText(t('errorReports.emptyFiltered'))).toBeVisible();
  await search.fill(uid);
  await main(page)
    .getByRole('button', { name: t('errorReports.filter.apply') })
    .click();
  await expect(entries).toHaveCount(2);

  // Details: the scrubbed stack and the device facts of each report, newest first.
  await errors.getByRole('button', { name: new RegExp(`^${t('errorReports.details.show')}`) }).click();
  const rows = errors.locator('.error-reports__row');
  await expect(rows).toHaveCount(2);
  await expect(errors.getByRole('heading', { level: 3, name: t('errorReports.details.title') })).toBeVisible();
  await expect(errors.locator('pre')).toContainText('TypeError: Cannot read glaze');
  await expect(rows.first()).toContainText('Android 16');
  await expect(rows.first()).toContainText('412 × 915');
  await expect(rows.first()).toContainText('UTC+1');
  // Nothing says who sent them.
  await expect(main(page)).not.toContainText(account.displayName);
  await expect(main(page)).not.toContainText(account.email);

  // Delete one report: Cancel keeps it, the destructive button removes only it.
  await rows
    .first()
    .getByRole('button', { name: new RegExp(`^${t('errorReports.deleteOne')}`) })
    .click();
  const dialog = page.getByRole('dialog', { name: t('errorReports.deleteOne.title') });
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(rows).toHaveCount(2);
  await rows
    .first()
    .getByRole('button', { name: new RegExp(`^${t('errorReports.deleteOne')}`) })
    .click();
  await dialog.getByRole('button', { name: t('errorReports.deleteOne') }).click();
  await expect(dialog).toBeHidden();
  await expect(rows).toHaveCount(1);
  await expect(errors.locator('dd').nth(0)).toHaveText('1');

  // Delete the whole message.
  await errors.getByRole('button', { name: new RegExp(`^${t('errorReports.deleteGroup')}`) }).click();
  const groupDialog = page.getByRole('dialog', { name: t('errorReports.deleteGroup.title') });
  await expect(groupDialog).toContainText(`Cannot read glaze ${uid}`);
  await groupDialog.getByRole('button', { name: t('errorReports.deleteGroup') }).click();
  await expect(groupDialog).toBeHidden();
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText(`Slow photo ${uid}`);
});

test('error reports are for site admins only and the API answers 401 and 403 to everyone else', async ({ page, shell, newApi, signedIn, uid }) => {
  const guest = await newApi();
  const plain = await newApi();
  await plain.signUp(newAccount(uid, 'Plain'));
  const get = (api: typeof guest) => api.errorReportGroups();
  await expect(get(guest)).rejects.toThrow(/401/);
  await expect(get(plain)).rejects.toThrow(/403/);
  // The page tells a plain account it is for admins and asks for nothing.
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/error-reports')) requests.push(request.url());
  });
  await shell.open('#/admin/error-reports');
  await expect(main(page).getByText(t('errorReports.adminOnly'))).toBeVisible();
  expect(requests).toEqual([]);
  // A site admin has the footer link.
  await grantSiteAdmin(signedIn.email);
  await page.reload();
  await shell.footer.getByRole('link', { name: t('admin.title') }).click();
  await expect(page).toHaveURL(/#\/admin$/);
  await page
    .getByRole('main')
    .getByRole('link', { name: t('errorReports.title') })
    .click();
  await expect(page).toHaveURL(/#\/admin\/error-reports$/);
});
