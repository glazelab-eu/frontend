import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { BISQUE_STEP } from '../support/api';
import { photoPng } from '../support/images';
import { glaze } from '../../src/test/fixtures';
import { expect, test } from '../support/test';

const containsFocus = (dialog: Locator) => dialog.evaluate((element) => element.contains(document.activeElement));

/** Presses Tab (or Shift+Tab every third time) and checks after each press that focus stayed in the dialog. */
async function expectTabTrapped(page: Page, dialog: Locator, presses = 15): Promise<void> {
  for (let press = 0; press < presses; press++) {
    await page.keyboard.press(press % 3 === 0 ? 'Shift+Tab' : 'Tab');
    expect(await containsFocus(dialog), `focus after press ${press + 1}`).toBe(true);
  }
}

test.describe('the blocking terms dialog', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, { user: { ...MOCK_USER, acceptedTermsVersion: null } });
    await page.goto('/#/');
  });

  const terms = (page: Page) => page.getByRole('dialog', { name: t('terms.update.title') });
  const summary = (page: Page) => terms(page).getByText(t('auth.terms.read'));
  // Accept stays disabled until the box is ticked, so Sign out is the last control focus can reach.
  const lastControl = (page: Page) => terms(page).getByRole('button', { name: t('header.signOut') });

  test('takes the focus and wraps Shift+Tab to its last control @smoke', async ({ page }) => {
    await expect(terms(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(lastControl(page)).toBeFocused();
  });

  test('wraps between its first and last control in both directions', async ({ page }) => {
    await summary(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(lastControl(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(summary(page)).toBeFocused();
  });

  test('moves Tab from the dialog itself to its first control', async ({ page }) => {
    await expect(terms(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(summary(page)).toBeFocused();
  });

  test('stays open on Escape', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(terms(page)).toBeVisible();
  });

  test('keeps Tab inside with the terms expanded', async ({ page }) => {
    await summary(page).click();
    await expectTabTrapped(page, terms(page));
  });
});

test.describe('the phone filter sheet', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the filter sheet exists below 720 px only');
    await mockApi(page, { user: null });
    await page.goto('/#/');
    await opener(page).click();
  });

  const opener = (page: Page) => page.getByRole('button', { name: t('discover.filters.open', { count: 0 }) });
  const sheet = (page: Page) => page.getByRole('dialog', { name: t('discover.filters.title') });

  test('wraps focus between Close and its last button @smoke', async ({ page }) => {
    await expect(sheet(page).getByRole('button', { name: t('common.close') })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(sheet(page).getByRole('button', { name: t('discover.filters.results', { count: 0 }) })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sheet(page).getByRole('button', { name: t('common.close') })).toBeFocused();
  });

  test('lets a picker take Escape first, then closes and returns focus to its opener', async ({ page }) => {
    const picker = sheet(page).getByRole('combobox', { name: t('discover.filter.tags') });
    await picker.fill('blue');
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveValue('');
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(opener(page)).toBeFocused();
  });

  test('keeps focus in a dialog opened above it and returns it step by step', async ({ page }) => {
    // A click event on the covered header button stacks the sign-in dialog on the sheet, as two ModalShells.
    await page
      .getByRole('banner')
      .getByRole('button', { name: t('common.signIn'), exact: true })
      .dispatchEvent('click');
    const auth = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    await expect(auth).toBeVisible();
    await expectTabTrapped(page, auth);
    await page.keyboard.press('Escape');
    await expect(auth).toBeHidden();
    expect(await containsFocus(sheet(page))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(opener(page)).toBeFocused();
  });
});

test.describe('the full-screen photo viewer', () => {
  test.beforeEach(async ({ page, shell, api, signedIn, uid }) => {
    const title = `Focus ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    for (const kind of ['TEST_TILE', 'FINISHED', 'FINISHED'] as const) await api.uploadToCombination(id, { file: photoPng('p.png', 600, 450), kind });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page.getByRole('group', { name: t('images.galleryNavigation') }).focus();
    await page.keyboard.press('Enter');
  });

  const viewer = (page: Page) => page.getByRole('dialog', { name: /^Full-screen photos of / });

  test('takes the focus on Close, wraps Tab and Shift+Tab over Close, previous and next, and returns the focus to the stage on Escape @smoke', async ({
    page,
  }) => {
    await expect(viewer(page)).toBeVisible();
    const [close, previous, next] = [t('common.close'), t('images.viewer.previous'), t('images.viewer.next')].map((name) =>
      viewer(page).getByRole('button', { name }),
    );
    await expect(close).toBeFocused();
    await expectTabTrapped(page, viewer(page));
    // DOM order: Close first, then the buttons beside the photo; Tab wraps from the last back to Close and Shift+Tab the other way.
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(previous).toBeFocused();
    // The keys work from a focused button and the focus stays where it is.
    await page.keyboard.press('ArrowRight');
    await expect(viewer(page).getByText('2 / 3', { exact: true })).toBeVisible();
    await expect(previous).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(viewer(page)).toBeHidden();
    await expect(page.getByRole('group', { name: t('images.galleryNavigation') })).toBeFocused();
  });

  test('takes its keys only from inside the viewer, never from the page beneath it', async ({ page }) => {
    await expect(viewer(page)).toBeVisible();
    await page.getByRole('main').dispatchEvent('keydown', { key: 'ArrowRight', bubbles: true });
    await expect(viewer(page).getByText('1 / 3', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(viewer(page).getByText('2 / 3', { exact: true })).toBeVisible();
  });
});

test.describe("the photo viewer of a list card (Explore's cover and thumbnails)", () => {
  test('takes the focus on Close, wraps Tab over Close, previous, next and Open, and returns the focus to the thumbnail that opened it on Escape', async ({
    page,
    shell,
    api,
    signedIn,
    uid,
  }) => {
    const title = `List focus ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
    for (const kind of ['TEST_TILE', 'FINISHED', 'FINISHED'] as const) await api.uploadToCombination(id, { file: photoPng('p.png', 600, 450), kind });
    await shell.open(`#/?type=combinations&q=${uid}`);
    await shell.expectSignedIn(signedIn.displayName);
    const thumbnail = page.getByRole('button', { name: t('images.thumbnail.open', { current: 2, total: 3, title }) });
    await thumbnail.click();
    const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
    await expect(viewer).toBeVisible();
    const [close, previous, next] = [t('common.close'), t('images.viewer.previous'), t('images.viewer.next')].map((name) =>
      viewer.getByRole('button', { name }),
    );
    const open = viewer.getByRole('link', { name: t('images.viewer.openItemFor', { title }) });
    await expect(close).toBeFocused();
    await expectTabTrapped(page, viewer);
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(open).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(previous).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(open).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(thumbnail).toBeFocused();
  });
});

test.describe('the offline toast and a dialog (26-6)', () => {
  test('a dialog opened while the toast is open covers it, keeps focus inside, and the toast is back after it closes', async ({ page, shell, context }) => {
    await mockApi(page, { user: null });
    await shell.open();
    await context.setOffline(true);
    const icon = page.getByRole('banner').getByRole('button', { name: t('header.offline') });
    await expect(icon).toBeVisible({ timeout: 1000 });
    await icon.click();
    const toast = page.locator('.app-shell__toast--offline');
    await expect(toast).toBeVisible();

    await shell.signInButton().click();
    const auth = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    await expect(auth).toBeVisible();
    // The dialog is above the toast: what is under the toast's middle belongs to the dialog's backdrop or the dialog.
    const covered = await toast.evaluate((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      const hit = document.elementFromPoint(x + width / 2, y + height / 2);
      return !!hit && !node.contains(hit);
    });
    expect(covered).toBe(true);
    // Tab never leaves the dialog for the toast's buttons.
    await expectTabTrapped(page, auth);
    await page.keyboard.press('Escape');
    await expect(auth).toBeHidden();
    await expect(toast).toBeVisible();
  });
});

test.describe('the error toast and a dialog (26-7)', () => {
  test('a dialog opened while the error toast shows covers it and keeps focus inside', async ({ page, shell }) => {
    let failing = false;
    await mockApi(page, {
      user: null,
      answers: {
        'GET /api/auth/me': async (route) =>
          failing
            ? route.fulfill({ status: 429, json: { error: 'Too many requests. Please wait a moment and try again.' } })
            : route.fulfill({ status: 401, json: { error: 'Please sign in.' } }),
      },
    });
    await shell.open();
    failing = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const toast = page.getByRole('alert').locator('.app-shell__toast--error');
    await expect(toast).toBeVisible();

    await shell.signInButton().click();
    const auth = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    await expect(auth).toBeVisible();
    const covered = await toast.evaluate((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      const hit = document.elementFromPoint(x + width / 2, y + height / 2);
      return !!hit && !node.contains(hit);
    });
    expect(covered).toBe(true);
    await expectTabTrapped(page, auth);
    await page.keyboard.press('Escape');
    await expect(auth).toBeHidden();
    await expect(toast).toBeVisible();
  });
});

test.describe('the Close label and a language switch (COMP-2)', () => {
  const messages = (language: string): Record<string, string> =>
    JSON.parse(readFileSync(new URL(`../../src/lib/i18n/${language}.json`, import.meta.url), 'utf8'));

  test('an open dialog takes the new language for Close and its name, without being mounted again', async ({ page, shell }) => {
    await mockApi(page, { user: null });
    await shell.open();
    await shell.signInButton().click();
    const auth = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    await expect(auth.getByRole('button', { name: t('common.close'), exact: true })).toBeVisible();
    // A mark on the dialog element: a dialog mounted again would come without it.
    await auth.evaluate((element) => element.setAttribute('data-probe', 'kept'));
    const dialog = page.locator('[role="dialog"][data-probe="kept"]');
    // The language select is under the backdrop (the header on wide screens, the guest footer on phones): set it directly.
    const select = page.locator('select.language-select').first();
    for (const language of ['de', 'pt-PT', 'it', 'es', 'en']) {
      await select.selectOption(language, { force: true });
      await expect(dialog).toHaveAccessibleName(messages(language)['auth.dialogLabel']);
      await expect(dialog.getByRole('button', { name: messages(language)['common.close'], exact: true })).toBeVisible();
    }
  });
});

test.describe("a dialog's error is its own submit's (COMP-7 review)", () => {
  const sync = {
    format: 1,
    cursor: '1.0',
    epoch: 'mock',
    resync: 'CURSOR',
    glazes: [],
    combinations: [],
    removedGlazeIds: [],
    removedCombinationIds: [],
    visibleGlazes: 0,
    visibleCombinations: 0,
  };
  /** The listings load fails while `failing` holds; the browser's `online` event starts a refresh. */
  async function mockFailingLoad(page: Page, user: typeof MOCK_USER, failing: { now: boolean }, answers = {}) {
    await mockApi(page, {
      user,
      answers: {
        'GET /api/sync': (route) => (failing.now ? route.fulfill({ status: 400, json: { error: 'Listing failed.' } }) : route.fulfill({ json: sync })),
        ...answers,
      },
    });
  }
  const refresh = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

  test('the terms dialog neither shows nor takes the focus for a failed load before or while it is open', async ({ page }) => {
    const failing = { now: true };
    await mockFailingLoad(page, { ...MOCK_USER, acceptedTermsVersion: null }, failing, {
      'POST /api/auth/terms': { status: 400, json: { error: 'Please accept the current terms of service.' } },
    });
    await page.goto('/#/');
    const terms = page.getByRole('dialog', { name: t('terms.update.title') });
    // The load failed before the dialog opened: the banner has it, the dialog keeps its own focus.
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: t('errors.requestFailed') })
        .first(),
    ).toBeVisible();
    await expect(terms).toBeFocused();
    await expect(terms.getByRole('alert')).toHaveCount(0);
    const box = terms.getByLabel(t('auth.terms.accept'));
    await box.focus();
    await refresh(page);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('[role="alert"]').length)).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await expect(box).toBeFocused();
    await expect(terms.getByRole('alert')).toHaveCount(0);
    // Its own refused acceptance shows in the dialog and takes the focus.
    await box.check();
    await terms.getByRole('button', { name: t('terms.update.accept') }).click();
    await expect(terms.getByRole('alert')).toBeFocused();
  });

  test('the glaze removal dialog shows its own refusal, never a load that failed while it is open', async ({ page }) => {
    const failing = { now: false };
    await mockFailingLoad(page, { ...MOCK_USER, siteAdmin: true }, failing, {
      'GET /api/glazes': { json: [glaze({ id: 'g1', name: 'Dialog glaze' })] },
      'DELETE /api/glazes/g1': { status: 409, json: { error: 'This glaze is used in combinations. Remove it from them first.', combinations: [] } },
    });
    await page.goto('/#/glazes/g1');
    await page
      .getByRole('main')
      .getByRole('button', { name: t('glaze.remove.action') })
      .click();
    const dialog = page.getByRole('dialog', { name: t('glaze.remove.title') });
    const confirm = dialog.getByRole('button', { name: t('glaze.remove.confirm') });
    await confirm.focus();
    failing.now = true;
    await refresh(page);
    await expect(page.getByRole('alert').filter({ hasText: t('errors.requestFailed') })).toBeVisible();
    await expect(confirm).toBeFocused();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    failing.now = false;
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeFocused();
  });

  test('the deletion dialog keeps the password field focused when a load fails while it is open', async ({ page }) => {
    const failing = { now: false };
    await mockFailingLoad(page, MOCK_USER, failing, {
      'POST /api/auth/delete': { status: 400, json: { error: 'Incorrect password. Your account was not deleted.' } },
    });
    await page.goto('/#/account');
    await page
      .getByRole('main')
      .getByRole('button', { name: t('account.delete.title') })
      .click();
    const dialog = page.getByRole('dialog', { name: t('account.delete.title') });
    const password = dialog.getByLabel(t('auth.password'));
    await expect(password).toBeFocused();
    failing.now = true;
    await refresh(page);
    await page.waitForTimeout(1000);
    await expect(password).toBeFocused();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await password.fill('wrong');
    await dialog.getByLabel(t('account.delete.understand')).check();
    await dialog.getByRole('button', { name: t('account.delete.confirm') }).click();
    await expect(dialog.getByRole('alert')).toHaveText(t('errors.deleteAccountPassword'));
    await expect(dialog.getByRole('alert')).toBeFocused();
  });
});

test.describe('closing a dialog', () => {
  test.beforeEach(async ({ page, shell }) => {
    await mockApi(page, { user: null });
    await shell.open();
    await shell.signInButton().click();
  });

  const auth = (page: Page) => page.getByRole('dialog', { name: t('auth.dialogLabel') });

  test('a text selection dragged out of the dialog onto the backdrop keeps it open with what was typed', async ({ page }) => {
    const email = auth(page).getByLabel(t('common.email'));
    await email.fill('potter@example.com');
    const box = (await email.boundingBox())!;
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(3, 3, { steps: 4 });
    await page.mouse.up();
    await expect(auth(page)).toBeVisible();
    await expect(email).toHaveValue('potter@example.com');
    // A press and release on the backdrop itself still closes it.
    await page.mouse.click(3, 3);
    await expect(auth(page)).toBeHidden();
  });

  test('an input method’s Escape belongs to the composition and leaves the dialog open', async ({ page }) => {
    const email = auth(page).getByLabel(t('common.email'));
    await email.focus();
    await email.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
    await expect(auth(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(auth(page)).toBeHidden();
  });
});

test('a picker leaves an input method’s Enter and Escape to the composition', async ({ page, isMobile }) => {
  await mockApi(page, { user: null });
  await page.goto('/#/');
  if (isMobile) await page.getByRole('button', { name: t('discover.filters.open', { count: 0 }) }).click();
  const picker = page.getByRole('combobox', { name: t('discover.filter.tags') });
  await picker.fill('blue');
  await picker.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
  await picker.dispatchEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true });
  await expect(picker).toHaveValue('blue');
  await picker.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await expect(picker).toHaveValue('blue');
});

test('the blocking terms dialog stays the top dialog when another dialog opens beneath it', async ({ page }) => {
  await mockApi(page, { user: { ...MOCK_USER, acceptedTermsVersion: null } });
  await page.goto('/#/');
  const terms = page.getByRole('dialog', { name: t('terms.update.title') });
  await expect(terms).toBeFocused();
  await page
    .getByRole('button', { name: t('feedback.open'), exact: true })
    .first()
    .dispatchEvent('click');
  const feedback = page.getByRole('dialog', { name: t('feedback.title') });
  await expect(feedback).toBeAttached();
  expect(await containsFocus(terms)).toBe(true);
  await expectTabTrapped(page, terms, 6);
  await page.keyboard.press('Escape');
  await expect(terms).toBeVisible();
  await expect(feedback).toBeAttached();
});
