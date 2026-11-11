import { readFileSync } from 'node:fs';
const messagesFor = (language: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../src/lib/i18n/${language}.json`, import.meta.url), 'utf8'));
import { expect, test } from '../support/test';

for (const language of ['en', 'de', 'pt-PT', 'it', 'es'] as const) {
  test(`live tags stay compact, save additions/removals and restore focus (${language})`, async ({ page, shell, api, signedIn, uid, isMobile }) => {
    const messages = messagesFor(language);
    await page.addInitScript((value) => localStorage.setItem('glazelab:locale', value), language);
    if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
    const title = `Compact tags ${uid}`;
    const id = await api.addCombination({ title, tags: ['mug'], steps: [{ type: 'CUSTOM', label: 'Bisque firing' }] });
    await page.goto(`/#/combinations/${id}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const section = main.getByRole('region', { name: messages['tags.label'], exact: true });
    const edit = section.getByRole('button', { name: messages['tags.edit'], exact: true });
    await edit.click();
    const input = section.getByRole('combobox', { name: messages['tags.add'], exact: true });
    await expect(input).toBeFocused();
    const done = section.getByRole('button', { name: messages['common.done'], exact: true });
    const heading = section.getByRole('heading', { name: messages['tags.label'], exact: true });
    const [headingBox, doneBox] = [(await heading.boundingBox())!, (await done.boundingBox())!];
    expect(Math.abs(headingBox.y + headingBox.height / 2 - doneBox.y - doneBox.height / 2)).toBeLessThan(3);
    expect((await section.boundingBox())!.height).toBeLessThan(190);
    await input.fill('plate');
    await input.press('Enter');
    await expect(section.getByRole('list').getByText('plate', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: /mug/ }).click();
    await expect(section.getByRole('list').getByText('mug', { exact: true })).toHaveCount(0);
    await input.fill('x'.repeat(41));
    await expect(section.getByText(messages['errors.tagTooLong'], { exact: true })).toBeVisible();
    await input.fill('');
    await done.click();
    await expect(edit).toBeFocused();
    await page.reload();
    await expect(section.getByText('plate', { exact: true })).toBeVisible();
    await expect(section.getByText('mug', { exact: true })).toHaveCount(0);
  });
}

test('the outlined favourite is an icon button and its selected state survives reload', async ({ page, shell, api, signedIn, uid }) => {
  const title = `Favourite ${uid}`;
  const id = await api.addCombination({ title, steps: [{ type: 'CUSTOM', label: 'Bisque firing' }] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const star = main.getByRole('button', { name: messagesFor('en')['favorites.add'], exact: true });
  await expect(star.locator('svg')).toBeVisible();
  const share = main.getByRole('button', { name: messagesFor('en')['share.action'], exact: true });
  await expect(star).toHaveCSS('border-color', await share.evaluate((node) => getComputedStyle(node).borderColor));
  await star.click();
  await expect(main.getByRole('button', { name: messagesFor('en')['favorites.remove'], exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(main.getByRole('button', { name: messagesFor('en')['favorites.remove'], exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('photo additions and Record a variation share the recipe action group beneath the description', async ({ page, shell, api, signedIn, uid }) => {
  const id = await api.addCombination({
    title: `Actions ${uid}`,
    description: 'Description before actions.',
    steps: [{ type: 'CUSTOM', label: 'Bisque firing' }],
  });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const messages = messagesFor('en');
  const group = main.getByRole('group', { name: messages['combination.actions'], exact: true });
  await expect(group.getByRole('button', { name: messages['images.addTestTile'], exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: messages['images.addFinished'], exact: false })).toBeVisible();
  await expect(group.getByRole('link', { name: messages['combination.recordVariation'], exact: true })).toBeVisible();
  const [description, actions, tags] = [
    (await main.getByText('Description before actions.', { exact: true }).boundingBox())!,
    (await group.boundingBox())!,
    (await main.getByRole('heading', { name: messages['tags.label'], exact: true }).boundingBox())!,
  ];
  expect(actions.y).toBeGreaterThan(description.y);
  expect(actions.y + actions.height).toBeLessThanOrEqual(tags.y);
});
