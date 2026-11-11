import { expect, type Locator, type Page } from '@playwright/test';
import { withEncoder } from '../encoder-lock';
import { t } from '../i18n';
import type { AppShell } from './app-shell';

/** The profile picture of the account page (#/account, Profile section) and its crop and removal dialogs. */
export class AvatarSection {
  readonly main: Locator;
  readonly picture: Locator;
  /** The persistent line under the picture: who can see it. */
  readonly visible: Locator;
  readonly choose: Locator;
  readonly remove: Locator;
  readonly crop: Locator;
  readonly stage: Locator;
  readonly save: Locator;
  readonly removal: Locator;

  constructor(readonly page: Page) {
    this.main = page.getByRole('main');
    this.picture = this.main.getByRole('img', { name: t('account.avatar.label') });
    this.visible = this.main.getByText(t('account.avatar.visible'), { exact: true });
    // The file input sits inside the button-like label: its name is the label's text (Choose photo, or Change photo with a picture).
    this.choose = this.main.getByLabel(new RegExp(`${t('account.avatar.choose')}|${t('account.avatar.change')}`));
    this.remove = this.main.getByRole('button', { name: t('account.avatar.remove') });
    this.crop = page.getByRole('dialog', { name: t('account.avatar.dialog.title') });
    this.stage = this.crop.getByRole('button', { name: t('account.avatar.stage') });
    this.save = this.crop.getByRole('button', { name: t('account.avatar.save') });
    this.removal = page.getByRole('dialog', { name: t('account.avatar.remove.title') });
  }

  /** The loaded picture inside the section (an `img` in a decorative frame the roles cannot name). */
  shownPicture(): Locator {
    return this.picture.locator('img');
  }

  /** The picture in the account control (the page's header, or the phone's account button): the logo is the only other image there. */
  headerPicture(shell: AppShell): Locator {
    return shell.header.locator('img[src^="blob:"]');
  }

  /** A file from a buffer, or a file on disk by its path (a large one: a buffer goes through the browser protocol). */
  async pick(file: { name: string; mimeType: string; buffer: Buffer } | string): Promise<void> {
    await this.choose.setInputFiles(file);
  }

  /** Presses Save under the API's encoder lock and answers the new picture's ID. */
  async send(): Promise<string> {
    return withEncoder(async () => {
      const answer = this.page.waitForResponse((response) => response.url().endsWith('/api/avatars') && response.request().method() === 'POST');
      await this.save.click();
      const response = await answer;
      expect(response.status()).toBe(200);
      return ((await response.json()) as { id: string }).id;
    });
  }
}

/** The stored picture as the browser decodes it: its size and the colour at some points (fractions of its width and height). */
export async function decoded(page: Page, id: string, points: Array<[number, number]>) {
  return page.evaluate(
    async ({ id, points }) => {
      const response = await fetch(`/api/avatars/${id}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        colours: points.map(([x, y]) => [
          ...context
            .getImageData(Math.min(bitmap.width - 1, Math.floor(x * bitmap.width)), Math.min(bitmap.height - 1, Math.floor(y * bitmap.height)), 1, 1)
            .data.slice(0, 3),
        ]),
      };
    },
    { id, points },
  );
}
