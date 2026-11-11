import { expect, type Locator, type Page } from '@playwright/test';
import { t } from '../i18n';

/** Studio: a new combination, a variation or an edit. */
export class StudioPage {
  readonly main: Locator;
  readonly title: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.title = this.main.getByLabel(t('studio.titleLabel'));
  }

  async addGlazeStep(glaze: string): Promise<void> {
    await this.main
      .getByRole('button', { name: t('studio.addGlazeStep') })
      .last()
      .click();
    const picker = this.main.getByRole('combobox', { name: t('common.glaze') }).last();
    await picker.fill(glaze);
    await this.page
      .getByRole('option', { name: new RegExp(glaze) })
      .first()
      .click();
    await expect(picker).not.toHaveAttribute('aria-invalid', 'true');
  }

  async publish(): Promise<void> {
    await this.main.getByRole('button', { name: t('combination.publish'), exact: true }).click();
  }

  async saveDraft(): Promise<void> {
    await this.main.getByRole('button', { name: t('studio.saveDraft'), exact: true }).click();
  }
}
