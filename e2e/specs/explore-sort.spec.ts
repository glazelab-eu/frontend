import { combination, glaze, imageInfo } from '../../src/test/fixtures';
import { expectAccessible } from '../support/axe';
import { photoPng } from '../support/images';
import { mockApi } from '../support/mock-api';
import { t } from '../support/i18n';
import { expect, test } from '../support/test';

test('defaults to newest, sorts by public favourite counts, and remembers sorting offline', async ({ page, shell }, testInfo) => {
  const picture = imageInfo({ id: 'sort-photo', width: 240, height: 240 });
  const glazes = [
    glaze({ id: 'older', name: 'Study older glaze', code: 'OLD', createdAt: '2026-01-01T00:00:00Z', images: [picture] }),
    glaze({ id: 'newer', name: 'Study newer glaze', code: 'NEW', createdAt: '2026-10-01T00:00:00Z' }),
  ];
  const combinations = [combination({ id: 'middle', title: 'Study combination', createdAt: '2026-05-01T00:00:00Z', images: [picture] })];
  await mockApi(page, {
    answers: {
      'GET /api/glazes': { json: glazes },
      'GET /api/sync/combinations': { json: { combinations, next: null } },
      'GET /api/favorites/counts': { json: { glazes: [{ id: 'older', count: 9 }], combinations: [{ id: 'middle', count: 4 }] } },
      'GET /api/images/sort-photo': (route) => route.fulfill({ contentType: 'image/png', body: photoPng('sort.png', 240, 240).buffer }),
      'GET /api/images/sort-photo/card': (route) => route.fulfill({ contentType: 'image/png', body: photoPng('sort.png', 240, 240).buffer }),
    },
  });
  await shell.open('#/?q=Study');
  const sort = page.getByRole('combobox', { name: t('discover.sort.label'), exact: true });
  const titles = page.locator('.paged-grid__item').getByRole('heading');
  await expect(sort).toHaveValue('newest');
  await expect(titles).toHaveText(['Study newer glaze', 'Study combination', 'Study older glaze']);
  await sort.selectOption('favourites');
  await expect(page).toHaveURL(/sort=favourites/);
  await expect(titles).toHaveText(['Study older glaze', 'Study combination', 'Study newer glaze']);
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('favourite-sort.png'), fullPage: true });
  await page.reload();
  await expect(sort).toHaveValue('favourites');
  await expect(titles).toHaveText(['Study older glaze', 'Study combination', 'Study newer glaze']);
  await page.route('**/api/**', (route) => route.abort());
  await page.reload();
  await expect(titles).toHaveText(['Study older glaze', 'Study combination', 'Study newer glaze']);
  await sort.selectOption('az');
  await expect(titles).toHaveText(['Study newer glaze', 'Study older glaze', 'Study combination']);
  await sort.selectOption('newest');
  await expect(titles).toHaveText(['Study newer glaze', 'Study combination', 'Study older glaze']);
});
