import { expect, type Locator, type Page } from '@playwright/test';
import type { Account } from '../api';
import { t } from '../i18n';

/** The sign-in and sign-up dialog, and the password step a mail-free sign-up continues with. */
export class AuthDialog {
  readonly dialog: Locator;
  readonly setup: Locator;

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    this.setup = page.getByRole('dialog', { name: t('account.link.setupTitle') });
  }

  async signIn(account: Account): Promise<void> {
    await this.dialog.getByLabel(t('common.email')).fill(account.email);
    await this.dialog.getByLabel(t('auth.password')).fill(account.password);
    await this.dialog.getByRole('button', { name: t('common.signIn'), exact: true }).click();
    await expect(this.dialog).toBeHidden();
  }

  /** Fills and sends the sign-up form (email and name only); a mail-free server continues with the password step. */
  async register(account: Account): Promise<void> {
    await this.dialog.getByRole('button', { name: t('auth.register.switch') }).click();
    await this.dialog.getByLabel(t('auth.name')).fill(account.displayName);
    await this.dialog.getByLabel(t('common.email')).fill(account.email);
    await this.dialog.getByRole('button', { name: t('auth.register.submit') }).click();
  }

  /** The password step activates the account: the password twice and the terms accepted (error reports left off). */
  async choosePassword(password: string): Promise<void> {
    await this.setup.getByLabel(t('account.link.newPassword')).fill(password);
    await this.setup.getByLabel(t('account.link.confirmPassword')).fill(password);
    await this.setup.getByLabel(t('auth.terms.accept')).check();
    await this.setup.getByRole('button', { name: t('account.link.activate') }).click();
    await expect(this.setup).toBeHidden();
  }
}
