import { t } from '../support/i18n';
import { expect, test } from './support';

/** The clubs list (cards, create a club) and a club page (members, buddy requests, invite link and QR, settings, club shelf). */
test('clubs list: cards and create a club', async ({ page, begin, finish, human, signIn }) => {
  await signIn();
  const main = page.getByRole('main');
  await begin('#/clubs', (p) => p.getByRole('main').getByRole('article').first().waitFor());
  await human.browse(1, 400);
  await human.scroll(0);
  await human.tryStep('create a club', async () => {
    await human.tap(main.getByText(t('clubs.create.title'), { exact: true }));
    await human.type(main.getByLabel(t('clubs.name')), 'Thursday Raku Group');
    await human.tap(main.getByRole('button', { name: t('clubs.create.submit') }));
    await expect(page.getByRole('status').filter({ hasText: t('notices.clubCreated') })).toBeVisible();
    await human.pause(2000);
  });
  await finish('clubs');
});

test('club page: members, buddies, invite link, settings, club shelf', async ({ page, begin, finish, human, signIn, seed }) => {
  await signIn();
  const main = page.getByRole('main');
  await begin(`#/clubs/${seed.clubs.riverside}`, (p) => p.getByRole('heading', { level: 1, name: 'Riverside Clay Club' }).waitFor());
  await human.browse(1, 420);
  await human.tryStep('accept buddy request', async () => {
    await human.tap(main.getByRole('button', { name: /^Accept/ }).first());
    await human.pause(1500);
  });
  await human.tryStep('club combinations', async () => {
    await human.browse(2, 520);
    await human.scroll(0);
  });
  await human.tryStep('club shelf', async () => {
    await human.tap(main.getByRole('link', { name: /^Club shelf/ }));
    await human.browse(1, 450);
    await page.goBack();
    await human.pause(1000);
  });
  await human.tryStep('invite', async () => {
    await human.tap(main.getByRole('button', { name: t('clubs.page.invite') }));
    await human.pause(1800);
    await human.tap(page.getByRole('button', { name: t('clubs.settings.invites.replace') }));
    await human.tap(page.getByRole('dialog').getByRole('button', { name: t('clubs.settings.invites.confirm') }));
    await human.pause(2500);
    await human.browse(1, 450);
    await human.pause(1500);
  });
  await human.tryStep('settings', async () => {
    const dialog = page.getByRole('dialog').first();
    if (await dialog.isVisible())
      await dialog
        .getByRole('button', { name: t('common.close'), exact: true })
        .first()
        .click();
    await human.pause(600);
    await human.tap(main.getByRole('button', { name: t('clubs.settings.title') }));
    await human.pause(2000);
    await human.browse(2, 480);
  });
  await finish('club');
});
