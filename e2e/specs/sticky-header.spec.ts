import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP, type Api } from '../support/api';
import { expectAccessible } from '../support/axe';
import { photoPng } from '../support/images';
import { headerBox, headerShown, scrollBy, scrollTo, settled } from '../support/header';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { ExplorePage } from '../support/pages/explore';
import { expect, newAccount, test } from '../support/test';

/**
 * The header is sticky (26-5): always on screen from 70em, where it is a single row; under 70em, where it is tall (a phone's top bar, the
 * two-row header, 37% of a landscape phone), it slides out while the page scrolls down and returns on the way up, with a focus inside
 * it, an open menu or a field in use. The active entry and the brand bring the page to its top in one tap.
 */
async function longList(api: Api, uid: string, count = 14): Promise<void> {
  await api.signUp(newAccount(uid, 'Cleo'));
  for (let index = 1; index <= count; index++) await api.addCombination({ title: `Tile ${String(index).padStart(2, '0')} ${uid}`, steps: [BISQUE_STEP] });
}
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
/** Scrolls far down the list (at least `least` px: a list that is too short would prove nothing). */
async function scrollDeep(page: Page, least = 1000): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 1e6));
  await expect.poll(() => scrollY(page)).toBeGreaterThan(least);
}
const entry = (page: Page, phone: boolean): Locator =>
  (phone ? page.locator('.bottom-nav') : page.locator('.app-nav__links')).getByRole('link', { name: t('nav.explore'), exact: true });

test('the header stays in the viewport while a long Explore list scrolls, and one tap on Explore returns to the top @smoke', async ({
  page,
  shell,
  api,
  uid,
  isMobile,
}) => {
  await longList(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cards.first()).toBeVisible();
  await scrollDeep(page);
  if (isMobile) {
    // The phone's top bar slid away on the way down; the bottom navigation stays, and its Explore entry is the one-tap way back.
    await expect.poll(() => headerShown(page)).toBe(false);
    await expect(entry(page, true)).toBeInViewport();
  } else {
    // 1280 px: the header never leaves the top of the window.
    expect(await headerBox(page)).toMatchObject({ top: 0 });
    await expect(shell.header.getByRole('link', { name: t('nav.explore'), exact: true })).toBeInViewport();
  }
  // Whatever scrolls under it (cards, the sticky gallery's photo) stays behind it: the points along its middle belong to the header.
  if (!isMobile) {
    const covered = await page.evaluate(() => {
      const { height } = document.querySelector('.app-nav')!.getBoundingClientRect();
      return [20, innerWidth / 2, innerWidth - 20].map((x) => !!document.elementFromPoint(x, height - 3)?.closest('.app-nav'));
    });
    expect(covered).toEqual([true, true, true]);
  }
  await entry(page, isMobile).click();
  await expect.poll(() => scrollY(page)).toBe(0);
  expect((await headerBox(page)).top).toBe(0);
});

test('the brand returns to the top of Explore and clears its filters, however deep the list is', async ({ page, shell, api, uid, isMobile }) => {
  await longList(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cards.first()).toBeVisible();
  await scrollDeep(page);
  // Scrolling up a little brings the phone's top bar back; the brand is in it.
  await scrollBy(page, -40);
  await expect.poll(() => headerShown(page)).toBe(true);
  await shell.header.getByRole('link', { name: t('nav.home') }).click();
  await expect.poll(() => scrollY(page)).toBe(0);
  await expect(page).toHaveURL(/#\/$/);
  expect(isMobile || (await headerBox(page)).top === 0).toBe(true);
});

test('a tap on another page scrolls nothing itself: the new page starts at the top', async ({ page, shell, api, uid, isMobile }) => {
  await longList(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cards.first()).toBeVisible();
  await scrollDeep(page);
  await (isMobile ? page.locator('.bottom-nav') : page.locator('.app-nav__links'))
    .getByRole('link', { name: t(isMobile ? 'nav.shelf' : 'nav.stock'), exact: true })
    .click();
  await expect(page).toHaveURL(/#\/stock/);
  expect(await scrollY(page)).toBe(0);
});

test('a reduced-motion setting jumps to the top and moves the header without a transition', async ({ page, shell, api, uid, isMobile }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await longList(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cards.first()).toBeVisible();
  await expect(page.locator('.app-nav')).toHaveCSS('transition-duration', '0s');
  await scrollDeep(page);
  await entry(page, isMobile).click();
  // Instant: the very next frame is at the top.
  expect(await page.evaluate(() => new Promise<number>((done) => requestAnimationFrame(() => done(Math.round(window.scrollY)))))).toBe(0);
});

test('without that setting the header slides (0.2 s) and the tap glides', async ({ page, shell, api, uid, isMobile }) => {
  await longList(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cards.first()).toBeVisible();
  await expect(page.locator('.app-nav')).toHaveCSS('transition-duration', isMobile ? '0.2s' : '0s');
  await scrollDeep(page);
  const start = await scrollY(page);
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as unknown as { samples: number[] }).samples = samples;
    const frame = () => {
      samples.push(Math.round(window.scrollY));
      if (samples.length < 300) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await entry(page, isMobile).click();
  await expect.poll(() => scrollY(page), { timeout: 10_000 }).toBe(0);
  // Smooth: some frame stood strictly between where it began and the top.
  const samples = await page.evaluate(() => (window as unknown as { samples: number[] }).samples);
  expect(samples.some((y) => y > 0 && y < start - 50)).toBe(true);
});

test('a field reached by the keyboard is not left under the header', async ({ page, shell, api, uid }) => {
  await longList(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  const explore = new ExplorePage(page);
  await expect(explore.cards.first()).toBeVisible();
  await scrollDeep(page);
  const height = (await headerBox(page)).height;
  // The search field half under the header's place (20 px of it hidden), the focus on the button after it has focus: Shift+Tab moves back to the field.
  const top = await explore.search.evaluate((search) => search.getBoundingClientRect().top + window.scrollY);
  await explore.search.locator('xpath=following::button[1]').evaluate((next) => (next as HTMLElement).focus({ preventScroll: true }));
  await scrollTo(page, Math.round(top - height + 20));
  await page.keyboard.press('Shift+Tab');
  await expect(explore.search).toBeFocused();
  // The browser scrolled it clear of the header (which, slid away on a phone, returns at the first scroll up).
  await expect.poll(async () => Math.round((await explore.search.boundingBox())!.y)).toBeGreaterThanOrEqual(Math.round(height));
});

test.describe('under 70em', () => {
  test.use({ viewport: { width: 1000, height: 900 } });

  test('the two-row header slides out on the way down and returns on the way up @smoke', async ({ page, shell, api, uid, isMobile }) => {
    test.skip(isMobile, 'the desktop project at 1000 px; the phone has its own tests');
    await longList(api, uid);
    await shell.open(`#/?type=combinations&q=${uid}`);
    await expect(new ExplorePage(page).cards.first()).toBeVisible();
    expect(await headerShown(page)).toBe(true);
    await scrollTo(page, 600);
    await expect.poll(() => headerShown(page)).toBe(false);
    // A wobble of a few pixels changes nothing, 12 px up brings it back at once.
    await scrollBy(page, -6);
    await settled(page);
    expect(await headerShown(page)).toBe(false);
    await scrollBy(page, -10);
    await expect.poll(async () => (await headerBox(page)).top).toBe(0);
    await scrollBy(page, 40);
    await expect.poll(() => headerShown(page)).toBe(false);
    // Printed while slid away, the page keeps its header.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.app-nav')).toHaveCSS('transform', 'none');
    await page.emulateMedia({ media: 'screen' });
    await scrollTo(page, 0);
    await expect.poll(() => headerShown(page)).toBe(true);
  });

  test('a field in use keeps the header where it is, and a focus inside the header brings it back', async ({ page, shell, api, uid, isMobile }) => {
    test.skip(isMobile, 'the desktop project at 1000 px');
    await longList(api, uid);
    await shell.open(`#/?type=combinations&q=${uid}`);
    const explore = new ExplorePage(page);
    await expect(explore.cards.first()).toBeVisible();
    // Typing in the search field while the page scrolls down: the header stays.
    await explore.search.focus();
    await scrollTo(page, 700);
    await settled(page);
    expect(await headerShown(page)).toBe(true);
    await scrollBy(page, 200);
    await settled(page);
    expect(await headerShown(page)).toBe(true);
    // Done with the field: the next scroll down hides it.
    await explore.search.blur();
    await scrollBy(page, 100);
    await expect.poll(() => headerShown(page)).toBe(false);
    // A keyboard user tabbing back into the header sees it.
    // (A key press first makes the focus a keyboard focus, as Tab would.)
    await page.keyboard.press('Escape');
    await shell.header.getByRole('link', { name: t('nav.home') }).focus();
    await expect.poll(() => headerShown(page)).toBe(true);
    // And while focus is inside it, scrolling down does not hide it.
    await scrollBy(page, 300);
    await settled(page);
    expect(await headerShown(page)).toBe(true);
  });

  test('the sticky gallery of the combination page follows the header out and in', async ({ page, shell, api, signedIn, uid, isMobile }) => {
    test.skip(isMobile, 'the desktop project at 1000 px');
    await page.setViewportSize({ width: 1000, height: 1100 });
    const steps = Array.from({ length: 30 }, (_, index) => ({ ...BISQUE_STEP, label: `Step ${index + 1} ${'with a long label '.repeat(4)}` }));
    const id = await api.addCombination({ title: `Long ${uid}`, steps });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const gallery = page.getByRole('main').locator('.combination-card__media');
    await expect(gallery).toBeVisible();
    await scrollTo(page, 500);
    await expect.poll(() => headerShown(page)).toBe(false);
    await expect.poll(async () => Math.round((await gallery.boundingBox())!.y)).toBe(16);
    await scrollBy(page, -30);
    await expect.poll(() => headerShown(page)).toBe(true);
    const height = (await headerBox(page)).height;
    await expect.poll(async () => Math.round((await gallery.boundingBox())!.y)).toBe(Math.round(height) + 16);
  });
});

test('an open account menu keeps the phone header where it is', async ({ page, shell, isMobile }) => {
  test.skip(!isMobile, 'the account menu is the phone layout');
  await mockApi(page, { user: MOCK_USER });
  await page.goto('/#/');
  const menu = shell.header.getByRole('button', { name: t('header.accountMenu', { name: MOCK_USER.displayName }) });
  await expect(menu).toBeVisible();
  await page.evaluate(() => {
    (document.querySelector('.app-shell__content') as HTMLElement).style.minHeight = '4000px';
  });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await scrollTo(page, 800);
  await scrollBy(page, 300);
  await settled(page);
  expect(await headerShown(page)).toBe(true);
  // A press on the page closes the menu; the button a finger touched keeps focus but does not hold the header (only keyboard focus does).
  await page.locator('.app-shell__content').click({ position: { x: 2, y: 3000 } });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await scrollBy(page, 300);
  await expect.poll(() => headerShown(page)).toBe(false);
});

test('after the account menu was used by touch, its button keeps focus but the header still slides away', async ({ page, shell, signedIn, isMobile }) => {
  test.skip(!isMobile, 'the account menu is the phone layout');
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  await shell.openAccountPage(signedIn.displayName);
  // Following the menu's Account link hands focus back to the menu button (not a keyboard focus: a finger chose the link).
  const menu = shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) });
  await expect(menu).toBeFocused();
  await page.evaluate(() => ((document.querySelector('.app-shell__content') as HTMLElement).style.minHeight = '4000px'));
  await scrollTo(page, 900);
  await expect.poll(() => headerShown(page)).toBe(false);
});

test('a dialog stays above the sticky header', async ({ page, shell }) => {
  await shell.open('#/terms');
  await page.evaluate(() => {
    (document.querySelector('.app-shell__content') as HTMLElement).style.minHeight = '4000px';
  });
  await scrollTo(page, 300);
  await scrollBy(page, -20);
  await expect.poll(() => headerShown(page)).toBe(true);
  await shell.signInButton().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // The point at the header's top-left corner belongs to the dialog's backdrop, not to the header.
  expect(await page.evaluate(() => !!document.elementFromPoint(20, 10)?.closest('.modal'))).toBe(true);
});

test('the photo viewer, which opens inside the sticky gallery, covers the header', async ({ page, shell, api, signedIn, uid }) => {
  const id = await api.addCombination({ title: `Viewer ${uid}`, steps: [BISQUE_STEP] });
  await api.uploadToCombination(id, { file: photoPng('tall.png', 600, 800) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('img', { name: t('images.alt.tile', { title: `Viewer ${uid}` }) })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // The header's corner, centre and right belong to the dialog, and its Close button can be pressed.
  const covered = await page.evaluate(() => [20, innerWidth / 2, innerWidth - 20].map((x) => !!document.elementFromPoint(x, 10)?.closest('.modal')));
  expect(covered).toEqual([true, true, true]);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('common.close') })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('the page is accessible with the header stuck and slid away', async ({ page, shell, api, uid, isMobile }) => {
  await longList(api, uid);
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cards.first()).toBeVisible();
  await scrollDeep(page);
  await expectAccessible(page);
  await scrollBy(page, -40);
  await expect.poll(() => headerShown(page)).toBe(true);
  await expectAccessible(page);
  expect(isMobile || (await headerBox(page)).top === 0).toBe(true);
});

test.describe('the scanner sheet of the phone account menu', () => {
  test('opens inside the header and still covers the bottom navigation and the header', async ({ page, shell, signedIn, isMobile }) => {
    test.skip(!isMobile, 'the account menu is the phone layout');
    await shell.open('#/');
    await shell.expectSignedIn(signedIn.displayName);
    await shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }).click();
    await shell.header.getByRole('button', { name: t('header.scan') }).click();
    const sheet = page.getByRole('dialog', { name: t('links.scanner.title') });
    // Headless Chromium refuses the camera: the sheet settles on that line (no camera is ever reached).
    await expect(sheet.getByRole('alert')).toHaveText(t('links.scanner.denied'));
    // The sheet stands at the foot of the screen, where the bottom navigation is: every point there and at the header belongs to the dialog.
    const covered = await page.evaluate(() =>
      [10, innerHeight / 2, innerHeight - 10].flatMap((y) =>
        [20, innerWidth / 2, innerWidth - 20].map((x) => !!document.elementFromPoint(x, y)?.closest('.modal')),
      ),
    );
    expect(covered).toEqual(Array(9).fill(true));
    // The page scrolls behind a sheet: the header stays (slid away, its transform would carry the sheet off the screen with it).
    await page.evaluate(() => ((document.querySelector('.app-shell__content') as HTMLElement).style.minHeight = '4000px'));
    const before = await sheet.boundingBox();
    await scrollTo(page, 900);
    await scrollBy(page, 300);
    await settled(page);
    expect(await headerShown(page)).toBe(true);
    expect(await sheet.boundingBox()).toEqual(before);
    await sheet.getByRole('button', { name: t('common.close') }).click();
    await expect(sheet).toBeHidden();
    // Closed, the header slides away again on the way down.
    await scrollBy(page, 300);
    await expect.poll(() => headerShown(page)).toBe(false);
  });
});
