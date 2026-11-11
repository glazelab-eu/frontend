import type { ImageDeletion, ImageReport } from '../../src/lib/api/models';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';

const admin = { ...MOCK_USER, siteAdmin: true };

test('the deletion log retains its rows after a failed next page and retries that page', async ({ page, uid }) => {
  const entry = (id: string): ImageDeletion => ({
    imageId: id,
    title: `Deleted ${uid} ${id}`,
    combinationId: null,
    glazeId: null,
    uploaderId: admin.id,
    deletedBy: admin.id,
    deletedAt: '2026-10-01T10:00:00Z',
    visibility: 'PUBLIC',
  });
  const requests: number[] = [];
  let failed = false;
  await mockApi(page, {
    user: admin,
    answers: {
      'GET /api/admin/image-deletions': async (route) => {
        const next = Number(new URL(route.request().url()).searchParams.get('page'));
        requests.push(next);
        if (next === 1 && !failed) {
          failed = true;
          return route.fulfill({ status: 500, json: { error: 'Log temporarily unavailable' } });
        }
        return route.fulfill({ json: { entries: next === 0 ? [entry('first')] : [entry('first'), entry('second')], hasMore: next === 0 } });
      },
    },
  });
  await page.goto('/#/admin/image-deletions');
  const main = page.getByRole('main');
  const rows = main.getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await main.getByRole('button', { name: t('images.log.more'), exact: true }).click();
  await expect(main.getByRole('alert')).toHaveText(t('errors.requestFailed'));
  await expect(rows).toHaveCount(1);
  await main.getByRole('button', { name: t('images.log.retry'), exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(`Deleted ${uid} second`);
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(main.getByRole('button', { name: t('images.log.more'), exact: true })).toHaveCount(0);
  expect(requests).toEqual([0, 1, 1]);
});

for (const failNext of [false, true]) {
  test(`dismissing a photo report ${failNext ? 'after a failed load retries' : 're-reads'} the shifted page without skipping or duplicating reports`, async ({
    page,
    uid,
  }) => {
    let reports: ImageReport[] = Array.from({ length: 51 }, (_, index) => ({
      id: `report-${index}`,
      imageId: `image-${index}`,
      title: `Reported ${uid} ${index}`,
      combinationId: 'combination',
      glazeId: null,
      reporter: 'Reporter',
      reason: 'Not a glaze test',
      visibility: 'PRIVATE',
      createdAt: '2026-10-01T10:00:00Z',
      uploaderId: null,
      uploader: null,
    }));
    const requests: number[] = [];
    await mockApi(page, {
      user: admin,
      answers: {
        'GET /api/admin/image-reports': async (route) => {
          const next = Number(new URL(route.request().url()).searchParams.get('page'));
          requests.push(next);
          if (failNext && next === 1) return route.fulfill({ status: 500, json: { error: 'Queue temporarily unavailable' } });
          return route.fulfill({ json: { entries: reports.slice(next * 50, (next + 1) * 50), hasMore: reports.length > (next + 1) * 50 } });
        },
        'POST /api/admin/image-reports/report-0/dismiss': async (route) => {
          reports = reports.slice(1);
          await route.fulfill({ status: 204 });
        },
      },
    });
    await page.goto('/#/admin/image-reports');
    const main = page.getByRole('main');
    const rows = main.getByRole('listitem');
    await expect(rows).toHaveCount(50);
    if (failNext) {
      await main.getByRole('button', { name: t('images.log.more'), exact: true }).click();
      await expect(main.getByRole('alert')).toHaveText(t('errors.requestFailed'));
    }
    const first = rows.filter({ has: page.getByText(`Reported ${uid} 0`, { exact: true }) });
    await first.getByRole('button', { name: t('images.reports.dismiss'), exact: true }).click();
    await expect(rows).toHaveCount(49);
    await main.getByRole('button', { name: t(failNext ? 'images.log.retry' : 'images.log.more'), exact: true }).click();
    await expect(rows).toHaveCount(50);
    await expect(main.getByText(`Reported ${uid} 0`, { exact: true })).toHaveCount(0);
    await expect(main.getByText(`Reported ${uid} 50`, { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: t('images.log.more'), exact: true })).toHaveCount(0);
    expect(requests).toEqual(failNext ? [0, 1, 0] : [0, 0]);
  });
}
