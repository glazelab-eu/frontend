import { expect, type Locator } from '@playwright/test';
import { t } from '../i18n';

type Files = Parameters<Locator['setInputFiles']>[0];

/** The visible texts the steps need; another language passes its own dictionary's. */
export interface UploadLabels {
  library: string;
  kind: string;
  finished: string;
}

const english = (): UploadLabels => ({ library: t('upload.library'), kind: t('upload.kind'), finished: t('images.kind.finished') });

/**
 * Chooses photos in the upload dialog and marks each new one as a finished piece: the dialog starts every file at Test tile,
 * and only finished pieces are analysed for photo suggestions. Files are images, so each adds one row.
 */
export async function attachFinished(dialog: Locator, files: Files, labels: UploadLabels = english()) {
  const kinds = dialog.getByLabel(labels.kind, { exact: true });
  const before = await kinds.count();
  const added = Array.isArray(files) ? files.length : 1;
  await dialog.getByLabel(labels.library).setInputFiles(files);
  await expect(kinds).toHaveCount(before + added);
  for (let row = before; row < before + added; row++) await kinds.nth(row).selectOption({ label: labels.finished });
}
