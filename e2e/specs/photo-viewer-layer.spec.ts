import type { Locator } from '@playwright/test';
import { BISQUE_STEP, type Api } from '../support/api';
import { t } from '../support/i18n';
import { photoPng } from '../support/images';
import { expect, test } from '../support/test';

// The reporter's desktop window; the phone project keeps its own.
test.beforeEach(async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1361, height: 1227 });
});

// A full-screen layer (the photo viewer, a dialog) opened from a detail page's gallery covers the whole window above everything on the
// page, also while the page is scrolled and the gallery sticks: the gallery column is a stacking context of its own, and the cards and
// badges after it once painted over the viewer.

/** A glaze used by five combinations, each with a test tile and a finished piece, and a photo of its own. */
async function glazeWithFiveCombinations(api: Api, uid: string) {
  const glaze = await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` }, code: 'CE-1', name: 'Layer' });
  const titles = [];
  for (let index = 0; index < 5; index++) {
    const title = `Combo ${index} ${uid}`;
    const id = await api.addCombination({ title, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }, BISQUE_STEP] });
    await api.uploadToCombination(id, { file: photoPng(`tile${index}.png`, 480, 640), kind: 'TEST_TILE' });
    await api.uploadToCombination(id, { file: photoPng(`piece${index}.png`, 640, 480), kind: 'FINISHED', caption: `Piece ${index}` });
    titles.push(title);
  }
  await api.uploadToGlaze(glaze.id, { file: photoPng('own.png', 600, 800) });
  return { id: glaze.id, title: `Botz ${uid} CE-1 Layer`, combinations: titles };
}

/** Centres of the controls a layer must cover (the combination cards' photo buttons), read before it opens. */
async function centresOf(controls: Locator) {
  const centres: Array<[number, number]> = [];
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    if (box) centres.push([box.x + box.width / 2, box.y + box.height / 2]);
  }
  return centres;
}

/**
 * The open dialog's backdrop fills the window (all but the page's scrollbar, which only the viewer hides), and the topmost element at a
 * grid of points (with the top rows and the given centres) is the backdrop or inside it.
 */
async function expectCoversWindow(dialog: Locator, centres: Array<[number, number]>) {
  await expect(dialog).toBeVisible();
  const missed = await dialog.evaluate((node, extra) => {
    const layer = node.parentElement!;
    const box = layer.getBoundingClientRect();
    const { width, height } = box;
    const misses: string[] = [];
    if (Math.round(box.left) !== 0 || Math.round(box.top) !== 0 || Math.round(height) !== innerHeight || width < innerWidth - 24)
      misses.push(`box ${JSON.stringify(box)} for ${innerWidth} x ${innerHeight}`);
    const points: Array<[number, number]> = [...extra];
    for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) points.push([((column + 0.5) * width) / 8, ((row + 0.5) * height) / 8]);
    for (const y of [2, 40, 150, 300]) for (const x of [2, width / 3, (2 * width) / 3, width - 2]) points.push([x, y]);
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !layer.contains(hit)) misses.push(`${Math.round(x)},${Math.round(y)}: ${hit?.outerHTML.slice(0, 80)}`);
    }
    return misses;
  }, centres);
  expect(missed).toEqual([]);
}

test('the glaze gallery viewer opened on a scrolled page covers the window, the combination cards included', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await glazeWithFiveCombinations(api, uid);
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const covers = main.getByRole('button', { name: t('images.cover.open', { title: glaze.combinations[0] }).replace(glaze.combinations[0], '') });
  await expect(covers.nth(3)).toBeVisible();
  await covers.last().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const centres = await centresOf(covers);

  await main
    .getByRole('region', { name: t('images.gallery', { title: glaze.title }) })
    .getByRole('group', { name: /^Photo 1 of \d+$/ })
    .click();
  const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title: glaze.title }) });
  await expectCoversWindow(viewer, centres);
});

test('the glaze gallery viewer opened at the top of the page covers the window', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await glazeWithFiveCombinations(api, uid);
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const covers = main.getByRole('button', { name: t('images.cover.open', { title: glaze.combinations[0] }).replace(glaze.combinations[0], '') });
  await expect(covers.nth(3)).toBeVisible();
  const centres = await centresOf(covers);
  await main
    .getByRole('region', { name: t('images.gallery', { title: glaze.title }) })
    .getByRole('group', { name: /^Photo 1 of \d+$/ })
    .click();
  await expectCoversWindow(page.getByRole('dialog', { name: t('images.viewer.label', { title: glaze.title }) }), centres);
});

test('a combination card viewer opened on the scrolled glaze page covers the window', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await glazeWithFiveCombinations(api, uid);
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const title = glaze.combinations[4];
  const cover = main.getByRole('button', { name: t('images.cover.open', { title }) });
  await cover.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 100));
  await cover.click();
  await expectCoversWindow(page.getByRole('dialog', { name: t('images.viewer.label', { title }) }), []);
});

test('a dialog opened from the scrolled glaze gallery covers the combination cards', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await glazeWithFiveCombinations(api, uid);
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const covers = main.getByRole('button', { name: t('images.cover.open', { title: glaze.combinations[0] }).replace(glaze.combinations[0], '') });
  await expect(covers.nth(3)).toBeVisible();
  await covers.last().scrollIntoViewIfNeeded();
  const centres = await centresOf(covers);
  await main
    .getByRole('button', { name: t('catalog.addPhoto') })
    .first()
    .click();
  await expectCoversWindow(page.getByRole('dialog'), centres);
});

test('the combination gallery viewer opened on a scrolled page covers the window', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` }, code: 'CE-1', name: 'Row' });
  await api.uploadToGlaze(glaze.id, { file: photoPng('jar.png', 600, 800) });
  const title = `Layered ${uid}`;
  const id = await api.addCombination({
    title,
    steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }, BISQUE_STEP],
    description: 'Thick at the rim, thin at the foot. '.repeat(30),
  });
  await api.uploadToCombination(id, { file: photoPng('tile.png', 600, 800), kind: 'TEST_TILE' });
  await api.uploadToCombination(id, { file: photoPng('piece.png', 800, 600), kind: 'FINISHED' });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await page.evaluate(() => window.scrollBy(0, 400));
  await main
    .getByRole('region', { name: t('images.gallery', { title }) })
    .getByRole('group', { name: /^Photo 1 of \d+$/ })
    .click();
  await expectCoversWindow(page.getByRole('dialog', { name: t('images.viewer.label', { title }) }), []);
});
