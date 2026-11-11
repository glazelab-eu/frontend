import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';

const admin = { ...MOCK_USER, siteAdmin: true };
const empty = { json: { entries: [], hasMore: false } };
/** Every admin list answers empty, so a page can be opened without a backend. */
const answers = {
  'GET /api/admin/image-reports': empty,
  'GET /api/admin/image-deletions': empty,
  'GET /api/admin/avatar-reports': empty,
  'GET /api/admin/bans': empty,
  'GET /api/admin/users': empty,
  'GET /api/admin/feedback': { json: { entries: [], hasMore: false, open: 0 } },
  'GET /api/admin/error-reports': { json: { groups: [], hasMore: false } },
  'GET /api/admin/error-reports/builds': { json: { builds: [] } },
};
const pages = [
  ['image-reports', 'images.reports.title'],
  ['image-deletions', 'images.log.title'],
  ['avatar-reports', 'avatars.reports.title'],
  ['bans', 'bans.title'],
  ['error-reports', 'errorReports.title'],
  ['users', 'users.title'],
  ['feedback', 'feedbackAdmin.title'],
] as const;

test('the Administration page lists the seven admin pages, each leads to its page and back @smoke', async ({ page }) => {
  await mockApi(page, { user: admin, answers });
  await page.goto('/#/');
  const footer = page.locator('.app-shell__footer');
  // One footer link replaces the seven.
  await expect(footer.getByRole('link', { name: t('admin.title') })).toHaveCount(1);
  for (const [, title] of pages) await expect(footer.getByRole('link', { name: t(title) })).toHaveCount(0);
  await footer.getByRole('link', { name: t('admin.title') }).click();
  const main = page.getByRole('main');
  await expect(page).toHaveURL(/#\/admin$/);
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(t('admin.title'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const links = main.getByRole('list').getByRole('link');
  await expect(links).toHaveCount(7);
  for (const [name, title] of pages) {
    const link = main.getByRole('link', { name: new RegExp(`^${t(title)}`) });
    await expect(link).toHaveAttribute('href', `#/admin/${name}`);
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await main.getByRole('link', { name: new RegExp(`^${t('bans.title')}`) }).click();
  await expect(page).toHaveURL(/#\/admin\/bans$/);
  await expect(main.getByRole('heading', { level: 1, name: t('bans.title') })).toBeVisible();
  await main.locator('.back-link').click();
  await expect(page).toHaveURL(/#\/admin$/);
  await page.goto('/#/admin/nonsense');
  await expect(main.getByRole('heading', { level: 1 })).not.toHaveText(t('admin.title'));
});

test('a plain account and a guest see only the guard text and no footer link', async ({ page }) => {
  for (const user of [MOCK_USER, null]) {
    await mockApi(page, { user });
    await page.goto('/#/admin');
    await expect(page.getByRole('main').getByText(t('admin.adminOnly'))).toBeVisible();
    await expect(page.getByRole('main').getByRole('list').getByRole('link')).toHaveCount(0);
    await expect(page.locator('.app-shell__footer').getByRole('link', { name: t('admin.title') })).toHaveCount(0);
    await page.goto('/#/admin/bans');
    await expect(page.getByRole('main').locator('.back-link')).toHaveCount(0);
  }
});

test('the first hashes of the admin pages still open them and are replaced by the new ones', async ({ page }) => {
  await mockApi(page, { user: admin, answers });
  for (const [name, title] of pages) {
    await page.goto(`/#/${name}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: t(title) })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/admin/${name}$`));
  }
});
