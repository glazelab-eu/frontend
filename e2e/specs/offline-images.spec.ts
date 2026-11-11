import type { Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { photoPng } from '../support/images';
import { AppShell } from '../support/pages/app-shell';
import { DIST } from '../support/paths';
import { expect, test } from '../support/test';
import { startWebServer, type WebServer } from '../support/web-server';

// 24-12: a picture the app saved shows at once while the connection is dead, whether the browser knows it
// (offline) or not (a black hole that never answers and never fails), with or without the service worker.

interface Site extends WebServer {
  hits: (path: string) => number;
  /** From now on `/api/images/` requests reach the server and are never answered. */
  stallImages: () => void;
}

const site = test.extend<{ server: Site }>({
  server: async ({}, use) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const paths: string[] = [];
    let stalled = false;
    const server = await startWebServer({
      dist: DIST,
      apiUrl,
      onApiRequest: (path) => paths.push(path),
      stall: (path) => stalled && path.startsWith('/api/images/'),
    });
    await use({ ...server, hits: (path) => paths.filter((each) => each === path).length, stallImages: () => (stalled = true) });
    await server.close();
  },
});

/**
 * Milliseconds from the end of a reload (its load event) until the first picture is decoded, or `Infinity` after `limit`;
 * the whole reload takes `total`.
 */
async function timeToPicture(page: Page, limit: number, evictHttpCache = false): Promise<{ ms: number; total: number }> {
  // The browser may have lost its HTTP copy (eviction, a sign-out, Safari, a browser that never kept it): only the app's saved copy is left.
  if (evictHttpCache) {
    const client = await page.context().newCDPSession(page);
    await client.send('Network.clearBrowserCache');
    await client.detach();
  }
  const started = Date.now();
  await page.reload();
  const loaded = Date.now();
  try {
    await page.locator('.image-view__image--decoded').first().waitFor({ state: 'visible', timeout: limit });
  } catch {
    return { ms: Infinity, total: Infinity };
  }
  return { ms: Date.now() - loaded, total: Date.now() - started };
}

/** A combination with one picture, viewed on its page (full size) and on Explore (card size) so both sizes are saved. */
async function seedAndView(page: Page, base: string, isMobile: boolean, api: import('../support/api').Api, signedInName: string, uid: string) {
  const title = `Offline pic ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  const photo = await api.uploadToCombination(id, { file: photoPng('offline.png', 1200, 900), kind: 'TEST_TILE' });
  await page.goto(`${base}/#/?type=combinations&q=${encodeURIComponent(title)}`);
  await new AppShell(page, isMobile).expectSignedIn(signedInName);
  await expect(page.locator('.image-view__image--decoded').first()).toBeVisible();
  await page.goto(`${base}/#/combinations/${id}`);
  await expect(page.locator('.image-view__image--decoded').first()).toBeVisible();
  const saved = (url: string) =>
    page.evaluate(async (path) => {
      for (const name of await caches.keys()) if (await (await caches.open(name)).match(path)) return true;
      return false;
    }, url);
  await expect.poll(async () => [await saved(photo.url), await saved(photo.cardUrl)]).toEqual([true, true]);
  return { id, title, photo };
}

for (const workers of ['block', 'allow'] as const) {
  site.describe(`service worker ${workers}`, () => {
    site.use({ serviceWorkers: workers });
    site.setTimeout(90_000);

    site(
      `a saved picture shows at once while /api/images/ never answers and the browser reports online (${workers})`,
      async ({ page, server, isMobile, api, signedIn, uid }) => {
        await seedAndView(page, server.url, isMobile, api, signedIn.displayName, uid);
        if (workers === 'allow') await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
        server.stallImages();
        expect(await page.evaluate(() => navigator.onLine)).toBe(true);
        const warm = await timeToPicture(page, 20_000);
        console.log(`MEASURE stalled, HTTP cache warm, detail ${workers}: ${warm.ms} ms after load (${warm.total} ms in all)`);
        const detail = await timeToPicture(page, 20_000, true);
        console.log(`MEASURE stalled, HTTP cache lost, detail ${workers}: ${detail.ms} ms after load (${detail.total} ms in all)`);
        await page.goto(`${server.url}/#/?type=combinations&q=${uid}`);
        const explore = await timeToPicture(page, 20_000, true);
        console.log(`MEASURE stalled, HTTP cache lost, explore ${workers}: ${explore.ms} ms after load (${explore.total} ms in all)`);
        expect(warm.ms).toBeLessThan(1000);
        expect(detail.ms).toBeLessThan(1000);
        expect(explore.ms).toBeLessThan(1000);
      },
    );

    site(
      `a reload asks the server for no saved picture, even when the browser lost its HTTP copy (${workers})`,
      async ({ page, server, isMobile, api, signedIn, uid }) => {
        const { photo } = await seedAndView(page, server.url, isMobile, api, signedIn.displayName, uid);
        const before = [server.hits(photo.url), server.hits(photo.cardUrl)];
        expect(before[0]).toBeGreaterThan(0);
        const { ms } = await timeToPicture(page, 20_000, true);
        expect(ms).toBeLessThan(1000);
        await page.goto(`${server.url}/#/?type=combinations&q=${uid}`);
        await timeToPicture(page, 20_000, true);
        expect([server.hits(photo.url), server.hits(photo.cardUrl)]).toEqual(before);
      },
    );

    // Without the worker the offline page itself cannot load, so only the worker variant has a really offline reload.
    const offline = workers === 'allow' ? site : site.skip;
    offline(`a saved picture shows at once with the network really off (${workers})`, async ({ page, context, server, isMobile, api, signedIn, uid }) => {
      await seedAndView(page, server.url, isMobile, api, signedIn.displayName, uid);
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await context.setOffline(true);
      const detail = await timeToPicture(page, 20_000, true);
      console.log(`MEASURE offline, detail ${workers}: ${detail.ms} ms after load (${detail.total} ms in all)`);
      expect(detail.ms).toBeLessThan(1000);
      await context.setOffline(false);
    });
  });
}

site.describe('a picture that was never saved', () => {
  site.use({ serviceWorkers: 'allow' });
  site.setTimeout(90_000);

  site(
    'is not requested while the app is offline, shows the unavailable text at once and loads when the connection returns',
    async ({ page, context, server, isMobile, api, signedIn, uid }) => {
      // Two combinations with a picture; only the first is ever viewed (Explore filtered by its title), so the second's pictures are not saved.
      const title = `Unseen ${uid}`;
      const unseenId = await api.addCombination({ title, steps: [BISQUE_STEP] });
      const unseen = await api.uploadToCombination(unseenId, { file: photoPng('unseen.png', 1200, 900), kind: 'TEST_TILE' });
      const first = await seedAndView(page, server.url, isMobile, api, signedIn.displayName, uid);
      expect(first.photo.url).not.toBe(unseen.url);
      const asked = () => server.hits(unseen.url) + server.hits(unseen.cardUrl);
      const before = asked();

      await context.setOffline(true);
      await page.waitForFunction(() => !navigator.onLine);
      await page.evaluate((id) => (location.hash = `#/combinations/${id}`), unseenId);
      await expect(page.getByText(t('images.unavailableOffline')).first()).toBeVisible();
      expect(asked()).toBe(before);

      await context.setOffline(false);
      await expect(page.locator('.image-view__image--decoded').first()).toBeVisible();
      await expect(page.getByText(t('images.unavailableOffline'))).toHaveCount(0);
      expect(asked()).toBeGreaterThan(before);
    },
  );
});
