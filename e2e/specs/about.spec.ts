import type { Page } from '@playwright/test';
import { SOURCE_URL } from '../support/backend';
import { t } from '../support/i18n';
import { mockApi } from '../support/mock-api';
import { DIST } from '../support/paths';
import { expect, test } from '../support/test';
import { startWebServer, type WebServer } from '../support/web-server';

const SECTIONS = [
  'about.origin.title',
  'about.lab.title',
  'about.inspiration.title',
  'about.privacy.title',
  'about.open.title',
  'about.free.title',
  'about.small.title',
] as const;

/** The About page with its one h1 and every section heading. */
async function expectAboutPage(page: Page) {
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('about.title'));
  const article = page.getByRole('article');
  for (const key of SECTIONS) await expect(article.getByRole('heading', { level: 2, name: t(key) })).toBeVisible();
  await expect(article.getByText(t('about.free.body'))).toBeVisible();
  return article;
}

test('a guest opens About from the footer, with the source, licence and terms links, and Back returns', async ({ page, shell }) => {
  await shell.open('#/');
  await shell.footer.getByRole('link', { name: t('about.link'), exact: true }).click();
  const article = await expectAboutPage(page);
  await expect(article.getByRole('link', { name: t('app.sourceCode'), exact: true })).toHaveAttribute('href', SOURCE_URL);
  await expect(article.getByRole('link', { name: t('app.licences'), exact: true })).toHaveAttribute('href', '/THIRD-PARTY-LICENSES.txt');
  await article.getByRole('link', { name: t('terms.title'), exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: t('terms.title') })).toBeVisible();
  await page.goBack();
  await expectAboutPage(page);
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { level: 1, name: t('nav.explore') })).toBeVisible();
});

test('a member opens About from the footer of the shelf, and Back returns to the shelf', async ({ page, shell, signedIn }) => {
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await shell.footer.getByRole('link', { name: t('about.link'), exact: true }).click();
  await expectAboutPage(page);
  await page.goBack();
  await expect(page).toHaveURL(/#\/stock$/);
});

test("the guest's welcome on Explore links the About page", async ({ page, shell }) => {
  await shell.open('#/');
  await page.getByRole('link', { name: t('about.title'), exact: true }).click();
  await expectAboutPage(page);
});

test('without a configured source URL the About page shows no source link', async ({ page, shell }) => {
  await mockApi(page, { user: null });
  await shell.open('#/about');
  const article = await expectAboutPage(page);
  await expect(article.getByRole('link', { name: t('app.licences'), exact: true })).toBeVisible();
  await expect(article.getByRole('link', { name: t('app.sourceCode'), exact: true })).toHaveCount(0);
});

// A server of its own, so the origin gets its own service worker (as in `offline.spec.ts`).
const withWorker = test.extend<{ server: WebServer }>({
  server: async ({}, use) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const server = await startWebServer({ dist: DIST, apiUrl });
    await use(server);
    await server.close();
  },
});

withWorker.describe('offline', () => {
  withWorker.use({ serviceWorkers: 'allow' });

  withWorker('the About page opens offline after the first load, from the footer and as a fresh start', async ({ page, context, server }) => {
    await page.goto(server.url + '/#/');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page
      .locator('footer')
      .getByRole('link', { name: t('about.link'), exact: true })
      .click();
    await expectAboutPage(page);
    await page.reload();
    await expectAboutPage(page);
    await context.setOffline(false);
  });
});
