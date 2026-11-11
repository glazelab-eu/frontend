import type { Locator } from '@playwright/test';
import { combination, glaze, glazeStep, imageInfo, stockItem } from '../../src/test/fixtures';
import { expectAccessible } from '../support/axe';
import { dictionaries, locales } from '../support/locales';
import { startsWith, t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { ExplorePage } from '../support/pages/explore';
import { expect, test } from '../support/test';

async function library(page: import('@playwright/test').Page) {
  await mockApi(page, {
    answers: {
      'GET /api/glazes': { json: [glaze({ id: 'g1', name: 'Blue glaze', tags: ['blue'] })] },
      'GET /api/stock': { json: [stockItem({ glazeId: 'g1', quantityG: 100, clubId: null })] },
      'GET /api/sync/combinations': {
        json: {
          combinations: [
            combination({ id: 'c1', title: 'Blue cup', cone: '6', atmosphere: 'OXIDATION', own: true, tags: ['blue'], steps: [glazeStep({ glazeId: 'g1' })] }),
          ],
          next: null,
        },
      },
    },
  });
}

test('All retains search and advanced conditions, while Clear filters resets the whole list and search', async ({ page, shell, isMobile }) => {
  await library(page);
  const explore = new ExplorePage(page);
  await shell.open('#/?type=combinations&q=Blue&tags=blue&glaze=g1&quick=mine&cone=6&atmosphere=oxidation&sort=az');
  await expect(explore.cards).toHaveCount(1);
  await explore.chip('discover.quick.all').click();
  await expect(page).not.toHaveURL(/quick=/);
  await expect(page).toHaveURL(/tags=blue&glaze=g1&cone=6&atmosphere=oxidation&sort=az/);
  await expect(page.getByText(t('discover.filters.allHint'), { exact: true })).toBeVisible();
  await expect(page.getByText(t('discover.filters.search', { query: 'Blue' }), { exact: false })).toBeVisible();
  if (isMobile) {
    await page.getByRole('button', { name: t('discover.filters.open', { count: 6 }), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('discover.filters.clear'), exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else {
    await page.getByRole('button', { name: t('discover.filters.clear'), exact: true }).click();
  }
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(explore.search).toHaveValue('');
  await expect(explore.search).toBeFocused();
  await expect(explore.sort).toHaveValue('newest');
  await expect(page.getByRole('button', { name: t('discover.filters.clear'), exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(explore.search).toHaveValue('Blue');
  await expect(explore.cards).toHaveCount(1);
});

test('the summary stays away from an unfiltered list and sits with its Clear filters button on a narrowed one', async ({ page, shell, isMobile }) => {
  await mockApi(page, {
    answers: {
      'GET /api/sync/combinations': {
        json: { combinations: [combination({ id: 'c1', title: 'Blue cup', own: true, images: [imageInfo({ id: 'i1' })] })], next: null },
      },
    },
  });
  await page.addInitScript((account) => localStorage.setItem(`glazelab:intro-dismissed:${account}`, '1'), MOCK_USER.id);
  const explore = new ExplorePage(page);
  const clear = page.getByRole('main').getByRole('button', { name: t('discover.filters.clear'), exact: true });
  const summary = page.getByText(t('discover.filters.summary', { type: t('discover.type.allTitle'), view: t('discover.quick.mine') }));

  await shell.open('#/?quick=mine');
  await expect(explore.cards).toHaveCount(1);
  const narrowed = await explore.cards.first().boundingBox();
  await expect(summary).toBeVisible();
  await expect(clear).toBeVisible();
  const row = (await summary.boundingBox())!;
  const button = (await clear.boundingBox())!;
  // One row: the text at the start, the small button at the end, room before the first card.
  expect(button.x).toBeGreaterThan(row.x + row.width - 1);
  expect(button.y).toBeLessThan(row.y + row.height);
  expect(button.y + button.height).toBeGreaterThan(row.y);
  expect(narrowed!.y - Math.max(button.y + button.height, row.y + row.height)).toBeGreaterThanOrEqual(12);
  expect(button.height).toBeGreaterThanOrEqual(isMobile ? 44 : 28);

  await clear.click();
  await expect(page).toHaveURL(/\/#\/$/);
  await expect(explore.search).toBeFocused();
  await expect(summary).toHaveCount(0);
  await expect(clear).toHaveCount(0);
  const unfiltered = await explore.cards.first().boundingBox();
  // The line and its button are gone, so the results start that much higher.
  expect(unfiltered!.y).toBeLessThan(narrowed!.y - button.height);
  if (isMobile) expect(unfiltered!.y).toBeLessThan(page.viewportSize()!.height - 120);

  // An order alone hides nothing: it stays in the link, without a summary or Clear filters.
  await explore.sort.selectOption('az');
  await expect(page).toHaveURL(/\/#\/\?sort=az$/);
  await expect(explore.sort).toHaveValue('az');
  await expect(explore.cards).toHaveCount(1);
  await expect(page.getByText(t('discover.filters.summary', { type: t('discover.type.allTitle'), view: t('discover.quick.all') }))).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('discover.filters.clear'), exact: true })).toHaveCount(0);
  expect((await explore.cards.first().boundingBox())!.y).toBeCloseTo(unfiltered!.y, 0);
});

test('removing a filter chip hands focus on instead of dropping it to the page', async ({ page, shell, isMobile }) => {
  await library(page);
  const main = page.getByRole('main');
  const chip = (scope: Locator, tag: string) => scope.getByRole('button', { name: t('discover.filter.removeTag', { tag }), exact: true });
  await shell.open('#/?quick=mine&tags=blue,red&glaze=g1');

  // To the chip that takes its place, then the chip before it, then the summary's button while something else still narrows the list.
  await chip(main, 'blue').click();
  await expect(chip(main, 'red')).toBeFocused();
  await chip(main, 'red').click();
  await expect(main.locator('.tag-list__remove')).toHaveCount(1);
  await expect(main.locator('.tag-list__remove')).toBeFocused();
  await main.locator('.tag-list__remove').click();
  await expect(main.getByRole('button', { name: t('discover.filters.clear'), exact: true })).toBeFocused();

  // Nothing narrows the list any more: the summary is gone too, so the filter control takes it (a press opens no keyboard on a phone).
  await shell.open('#/?tags=blue');
  await chip(main, 'blue').click();
  await expect(page).not.toHaveURL(/tags=/);
  if (isMobile) await expect(main.getByRole('button', { name: t('discover.filters.open', { count: 0 }), exact: true })).toBeFocused();
  else await expect(main.getByRole('textbox', { name: t('discover.search.label') })).toBeFocused();

  if (!isMobile) return;
  // In the sheet focus stays in the sheet.
  await shell.open('#/?tags=blue');
  await main.getByRole('button', { name: t('discover.filters.open', { count: 1 }), exact: true }).click();
  const sheet = page.getByRole('dialog');
  await chip(sheet, 'blue').click();
  await expect(page).not.toHaveURL(/tags=/);
  await expect(sheet.getByRole('button', { name: t('common.close'), exact: true })).toBeFocused();
});

test('type and firing changes explain discarded incompatible filters', async ({ page, shell, isMobile }) => {
  await library(page);
  const explore = new ExplorePage(page);
  await shell.open('#/?q=Blue&quick=mine&cone=6&atmosphere=oxidation');
  await explore.chip('discover.type.glazes').click();
  await expect(page).not.toHaveURL(/quick=|cone=|atmosphere=/);
  await expect(page.getByRole('status').filter({ hasText: 'No longer applied in this view:' })).toContainText('Mine');
  await expect(page.getByRole('status').filter({ hasText: 'No longer applied in this view:' })).toContainText(t('firing.line.cone', { cone: '6' }));
  await shell.open('#/?q=Blue&quick=shelf');
  if (isMobile) await page.getByRole('button', { name: t('discover.filters.open', { count: 2 }), exact: true }).click();
  await page.getByRole('combobox', { name: t('discover.filter.cone'), exact: true }).selectOption('6');
  if (isMobile)
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('discover.filters.results', { count: 1 }), exact: true })
      .click();
  await expect(page).toHaveURL(/cone=6/);
  await expect(page).not.toHaveURL(/quick=/);
  await expect(page.getByRole('status').filter({ hasText: 'No longer applied in this view:' })).toContainText(t('discover.quick.shelf'));
  await expect(explore.cards).toHaveCount(1);
  await page.goBack();
  await expect(explore.chip('discover.quick.shelf')).toHaveAttribute('aria-current', 'page');
});

for (const locale of locales) {
  test(`scope controls and summaries remain readable in ${locale}`, async ({ page }, testInfo) => {
    const text = dictionaries[locale];
    await page.addInitScript((language) => localStorage.setItem('glazelab:locale', language), locale);
    await library(page);
    await page.goto('/#/?quick=available&q=Blue');
    await expect(page.getByRole('link', { name: new RegExp(`^${text['discover.quick.available']} 1$`) })).toBeVisible();
    await expect(page.getByText(text['discover.quick.shelves'].replace('{shelves}', text['discover.quick.personalShelf']), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: text['discover.filters.clear'], exact: true })).toBeVisible();
    await expectAccessible(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`availability-${locale}.png`), fullPage: true });
  });
}

for (const width of [720, 1100]) {
  test(`filter summaries fit the ${width}px boundary`, async ({ page, shell, isMobile }, testInfo) => {
    test.skip(isMobile, 'intermediate widths use the desktop project');
    await page.setViewportSize({ width, height: 900 });
    await library(page);
    await shell.open('#/?q=Blue&tags=blue&quick=canMake&almost=1&cone=6');
    await expect(page.getByRole('heading', { name: 'Blue cup', exact: true })).toBeVisible();
    await expectAccessible(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`filters-${width}.png`), fullPage: true });
  });
}
