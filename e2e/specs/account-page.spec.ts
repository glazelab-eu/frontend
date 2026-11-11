import type { Locator } from '@playwright/test';
import { startsWith, t } from '../support/i18n';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { AccountPage } from '../support/pages/account';
import { expect, test } from '../support/test';

/** The account page is where a member manages the account; the footer keeps only what belongs to the site. */

test('the header leads to the account page, which holds the profile and the account actions @smoke', async ({ page, shell, signedIn }) => {
  const account = new AccountPage(page);
  await shell.open();
  await shell.openAccountPage(signedIn.displayName);
  await expect(page).toHaveURL(/#\/account$/);
  await account.expectShown();
  // One h1, then one h2 per section, in this order.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(account.main.getByRole('heading', { level: 2 })).toHaveText([
    t('account.page.profile.title'),
    t('account.page.password.title'),
    t('buddies.title'),
    t('account.feed.title'),
    t('vision.setting.title'),
    t('similar.setting.title'),
    t('account.page.diagnostics.title'),
    t('feedback.title'),
    t('account.page.session.title'),
    t('account.delete.title'),
  ]);
  await expect(account.main.getByText(signedIn.displayName, { exact: true })).toBeVisible();
  await expect(account.main.getByText(signedIn.email, { exact: true })).toBeVisible();
  await expect(account.main.getByText(t('account.page.session.body'))).toBeVisible();
  for (const button of [account.changePassword, account.deleteAccount, account.signOut]) await expect(button).toBeEnabled();
  // The header names the page it is on.
  if (shell.phone) await shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }).click();
  await expect(
    shell.header.getByRole('link', { name: shell.phone ? t('account.page.title') : t('header.accountLink', { name: signedIn.displayName }) }),
  ).toHaveAttribute('aria-current', 'page');
});

test('the footer keeps the site-level items for a member and for a guest, and no account links', async ({ page, shell, signedIn, browser, baseURL }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const guest = await browser.newContext({ baseURL });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto('/#/');
    for (const footer of [shell.footer, guestPage.locator('footer')]) {
      await expect(footer.getByRole('button', { name: t('account.contact.show') })).toBeVisible();
      await expect(footer.getByRole('link', { name: t('terms.title') })).toBeVisible();
      await expect(footer.getByText(startsWith(t('app.version', { version: '' })))).toBeVisible();
      await expect(footer.getByRole('button', { name: t('account.password.title') })).toHaveCount(0);
      await expect(footer.getByRole('button', { name: t('account.delete.title') })).toHaveCount(0);
    }
  } finally {
    await guest.close();
  }
});

test('a guest on the account page gets the sign-in prompt and no account actions', async ({ page, shell, signedIn: _, context }) => {
  await context.clearCookies();
  await shell.open('#/account');
  const account = new AccountPage(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(account.main.getByRole('heading', { level: 2, name: t('account.page.signIn') })).toBeVisible();
  await expect(account.changePassword).toHaveCount(0);
  await expect(account.deleteAccount).toHaveCount(0);
});

test('a deep link to the account page shows loading, never the sign-in prompt, while the session is still being asked for', async ({ page }) => {
  // Records whether the prompt was in the page at any moment, not only at the end.
  await page.addInitScript((prompt: string) => {
    new MutationObserver(() => {
      if (document.querySelector('main')?.innerText.includes(prompt)) (window as unknown as { sawPrompt: boolean }).sawPrompt = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, t('account.page.signIn'));
  let answer = () => {};
  const answered = new Promise<void>((done) => (answer = done));
  await mockApi(page, {
    answers: {
      'GET /api/auth/me': async (route) => {
        await answered;
        await route.fulfill({ json: MOCK_USER });
      },
    },
  });
  await page.goto('/#/account');
  const account = new AccountPage(page);
  await account.expectShown();
  await expect(account.main.getByText(t('route.loading'))).toBeVisible();
  answer();
  await expect(account.main.getByText(MOCK_USER.email, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sawPrompt?: boolean }).sawPrompt === true)).toBe(false);
});

test('Sign out on the page ends the session, shows Explore and puts focus on Sign in', async ({ page, shell, signedIn }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await new AccountPage(page).signOut.click();
  await shell.expectGuest();
  await expect(page).toHaveURL(/#\/$/);
  await expect(shell.signInButton()).toBeFocused();
});

test('Sign out in the header (the account menu on phones) also puts focus on Sign in', async ({ page, shell }) => {
  await mockApi(page);
  await shell.open('#/clubs');
  await shell.expectSignedIn(MOCK_USER.displayName);
  await shell.signOut();
  await shell.expectGuest();
  await expect(shell.signInButton()).toBeFocused();
});

test('cancelling the deletion returns focus to its button; confirming deletes the account and signs out', async ({ page, shell, signedIn }) => {
  const account = new AccountPage(page);
  const dialog = page.getByRole('dialog', { name: t('account.delete.title') });
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  await account.deleteAccount.click();
  await dialog.getByRole('button', { name: t('account.delete.cancel') }).click();
  await expect(dialog).toBeHidden();
  await expect(account.deleteAccount).toBeFocused();

  await account.deleteAccount.click();
  await dialog.getByLabel(t('auth.password')).fill('not the password');
  await dialog.getByLabel(t('account.delete.understand')).check();
  await dialog.getByRole('button', { name: t('account.delete.confirm') }).click();
  await expect(dialog.getByRole('alert')).toHaveText(t('errors.deleteAccountPassword'));
  await shell.expectSignedIn(signedIn.displayName);

  await dialog.getByLabel(t('auth.password')).fill(signedIn.password);
  await dialog.getByRole('button', { name: t('account.delete.confirm') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('notices.accountDeleted'))).toBeVisible();
  await shell.expectGuest();
});

test.describe('offline', () => {
  test('changing the password and deleting the account are disabled with their notes; signing out still works', async ({ page, shell, context }) => {
    await mockApi(page);
    await shell.open('#/account');
    await shell.expectSignedIn(MOCK_USER.displayName);
    await page.waitForLoadState('networkidle');
    const account = new AccountPage(page);
    await expect(account.changePassword).toBeEnabled();
    await context.setOffline(true);
    await expect(account.changePassword).toBeDisabled();
    await expect(account.deleteAccount).toBeDisabled();
    await expect(account.main.getByText(t('account.page.password.offline'))).toBeVisible();
    await expect(account.main.getByText(t('account.page.delete.offline'))).toBeVisible();
    await expect(account.signOut).toBeEnabled();
    await account.signOut.click();
    await shell.expectGuest();
  });
});

test.describe('with changed terms', () => {
  test('the blocking terms keep their own Delete account, and Cancel returns to them', async ({ page }) => {
    await mockApi(page, { user: { ...MOCK_USER, acceptedTermsVersion: '2000-01-01.1' } });
    await page.goto('/#/account');
    const terms = page.getByRole('dialog', { name: t('terms.update.title') });
    await expect(terms).toBeVisible();
    await terms.getByRole('button', { name: t('account.delete.title') }).click();
    const dialog = page.getByRole('dialog', { name: t('account.delete.title') });
    await expect(dialog).toBeVisible();
    await expect(terms).toBeHidden();
    await dialog.getByRole('button', { name: t('account.delete.cancel') }).click();
    await expect(terms).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test('the account menu has an Account entry; following it closes the menu and returns focus to its button', async ({ page, shell, signedIn, isMobile }) => {
    test.skip(!isMobile, 'the account menu is a phone control');
    await shell.open();
    const menu = shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) });
    await menu.click();
    await shell.header.getByRole('link', { name: t('account.page.title'), exact: true }).click();
    await new AccountPage(page).expectShown();
    await expect(shell.header.getByRole('link', { name: t('account.page.title'), exact: true })).toHaveCount(0);
    await expect(menu).toBeFocused();
    // Sign out stays in the menu.
    await menu.click();
    await expect(shell.header.getByRole('button', { name: t('header.signOut') })).toBeVisible();
  });

  test('every control of the page and of the menu is a 44 px touch target', async ({ page, shell, signedIn, isMobile }) => {
    test.skip(!isMobile, 'touch sizes are a phone rule');
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    const account = new AccountPage(page);
    const small = async (locators: Locator[]) => {
      const sizes = await Promise.all(locators.map(async (locator) => (await locator.boundingBox()) ?? { width: 0, height: 0 }));
      return sizes.filter((box) => box.width < 44 || box.height < 44);
    };
    expect(await small([account.changePassword, account.deleteAccount, account.signOut])).toEqual([]);
    await shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }).click();
    expect(
      await small([
        shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }),
        shell.header.getByRole('link', { name: t('account.page.title'), exact: true }),
        shell.header.getByRole('button', { name: t('header.signOut') }),
      ]),
    ).toEqual([]);
  });
});

test.describe('on a wide screen', () => {
  test('the name link marks the account page as current and the sections form one column', async ({ page, shell, signedIn, isMobile }) => {
    test.skip(isMobile, 'phones use the account menu');
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    const link = shell.header.getByRole('link', { name: t('header.accountLink', { name: signedIn.displayName }) });
    await expect(link).toHaveAttribute('aria-current', 'page');
    const sections = await new AccountPage(page).main
      .locator('section')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(sections).size).toBe(1);
  });
});
