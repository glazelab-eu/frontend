import { expect, type Locator, type Page } from '@playwright/test';
import { startsWith, t } from '../i18n';

/** The account page's Change password button and its dialog: open the account page first (`AppShell.openAccountPage` or `#/account`). */
export class PasswordDialog {
  readonly dialog: Locator;
  readonly opener: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: t('account.password.title') });
    this.opener = page.getByRole('main').getByRole('button', { name: t('account.password.title') });
  }

  current(): Locator {
    return this.dialog.getByLabel(t('account.password.current'));
  }

  async open(): Promise<void> {
    await this.opener.click();
    await expect(this.dialog).toBeVisible();
  }

  /** Fills the three fields and sends the form; `confirmation` defaults to the new password. */
  async submit(current: string, next: string, confirmation = next): Promise<void> {
    await this.current().fill(current);
    // Its hint is part of its name.
    await this.dialog.getByLabel(startsWith(t('account.password.new'))).fill(next);
    await this.dialog.getByLabel(t('account.password.confirm')).fill(confirmation);
    await this.dialog.getByRole('button', { name: t('account.password.save') }).click();
  }
}
