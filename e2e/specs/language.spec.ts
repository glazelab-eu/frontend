import type { Page } from '@playwright/test';
import { t } from '../support/i18n';
import { dictionaries } from '../support/locales';
import { mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';

// LANG-2: the languages other than English are chunks of their own, loaded when chosen; the page switches only once the
// dictionary arrived, and a dictionary that cannot be loaded keeps the shown language.

/** The Italian dictionary's chunk (`assets/it-<hash>.js`). */
const ITALIAN_CHUNK = /\/assets\/it-[\w-]+\.js$/;

const select = (page: Page) => page.locator('select.language-select').first();

/** Samples, on every animation frame, the document language and two texts of the shell that follow the language. */
async function sampleFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: string[][] = [];
    Object.assign(window, { languageFrames: frames });
    const sample = () => {
      const nav = document.querySelector('nav[aria-label]');
      const picker = document.querySelector('select.language-select');
      if (nav && picker) frames.push([document.documentElement.lang, nav.getAttribute('aria-label') ?? '', picker.getAttribute('aria-label') ?? '']);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return () => page.evaluate(() => (window as unknown as { languageFrames: string[][] }).languageFrames);
}

const shell = (locale: 'en' | 'it') => [locale, dictionaries[locale]['nav.label'], dictionaries[locale]['language.label']];

test('a chosen language is loaded first and then shown at once, never half translated, and the next choice needs no fetch @smoke', async ({ page }) => {
  const frames = await sampleFrames(page);
  let fetched = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(ITALIAN_CHUNK, async (route) => {
    fetched++;
    await held;
    await route.continue();
  });
  await mockApi(page, { user: null });
  await page.goto('/#/');
  await expect(select(page)).toHaveValue('en');
  // English is in the main bundle: nothing was fetched for it.
  expect(fetched).toBe(0);

  await select(page).selectOption('it');
  await expect.poll(() => fetched).toBe(1);
  // While the dictionary is on its way the page stays English.
  await page.waitForTimeout(300);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('nav[aria-label]').first()).toHaveAttribute('aria-label', dictionaries.en['nav.label']);
  release();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(select(page)).toHaveAccessibleName(dictionaries.it['language.label']);
  expect(await page.evaluate(() => localStorage.getItem('glazelab:locale'))).toBe('it');

  // Every frame showed one language in full.
  await expect.poll(async () => (await frames()).length).toBeGreaterThan(0);
  const seen = await frames();
  const english = JSON.stringify(shell('en'));
  const italian = JSON.stringify(shell('it'));
  expect(seen.filter((frame) => ![english, italian].includes(JSON.stringify(frame)))).toEqual([]);

  // Back to English and to Italian again: the dictionary is kept, so nothing is fetched again.
  await select(page).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await select(page).selectOption('it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  expect(fetched).toBe(1);
});

test('a language that cannot be loaded keeps the shown one and says so in the error toast; the next choice tries again', async ({ page, context }) => {
  await mockApi(page, { user: null });
  await page.goto('/#/');
  await expect(select(page)).toHaveValue('en');
  // Offline without the service worker (blocked here): the never fetched chunk cannot load.
  await context.setOffline(true);
  await select(page).selectOption('it');
  await expect(page.getByRole('alert').getByText(t('language.loadFailed'))).toBeVisible();
  await expect(select(page)).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('nav[aria-label]').first()).toHaveAttribute('aria-label', dictionaries.en['nav.label']);
  expect(await page.evaluate(() => localStorage.getItem('glazelab:locale'))).not.toBe('it');

  await context.setOffline(false);
  await select(page).selectOption('it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(select(page)).toHaveAccessibleName(dictionaries.it['language.label']);
});

test('a saved language whose dictionary arrives after the start limit follows the English start (review)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('glazelab:locale', 'it'));
  // Longer than the 4 s start limit, then the dictionary arrives.
  await page.route(ITALIAN_CHUNK, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await route.continue();
  });
  await mockApi(page, { user: null });
  await page.goto('/#/');
  await expect(select(page)).toHaveValue('en', { timeout: 5_500 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it', { timeout: 10_000 });
  await expect(select(page)).toHaveValue('it');
  await expect(page.locator('nav[aria-label]').first()).toHaveAttribute('aria-label', dictionaries.it['nav.label']);
  expect(await page.evaluate(() => localStorage.getItem('glazelab:locale'))).toBe('it');
});

test('a language shown after a failed load ends the toast that said it could not be loaded (review)', async ({ page }) => {
  // A server error for the first request of the chunk (a deployment in progress), no change of connection, so no sync clears the toast.
  let failed = false;
  await page.route(ITALIAN_CHUNK, (route) => (failed ? route.continue() : ((failed = true), route.fulfill({ status: 503 }))));
  await mockApi(page, { user: null });
  await page.goto('/#/');
  await expect(select(page)).toHaveValue('en');
  await select(page).selectOption('it');
  await expect(page.getByRole('alert').getByText(t('language.loadFailed'))).toBeVisible();
  await select(page).selectOption('it');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  // The toast would now name, in Italian, a language that is in place.
  await expect(page.getByRole('alert').getByText(dictionaries.it['language.loadFailed'])).toBeHidden();
});

test('a saved language is in place for the first frame, and a dictionary that never arrives still lets the app start', async ({ page }) => {
  const frames = await sampleFrames(page);
  await page.addInitScript(() => localStorage.setItem('glazelab:locale', 'it'));
  await mockApi(page, { user: null });
  await page.goto('/#/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect.poll(async () => (await frames()).length).toBeGreaterThan(0);
  const seen = await frames();
  expect(seen.filter((frame) => JSON.stringify(frame) !== JSON.stringify(shell('it')))).toEqual([]);

  // A chunk request that never answers: the start gives up waiting after its limit and shows English, the preference kept.
  await page.route(ITALIAN_CHUNK, () => {});
  const started = Date.now();
  await page.reload();
  await expect(select(page)).toHaveValue('en', { timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(9_000);
  expect(await page.evaluate(() => localStorage.getItem('glazelab:locale'))).toBe('it');
});
