import type { Page } from '@playwright/test';
import { t } from '../support/i18n';
import { dictionaries } from '../support/locales';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';

/** The failed-request error as a toast (26-7): in the toast box's alert region, never in the flow of the page. */
const toast = (page: Page) => page.getByRole('alert').locator('.app-shell__toast--error');
/** The top edge of the page's first heading: what the old red banner pushed down and back up. */
const headingTop = (page: Page) =>
  page
    .locator('main h1, main h2')
    .first()
    .evaluate((heading) => Math.round(heading.getBoundingClientRect().top * 10) / 10);

/** A glaze page of a signed-in account whose favourite write answers as `answer` does (a failed write shows the toast). */
async function glazePage(page: Page, api: import('../support/api').Api, uid: string, name: string, add = t('favorites.add')) {
  const created = await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` }, code: 'CE-1', name });
  const answer = { current: { status: 400, json: { error: 'Request failed.' } } as Record<string, unknown> };
  await page.route('**/api/favorites/**', (route) =>
    route.request().method() === 'PUT' ? (answer.current.abort ? route.abort('connectionrefused') : route.fulfill(answer.current)) : route.fallback(),
  );
  await page.goto(`/#/glazes/${created.id}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name })).toBeVisible();
  const favourite = page.getByRole('main').getByRole('button', { name: add });
  return { answer, fail: () => favourite.click() };
}

const gateway = { status: 503, contentType: 'text/html', body: '<html>Bad gateway</html>' };
const tooMany = { status: 429, json: { error: 'Too many requests. Please wait a moment and try again.' } };

test('a failed write shows a toast that moves nothing, stays and goes with Dismiss @smoke', async ({ page, shell, api, signedIn, uid }) => {
  const { fail } = await glazePage(page, api, uid, 'Celadon');
  await shell.expectSignedIn(signedIn.displayName);
  const before = await headingTop(page);
  expect(await toast(page).count()).toBe(0);
  await fail();
  await expect(toast(page)).toContainText(t('errors.requestFailed'));
  // The alert region holds it (read at once), the page did not move.
  expect(await headingTop(page)).toBe(before);
  // No auto-dismissal: the 4.5 s of an ordinary toast and well beyond.
  await page.waitForTimeout(5500);
  await expect(toast(page)).toBeVisible();
  // A write failure is not a failed load: no Try again.
  await expect(toast(page).getByRole('button', { name: t('common.tryAgain') })).toHaveCount(0);
  await toast(page)
    .getByRole('button', { name: t('app.dismissError') })
    .click();
  await expect(toast(page)).toHaveCount(0);
  expect(await headingTop(page)).toBe(before);
  // Focus did not fall to the document: it is back in the page.
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test('Escape inside the toast dismisses it', async ({ page, shell, api, signedIn, uid }) => {
  const { fail } = await glazePage(page, api, uid, 'Celadon');
  await shell.expectSignedIn(signedIn.displayName);
  await fail();
  await expect(toast(page)).toBeVisible();
  // Focus is not taken when it appears.
  expect(await page.evaluate(() => !!document.activeElement?.closest('.app-shell__toasts'))).toBe(false);
  await toast(page)
    .getByRole('button', { name: t('app.dismissError') })
    .focus();
  await page.keyboard.press('Escape');
  await expect(toast(page)).toHaveCount(0);
});

test('a newer error replaces the toast and the same error twice stays one toast', async ({ page, shell, api, signedIn, uid }) => {
  const { fail, answer } = await glazePage(page, api, uid, 'Celadon');
  await shell.expectSignedIn(signedIn.displayName);
  await fail();
  await expect(toast(page)).toContainText(t('errors.requestFailed'));
  await fail();
  await expect(toast(page)).toHaveCount(1);
  answer.current = tooMany;
  await fail();
  await expect(toast(page)).toHaveCount(1);
  await expect(toast(page)).toContainText(t('errors.tooManyRequests'));
  await expect(toast(page)).not.toContainText(t('errors.requestFailed'));
});

const wording = Object.entries(dictionaries).map(
  ([locale, text]) => [locale, { many: text['errors.tooManyRequests'], down: text['errors.unreachable'], add: text['favorites.add'] }] as const,
);
for (const [locale, texts] of wording) {
  test(`429 and 5xx are worded in ${locale}`, async ({ page, api, signedIn: _, uid }) => {
    await page.addInitScript((value) => localStorage.setItem('glazelab:locale', value), locale);
    const { fail, answer } = await glazePage(page, api, uid, 'Celadon', texts.add);
    answer.current = tooMany;
    await fail();
    await expect(toast(page)).toContainText(texts.many);
    // A gateway's HTML page (nginx 502/503/504) says the server cannot be reached; the app then turns offline.
    answer.current = gateway;
    await fail();
    await expect(toast(page)).toContainText(texts.down);
    await expect(toast(page)).not.toContainText(texts.many);
  });
}

/** An API whose listings answer 429 until `works()`; a later `online` event makes the app load again. */
async function flakyListings(page: Page) {
  const state = { failing: false };
  await mockApi(page, {
    answers: {
      'GET /api/glazes': async (route) => (state.failing ? route.fulfill(tooMany) : route.fulfill({ json: [] })),
    },
  });
  return {
    fail: async () => {
      state.failing = true;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    },
    works: () => {
      state.failing = false;
    },
  };
}

for (const route of ['#/', '#/account']) {
  test(`a failed load on ${route} shows the toast with Try again, the heading does not move, and a retry that works removes it`, async ({ page, shell }) => {
    const api = await flakyListings(page);
    await shell.open(route);
    await shell.expectSignedIn(MOCK_USER.displayName);
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const before = await headingTop(page);
    await api.fail();
    await expect(toast(page)).toContainText(t('errors.tooManyRequests'));
    const retry = toast(page).getByRole('button', { name: t('common.tryAgain') });
    await expect(retry).toBeEnabled();
    expect(await headingTop(page)).toBe(before);
    // Still failing: the answer is the same, the toast stays.
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(toast(page)).toHaveCount(1);
    api.works();
    await retry.click();
    await expect(toast(page)).toHaveCount(0);
    expect(await headingTop(page)).toBe(before);
    // Focus moves to main once the removed button's focus is given up (a moment later on a busy machine): poll, never read it once.
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });
}

test('the error toast stands above the offline toast and both clear independently', async ({ page, shell, api, signedIn, uid }) => {
  const { fail, answer } = await glazePage(page, api, uid, 'Celadon');
  await shell.expectSignedIn(signedIn.displayName);
  // An unreachable server: the write fails with no answer at all, which also turns the app offline.
  answer.current = { abort: true };
  await fail();
  await expect(toast(page)).toBeVisible();
  await page
    .getByRole('banner')
    .getByRole('button', { name: t('header.offline') })
    .click();
  const offline = page.getByRole('status').getByText(t('app.offlineToast'));
  await expect(offline).toBeVisible();
  const [top, bottom] = [(await toast(page).boundingBox())!, (await offline.boundingBox())!];
  expect(top.y + top.height).toBeLessThanOrEqual(bottom.y + 1);
  await toast(page)
    .getByRole('button', { name: t('app.dismissError') })
    .click();
  await expect(toast(page)).toHaveCount(0);
  await expect(offline).toBeVisible();
});

test('on a phone the toast stands above the bottom navigation with 44 px buttons', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the bottom navigation is a phone control');
  const { fail } = await glazePage(page, api, uid, 'Celadon');
  await shell.expectSignedIn(signedIn.displayName);
  await fail();
  await expect(toast(page)).toBeVisible();
  const [box, nav] = await Promise.all([toast(page).boundingBox(), page.locator('.bottom-nav').boundingBox()]);
  expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
  for (const control of await toast(page).getByRole('button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
