import { expect, type Locator, type Page } from '@playwright/test';
import { t } from '../i18n';

/** The account page (#/account): its sections and the buttons that open the password and deletion dialogs. */
export class AccountPage {
  readonly main: Locator;
  readonly changePassword: Locator;
  readonly deleteAccount: Locator;
  readonly signOut: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.changePassword = this.main.getByRole('button', { name: t('account.password.title') });
    this.deleteAccount = this.main.getByRole('button', { name: t('account.delete.title') });
    this.signOut = this.main.getByRole('button', { name: t('header.signOut') });
  }

  heading(): Locator {
    return this.main.getByRole('heading', { level: 1, name: t('account.page.title'), exact: true });
  }

  section(title: string): Locator {
    return this.main.getByRole('heading', { level: 2, name: title, exact: true });
  }

  async expectShown(): Promise<void> {
    await expect(this.heading()).toBeVisible();
  }
}
