import type { Locator } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { photoPng } from '../support/images';
import { expectStuckBelowHeader, headerHeight } from '../support/header';
import { eanFor } from '../support/barcodes';
import { expect, newAccount, test } from '../support/test';

/** Where a control stands on the page. */
async function at(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The control is not on the page');
  return box;
}

/** A glaze of its own manufacturer, so a test finds it by its title. */
async function newGlaze(api: import('../support/api').Api, uid: string, name: string) {
  const created = await api.addGlaze({
    newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` },
    code: 'CE-1',
    name,
    notes: 'Cone 6, glossy and translucent.',
  });
  return { id: created.id, title: `Botz ${uid} CE-1 ${name}` };
}

test('from 45em the gallery stands left and the glaze with its combinations right, the gallery follows the page, a phone has one column', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const glaze = await newGlaze(api, uid, 'Celadon');
  await api.uploadToGlaze(glaze.id, { file: photoPng('tile.png', 600, 800) });
  for (let index = 0; index < 6; index++) {
    await api.addCombination({ title: `Combo ${index} ${uid}`, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }, BISQUE_STEP], tags: ['cone-6'] });
  }
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const heading = main.getByRole('heading', { level: 1, name: 'Celadon' });
  const gallery = main.getByRole('region', { name: t('images.gallery', { title: glaze.title }) });
  const add = main.getByRole('button', { name: t('catalog.addPhoto') });
  const record = main.getByRole('link', { name: t('glaze.recordCombination') });
  const combinations = main.getByRole('heading', { level: 2, name: t('glaze.combinations.title') });
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title: glaze.title }) })).toBeVisible();
  const [media, text, button] = [await at(gallery), await at(heading), await at(add)];
  const wide = page.viewportSize()!.width >= 720;
  if (wide) {
    // The gallery with its photo button on the left, the title at the top of the right column, level with the photo.
    expect(media.x + media.width).toBeLessThanOrEqual(text.x);
    expect(button.x + button.width).toBeLessThanOrEqual(text.x);
    expect(text.y).toBeLessThan(media.y + 100);
    const card = main.locator('article').first();
    await expect(card).toHaveCSS('overflow-x', 'clip');
    const cardBox = await at(card);
    expect(media.width / cardBox.width).toBeGreaterThan(0.45);
    expect(media.width / cardBox.width).toBeLessThan(0.55);
    // The action row and the combinations are in the right column too, in the decided order.
    const [recordBox, headingBox] = [await at(record), await at(combinations)];
    expect(recordBox.x).toBeGreaterThanOrEqual(text.x);
    expect(recordBox.y).toBeGreaterThan(text.y);
    expect(headingBox.y).toBeGreaterThan(recordBox.y);
    expect(headingBox.x).toBeGreaterThanOrEqual(text.x);
    // The gallery follows the page while the combinations scroll (where the window is tall enough for all of it).
    if (page.viewportSize()!.height >= 768) {
      await page.evaluate(() => scrollTo(0, 500));
      // 1 rem below the sticky header (a header slid away by the scroll, under 70em, leaves the whole gap above the window's top).
      await expectStuckBelowHeader(page, gallery);
      expect((await at(heading)).y).toBeLessThan(0);
    }
  } else {
    // One column: photo, the photo button, then the glaze, the action row and the combinations.
    expect(button.y).toBeGreaterThan(media.y);
    expect(text.y).toBeGreaterThan(button.y);
    expect((await at(record)).y).toBeGreaterThan(text.y);
    expect((await at(combinations)).y).toBeGreaterThan((await at(record)).y);
    expect(Math.abs(media.x - text.x)).toBeLessThan(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('the page keeps About, tags and codes before the related-combination preview', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Order');
  await api.addCombination({ title: `Uses ${uid}`, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 1 }], tags: ['cone-6'] });
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Order' })).toBeVisible();
  const y = async (locator: Locator) => (await at(locator)).y;
  const order = [
    main.getByRole('heading', { level: 1 }),
    main.getByRole('link', { name: t('glaze.recordCombination') }),
    main.getByRole('heading', { level: 2, name: t('glaze.details.title') }),
    main.getByRole('button', { name: t('tags.addFirst') }).or(main.getByRole('button', { name: t('tags.edit') })),
    main.getByText(t('barcodes.label'), { exact: true }).first(),
    main.getByRole('heading', { level: 2, name: t('glaze.combinations.title') }),
  ];
  const ys: number[] = [];
  for (const locator of order) ys.push(await y(locator));
  expect(ys).toEqual([...ys].sort((first, second) => first - second));
  await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(main.getByRole('heading', { level: 2 })).toHaveText([
    t('glaze.details.title'),
    t('tags.label'),
    t('barcodes.label'),
    t('glaze.combinations.title'),
  ]);
  // About this glaze keeps its Edit and History buttons.
  await expect(main.getByRole('button', { name: t('glaze.details.history') })).toBeVisible();
});

test('removing a barcode keeps the keyboard focus in the editor', async ({ page, shell, api, signedIn, uid }) => {
  const [first, second] = [eanFor(`${uid}-a`), eanFor(`${uid}-b`)];
  const created = await api.addGlaze({ newManufacturer: { name: `Botz ${uid}`, shortId: `${uid}1` }, code: 'CE-2', name: 'Codes', barcode: first });
  await shell.open(`#/glazes/${created.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t('barcodes.editLabel'), exact: true }).click();
  const input = main.getByRole('textbox', { name: t('barcodes.add') });
  await input.fill(second);
  await input.press('Enter');
  const removeFirst = main.getByRole('button', { name: t('barcodes.remove', { barcode: first }) });
  const removeSecond = main.getByRole('button', { name: t('barcodes.remove', { barcode: second }) });
  await expect(removeSecond).toBeVisible();
  await removeFirst.focus();
  await page.keyboard.press('Enter');
  await expect(removeFirst).toHaveCount(0);
  await expect(removeSecond).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(removeSecond).toHaveCount(0);
  await expect(input).toBeFocused();
});

test('Share sits by the favourite; the photo button is green only while the glaze has no photo', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Buttons');
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const add = main.getByRole('button', { name: t('catalog.addPhoto') });
  const record = main.getByRole('link', { name: t('glaze.recordCombination') });
  const share = main.getByRole('button', { name: t('share.action') });
  const fill = (button: Locator) => button.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(main.getByText(t('images.noPhoto'))).toBeVisible();
  await expect(add).toBeVisible();
  const green = await fill(add);
  expect(green).not.toBe(await fill(share));
  expect(await fill(record)).toBe(await fill(share));
  const star = main.getByRole('button', { name: t('favorites.add'), exact: true }).first();
  const [starBox, shareBox] = [await at(star), await at(share)];
  expect(Math.abs(starBox.y - shareBox.y)).toBeLessThan(3);
  expect(shareBox.x).toBeGreaterThanOrEqual(starBox.x + starBox.width);
  expect(shareBox.y).toBeLessThan((await at(record)).y);
  await expect(record).toHaveCSS('text-decoration-line', 'none');
  // The empty state is a line of text, not a framed block.
  await expect(main.getByText(t('glaze.combinations.empty'))).toBeVisible();

  await api.uploadToGlaze(glaze.id, { file: photoPng('tile.png', 480, 360) });
  await page.reload();
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title: glaze.title }) })).toBeVisible();
  await expect(add).toBeVisible();
  expect(await fill(add)).toBe(await fill(share));
  await expect(main.getByRole('button', { name: t('catalog.addPhoto') })).toHaveCount(1);
});

test('the gallery holds packaging and the finished pieces of combinations with their Used in line', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await newGlaze(api, uid, 'Gallery');
  const comboTitle = `Bowl ${uid}`;
  const combo = await api.addCombination({ title: comboTitle, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }] });
  await api.uploadToCombination(combo, { file: photoPng('tile.png', 480, 360), kind: 'TEST_TILE' });
  await api.uploadToCombination(combo, { file: photoPng('bowl.png', 480, 360), kind: 'FINISHED' });
  await api.uploadToGlaze(glaze.id, { file: photoPng('bucket.png', 480, 360), kind: 'PACKAGING' });
  await api.uploadToGlaze(glaze.id, { file: photoPng('own.png', 480, 360) });
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const gallery = main.getByRole('region', { name: t('images.gallery', { title: glaze.title }) });
  // Its own test tile, the finished piece borrowed from the combination (never its test tile) and the packaging: three photos.
  const thumbnails = gallery.getByRole('button', { name: /^Photo \d of \d,/ });
  await expect(thumbnails).toHaveCount(3);
  const used = t('images.usedIn', { title: comboTitle });
  const names = await thumbnails.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  expect(names.some((name) => name?.includes(t('images.kind.packaging')))).toBe(true);
  expect(names.some((name) => name?.includes(t('images.kind.finished')))).toBe(true);
  const finished = (await thumbnails.all())[names.findIndex((name) => name?.includes(t('images.kind.finished')))];
  await finished.click();
  await expect(gallery.getByText(used)).toBeVisible();
  // The gallery has one stage, the meta line sits under it, the buttons under the thumbnails.
  expect((await at(gallery.getByText(used))).y).toBeGreaterThan((await at(gallery.locator('[role="group"]').first())).y);
  expect(names.length).toBe(3);
});

test('a guest sees the glaze page in the same layout without the member buttons, and the invitation under it', async ({ page, shell, newApi, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const glaze = await newGlaze(author, uid, 'Guest');
  await author.uploadToGlaze(glaze.id, { file: photoPng('tile.png', 480, 360) });
  await shell.open(`#/glazes/${glaze.id}`);
  const main = page.getByRole('main');
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title: glaze.title }) })).toBeVisible();
  await expect(main.getByRole('button', { name: t('catalog.addPhoto') })).toHaveCount(0);
  await expect(main.getByRole('link', { name: t('glaze.recordCombination') })).toHaveCount(0);
  await expect(main.getByRole('button', { name: t('share.action') })).toBeVisible();
  const [media, text] = [
    await at(main.getByRole('region', { name: t('images.gallery', { title: glaze.title }) })),
    await at(main.getByRole('heading', { level: 1 })),
  ];
  if (page.viewportSize()!.width >= 720) expect(media.x + media.width).toBeLessThanOrEqual(text.x);
  await expect(main.getByText(t('guest.glaze'))).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('the two columns hold from 720 to 1920 px, and the gallery sticks only while all of it fits the window', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  isMobile,
}) => {
  test.skip(isMobile, 'one column on a phone: nothing sticks');
  const glaze = await newGlaze(api, uid, 'Captioned');
  for (let index = 0; index < 6; index++) {
    await api.addCombination({ title: `Combo ${index} ${uid}`, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }, BISQUE_STEP] });
  }
  const caption =
    'Wide shallow bowl with a thick Shino base and a Tenmoku dip on the upper half, fired in the club kiln on the top shelf by the door, cooled slowly over ten hours and left in the kiln until the next day ok';
  await api.uploadToGlaze(glaze.id, { file: photoPng('tall.png', 600, 900), caption: caption.slice(0, 200), firedOn: '2026-10-18' });
  await api.uploadToGlaze(glaze.id, { file: photoPng('bucket.png', 600, 900), kind: 'PACKAGING' });
  const main = page.getByRole('main');
  const media = main.locator('.glaze-card__media');
  const add = main.getByRole('button', { name: t('catalog.addPhoto') });
  for (const viewport of [
    { width: 720, height: 800 },
    { width: 760, height: 768 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await shell.open(`#/glazes/${glaze.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(main.getByText(caption.slice(0, 40))).toBeVisible();
    const [gallery, title] = [await at(media), await at(main.getByRole('heading', { level: 1 }))];
    expect(gallery.x + gallery.width, `${viewport.width}: side by side`).toBeLessThanOrEqual(title.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 700));
    const sticks = (await media.evaluate((element) => getComputedStyle(element).position)) === 'sticky';
    // The header's height counts even where the header slides away (under 70em).
    const header = Math.round(await headerHeight(page));
    expect(sticks, `${viewport.width}x${viewport.height}: gallery ${gallery.height} px, header ${header} px`).toBe(
      gallery.height + 32 + header <= viewport.height,
    );
    if (sticks) {
      const button = await at(add);
      expect(button.y + button.height).toBeLessThanOrEqual(viewport.height);
    }
  }
});
