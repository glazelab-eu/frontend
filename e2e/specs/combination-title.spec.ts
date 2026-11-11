import { Api, BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { ExplorePage } from '../support/pages/explore';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/** The quick title correction on the combination page: the author's Rename and a site admin's Correct title. */

test('the author renames from the page; Explore, Studio and another device show the new title @smoke', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  browser,
  baseURL,
}, info) => {
  const id = await api.addCombination({ title: `Celadon ovr shino ${uid}`, steps: [BISQUE_STEP] });
  // Another device of the same account has the listing already.
  const other = await browser.newContext({ baseURL });
  await new Api(other.request).signIn(signedIn);
  const otherPage = await other.newPage();
  await otherPage.goto(`/#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(otherPage).cardTitles).toHaveText([`Celadon ovr shino ${uid}`]);

  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const rename = main.getByRole('button', { name: t('combination.rename'), exact: true });
  await expect(rename).toBeVisible();
  await expect(main.getByRole('button', { name: t('combination.correctTitle'), exact: true })).toHaveCount(0);
  await rename.click();
  const dialog = page.getByRole('dialog', { name: t('combination.rename.title') });
  const field = dialog.getByRole('textbox', { name: t('studio.titleLabel') });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(`Celadon ovr shino ${uid}`);
  await expect(dialog.getByText(t('combination.correctTitle.body'))).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('rename-dialog.png') });
  await field.fill(`  Celadon over shino ${uid} `);
  await dialog.getByRole('button', { name: t('combination.rename.save') }).click();
  await expect(dialog).toBeHidden();
  await expect(rename).toBeFocused();
  await expect(main.getByRole('heading', { level: 1, name: `Celadon over shino ${uid}`, exact: true })).toBeVisible();
  await expect(page.getByText(t('notices.combinationRenamed'))).toBeVisible();

  // Explore after a reload (the snapshot and the delta agree), and the Studio form opens with the new title.
  await page.goto('about:blank');
  await shell.open(`#/?type=combinations&q=${uid}`);
  await expect(new ExplorePage(page).cardTitles).toHaveText([`Celadon over shino ${uid}`]);
  await shell.open(`#/studio/${id}`);
  await expect(page.getByRole('textbox', { name: t('studio.titleLabel') })).toHaveValue(`Celadon over shino ${uid}`);

  await otherPage.reload();
  await expect(new ExplorePage(otherPage).cardTitles).toHaveText([`Celadon over shino ${uid}`]);
  await other.close();
});

test('a published combination keeps a title: a blank one is refused at the form', async ({ page, shell, api, signedIn, uid }) => {
  const id = await api.addCombination({ title: `Kept ${uid}`, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('combination.rename'), exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: t('combination.rename.title') });
  await dialog.getByRole('textbox', { name: t('studio.titleLabel') }).fill('   ');
  await dialog.getByRole('button', { name: t('combination.rename.save') }).click();
  await expect(dialog.getByRole('alert')).toHaveText(t('errors.combinationTitleRequired'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: `Kept ${uid}`, exact: true })).toBeVisible();
});

test("a site admin corrects a stranger's title, which says so; a draft offers neither control", async ({ page, shell, api, newApi, signedIn, uid }, info) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const id = await author.addCombination({ title: `Tenmoku ovr ash ${uid}`, steps: [BISQUE_STEP] });
  const draft = await api.addCombination({ title: `Own draft ${uid}`, steps: [BISQUE_STEP], draft: true });
  await grantSiteAdmin(signedIn.email);
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  const correct = main.getByRole('button', { name: t('combination.correctTitle'), exact: true });
  await expect(correct).toBeVisible();
  await expect(main.getByRole('button', { name: t('combination.rename'), exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('correct-control.png'), fullPage: true });
  await correct.click();
  const dialog = page.getByRole('dialog', { name: t('combination.correctTitle') });
  await expect(dialog.getByText(t('combination.correctTitle.body'))).toBeVisible();
  await page.screenshot({ path: info.outputPath('correct-dialog.png') });
  await dialog.getByRole('textbox', { name: t('studio.titleLabel') }).fill(`Tenmoku over ash ${uid}`);
  await dialog.getByRole('button', { name: t('combination.rename.save') }).click();
  await expect(dialog).toBeHidden();
  await expect(correct).toBeFocused();
  await expect(main.getByRole('heading', { level: 1, name: `Tenmoku over ash ${uid}`, exact: true })).toBeVisible();
  // The author sees the corrected title after a reload.
  expect((await author.combinations()).find((combo) => combo.id === id)?.title).toBe(`Tenmoku over ash ${uid}`);

  await shell.open(`#/combinations/${draft}`);
  await expect(main.getByRole('button', { name: t('combination.publish') })).toBeVisible();
  await expect(main.getByRole('button', { name: t('combination.rename'), exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: t('combination.correctTitle'), exact: true })).toHaveCount(0);
});

test("a plain member sees no title control on someone else's combination", async ({ page, shell, newApi, signedIn, uid }) => {
  const author = await newApi();
  await author.signUp(newAccount(uid, 'Cleo'));
  const id = await author.addCombination({ title: `Theirs ${uid}`, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: t('combination.recordVariation') })).toBeVisible();
  await expect(main.getByRole('button', { name: t('combination.rename'), exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: t('combination.correctTitle'), exact: true })).toHaveCount(0);
});

test('offline the control is disabled, and a dialog left open says why it cannot save', async ({ page, shell, api, signedIn, uid, context }) => {
  const id = await api.addCombination({ title: `Offline ${uid}`, steps: [BISQUE_STEP] });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const rename = page.getByRole('main').getByRole('button', { name: t('combination.rename'), exact: true });
  await rename.click();
  const dialog = page.getByRole('dialog', { name: t('combination.rename.title') });
  await dialog.getByRole('textbox', { name: t('studio.titleLabel') }).fill(`Offline edit ${uid}`);
  await context.setOffline(true);
  await expect(dialog.getByRole('button', { name: t('combination.rename.save') })).toBeDisabled();
  await expect(dialog.getByText(t('forms.offline'))).toBeVisible();
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(rename).toBeDisabled();
  await context.setOffline(false);
});
