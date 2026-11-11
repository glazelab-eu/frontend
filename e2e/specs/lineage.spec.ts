import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { photoPng } from '../support/images';
import { expect, newAccount, test } from '../support/test';

test('Based on and the variations are chips with the cover, the title and who made it, or "your draft"', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const cleo = await newApi();
  const longName = `Cleo ${'Longname'.repeat(8)} ${uid}`;
  await cleo.signUp({ ...newAccount(uid, 'Cleo'), displayName: longName });
  const longTitle = `A variation with a very long title that has to wrap or end in an ellipsis and never push the page wider ${uid}`;

  const source = await cleo.addCombination({ title: `Source ${uid}`, steps: [BISQUE_STEP] });
  const sourceTile = await cleo.uploadToCombination(source, { file: photoPng('source.png', 480, 360) });
  const mine = await api.addCombination({ title: `Mine ${uid}`, steps: [BISQUE_STEP], basedOnId: source });
  const byCleo = await cleo.addCombination({ title: longTitle, steps: [BISQUE_STEP], basedOnId: mine });
  const cleoTile = await cleo.uploadToCombination(byCleo, { file: photoPng('cleo.png', 480, 360) });
  const own = await api.addCombination({ title: `Own variation ${uid}`, steps: [BISQUE_STEP], basedOnId: mine });
  const draft = await api.addCombination({ title: `Draft variation ${uid}`, steps: [BISQUE_STEP], basedOnId: mine, draft: true });
  // A variation whose author deleted the account keeps the translated label.
  const dora = await newApi();
  const doraAccount = newAccount(uid, 'Dora');
  await dora.signUp(doraAccount);
  const orphan = await dora.addCombination({ title: `Orphan ${uid}`, steps: [BISQUE_STEP], basedOnId: mine });
  await dora.deleteAccount(doraAccount.password);

  const cards = new Set<string>();
  page.on('request', (request) => cards.add(new URL(request.url()).pathname));
  await shell.open(`#/combinations/${mine}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const chip = (href: string) => main.locator(`a[href="#/combinations/${href}"]`);

  // Based on: the label, then a chip with the source's cover (the card copy), title and author.
  await expect(main.getByText(t('combination.basedOn'), { exact: true })).toBeVisible();
  await expect(chip(source)).toHaveText(`Source ${uid} ${t('combination.variations.by', { name: longName })}`);
  await expect(chip(source).locator('img')).toBeVisible();
  // The variations under their h2: by a member, an own published one without a photo, and the own draft.
  const variations = main.getByRole('region', { name: t('combination.variations.title') });
  await expect(variations.getByRole('link')).toHaveCount(4);
  await expect(variations.locator(`a[href="#/combinations/${orphan}"]`)).toContainText(t('combination.variations.by', { name: t('account.deleted') }));
  await expect(variations.locator(`a[href="#/combinations/${byCleo}"] img`)).toBeVisible();
  await expect(variations.locator(`a[href="#/combinations/${byCleo}"]`)).toContainText(t('combination.variations.by', { name: longName }));
  await expect(variations.locator(`a[href="#/combinations/${own}"]`)).toContainText(t('combination.variations.by', { name: signedIn.displayName }));
  await expect(variations.locator(`a[href="#/combinations/${own}"] img`)).toHaveCount(0);
  await expect(variations.locator(`a[href="#/combinations/${draft}"]`)).toContainText(t('combination.variations.draft', { title: `Draft variation ${uid}` }));
  await expect(variations.locator(`a[href="#/combinations/${draft}"]`)).toContainText(t('combination.variations.yourDraft'));
  expect([...cards]).toContain(sourceTile.cardUrl);
  expect([...cards]).toContain(cleoTile.cardUrl);
  expect([...cards]).not.toContain(sourceTile.url);

  // A missing cover is a neutral square of the thumbnail's size.
  const [square, thumbnail] = [await chip(own).locator('span[aria-hidden="true"]').boundingBox(), await chip(byCleo).locator('img').boundingBox()];
  expect(Math.abs(square!.width - thumbnail!.width)).toBeLessThan(1);
  expect(Math.abs(square!.height - thumbnail!.height)).toBeLessThan(1);

  // Long titles and names never widen the page or leave the chip; every chip is a real link at least 44 px high on a touch screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const column = (await main.getByRole('heading', { level: 1 }).boundingBox())!;
  for (const id of [source, byCleo, own, draft, orphan]) {
    const box = (await chip(id).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    if (page.viewportSize()!.width >= 720) expect(box.x).toBeGreaterThanOrEqual(column.x - 1);
    // The card clips what overflows, so look at the text itself: it ends inside the chip.
    for (const text of await chip(id).locator('span').all()) {
      const inner = await text.boundingBox();
      if (inner) expect(inner.x + inner.width, `text of ${id} leaves its chip`).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  }
  const long = (await chip(byCleo).boundingBox())!;
  const short = (await chip(own).boundingBox())!;
  expect(long.height).toBeLessThan(short.height + 40);

  // The same author on an Explore card (the byline has no spaces to break at) wraps inside the card and never widens the page.
  await shell.open(`#/?type=combinations&q=${uid}`);
  const exploreCard = page.getByRole('main').getByRole('article').filter({ hasText: longTitle });
  await expect(exploreCard).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const [cardBox, authorBox] = [(await exploreCard.boundingBox())!, (await exploreCard.getByText(longName, { exact: false }).first().boundingBox())!];
  expect(authorBox.x + authorBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
  await shell.open(`#/combinations/${mine}`);

  // A click opens the combination.
  await chip(byCleo).click();
  await expect(page.getByRole('heading', { level: 1, name: longTitle })).toBeVisible();
});

test('the page keeps its outline with chips: one h1, the tags and the variations', async ({ page, shell, api, signedIn, uid }) => {
  const mine = await api.addCombination({ title: `Outline ${uid}`, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await api.addCombination({ title: `Variation ${uid}`, steps: [BISQUE_STEP], basedOnId: mine });
  await shell.open(`#/combinations/${mine}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: `Outline ${uid}` })).toBeVisible();
  await expect(main.getByRole('heading', { level: 2 })).toHaveText([t('tags.label'), t('combination.variations.title')]);
  await expect(main.getByRole('link', { name: `Variation ${uid} ${t('combination.variations.by', { name: signedIn.displayName })}` })).toBeVisible();
});
