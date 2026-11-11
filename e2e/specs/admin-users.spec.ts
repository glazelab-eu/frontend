import { expectAccessible } from '../support/axe';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';

const admin = { ...MOCK_USER, siteAdmin: true };
const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  displayName: `Account ${String(n).padStart(2, '0')}`,
  email: `account${n}@example.test`,
  status: n === 2 ? 'PENDING' : 'ACTIVE',
  siteAdmin: n === 1,
});

/**
 * The site admins' account list (mocked: paging needs more than 50 accounts): name, email, status and site-admin badge per row,
 * a second page on demand, the guard text for plain accounts, and the page is accessible at desktop and phone width.
 */
test('the Accounts page lists accounts in pages with status and admin badge, linked from the Administration page @smoke', async ({ page }) => {
  const pages: string[] = [];
  await mockApi(page, {
    user: admin,
    answers: {
      'GET /api/admin/users': async (route) => {
        const requested = new URL(route.request().url()).searchParams.get('page') ?? '0';
        pages.push(requested);
        const entries = requested === '0' ? [row(1), row(2), row(3)] : [row(4)];
        await route.fulfill({ json: { entries, hasMore: requested === '0' } });
      },
    },
  });
  await page.goto('/#/admin');
  const main = page.getByRole('main');
  const link = main.getByRole('link', { name: new RegExp(`^${t('users.title')}`) });
  await expect(link).toHaveAttribute('href', '#/admin/users');
  await link.click();
  await expect(page).toHaveURL(/#\/admin\/users$/);
  await expect(main.getByRole('heading', { level: 1, name: t('users.title') })).toBeVisible();
  const list = main.getByRole('list', { name: t('users.list') });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  const first = list.getByRole('listitem').nth(0);
  await expect(first).toContainText('Account 01');
  await expect(first).toContainText(t('users.status.ACTIVE'));
  await expect(first).toContainText(t('users.admin'));
  await expect(list.getByRole('listitem').nth(1)).toContainText(t('users.status.PENDING'));
  await expect(list.getByRole('listitem').nth(2)).not.toContainText(t('users.admin'));
  await expect(first.getByText('account1@example.test')).toBeVisible();
  await expect(list.getByRole('listitem').nth(1).getByText('account2@example.test')).toBeVisible();
  await expectAccessible(page);
  await main.getByRole('button', { name: t('users.more') }).click();
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(main.getByRole('button', { name: t('users.more') })).toHaveCount(0);
  expect(pages).toEqual(['0', '1']);
  await main.locator('.back-link').click();
  await expect(page).toHaveURL(/#\/admin$/);
});

test('a plain account and a guest see only the guard text and no request is sent', async ({ page }) => {
  let requests = 0;
  for (const user of [MOCK_USER, null]) {
    await mockApi(page, {
      user,
      answers: { 'GET /api/admin/users': async (route) => (requests++, route.fulfill({ json: { entries: [], hasMore: false } })) },
    });
    await page.goto('/#/admin/users');
    await expect(page.getByRole('main').getByText(t('users.adminOnly'))).toBeVisible();
    await expect(page.getByRole('main').getByRole('list')).toHaveCount(0);
  }
  expect(requests).toBe(0);
});

/** Search (mocked answers filter like the API) and the registration day: shown when the API sends one, nothing when it is null. */
test('the Accounts page searches by name or email, says when nothing matches and shows the registration day only when known', async ({ page }) => {
  const queries: Array<string | null> = [];
  const dated = { ...row(1), createdAt: '2026-10-03T10:00:00Z' };
  const undated = { ...row(2), createdAt: null };
  await mockApi(page, {
    user: admin,
    answers: {
      'GET /api/admin/users': async (route) => {
        const q = new URL(route.request().url()).searchParams.get('q');
        queries.push(q);
        const entries = [dated, undated].filter((r) => !q || `${r.displayName} ${r.email}`.toLowerCase().includes(q.toLowerCase()));
        await route.fulfill({ json: { entries, hasMore: false } });
      },
    },
  });
  await page.goto('/#/admin/users');
  const main = page.getByRole('main');
  const list = main.getByRole('list', { name: t('users.list') });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(dated.createdAt));
  await expect(list.getByRole('listitem').nth(0)).toContainText(t('users.created', { date: day }));
  await expect(list.getByRole('listitem').nth(1)).not.toContainText('Registered');
  const field = main.getByRole('search').getByLabel(t('users.search'));
  await expectAccessible(page);
  await field.fill('ACCOUNT2@');
  await main.getByRole('button', { name: t('users.searchButton'), exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('listitem').first()).toContainText('account2@example.test');
  await field.fill('nobody-matches');
  await field.press('Enter');
  await expect(main.getByText(t('users.emptySearch'))).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await expectAccessible(page);
  await main.getByRole('button', { name: t('users.searchClear') }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(field).toHaveValue('');
  expect(queries).toEqual([null, 'ACCOUNT2@', 'nobody-matches', null]);
});
