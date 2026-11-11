import type { Page } from '@playwright/test';
import { scrollTo } from '../support/header';
import { t } from '../support/i18n';
import { DIST } from '../support/paths';
import { StudioPage } from '../support/pages/studio';
import { expect, test } from '../support/test';
import { startWebServer, type WebServer } from '../support/web-server';

// A server of its own per test: its origin gets its own service worker, and its sw.js changes without touching other tests.
const update = test.extend<{ server: WebServer }>({
  server: async ({}, use) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const server = await startWebServer({ dist: DIST, apiUrl });
    await use(server);
    await server.close();
  },
});
update.use({ serviceWorkers: 'allow' });

/** Opens the app until its first service worker controls the page, then publishes a new worker and reloads to find it. */
async function newVersionWaiting(page: Page, server: WebServer, hash = '#/'): Promise<void> {
  await page.goto(server.url + '/' + hash);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  server.setServiceWorkerSuffix('next version');
  await page.reload();
}

/** The update toast (26-7): in the polite status region of the toast box. */
function notice(page: Page) {
  return page.getByRole('status').locator('.update-notice');
}

/** The top edge of the page's first heading: what the old in-flow banner pushed down. */
const headingTop = (page: Page) =>
  page
    .locator('main h1, main h2')
    .first()
    .evaluate((heading) => Math.round(heading.getBoundingClientRect().top * 10) / 10);

update('Refresh activates a waiting version and reloads into it @smoke', async ({ page, server }) => {
  await newVersionWaiting(page, server);
  await notice(page)
    .getByRole('button', { name: t('update.refresh') })
    .click();
  await expect(notice(page)).toBeHidden();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)).toBeNull();
});

update('Later hides the notice', async ({ page, server }) => {
  await newVersionWaiting(page, server);
  await notice(page)
    .getByRole('button', { name: t('update.later') })
    .click();
  await expect(notice(page)).toBeHidden();
});

update(
  'the notice is a toast in the corner: it moves nothing in the page, stays there while the page scrolls and is polite (26-7)',
  async ({ page, server }) => {
    await page.goto(server.url + '/#/terms');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    server.setServiceWorkerSuffix('next version');
    await page.reload();
    await expect(notice(page)).toBeVisible();
    // A reload restores a scroll offset of a few pixels on a phone: measure from the top, as after Later below.
    await scrollTo(page, 0);
    // Measured on one page load: the old in-flow banner pushed the first heading down by its own height while it showed.
    const shown = await headingTop(page);
    const header = (await page.locator('.app-nav').boundingBox())!;
    // Polite, not an alert: it is no error; the status region holds it and focus is not taken.
    await expect(page.getByRole('alert').getByText(t('update.available'))).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === document.querySelector('main'))).toBe(true);
    // Fixed in the corner: the same place whatever the scroll.
    await page.evaluate(() => ((document.querySelector('.app-shell__content') as HTMLElement).style.minHeight = '4000px'));
    const place = async () => Math.round((await notice(page).boundingBox())!.y);
    const at = await place();
    await scrollTo(page, 1500);
    expect(await place()).toBe(at);
    // Later removes it and the heading is where it was.
    await notice(page)
      .getByRole('button', { name: t('update.later') })
      .click();
    await expect(notice(page)).toBeHidden();
    await scrollTo(page, 0);
    expect(await headingTop(page)).toBe(shown);
    expect(Math.round((await page.locator('.app-nav').boundingBox())!.height)).toBe(Math.round(header.height));
  },
);

update('an error toast stands above the update toast, and the update toast stays when the error goes (26-7)', async ({ page, server }) => {
  await newVersionWaiting(page, server, '#/terms');
  await expect(notice(page)).toBeVisible();
  // The server answers 429 once the app asks again (the device came back online).
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 429, json: { error: 'Too many requests. Please wait a moment and try again.' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const error = page.getByRole('alert').locator('.app-shell__toast--error');
  await expect(error).toBeVisible();
  const [top, bottom] = [(await error.boundingBox())!, (await notice(page).boundingBox())!];
  expect(top.y + top.height).toBeLessThanOrEqual(bottom.y + 1);
  await error.getByRole('button', { name: t('app.dismissError') }).click();
  await expect(error).toHaveCount(0);
  await expect(notice(page)).toBeVisible();
});

update('its buttons are 44 px tall on a touch screen and a dialog covers it', async ({ page, server, isMobile }) => {
  await newVersionWaiting(page, server, '#/terms');
  await expect(notice(page)).toBeVisible();
  if (isMobile) for (const button of await notice(page).getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Refresh with nothing unsaved is a reload, so cover it with a dialog that is always there: the sign-in.
  await page
    .getByRole('banner')
    .getByRole('button', { name: t(isMobile ? 'common.signIn' : 'common.signInOrJoin'), exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: t('auth.dialogLabel') });
  await expect(dialog).toBeVisible();
  const covered = await notice(page).evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return !!hit && !node.contains(hit);
  });
  expect(covered).toBe(true);
});

update('with unsaved input the notice says so and Refresh asks first', async ({ page, server, signedIn, uid, isMobile }) => {
  await newVersionWaiting(page, server, '#/studio');
  const studio = new StudioPage(page);
  await studio.title.fill(`Draft of ${signedIn.displayName} ${uid}`);
  await expect(notice(page)).toContainText(t('update.draft'));
  // On a phone Studio's sticky bar takes the foot of the screen: the toast stands above it, not over Save.
  const bar = page.locator('.studio-form__bar--sticky');
  if (isMobile) {
    await expect(bar).toBeVisible();
    const [toast, foot] = [(await notice(page).boundingBox())!, (await bar.boundingBox())!];
    expect(toast.y + toast.height).toBeLessThanOrEqual(foot.y);
  }
  await notice(page)
    .getByRole('button', { name: t('update.refresh') })
    .click();
  await page
    .getByRole('dialog', { name: t('update.discard') })
    .getByRole('button', { name: t('drafts.stay') })
    .click();
  await expect(studio.title).toHaveValue(`Draft of ${signedIn.displayName} ${uid}`);
  await expect(notice(page)).toBeVisible();
});
