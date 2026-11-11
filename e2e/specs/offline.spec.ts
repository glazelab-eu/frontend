import type { Page } from '@playwright/test';
import { headerBox, headerShown, scrollBy, scrollTo, settled } from '../support/header';
import { t } from '../support/i18n';
import { dictionaries } from '../support/locales';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { DIST } from '../support/paths';
import { expect, test } from '../support/test';
import { startWebServer, type WebServer } from '../support/web-server';

/** The API is unreachable for the first `failing` requests (a connection that is still waking), or until `reachable` is set. */
async function unreachableApi(page: Page, { failing = Infinity } = {}) {
  const api = { failed: 0, meRequests: 0, failing };
  await mockApi(page);
  // Registered after `mockApi`, so it runs first: an unreachable request never reaches the mocked answers.
  await page.route('**/api/**', async (route) => {
    if (route.request().url().endsWith('/api/auth/me')) api.meRequests++;
    if (api.failed < api.failing) {
      api.failed++;
      await route.abort('connectionrefused');
    } else await route.fallback();
  });
  return {
    api,
    /** The API answers from now on. */
    reachable: () => {
      api.failing = 0;
    },
  };
}

/** Records whether the offline icon or the offline toast was in the page at any moment, not only at the end of the test. */
async function watchOfflineSigns(page: Page) {
  await page.addInitScript((text: string) => {
    const seen = () => !!document.querySelector('[data-offline-icon]') || !!document.body?.innerText.includes(text);
    new MutationObserver(() => {
      if (seen()) (window as unknown as { sawOffline: boolean }).sawOffline = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, t('app.offlineToast'));
  return () => page.evaluate(() => (window as unknown as { sawOffline?: boolean }).sawOffline === true);
}

/** The one offline indicator: a button in the header, shown only while offline. */
const icon = (page: Page) => page.getByRole('banner').getByRole('button', { name: t('header.offline') });
/** The toast the icon opens. */
const toast = (page: Page) => page.getByRole('status').getByText(t('app.offlineToast'));
/** The text of the page's old banner, which must be gone. */
const banner = (page: Page) => page.getByText('The server is unreachable');
/** The top edge of the page's first heading: what moved when the old banner pushed the content down. */
const headingTop = (page: Page) =>
  page
    .locator('main h1, main h2')
    .first()
    .evaluate((heading) => Math.round(heading.getBoundingClientRect().top * 10) / 10);

test('a first request that fails while the network wakes shows no offline warning @smoke', async ({ page, shell }) => {
  const sawOffline = await watchOfflineSigns(page);
  const { api } = await unreachableApi(page, { failing: 1 });
  await page.goto('/#/');
  await shell.expectSignedIn(MOCK_USER.displayName);
  expect(api.meRequests).toBe(2);
  await expect(icon(page)).toHaveCount(0);
  expect(await sawOffline()).toBe(false);
});

test('an API that stays unreachable shows the icon after the grace period and the silent retry, and no toast by itself', async ({ page }) => {
  const { api } = await unreachableApi(page);
  await page.goto('/#/');
  await expect(icon(page)).toHaveCount(0);
  await expect(icon(page)).toBeVisible();
  expect(api.meRequests).toBe(2);
  // The person asks for the toast; it never comes by itself, not even later.
  await page.waitForTimeout(1500);
  // Counted at once (an auto-retrying assertion would outwait a toast that dismisses itself).
  expect(await toast(page).count()).toBe(0);
  expect(await banner(page).count()).toBe(0);
});

test('a device that reports itself offline warns at once, without waiting', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  const { api } = await unreachableApi(page);
  await page.goto('/#/');
  // The silent retry would take two seconds: a device that knows it is offline gets no grace.
  await expect(icon(page)).toBeVisible({ timeout: 1000 });
  expect(api.meRequests).toBe(0);
});

test('the offline and online events warn at once and recover', async ({ page, shell, context }) => {
  await mockApi(page);
  await shell.open();
  await shell.expectSignedIn(MOCK_USER.displayName);
  await expect(icon(page)).toHaveCount(0);

  await context.setOffline(true);
  await expect(icon(page)).toBeVisible({ timeout: 1000 });
  await context.setOffline(false);
  await expect(icon(page)).toBeHidden();
  await shell.expectSignedIn(MOCK_USER.displayName);
});

test('a failure inside the grace window announces nothing, neither Offline nor Back online', async ({ page, shell }) => {
  await unreachableApi(page, { failing: 1 });
  await page.goto('/#/');
  await shell.expectSignedIn(MOCK_USER.displayName);
  await expect(shell.header.locator('[role=status]')).toHaveText('');
  await page.waitForTimeout(500);
  await expect(shell.header.locator('[role=status]')).toHaveText('');
});

test('the header says nothing while connected; the offline icon appears without moving anything and nothing in the page moves @smoke', async ({
  page,
  shell,
  context,
  isMobile,
}) => {
  await mockApi(page);
  await shell.open();
  await shell.expectSignedIn(MOCK_USER.displayName);
  // No dot and no "Online" word: only a problem is shown.
  await expect(shell.header.getByText(/^online$/i)).toHaveCount(0);
  await expect(icon(page)).toHaveCount(0);
  const status = shell.header.locator('[role=status]');
  await expect(status).toHaveText('');
  const positions = () =>
    page.evaluate(() => {
      const box = (selector: string) =>
        [...document.querySelectorAll(selector)]
          .map((node) => node.getBoundingClientRect())
          .map(({ x, y, width, height }) => [x, y, width, height].map((v) => Math.round(v * 10) / 10));
      return {
        header: box('.app-nav'),
        brand: box('.app-nav__brand'),
        links: box('.app-nav__link'),
        install: box('.header-account__install'),
        language: box('.header-account select'),
        account: box('.header-account__name, .header-account__button, .account-menu__button'),
        bottomNav: box('.bottom-nav'),
      };
    });
  const before = await positions();
  const headingBefore = await headingTop(page);

  await context.setOffline(true);
  await expect(icon(page)).toBeVisible({ timeout: 1000 });
  // A shape, not colour alone; a real button that is 44 px square on touch; screen readers hear the status text.
  await expect(icon(page).locator('svg')).toBeVisible();
  const size = await icon(page).evaluate((button) => button.getBoundingClientRect().height);
  expect(size).toBeGreaterThanOrEqual(isMobile ? 44 : 32);
  await expect(status).toHaveText(t('header.offline'));
  // Nothing else moved: not the brand, the entries, the install icon, the language select or the account control, nor the header's size,
  // and nothing in the page (the old banner pushed the first heading down by 64 px on a laptop and 172 px on a phone).
  expect(await positions()).toEqual(before);
  expect(await headingTop(page)).toBe(headingBefore);
  await expect(banner(page)).toHaveCount(0);
  expect(await toast(page).count()).toBe(0);

  await context.setOffline(false);
  await expect(icon(page)).toBeHidden();
  expect(await positions()).toEqual(before);
  expect(await headingTop(page)).toBe(headingBefore);
  // Screen readers only: the live region says so for a few seconds, then it is empty again, and nothing of it is visible.
  await expect(status).toHaveText(t('header.backOnline'));
  expect(await status.locator('.header-account__announce').evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  await expect(status).toHaveText('', { timeout: 8000 });
});

for (const hash of ['#/', '#/studio', '#/account']) {
  test(`the first heading stays put when the connection drops and returns (${hash})`, async ({ page, shell, context }) => {
    await mockApi(page);
    await shell.open(hash);
    await shell.expectSignedIn(MOCK_USER.displayName);
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
    const before = await headingTop(page);
    await context.setOffline(true);
    await expect(icon(page)).toBeVisible({ timeout: 1000 });
    expect(await headingTop(page)).toBe(before);
    await context.setOffline(false);
    await expect(icon(page)).toBeHidden();
    expect(await headingTop(page)).toBe(before);
  });
}

test('activating the icon shows the toast with Try again; Escape and the close button dismiss it and return focus to the icon', async ({
  page,
  shell,
  context,
}) => {
  await mockApi(page);
  await shell.open();
  await shell.expectSignedIn(MOCK_USER.displayName);
  await context.setOffline(true);
  await expect(icon(page)).toBeVisible({ timeout: 1000 });
  expect(await toast(page).count()).toBe(0);

  await icon(page).click();
  await expect(toast(page)).toBeVisible();
  await expect(page.getByRole('status').getByRole('button', { name: t('common.tryAgain') })).toBeEnabled();
  // One toast, however often the icon is activated.
  await icon(page).click();
  await expect(toast(page)).toHaveCount(1);

  await page
    .getByRole('status')
    .getByRole('button', { name: t('app.dismissNotice') })
    .click();
  await expect(toast(page)).toHaveCount(0);
  await expect(icon(page)).toBeFocused();

  // The keyboard works too: Enter on the icon, Tab to the toast, Escape inside it.
  await icon(page).focus();
  await page.keyboard.press('Enter');
  await expect(toast(page)).toBeVisible();
  await page
    .getByRole('status')
    .getByRole('button', { name: t('common.tryAgain') })
    .focus();
  await page.keyboard.press('Escape');
  await expect(toast(page)).toHaveCount(0);
  await expect(icon(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toast(page)).toBeVisible();
});

test('the toast goes away by itself after a while, and stays while the pointer or focus is on it', async ({ page, isMobile }) => {
  await page.clock.install();
  // An unreachable server (the health poll would find a mocked one even with the context offline).
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await unreachableApi(page);
  await page.goto('/#/');
  await expect(icon(page)).toBeVisible();
  await icon(page).click();
  await expect(toast(page)).toBeVisible();
  await page.clock.fastForward(7000);
  await expect(toast(page)).toBeVisible();
  await page.clock.fastForward(1500);
  await expect(toast(page)).toHaveCount(0);

  // Focus on its button holds it past the time; leaving lets it go.
  await icon(page).click();
  const retry = page.getByRole('status').getByRole('button', { name: t('common.tryAgain') });
  await retry.focus();
  await page.clock.fastForward(30_000);
  await expect(toast(page)).toBeVisible();
  await icon(page).focus();
  await page.clock.fastForward(8500);
  await expect(toast(page)).toHaveCount(0);
  if (!isMobile) {
    await icon(page).click();
    await toast(page).hover();
    await page.clock.fastForward(30_000);
    await expect(toast(page)).toBeVisible();
    // Focus leaving the toast while the pointer is still on it does not start the clock.
    await retry.focus();
    await icon(page).focus();
    await page.clock.fastForward(30_000);
    await expect(toast(page)).toBeVisible();
    await page.mouse.move(5, 5);
    await page.clock.fastForward(8500);
    await expect(toast(page)).toHaveCount(0);
  }
});

test('Try again in the toast asks the server again, and the icon and the toast go when it answers', async ({ page, shell }) => {
  const { api, reachable } = await unreachableApi(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await page.goto('/#/');
  await expect(icon(page)).toBeVisible();
  await icon(page).click();
  await expect(toast(page)).toBeVisible();
  const asked = api.meRequests;
  // Still unreachable: the request is made, the answer is the same, the toast may stay.
  await page
    .getByRole('status')
    .getByRole('button', { name: t('common.tryAgain') })
    .click();
  await expect.poll(() => api.meRequests).toBeGreaterThan(asked);
  reachable();
  await expect(icon(page)).toBeVisible();
  await icon(page).click();
  await page
    .getByRole('status')
    .getByRole('button', { name: t('common.tryAgain') })
    .click();
  await expect(icon(page)).toBeHidden();
  await expect(toast(page)).toHaveCount(0);
  await shell.expectSignedIn(MOCK_USER.displayName);
});

for (const [locale, messages] of Object.entries(dictionaries)) {
  const text = messages['app.offlineToast'];
  test(`the toast says its text in ${locale}`, async ({ page, context }) => {
    await page.addInitScript((value) => localStorage.setItem('glazelab:locale', value), locale);
    await mockApi(page);
    await page.goto('/#/');
    await expect(page.locator('.header-account__name, .account-menu__button')).toBeVisible();
    await context.setOffline(true);
    await page.locator('[data-offline-icon]').click();
    await expect(page.getByRole('status').getByText(text, { exact: true })).toBeVisible();
    await expect(page.locator('[data-offline-icon]')).toHaveAccessibleName(messages['header.offline']);
  });
}

test('the toast fades in, and does not move when the person prefers reduced motion', async ({ page, shell, context }) => {
  const animation = () => page.locator('.app-shell__toast--offline').evaluate((node) => getComputedStyle(node).animationName);
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await shell.open();
  await context.setOffline(true);
  await icon(page).click();
  await expect(toast(page)).toBeVisible();
  expect(await animation()).toMatch(/toast-in/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await animation()).toBe('none');
});

test('on a phone the icon is part of the header: it slides away and returns with it, and one row stays one row', async ({ page, shell, context, isMobile }) => {
  test.skip(!isMobile, 'the header slides away on phones');
  await mockApi(page);
  await shell.open('#/studio');
  await shell.expectSignedIn(MOCK_USER.displayName);
  const rowHeight = (await headerBox(page)).height;
  await context.setOffline(true);
  await expect(icon(page)).toBeVisible({ timeout: 1000 });
  expect((await headerBox(page)).height).toBe(rowHeight);
  // The icon sits in the top bar's own row, beside the install and account controls, inside the header's box.
  const [bar, button] = await Promise.all([headerBox(page), icon(page).boundingBox()]);
  expect(button!.y).toBeGreaterThanOrEqual(bar.top);
  expect(button!.y + button!.height).toBeLessThanOrEqual(bar.bottom);
  await page.evaluate(() => (document.body.style.minHeight = '3000px'));
  await scrollTo(page, 600);
  await settled(page);
  await scrollBy(page, 40);
  await expect.poll(() => headerShown(page)).toBe(false);
  await expect(icon(page)).not.toBeInViewport();
  await scrollBy(page, -40);
  await expect.poll(() => headerShown(page)).toBe(true);
  await expect(icon(page)).toBeInViewport();
});

test('the toast is above the bottom navigation on a phone and out of the way of the content flow', async ({ page, shell, context, isMobile }) => {
  test.skip(!isMobile, 'the bottom navigation is a phone control');
  await mockApi(page);
  await shell.open();
  await context.setOffline(true);
  await icon(page).click();
  const [toastBox, nav] = await Promise.all([page.locator('.app-shell__toast--offline').boundingBox(), page.locator('.bottom-nav').boundingBox()]);
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(nav!.y);
  expect(toastBox!.x).toBeGreaterThanOrEqual(0);
  expect(toastBox!.x + toastBox!.width).toBeLessThanOrEqual(390);
  for (const control of await page.locator('.app-shell__toast--offline button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('the phone account menu has no connection line any more', async ({ page, shell, context, isMobile }) => {
  test.skip(!isMobile, 'the account menu is a phone control');
  await mockApi(page);
  await shell.open();
  await shell.expectSignedIn(MOCK_USER.displayName);
  await context.setOffline(true);
  await expect(icon(page)).toBeVisible({ timeout: 1000 });
  await shell.header.getByRole('button', { name: t('header.accountMenu', { name: MOCK_USER.displayName }) }).click();
  await expect(shell.header.getByRole('link', { name: t('account.page.title') })).toBeVisible();
  await expect(shell.header.getByText(/saved copy/)).toHaveCount(0);
});

test('coming back to the foreground looks again at once instead of waiting for the next poll', async ({ page, shell }) => {
  const { reachable } = await unreachableApi(page);
  await page.goto('/#/');
  await expect(icon(page)).toBeVisible();
  reachable();
  // The health poll runs every 15 s; a resume reloads now.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await expect(icon(page)).toBeHidden({ timeout: 3000 });
  await shell.expectSignedIn(MOCK_USER.displayName);
});

// LANG-2: the installed app starts offline in the saved language. A server of its own, so the origin gets its own service worker.
const withWorker = test.extend<{ server: WebServer }>({
  server: async ({}, use) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const server = await startWebServer({ dist: DIST, apiUrl });
    await use(server);
    await server.close();
  },
});

withWorker.describe('the service worker', () => {
  withWorker.use({ serviceWorkers: 'allow' });

  withWorker('starts the app offline in the saved language, Italian from its first frame, from the precached dictionary', async ({ page, context, server }) => {
    await page.addInitScript(() => {
      localStorage.setItem('glazelab:locale', 'it');
      // Every frame with the shell: its navigation's name, which follows the language.
      const names: string[] = [];
      Object.assign(window, { navNames: names });
      const sample = () => {
        const name = document.querySelector('nav[aria-label]')?.getAttribute('aria-label');
        if (name) names.push(name);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.goto(server.url + '/#/');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // The dictionary chunks are part of the precache (the worker installs only once it has all of them), not fetched on demand.
    const precached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
      return urls;
    });
    for (const language of ['de', 'es', 'it', 'pt-PT'])
      expect(
        precached.some((url) => new RegExp(`^/assets/${language}-[\\w-]+\\.js$`).test(url)),
        language,
      ).toBe(true);

    await context.setOffline(true);
    const started = Date.now();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.locator('nav[aria-label]').first()).toHaveAttribute('aria-label', dictionaries.it['nav.label']);
    await expect(page.locator('select.language-select').first()).toHaveValue('it');
    expect(Date.now() - started).toBeLessThan(5000);
    const navNames = () => page.evaluate(() => (window as unknown as { navNames: string[] }).navNames);
    await expect.poll(async () => (await navNames()).length).toBeGreaterThan(0);
    const names = await navNames();
    expect(names.filter((name) => name !== dictionaries.it['nav.label'])).toEqual([]);
    await context.setOffline(false);
  });
});
