import { combination, glaze, imageInfo } from '../../src/test/fixtures';
import { expectAccessible } from '../support/axe';
import { photoPng } from '../support/images';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { t } from '../support/i18n';
import { expect, test } from '../support/test';

async function library(page: import('@playwright/test').Page, options: { guest?: boolean; emptyPhotos?: boolean } = {}) {
  const picture = imageInfo({ id: 'photo', width: 240, height: 240 });
  const glazes = [
    glaze({ id: 'pictured-glaze', name: 'Pictured glaze', images: options.emptyPhotos ? [] : [picture] }),
    glaze({ id: 'missing-glaze', name: 'Unpictured glaze' }),
    glaze({ id: 'packaging-glaze', name: 'Packaging only', images: [{ ...picture, kind: 'PACKAGING' }] }),
  ];
  const combinations = [
    ...Array.from({ length: options.emptyPhotos ? 0 : 13 }, (_, index) =>
      combination({ id: `pictured-${index}`, title: `Pictured combination ${index}`, images: [picture] }),
    ),
    combination({
      id: 'missing-combination',
      title: 'Unpictured combination',
      own: true,
      authorId: '00000000-0000-4000-8000-000000000001',
      createdAt: '2026-11-01T00:00:00Z',
    }),
  ];
  await mockApi(page, {
    ...(options.guest ? { user: null } : {}),
    answers: {
      'GET /api/glazes': { json: glazes },
      'GET /api/sync/combinations': { json: { combinations, next: null } },
      'GET /api/images/photo': (route) => route.fulfill({ contentType: 'image/png', body: photoPng('tile.png', 240, 240).buffer }),
      'GET /api/images/photo/card': (route) => route.fulfill({ contentType: 'image/png', body: photoPng('tile.png', 240, 240).buffer }),
    },
  });
}

for (const guest of [false, true]) {
  test(`picture-free items wait until the pictured pages finish, then reveal and survive Back/reload (${guest ? 'guest' : 'member'})`, async ({
    page,
    shell,
    isMobile,
  }) => {
    if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
    // Exercise the explicit paging fallback as well as the final reveal, without viewport prefetch timing.
    await page.addInitScript(() => {
      delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    });
    await library(page, { guest });
    await shell.open('#/?sort=newest');
    const cards = page.locator('.paged-grid__item');
    const reveal = page.getByRole('button', { name: t('discover.withoutPhotos.load'), exact: true });
    await expect(cards).toHaveCount(12);
    await expect(page.getByText(t('discover.filters.photoCounts', { shown: 14, hidden: 3 }), { exact: true })).toBeVisible();
    await expect(reveal).toHaveCount(0);
    await page.getByRole('button', { name: t('common.showMore'), exact: true }).click();
    await expect(cards).toHaveCount(14);
    await expect(page.getByRole('link', { name: 'Unpictured combination', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Unpictured glaze', exact: true })).toHaveCount(0);
    await expect(reveal).toBeVisible();
    await expectAccessible(page);
    await reveal.click();
    await expect(cards).toHaveCount(17);
    const missing = page.getByRole('link', { name: 'Unpictured combination', exact: true });
    await expect(missing).toBeFocused();
    await expect(reveal).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Packaging only', exact: true })).toBeVisible();
    await missing.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Unpictured combination', exact: true })).toBeVisible();
    await page.goBack();
    await expect(missing).toBeInViewport();
    await expect(cards).toHaveCount(17);
    await page.reload();
    await expect(cards).toHaveCount(17);
    await expect(reveal).toHaveCount(0);
  });
}

test('search immediately includes picture-free glazes and combinations; clearing it restores picture-first browsing', async ({ page, shell }) => {
  await library(page);
  await shell.open('#/?sort=newest');
  const search = page.getByRole('textbox', { name: t('discover.search.label'), exact: true });
  await search.fill('Unpictured');
  await expect(page.getByRole('link', { name: 'Unpictured glaze', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Unpictured combination', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: t('discover.withoutPhotos.load'), exact: true })).toHaveCount(0);
  await search.fill('');
  await expect(page.getByRole('link', { name: 'Unpictured glaze', exact: true })).toHaveCount(0);
});

test('an entirely picture-free library offers reveal immediately, and Mine/Waiting keep their complete lists', async ({ page, shell }) => {
  await library(page, { emptyPhotos: true });
  await shell.open('#/?sort=newest');
  const reveal = page.getByRole('button', { name: t('discover.withoutPhotos.load'), exact: true });
  await expect(reveal).toBeVisible();
  await expect(page.getByText(t('discover.filters.photoCounts', { shown: 0, hidden: 4 }), { exact: true })).toBeVisible();
  await expect(page.locator('.paged-grid__item')).toHaveCount(0);
  await reveal.click();
  await expect(page.locator('.paged-grid__item')).toHaveCount(4);
  await page.goto('/#/?quick=mine');
  await expect(page.getByRole('link', { name: 'Unpictured combination', exact: true })).toBeVisible();
  await expect(reveal).toHaveCount(0);
  await page.goto('/#/?quick=waiting');
  await expect(page.getByRole('link', { name: 'Unpictured combination', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Unpictured glaze', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Packaging only', exact: true })).toBeVisible();
  await page.goto('/#/?type=glazes&quick=waiting');
  await expect(page.getByRole('link', { name: 'Unpictured glaze', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Unpictured combination', exact: true })).toHaveCount(0);
});

test('a returning maker with photos to add opens Explore unfiltered', async ({ page, shell }) => {
  await page.addInitScript((account) => localStorage.setItem(`glazelab:intro-dismissed:${account}`, '1'), MOCK_USER.id);
  await library(page);
  await shell.open('#/');
  const pictured = page.getByRole('link', { name: 'Pictured combination 0', exact: true });
  await expect(pictured).toBeVisible();
  // A default view would replace the link right after the load settles.
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#\/$/);
  await expect(pictured).toBeVisible();
});

test('Studio lists glaze photo tasks and opens the glaze upload dialog', async ({ page, shell, isMobile }, testInfo) => {
  await library(page);
  await shell.open('#/studio');
  if (isMobile) await page.getByRole('button', { name: new RegExp(t('discover.quick.waiting')) }).click();
  const list = page.getByRole('list', { name: t('discover.quick.waiting') });
  const glaze = list.getByRole('link', { name: /Unpictured glaze/ });
  await expect(glaze).toHaveAttribute('href', '#/glazes/missing-glaze');
  await expect(list.getByRole('link', { name: /Packaging only/ })).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('glaze-photo-tasks.png'), fullPage: true });
  await list.getByRole('listitem').filter({ hasText: 'Unpictured glaze' }).getByRole('button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Unpictured glaze');
});

test('automatic paging reaches the picture-free offer, which also works offline', async ({ page, shell, context, isMobile }) => {
  test.skip(!isMobile, 'the phone keeps the second pictured page below the prefetch area');
  await page.setViewportSize({ width: 375, height: 812 });
  await library(page);
  await shell.open('#/?sort=newest');
  const cards = page.locator('.paged-grid__item');
  await expect(cards).toHaveCount(12);
  const reveal = page.getByRole('button', { name: t('discover.withoutPhotos.load'), exact: true });
  await expect(reveal).toHaveCount(0);
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards).toHaveCount(14);
  await reveal.scrollIntoViewIfNeeded();
  await context.setOffline(true);
  await expect(reveal).toBeEnabled();
  await reveal.click();
  await expect(page.getByRole('link', { name: 'Unpictured combination', exact: true })).toBeVisible();
  await expect(cards).toHaveCount(17);
});
