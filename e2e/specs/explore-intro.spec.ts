import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { eanFor } from '../support/barcodes';
import { headerBox } from '../support/header';
import { anyLanguage, locales } from '../support/locales';
import { t } from '../support/i18n';
import { png } from '../support/images';
import { AccountPage } from '../support/pages/account';
import { expect, test } from '../support/test';

/**
 * The signed-in Explore intro card (ONBOARD-1): besides shelf, combination and club it offers a profile picture and error reports, each a
 * link to its part of the account page. Error reports stay opt-in: the card holds no switch, and the account page's switch stays off.
 */
const card = (page: Page) => page.getByRole('main').getByRole('complementary', { name: t('discover.onboarding.title') });
const step = (page: Page, key: 'discover.onboarding.picture' | 'discover.onboarding.diagnostics') =>
  card(page).getByRole('link', { name: t(key), exact: true });
const completed = (page: Page, key: 'discover.onboarding.picture' | 'discover.onboarding.diagnostics') =>
  card(page).getByRole('link', { name: t('discover.onboarding.completed', { step: t(key) }), exact: true });

test('a new account is offered a picture and error reports, and each step opens its part of the account page @smoke', async ({ page, shell, signedIn }) => {
  const account = new AccountPage(page);
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(card(page).getByRole('link')).toHaveCount(5);
  await expect(step(page, 'discover.onboarding.picture')).toHaveAttribute('href', '#/account?section=picture');
  await expect(step(page, 'discover.onboarding.diagnostics')).toHaveAttribute('href', '#/account?section=diagnostics');
  // Nothing to tick in the card itself: the choice is made on the account page.
  await expect(card(page).getByRole('checkbox')).toHaveCount(0);
  await expect(card(page).getByRole('switch')).toHaveCount(0);

  await step(page, 'discover.onboarding.picture').click();
  await expect(page).toHaveURL(/#\/account\?section=picture$/);
  const profile = account.section(t('account.page.profile.title'));
  await expect(profile).toBeFocused();
  await expect(profile).toBeInViewport();
  await expect(account.main.getByText(t('account.avatar.choose'), { exact: true })).toBeInViewport();

  await page.goBack();
  await expect(card(page)).toBeVisible();
  await step(page, 'discover.onboarding.diagnostics').click();
  await expect(page).toHaveURL(/#\/account\?section=diagnostics$/);
  const reports = account.section(t('account.page.diagnostics.title'));
  await expect(reports).toBeFocused();
  await expect(reports).toBeInViewport();
  // Off until the person turns it on.
  await expect(account.main.getByRole('switch', { name: t('account.page.diagnostics.switch') })).not.toBeChecked();
});

test('a picture and error reports tick their steps, and the card goes once every step is done, error reports on or off', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  await api.uploadAvatar(png('me.png', [40, 120, 200], 240, 240));
  await api.setDiagnostics(true);
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(completed(page, 'discover.onboarding.picture')).toBeVisible();
  await expect(completed(page, 'discover.onboarding.diagnostics')).toBeVisible();

  const glaze = await api.addGlaze({ newManufacturer: { name: `Intro ${uid}`, shortId: uid.toUpperCase() }, code: 'I-1', name: 'Iris', barcode: eanFor(uid) });
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 300 });
  await api.addCombination({ title: `First ${uid}`, steps: [BISQUE_STEP] });
  await api.createClub(`Intro club ${uid}`);
  // Error reports are optional: turning them off again never brings the card back to ask for them.
  await api.setDiagnostics(false);
  // A search lists the new combination (searches are complete, photo or not): the library has loaded, so the card's absence is the
  // answer, not a load still running.
  await shell.open(`#/?q=${encodeURIComponent(`First ${uid}`)}`);
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(page.getByRole('main').getByRole('heading', { name: `First ${uid}` })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

/** The target lies whole between the visible header and the phone's bottom navigation (the window's foot on wide screens). */
async function expectClear(page: Page, target: Locator) {
  await expect
    .poll(async () => {
      const [box, header, nav] = await Promise.all([
        target.boundingBox(),
        headerBox(page),
        page.getByRole('navigation', { name: t('nav.label') }).boundingBox(),
      ]);
      const height = page.viewportSize()!.height;
      // The wide header's own navigation sits at the top; only the phone's bar stands at the foot.
      const foot = nav && nav.y > height / 2 ? nav.y : height;
      return box !== null && box.y >= Math.max(0, header.bottom) - 0.5 && box.y + box.height <= foot + 0.5;
    })
    .toBe(true);
}

test('on a short screen each step shows its controls clear of the header and the bottom navigation', async ({ page, shell, signedIn, isMobile }) => {
  const account = new AccountPage(page);
  const sizes = isMobile
    ? [
        { width: 320, height: 640 },
        { width: 390, height: 640 },
      ]
    : [{ width: 1280, height: 800 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await shell.open();
    await shell.expectSignedIn(signedIn.displayName);
    await step(page, 'discover.onboarding.picture').click();
    await expect(account.section(t('account.page.profile.title'))).toBeFocused();
    await expectClear(page, account.main.getByText(t('account.avatar.choose'), { exact: true }));

    await page.goBack();
    await step(page, 'discover.onboarding.diagnostics').click();
    await expect(account.section(t('account.page.diagnostics.title'))).toBeFocused();
    await expectClear(page, account.main.getByRole('switch', { name: t('account.page.diagnostics.switch') }));
  }
});

test('a step opens its part again after the account page was shown without it', async ({ page, shell, signedIn }) => {
  const account = new AccountPage(page);
  const reports = account.section(t('account.page.diagnostics.title'));
  await shell.open('#/account?section=diagnostics');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(reports).toBeFocused();
  // The address bar or Back reaches the bare page; the page is read from the top again.
  await page.evaluate(() => (location.hash = '#/account'));
  await expect(page).toHaveURL(/#\/account$/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await account.heading().click();
  await expect(reports).not.toBeFocused();
  await page.evaluate(() => (location.hash = '#/account?section=diagnostics'));
  await expect(reports).toBeFocused();
  await expect(reports).toBeInViewport();
});

test('on touch screens the steps and the hide button are full touch targets; with a mouse the card stays compact, in every language', async ({
  page,
  shell,
  signedIn,
  isMobile,
}) => {
  const intro = page.getByRole('main').getByRole('complementary', { name: anyLanguage('discover.onboarding.title', {}, true) });
  const sizes = isMobile
    ? [
        { width: 320, height: 640 },
        { width: 390, height: 844 },
      ]
    : [{ width: 1280, height: 800 }];
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  for (const locale of locales) {
    await page.evaluate((value) => localStorage.setItem('glazelab:locale', value), locale);
    await page.reload();
    for (const size of sizes) {
      await page.setViewportSize(size);
      await expect(intro.getByRole('link')).toHaveCount(5);
      const targets = [intro.getByRole('button', { name: anyLanguage('discover.onboarding.dismiss', {}, true) }), ...(await intro.getByRole('link').all())];
      const card = (await intro.boundingBox())!;
      for (const target of targets) {
        const box = (await target.boundingBox())!;
        // 44 px, the --touch-target token, on a coarse pointer; the fine pointer keeps the line height.
        if (isMobile) expect(box.height, `${locale} ${size.width}`).toBeGreaterThanOrEqual(44);
        else expect(box.height, `${locale} ${size.width}`).toBeLessThan(32);
        expect(box.x + box.width, `${locale} ${size.width}`).toBeLessThanOrEqual(card.x + card.width + 0.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${locale} ${size.width}`).toBe(true);
    }
  }
});
