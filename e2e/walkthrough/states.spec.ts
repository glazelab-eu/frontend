import { t } from '../support/i18n';
import { DIST } from '../support/paths';
import { startWebServer } from '../support/web-server';
import { expect, test } from './support';

test('offline state: the offline icon and its toast, saved data still works', async ({ page, context, begin, finish, human, signIn }) => {
  await signIn();
  const header = page.getByRole('banner');
  await begin('#/', (p) => p.getByRole('article').first().waitFor());
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const icon = header.getByRole('button', { name: t('header.offline') });
  await expect(icon).toBeVisible({ timeout: 20_000 });
  await human.pause(2000);
  await human.tap(icon);
  await expect(page.getByRole('status').getByText(t('app.offlineToast'))).toBeVisible();
  await human.pause(3500);
  await human.browse(2, 500);
  await human.tryStep('saved page', async () => {
    await human.tap(page.getByRole('link', { name: 'Shelf', exact: true }));
    await human.pause(2200);
  });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await human.pause(3500);
  await finish('offline');
});

test('error toast: a failed request shows a dismissible message', async ({ page, begin, finish, human, signIn, seed }) => {
  await signIn();
  const main = page.getByRole('main');
  await page.route('**/api/favorites/**', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 400, json: { error: 'Request failed.' } }) : route.fallback(),
  );
  await begin(`#/glazes/${seed.glazes['Duncan DN-312']}`, (p) => p.getByRole('heading', { level: 1, name: 'Dusty Rose' }).waitFor());
  await human.tap(main.getByRole('button', { name: t('favorites.add') }).first());
  const toast = page.getByRole('alert').locator('.app-shell__toast--error');
  await expect(toast).toBeVisible();
  await human.pause(4000);
  await human.tap(toast.getByRole('button', { name: t('app.dismissError') }));
  await human.pause(1500);
  await finish('error-toast');
});

const update = test.extend({});
update.use({ serviceWorkers: 'allow' });

update('update toast: a new version is waiting', async ({ page, begin, finish, human, signIn }) => {
  const apiUrl = process.env.GLAZELAB_E2E_API_URL!;
  const server = await startWebServer({ dist: DIST, apiUrl });
  try {
    await signIn();
    await page.goto(server.url + '/#/');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
    server.setServiceWorkerSuffix('next version');
    await page.reload();
    const notice = page.getByRole('status').locator('.update-notice');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await begin(page.url(), () => notice.waitFor());
    await human.pause(2500);
    await human.tap(notice.getByRole('button', { name: t('update.later') }));
    await human.pause(1200);
    await finish('update-toast');
  } finally {
    await server.close();
  }
});
