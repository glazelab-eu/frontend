import type { Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { photoPng, png } from '../support/images';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/** The detail gallery's one meta line (kind · uploader …) and its photo menu. */
function galleryOf(page: Page, title: string) {
  const gallery = page.getByRole('main').getByRole('region', { name: t('images.gallery', { title }) });
  return { gallery, line: gallery.locator('.picture-meta__line'), menu: gallery.getByRole('button', { name: t('images.menu.label') }) };
}

/** Opens "Change type" from the photo menu, picks `label` and saves; the dialog closes on success. */
async function changeType(page: Page, title: string, label: string) {
  const { menu } = galleryOf(page, title);
  await menu.click();
  await page.getByRole('menuitem', { name: t('images.menu.kind') }).click();
  const dialog = page.getByRole('dialog', { name: t('images.menu.kind') });
  await dialog.getByLabel(t('upload.kind')).selectOption({ label });
  await dialog.getByRole('button', { name: t('images.kindChange.save') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: t('notices.photoKindChanged') })).toBeVisible();
}

test('the uploader changes a combination photo from test tile to finished piece, and it stays after a reload', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}, info) => {
  const title = `Retype ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { line, menu } = galleryOf(page, title);
  await expect(line).toHaveText(`${t('images.kind.tile')} · ${t('images.uploader.own')}`);
  // A combination photo is never offered as packaging; work in progress is.
  await menu.click();
  await page.getByRole('menuitem', { name: t('images.menu.kind') }).click();
  const dialog = page.getByRole('dialog', { name: t('images.menu.kind') });
  const options = await dialog.getByLabel(t('upload.kind')).locator('option').allTextContents();
  expect(options).toEqual([t('images.kind.tile'), t('images.kind.finished'), t('images.kind.inProgress')]);
  // The current kind cannot be saved again.
  await expect(dialog.getByRole('button', { name: t('images.kindChange.save') })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('change-type-dialog.png') });
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  await expect(menu).toBeFocused();

  await changeType(page, title, t('images.kind.finished'));
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')}`);
  await expect(page.getByRole('img', { name: t('images.alt.finished', { title }) })).toBeVisible();
  await expect(menu).toBeFocused();

  await page.goto('about:blank');
  await shell.open(`#/combinations/${id}`);
  await expect(galleryOf(page, title).line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')}`);
  await page.getByRole('group', { name: t('images.viewer.open') }).click();
  const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
  await expect(viewer.locator('.picture-meta__line')).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader.own')}`);
  await page.screenshot({ path: info.outputPath('viewer-after-change.png') });
});

test("a site admin changes another member's photo type", async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const title = `Admin retype ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP] });
  await author.uploadToCombination(id, { file: photoPng('shared.png', 480, 360) });
  await grantSiteAdmin(signedIn.email);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { line } = galleryOf(page, title);
  await expect(line).toHaveText(`${t('images.kind.tile')} · ${t('images.uploader', { name: 'Cleo' })}`);
  await changeType(page, title, t('images.kind.inProgress'));
  await expect(line).toHaveText(`${t('images.kind.inProgress')} · ${t('images.uploader', { name: 'Cleo' })}`);
  await expect(page.getByRole('img', { name: t('images.alt.inProgress', { title }) })).toBeVisible();
});

test('another member has no Change type, and sees the uploader’s change after the next refresh', async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const title = `Watch ${uid}`;
  const id = await author.addCombination({ title, steps: [BISQUE_STEP] });
  const photo = await author.uploadToCombination(id, { file: photoPng('shared.png', 480, 360) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const { gallery, line } = galleryOf(page, title);
  await expect(line).toHaveText(`${t('images.kind.tile')} · ${t('images.uploader', { name: 'Cleo' })}`);
  // Only Report: the one icon button, no menu and no type change.
  await expect(gallery.getByRole('button', { name: t('images.menu.report') })).toBeVisible();
  await expect(gallery.getByRole('button', { name: t('images.menu.label') })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: t('images.menu.kind') })).toHaveCount(0);
  // The uploader changes it on another device; this page's next delta brings it.
  await author.changeImageKind(photo.id, 'FINISHED');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(line).toHaveText(`${t('images.kind.finished')} · ${t('images.uploader', { name: 'Cleo' })}`);
});

test('a photo uploaded as work in progress says so, and a glaze never offers that kind', async ({ page, shell, api, signedIn, uid, encoder }) => {
  void encoder;
  const title = `Progress ${uid}`;
  // Seeded before the first load: the app reads its lists once.
  const glaze = await api.addGlaze({ newManufacturer: { name: `Maker ${uid}`, shortId: `${uid}1` }, code: 'P-1', name: 'Blue' });
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('images.addTestTile') })
    .first()
    .click();
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await upload.getByLabel(t('upload.library')).setInputFiles(png('glazed.png'));
  await upload.getByLabel(t('upload.kind')).selectOption({ label: t('images.kind.inProgress') });
  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  await expect(galleryOf(page, title).line).toHaveText(`${t('images.kind.inProgress')} · ${t('images.uploader.own')}`);
  await expect(page.getByRole('img', { name: t('images.alt.inProgress', { title }) })).toBeVisible();

  await shell.open(`#/glazes/${glaze.id}`);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('catalog.addPhoto') })
    .first()
    .click();
  const glazeUpload = page.getByRole('dialog').filter({ has: page.getByLabel(t('upload.library')) });
  await glazeUpload.getByLabel(t('upload.library')).setInputFiles(png('jar.png'));
  const kinds = await glazeUpload.getByLabel(t('upload.kind')).locator('option').allTextContents();
  expect(kinds).toEqual([t('images.kind.tile'), t('images.kind.finished'), t('images.kind.packaging')]);
});
