import type { Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { png } from '../support/images';
import { ExplorePage } from '../support/pages/explore';
import { expect, test } from '../support/test';

// 24-14: while the full-screen viewer is open the installed app's status bar (the `theme-color` meta tag) and the page ground behind it
// (the system navigation bar is tinted from it) are the viewer's dark colour; every way out gives the original back. Headless Chromium draws
// no system bars: this checks the meta content and the root's computed background, the bars themselves are confirmed on a phone.

const VIEWER_BG = 'rgb(16, 26, 22)';
const themeColor = (page: Page) => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content'));
const rootBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test('the viewer paints the status bar colour and the root dark, and every way out restores both', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Bars ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await api.uploadToCombination(id, { file: png('bars.png'), kind: 'TEST_TILE', caption: 'bars' });
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const cover = new ExplorePage(page).card(title).getByRole('button', { name: t('images.cover.open', { title }) });
  const dialog = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
  const close = dialog.getByRole('button', { name: t('common.close') });

  const original = await themeColor(page);
  expect(original).toMatch(/^#[0-9a-f]{6}$/);
  expect(original).not.toBe('#101a16');
  const pageBackground = await rootBackground(page);
  expect(pageBackground).not.toBe(VIEWER_BG);

  const ways = {
    escape: () => page.keyboard.press('Escape'),
    close: () => close.click(),
    ground: async () => {
      const box = (await dialog.locator('.viewer__frame:not(.viewer__frame--hidden) img').boundingBox())!;
      await page.mouse.click(box.x + 1, box.y + 1);
    },
    back: () => page.goBack(),
    route: () => page.evaluate(() => (location.hash = '#/stock')),
  };
  // Opening and closing again and again: the original comes back each time and is never replaced by the viewer's colour.
  for (const [name, leave] of Object.entries(ways)) {
    await cover.click();
    await expect(dialog, name).toBeVisible();
    expect(await themeColor(page), name).toBe('#101a16');
    await expect.poll(() => rootBackground(page), name).toBe(VIEWER_BG);
    await leave();
    await expect(dialog, name).toBeHidden();
    expect(await themeColor(page), name).toBe(original);
    if (name === 'route') break;
    await expect.poll(() => rootBackground(page), name).toBe(pageBackground);
  }
  // The route change left the page too: the ground is the page's again.
  await expect.poll(() => rootBackground(page)).toBe(pageBackground);
});
