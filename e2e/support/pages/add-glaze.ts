import { expect, type Locator, type Page } from '@playwright/test';
import { startsWith, t, type MessageKey } from '../i18n';

export interface NewGlazeEntry {
  manufacturer: string;
  shortId: string;
  name: string;
  code: string;
  barcode?: string;
}

/** The add-glaze dialog of Explore, Shelf and Studio. */
export class AddGlazeDialog {
  readonly dialog: Locator;
  readonly discardQuestion: Locator;

  constructor(readonly page: Page) {
    // Plain title, or "New glaze for barcode …" when a scan opened it.
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const [before, after] = t('addGlaze.titleBarcode', { barcode: '\u0000' }).split('\u0000');
    this.dialog = page.getByRole('dialog', { name: new RegExp(`^(${escape(t('stock.newGlaze.title'))}|${escape(before)}\\d+${escape(after)})$`) });
    this.discardQuestion = page.getByRole('dialog', { name: t('drafts.discardGlaze') });
  }

  /** The barcode scanner "Add a glaze" opens first on a phone. */
  get scanner(): Locator {
    return this.page.getByRole('dialog', { name: t('addGlaze.scanTitle') });
  }

  /**
   * Presses the first "Add a glaze" button of the page. Where the scanner comes first (a coarse pointer with a camera),
   * "Add without a barcode" follows, so the dialog is open afterwards either way.
   */
  async openFromExplore(): Promise<void> {
    await this.page
      .getByRole('main')
      .getByRole('button', { name: t('addGlaze.action') })
      .first()
      .click();
    if (await this.scanner.isVisible()) await this.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode') }).click();
  }

  /** A field by the start of its label (labels also hold hints and "optional"). */
  field(label: MessageKey): Locator {
    return this.dialog.getByLabel(startsWith(t(label)));
  }

  async fill(glaze: NewGlazeEntry): Promise<void> {
    await this.dialog.getByRole('button', { name: t('glazeForm.addManufacturer') }).click();
    await this.field('glazeForm.newManufacturerName').fill(glaze.manufacturer);
    await this.field('glazeForm.shortId').fill(glaze.shortId);
    await this.field('stock.newGlaze.name').fill(glaze.name);
    await this.field('stock.newGlaze.code').fill(glaze.code);
    if (glaze.barcode) await this.field('barcodes.field').fill(glaze.barcode);
  }

  async submit(): Promise<void> {
    await this.dialog.getByRole('button', { name: t('stock.newGlaze.submit'), exact: true }).click();
  }

  async close(): Promise<void> {
    await this.dialog.getByRole('button', { name: t('common.close'), exact: true }).click();
  }

  async expectAdded(): Promise<Locator> {
    const added = this.page.getByRole('dialog', { name: t('addGlaze.addedTitle') });
    await expect(added).toBeVisible();
    return added;
  }
}
