import { t } from '../support/i18n';
import { DIST } from '../support/paths';
import { expect, test } from '../support/test';
import { startWebServer, type WebServer } from '../support/web-server';

// A typed or shared path loads the shell and the router moves it to the hash route: no extra history entry.

test('a typed path opens its hash route, and /start the home route @smoke', async ({ page }) => {
  await page.goto('/clubs');
  await expect(page).toHaveURL(/\/#\/clubs$/);
  await page.goto('/stock?glaze=g1');
  await expect(page).toHaveURL(/\/#\/stock\?glaze=g1$/);
  await page.goto('/start');
  await expect(page).toHaveURL(/\/#\/$/);
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: t('route.notFound.title') })).toBeVisible();
});

test('a file-like path is a 404 and stays', async ({ page }) => {
  const response = await page.request.get('/wp-content/plugins/x/readme.txt');
  expect(response.status()).toBe(404);
});

const withWorker = test.extend<{ server: WebServer }>({
  server: async ({}, use) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const server = await startWebServer({ dist: DIST, apiUrl });
    await use(server);
    await server.close();
  },
});
withWorker.use({ serviceWorkers: 'allow' });

withWorker('with the service worker answering, /clubs and /start still move to their routes @smoke', async ({ page, server }) => {
  await page.goto(server.url + '/#/');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto(server.url + '/clubs');
  await expect(page).toHaveURL(/\/#\/clubs$/);
  await page.goto(server.url + '/start');
  await expect(page).toHaveURL(/\/#\/$/);
});

withWorker('with the service worker answering, a file such as the licence notices opens as the file, never as the app shell', async ({ page, server }) => {
  await page.goto(server.url + '/#/');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const answer = await page.goto(server.url + '/THIRD-PARTY-LICENSES.txt');
  expect(answer?.status()).toBe(200);
  await expect(page).toHaveURL(/\/THIRD-PARTY-LICENSES\.txt$/);
  await expect(page.locator('body')).toContainText('svelte ');
  await expect(page.locator('body')).not.toContainText('Install Glazelab');
});
