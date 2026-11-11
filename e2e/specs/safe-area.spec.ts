import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { paintedPng, png } from '../support/images';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { AppShell } from '../support/pages/app-shell';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { AvatarSection } from '../support/pages/avatar';
import { ExplorePage } from '../support/pages/explore';
import { expect, test } from '../support/test';

// 24-15: the app draws edge-to-edge (`viewport-fit=cover`), so the system bars may lie over its edges. Headless Chromium has no system bars
// and no insets: the tests emulate them by overriding the one set of variables (`--safe-*`, style.css) and check that nothing interactive
// stands in the strips, that the viewer's dark ground still reaches the screen edges, and that with no inset nothing changed. The real bars
// (and the colour of the navigation strip) are confirmed on a phone.

const INSET = { top: 24, right: 20, bottom: 24, left: 20 };
const SIZES = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

async function emulateInsets(page: Page): Promise<void> {
  await page.addInitScript((inset) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      `:root { --safe-top: ${inset.top}px !important; --safe-right: ${inset.right}px !important; --safe-bottom: ${inset.bottom}px !important; --safe-left: ${inset.left}px !important; }`,
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, INSET);
}

/** Every element's box lies inside the window less the insets. */
async function expectInsideBars(page: Page, locator: Locator, name: string): Promise<void> {
  const boxes = await locator.evaluateAll((elements) =>
    elements.map((element) => {
      const { top, right, bottom, left } = element.getBoundingClientRect();
      return { label: (element.getAttribute('aria-label') ?? element.className ?? element.tagName).toString(), top, right, bottom, left };
    }),
  );
  expect(boxes.length, name).toBeGreaterThan(0);
  const { width, height } = page.viewportSize()!;
  for (const box of boxes) {
    const where = `${name} / ${box.label}`;
    expect(box.top, where).toBeGreaterThanOrEqual(INSET.top - 0.5);
    expect(box.left, where).toBeGreaterThanOrEqual(INSET.left - 0.5);
    expect(box.right, where).toBeLessThanOrEqual(width - INSET.right + 0.5);
    expect(box.bottom, where).toBeLessThanOrEqual(height - INSET.bottom + 0.5);
  }
}

const variables = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['--safe-top', '--safe-right', '--safe-bottom', '--safe-left'].map((name) => style.getPropertyValue(name).trim());
  });

test('the page draws edge-to-edge; with no inset the variables are 0 and the bars add no padding', async ({ page, shell, signedIn }) => {
  await shell.open();
  await shell.expectSignedIn(signedIn.displayName);
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');
  expect(await variables(page)).toEqual(['0px', '0px', '0px', '0px']);
  expect(await page.locator('.app-nav').evaluate((header) => getComputedStyle(header).paddingTop)).toBe('0px');
  if (shell.phone) expect(await page.locator('.bottom-nav').evaluate((bar) => getComputedStyle(bar).paddingBottom)).toBe('0px');
});

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height} with 24 px bars`, () => {
    test.skip(({ isMobile }) => !isMobile, 'phone project only: the desktop project has no system bars to emulate');
    test.use({ viewport: size });
    test.beforeEach(async ({ page }) => emulateInsets(page));

    test('header, bottom navigation and page content keep clear of the insets', async ({ page, signedIn }) => {
      const shell = new AppShell(page, size.width < 720);
      await shell.open();
      await shell.expectSignedIn(signedIn.displayName);
      expect(await variables(page)).toEqual(['24px', '20px', '24px', '20px']);
      // The header pads the top inset: its controls start below the status bar, its own background still reaches the top edge.
      expect(await page.locator('.app-nav').evaluate((header) => header.getBoundingClientRect().top)).toBe(0);
      await expectInsideBars(page, shell.header.locator('a, button').filter({ visible: true }), 'header controls');
      await expectInsideBars(page, page.getByRole('main').locator('h1, h2').first(), 'first heading');
      const bottomNav = page.locator('.bottom-nav');
      if (await bottomNav.count()) {
        // The bar reaches the bottom edge (its ground paints under the gesture area); its links stand above it.
        expect(await bottomNav.evaluate((bar) => Math.round(bar.getBoundingClientRect().bottom))).toBe(size.height);
        await expectInsideBars(page, bottomNav.locator('a'), 'bottom navigation');
      }
      // The end of the page (the footer) scrolls clear of the bar and the inset; scrolled again until the list has finished growing.
      const footerRoom = () =>
        page.evaluate(() => {
          window.scrollTo(0, 1e6);
          const footer = document.querySelector('footer')!.getBoundingClientRect().bottom;
          const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect().top;
          return (nav ?? innerHeight - 24) - footer;
        });
      await expect.poll(footerRoom).toBeGreaterThanOrEqual(-0.5);
    });

    test('a toast stays above the bottom navigation and inside the insets', async ({ page, context }) => {
      const shell = new AppShell(page, size.width < 720);
      await mockApi(page);
      await shell.open();
      await shell.expectSignedIn(MOCK_USER.displayName);
      await context.setOffline(true);
      await page
        .getByRole('banner')
        .getByRole('button', { name: t('header.offline') })
        .click();
      const toast = page
        .getByRole('status')
        .filter({ has: page.getByText(t('app.offlineToast')) })
        .locator('.app-shell__toast');
      await expect(toast).toBeVisible();
      await expectInsideBars(page, toast, 'toast');
      const nav = page.locator('.bottom-nav');
      if (await nav.count()) {
        const gap = (await nav.evaluate((bar) => bar.getBoundingClientRect().top)) - (await toast.evaluate((box) => box.getBoundingClientRect().bottom));
        expect(gap).toBeGreaterThanOrEqual(0);
      }
    });

    test('the add-glaze sheet (a dialog on a wide window) keeps its buttons clear of the insets', async ({ page, signedIn }) => {
      const shell = new AppShell(page, size.width < 720);
      await shell.open();
      await shell.expectSignedIn(signedIn.displayName);
      await new AddGlazeDialog(page).openFromExplore();
      const add = new AddGlazeDialog(page);
      await expect(add.dialog).toBeVisible();
      const submit = add.dialog.getByRole('button', { name: t('stock.newGlaze.submit'), exact: true });
      await submit.scrollIntoViewIfNeeded();
      await expectInsideBars(page, submit, 'submit');
      if (size.width < 720) {
        // The sheet reaches the bottom edge, so its ground paints under the gesture area.
        expect(await add.dialog.evaluate((dialog) => Math.round(dialog.getBoundingClientRect().bottom))).toBe(size.height);
      } else await expectInsideBars(page, add.dialog, 'dialog');
    });

    test('the photo viewer keeps its dark ground to the screen edges and its controls and caption inside the insets', async ({ page, api, signedIn, uid }) => {
      const shell = new AppShell(page, size.width < 720);
      const title = `Insets ${uid}`;
      const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
      await api.uploadToCombination(id, { file: png('one.png'), kind: 'TEST_TILE', caption: 'first photo' });
      await api.uploadToCombination(id, { file: png('two.png'), kind: 'TEST_TILE', caption: 'second photo' });
      await shell.open(`#/?type=combinations&q=${uid}`);
      await shell.expectSignedIn(signedIn.displayName);
      await new ExplorePage(page)
        .card(title)
        .getByRole('button', { name: t('images.cover.open', { title }) })
        .click();
      const dialog = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
      await expect(dialog).toBeVisible();
      // The backdrop covers the whole window, so the dark ground reaches under both bars.
      const ground = await page.locator('.modal--viewer').evaluate((node) => {
        const { top, left, right, bottom } = node.getBoundingClientRect();
        return { top, left, right: innerWidth - right, bottom: innerHeight - bottom };
      });
      expect(ground).toEqual({ top: 0, left: 0, right: 0, bottom: 0 });
      await expectInsideBars(page, dialog.getByRole('button').filter({ visible: true }), 'viewer buttons');
      await expectInsideBars(page, dialog.locator('.viewer__info > *'), 'viewer caption');
      await expectInsideBars(page, dialog.locator('.viewer__stage'), 'viewer photo');
    });
  });
}

// The crop dialog's Save and Cancel stand in a bar that sticks to the bottom of the scrolling sheet: on a phone it sits on the sheet's edge
// above the bottom inset. 320x568 is the smallest phone, where the sheet scrolls.
for (const size of [{ width: 320, height: 568 }, ...SIZES]) {
  test.describe(`${size.width}x${size.height} with 24 px bars, profile picture`, () => {
    test.skip(({ isMobile }) => !isMobile, 'phone project only: the desktop project has no system bars to emulate');
    test.use({ viewport: size });
    test.beforeEach(async ({ page }) => emulateInsets(page));

    test('the crop dialog keeps Save and Cancel clear of the bottom inset while it scrolls', async ({ page, signedIn }) => {
      const shell = new AppShell(page, size.width < 720);
      const avatar = new AvatarSection(page);
      await shell.open();
      await shell.openAccountPage(signedIn.displayName);
      await avatar.pick(paintedPng('insets.png', 400, 200, () => [200, 60, 60]));
      await expect(avatar.crop).toBeVisible();
      const buttons = avatar.crop.getByRole('button', { name: new RegExp(`^(${t('account.avatar.save')}|${t('common.cancel')})$`) });
      await expect(buttons).toHaveCount(2);
      // At the top of the dialog (where the bar sticks on a sheet that scrolls) and at its end: the buttons stand above the inset, and on a
      // phone the bar's ground reaches the sheet's edge, so no content shows under it.
      for (const end of [0, 1e6]) {
        await avatar.crop.evaluate((dialog, top) => dialog.scrollTo(0, top), end);
        await expectInsideBars(page, buttons, `crop buttons at ${end}`);
        if (size.width < 720) {
          // The bar is the buttons' parent.
          const barBottom = await buttons
            .first()
            .locator('..')
            .evaluate((bar) => bar.getBoundingClientRect().bottom);
          const gap = (await avatar.crop.evaluate((dialog) => dialog.getBoundingClientRect().bottom)) - barBottom;
          expect(Math.abs(gap), `bar to sheet edge at ${end}`).toBeLessThanOrEqual(0.5);
        }
      }
    });
  });
}
