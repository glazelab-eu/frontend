import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { expectAccessible } from '../support/axe';
import { t } from '../support/i18n';
import { png } from '../support/images';
import { StudioPage } from '../support/pages/studio';
import { expect, newAccount, test } from '../support/test';

/** Two glazes only this test uses, so no other test's combination can match their order. */
async function twoGlazes(api: Api, uid: string) {
  const red = await api.addGlaze({ newManufacturer: { name: `Maker ${uid}`, shortId: uid }, code: 'R1', name: `Red ${uid}` });
  const blue = await api.addGlaze({ manufacturerId: red.glaze.manufacturer.id, code: 'B1', name: `Blue ${uid}` });
  return { red: red.glaze.id, blue: blue.glaze.id, names: { red: `Red ${uid}`, blue: `Blue ${uid}` } };
}

const glazeStep = (glazeId: string, coats = 1) => ({ type: 'GLAZE' as const, glazeId, coats });
const note = (page: Page) => page.getByRole('main').getByRole('region', { name: t('studio.sameGlazes.title') });

test('names a combination with the same glazes in the same order, and adds the photos to it', async ({ page, shell, newApi, signedIn, uid, encoder }) => {
  const cleo = await newApi();
  const cleoAccount = { ...newAccount(uid, 'Cleo'), displayName: `Cleo ${uid}` };
  await cleo.signUp(cleoAccount);
  const glazes = await twoGlazes(cleo, uid);
  const title = `Red under Blue ${uid}`;
  // Other coats and a custom step: still the same glazes in the same order.
  const existing = await cleo.addCombination({
    title,
    steps: [{ type: 'CUSTOM', label: 'Bisque firing' }, glazeStep(glazes.red, 3), glazeStep(glazes.blue)],
  });

  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.title.fill(`My test ${uid}`);
  await studio.addGlazeStep(glazes.names.red);
  // Red alone is another order: nothing to name yet.
  await expect(note(page)).toHaveCount(0);
  await studio.addGlazeStep(glazes.names.blue);
  await expect(note(page)).toBeVisible();
  await expect(note(page)).toContainText(t('studio.sameGlazes.body', { count: 1 }));
  await expect(note(page).getByRole('link', { name: title })).toHaveAttribute('href', `#/combinations/${existing}`);
  await expect(note(page)).toContainText(t('combination.variations.by', { name: cleoAccount.displayName }));
  await expect(
    page
      .getByRole('main')
      .getByRole('status')
      .filter({ hasText: t('studio.sameGlazes.body', { count: 1 }) }),
  ).toHaveCount(1);
  await expectAccessible(page);

  // Another order is another combination: the note goes, and comes back with the order (phones fold the finished steps, so the
  // newest step changes it).
  await studio.addGlazeStep(glazes.names.red);
  await expect(note(page)).toHaveCount(0);
  await studio.main.getByRole('button', { name: t('studio.step.remove', { number: 3 }) }).click();
  await expect(note(page)).toBeVisible();

  const add = note(page).getByRole('button', { name: t('studio.sameGlazes.add', { title }) });
  await expect(add).toHaveText(t('studio.sameGlazes.addShort'));
  await add.click();
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
  await upload.getByLabel(t('upload.library')).setInputFiles(png('tile.png'));
  await upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }).click();
  await expect(upload).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: t('notices.photosAdded', { count: 1 }) })).toBeVisible();
  // The opener is still there: focus returns to it, and the form keeps what was typed.
  await expect(add).toBeFocused();
  await expect(studio.title).toHaveValue(`My test ${uid}`);
  const stored = (await cleo.combinations()).find((combination) => combination.id === existing);
  expect(stored?.images).toHaveLength(1);

  // Opening the existing combination from the note still asks about the unsaved form.
  await note(page).getByRole('link', { name: title }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a variation does not name its source, but names another combination with the same glazes', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const cleo = await newApi();
  await cleo.signUp(newAccount(uid, 'Cleo'));
  const glazes = await twoGlazes(cleo, uid);
  const steps = [glazeStep(glazes.red, 2), glazeStep(glazes.blue)];
  const source = await api.addCombination({ title: `Source ${uid}`, steps });

  await shell.open(`#/studio?from=${source}`);
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await expect(studio.title).not.toHaveValue('');
  await expect(studio.main.getByRole('combobox', { name: t('common.glaze') })).toHaveCount(2);
  await expect(note(page)).toHaveCount(0);

  const other = await cleo.addCombination({ title: `Other ${uid}`, steps });
  await page.goto('about:blank');
  await shell.open(`#/studio?from=${source}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(note(page).getByRole('link')).toHaveCount(1);
  await expect(note(page).getByRole('link', { name: `Other ${uid}` })).toHaveAttribute('href', `#/combinations/${other}`);
});

test('editing a published combination names no other with the same glazes', async ({ page, shell, api, signedIn, uid }) => {
  const glazes = await twoGlazes(api, uid);
  const steps = [glazeStep(glazes.red), glazeStep(glazes.blue)];
  await api.addCombination({ title: `First ${uid}`, steps });
  const second = await api.addCombination({ title: `Second ${uid}`, steps });
  const draft = await api.addCombination({ title: `Draft ${uid}`, steps, draft: true });

  await shell.open(`#/studio/${second}`);
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await expect(studio.title).toHaveValue(`Second ${uid}`);
  await expect(note(page)).toHaveCount(0);

  // An own draft is still being worked on: it names the published ones, never itself.
  await shell.open(`#/studio/${draft}`);
  await expect(studio.title).toHaveValue(`Draft ${uid}`);
  await expect(note(page).getByRole('link')).toHaveCount(2);
  await expect(note(page).getByRole('link', { name: `Draft ${uid}` })).toHaveCount(0);
  await expect(note(page)).toContainText(t('studio.sameGlazes.body', { count: 2 }));
});
