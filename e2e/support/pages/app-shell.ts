import { expect, type Locator, type Page } from '@playwright/test';
import { startsWith, t } from '../i18n';

/** The header with the account controls, and the footer. */
export class AppShell {
  readonly header: Locator;
  readonly footer: Locator;

  constructor(
    readonly page: Page,
    readonly phone: boolean,
  ) {
    this.header = page.getByRole('banner');
    // Inside <main>, the footer is no contentinfo landmark.
    this.footer = page.locator('footer');
  }

  /** Opens a hash route and waits until the app has settled its session (signed in or guest). */
  async open(hash = '#/'): Promise<void> {
    await this.page.goto('/' + hash);
    await expect(this.signInButton().or(this.signedInMarker())).toBeVisible();
  }

  signInButton(): Locator {
    return this.header.getByRole('button', { name: t(this.phone ? 'common.signIn' : 'common.signInOrJoin'), exact: true });
  }

  /** The account menu button on phones, the Sign out button on wide screens. */
  private signedInMarker(): Locator {
    if (!this.phone) return this.header.getByRole('button', { name: t('header.signOut') });
    return this.header.getByRole('button', { name: startsWith(t('header.accountMenu', { name: '' })) });
  }

  async expectSignedIn(name: string): Promise<void> {
    if (this.phone) await expect(this.header.getByRole('button', { name: t('header.accountMenu', { name }) })).toBeVisible();
    else await expect(this.header.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible();
  }

  async expectGuest(): Promise<void> {
    await expect(this.signInButton()).toBeVisible();
  }

  /** Opens the account page from the header: the name is a link on wide screens, the account menu has an Account entry on phones. */
  async openAccountPage(name: string): Promise<void> {
    if (this.phone) {
      await this.header.getByRole('button', { name: t('header.accountMenu', { name }) }).click();
      await this.header.getByRole('link', { name: t('account.page.title'), exact: true }).click();
    } else await this.header.getByRole('link', { name: t('header.accountLink', { name }) }).click();
    await expect(this.page.getByRole('main').getByRole('heading', { level: 1, name: t('account.page.title'), exact: true })).toBeVisible();
  }

  /** Opens the feedback dialog: the account menu's entry on phones, the header's icon button on wide screens. */
  async openFeedback(): Promise<Locator> {
    if (this.phone) {
      await this.signedInMarker().click();
      await this.header.getByRole('button', { name: t('feedback.open'), exact: true }).click();
    } else await this.header.getByRole('button', { name: t('feedback.open'), exact: true }).click();
    const dialog = this.page.getByRole('dialog', { name: t('feedback.title') });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  /** Sign out from the header, through the account menu on phones. */
  async signOut(): Promise<void> {
    await this.signedInMarker().click();
    if (this.phone) await this.header.getByRole('button', { name: t('header.signOut') }).click();
  }
}
