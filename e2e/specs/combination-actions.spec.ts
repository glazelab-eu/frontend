import type { Locator } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { photoPng } from '../support/images';
import { expectStuckBelowHeader, headerHeight } from '../support/header';
import { expect, newAccount, test } from '../support/test';

/** Where a control stands on the page. */
async function at(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The control is not on the page');
  return box;
}

test('the author gets one action row, and Delete at the end below the rest @smoke', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Mine ${uid}`;
  const source = await api.addCombination({ title: `Source ${uid}`, steps: [BISQUE_STEP] });
  const id = await api.addCombination({ title, steps: [BISQUE_STEP], basedOnId: source, tags: ['cone-6'] });
  await api.addCombination({ title: `Variation ${uid}`, steps: [BISQUE_STEP], basedOnId: id });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: title })).toBeVisible();

  const variation = main.getByRole('link', { name: t('combination.recordVariation') });
  const share = main.getByRole('button', { name: t('share.action') });
  const edit = main.getByRole('link', { name: t('combination.edit'), exact: true });
  const remove = main.getByRole('button', { name: t('combination.delete.confirm') });
  await expect(variation).toBeVisible();
  await expect(share).toBeVisible();
  await expect(edit).toBeVisible();
  await expect(remove).toBeVisible();
  // The copy and the one look: links and buttons alike have no underline.
  await expect(edit).toHaveText(t('combination.edit'));
  for (const link of [variation, edit]) await expect(link).toHaveCSS('text-decoration-line', 'none');
  await expect(main.getByRole('link', { name: /another combination/i })).toHaveCount(0);

  // Share is up beside the favourite; photo additions, variation and Edit share the group before the recipe.
  const [first, second, third] = [await at(variation), await at(share), await at(edit)];
  expect(second.y).toBeLessThan(first.y);
  const twoColumns = page.viewportSize()!.width >= 720;
  if (twoColumns) {
    const group = main.getByRole('group', { name: t('combination.actions'), exact: true });
    await expect(group.getByRole('link', { name: t('combination.edit'), exact: true })).toBeVisible();
    expect(third.y).toBeGreaterThanOrEqual(first.y);
  } else expect(third.y).toBeGreaterThanOrEqual(first.y);

  // The recipe reads tags, steps, the action row, lineage and last Delete (the h2 Tags comes before Variations).
  const variations = main.getByRole('heading', { level: 2, name: t('combination.variations.title') });
  const tags = main.getByRole('heading', { level: 2, name: t('tags.label') });
  await expect(variations).toBeVisible();
  await expect(tags).toBeVisible();
  const steps = await at(main.locator('.combination-card__steps'));
  expect((await at(tags)).y).toBeLessThan(steps.y);
  expect(first.y).toBeLessThan((await at(tags)).y);
  expect((await at(variations)).y).toBeGreaterThan(third.y);
  expect((await at(remove)).y).toBeGreaterThan((await at(variations)).y);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(main.getByRole('heading', { level: 2 })).toHaveText([t('tags.label'), t('combination.variations.title')]);
});

test('a draft offers its photo buttons, Publish as the one primary, Edit draft, and Delete at the end', async ({ page, shell, api, signedIn, uid }) => {
  const id = await api.addCombination({ title: `Draft ${uid}`, steps: [BISQUE_STEP], draft: true });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const publish = main.getByRole('button', { name: t('combination.publish') });
  const edit = main.getByRole('link', { name: t('combination.draft.edit') });
  await expect(publish).toBeVisible();
  await expect(edit).toBeVisible();
  // Photos go onto the draft too; only Publish is green.
  const tile = main.getByRole('button', { name: t('images.addTestTile'), exact: true });
  await expect(tile).toBeVisible();
  await expect(main.getByRole('button', { name: t('images.addFinishedFor', { title: `Draft ${uid}` }) })).toBeVisible();
  const fill = (button: typeof tile) => button.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await fill(tile)).not.toBe(await fill(publish));
  await expect(main.getByRole('link', { name: t('combination.recordVariation') })).toHaveCount(0);
  const remove = main.getByRole('button', { name: t('combination.delete.confirm') });
  expect((await at(remove)).y).toBeGreaterThan((await at(publish)).y);
  expect((await at(edit)).x).toBeGreaterThan((await at(publish)).x);
});

test('another member gets a variation and Share, but neither Edit nor Delete', async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const id = await author.addCombination({ title: `Theirs ${uid}`, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: t('combination.recordVariation') })).toBeVisible();
  await expect(main.getByRole('button', { name: t('share.action') })).toBeVisible();
  await expect(main.getByRole('link', { name: t('combination.edit'), exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: t('combination.delete.confirm') })).toHaveCount(0);
});

test('Delete combination returns the focus to itself when its dialog is cancelled', async ({ page, shell, api, signedIn, uid }) => {
  const id = await api.addCombination({ title: `Keep ${uid}`, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const remove = page.getByRole('main').getByRole('button', { name: t('combination.delete.confirm') });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: t('combination.delete.title') });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
});

test('from 45em the gallery and the recipe stand side by side, the gallery follows the page, a phone has one column', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const title = `Columns ${uid}`;
  const steps = Array.from({ length: 16 }, (_, index) => ({
    type: 'CUSTOM' as const,
    label: `Step ${index + 1} of the long recipe`,
    notes: 'A longer note that makes the recipe taller than the screen, so the page has to scroll. '.repeat(2),
  }));
  const id = await api.addCombination({ title, steps, tags: ['cone-6'], description: 'Tall recipe, short photo.' });
  await api.uploadToCombination(id, { file: photoPng('tall.png', 600, 800) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const heading = main.getByRole('heading', { level: 1, name: title });
  const gallery = main.getByRole('region', { name: t('images.gallery', { title }) });
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  const [media, text, add] = [await at(gallery), await at(heading), await at(main.getByRole('button', { name: t('images.addTestTile') }))];
  const wide = page.viewportSize()!.width >= 720;
  if (wide) {
    // Side by side: the gallery (with its photo buttons) on the left, the title in the right column, level with the photo's top.
    expect(media.x + media.width).toBeLessThanOrEqual(text.x);
    expect(text.y).toBeLessThan(media.y + 100);
    expect(add.x).toBeGreaterThanOrEqual(text.x);
    const card = main.locator('article').first();
    // The card clips the photo's corners without stopping the gallery from sticking (`hidden` would).
    await expect(card).toHaveCSS('overflow-x', 'clip');
    const cardBox = await at(card);
    expect(media.width / cardBox.width).toBeGreaterThan(0.45);
    expect(media.width / cardBox.width).toBeLessThan(0.55);
    // The gallery follows the page while the long recipe scrolls (where the window is tall enough for all of it).
    if (page.viewportSize()!.height >= 768) {
      await page.evaluate(() => scrollTo(0, 600));
      // 1 rem below the sticky header (a header slid away by the scroll, under 70em, leaves the whole gap above the window's top).
      await expectStuckBelowHeader(page, gallery);
      expect((await at(heading)).y).toBeLessThan(0);
    }
  } else {
    // One column: the photo, then the photo buttons, then the title, in that order, all as wide as the card.
    expect(text.y).toBeLessThan(add.y);
    expect(add.y).toBeGreaterThan(media.y);
    expect(Math.abs(media.x - text.x)).toBeLessThan(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('the keyboard reaches the recipe, the action row and Delete in reading order', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Focus ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: title })).toBeVisible();
  // Tab from the back link through the page and record the accessible name of each stop inside the card.
  await page.locator('.back-link').focus();
  const stops: string[] = [];
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return (element?.getAttribute('aria-label') || element?.textContent || '').trim();
      }),
    );
  }
  const at2 = (label: string) => stops.findIndex((stop) => stop.includes(label));
  const [tile, edit, variation, share, editCombination, remove] = [
    at2(t('images.addTestTile')),
    at2(t('tags.edit')),
    at2(t('combination.recordVariation')),
    at2(t('share.action')),
    at2(t('combination.edit')),
    at2(t('combination.delete.confirm')),
  ];
  for (const stop of [tile, edit, variation, share, editCombination, remove]) expect(stop).toBeGreaterThanOrEqual(0);
  // The photo buttons come first, then the tags, the action row (variation, Share, Edit) and Delete last.
  expect(tile).toBeLessThan(edit);
  expect(variation).toBeLessThan(edit);
  expect(share).toBeLessThan(edit);
  expect(variation).toBeLessThan(editCombination);
  expect(editCombination).toBeLessThan(remove);
});

test('on a phone every row of the action group is filled edge to edge, also a button that wraps alone', async ({ page, shell, api, signedIn, uid }) => {
  const id = await api.addCombination({ title: `Rows ${uid}`, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const group = main.getByRole('group', { name: t('combination.actions'), exact: true });
  await expect(group.getByRole('link', { name: t('combination.recordVariation') })).toBeVisible();
  const phone = page.viewportSize()!.width < 720;
  const frame = (await group.boundingBox())!;
  const boxes = await group.locator('.button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const { x, y, width } = button.getBoundingClientRect();
      return { x, y: Math.round(y), right: x + width };
    }),
  );
  const rows = new Map<number, { left: number; right: number }>();
  for (const box of boxes) {
    const row = rows.get(box.y) ?? { left: Infinity, right: -Infinity };
    rows.set(box.y, { left: Math.min(row.left, box.x), right: Math.max(row.right, box.right) });
  }
  if (!phone) return;
  // The photo buttons share the first row and the variation (and Edit) the next; each row spans the same width.
  expect(rows.size).toBeGreaterThan(1);
  const [first, ...others] = [...rows.values()];
  for (const row of others) {
    expect(Math.abs(row.left - first.left)).toBeLessThan(1.5);
    expect(Math.abs(row.right - first.right)).toBeLessThan(1.5);
  }
  expect(first.right - first.left).toBeGreaterThan(frame.width - 2);
});

test('the keyboard passes the stage, the photo menu and one thumbnail, then reaches the recipe header', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Strip ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
  for (const name of ['a', 'b', 'c', 'd']) await api.uploadToCombination(id, { file: photoPng(`${name}.png`, 240, 180) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const gallery = main.getByRole('region', { name: t('images.gallery', { title }) });
  await expect(gallery.getByRole('button', { name: t('images.thumbnail', { current: 1, total: 4, kind: t('images.kind.tile') }) })).toBeVisible();
  await page.locator('.back-link').focus();
  const stops: string[] = [];
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return (element?.getAttribute('aria-label') || element?.textContent || '').trim();
      }),
    );
  }
  // The gallery has three stops, then the author link and header controls.
  expect(stops[0]).toBe(t('images.galleryNavigation'));
  expect(stops[1]).toBe(t('images.menu.label'));
  expect(stops[2]).toBe(t('images.thumbnail', { current: 1, total: 4, kind: t('images.kind.tile') }));
  // The header star/Share follow the gallery; upload actions are in the recipe group.
  expect(stops[3]).toBe(signedIn.displayName);
  expect(stops[4]).toBe(t('favorites.add'));
  expect(stops[5]).toBe(t('share.action'));
});

test('the gallery sticks only while all of it fits the window, so its gallery controls stay reachable', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  isMobile,
}) => {
  test.skip(isMobile, 'one column on a phone: nothing sticks');
  const title = `Caption ${uid}`;
  const steps = Array.from({ length: 14 }, (_, index) => ({
    type: 'CUSTOM' as const,
    label: `Step ${index + 1}`,
    notes: 'A note that makes the recipe long. '.repeat(6),
  }));
  const id = await api.addCombination({ title, steps });
  // The longest caption (200 characters) and a firing date make the gallery taller than the stage alone.
  const caption =
    'Wide shallow bowl with a thick Shino base and a Tenmoku dip on the upper half, fired in the club kiln on the top shelf by the door, cooled slowly over ten hours and left in the kiln until the next day ok';
  await api.uploadToCombination(id, { file: photoPng('tall.png', 600, 900), kind: 'FINISHED', caption: caption.slice(0, 200), firedOn: '2026-10-18' });
  // A second photo (a tile, shown after the finished piece) adds the thumbnail row to the measured height.
  await api.uploadToCombination(id, { file: photoPng('bowl.png', 600, 900), kind: 'TEST_TILE' });
  const main = page.getByRole('main');
  const gallery = main.locator('.combination-card__media');
  for (const viewport of [
    { width: 760, height: 768 },
    { width: 820, height: 800 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(main.getByText(caption.slice(0, 40))).toBeVisible();
    const height = (await at(gallery)).height;
    await page.evaluate(() => scrollTo(0, 700));
    const sticks = (await gallery.evaluate((element) => getComputedStyle(element).position)) === 'sticky';
    // Where it fits (with the 1rem gap above and below and the header's height, which counts even where the header slides away), it
    // follows the page; where it does not, it scrolls away and comes back.
    const header = Math.round(await headerHeight(page));
    expect(sticks, `${viewport.width}x${viewport.height}: gallery ${height} px, header ${header} px`).toBe(height + 32 + header <= viewport.height);
    await expect(
      main.getByRole('group', { name: t('combination.actions') }).getByRole('button', { name: t('images.addFinishedFor', { title }) }),
    ).toBeVisible();
  }
});
