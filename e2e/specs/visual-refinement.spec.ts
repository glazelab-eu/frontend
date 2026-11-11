import { t } from '../support/i18n';
import { photoPng } from '../support/images';
import { expect, test } from '../support/test';

test('the paper-airplane Share control has a translated accessible name and shares the canonical page', async ({ page, shell, api, signedIn, uid }) => {
  let shared: ShareData | undefined;
  await page.exposeFunction('captureShare', (data: ShareData) => {
    shared = data;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => (window as unknown as { captureShare: (data: ShareData) => Promise<void> }).captureShare(data),
    });
  });
  const id = await api.addCombination({ title: `Sharing ${uid}`, steps: [{ type: 'CUSTOM', label: 'Bisque firing' }] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const share = page.getByRole('main').getByRole('button', { name: t('share.action'), exact: true });
  await expect(share).toHaveAttribute('title', t('share.action'));
  await expect(share.locator('svg')).toBeVisible();
  await expect(share).toHaveText('');
  await share.click();
  await expect.poll(() => shared?.url).toBe(new URL(`/#/combinations/${id}`, page.url()).href);
});

test('glaze details remain before a bounded preview and See all opens the complete listing', async ({ page, shell, api, signedIn, uid }) => {
  const glaze = await api.addGlaze({ newManufacturer: { name: `Maker ${uid}`, shortId: uid }, name: 'Celadon', code: 'C-1' });
  await api.uploadToGlaze(glaze.id, { file: photoPng('tile.png', 600, 800) });
  for (let index = 0; index < 6; index++) {
    await api.addCombination({ title: `Preview ${uid} ${index}`, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }] });
  }
  await shell.open(`#/glazes/${glaze.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('article')).toHaveCount(5);
  const about = await main.getByRole('heading', { name: t('glaze.details.title'), exact: true }).boundingBox();
  const related = await main.getByRole('heading', { name: t('glaze.combinations.title'), exact: true }).boundingBox();
  expect(about!.y).toBeLessThan(related!.y);
  await main.getByRole('link', { name: t('glaze.combinations.seeAll', { count: 6 }) }).click();
  await expect(main.getByRole('article')).toHaveCount(6);
});

test('on an iPhone X manual shelf entry is directly reachable and an empty shelf leads with its form', async ({ page, shell, signedIn, isMobile }) => {
  test.skip(!isMobile, 'phone entry actions');
  await page.setViewportSize({ width: 375, height: 812 });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: t('stock.list.title'), exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: t('addGlaze.action'), exact: true }).click();
  await expect(main.getByRole('combobox', { name: t('common.glaze'), exact: true })).toBeFocused();
});

test('Studio puts recipe building before optional notes and keeps only saving in its phone toolbar', async ({ page, shell, signedIn, isMobile }) => {
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const steps = await main.getByRole('heading', { name: t('studio.steps.title'), exact: true }).boundingBox();
  const notes = await main.getByLabel(t('common.notes'), { exact: false }).boundingBox();
  expect(steps!.y).toBeLessThan(notes!.y);
  await main.getByLabel(t('studio.titleLabel')).fill('New recipe');
  await main.getByRole('button', { name: t('studio.addGlazeStep'), exact: true }).click();
  if (isMobile) {
    const bar = main.getByRole('group', { name: t('studio.bar.label') });
    await expect(bar.getByRole('button', { name: t('studio.addGlazeStep'), exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: t('combination.publish'), exact: true })).toBeVisible();
  }
});

test('account shortcuts move focus without changing the route or enabling photo analysis', async ({ page, shell, signedIn }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  const navigation = page.getByRole('navigation', { name: t('common.onThisPage') });
  await navigation.getByRole('button', { name: t('account.page.security'), exact: true }).click();
  await expect(page.getByRole('heading', { name: t('account.page.password.title'), exact: true })).toBeFocused();
  await expect(page).toHaveURL(/#\/account$/);
  await navigation.getByRole('button', { name: t('account.page.device'), exact: true }).click();
  await expect(page.getByRole('heading', { name: t('vision.setting.title'), exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: t('vision.consent.on'), exact: true })).not.toBeVisible();
  await page.getByText(t('vision.setting.review'), { exact: true }).click();
  await expect(page.getByText(t('vision.consent.speed'))).toBeVisible();
  await expect(page.getByText(t('vision.setting.off'))).toBeVisible();
});

test('compact filters are 40 px while primary controls retain the larger target on iPhone X', async ({ page, shell, signedIn, isMobile }) => {
  test.skip(!isMobile, 'coarse-pointer sizing');
  await page.setViewportSize({ width: 375, height: 812 });
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const type = page.getByRole('group', { name: t('discover.type.label'), exact: true });
  for (const control of await type.getByRole('link').all()) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeLessThan(44);
  }
  const record = page
    .getByRole('main')
    .getByRole('button', { name: t('common.recordTest'), exact: true })
    .first();
  expect((await record.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('Explore glaze sharing appears beside the star only when its card has room', async ({ page, shell, api, signedIn, uid }) => {
  const created = await api.addGlaze({ newManufacturer: { name: `Space ${uid}`, shortId: uid }, name: 'Blue', code: 'S-1' });
  await shell.open(`#/?type=glazes&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  const card = page
    .getByRole('main')
    .getByRole('article')
    .filter({ has: page.getByRole('link', { name: 'Blue', exact: true }) });
  await expect(card).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(card.getByRole('button', { name: t('share.action'), exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1000, height: 900 });
  const share = card.getByRole('button', { name: t('share.action'), exact: true });
  await expect(share).toBeVisible();
  const star = card.getByRole('button', { name: t('favorites.add'), exact: true });
  const [starBox, shareBox] = [(await star.boundingBox())!, (await share.boundingBox())!];
  expect(Math.abs(starBox.y - shareBox.y)).toBeLessThan(3);
  expect(shareBox.x).toBeGreaterThanOrEqual(starBox.x + starBox.width);
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(share).toHaveCount(0);
  expect(created.id).toBeTruthy();
});
