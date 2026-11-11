import { expect, type Locator, type Page } from '@playwright/test';

/** The sticky header: its box now (a header slid away has its bottom edge at or above 0). */
export const headerBox = (page: Page) =>
  page.locator('.app-nav').evaluate((header) => {
    const { top, bottom, height } = header.getBoundingClientRect();
    return { top: Math.round(top * 10) / 10, bottom: Math.round(bottom * 10) / 10, height: Math.round(height * 10) / 10 };
  });

/** Whether the header is on screen (its bottom edge is below the top of the window). */
export const headerShown = async (page: Page) => (await headerBox(page)).bottom > 0.5;

/** The header's height whether or not it is slid away. */
export const headerHeight = async (page: Page) => (await headerBox(page)).height;

/** Scrolls the page to `y` and then a little further in the same direction, as a swipe would. */
export async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForFunction((to) => Math.abs(window.scrollY - to) < 2, y);
}

/** Scrolls by `delta` px (negative is up). */
export async function scrollBy(page: Page, delta: number): Promise<void> {
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate((by) => window.scrollBy(0, by), delta);
  await page.waitForFunction((to) => Math.abs(window.scrollY - to) < 2, before + delta);
}

/** The sticky column ends up the 1 rem gap below the visible part of the header (below 0 when the header is slid away). */
export async function expectStuckBelowHeader(page: Page, column: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const [header, box] = await Promise.all([headerBox(page), column.boundingBox()]);
      return box ? Math.round(box.y - Math.max(0, header.bottom)) : null;
    })
    .toBe(16);
}

/** Lets scroll events be handled and the header's 0.2 s slide end, before a test asserts that nothing moved. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300)))));
}
