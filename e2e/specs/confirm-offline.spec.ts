import type { BrowserContext, Locator, Page } from '@playwright/test';
import { BISQUE_STEP, type Api } from '../support/api';
import { t, type MessageKey } from '../support/i18n';
import { png, seededPicture } from '../support/images';
import type { AppShell } from '../support/pages/app-shell';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/**
 * Every confirmation dialog (`common/ConfirmDialog`) that is disabled offline says so: the offline note stands above its
 * disabled confirm, Cancel stays usable, and both come back when the connection does (USER 2026-11-06). The admin queues'
 * dialogs are not here: their pages close them when the connection goes (the queue needs it), see `bans.spec.ts`.
 */
interface Case {
  name: string;
  /** Seeds what the dialog needs, opens it and answers it with the texts it is checked by. */
  open: (fixtures: { page: Page; shell: AppShell; api: Api; newApi: () => Promise<Api>; uid: string; email: string }) => Promise<{ dialog: Locator }>;
  confirm: MessageKey;
  note: MessageKey;
}

const main = (page: Page) => page.getByRole('main');
const dialogNamed = (page: Page, name: string) => page.getByRole('dialog', { name });

/** Another person, signed up in a session of their own. */
async function person(newApi: () => Promise<Api>, uid: string, name: string) {
  const api = await newApi();
  await api.signUp({ ...newAccount(uid, name), displayName: name });
  return { api, id: (await api.me()).id };
}

const cases: Case[] = [
  {
    name: 'delete a combination',
    confirm: 'combination.delete.confirm',
    note: 'forms.offline',
    async open({ page, shell, api, uid }) {
      const id = await api.addCombination({ title: `Gone ${uid}`, steps: [BISQUE_STEP] });
      await shell.open(`#/combinations/${id}`);
      await main(page)
        .getByRole('button', { name: t('combination.delete.confirm') })
        .click();
      return { dialog: dialogNamed(page, t('combination.delete.title')) };
    },
  },
  {
    name: 'delete a photo',
    confirm: 'images.remove.confirm',
    note: 'images.menu.offline',
    async open({ page, shell, api, uid }) {
      const title = `Photo ${uid}`;
      const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
      await api.uploadToCombination(id, { file: png('tile.png') });
      await shell.open(`#/combinations/${id}`);
      await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
      await page.getByRole('button', { name: t('images.menu.label') }).click();
      await page.getByRole('menuitem', { name: t('images.menu.delete') }).click();
      return { dialog: dialogNamed(page, t('images.remove.action')) };
    },
  },
  {
    name: 'remove a glaze (site admin)',
    confirm: 'glaze.remove.confirm',
    note: 'forms.offline',
    async open({ page, shell, api, uid, email }) {
      const glaze = await api.addGlaze({ newManufacturer: { name: `Gone ${uid}`, shortId: uid }, name: 'Gone', code: 'G-1' });
      await grantSiteAdmin(email);
      await shell.open(`#/glazes/${glaze.id}`);
      await main(page)
        .getByRole('button', { name: t('glaze.remove.action') })
        .click();
      return { dialog: dialogNamed(page, t('glaze.remove.title')) };
    },
  },
  {
    name: 'remove the profile picture',
    confirm: 'account.avatar.remove.confirm',
    note: 'account.avatar.offline',
    async open({ page, shell, api, uid }) {
      await api.uploadAvatar(seededPicture(`confirm-offline ${uid}`));
      await shell.open('#/account');
      await main(page)
        .getByRole('button', { name: t('account.avatar.remove') })
        .click();
      return { dialog: dialogNamed(page, t('account.avatar.remove.title')) };
    },
  },
  {
    name: 'remove a buddy',
    confirm: 'buddies.remove.confirm',
    note: 'buddies.offline',
    async open({ page, shell, api, newApi, uid }) {
      const token = await api.replaceBuddyLink();
      const bo = await person(newApi, uid, 'Bo');
      await bo.api.requestBuddyByLink(token.slice(token.lastIndexOf('/') + 1));
      await api.acceptBuddy(bo.id);
      await shell.open('#/account');
      await main(page)
        .getByRole('button', { name: t('buddies.remove.label', { name: 'Bo' }) })
        .click();
      return { dialog: dialogNamed(page, t('buddies.remove.title', { name: 'Bo' })) };
    },
  },
  {
    name: 'replace the buddy link',
    confirm: 'buddies.link.confirm',
    note: 'buddies.offline',
    async open({ page, shell, api }) {
      await api.replaceBuddyLink();
      await shell.open('#/account');
      await main(page)
        .getByRole('button', { name: t('buddies.link.replace') })
        .click();
      return { dialog: dialogNamed(page, t('buddies.link.confirmTitle')) };
    },
  },
  {
    name: 'leave a club',
    confirm: 'clubs.leave.confirm',
    note: 'forms.offline',
    async open({ page, shell, api, newApi, uid }) {
      const name = `Leave ${uid}`;
      const cleo = await person(newApi, uid, 'Cleo');
      const { token } = await cleo.api.clubWithInvite(name);
      await api.joinClub(token);
      await shell.open('#/clubs');
      await main(page)
        .getByRole('button', { name: t('clubs.leave.open') })
        .click();
      return { dialog: dialogNamed(page, t('clubs.leave.title', { club: name })) };
    },
  },
  {
    name: 'replace the club invite link',
    confirm: 'clubs.settings.invites.confirm',
    note: 'forms.offline',
    async open({ page, shell, api, uid }) {
      const { club } = await api.clubWithInvite(`Invite ${uid}`);
      await shell.open(`#/clubs/${club.id}`);
      await main(page)
        .getByRole('button', { name: t('clubs.page.invite') })
        .click();
      await main(page)
        .getByRole('button', { name: t('clubs.settings.invites.replace') })
        .click();
      return { dialog: dialogNamed(page, t('clubs.settings.invites.confirmTitle')) };
    },
  },
  {
    name: 'remove a club member',
    confirm: 'clubs.settings.removeConfirm',
    note: 'forms.offline',
    async open({ page, shell, api, newApi, uid }) {
      const { club, token } = await api.clubWithInvite(`Members ${uid}`);
      const bo = await person(newApi, uid, 'Bo');
      await bo.api.joinClub(token);
      await shell.open(`#/clubs/${club.id}`);
      await main(page)
        .getByRole('button', { name: t('clubs.settings.title') })
        .click();
      await main(page)
        .getByRole('button', { name: t('clubs.settings.removeFor', { name: 'Bo' }) })
        .click();
      return { dialog: dialogNamed(page, t('clubs.settings.removeTitle', { name: 'Bo' })) };
    },
  },
  {
    name: 'remove a club wishlist entry',
    confirm: 'clubs.wishlist.removeConfirm',
    note: 'forms.offline',
    async open({ page, shell, api, uid }) {
      const { id } = await api.createClub(`Wishes ${uid}`);
      await api.addWishlistEntry(id, { type: 'ITEM', name: 'Sponges', link: 'https://shop.example.test/sponges' });
      await shell.open(`#/clubs/${id}`);
      await main(page)
        .getByRole('button', { name: t('clubs.wishlist.removeFor', { name: 'Sponges' }) })
        .click();
      return { dialog: dialogNamed(page, t('clubs.wishlist.removeTitle', { name: 'Sponges' })) };
    },
  },
];

async function expectOfflineNote(context: BrowserContext, dialog: Locator, confirmKey: MessageKey, noteKey: MessageKey) {
  const confirm = dialog.getByRole('button', { name: t(confirmKey), exact: true });
  const cancel = dialog.getByRole('button', { name: t('common.cancel'), exact: true });
  const note = dialog.getByText(t(noteKey), { exact: true });
  await expect(confirm).toBeEnabled();
  await expect(note).toHaveCount(0);

  await context.setOffline(true);
  await expect(note).toBeVisible();
  await expect(confirm).toBeDisabled();
  await expect(cancel).toBeEnabled();
  const [noteBox, confirmBox] = [(await note.boundingBox())!, (await confirm.boundingBox())!];
  expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(confirmBox.y);

  await context.setOffline(false);
  await expect(note).toBeHidden();
  await expect(confirm).toBeEnabled();
}

for (const item of cases) {
  test(`the confirmation to ${item.name} shows the offline note above its disabled confirm`, async ({ page, shell, api, newApi, uid, signedIn, context }) => {
    const { dialog } = await item.open({ page, shell, api, newApi, uid, email: signedIn.email });
    await expect(dialog).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectOfflineNote(context, dialog, item.confirm, item.note);
  });
}
