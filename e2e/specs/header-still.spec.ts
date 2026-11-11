import type { Page } from '@playwright/test';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';
import { locales } from '../support/locales';

/**
 * The wide header's entries stay where they are when the offline icon or the buddy request count (the activity bell's badge, FEED-1)
 * appears (26-3), in every language, and the header keeps its height with the 48-letter name, the icon, the bell and its count (26-4): one row from 1120 px up (the entries have
 * their own row below that, so the height is the same two rows), never taller than without them.
 */
const WIDTHS = [720, 721, 1099, 1100, 1120, 1280, 1440, 1920];
const LONG_NAME = 'Annabelle-Katharina von Hohenzollern-Sigmaringen';

const headerHeight = (page: Page) => page.locator('.app-nav').evaluate((header) => Math.round(header.getBoundingClientRect().height * 10) / 10);
/**
 * Nothing in the account area overlaps its neighbour or the entries, and it ends inside the header: a name that kept its width, or an
 * area squeezed below its content, would push items over each other. Returns the first problem, or null.
 */
const accountOverlap = (page: Page) =>
  page.locator('.app-nav').evaluate((header) => {
    const rect = (element: Element) => element.getBoundingClientRect();
    const links = rect(header.querySelector('.app-nav__links')!);
    const brand = rect(header.querySelector('.app-nav__brand')!);
    const innerBox = header.querySelector('.app-nav__inner')!;
    const inner = { right: rect(innerBox).right - parseFloat(getComputedStyle(innerBox).paddingRight) };
    let edge = links.y < brand.y + brand.height ? links.right : brand.right;
    const items = [
      ...header.querySelectorAll(
        '.header-account > select, .header-account > button, .header-account > a, .header-account__identity:not(.header-account__hidden) > *',
      ),
    ]
      .filter((item) => rect(item).width > 0)
      .sort((a, b) => rect(a).left - rect(b).left);
    for (const item of items) {
      if (rect(item).left < edge - 0.5) return `${item.className || item.tagName} starts at ${rect(item).left}, before ${edge}`;
      edge = rect(item).right;
    }
    return edge <= inner.right + 0.5 ? null : `the account area ends at ${edge}, after ${inner.right}`;
  });
const linkXs = (page: Page) => page.locator('.app-nav__link').evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().x * 10) / 10));

/** Where every visible control of the account area (but the offline icon) is, so that its appearing moves none of them (26-6). */
const accountItems = (page: Page) =>
  page.locator('.app-nav').evaluate((header) =>
    [...header.querySelectorAll('.header-account select, .header-account__install, .feed-bell, .header-account__name, .header-account__button')]
      .filter((item) => getComputedStyle(item).visibility === 'visible')
      .map((item) => {
        const { x, width } = item.getBoundingClientRect();
        return [item.className.split(' ')[0], Math.round(x * 10) / 10, Math.round(width * 10) / 10] as [string, number, number];
      }),
  );
type Item = Awaited<ReturnType<typeof accountItems>>[number];
/**
 * The icon appearing moves no control of the account area. Where the row is exhausted (the 1120-1190 px band in German and Portuguese
 * with a 48-letter name) the name, which is built to give way (`flex: 0 1 6rem`), narrows by what the icon takes, from its left side:
 * then it keeps its right edge and stays at least 2.5 rem wide, and what lies right of it (Sign out) is where it was.
 */
function expectStill(before: Item[], after: Item[], label: string): void {
  const name = (items: Item[]) => items.find((item) => item[0] === 'header-account__name')!;
  const rightOf = (items: Item[]) => items.slice(items.indexOf(name(items)));
  if (name(before)[2] === name(after)[2]) return expect(after, label).toEqual(before);
  expect(name(after)[2], `${label}: the name only gives way`).toBeLessThan(name(before)[2]);
  expect(name(after)[2], `${label}: the name keeps a minimum`).toBeGreaterThanOrEqual(40);
  expect(
    rightOf(after).map(([cls, x, width]) => [cls, Math.round((x + width) * 10) / 10]),
    label,
  ).toEqual(rightOf(before).map(([cls, x, width]) => [cls, Math.round((x + width) * 10) / 10]));
}

for (const locale of locales) {
  test(`the nav links keep their x position when the offline icon and the request line appear (${locale}) @smoke`, async ({
    page,
    shell,
    context,
    isMobile,
  }) => {
    test.skip(isMobile, 'phones have a bottom navigation');
    test.setTimeout(120_000);
    let requests = 0;
    await page.addInitScript((value) => localStorage.setItem('glazelab:locale', value), locale);
    await mockApi(page, {
      user: { ...MOCK_USER, displayName: LONG_NAME },
      answers: {
        'GET /api/buddies': async (route) => {
          const incoming = Array.from({ length: requests }, (_, index) => ({
            displayName: `Bo${index}`,
            id: `00000000-0000-4000-8000-00000000010${index}`,
            since: '2026-10-31T10:00:00Z',
            avatarId: null,
          }));
          await route.fulfill({ json: { buddies: [], incoming, outgoing: [], hasLink: false } });
        },
      },
    });
    for (const width of WIDTHS) {
      requests = 0;
      await page.setViewportSize({ width, height: 800 });
      await context.setOffline(false);
      await page.goto('/#/');
      await page.reload();
      await expect(page.locator('.header-account__name')).toBeVisible();
      const base = await linkXs(page);
      expect(base.length).toBe(4);
      const height = await headerHeight(page);
      if (width >= 1120) expect(height, `${locale} ${width}: one row`).toBeLessThan(90);

      const pill = shell.header.locator('[data-offline-icon]');
      const items = await accountItems(page);
      expect(items.length).toBeGreaterThanOrEqual(3);
      await context.setOffline(true);
      await expect(pill).toBeVisible({ timeout: 2000 });
      expectStill(items, await accountItems(page), `${locale} ${width}: account controls with the offline icon`);
      expect(await linkXs(page), `${locale} ${width}: offline icon`).toEqual(base);
      expect(await headerHeight(page), `${locale} ${width}: height with the offline icon`).toBe(height);

      requests = 1;
      await context.setOffline(false);
      await expect(pill).toBeHidden();
      // The request count is the activity bell's badge (FEED-1; the bell stands there from the start, so nothing moves).
      const line = shell.header.locator('.feed-bell');
      await expect(line).toHaveText('1');
      expect(await linkXs(page), `${locale} ${width}: request line`).toEqual(base);
      expect(await headerHeight(page), `${locale} ${width}: height with the request line`).toBe(height);
      // The visible text is the count; the accessible name is the sentence (in the page's language) and contains it.
      await expect(line).toHaveText('1');
      await expect(line).toHaveAccessibleName(/\b1\b.{6,}/);

      const withLine = await accountItems(page);
      await context.setOffline(true);
      await expect(pill).toBeVisible({ timeout: 2000 });
      expectStill(withLine, await accountItems(page), `${locale} ${width}: account controls with the line and the icon`);
      expect(await linkXs(page), `${locale} ${width}: both`).toEqual(base);
      expect(await headerHeight(page), `${locale} ${width}: height with both`).toBe(height);
      expect(await accountOverlap(page), `${locale} ${width}: account area`).toBeNull();
      await context.setOffline(false);
    }
  });
}

/** The phone's top bar (26-6): the icon takes the room left of the install and account controls, the brand and the controls stay, and the bar stays one row. */
for (const locale of locales) {
  test(`the phone top bar keeps its row and its items where they are when the offline icon appears (${locale})`, async ({ page, context, isMobile }) => {
    test.skip(!isMobile, 'the top bar is the phone header');
    test.setTimeout(90_000);
    await page.addInitScript((value) => localStorage.setItem('glazelab:locale', value), locale);
    await mockApi(page, { user: { ...MOCK_USER, displayName: LONG_NAME } });
    const boxes = () =>
      page.locator('.app-nav').evaluate((header) => {
        const box = (selector: string) => {
          const { x, y, width, height } = (header.querySelector(selector) ?? header.querySelector('.account-menu__button')!).getBoundingClientRect();
          return [x, y, width, height].map((value) => Math.round(value * 10) / 10);
        };
        return { header: box('.app-nav'), brand: box('.app-nav__brand'), install: box('.header-account__install'), account: box('.account-menu__button') };
      });
    for (const width of [320, 360, 390, 430, 719]) {
      await page.setViewportSize({ width, height: 800 });
      await context.setOffline(false);
      await page.goto('/#/');
      await page.reload();
      await expect(page.locator('.account-menu__button')).toBeVisible();
      const before = await boxes();
      await context.setOffline(true);
      const icon = page.locator('[data-offline-icon]');
      await expect(icon).toBeVisible({ timeout: 2000 });
      expect(await boxes(), `${locale} ${width}: nothing moved`).toEqual(before);
      const [button, brand, install] = [await icon.boundingBox(), before.brand, before.install];
      expect(button!.x, `${locale} ${width}: right of the brand`).toBeGreaterThanOrEqual(brand[0] + brand[2]);
      expect(button!.x + button!.width, `${locale} ${width}: left of the install icon`).toBeLessThanOrEqual(install[0]);
      expect(button!.y, `${locale} ${width}: in the row`).toBeGreaterThanOrEqual(before.header[1]);
      expect(button!.y + button!.height).toBeLessThanOrEqual(before.header[1] + before.header[3]);
      expect(button!.width).toBeGreaterThanOrEqual(44);
      expect(button!.height).toBeGreaterThanOrEqual(44);
      await context.setOffline(false);
      await expect(icon).toBeHidden();
    }
  });
}
