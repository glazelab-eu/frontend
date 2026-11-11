import { t } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';

test('the first invite link of a new club turns invite links on, and a later save keeps them on', async ({ page, shell, api, signedIn, uid }) => {
  const name = `First link ${uid}`;
  const { id } = await api.createClub(name);
  await shell.open(`#/clubs/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('clubs.page.invite') }).click();

  const generate = page.getByRole('button', { name: t('clubs.settings.invites.generate') });
  await expect(generate).toHaveAccessibleDescription(t('clubs.settings.invites.turnsOn'));
  await generate.click();
  const link = page.getByRole('textbox', { name: t('clubs.settings.invites.link') });
  await expect(link).toHaveValue(/#\/invite\/[\w-]+$/);
  // The link takes the focus, so it can be copied at once.
  await expect(link).toBeFocused();
  await expect(page.getByText(t('clubs.settings.invites.turnsOn'))).toBeHidden();
  await expect(page.getByRole('button', { name: t('clubs.settings.invites.replace') })).not.toHaveAttribute('aria-describedby');

  // The switch follows the club the generation turned on, so the save below cannot turn invite links off again.
  await page.getByRole('button', { name: t('clubs.settings.title') }).click();
  const enabled = page.getByRole('checkbox', { name: t('clubs.settings.enableInvites') });
  await expect(enabled).toBeChecked();
  await page.getByRole('button', { name: t('clubs.settings.save') }).click();
  await expect(page.getByRole('status').filter({ hasText: t('clubs.settings.saved') })).toBeVisible();
  // The account's own save is no sign that another admin replaced the link.
  await expect(link).toBeVisible();
  await expect(page.getByText(t('clubs.settings.invites.replaced'))).toBeHidden();
  expect((await api.clubs()).find((club) => club.name === name)?.invitesEnabled).toBe(true);
});

test('an unsaved change of the invite switch survives a reload that reports the same value', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await api.clubWithInvite(`Kept switch ${uid}`);
  await shell.open(`#/clubs/${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('clubs.settings.title') }).click();
  await page.getByRole('button', { name: t('clubs.page.invite') }).click();
  const enabled = page.getByRole('checkbox', { name: t('clubs.settings.enableInvites') });
  await expect(enabled).toBeChecked();
  await enabled.uncheck();

  // Replacing the link reloads the clubs: a new club object, invites still on. The link shows once that load is in.
  await page.getByRole('button', { name: t('clubs.settings.invites.replace') }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('clubs.settings.invites.confirm') })
    .click();
  await expect(page.getByRole('textbox', { name: t('clubs.settings.invites.link') })).toHaveValue(/#\/invite\/[\w-]+$/);
  await expect(enabled).not.toBeChecked();
});

test('a link another admin replaced is called replaced after the next own save, and the link of a club with invites off returns with them', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const name = `Two admins ${uid}`;
  const { id } = await api.createClub(name);
  const { token } = await api.replaceInvite(id);
  const bo = await newApi();
  await bo.signUp(newAccount(uid, 'Bo'));
  await bo.joinClub(token);
  await api.setClubRole(id, (await bo.me()).id, 'ADMIN');

  await shell.open(`#/clubs/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('button', { name: t('clubs.page.invite') }).click();
  // This session never saw the first link: the server keeps only its hash.
  await expect(page.getByText(t('clubs.settings.invites.hidden'))).toBeVisible();
  await page.getByRole('button', { name: t('clubs.settings.invites.replace') }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('clubs.settings.invites.confirm') })
    .click();
  const link = page.getByRole('textbox', { name: t('clubs.settings.invites.link') });
  await expect(link).toHaveValue(/#\/invite\/[\w-]+$/);

  // Invites off: the link is hidden, with the way back; on again it shows without a new one.
  await page.getByRole('button', { name: t('clubs.settings.title') }).click();
  const enabled = page.getByRole('checkbox', { name: t('clubs.settings.enableInvites') });
  await enabled.uncheck();
  await page.getByRole('button', { name: t('clubs.settings.save') }).click();
  await expect(page.getByText(t('clubs.settings.invites.offKnown'))).toBeVisible();
  await expect(link).toBeHidden();
  await enabled.check();
  await page.getByRole('button', { name: t('clubs.settings.save') }).click();
  await expect(link).toBeVisible();

  // Bo replaces the link; the admin's own next save is the first load since, and the dead link must not stay shown.
  await bo.replaceInvite(id);
  await page.getByRole('button', { name: t('clubs.settings.save') }).click();
  await expect(page.getByText(t('clubs.settings.invites.replaced'))).toBeVisible();
  await expect(link).toBeHidden();
});

test('an invite link pasted with its full stop, or cut short, says it is invalid instead of the form-field message', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const { token } = await api.clubWithInvite(`Pasted ${uid}`);
  await shell.open('#/');
  await shell.expectSignedIn(signedIn.displayName);
  const dialog = page.getByRole('dialog', { name: t('clubs.invite.title') });
  for (const broken of [`${token}.`, token.slice(0, -5)]) {
    await page.evaluate((hash) => (location.hash = hash), `#/invite/${broken}`);
    await expect(dialog.getByRole('alert')).toHaveText(t('errors.inviteInvalid'));
    await expect(dialog.getByRole('button', { name: t('clubs.invite.join') })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});
